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
} from "./streaming-types.js";
import type { ChannelMetadataResolver } from "./router-manager.js";
import { WorkerManager } from "./worker-manager.js";
import { PlainTransportManager } from "./plain-transport-manager.js";
import { RouterManager } from "./router-manager.js";
import { TransportManager } from "./transport-manager.js";
import { SignalingHandler } from "./signaling-handler.js";
import { ListenerWebSocketHandler } from "../ws/listener-handler.js";
import { logger } from "../utils/logger.js";
import { toErrorMessage } from "../utils/error-message.js";

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

  private shutdownDrainMs: number = 5000;

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
   * @param httpsServer  The HTTPS server for listener WebSocket connections
   */
  async start(httpsServer: HttpsServer): Promise<void> {
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
    const metadataResolver: ChannelMetadataResolver = (channelId: string) => {
      const channel = this.audioSubsystem.getChannel(channelId);
      if (!channel) return undefined;
      return {
        name: channel.name,
        outputFormat: channel.outputFormat,
        defaultChannel: false, // Phase 6 adds admin-set default channel
      };
    };

    // 6. Create SignalingHandler
    this.signalingHandler = new SignalingHandler(
      this.routerManager,
      this.transportManager,
      metadataResolver,
      config.streaming.heartbeatIntervalMs,
    );

    // 7. Create ListenerWebSocketHandler
    this.listenerWsHandler = new ListenerWebSocketHandler(
      httpsServer,
      this.signalingHandler,
      {
        rateLimitPerIp: config.streaming.rateLimitPerIp,
        rateLimitWindowMs: config.streaming.rateLimitWindowMs,
        heartbeatIntervalMs: config.streaming.heartbeatIntervalMs,
      },
    );

    // 8. Wire AudioSubsystem events
    this.wireAudioSubsystemEvents();

    // 9. Wire WorkerManager events
    this.wireWorkerManagerEvents();

    // 10. Wire SignalingHandler events for listener count tracking
    this.wireSignalingHandlerEvents();

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

  /** Get resource usage snapshots for all workers. */
  async getWorkerResourceInfo(): Promise<WorkerResourceInfo[]> {
    return this.workerManager?.getWorkerResourceInfo() ?? [];
  }

  /** Get the list of channels with active streaming routers. */
  getActiveStreamingChannels(): ListenerChannelInfo[] {
    if (!this.routerManager) return [];
    const metadataResolver: ChannelMetadataResolver = (channelId: string) => {
      const channel = this.audioSubsystem.getChannel(channelId);
      if (!channel) return undefined;
      return {
        name: channel.name,
        outputFormat: channel.outputFormat,
        defaultChannel: false,
      };
    };
    return this.routerManager.getActiveChannelList(metadataResolver);
  }

  // -------------------------------------------------------------------------
  // Private: AudioSubsystem event wiring
  // -------------------------------------------------------------------------

  /**
   * Subscribe to AudioSubsystem channel lifecycle events and sync
   * streaming state (routers, transports, notifications).
   */
  private wireAudioSubsystemEvents(): void {
    // Channel started streaming -> create router + PlainTransport
    this.audioSubsystem.on(
      "channel-state-changed",
      (channelId: string, status: string) => {
        this.handleChannelStateChange(channelId, status).catch((error) => {
          logger.error("Failed to handle channel state change in streaming", {
            channelId,
            status,
            error: toErrorMessage(error),
          });
        });
      },
    );

    // Channel removed -> notify listeners, remove router
    this.audioSubsystem.on("channel-removed", (channelId: string) => {
      this.handleChannelRemoved(channelId).catch((error) => {
        logger.error("Failed to handle channel removal in streaming", {
          channelId,
          error: toErrorMessage(error),
        });
      });
    });

    // Channel created -> notify listeners of new channel available
    this.audioSubsystem.on("channel-created", (_channel: AppChannel) => {
      this.handleChannelCreated().catch((error) => {
        logger.error("Failed to handle channel creation in streaming", {
          error: toErrorMessage(error),
        });
      });
    });
  }

  private async handleChannelStateChange(
    channelId: string,
    status: string,
  ): Promise<void> {
    if (!this.routerManager || !this.signalingHandler) return;

    if (status === "streaming") {
      // Only create router if not already active
      if (this.routerManager.hasChannel(channelId)) return;

      const channel = this.audioSubsystem.getChannel(channelId);
      if (!channel?.processing?.rtpOutput) {
        logger.warn("Channel streaming but no RTP output config", { channelId });
        return;
      }

      const { rtpPort, rtcpPort, ssrc } = channel.processing.rtpOutput;

      await this.routerManager.createChannelRouter(
        channelId,
        rtpPort,
        rtcpPort,
        ssrc,
      );

      // Notify all listeners of channel state change
      await this.signalingHandler.notifyAllListeners("channelStateChanged", {
        channelId,
        state: "active",
      });

      // Push updated channel list to all listeners
      await this.pushActiveChannelList();
    } else if (
      status === "stopped" ||
      status === "error" ||
      status === "crashed"
    ) {
      if (!this.routerManager.hasChannel(channelId)) return;

      // Notify listeners on this channel that their consumer is closing
      await this.signalingHandler.notifyListenersOnChannel(
        channelId,
        "consumerClosed",
        { reason: "channel-stopped" },
      );

      // Push updated channel list (before removing router)
      await this.routerManager.removeChannelRouter(channelId);

      // Notify all listeners of updated channel list
      await this.pushActiveChannelList();
    }
  }

  private async handleChannelRemoved(channelId: string): Promise<void> {
    if (!this.routerManager || !this.signalingHandler) return;

    if (this.routerManager.hasChannel(channelId)) {
      await this.signalingHandler.notifyListenersOnChannel(
        channelId,
        "consumerClosed",
        { reason: "channel-stopped" },
      );

      await this.routerManager.removeChannelRouter(channelId);
      await this.pushActiveChannelList();
    }
  }

  private async handleChannelCreated(): Promise<void> {
    if (!this.signalingHandler) return;

    // Per locked decision: push "new channel available" notification
    await this.pushActiveChannelList();
  }

  /** Push the current active channel list to all connected listeners. */
  private async pushActiveChannelList(): Promise<void> {
    if (!this.signalingHandler || !this.routerManager) return;

    const metadataResolver: ChannelMetadataResolver = (channelId: string) => {
      const channel = this.audioSubsystem.getChannel(channelId);
      if (!channel) return undefined;
      return {
        name: channel.name,
        outputFormat: channel.outputFormat,
        defaultChannel: false,
      };
    };

    const channels = this.routerManager.getActiveChannelList(metadataResolver);
    await this.signalingHandler.notifyAllListeners("activeChannels", {
      channels,
    });
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
