/**
 * protoo signaling handler for listener WebRTC audio subscription.
 *
 * Dispatches protoo request/response for the full signaling flow:
 * getRouterRtpCapabilities -> createWebRtcTransport -> connectWebRtcTransport
 * -> consume -> resumeConsumer, plus switchChannel for channel switching.
 *
 * SRP note: SignalingHandler focuses on protoo request dispatch and consumer
 * lifecycle. Heartbeat/zombie detection is delegated to PeerHeartbeatTracker.
 *
 * Events emitted:
 * - "listener-connected"    { peerId, sessionId }
 * - "listener-disconnected" { peerId, sessionId, channelId }
 */

import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import type { types as mediasoupTypes } from "mediasoup";
import type {
  ProtooPeer,
  ProtooRequest,
  ProtooAcceptFn,
  ProtooRejectFn,
  ListenerPeerData,
  ListenerSessionInfo,
  ListenerChannelInfo,
  LatencyMode,
  LossRecoveryMode,
} from "./streaming-types.js";
import type { RouterManager, ChannelMetadataResolver } from "./router-manager.js";
import type { TransportManager } from "./transport-manager.js";
import { logger } from "../utils/logger.js";
import { toErrorMessage } from "../utils/error-message.js";

// ---------------------------------------------------------------------------
// Channel config resolver (provides streaming-specific config per channel)
// ---------------------------------------------------------------------------

/**
 * Callback that resolves per-channel streaming configuration from the config store.
 * Keeps SignalingHandler decoupled from the config store / ChannelManager.
 */
export type ChannelStreamingConfigResolver = (channelId: string) =>
  | {
      latencyMode: LatencyMode;
      lossRecovery: LossRecoveryMode;
      defaultChannel: boolean;
    }
  | undefined;

// ---------------------------------------------------------------------------
// PeerHeartbeatTracker (private helper -- SRP)
// ---------------------------------------------------------------------------

/**
 * Tracks last activity timestamp per peer and detects zombie connections
 * that have gone silent beyond a configurable threshold.
 */
class PeerHeartbeatTracker {
  private readonly lastActivityMap: Map<string, number> = new Map();
  private readonly zombieThresholdMs: number;

  constructor(heartbeatIntervalMs: number) {
    // A peer is considered a zombie if no activity for 2x the heartbeat interval
    this.zombieThresholdMs = heartbeatIntervalMs * 2;
  }

  /** Record activity for a peer (called on any request). */
  recordActivity(peerId: string): void {
    this.lastActivityMap.set(peerId, Date.now());
  }

  /** Remove a peer from tracking (called on disconnect). */
  removePeer(peerId: string): void {
    this.lastActivityMap.delete(peerId);
  }

  /**
   * Check all tracked peers and return IDs of those that have been
   * inactive beyond the zombie threshold.
   */
  detectZombies(): string[] {
    const now = Date.now();
    const zombiePeerIds: string[] = [];

    for (const [peerId, lastActivity] of this.lastActivityMap) {
      if (now - lastActivity > this.zombieThresholdMs) {
        zombiePeerIds.push(peerId);
      }
    }

    return zombiePeerIds;
  }

  /** Get the number of tracked peers. */
  getTrackedCount(): number {
    return this.lastActivityMap.size;
  }
}

// ---------------------------------------------------------------------------
// SignalingHandler
// ---------------------------------------------------------------------------

export class SignalingHandler extends EventEmitter {
  private readonly routerManager: RouterManager;
  private readonly transportManager: TransportManager;
  private readonly metadataResolver: ChannelMetadataResolver;
  private readonly channelConfigResolver: ChannelStreamingConfigResolver;
  private readonly channelListProvider: () => ListenerChannelInfo[];
  private readonly heartbeatTracker: PeerHeartbeatTracker;
  private readonly peers: Map<string, ProtooPeer> = new Map();

  constructor(
    routerManager: RouterManager,
    transportManager: TransportManager,
    metadataResolver: ChannelMetadataResolver,
    channelConfigResolver: ChannelStreamingConfigResolver,
    heartbeatIntervalMs: number,
    channelListProvider?: () => ListenerChannelInfo[],
  ) {
    super();
    this.routerManager = routerManager;
    this.transportManager = transportManager;
    this.metadataResolver = metadataResolver;
    this.channelConfigResolver = channelConfigResolver;
    this.channelListProvider = channelListProvider
      ?? (() => this.routerManager.getActiveChannelList(this.metadataResolver));
    this.heartbeatTracker = new PeerHeartbeatTracker(heartbeatIntervalMs);
  }

  // -----------------------------------------------------------------------
  // Enriched channel list (injects listener counts per admin toggles)
  // -----------------------------------------------------------------------

  /**
   * Build the channel list enriched with listener counts.
   * Only computes listener counts when the admin has toggled showListenerCount on
   * (server optimization per locked decision -- don't waste CPU if hidden).
   */
  private buildEnrichedChannelList(): ListenerChannelInfo[] {
    const baseList = this.channelListProvider();

    return baseList.map((channel) => ({
      ...channel,
      listenerCount: channel.displayToggles.showListenerCount
        ? this.getListenerCount(channel.id)
        : 0,
    }));
  }

  // -----------------------------------------------------------------------
  // Listener count broadcast (called on 30s interval by ListenerWebSocketHandler)
  // -----------------------------------------------------------------------

  /**
   * Broadcast current listener counts to all non-admin listeners.
   * Sends the full enriched channel list so clients stay in sync.
   */
  async broadcastListenerCounts(): Promise<void> {
    const channels = this.buildEnrichedChannelList();
    await this.notifyAllListeners("listenerCounts", { channels });
  }

  // -----------------------------------------------------------------------
  // Peer lifecycle
  // -----------------------------------------------------------------------

  /**
   * Initialize a new listener peer: set up peer.data, push active channels,
   * and register request/close handlers.
   */
  handlePeer(peer: ProtooPeer): void {
    const sessionId = crypto.randomUUID();

    // Initialize ListenerPeerData on peer.data
    const peerData: ListenerPeerData = {
      sessionId,
      connectedAt: new Date().toISOString(),
      rtpCapabilities: null,
      webRtcTransport: null,
      currentConsumer: null,
      currentChannelId: null,
      isAdmin: false,
    };
    Object.assign(peer.data, peerData);

    this.peers.set(peer.id, peer);
    this.heartbeatTracker.recordActivity(peer.id);

    // Push enriched channels immediately on connect (includes listener counts)
    const activeChannels = this.buildEnrichedChannelList();
    const defaultChannelId = this.getDefaultChannelId();
    peer
      .notify("activeChannels", {
        channels: activeChannels,
        defaultChannelId,
      })
      .catch(() => {
        // Peer may have disconnected immediately
      });

    // Register request handler
    peer.on(
      "request",
      (request: ProtooRequest, accept: ProtooAcceptFn, reject: ProtooRejectFn) => {
        this.heartbeatTracker.recordActivity(peer.id);
        this.handleRequest(peer, request, accept, reject).catch((error) => {
          logger.error("Unhandled error in signaling request", {
            peerId: peer.id,
            method: request.method,
            error: toErrorMessage(error),
          });
          reject(500, "Internal server error");
        });
      },
    );

    // Register close handler
    peer.on("close", () => {
      this.handlePeerClose(peer);
    });

    this.emit("listener-connected", {
      peerId: peer.id,
      sessionId,
    });

    logger.info("Listener peer connected", {
      peerId: peer.id,
      sessionId,
    });
  }

  // -----------------------------------------------------------------------
  // Zombie detection (called by ListenerWebSocketHandler on heartbeat interval)
  // -----------------------------------------------------------------------

  /**
   * Detect and close zombie peers that have been inactive beyond threshold.
   * Returns the number of zombies found and closed.
   */
  closeZombiePeers(): number {
    const zombieIds = this.heartbeatTracker.detectZombies();

    for (const peerId of zombieIds) {
      const peer = this.peers.get(peerId);
      if (peer && !peer.closed) {
        logger.warn("Closing zombie listener peer", { peerId });
        peer.close();
      }
    }

    return zombieIds.length;
  }

  // -----------------------------------------------------------------------
  // Accessor methods
  // -----------------------------------------------------------------------

  /**
   * Count connected listeners, optionally filtered by channel.
   * Admin preview connections are excluded.
   */
  getListenerCount(channelId?: string): number {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.closed) continue;
      const data = peer.data as unknown as ListenerPeerData;
      if (data.isAdmin) continue;
      if (channelId !== undefined && data.currentChannelId !== channelId)
        continue;
      count++;
    }
    return count;
  }

  /**
   * Get session info for all connected listeners (admin dashboard display).
   */
  getListenerSessions(): ListenerSessionInfo[] {
    const sessions: ListenerSessionInfo[] = [];

    for (const peer of this.peers.values()) {
      if (peer.closed) continue;
      const data = peer.data as unknown as ListenerPeerData;
      sessions.push({
        sessionId: data.sessionId,
        connectedAt: data.connectedAt,
        currentChannelId: data.currentChannelId,
        isAdmin: data.isAdmin,
      });
    }

    return sessions;
  }

  /**
   * Send a notification to all connected non-admin listeners.
   */
  async notifyAllListeners(
    method: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const notifyPromises: Promise<void>[] = [];

    for (const peer of this.peers.values()) {
      if (peer.closed) continue;
      const peerData = peer.data as unknown as ListenerPeerData;
      if (peerData.isAdmin) continue;
      notifyPromises.push(
        peer.notify(method, data).catch(() => {
          // Ignore notification failures for individual peers
        }),
      );
    }

    await Promise.all(notifyPromises);
  }

  /**
   * Send a notification to listeners on a specific channel.
   */
  async notifyListenersOnChannel(
    channelId: string,
    method: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const notifyPromises: Promise<void>[] = [];

    for (const peer of this.peers.values()) {
      if (peer.closed) continue;
      const peerData = peer.data as unknown as ListenerPeerData;
      if (peerData.isAdmin) continue;
      if (peerData.currentChannelId !== channelId) continue;
      notifyPromises.push(
        peer.notify(method, data).catch(() => {
          // Ignore notification failures for individual peers
        }),
      );
    }

    await Promise.all(notifyPromises);
  }

  /**
   * Disconnect all listeners currently on a specific channel.
   * Used when admin stops/hides a channel -- listeners get notified
   * with remaining active channels per locked decision.
   */
  async disconnectListenersFromChannel(channelId: string): Promise<void> {
    const enrichedChannels = this.buildEnrichedChannelList();
    // Send ALL channels including the stopped one (with hasActiveProducer: false)
    // so the listener UI shows it as a dimmed offline card
    const remainingChannels = enrichedChannels;

    for (const peer of this.peers.values()) {
      if (peer.closed) continue;
      const peerData = peer.data as unknown as ListenerPeerData;
      if (peerData.isAdmin) continue;
      if (peerData.currentChannelId !== channelId) continue;

      // Close the consumer (hard cut)
      if (peerData.currentConsumer) {
        peerData.currentConsumer.close();
        peerData.currentConsumer = null;
      }

      // Close the transport
      this.transportManager.closeTransport(peer.id);
      peerData.webRtcTransport = null;
      peerData.currentChannelId = null;

      // Notify with remaining active channels so listener can pick a new one
      peer
        .notify("channelStopped", {
          channelId,
          remainingChannels,
        })
        .catch(() => {});
    }
  }

  /**
   * Get the default channel ID from the active channel list.
   * Returns the first channel marked as defaultChannel, or the first
   * channel alphabetically if none is marked as default.
   */
  getDefaultChannelId(): string | null {
    const activeChannels = this.routerManager.getActiveChannelList(
      this.metadataResolver,
    );
    if (activeChannels.length === 0) return null;

    const defaultChannel = activeChannels.find((ch) => ch.defaultChannel);
    return defaultChannel?.id ?? activeChannels[0].id;
  }

  // -----------------------------------------------------------------------
  // Internal: request dispatch
  // -----------------------------------------------------------------------

  private async handleRequest(
    peer: ProtooPeer,
    request: ProtooRequest,
    accept: ProtooAcceptFn,
    reject: ProtooRejectFn,
  ): Promise<void> {
    switch (request.method) {
      case "getRouterRtpCapabilities":
        this.handleGetRouterRtpCapabilities(peer, accept);
        break;

      case "createWebRtcTransport":
        await this.handleCreateWebRtcTransport(peer, request, accept, reject);
        break;

      case "connectWebRtcTransport":
        await this.handleConnectWebRtcTransport(peer, request, accept, reject);
        break;

      case "consume":
        await this.handleConsume(peer, request, accept, reject);
        break;

      case "resumeConsumer":
        await this.handleResumeConsumer(peer, accept, reject);
        break;

      case "switchChannel":
        await this.handleSwitchChannel(peer, request, accept, reject);
        break;

      default:
        reject(400, `Unknown request method: ${request.method}`);
    }
  }

  // -----------------------------------------------------------------------
  // Request handlers
  // -----------------------------------------------------------------------

  /**
   * Return the Router's Opus RTP capabilities.
   * All routers share the same codec config, so any active channel works.
   */
  private handleGetRouterRtpCapabilities(
    peer: ProtooPeer,
    accept: ProtooAcceptFn,
  ): void {
    const activeChannelIds = this.routerManager.getActiveChannelIds();
    if (activeChannelIds.length === 0) {
      // No channels active -- return the Opus codec capability directly
      // (client needs it to load the Device even before subscribing)
      accept({
        rtpCapabilities: {
          codecs: [
            {
              kind: "audio" as const,
              mimeType: "audio/opus",
              preferredPayloadType: 101,
              clockRate: 48000,
              channels: 2,
              parameters: {},
              rtcpFeedback: [],
            },
          ],
          headerExtensions: [],
        },
      });
      return;
    }

    const router = this.routerManager.getRouterForChannel(activeChannelIds[0]);
    if (!router) {
      // Fallback (should not happen since we just checked activeChannelIds)
      accept({ rtpCapabilities: { codecs: [], headerExtensions: [] } });
      return;
    }

    // Store client capabilities if provided in request data
    if (peer.data.rtpCapabilities === undefined || peer.data.rtpCapabilities === null) {
      // Capabilities will be received in request.data on this or a subsequent call
    }

    accept({ rtpCapabilities: router.rtpCapabilities });
  }

  /**
   * Create a WebRtcTransport for the listener.
   *
   * The transport is created on the requested channel's router (or any active
   * router if no channel specified). On channel switch, the transport is
   * recreated on the target channel's router.
   */
  private async handleCreateWebRtcTransport(
    peer: ProtooPeer,
    request: ProtooRequest,
    accept: ProtooAcceptFn,
    reject: ProtooRejectFn,
  ): Promise<void> {
    // Store client RTP capabilities if provided
    if (request.data?.rtpCapabilities) {
      (peer.data as unknown as ListenerPeerData).rtpCapabilities =
        request.data.rtpCapabilities as mediasoupTypes.RtpCapabilities;
    }

    // Find a router to create the transport on
    const channelId = request.data?.channelId as string | undefined;
    const activeChannelIds = this.routerManager.getActiveChannelIds();

    const targetChannelId = channelId ?? activeChannelIds[0];
    if (!targetChannelId) {
      reject(503, "No active channels available");
      return;
    }

    const router = this.routerManager.getRouterForChannel(targetChannelId);
    if (!router) {
      reject(503, "Channel router not available");
      return;
    }

    // Close existing transport if any (reconnection scenario)
    const peerData = peer.data as unknown as ListenerPeerData;
    if (peerData.webRtcTransport) {
      this.transportManager.closeTransport(peer.id);
    }

    const transportInfo = await this.transportManager.createForListener(
      router,
      peer.id,
    );

    peerData.webRtcTransport = this.transportManager.getTransport(peer.id) ?? null;
    peerData.currentChannelId = targetChannelId;

    accept({
      id: transportInfo.id,
      iceParameters: transportInfo.iceParameters,
      iceCandidates: transportInfo.iceCandidates,
      dtlsParameters: transportInfo.dtlsParameters,
    });
  }

  /**
   * Complete the DTLS handshake for the listener's WebRtcTransport.
   */
  private async handleConnectWebRtcTransport(
    peer: ProtooPeer,
    request: ProtooRequest,
    accept: ProtooAcceptFn,
    reject: ProtooRejectFn,
  ): Promise<void> {
    if (!request.data?.dtlsParameters) {
      reject(400, "Missing dtlsParameters");
      return;
    }

    const peerData = peer.data as unknown as ListenerPeerData;
    if (!peerData.webRtcTransport) {
      reject(400, "No transport created yet");
      return;
    }

    await this.transportManager.connectTransport(
      peer.id,
      request.data.dtlsParameters as mediasoupTypes.DtlsParameters,
    );

    accept();
  }

  /**
   * Subscribe to a channel's audio producer.
   *
   * Consumer is always created paused per mediasoup best practice. Client
   * must send resumeConsumer after setting up the MediaStreamTrack.
   */
  private async handleConsume(
    peer: ProtooPeer,
    request: ProtooRequest,
    accept: ProtooAcceptFn,
    reject: ProtooRejectFn,
  ): Promise<void> {
    const channelId = request.data?.channelId as string | undefined;
    if (!channelId) {
      reject(400, "Missing channelId");
      return;
    }

    const peerData = peer.data as unknown as ListenerPeerData;
    if (!peerData.rtpCapabilities) {
      reject(400, "RTP capabilities not set -- call getRouterRtpCapabilities first");
      return;
    }

    if (!peerData.webRtcTransport) {
      reject(400, "No transport created yet");
      return;
    }

    const router = this.routerManager.getRouterForChannel(channelId);
    const producer = this.routerManager.getProducerForChannel(channelId);

    if (!router || !producer) {
      reject(404, "Channel not active");
      return;
    }

    if (
      !router.canConsume({
        producerId: producer.id,
        rtpCapabilities: peerData.rtpCapabilities,
      })
    ) {
      reject(400, "Cannot consume: incompatible RTP capabilities");
      return;
    }

    // Close existing consumer if switching (reusing same transport on same router)
    if (peerData.currentConsumer) {
      peerData.currentConsumer.close();
      peerData.currentConsumer = null;
    }

    // Resolve channel streaming config for NACK/PLC setting
    const channelConfig = this.channelConfigResolver(channelId);
    const lossRecovery = channelConfig?.lossRecovery ?? "nack";
    const consumerRtpCapabilities = this.buildConsumerRtpCapabilities(
      peerData.rtpCapabilities,
      lossRecovery,
    );

    // Create consumer paused (anti-pattern avoidance: never send RTP before client is ready)
    const consumer = await peerData.webRtcTransport.consume({
      producerId: producer.id,
      rtpCapabilities: consumerRtpCapabilities,
      paused: true,
    });

    this.wireConsumerEventHandlers(consumer, peer);

    peerData.currentConsumer = consumer;
    peerData.currentChannelId = channelId;

    accept({
      consumerId: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      latencyMode: channelConfig?.latencyMode ?? "live",
      lossRecovery,
    });

    logger.info("Consumer created for listener", {
      peerId: peer.id,
      channelId,
      consumerId: consumer.id,
      lossRecovery,
      paused: true,
    });
  }

  /**
   * Resume the current consumer (client confirms it is ready for audio).
   */
  private async handleResumeConsumer(
    peer: ProtooPeer,
    accept: ProtooAcceptFn,
    reject: ProtooRejectFn,
  ): Promise<void> {
    const peerData = peer.data as unknown as ListenerPeerData;
    if (!peerData.currentConsumer) {
      reject(400, "No active consumer to resume");
      return;
    }

    await peerData.currentConsumer.resume();
    accept();

    logger.info("Consumer resumed", {
      peerId: peer.id,
      consumerId: peerData.currentConsumer.id,
    });
  }

  /**
   * Switch to a different channel.
   *
   * Since each channel has its own Router and a consumer must be on the same
   * router as its producer, channel switching requires recreating the transport
   * on the target channel's router. On failure, falls back to previous channel.
   * If fallback also fails, notifies with remaining active channels.
   */
  private async handleSwitchChannel(
    peer: ProtooPeer,
    request: ProtooRequest,
    accept: ProtooAcceptFn,
    reject: ProtooRejectFn,
  ): Promise<void> {
    const targetChannelId = request.data?.channelId as string | undefined;
    if (!targetChannelId) {
      reject(400, "Missing channelId");
      return;
    }

    const peerData = peer.data as unknown as ListenerPeerData;
    if (!peerData.rtpCapabilities) {
      reject(400, "RTP capabilities not set");
      return;
    }

    const previousChannelId = peerData.currentChannelId;

    // Validate target channel is active
    const targetRouter =
      this.routerManager.getRouterForChannel(targetChannelId);
    const targetProducer =
      this.routerManager.getProducerForChannel(targetChannelId);

    if (!targetRouter || !targetProducer) {
      reject(404, "Target channel not active");
      return;
    }

    if (
      !targetRouter.canConsume({
        producerId: targetProducer.id,
        rtpCapabilities: peerData.rtpCapabilities,
      })
    ) {
      reject(400, "Cannot consume: incompatible RTP capabilities");
      return;
    }

    try {
      // Close existing consumer (hard cut -- old audio stops instantly)
      if (peerData.currentConsumer) {
        peerData.currentConsumer.close();
        peerData.currentConsumer = null;
      }

      // Close existing transport and create new one on target channel's router
      this.transportManager.closeTransport(peer.id);
      peerData.webRtcTransport = null;

      const transportInfo = await this.transportManager.createForListener(
        targetRouter,
        peer.id,
      );

      peerData.webRtcTransport =
        this.transportManager.getTransport(peer.id) ?? null;

      // Resolve channel streaming config for NACK/PLC
      const targetConfig = this.channelConfigResolver(targetChannelId);
      const targetLossRecovery = targetConfig?.lossRecovery ?? "nack";
      const switchRtpCapabilities = this.buildConsumerRtpCapabilities(
        peerData.rtpCapabilities,
        targetLossRecovery,
      );

      // Create consumer paused on new transport
      const consumer = await peerData.webRtcTransport!.consume({
        producerId: targetProducer.id,
        rtpCapabilities: switchRtpCapabilities,
        paused: true,
      });

      this.wireConsumerEventHandlers(consumer, peer);

      peerData.currentConsumer = consumer;
      peerData.currentChannelId = targetChannelId;

      accept({
        transportInfo: {
          id: transportInfo.id,
          iceParameters: transportInfo.iceParameters,
          iceCandidates: transportInfo.iceCandidates,
          dtlsParameters: transportInfo.dtlsParameters,
        },
        consumerId: consumer.id,
        producerId: consumer.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        latencyMode: targetConfig?.latencyMode ?? "live",
        lossRecovery: targetLossRecovery,
      });

      logger.info("Channel switch successful", {
        peerId: peer.id,
        from: previousChannelId,
        to: targetChannelId,
        lossRecovery: targetLossRecovery,
      });
    } catch (switchError) {
      logger.error("Channel switch failed, attempting fallback", {
        peerId: peer.id,
        targetChannelId,
        error: toErrorMessage(switchError),
      });

      // Attempt fallback to previous channel
      if (previousChannelId) {
        try {
          await this.recreateTransportAndConsumer(
            peer,
            peerData,
            previousChannelId,
          );
          reject(500, `Channel switch failed, fell back to previous channel`);
          return;
        } catch (fallbackError) {
          logger.error("Fallback to previous channel also failed", {
            peerId: peer.id,
            previousChannelId,
            error: toErrorMessage(fallbackError),
          });
        }
      }

      // Both switch and fallback failed -- notify with remaining active channels
      const activeChannels = this.buildEnrichedChannelList();

      peer
        .notify("activeChannels", { channels: activeChannels })
        .catch(() => {});

      reject(500, "Channel switch failed, select a new channel");
    }
  }

  // -----------------------------------------------------------------------
  // Internal: loss recovery configuration
  // -----------------------------------------------------------------------

  /**
   * Build consumer options based on the channel's loss recovery setting.
   *
   * - NACK mode ("nack"): default mediasoup behavior, NACK retransmission enabled.
   *   Just pass rtpCapabilities as-is.
   * - PLC mode ("plc"): strip NACK and transport-cc from the consumer's
   *   rtpCapabilities so mediasoup does not set up retransmission. The browser's
   *   Opus decoder uses Packet Loss Concealment instead.
   *
   * NOTE: The client-side jitter buffer configuration is controlled by
   * mediasoup-client in Phase 5. The server-side distinction here is:
   * 1. Whether NACK retransmission is enabled for the consumer
   * 2. Channel metadata (latencyMode) sent to listeners for client config
   */
  private buildConsumerRtpCapabilities(
    rtpCapabilities: mediasoupTypes.RtpCapabilities,
    lossRecovery: LossRecoveryMode,
  ): mediasoupTypes.RtpCapabilities {
    if (lossRecovery === "nack") {
      // Default behavior -- mediasoup handles NACK retransmission
      return rtpCapabilities;
    }

    // PLC mode: strip NACK-related RTCP feedback from codec capabilities
    // so the consumer does not request retransmission
    const strippedCodecs = (rtpCapabilities.codecs ?? []).map((codec) => ({
      ...codec,
      rtcpFeedback: (codec.rtcpFeedback ?? []).filter(
        (fb) => fb.type !== "nack" && fb.type !== "transport-cc",
      ),
    }));

    return {
      ...rtpCapabilities,
      codecs: strippedCodecs,
    };
  }

  // -----------------------------------------------------------------------
  // Internal: consumer event wiring
  // -----------------------------------------------------------------------

  /**
   * Wire cleanup event handlers on a consumer per audit garbage collection rules.
   */
  private wireConsumerEventHandlers(
    consumer: mediasoupTypes.Consumer,
    peer: ProtooPeer,
  ): void {
    consumer.on("producerclose", () => {
      const peerData = peer.data as unknown as ListenerPeerData;
      logger.info("Consumer closed due to producer close", {
        peerId: peer.id,
        consumerId: consumer.id,
      });

      // Notify client so it can clean up the MediaStreamTrack
      peer
        .notify("consumerClosed", {
          consumerId: consumer.id,
          reason: "producerclose",
        })
        .catch(() => {});

      if (peerData.currentConsumer?.id === consumer.id) {
        peerData.currentConsumer = null;
      }
    });

    consumer.on("transportclose", () => {
      const peerData = peer.data as unknown as ListenerPeerData;
      logger.info("Consumer closed due to transport close", {
        peerId: peer.id,
        consumerId: consumer.id,
      });

      if (peerData.currentConsumer?.id === consumer.id) {
        peerData.currentConsumer = null;
      }
    });
  }

  // -----------------------------------------------------------------------
  // Internal: peer close cleanup
  // -----------------------------------------------------------------------

  private handlePeerClose(peer: ProtooPeer): void {
    const peerData = peer.data as unknown as ListenerPeerData;

    // Close transport (cascades to consumer)
    this.transportManager.closeTransport(peer.id);

    // Clean up tracking
    this.peers.delete(peer.id);
    this.heartbeatTracker.removePeer(peer.id);

    this.emit("listener-disconnected", {
      peerId: peer.id,
      sessionId: peerData.sessionId,
      channelId: peerData.currentChannelId,
    });

    logger.info("Listener peer disconnected", {
      peerId: peer.id,
      sessionId: peerData.sessionId,
      channelId: peerData.currentChannelId,
    });
  }

  // -----------------------------------------------------------------------
  // Internal: transport + consumer recreation helper
  // -----------------------------------------------------------------------

  /**
   * Recreate WebRtcTransport and consumer for a peer on a given channel.
   * Used by switchChannel fallback logic.
   */
  private async recreateTransportAndConsumer(
    peer: ProtooPeer,
    peerData: ListenerPeerData,
    channelId: string,
  ): Promise<void> {
    const router = this.routerManager.getRouterForChannel(channelId);
    const producer = this.routerManager.getProducerForChannel(channelId);

    if (!router || !producer || !peerData.rtpCapabilities) {
      throw new Error(`Cannot recreate: channel ${channelId} not available`);
    }

    // Close existing transport if any
    this.transportManager.closeTransport(peer.id);
    peerData.webRtcTransport = null;
    peerData.currentConsumer = null;

    // Create new transport on the channel's router
    await this.transportManager.createForListener(router, peer.id);
    peerData.webRtcTransport =
      this.transportManager.getTransport(peer.id) ?? null;

    if (!peerData.webRtcTransport) {
      throw new Error("Failed to create transport");
    }

    // Resolve loss recovery setting for the fallback channel
    const channelConfig = this.channelConfigResolver(channelId);
    const lossRecovery = channelConfig?.lossRecovery ?? "nack";
    const fallbackRtpCapabilities = this.buildConsumerRtpCapabilities(
      peerData.rtpCapabilities,
      lossRecovery,
    );

    // Create consumer paused
    const consumer = await peerData.webRtcTransport.consume({
      producerId: producer.id,
      rtpCapabilities: fallbackRtpCapabilities,
      paused: true,
    });

    this.wireConsumerEventHandlers(consumer, peer);
    peerData.currentConsumer = consumer;
    peerData.currentChannelId = channelId;
  }
}
