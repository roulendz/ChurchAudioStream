/**
 * WebRtcTransport lifecycle management for listeners.
 *
 * Creates on-demand WebRtcTransports per listener. Advertises both the
 * server's LAN IP (so phones on the same WiFi can reach the host) and the
 * IPv4 loopback address (so a desktop browser running on the same Windows
 * machine as the sidecar can reach mediasoup without a UDP hairpin through
 * the LAN NIC). Enables both UDP and TCP for ICE so transient UDP hairpin
 * failures fall back to TCP rather than stalling at bytesReceived=0.
 *
 * Provides transport connection, stats, and cleanup with proper
 * event-driven resource management.
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

/** IPv4 loopback address — used as a second announced ICE candidate so
 *  same-host desktop browsers can connect via 127.0.0.1 instead of a
 *  hairpin through the LAN NIC. */
const LOOPBACK_IPV4 = "127.0.0.1";

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
   *                            the primary ICE candidate announced address
   *                            so phone browsers can reach the server on
   *                            the local network.
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
   * Listens on 0.0.0.0 (all interfaces) for both UDP and TCP, and announces
   * two ICE candidate addresses: the configured LAN IP (for remote/mobile
   * clients) and 127.0.0.1 (for same-host desktop browsers). UDP is
   * preferred for latency; TCP is enabled purely as ICE fallback when UDP
   * hairpin or NAT scenarios fail.
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
      listenInfos: this.buildListenInfos(),
      enableUdp: true,
      enableTcp: true, // ICE fallback when UDP fails (e.g. local hairpin)
      preferUdp: true, // UDP still preferred for lowest latency
      initialAvailableOutgoingBitrate: INITIAL_AVAILABLE_OUTGOING_BITRATE,
      iceConsentTimeout: ICE_CONSENT_TIMEOUT_SECONDS,
    });

    this.registerTransportEventHandlers(transport, peerId);
    this.transports.set(peerId, transport);

    logger.info("WebRtcTransport created for listener", {
      peerId,
      transportId: transport.id,
      announcedIps: [this.announcedIpAddress, LOOPBACK_IPV4],
      iceCandidateCount: transport.iceCandidates.length,
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
  // Internal: listen info construction
  // -----------------------------------------------------------------------

  /**
   * Build the listenInfos array advertised by every WebRtcTransport.
   *
   * Each entry produces one ICE candidate per protocol (UDP + TCP). We
   * announce the LAN IP for remote clients and the loopback IP for
   * same-host desktop browsers, on both UDP and TCP. mediasoup auto-picks
   * a port from the configured rtcMinPort..rtcMaxPort range.
   *
   * Skips the loopback announcement if the configured LAN IP is itself
   * the loopback address (would create duplicate identical candidates).
   */
  private buildListenInfos(): mediasoupTypes.TransportListenInfo[] {
    const protocols: ReadonlyArray<"udp" | "tcp"> = ["udp", "tcp"];
    const announcedAddresses = this.uniqueAnnouncedAddresses();

    const listenInfos: mediasoupTypes.TransportListenInfo[] = [];
    for (const protocol of protocols) {
      for (const announcedAddress of announcedAddresses) {
        listenInfos.push({
          protocol,
          ip: "0.0.0.0",
          announcedAddress,
        });
      }
    }
    return listenInfos;
  }

  /**
   * Return the deduplicated list of announced addresses: the configured
   * LAN IP plus the IPv4 loopback, in that order.
   */
  private uniqueAnnouncedAddresses(): readonly string[] {
    if (this.announcedIpAddress === LOOPBACK_IPV4) {
      return [LOOPBACK_IPV4];
    }
    return [this.announcedIpAddress, LOOPBACK_IPV4];
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
