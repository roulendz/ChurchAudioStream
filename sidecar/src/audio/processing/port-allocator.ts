/**
 * Deterministic RTP/RTCP port pair and SSRC allocation for audio channels.
 *
 * Port pairs are sequential starting at RTP_BASE_PORT (50702):
 *   Channel 0: 50702/50703
 *   Channel 1: 50704/50705
 *   Channel 2: 50706/50707
 *
 * SSRCs are deterministically derived from channel UUIDs to guarantee
 * uniqueness without random collisions.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base port for RTP output. Must be below 65535 (UDP max). */
export const RTP_BASE_PORT = 50702;

// ---------------------------------------------------------------------------
// Port allocation
// ---------------------------------------------------------------------------

/**
 * Return the RTP and RTCP port pair for a given channel index.
 *
 * @param channelIndex  Zero-based index of the channel in the channel list.
 * @returns Object with `rtpPort` (even) and `rtcpPort` (odd = rtpPort + 1).
 */
export function getPortsForChannel(channelIndex: number): {
  rtpPort: number;
  rtcpPort: number;
} {
  const rtpPort = RTP_BASE_PORT + channelIndex * 2;
  return { rtpPort, rtcpPort: rtpPort + 1 };
}

// ---------------------------------------------------------------------------
// SSRC generation
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic non-zero SSRC from a channel UUID.
 *
 * Uses a simple FNV-1a 32-bit hash of the channel ID string.
 * The result is always non-zero (SSRC 0 is reserved in RTP).
 *
 * @param channelId  The channel's UUID string.
 * @returns A non-zero 32-bit unsigned integer suitable for use as an RTP SSRC.
 */
export function generateSsrc(channelId: string): number {
  // FNV-1a 32-bit hash
  let hash = 0x811c9dc5; // FNV offset basis

  for (let i = 0; i < channelId.length; i++) {
    hash ^= channelId.charCodeAt(i);
    // FNV prime multiplication with 32-bit wrap via unsigned right shift
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  // Ensure non-zero (SSRC 0 is reserved in RTP)
  return hash === 0 ? 1 : hash;
}
