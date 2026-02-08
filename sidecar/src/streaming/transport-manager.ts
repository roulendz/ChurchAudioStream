/**
 * WebRtcTransport lifecycle management for listeners.
 *
 * Creates on-demand WebRtcTransports per listener with the server's LAN IP
 * as the announced ICE candidate address. UDP-only for lowest latency on
 * local WiFi (no TURN server). Provides transport connection, stats, and
 * cleanup with proper event-driven resource management.
 */

import type { types as mediasoupTypes } from "mediasoup";
import { logger } from "../utils/logger.js";
import { toErrorMessage } from "../utils/error-message.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Audio-only bitrate ceiling: 128 kbps Opus is sufficient. */
const INITIAL_AVAILABLE_OUTGOING_BITRATE = 128_000;

/** ICE consent timeout in seconds before transport is considered dead. */
const ICE_CONSENT_TIMEOUT_SECONDS = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Transport creation result returned to the signaling layer. */
export interface WebRtcTransportInfo {
  readonly id: string;
  readonly iceParameters: mediasoupTypes.IceParameters;
  readonly iceCandidates: mediasoupTypes.IceCandidate[];
  readonly dtlsParameters: mediasoupTypes.DtlsParameters;
}

// ---------------------------------------------------------------------------
// TransportManager
// ---------------------------------------------------------------------------

export class TransportManager {
  private readonly announcedIpAddress: string;
  private readonly transports: Map<string, mediasoupTypes.WebRtcTransport> =
    new Map();

  /**
   * @param announcedIpAddress  LAN IP from config.server.host, used as
   *                            the ICE candidate announced address so phone
   *                            browsers can reach the server on the local network.
   */
  constructor(announcedIpAddress: string) {
    this.announcedIpAddress = announcedIpAddress;
  }

  // -----------------------------------------------------------------------
  // Transport lifecycle
  // -----------------------------------------------------------------------

  /**
   * Create a WebRtcTransport for a listener on the given channel router.
   *
   * The transport listens on 0.0.0.0 (all interfaces) but announces the
   * server's LAN IP so ICE candidates resolve to the correct address.
   * UDP-only for lowest latency on local WiFi (no TURN server needed).
   *
   * @param router  The channel's mediasoup Router
   * @param peerId  Unique peer identifier (for tracking)
   * @returns Transport info for the signaling response
   */
  async createForListener(
    router: mediasoupTypes.Router,
    peerId: string,
  ): Promise<WebRtcTransportInfo> {
    const transport = await router.createWebRtcTransport({
      listenInfos: [
        {
          protocol: "udp",
          ip: "0.0.0.0",
          announcedAddress: this.announcedIpAddress,
        },
      ],
      enableUdp: true,
      enableTcp: false, // UDP-only for lowest latency on local WiFi
      preferUdp: true,
      initialAvailableOutgoingBitrate: INITIAL_AVAILABLE_OUTGOING_BITRATE,
      iceConsentTimeout: ICE_CONSENT_TIMEOUT_SECONDS,
    });

    this.registerTransportEventHandlers(transport, peerId);
    this.transports.set(peerId, transport);

    logger.info("WebRtcTransport created for listener", {
      peerId,
      transportId: transport.id,
      announcedIp: this.announcedIpAddress,
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  /**
   * Complete the DTLS handshake for a listener's transport.
   *
   * @param peerId          Peer identifier
   * @param dtlsParameters  Client-side DTLS parameters from the signaling message
   */
  async connectTransport(
    peerId: string,
    dtlsParameters: mediasoupTypes.DtlsParameters,
  ): Promise<void> {
    const transport = this.transports.get(peerId);
    if (!transport) {
      throw new Error(`No transport found for peer: ${peerId}`);
    }

    await transport.connect({ dtlsParameters });

    logger.info("WebRtcTransport connected", {
      peerId,
      transportId: transport.id,
    });
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /**
   * Get the WebRtcTransport for a peer.
   */
  getTransport(peerId: string): mediasoupTypes.WebRtcTransport | undefined {
    return this.transports.get(peerId);
  }

  /**
   * Get transport stats for a listener (used for admin dashboard per-listener info).
   */
  async getTransportStats(
    peerId: string,
  ): Promise<mediasoupTypes.WebRtcTransportStat[] | undefined> {
    const transport = this.transports.get(peerId);
    if (!transport) {
      return undefined;
    }

    try {
      return await transport.getStats();
    } catch (error) {
      logger.warn("Failed to get WebRtcTransport stats", {
        peerId,
        error: toErrorMessage(error),
      });
      return undefined;
    }
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Close and remove a single listener's transport.
   */
  closeTransport(peerId: string): void {
    const transport = this.transports.get(peerId);
    if (!transport) {
      return;
    }

    try {
      transport.close();
    } catch {
      // Transport may already be closed from router/worker close cascade
    }

    this.transports.delete(peerId);

    logger.info("WebRtcTransport closed", { peerId });
  }

  /**
   * Close all transports (used during graceful shutdown).
   */
  closeAll(): void {
    for (const [peerId, transport] of this.transports) {
      try {
        transport.close();
      } catch {
        // Ignore errors during bulk shutdown
      }
      logger.debug("WebRtcTransport closed during shutdown", { peerId });
    }

    this.transports.clear();
    logger.info("All WebRtcTransports closed", {
      count: this.transports.size,
    });
  }

  /**
   * Get the total number of active transports.
   */
  getTransportCount(): number {
    return this.transports.size;
  }

  // -----------------------------------------------------------------------
  // Internal: event handler registration
  // -----------------------------------------------------------------------

  /**
   * Register mediasoup event handlers for transport lifecycle monitoring.
   *
   * Per audit garbage collection rules:
   * - icestatechange: log state changes for monitoring
   * - dtlsstatechange: close transport on "failed" or "closed"
   * - routerclose: clean up from tracking Map
   */
  private registerTransportEventHandlers(
    transport: mediasoupTypes.WebRtcTransport,
    peerId: string,
  ): void {
    transport.on("icestatechange", (iceState: mediasoupTypes.IceState) => {
      logger.debug("WebRtcTransport ICE state changed", {
        peerId,
        transportId: transport.id,
        iceState,
      });

      if (iceState === "disconnected" || iceState === "closed") {
        logger.warn("WebRtcTransport ICE disconnected/closed", {
          peerId,
          transportId: transport.id,
          iceState,
        });
      }
    });

    transport.on(
      "dtlsstatechange",
      (dtlsState: mediasoupTypes.DtlsState) => {
        logger.debug("WebRtcTransport DTLS state changed", {
          peerId,
          transportId: transport.id,
          dtlsState,
        });

        if (dtlsState === "failed" || dtlsState === "closed") {
          logger.warn("WebRtcTransport DTLS failed/closed, closing transport", {
            peerId,
            transportId: transport.id,
            dtlsState,
          });

          // Close transport and remove from tracking
          this.closeTransport(peerId);
        }
      },
    );

    transport.on("routerclose", () => {
      logger.info("WebRtcTransport closed due to router close", {
        peerId,
        transportId: transport.id,
      });

      // Remove from tracking (transport is already closed by mediasoup cascade)
      this.transports.delete(peerId);
    });
  }
}
