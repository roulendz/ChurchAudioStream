/**
 * GStreamer pipeline string builder.
 *
 * Constructs `gst-launch-1.0` CLI pipeline strings for all supported audio source types:
 * AES67 multicast, WASAPI, ASIO, DirectSound, and WASAPI Loopback.
 *
 * Phase 3 processing support: when `PipelineConfig.processing` is present,
 * the pipeline includes audioloudnorm (AGC), opusenc + rtpopuspay (Opus/RTP encoding),
 * and a tee splitting to metering and encoding branches.
 *
 * Pure function module -- no side effects, no state, no I/O.
 * The process manager consumes these strings to spawn GStreamer child processes.
 */

import type {
  PipelineConfig,
  Aes67PipelineConfig,
  LocalPipelineConfig,
} from "./pipeline-types";
import type { AudioApi } from "../sources/source-types";
import type {
  AgcConfig,
  OpusEncodingConfig,
  ProcessingConfig,
  RtpOutputConfig,
} from "../processing/processing-types";

/** Convert a millisecond value to GStreamer nanoseconds (level element `interval` property). */
function msToGstNanoseconds(ms: number): number {
  return ms * 1_000_000;
}

// ---------------------------------------------------------------------------
// Shared tail builders (metering and processing)
// ---------------------------------------------------------------------------

/**
 * Build the standard Phase 2 metering tail:
 * audioconvert -> audioresample -> level metering -> fakesink.
 *
 * Used when no processing config is present (backward-compatible Phase 2 pipelines).
 */
function buildMeteringTail(levelIntervalNs: number): string {
  return (
    `audioconvert ! audioresample ! ` +
    `level interval=${levelIntervalNs} post-messages=true ! ` +
    `fakesink sync=false`
  );
}

/**
 * Build the AGC (loudness normalization) chain using audioloudnorm.
 *
 * CRITICAL: audioloudnorm from gst-plugins-rs requires 192kHz internal sample rate.
 * The audioresample wrappers (48kHz -> 192kHz -> 48kHz) are mandatory --
 * without them, audioloudnorm will crash or produce silence.
 *
 * When AGC is bypassed (enabled=false), returns empty string.
 */
function buildAgcChain(agc: AgcConfig): string {
  if (!agc.enabled) {
    return "";
  }

  return (
    `audioconvert ! audioresample ! audio/x-raw,rate=192000 ! ` +
    `audioloudnorm loudness-target=${agc.targetLufs} max-true-peak=${agc.maxTruePeakDbtp} ! ` +
    `audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 ! `
  );
}

/**
 * Build the Opus encoding and RTP output chain.
 *
 * Maps config values to GStreamer element properties:
 * - bitrateMode "vbr" -> bitrate-type=constrained-vbr
 * - bitrateMode "cbr" -> bitrate-type=cbr
 * - audioType "voice" / "generic" passed directly to opusenc audio-type
 *
 * Uses unique rtpbin name (includes SSRC) to avoid element name collisions
 * when multiple pipelines run simultaneously.
 *
 * When Opus is bypassed (enabled=false), returns empty string.
 */
function buildOpusRtpChain(opus: OpusEncodingConfig, rtp: RtpOutputConfig): string {
  if (!opus.enabled) {
    return "";
  }

  const bitrateTypeGst = opus.bitrateMode === "vbr" ? "constrained-vbr" : "cbr";
  const frameSizeNumber = Number(opus.frameSize);
  const bitrateBps = opus.bitrateKbps * 1000;

  return (
    `opusenc bitrate=${bitrateBps} frame-size=${frameSizeNumber} ` +
    `audio-type=${opus.audioType} bitrate-type=${bitrateTypeGst} ` +
    `inband-fec=${opus.fec} dtx=false ! ` +
    `rtpopuspay pt=101 ssrc=${rtp.ssrc} ! ` +
    `rtpbin name=rtpbin_${rtp.ssrc} ! ` +
    `udpsink host=${rtp.host} port=${rtp.rtpPort} sync=false ` +
    `rtpbin_${rtp.ssrc}.send_rtcp_src_0 ! ` +
    `udpsink host=${rtp.host} port=${rtp.rtcpPort} sync=false async=false`
  );
}

/**
 * Build the Phase 3 processing and output tail.
 *
 * Replaces `buildMeteringTail` when processing config is present.
 * Handles all 4 combinations of AGC enabled/disabled x Opus enabled/disabled:
 *
 * Case A (both on):     AGC -> tee -> [metering branch, Opus/RTP branch]
 * Case B (AGC only):    AGC -> metering (no tee needed)
 * Case C (Opus only):   caps enforcement -> tee -> [metering branch, Opus/RTP branch]
 * Case D (both off):    Same as Phase 2 metering tail
 */
function buildProcessingAndOutputTail(
  processing: ProcessingConfig,
  levelIntervalNs: number,
): string {
  const { agc, opus, rtpOutput } = processing;
  const agcChain = buildAgcChain(agc);
  const opusRtpChain = buildOpusRtpChain(opus, rtpOutput);

  const meteringElements =
    `level interval=${levelIntervalNs} post-messages=true ! fakesink sync=false`;

  const agcEnabled = agc.enabled;
  const opusEnabled = opus.enabled;

  // Case A: Both AGC and Opus enabled (full processing pipeline)
  if (agcEnabled && opusEnabled) {
    return (
      `${agcChain}` +
      `tee name=t ` +
      `t. ! queue ! ${meteringElements} ` +
      `t. ! queue ! ${opusRtpChain}`
    );
  }

  // Case B: AGC enabled, Opus bypassed (processing without encoding)
  if (agcEnabled && !opusEnabled) {
    return `${agcChain}${meteringElements}`;
  }

  // Case C: AGC bypassed, Opus enabled (encoding without processing)
  if (!agcEnabled && opusEnabled) {
    return (
      `audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 ! ` +
      `tee name=t ` +
      `t. ! queue ! ${meteringElements} ` +
      `t. ! queue ! ${opusRtpChain}`
    );
  }

  // Case D: Both bypassed (metering only, same as Phase 2)
  return buildMeteringTail(levelIntervalNs);
}

// ---------------------------------------------------------------------------
// Channel selection helpers
// ---------------------------------------------------------------------------

/**
 * Build deinterleave + optional interleave elements for channel selection
 * from a multichannel stream.
 *
 * - 1 channel selected from N: deinterleave -> pick one pad
 * - 2 channels selected from N (stereo pair): deinterleave -> interleave two pads
 * - All channels selected: no deinterleave (pass through)
 */
function buildChannelSelection(
  selectedChannels: number[],
  totalChannels: number,
): string {
  if (selectedChannels.length === totalChannels) {
    // All channels selected -- no deinterleave needed
    return "";
  }

  if (selectedChannels.length === 1) {
    // Mono extraction from multichannel stream
    return `deinterleave name=d d.src_${selectedChannels[0]} ! queue ! `;
  }

  if (selectedChannels.length === 2) {
    // Stereo pair extraction: deinterleave -> interleave two channels
    const [chA, chB] = selectedChannels;
    return (
      `deinterleave name=d ` +
      `d.src_${chA} ! queue ! interleave name=i ` +
      `d.src_${chB} ! queue ! i. ` +
      `i. ! `
    );
  }

  // More than 2 but fewer than total: deinterleave + interleave N pads
  const interleaveInputs = selectedChannels
    .map((ch, index) =>
      index === 0
        ? `d.src_${ch} ! queue ! interleave name=i`
        : `d.src_${ch} ! queue ! i.`,
    )
    .join(" ");

  return `deinterleave name=d ${interleaveInputs} i. ! `;
}

/**
 * Escape a Windows device identifier for safe embedding in a GStreamer pipeline string.
 * Windows device paths contain backslashes and curly braces that need quoting.
 */
function quoteDeviceId(deviceId: string): string {
  return `"${deviceId}"`;
}

/**
 * Select the correct RTP depayloader element based on bit depth.
 * AES67 uses L16 (16-bit) or L24 (24-bit) linear audio.
 */
function rtpDepayloaderForBitDepth(bitDepth: number): string {
  if (bitDepth === 24) return "rtpL24depay";
  if (bitDepth === 16) return "rtpL16depay";
  throw new Error(
    `Unsupported AES67 bit depth: ${bitDepth}. Expected 16 or 24.`,
  );
}

// ---------------------------------------------------------------------------
// Source head builders (return source + channel selection, no tail)
// ---------------------------------------------------------------------------

/** Build the AES67 multicast RTP receive source head. */
function buildAes67SourceHead(config: Aes67PipelineConfig): string {
  const {
    multicastAddress,
    port,
    sampleRate,
    channelCount,
    bitDepth,
    payloadType,
    selectedChannels,
  } = config;

  const depayloader = rtpDepayloaderForBitDepth(bitDepth);

  const source =
    `udpsrc address=${multicastAddress} port=${port} ` +
    `caps="application/x-rtp, clock-rate=${sampleRate}, channels=${channelCount}, payload=${payloadType}" ` +
    `buffer-size=65536`;

  const jitterBuffer = `rtpjitterbuffer latency=5`;

  const channelSelect = buildChannelSelection(selectedChannels, channelCount);

  return `${source} ! ${jitterBuffer} ! ${depayloader} ! ${channelSelect}`;
}

/**
 * Build channel selection for local devices.
 * Unlike AES67 where we know total channel count, local devices
 * use deinterleave only when explicitly selecting a subset.
 */
function buildChannelSelectionForLocal(selectedChannels: number[]): string {
  if (selectedChannels.length === 1) {
    return `deinterleave name=d d.src_${selectedChannels[0]} ! queue ! `;
  }

  if (selectedChannels.length === 2) {
    const [chA, chB] = selectedChannels;
    return (
      `deinterleave name=d ` +
      `d.src_${chA} ! queue ! interleave name=i ` +
      `d.src_${chB} ! queue ! i. ` +
      `i. ! `
    );
  }

  return "";
}

/** Build a WASAPI2 capture source head (regular capture or loopback). */
function buildWasapiSourceHead(config: LocalPipelineConfig): string {
  const { deviceId, selectedChannels, isLoopback } = config;

  let sourceElement: string;

  if (isLoopback) {
    sourceElement = deviceId
      ? `wasapi2src device=${quoteDeviceId(deviceId)} loopback=true`
      : `wasapi2src loopback=true`;
  } else {
    sourceElement = `wasapi2src device=${quoteDeviceId(deviceId)} low-latency=true`;
  }

  const channelSelect =
    selectedChannels.length > 0 && selectedChannels.length <= 2
      ? buildChannelSelectionForLocal(selectedChannels)
      : "";

  return `${sourceElement} ! ${channelSelect}`;
}

/** Build an ASIO capture source head. ASIO supports native channel selection. */
function buildAsioSourceHead(config: LocalPipelineConfig): string {
  const { deviceId, selectedChannels, bufferSize } = config;

  let sourceElement = `asiosrc device-clsid=${quoteDeviceId(deviceId)}`;

  if (selectedChannels.length > 0) {
    sourceElement += ` input-channels="${selectedChannels.join(",")}"`;
  }

  if (bufferSize !== undefined && bufferSize > 0) {
    sourceElement += ` buffer-size=${bufferSize}`;
  }

  return `${sourceElement} ! `;
}

/** Build a DirectSound capture source head (fallback for legacy compatibility). */
function buildDirectSoundSourceHead(config: LocalPipelineConfig): string {
  const { deviceId, selectedChannels } = config;

  const sourceElement = `directsoundsrc device-name=${quoteDeviceId(deviceId)}`;

  const channelSelect =
    selectedChannels.length > 0 && selectedChannels.length <= 2
      ? buildChannelSelectionForLocal(selectedChannels)
      : "";

  return `${sourceElement} ! ${channelSelect}`;
}

/** Dispatch table mapping AudioApi values to their source head builder functions. */
const LOCAL_SOURCE_HEAD_BUILDERS: Record<
  AudioApi,
  (config: LocalPipelineConfig) => string
> = {
  wasapi2: buildWasapiSourceHead,
  asio: buildAsioSourceHead,
  directsound: buildDirectSoundSourceHead,
};

// ---------------------------------------------------------------------------
// Top-level source head dispatcher
// ---------------------------------------------------------------------------

/**
 * Build the source-specific head of the pipeline (source element + channel selection).
 * Does NOT include the tail (metering or processing).
 *
 * @throws Error if configuration is invalid (missing required config for source type).
 */
function buildSourceHead(config: PipelineConfig): string {
  if (config.sourceType === "aes67") {
    if (!config.aes67Config) {
      throw new Error(
        `Pipeline config has sourceType "aes67" but aes67Config is missing.`,
      );
    }
    return buildAes67SourceHead(config.aes67Config);
  }

  if (config.sourceType === "local") {
    if (!config.localConfig) {
      throw new Error(
        `Pipeline config has sourceType "local" but localConfig is missing.`,
      );
    }

    const builderFn = LOCAL_SOURCE_HEAD_BUILDERS[config.localConfig.api];
    if (!builderFn) {
      throw new Error(
        `Unsupported audio API: "${config.localConfig.api}". ` +
        `Supported APIs: ${Object.keys(LOCAL_SOURCE_HEAD_BUILDERS).join(", ")}.`,
      );
    }

    return builderFn(config.localConfig);
  }

  // TypeScript exhaustiveness -- should never reach here with discriminated union
  throw new Error(`Unknown source type: "${(config as { sourceType: string }).sourceType}".`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a complete GStreamer pipeline string from a PipelineConfig.
 *
 * The returned string is ready to be passed as arguments to `gst-launch-1.0 -m -e`.
 *
 * When `config.processing` is present, produces a Phase 3 pipeline with
 * AGC (audioloudnorm), Opus encoding, and RTP output.
 * When absent, produces the Phase 2 metering-only pipeline.
 *
 * @throws Error if configuration is invalid (missing required config for source type).
 */
export function buildPipelineString(config: PipelineConfig): string {
  const levelIntervalNs = msToGstNanoseconds(config.levelIntervalMs);
  const sourceHead = buildSourceHead(config);

  if (config.processing) {
    return sourceHead + buildProcessingAndOutputTail(config.processing, levelIntervalNs);
  }

  return sourceHead + buildMeteringTail(levelIntervalNs);
}
