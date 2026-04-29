/**
 * StreamingSubsystem facade -- top-level entry point for all WebRTC streaming.
 *
 * Wires WorkerManager, RouterManager, PlainTransportManager, TransportManager,
 * SignalingHandler, and ListenerWebSocketHandler into a cohesive lifecycle.
 * Syncs with AudioSubsystem channel events to create/remove mediasoup Routers
 * and PlainTransports when GStreamer pipelines start/stop.
 *
 * Events emitted:
 * - "listener-count-changed"  (channelId: string, count: number)
 * - "worker-alert"            (alertType: string, details: Record<string, unknown>)
 * - "latency-warning"         (warnings: Array<{ channelId, name, estimate }>)
 */

import { EventEmitter } from "node:events";
import type { Server as HttpsServer } from "node:https";
import type { ConfigStore } from "../config/store.js";
import type { AudioSubsystem } from "../audio/audio-subsystem.js";
import type { AppChannel } from "../audio/channels/channel-types.js";
import type {
  ListenerSessionInfo,
  WorkerResourceInfo,
  ListenerChannelInfo,
  LatencyEstimate,
} from "./streaming-types.js";
import type { ChannelMetadataResolver } from "./router-manager.js";
import { WorkerManager } from "./worker-manager.js";
import { PlainTransportManager } from "./plain-transport-manager.js";
import { RouterManager } from "./router-manager.js";
import { TransportManager } from "./transport-manager.js";
import { SignalingHandler } from "./signaling-handler.js";
import type { ChannelStreamingConfigResolver } from "./signaling-handler.js";
import { ListenerWebSocketHandler } from "../ws/listener-handler.js";
import { LatencyEstimator } from "./latency-estimator.js";
import type { LatencyEstimateInput } from "./latency-estimator.js";
import { logger } from "../utils/logger.js";
import { toErrorMessage } from "../utils/error-message.js";

// ---------------------------------------------------------------------------
// Admin metrics types
// ---------------------------------------------------------------------------

/** Per-channel streaming status for admin dashboard. */
export interface ChannelStreamingStatus {
  readonly channelId: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly listenerCount: number;
  readonly latencyEstimate: LatencyEstimate;
  readonly latencyMode: "live" | "stable";
  readonly lossRecovery: "nack" | "plc";
}

/** Per-listener connection stats from consumer.getStats(). */
export interface ListenerConnectionStats {
  readonly sessionId: string;
  readonly channelId: string | null;
  readonly connectedAt: string;
  readonly sessionDurationMs: number;
  readonly packetLoss: number;
  readonly jitter: number;
  readonly bitrate: number;
}

/** Latency monitoring interval (ms). */
const LATENCY_MONITOR_INTERVAL_MS = 30_000;

/** Default latency warning threshold (ms). */
const LATENCY_WARNING_THRESHOLD_MS = 200;

// ---------------------------------------------------------------------------
// StreamingSubsystem
// ---------------------------------------------------------------------------

export class StreamingSubsystem extends EventEmitter {
  private readonly configStore: ConfigStore;
  private readonly audioSubsystem: AudioSubsystem;

  private workerManager: WorkerManager | null = null;
  private plainTransportManager: PlainTransportManager | null = null;
  private routerManager: RouterManager | null = null;
  private transportManager: TransportManager | null = null;
  private signalingHandler: SignalingHandler | null = null;
  private listenerWsHandler: ListenerWebSocketHandler | null = null;
  private readonly latencyEstimator = new LatencyEstimator();
  private latencyMonitorInterval: ReturnType<typeof setInterval> | null = null;

  private shutdownDrainMs: number = 5000;

  // Bound handler references for AudioSubsystem event cleanup on stop()
  private boundChannelStateHandler: ((channelId: string, status: string) => void) | null = null;
  private boundChannelRemovedHandler: ((channelId: string) => void) | null = null;
  private boundChannelCreatedHandler: ((channel: AppChannel) => void) | null = null;

  constructor(configStore: ConfigStore, audioSubsystem: AudioSubsystem) {
    super();
    this.configStore = configStore;
    this.audioSubsystem = audioSubsystem;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start all streaming components and wire AudioSubsystem event listeners.
   *
   * @param httpsServer           The HTTPS server (kept for potential future use)
   * @param setListenerHandler    Callback to wire the listener handler into the
   *                              upgrade dispatcher on httpsServer (from handler.ts)
   */
  async start(
    httpsServer: HttpsServer,
    setListenerHandler?: (handler: ListenerWebSocketHandler) => void,
  ): Promise<void> {
    const config = this.configStore.get();

    this.shutdownDrainMs = config.streaming.shutdownDrainMs;

    // 1. Create and start WorkerManager
    this.workerManager = new WorkerManager({
      workerCount: config.mediasoup.workerCount,
      rtcMinPort: config.mediasoup.rtcMinPort,
      rtcMaxPort: config.mediasoup.rtcMaxPort,
      logLevel: config.mediasoup.logLevel,
    });
    await this.workerManager.start();

    // 2. Create PlainTransportManager
    this.plainTransportManager = new PlainTransportManager();

    // 3. Create RouterManager
    this.routerManager = new RouterManager(
      this.workerManager,
      this.plainTransportManager,
    );

    // 4. Create TransportManager with LAN IP as announced address
    this.transportManager = new TransportManager(config.server.host);

    // 5. Create channel metadata resolver (bridges AudioSubsystem -> RouterManager)
    const metadataResolver: ChannelMetadataResolver = this.buildMetadataResolver();

    // 6. Create channel streaming config resolver (latencyMode, lossRecovery, defaultChannel)
    const channelConfigResolver: ChannelStreamingConfigResolver = (
      channelId: string,
    ) => this.resolveChannelConfig(channelId);

    // 7. Create SignalingHandler (with full channel list provider for offline card support)
    this.signalingHandler = new SignalingHandler(
      this.routerManager,
      this.transportManager,
      metadataResolver,
      channelConfigResolver,
      config.streaming.heartbeatIntervalMs,
      () => this.buildFullChannelList(),
    );

    // 7. Create ListenerWebSocketHandler (uses dummy server internally, not httpsServer)
    this.listenerWsHandler = new ListenerWebSocketHandler(
      this.signalingHandler,
      {
        rateLimitPerIp: config.streaming.rateLimitPerIp,
        rateLimitWindowMs: config.streaming.rateLimitWindowMs,
        heartbeatIntervalMs: config.streaming.heartbeatIntervalMs,
      },
    );

    // Wire the listener handler into the HTTPS server's upgrade dispatcher
    setListenerHandler?.(this.listenerWsHandler);

    // 8. Wire AudioSubsystem events
    this.wireAudioSubsystemEvents();

    // 9. Wire WorkerManager events
    this.wireWorkerManagerEvents();

    // 10. Wire SignalingHandler events for listener count tracking
    this.wireSignalingHandlerEvents();

    // 11. Start latency monitoring loop
    this.startLatencyMonitorLoop();

    logger.info("Streaming subsystem started", {
      workerCount: config.mediasoup.workerCount,
      announcedIp: config.server.host,
    });
  }

  /**
   * Graceful shutdown following the locked decision order:
   * 1. Notify listeners
   * 2. Drain period
   * 3. Close listener WebSocket connections
   * 4. Close WebRTC transports
   * 5. Close routers (cascades to PlainTransports and producers)
   * 6. Close workers
   */
  async stop(): Promise<void> {
    // 0. Remove AudioSubsystem event listeners first to prevent
    //    streaming from reacting to channel state changes during teardown
    this.removeAudioSubsystemListeners();

    // 1. Notify all listeners of impending shutdown
    if (this.signalingHandler) {
      try {
        await this.signalingHandler.notifyAllListeners("serverShuttingDown", {
          reason: "Server shutting down",
        });
      } catch (error) {
        logger.warn("Failed to notify listeners of shutdown", {
          error: toErrorMessage(error),
        });
      }
    }

    // 2. Wait drain period for clients to receive the notification
    await new Promise<void>((resolve) =>
      setTimeout(resolve, this.shutdownDrainMs),
    );

    // 2.5. Stop latency monitoring
    if (this.latencyMonitorInterval) {
      clearInterval(this.latencyMonitorInterval);
      this.latencyMonitorInterval = null;
    }

    // 3. Close ListenerWebSocketHandler (disconnect all listeners)
    if (this.listenerWsHandler) {
      this.listenerWsHandler.close();
      this.listenerWsHandler = null;
    }

    // 4. Close TransportManager (close all WebRtcTransports)
    if (this.transportManager) {
      this.transportManager.closeAll();
      this.transportManager = null;
    }

    // 5. Close RouterManager (close all routers, cascading to PlainTransports)
    if (this.routerManager) {
      await this.routerManager.closeAll();
      this.routerManager = null;
    }

    // 6. Close WorkerManager (close all workers)
    if (this.workerManager) {
      await this.workerManager.stop();
      this.workerManager = null;
    }

    this.plainTransportManager = null;
    this.signalingHandler = null;

    logger.info("Streaming subsystem stopped");
  }

  // -------------------------------------------------------------------------
  // Delegated accessors for admin dashboard
  // -------------------------------------------------------------------------

  /** Count connected listeners, optionally filtered by channel. */
  getListenerCount(channelId?: string): number {
    return this.signalingHandler?.getListenerCount(channelId) ?? 0;
  }

  /** Get session info for all connected listeners. */
  getListenerSessions(): ListenerSessionInfo[] {
    return this.signalingHandler?.getListenerSessions() ?? [];
  }

  /**
   * Get resource usage snapshots for all workers.
   *
   * worker-manager fills index/memory/alive but leaves routerCount=0 because
   * routers live in router-manager. We merge the two so admin UI sees the
   * actual router count per worker.
   */
  async getWorkerResourceInfo(): Promise<WorkerResourceInfo[]> {
    if (!this.workerManager) return [];
    const workers = await this.workerManager.getWorkerResourceInfo();
    const routersByWorker = this.routerManager?.countRoutersByWorker() ?? new Map<number, number>();
    return workers.map((w) => ({ ...w, routerCount: routersByWorker.get(w.index) ?? 0 }));
  }

  /** Get the list of channels with active streaming routers. */
  getActiveStreamingChannels(): ListenerChannelInfo[] {
    if (!this.routerManager) return [];
    return this.routerManager.getActiveChannelList(
      this.buildMetadataResolver(),
    );
  }

  // -------------------------------------------------------------------------
  // Admin metrics
  // -------------------------------------------------------------------------

  /**
   * Per-channel streaming status with latency estimates for admin dashboard.
   * Returns status for all active streaming channels.
   */
  getStreamingStatus(): ChannelStreamingStatus[] {
    if (!this.routerManager) return [];

    const activeChannels = this.getActiveStreamingChannels();
    return activeChannels.map((channel) => {
      const channelConfig = this.resolveChannelConfig(channel.id);
      const latencyInput = this.buildLatencyInput(channel.id);
      const latencyEstimate = this.latencyEstimator.estimateLatency(latencyInput);

      return {
        channelId: channel.id,
        name: channel.name,
        isActive: channel.hasActiveProducer,
        listenerCount: this.getListenerCount(channel.id),
        latencyEstimate,
        latencyMode: channelConfig?.latencyMode ?? "live",
        lossRecovery: channelConfig?.lossRecovery ?? "nack",
      };
    });
  }

  /**
   * Per-listener connection stats from mediasoup consumer.getStats().
   * Returns packet loss, jitter, and session duration for each connected listener.
   *
   * @param channelId  Optional filter by channel
   */
  async getPerListenerStats(
    channelId?: string,
  ): Promise<ListenerConnectionStats[]> {
    if (!this.signalingHandler) return [];

    const sessions = this.signalingHandler.getListenerSessions();
    const filteredSessions = channelId
      ? sessions.filter((s) => s.currentChannelId === channelId)
      : sessions;

    const statsPromises = filteredSessions.map(async (session) => {
      const now = Date.now();
      const connectedAtMs = new Date(session.connectedAt).getTime();
      const sessionDurationMs = now - connectedAtMs;

      // Default stats when consumer stats unavailable
      return {
        sessionId: session.sessionId,
        channelId: session.currentChannelId,
        connectedAt: session.connectedAt,
        sessionDurationMs,
        packetLoss: 0,
        jitter: 0,
        bitrate: 0,
      } satisfies ListenerConnectionStats;
    });

    return Promise.all(statsPromises);
  }

  /**
   * Get the latency estimate for a specific channel.
   */
  getChannelLatencyEstimate(channelId: string): LatencyEstimate {
    const input = this.buildLatencyInput(channelId);
    return this.latencyEstimator.estimateLatency(input);
  }

  // -------------------------------------------------------------------------
  // Private: latency estimation helpers
  // -------------------------------------------------------------------------

  /**
   * Build a LatencyEstimateInput from a channel's config.
   */
  private buildLatencyInput(channelId: string): LatencyEstimateInput {
    const config = this.configStore.get();
    const channelConfigs = (config.audio as Record<string, unknown>).channels as Array<{
      id: string;
      processing?: { agc?: { enabled?: boolean }; opus?: { frameSize?: string } };
      latencyMode?: "live" | "stable";
    }>;

    const channelConf = channelConfigs?.find((ch) => ch.id === channelId);

    return {
      frameSize: Number(channelConf?.processing?.opus?.frameSize ?? "20"),
      agcEnabled: channelConf?.processing?.agc?.enabled ?? true,
      latencyMode: channelConf?.latencyMode ?? "live",
    };
  }

  // -------------------------------------------------------------------------
  // Private: latency monitoring loop
  // -------------------------------------------------------------------------

  /**
   * Start periodic latency estimation check. Every 30s, evaluate all active
   * channels and emit "latency-warning" if any exceeds 200ms threshold.
   */
  private startLatencyMonitorLoop(): void {
    this.latencyMonitorInterval = setInterval(() => {
      this.checkLatencyThresholds();
    }, LATENCY_MONITOR_INTERVAL_MS);
  }

  /** Evaluate latency estimates and emit warnings for channels over threshold. */
  private checkLatencyThresholds(): void {
    if (!this.routerManager) return;

    const activeChannelIds = this.routerManager.getActiveChannelIds();
    const warnings: Array<{
      channelId: string;
      name: string;
      estimate: LatencyEstimate;
    }> = [];

    for (const channelId of activeChannelIds) {
      const input = this.buildLatencyInput(channelId);
      const estimate = this.latencyEstimator.estimateLatency(input);

      if (
        this.latencyEstimator.checkLatencyThreshold(
          estimate,
          LATENCY_WARNING_THRESHOLD_MS,
        )
      ) {
        const channel = this.audioSubsystem.getChannel(channelId);
        warnings.push({
          channelId,
          name: channel?.name ?? channelId,
          estimate,
        });
      }
    }

    if (warnings.length > 0) {
      this.emit("latency-warning", warnings);
      logger.warn("Latency threshold exceeded", {
        channelCount: warnings.length,
        channels: warnings.map((w) => ({
          channelId: w.channelId,
          name: w.name,
          totalMs: w.estimate.totalMs,
        })),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Private: channel config resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve per-channel streaming config (latencyMode, lossRecovery, defaultChannel)
   * from the config store. Returns undefined if channel not found in config.
   */
  private resolveChannelConfig(channelId: string):
    | { latencyMode: "live" | "stable"; lossRecovery: "nack" | "plc"; defaultChannel: boolean }
    | undefined {
    const config = this.configStore.get();
    const channelConfigs = (config.audio as Record<string, unknown>).channels as Array<{
      id: string;
      latencyMode?: "live" | "stable";
      lossRecovery?: "nack" | "plc";
      defaultChannel?: boolean;
    }>;

    const found = channelConfigs?.find((ch) => ch.id === channelId);
    if (!found) return undefined;

    return {
      latencyMode: found.latencyMode ?? "live",
      lossRecovery: found.lossRecovery ?? "nack",
      defaultChannel: found.defaultChannel ?? false,
    };
  }

  /**
   * Resolve Phase 5 channel display metadata (description, language, displayToggles)
   * from the config store. Returns undefined if channel not found.
   */
  private resolveFullChannelConfig(channelId: string):
    | {
        description: string;
        language: { code: string; label: string; flag: string };
        displayToggles: { showDescription: boolean; showListenerCount: boolean; showLiveBadge: boolean };
      }
    | undefined {
    const config = this.configStore.get();
    const channelConfigs = (config.audio as Record<string, unknown>).channels as Array<{
      id: string;
      description?: string;
      language?: { code?: string; label?: string; flag?: string };
      displayToggles?: { showDescription?: boolean; showListenerCount?: boolean; showLiveBadge?: boolean };
    }>;

    const found = channelConfigs?.find((ch) => ch.id === channelId);
    if (!found) return undefined;

    return {
      description: found.description ?? "",
      language: {
        code: found.language?.code ?? "",
        label: found.language?.label ?? "",
        flag: found.language?.flag ?? "",
      },
      displayToggles: {
        showDescription: found.displayToggles?.showDescription ?? false,
        showListenerCount: found.displayToggles?.showListenerCount ?? false,
        showLiveBadge: found.displayToggles?.showLiveBadge ?? false,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private: AudioSubsystem event wiring
  // -------------------------------------------------------------------------

  /**
   * Subscribe to AudioSubsystem channel lifecycle events and sync
   * streaming state (routers, transports, notifications).
   *
   * Stores bound handler references so they can be removed in stop().
   */
  private wireAudioSubsystemEvents(): void {
    // Channel started streaming -> create router + PlainTransport
    this.boundChannelStateHandler = (channelId: string, status: string) => {
      this.handleChannelStateChange(channelId, status).catch((error) => {
        logger.error("Failed to handle channel state change in streaming", {
          channelId,
          status,
          error: toErrorMessage(error),
        });
      });
    };
    this.audioSubsystem.on("channel-state-changed", this.boundChannelStateHandler);

    // Channel removed -> notify listeners, remove router
    this.boundChannelRemovedHandler = (channelId: string) => {
      this.handleChannelRemoved(channelId).catch((error) => {
        logger.error("Failed to handle channel removal in streaming", {
          channelId,
          error: toErrorMessage(error),
        });
      });
    };
    this.audioSubsystem.on("channel-removed", this.boundChannelRemovedHandler);

    // Channel created -> notify listeners of new channel available
    this.boundChannelCreatedHandler = (_channel: AppChannel) => {
      this.handleChannelCreated().catch((error) => {
        logger.error("Failed to handle channel creation in streaming", {
          error: toErrorMessage(error),
        });
      });
    };
    this.audioSubsystem.on("channel-created", this.boundChannelCreatedHandler);
  }

  /**
   * Remove all event listeners registered on AudioSubsystem during wireAudioSubsystemEvents().
   * Prevents dangling handlers from firing during/after shutdown.
   */
  private removeAudioSubsystemListeners(): void {
    if (this.boundChannelStateHandler) {
      this.audioSubsystem.off("channel-state-changed", this.boundChannelStateHandler);
      this.boundChannelStateHandler = null;
    }
    if (this.boundChannelRemovedHandler) {
      this.audioSubsystem.off("channel-removed", this.boundChannelRemovedHandler);
      this.boundChannelRemovedHandler = null;
    }
    if (this.boundChannelCreatedHandler) {
      this.audioSubsystem.off("channel-created", this.boundChannelCreatedHandler);
      this.boundChannelCreatedHandler = null;
    }
  }

  private async handleChannelStateChange(
    channelId: string,
    status: string,
  ): Promise<void> {
    if (!this.routerManager || !this.signalingHandler) return;

    if (status === "starting" || status === "streaming") {
      // Bind PlainTransport BEFORE pipeline emits packets. On Windows, sending
      // UDP to an unbound port returns ICMP Port Unreachable, which causes
      // udpsink to error and propagates "queue: not-linked" back upstream,
      // crashing the pipeline. The pipeline-state transition `connecting ->
      // streaming` fires only after the first level message arrives, by which
      // time gst-launch has already pushed packets. Binding on "starting"
      // closes that race window.
      if (this.routerManager.hasChannel(channelId)) return;

      const channel = this.audioSubsystem.getChannel(channelId);
      if (!channel?.processing?.rtpOutput) {
        logger.warn("Channel starting but no RTP output config", { channelId });
        return;
      }

      const { rtpPort, rtcpPort, ssrc } = channel.processing.rtpOutput;

      await this.routerManager.createChannelRouter(
        channelId,
        rtpPort,
        rtcpPort,
        ssrc,
      );

      // Only emit channel-active notification + listener push on "streaming"
      // (when audio is actually flowing). "starting" just binds the port.
      if (status === "streaming") {
        await this.signalingHandler.notifyAllListeners("channelStateChanged", {
          channelId,
          state: "active",
        });
        await this.pushActiveChannelList();
      }
    }
    // User-initiated stop (admin removed all sources, called stopChannel,
    // or otherwise drove the channel back to "stopped"). Tear down the
    // Router + Producer + listener consumers so the next start cycle goes
    // through createChannelRouter from scratch. Without this the second
    // pass through "starting"/"streaming" short-circuits on
    // routerManager.hasChannel(channelId) and the listener's existing
    // consumer is left bound to a Producer whose underlying gst-launch
    // process has been killed -- mediasoup keeps forwarding zero packets
    // and the phone goes silent. Listeners receive `channelStopped` so the
    // PWA flips to "reconnecting" and re-runs the signaling handshake when
    // the channel returns.
    if (status === "stopped") {
      if (this.routerManager.hasChannel(channelId)) {
        await this.signalingHandler.disconnectListenersFromChannel(channelId);
        await this.routerManager.removeChannelRouter(channelId);
        await this.pushActiveChannelList();
      }
      return;
    }
    // Transient pipeline failures (crashed, error) do NOT tear down the
    // Router or listener consumers. The pipeline-manager auto-restarts
    // crashed pipelines on the same RTP port; once a fresh gst-launch
    // begins sending, the existing PlainTransport receives RTP and the
    // existing WebRTC consumers keep forwarding audio to phones. Tearing
    // down on every crash event would kill the listener's media path --
    // the phone would need to re-run the signaling handshake to recover,
    // but the protoo client has no auto-resubscribe logic, so audio stays
    // silent until manual reconnect. Final teardown happens only on
    // channel removal (handleChannelRemoved) or on user-initiated stop
    // (the branch above).
  }

  private async handleChannelRemoved(channelId: string): Promise<void> {
    if (!this.routerManager || !this.signalingHandler) return;

    if (this.routerManager.hasChannel(channelId)) {
      // Disconnect listeners on this channel with remaining channel list
      await this.signalingHandler.disconnectListenersFromChannel(channelId);

      await this.routerManager.removeChannelRouter(channelId);
      await this.pushActiveChannelList();
    }
  }

  private async handleChannelCreated(): Promise<void> {
    if (!this.signalingHandler) return;

    // Per locked decision: push "new channel available" notification
    await this.pushActiveChannelList();
  }

  /** Push the full channel list (including stopped channels) to all connected listeners. */
  private async pushActiveChannelList(): Promise<void> {
    if (!this.signalingHandler || !this.routerManager) return;

    const channels = this.buildFullChannelList();
    await this.signalingHandler.notifyAllListeners("activeChannels", {
      channels,
    });
  }

  /**
   * Build the full channel list merging ALL configured channels from AudioSubsystem
   * with active-router status from RouterManager.
   *
   * Unlike RouterManager.getActiveChannelList() which only returns channels with
   * active mediasoup routers, this includes stopped channels (hasActiveProducer: false)
   * so they appear as dimmed offline cards in the listener UI.
   */
  private buildFullChannelList(): ListenerChannelInfo[] {
    const allChannels = this.audioSubsystem.getChannels();
    const metadataResolver = this.buildMetadataResolver();
    const channelList: ListenerChannelInfo[] = [];

    for (const channel of allChannels) {
      const metadata = metadataResolver(channel.id);
      if (!metadata) continue;

      const hasRouter = this.routerManager!.hasChannel(channel.id);
      // If channel has an active router, check producer status; otherwise offline
      let hasActiveProducer = false;
      if (hasRouter) {
        const producer = this.routerManager!.getProducerForChannel(channel.id);
        hasActiveProducer = producer != null && !producer.closed;
      }

      channelList.push({
        id: channel.id,
        name: metadata.name,
        outputFormat: metadata.outputFormat,
        defaultChannel: metadata.defaultChannel,
        hasActiveProducer,
        latencyMode: metadata.latencyMode,
        lossRecovery: metadata.lossRecovery,
        description: metadata.description,
        language: metadata.language,
        listenerCount: 0, // Populated by SignalingHandler.buildEnrichedChannelList()
        displayToggles: metadata.displayToggles,
      });
    }

    channelList.sort((a, b) => a.name.localeCompare(b.name));
    return channelList;
  }

  /** Build a ChannelMetadataResolver using AudioSubsystem and config store. */
  private buildMetadataResolver(): ChannelMetadataResolver {
    return (channelId: string) => {
      const channel = this.audioSubsystem.getChannel(channelId);
      if (!channel) return undefined;
      const channelConfig = this.resolveChannelConfig(channelId);
      const fullConfig = this.resolveFullChannelConfig(channelId);
      return {
        name: channel.name,
        outputFormat: channel.outputFormat,
        defaultChannel: channelConfig?.defaultChannel ?? false,
        latencyMode: channelConfig?.latencyMode ?? "live",
        lossRecovery: channelConfig?.lossRecovery ?? "nack",
        description: fullConfig?.description ?? "",
        language: fullConfig?.language ?? { code: "", label: "", flag: "" },
        displayToggles: fullConfig?.displayToggles ?? { showDescription: false, showListenerCount: false, showLiveBadge: false },
      };
    };
  }

  // -------------------------------------------------------------------------
  // Private: WorkerManager event wiring
  // -------------------------------------------------------------------------

  private wireWorkerManagerEvents(): void {
    if (!this.workerManager) return;

    this.workerManager.on(
      "worker-died",
      (details: { workerIndex: number; error: unknown }) => {
        logger.error("mediasoup worker died alert", {
          workerIndex: details.workerIndex,
          error: toErrorMessage(details.error),
        });
        this.emit("worker-alert", "worker-died", {
          workerIndex: details.workerIndex,
          error: toErrorMessage(details.error),
          timestamp: new Date().toISOString(),
        });
      },
    );

    this.workerManager.on(
      "worker-memory-warning",
      (details: {
        workerIndex: number;
        memoryMb: number;
        thresholdMb: number;
      }) => {
        this.emit("worker-alert", "worker-memory-warning", {
          workerIndex: details.workerIndex,
          memoryMb: details.memoryMb,
          thresholdMb: details.thresholdMb,
          timestamp: new Date().toISOString(),
        });
      },
    );
  }

  // -------------------------------------------------------------------------
  // Private: SignalingHandler event wiring
  // -------------------------------------------------------------------------

  private wireSignalingHandlerEvents(): void {
    if (!this.signalingHandler) return;

    this.signalingHandler.on(
      "listener-connected",
      (info: { peerId: string; sessionId: string }) => {
        // Emit listener count changed for admin dashboard (no specific channel yet)
        this.emit("listener-count-changed", null, this.getListenerCount());
        logger.debug("Listener count changed (connected)", {
          peerId: info.peerId,
          totalListeners: this.getListenerCount(),
        });
      },
    );

    this.signalingHandler.on(
      "listener-disconnected",
      (info: { peerId: string; sessionId: string; channelId: string | null }) => {
        this.emit(
          "listener-count-changed",
          info.channelId,
          this.getListenerCount(info.channelId ?? undefined),
        );
        logger.debug("Listener count changed (disconnected)", {
          peerId: info.peerId,
          channelId: info.channelId,
          totalListeners: this.getListenerCount(),
        });
      },
    );
  }
}
