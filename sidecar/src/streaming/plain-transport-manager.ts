/**
 * PlainTransport lifecycle management for GStreamer RTP ingestion.
 *
 * Creates PlainTransports with comedia mode on each channel's dedicated
 * UDP port pair. Transports persist across GStreamer pipeline restarts --
 * the transport listens on a fixed port and comedia auto-detects the new
 * source when GStreamer resumes sending RTP.
 */

import type { types as mediasoupTypes } from "mediasoup";
import { buildOpusRtpParameters } from "./streaming-types.js";
import { logger } from "../utils/logger.js";
import { toErrorMessage } from "../utils/error-message.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of creating a PlainTransport + Producer pair for a channel. */
export interface PlainTransportPair {
  readonly plainTransport: mediasoupTypes.PlainTransport;
  readonly audioProducer: mediasoupTypes.Producer;
}

/** Stats snapshot from a channel's PlainTransport. */
export interface PlainTransportStats {
  readonly channelId: string;
  readonly bytesReceived: number;
  readonly rtpBytesReceived: number;
  readonly rtxBytesReceived: number;
  readonly recvBitrate: number;
  readonly rtpRecvBitrate: number;
  readonly rtpPacketLossReceived: number;
  readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// PlainTransportManager
// ---------------------------------------------------------------------------

export class PlainTransportManager {
  private readonly transports: Map<
    string,
    {
      plainTransport: mediasoupTypes.PlainTransport;
      audioProducer: mediasoupTypes.Producer;
    }
  > = new Map();

  // -----------------------------------------------------------------------
  // Transport creation
  // -----------------------------------------------------------------------

  /**
   * Create a PlainTransport and audio Producer on the given router.
   *
   * KEY DESIGN: The PlainTransport persists across GStreamer restarts.
   * - Transport listens on a fixed port (from port-allocator)
   * - comedia: true auto-detects new GStreamer source from first RTP packet
   * - No transport recreation needed when GStreamer process restarts
   *
   * @param router     The channel's mediasoup Router
   * @param channelId  Channel UUID (for tracking)
   * @param rtpPort    RTP port from port-allocator
   * @param rtcpPort   RTCP port from port-allocator
   * @param ssrc       Deterministic SSRC from generateSsrc(channelId)
   */
  async createForChannel(
    router: mediasoupTypes.Router,
    channelId: string,
    rtpPort: number,
    rtcpPort: number,
    ssrc: number,
  ): Promise<PlainTransportPair> {
    // Create PlainTransport listening on the channel's dedicated ports
    const plainTransport = await router.createPlainTransport({
      listenInfo: {
        protocol: "udp",
        ip: "127.0.0.1",
        port: rtpPort,
      },
      rtcpListenInfo: {
        protocol: "udp",
        ip: "127.0.0.1",
        port: rtcpPort,
      },
      rtcpMux: false, // Separate RTP/RTCP ports (matches Phase 3 pipeline builder)
      comedia: true, // Auto-detect GStreamer source address from first packet
    });

    // Register cleanup on router close (cascades from worker death)
    plainTransport.on("routerclose", () => {
      logger.info("PlainTransport closed due to router close", { channelId });
      this.transports.delete(channelId);
    });

    // Create Producer with matching SSRC from generateSsrc(channelId)
    const audioProducer = await plainTransport.produce({
      kind: "audio",
      rtpParameters: buildOpusRtpParameters(ssrc),
    });

    // Register cleanup on transport close
    audioProducer.on("transportclose", () => {
      logger.info("Producer closed due to transport close", { channelId });
    });

    this.transports.set(channelId, { plainTransport, audioProducer });

    logger.info("PlainTransport and Producer created for channel", {
      channelId,
      rtpPort,
      rtcpPort,
      ssrc,
      transportId: plainTransport.id,
      producerId: audioProducer.id,
    });

    return { plainTransport, audioProducer };
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  /**
   * Get transport stats for a channel. Used for latency monitoring
   * and admin dashboard display.
   */
  async getTransportStats(
    channelId: string,
  ): Promise<PlainTransportStats | undefined> {
    const entry = this.transports.get(channelId);
    if (!entry) {
      return undefined;
    }

    try {
      const stats = await entry.plainTransport.getStats();
      // PlainTransport stats return an array; take the first entry
      const stat = stats[0];
      if (!stat) {
        return undefined;
      }

      return {
        channelId,
        bytesReceived: stat.bytesReceived,
        rtpBytesReceived: stat.rtpBytesReceived,
        rtxBytesReceived: stat.rtxBytesReceived,
        recvBitrate: stat.recvBitrate,
        rtpRecvBitrate: stat.rtpRecvBitrate,
        rtpPacketLossReceived: stat.rtpPacketLossReceived ?? 0,
        timestamp: stat.timestamp,
      };
    } catch (error) {
      logger.warn("Failed to get PlainTransport stats", {
        channelId,
        error: toErrorMessage(error),
      });
      return undefined;
    }
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /**
   * Check if a transport exists for a channel.
   */
  hasTransport(channelId: string): boolean {
    return this.transports.has(channelId);
  }

  /**
   * Remove tracking entry for a channel (called when router closes transport).
   */
  removeChannel(channelId: string): void {
    this.transports.delete(channelId);
  }
}
