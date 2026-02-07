import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import { parseAes67Sdp, type Aes67SdpInfo } from "./sdp-parser.js";
import { logger } from "../../utils/logger.js";

/** SAP multicast group address (RFC 2974). */
const SAP_MULTICAST_ADDRESS = "224.2.127.254";

/** SAP listener port (RFC 2974). */
const SAP_PORT = 9875;

/** Minimum SAP header size in bytes (version + auth length + hash + origin IPv4). */
const SAP_HEADER_MIN_LENGTH = 8;

/** SAP protocol version we support. */
const SAP_VERSION = 1;

/** Parsed SAP packet header and SDP payload. */
interface SapPacket {
  isAnnouncement: boolean;
  sapHash: number;
  originAddress: string;
  sdpContent: string;
}

/** A discovered AES67 stream with SAP metadata. */
export interface SapStreamEntry {
  sdpInfo: Aes67SdpInfo;
  sapHash: number;
  lastSeen: number;
}

/** Unique key for a stream: originAddress:originSessionId. */
function buildStreamKey(originAddress: string, sessionId: string): string {
  return `${originAddress}:${sessionId}`;
}

/**
 * Converts 4 bytes starting at offset into a dotted-decimal IPv4 string.
 */
function readIpv4Address(buffer: Buffer, offset: number): string {
  return `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`;
}

/**
 * Checks whether any key SDP fields differ between two stream entries.
 * Used to detect stream updates (same origin, changed SDP version/content).
 */
function hasSdpChanged(
  existing: Aes67SdpInfo,
  incoming: Aes67SdpInfo,
): boolean {
  return (
    existing.sessionName !== incoming.sessionName ||
    existing.multicastAddress !== incoming.multicastAddress ||
    existing.port !== incoming.port ||
    existing.sampleRate !== incoming.sampleRate ||
    existing.channelCount !== incoming.channelCount ||
    existing.bitDepth !== incoming.bitDepth ||
    existing.payloadType !== incoming.payloadType
  );
}

/**
 * Listens for AES67 stream announcements via SAP (Session Announcement Protocol).
 *
 * SAP is the standard discovery mechanism for AES67 and Dante audio streams.
 * Streams announce themselves by multicasting SAP packets containing SDP
 * descriptions to 224.2.127.254:9875. This listener joins that multicast group,
 * parses incoming packets, and emits events for stream lifecycle changes.
 *
 * Important: SAP announcements can take up to 300 seconds between repeats.
 * Use loadCachedStreams() on startup to restore previously discovered streams,
 * then let live SAP packets update the registry as they arrive.
 *
 * Events:
 * - "stream-discovered" (info: Aes67SdpInfo & { sapHash: number })
 * - "stream-updated"    (info: Aes67SdpInfo & { sapHash: number })
 * - "stream-removed"    (sapHash: number, originAddress: string)
 * - "error"             (error: Error)
 */
export class SapListener extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private knownStreams = new Map<string, SapStreamEntry>();
  private running = false;

  /**
   * Start listening for SAP multicast announcements.
   *
   * @param networkInterfaceAddress - Optional local IP to bind multicast membership to.
   *   If omitted, the OS chooses the default interface. On Windows, multicast
   *   interface selection can be unreliable (see research Pitfall 1).
   */
  start(networkInterfaceAddress?: string): void {
    if (this.running) return;

    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    socket.on("error", (error: Error) => {
      logger.error("SAP listener socket error", {
        error: error.message,
      });
      this.emit("error", error);
    });

    socket.on("message", (buffer: Buffer, rinfo: dgram.RemoteInfo) => {
      this.handleSapMessage(buffer, rinfo);
    });

    socket.bind(SAP_PORT, () => {
      try {
        socket.addMembership(SAP_MULTICAST_ADDRESS, networkInterfaceAddress);
        socket.setMulticastTTL(32);

        this.socket = socket;
        this.running = true;

        logger.info(
          `SAP listener started on ${SAP_MULTICAST_ADDRESS}:${SAP_PORT}`,
          networkInterfaceAddress
            ? { networkInterface: networkInterfaceAddress }
            : undefined,
        );
      } catch (error) {
        const joinError =
          error instanceof Error
            ? error
            : new Error(String(error));
        logger.error("Failed to join SAP multicast group", {
          error: joinError.message,
        });
        this.emit("error", joinError);
        socket.close();
      }
    });
  }

  /** Stop listening and release the multicast socket. */
  stop(): void {
    if (!this.running || !this.socket) return;

    try {
      this.socket.dropMembership(SAP_MULTICAST_ADDRESS);
    } catch {
      // Membership may already be dropped if interface went down
    }

    this.socket.close();
    this.socket = null;
    this.running = false;

    logger.info("SAP listener stopped");
  }

  /** Returns a snapshot of all currently known streams for persistence. */
  getKnownStreams(): Map<string, SapStreamEntry> {
    return new Map(this.knownStreams);
  }

  /**
   * Load previously cached streams on startup.
   *
   * SAP announcements can take up to 300 seconds between repeats. Loading
   * cached streams ensures the UI shows known streams immediately, while
   * live SAP packets will update or remove stale entries as they arrive.
   */
  loadCachedStreams(cached: Map<string, SapStreamEntry>): void {
    for (const [key, entry] of cached) {
      this.knownStreams.set(key, entry);
    }

    logger.info(`Loaded ${cached.size} cached AES67 streams`);
  }

  /**
   * Parse a raw SAP packet (RFC 2974) from a UDP datagram.
   *
   * SAP header layout (IPv4):
   *   Byte 0:  V=3bits | A=1bit | R=1bit | T=1bit | E=1bit | C=1bit
   *            V (version, bits 5-7) must be 1
   *            T (message type, bit 2): 0=announcement, 1=deletion
   *   Byte 1:  Authentication data length (number of 32-bit words)
   *   Bytes 2-3: Message ID hash (big-endian uint16)
   *   Bytes 4-7: Originating source IPv4 address
   *   [Auth data: authLength * 4 bytes]
   *   Null-terminated MIME type string (usually "application/sdp\0")
   *   SDP payload (everything after the null terminator)
   */
  private parseSapPacket(buffer: Buffer): SapPacket | null {
    if (buffer.length < SAP_HEADER_MIN_LENGTH) return null;

    const firstByte = buffer[0];

    // Version is bits 5-7 (top 3 bits)
    const version = (firstByte >> 5) & 0x07;
    if (version !== SAP_VERSION) return null;

    // Address type bit 4: 0=IPv4, 1=IPv6 (we only handle IPv4)
    const isIpv6 = (firstByte >> 4) & 0x01;
    if (isIpv6) return null;

    // Message type bit 2: 0=announcement, 1=deletion
    const isDeletion = (firstByte >> 2) & 0x01;
    const isAnnouncement = isDeletion === 0;

    // Authentication data length (number of 32-bit words after the 8-byte header)
    const authLength = buffer[1];

    // Message ID hash (bytes 2-3, big-endian)
    const sapHash = buffer.readUInt16BE(2);

    // Originating source address (bytes 4-7, IPv4)
    const originAddress = readIpv4Address(buffer, 4);

    // Skip past header (8 bytes) and authentication data (authLength * 4 bytes)
    const contentOffset = SAP_HEADER_MIN_LENGTH + authLength * 4;
    if (contentOffset >= buffer.length) return null;

    // Find the null terminator that ends the MIME type string
    const mimeEndIndex = buffer.indexOf(0x00, contentOffset);
    if (mimeEndIndex === -1) {
      // No MIME type separator found -- some implementations omit the MIME type
      // and start SDP directly. Check if content looks like SDP.
      const remainingContent = buffer.toString("utf-8", contentOffset);
      if (remainingContent.trimStart().startsWith("v=")) {
        return { isAnnouncement, sapHash, originAddress, sdpContent: remainingContent };
      }
      return null;
    }

    // SDP content follows the null-terminated MIME type string
    const sdpContent = buffer.toString("utf-8", mimeEndIndex + 1);
    if (sdpContent.length === 0) return null;

    return { isAnnouncement, sapHash, originAddress, sdpContent };
  }

  /** Handle an incoming SAP multicast message. */
  private handleSapMessage(buffer: Buffer, _rinfo: dgram.RemoteInfo): void {
    const packet = this.parseSapPacket(buffer);
    if (!packet) return;

    if (!packet.isAnnouncement) {
      this.handleDeletionPacket(packet);
      return;
    }

    this.handleAnnouncementPacket(packet);
  }

  /** Process a SAP deletion packet: remove the stream from the registry. */
  private handleDeletionPacket(packet: SapPacket): void {
    // SAP hash alone is not unique across origins. Search by origin + hash.
    let removedKey: string | null = null;

    for (const [key, entry] of this.knownStreams) {
      if (
        entry.sapHash === packet.sapHash &&
        entry.sdpInfo.originAddress === packet.originAddress
      ) {
        removedKey = key;
        break;
      }
    }

    if (removedKey) {
      this.knownStreams.delete(removedKey);
      this.emit("stream-removed", packet.sapHash, packet.originAddress);
      logger.info("AES67 stream removed via SAP deletion", {
        sapHash: packet.sapHash,
        originAddress: packet.originAddress,
      });
    }
  }

  /** Process a SAP announcement packet: discover or update a stream. */
  private handleAnnouncementPacket(packet: SapPacket): void {
    const sdpInfo = parseAes67Sdp(packet.sdpContent);
    if (!sdpInfo) return;

    const streamKey = buildStreamKey(
      sdpInfo.originAddress,
      sdpInfo.originSessionId,
    );
    const nowMs = Date.now();
    const existing = this.knownStreams.get(streamKey);

    if (existing) {
      existing.lastSeen = nowMs;

      if (hasSdpChanged(existing.sdpInfo, sdpInfo)) {
        existing.sdpInfo = sdpInfo;
        existing.sapHash = packet.sapHash;
        this.emit("stream-updated", { ...sdpInfo, sapHash: packet.sapHash });
        logger.info("AES67 stream updated", {
          sessionName: sdpInfo.sessionName,
          streamKey,
        });
      } else {
        logger.debug("SAP re-announcement (no change)", { streamKey });
      }
    } else {
      this.knownStreams.set(streamKey, {
        sdpInfo,
        sapHash: packet.sapHash,
        lastSeen: nowMs,
      });
      this.emit("stream-discovered", { ...sdpInfo, sapHash: packet.sapHash });
      logger.info("AES67 stream discovered", {
        sessionName: sdpInfo.sessionName,
        multicastAddress: sdpInfo.multicastAddress,
        port: sdpInfo.port,
        sampleRate: sdpInfo.sampleRate,
        channelCount: sdpInfo.channelCount,
        bitDepth: sdpInfo.bitDepth,
      });
    }
  }
}
