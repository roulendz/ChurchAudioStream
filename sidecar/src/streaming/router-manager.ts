/**
 * Per-channel mediasoup Router lifecycle management.
 *
 * Each audio channel gets its own Router for isolation. The RouterManager
 * coordinates with WorkerManager (to get workers) and PlainTransportManager
 * (to create PlainTransports and Producers for GStreamer RTP ingestion).
 *
 * Events emitted:
 * - "channel-streaming-started"   { channelId }
 * - "channel-streaming-stopped"   { channelId }
 * - "channel-streaming-restored"  { channelId }
 */

import { EventEmitter } from "node:events";
import type { types as mediasoupTypes } from "mediasoup";
import type {
  ChannelStreamingState,
  ListenerChannelInfo,
} from "./streaming-types.js";
import { OPUS_RTP_CODEC } from "./streaming-types.js";
import type { WorkerManager } from "./worker-manager.js";
import type { PlainTransportManager } from "./plain-transport-manager.js";
import { logger } from "../utils/logger.js";
import { toErrorMessage } from "../utils/error-message.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Metadata resolver callback. RouterManager does not depend on ChannelManager
 * directly -- the caller provides a function to look up display metadata.
 */
export type ChannelMetadataResolver = (channelId: string) =>
  | {
      name: string;
      outputFormat: "mono" | "stereo";
      defaultChannel: boolean;
    }
  | undefined;

/**
 * Internal record tracking a channel's router and the worker it lives on,
 * along with the PlainTransport and Producer references.
 */
interface ChannelRouterEntry {
  readonly channelId: string;
  readonly workerIndex: number;
  readonly router: mediasoupTypes.Router;
  readonly plainTransport: mediasoupTypes.PlainTransport;
  readonly audioProducer: mediasoupTypes.Producer;
  /** RTP port used for this channel (needed for restart recovery). */
  readonly rtpPort: number;
  /** RTCP port used for this channel (needed for restart recovery). */
  readonly rtcpPort: number;
  /** SSRC used for this channel (needed for restart recovery). */
  readonly ssrc: number;
}

// ---------------------------------------------------------------------------
// RouterManager
// ---------------------------------------------------------------------------

export class RouterManager extends EventEmitter {
  private readonly workerManager: WorkerManager;
  private readonly plainTransportManager: PlainTransportManager;
  private readonly channels: Map<string, ChannelRouterEntry> = new Map();

  constructor(
    workerManager: WorkerManager,
    plainTransportManager: PlainTransportManager,
  ) {
    super();
    this.workerManager = workerManager;
    this.plainTransportManager = plainTransportManager;

    // Wire worker restart recovery
    this.workerManager.on("worker-restarted", ({ workerIndex }) => {
      this.handleWorkerRestart(workerIndex).catch((error) => {
        logger.error("Failed to recover channels after worker restart", {
          workerIndex,
          error: toErrorMessage(error),
        });
      });
    });
  }

  // -----------------------------------------------------------------------
  // Channel Router lifecycle
  // -----------------------------------------------------------------------

  /**
   * Create a Router, PlainTransport, and Producer for a channel.
   *
   * @param channelId  Channel UUID
   * @param rtpPort    Dedicated RTP port from port-allocator
   * @param rtcpPort   Dedicated RTCP port from port-allocator
   * @param ssrc       Deterministic SSRC from generateSsrc(channelId)
   */
  async createChannelRouter(
    channelId: string,
    rtpPort: number,
    rtcpPort: number,
    ssrc: number,
  ): Promise<ChannelStreamingState> {
    // Prevent duplicate creation
    if (this.channels.has(channelId)) {
      logger.warn("Channel router already exists, removing old one first", {
        channelId,
      });
      await this.removeChannelRouter(channelId);
    }

    const worker = this.workerManager.getWorkerForChannel(channelId);
    const workerIndex = this.workerManager.getWorkerIndexForChannel(channelId);

    // Create Router with Opus codec capability
    const router = await worker.createRouter({
      mediaCodecs: [OPUS_RTP_CODEC],
    });

    // Register cleanup on worker close (worker died or was explicitly closed)
    router.on("workerclose", () => {
      logger.warn("Router closed due to worker close", { channelId });
      this.channels.delete(channelId);
    });

    // Delegate PlainTransport + Producer creation
    const { plainTransport, audioProducer } =
      await this.plainTransportManager.createForChannel(
        router,
        channelId,
        rtpPort,
        rtcpPort,
        ssrc,
      );

    const entry: ChannelRouterEntry = {
      channelId,
      workerIndex,
      router,
      plainTransport,
      audioProducer,
      rtpPort,
      rtcpPort,
      ssrc,
    };

    this.channels.set(channelId, entry);

    this.emit("channel-streaming-started", { channelId });
    logger.info("Channel router created", {
      channelId,
      workerIndex,
      rtpPort,
      rtcpPort,
      ssrc,
    });

    return {
      channelId,
      router,
      plainTransport,
      audioProducer,
    };
  }

  /**
   * Remove a channel's Router. Closing the Router cascades to all its
   * transports, producers, and consumers.
   */
  async removeChannelRouter(channelId: string): Promise<void> {
    const entry = this.channels.get(channelId);
    if (!entry) {
      return;
    }

    entry.router.close();
    this.channels.delete(channelId);

    this.emit("channel-streaming-stopped", { channelId });
    logger.info("Channel router removed", { channelId });
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /**
   * Get the Router for a specific channel.
   */
  getRouterForChannel(channelId: string): mediasoupTypes.Router | undefined {
    return this.channels.get(channelId)?.router;
  }

  /**
   * Get the audio Producer for a specific channel.
   */
  getProducerForChannel(
    channelId: string,
  ): mediasoupTypes.Producer | undefined {
    return this.channels.get(channelId)?.audioProducer;
  }

  /**
   * Return all channel IDs that have active producers.
   */
  getActiveChannelIds(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Build the channel list pushed to listeners.
   * The metadataResolver provides display info (name, format, default)
   * without creating a dependency on ChannelManager.
   */
  getActiveChannelList(
    metadataResolver: ChannelMetadataResolver,
  ): ListenerChannelInfo[] {
    const channelList: ListenerChannelInfo[] = [];

    for (const [channelId, entry] of this.channels) {
      const metadata = metadataResolver(channelId);
      if (!metadata) {
        continue; // Channel config no longer exists
      }

      channelList.push({
        id: channelId,
        name: metadata.name,
        outputFormat: metadata.outputFormat,
        defaultChannel: metadata.defaultChannel,
        hasActiveProducer: !entry.audioProducer.closed,
      });
    }

    // Alphabetical ordering per context decision
    channelList.sort((a, b) => a.name.localeCompare(b.name));
    return channelList;
  }

  /**
   * Check if a channel has an active streaming state.
   */
  hasChannel(channelId: string): boolean {
    return this.channels.has(channelId);
  }

  /**
   * Get the full streaming state for a channel (used by streaming subsystem).
   */
  getChannelStreamingState(
    channelId: string,
  ): ChannelStreamingState | undefined {
    const entry = this.channels.get(channelId);
    if (!entry) {
      return undefined;
    }
    return {
      channelId: entry.channelId,
      router: entry.router,
      plainTransport: entry.plainTransport,
      audioProducer: entry.audioProducer,
    };
  }

  // -----------------------------------------------------------------------
  // Worker restart recovery
  // -----------------------------------------------------------------------

  /**
   * Recreate routers, transports, and producers for all channels that
   * were on a crashed/restarted worker.
   */
  private async handleWorkerRestart(workerIndex: number): Promise<void> {
    const affectedChannels: ChannelRouterEntry[] = [];

    for (const entry of this.channels.values()) {
      if (entry.workerIndex === workerIndex) {
        affectedChannels.push(entry);
      }
    }

    if (affectedChannels.length === 0) {
      return;
    }

    logger.info("Recovering channels after worker restart", {
      workerIndex,
      channelCount: affectedChannels.length,
      channelIds: affectedChannels.map((e) => e.channelId),
    });

    for (const oldEntry of affectedChannels) {
      // Remove stale entry (router is already closed from worker death)
      this.channels.delete(oldEntry.channelId);

      try {
        // Recreate on the new worker at the same index
        await this.createChannelRouter(
          oldEntry.channelId,
          oldEntry.rtpPort,
          oldEntry.rtcpPort,
          oldEntry.ssrc,
        );

        this.emit("channel-streaming-restored", {
          channelId: oldEntry.channelId,
        });
        logger.info("Channel streaming restored after worker restart", {
          channelId: oldEntry.channelId,
          workerIndex,
        });
      } catch (error) {
        logger.error("Failed to restore channel after worker restart", {
          channelId: oldEntry.channelId,
          workerIndex,
          error: toErrorMessage(error),
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Close all routers and clear tracking state.
   */
  async closeAll(): Promise<void> {
    for (const entry of this.channels.values()) {
      entry.router.close();
    }
    this.channels.clear();
    logger.info("All channel routers closed");
  }
}
