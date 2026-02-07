/**
 * Audio processing type definitions for per-channel normalization, encoding, and RTP output.
 *
 * These types model the complete processing chain:
 * Input -> Normalization/AGC -> Opus Encoding -> RTP Output
 *
 * Each stage can be independently bypassed via its `enabled` flag.
 * The `mode` field (Speech/Music) drives mode-dependent defaults through
 * the `deriveSettingsFromMode` pure function.
 */

// ---------------------------------------------------------------------------
// Audio mode
// ---------------------------------------------------------------------------

/** Speech vs Music processing mode for a channel. */
export type AudioModeType = "speech" | "music";

// ---------------------------------------------------------------------------
// AGC / Normalization
// ---------------------------------------------------------------------------

/**
 * Loudness normalization (AGC) configuration.
 *
 * Maps to GStreamer `audioloudnorm` element properties.
 * When `enabled` is false, the AGC stage is omitted from the pipeline.
 */
export interface AgcConfig {
  /** Whether AGC is active (false = bypass). */
  readonly enabled: boolean;
  /** Target integrated loudness in LUFS. Range: -20 to -14. */
  readonly targetLufs: number;
  /**
   * Maximum true peak in dBTP.
   * Speech: -2 dBTP (tighter limiting).
   * Music: -1 dBTP (more headroom for dynamics).
   */
  readonly maxTruePeakDbtp: number;
}

// ---------------------------------------------------------------------------
// Opus encoding
// ---------------------------------------------------------------------------

/**
 * Opus encoder configuration.
 *
 * Maps to GStreamer `opusenc` element properties.
 * When `enabled` is false, encoding and RTP output are omitted
 * (metering-only pipeline, same as Phase 2).
 */
export interface OpusEncodingConfig {
  /** Whether Opus encoding is active (false = bypass, metering-only pipeline). */
  readonly enabled: boolean;
  /** Encoding bitrate in kbps. Range: 48-192. */
  readonly bitrateKbps: number;
  /** Opus frame size in milliseconds. */
  readonly frameSize: 10 | 20 | 40;
  /** Forward Error Correction. Adds ~120ms latency when enabled. */
  readonly fec: boolean;
  /** Discontinuous Transmission. Always false (no silence suppression). */
  readonly dtx: false;
  /** Bitrate mode. "vbr" maps to constrained-vbr in GStreamer. */
  readonly bitrateMode: "vbr" | "cbr";
  /**
   * Opus application type hint.
   * Derived from mode: Speech -> "voice" (VOIP), Music -> "generic" (Audio).
   * Maps to GStreamer opusenc `audio-type` property.
   */
  readonly audioType: "voice" | "generic";
}

// ---------------------------------------------------------------------------
// RTP output
// ---------------------------------------------------------------------------

/**
 * RTP/RTCP output configuration for mediasoup PlainTransport ingestion.
 *
 * Each channel gets a unique RTP+RTCP port pair and SSRC.
 * All traffic is localhost-only (127.0.0.1).
 */
export interface RtpOutputConfig {
  /** RTP port (even number). */
  readonly rtpPort: number;
  /** RTCP port (odd number, rtpPort + 1). */
  readonly rtcpPort: number;
  /** Destination host. Always 127.0.0.1 for local mediasoup. */
  readonly host: string;
  /** Unique SSRC per channel, deterministically generated from channel ID. */
  readonly ssrc: number;
}

// ---------------------------------------------------------------------------
// Top-level processing config
// ---------------------------------------------------------------------------

/**
 * Complete per-channel audio processing configuration.
 *
 * Covers the full processing chain: AGC -> Opus encoding -> RTP output.
 * The `mode` field (Speech/Music) influences AGC and Opus defaults
 * but does not override explicitly set values.
 */
export interface ProcessingConfig {
  /** Speech vs Music processing mode. Default: "speech". */
  readonly mode: AudioModeType;
  /** AGC / loudness normalization settings. */
  readonly agc: AgcConfig;
  /** Opus encoding settings. */
  readonly opus: OpusEncodingConfig;
  /** RTP/RTCP output settings. */
  readonly rtpOutput: RtpOutputConfig;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default processing configuration for a new Speech-mode channel. */
export const ProcessingDefaults: Readonly<ProcessingConfig> = {
  mode: "speech",
  agc: {
    enabled: true,
    targetLufs: -16,
    maxTruePeakDbtp: -2,
  },
  opus: {
    enabled: true,
    bitrateKbps: 128,
    frameSize: 20,
    fec: false,
    dtx: false,
    bitrateMode: "vbr",
    audioType: "voice",
  },
  rtpOutput: {
    rtpPort: 77702,
    rtcpPort: 77703,
    host: "127.0.0.1",
    ssrc: 1,
  },
};

// ---------------------------------------------------------------------------
// Mode derivation
// ---------------------------------------------------------------------------

/**
 * Update mode-dependent fields when the audio mode changes.
 *
 * Speech mode:
 *   - opusenc audio-type = "voice" (VOIP: high-pass filtering, formant emphasis)
 *   - AGC max true peak = -2 dBTP (tighter limiting)
 *
 * Music mode:
 *   - opusenc audio-type = "generic" (Audio: full spectrum preservation)
 *   - AGC max true peak = -1 dBTP (more headroom for dynamics)
 *
 * All other settings (bitrate, FEC, target LUFS, bypass flags, frame size,
 * bitrate mode, ports, SSRC) are preserved unchanged.
 */
export function deriveSettingsFromMode(
  mode: AudioModeType,
  current: ProcessingConfig,
): ProcessingConfig {
  const modeDependentAgc: AgcConfig = {
    ...current.agc,
    maxTruePeakDbtp: mode === "speech" ? -2 : -1,
  };

  const modeDependentOpus: OpusEncodingConfig = {
    ...current.opus,
    audioType: mode === "speech" ? "voice" : "generic",
  };

  return {
    ...current,
    mode,
    agc: modeDependentAgc,
    opus: modeDependentOpus,
  };
}
