import { parse } from "sdp-transform";

/** AES67 stream metadata extracted from an SDP announcement. */
export interface Aes67SdpInfo {
  /** Stream name from SDP s= line (e.g., "Dante Channel 1-2"). */
  sessionName: string;
  /** Optional description from SDP i= line. */
  description: string;
  /** Multicast group address for audio RTP (e.g., "239.69.0.121"). */
  multicastAddress: string;
  /** RTP port from SDP m= line. */
  port: number;
  /** Audio sample rate in Hz (e.g., 48000, 96000). */
  sampleRate: number;
  /** Number of audio channels (1 for mono, 2 for stereo, etc.). */
  channelCount: number;
  /** PCM bit depth: 16 (L16) or 24 (L24). */
  bitDepth: number;
  /** RTP payload type from SDP m= line. */
  payloadType: number;
  /** Per-channel labels from SDP a=label: attributes. Empty if not present. */
  channelLabels: string[];
  /** Originator IP address from SDP o= line. */
  originAddress: string;
  /** Session ID from SDP o= line (unique per origin for stream identification). */
  originSessionId: string;
}

/**
 * Extracts the PCM bit depth from an rtpmap encoding name.
 * Returns 16 for "L16", 24 for "L24", or null for unsupported codecs.
 */
function extractBitDepth(encodingName: string): number | null {
  const upperName = encodingName.toUpperCase();
  if (upperName === "L24") return 24;
  if (upperName === "L16") return 16;
  return null;
}

/**
 * Strips the TTL suffix from a multicast connection address.
 * SDP connection lines use `c=IN IP4 239.69.0.121/32` where /32 is TTL.
 * sdp-transform preserves the suffix in the ip field; we need just the address.
 */
function stripMulticastTtl(connectionIp: string): string {
  const slashIndex = connectionIp.indexOf("/");
  return slashIndex === -1 ? connectionIp : connectionIp.slice(0, slashIndex);
}

/**
 * Extracts all channel labels from raw SDP lines within a media block.
 *
 * sdp-transform recognizes `a=label:` as a scalar attribute and keeps only the
 * last value. AES67 streams may have multiple label attributes (one per channel),
 * so we parse them directly from the raw SDP text within the audio media section.
 */
function extractChannelLabelsFromRawSdp(
  rawSdp: string,
  mediaStartPort: number,
): string[] {
  const lines = rawSdp.split(/\r?\n/);
  const labels: string[] = [];
  let inTargetMediaBlock = false;

  for (const line of lines) {
    // Detect start of our target audio media block
    if (line.startsWith("m=audio") && line.includes(String(mediaStartPort))) {
      inTargetMediaBlock = true;
      continue;
    }

    // A new media block (m= line) ends the current one
    if (inTargetMediaBlock && line.startsWith("m=")) {
      break;
    }

    if (inTargetMediaBlock && line.startsWith("a=label:")) {
      labels.push(line.slice("a=label:".length).trim());
    }
  }

  return labels;
}

/**
 * Parse an SDP string and extract AES67 stream metadata.
 *
 * Uses sdp-transform for RFC 4566 SDP parsing, then extracts
 * AES67-specific fields (L16/L24 codec, multicast address, channel info).
 *
 * @returns Parsed AES67 stream info, or null if the SDP is not a valid AES67 audio stream.
 */
export function parseAes67Sdp(sdpContent: string): Aes67SdpInfo | null {
  let sdp: ReturnType<typeof parse>;
  try {
    sdp = parse(sdpContent);
  } catch {
    return null;
  }

  // Origin line is required for stream identification
  if (!sdp.origin) return null;

  const originAddress = sdp.origin.address;
  const originSessionId = String(sdp.origin.sessionId);

  // Find the first audio media block
  const audioMedia = sdp.media?.find((m) => m.type === "audio");
  if (!audioMedia) return null;

  // Extract multicast address: media-level connection takes precedence over session-level
  const rawMulticastIp =
    audioMedia.connection?.ip ?? sdp.connection?.ip ?? null;
  if (!rawMulticastIp) return null;
  const multicastAddress = stripMulticastTtl(rawMulticastIp);

  // Extract port from media line
  const port = audioMedia.port;

  // Extract payload type (first one listed; AES67 typically has a single payload type)
  const payloadsRaw = String(audioMedia.payloads ?? "");
  const payloadType = parseInt(payloadsRaw.split(/\s+/)[0], 10);
  if (isNaN(payloadType)) return null;

  // Find the rtpmap entry matching our payload type
  const rtpEntry = audioMedia.rtp?.find((r) => r.payload === payloadType);
  if (!rtpEntry) return null;

  // Extract bit depth from encoding name (L16 or L24)
  const bitDepth = extractBitDepth(rtpEntry.codec);
  if (bitDepth === null) return null;

  // Extract sample rate and channel count from rtpmap
  const sampleRate = rtpEntry.rate;
  if (!sampleRate) return null;

  // sdp-transform stores the optional channel count in the "encoding" field.
  // If omitted in SDP, it means mono (1 channel).
  const channelCount =
    rtpEntry.encoding !== undefined && rtpEntry.encoding > 0
      ? rtpEntry.encoding
      : 1;

  // Extract channel labels from raw SDP (sdp-transform only keeps last a=label: value)
  const channelLabels = extractChannelLabelsFromRawSdp(sdpContent, port);

  return {
    sessionName: sdp.name ?? "",
    description: sdp.description ?? "",
    multicastAddress,
    port,
    sampleRate,
    channelCount,
    bitDepth,
    payloadType,
    channelLabels,
    originAddress,
    originSessionId,
  };
}
