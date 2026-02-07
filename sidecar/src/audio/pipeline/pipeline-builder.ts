/**
 * GStreamer pipeline string builder.
 *
 * Constructs `gst-launch-1.0` CLI pipeline strings for all supported audio source types:
 * AES67 multicast, WASAPI, ASIO, DirectSound, and WASAPI Loopback.
 *
 * Pure function module -- no side effects, no state, no I/O.
 * The process manager (Plan 03) consumes these strings to spawn GStreamer child processes.
 */

import type {
  PipelineConfig,
  Aes67PipelineConfig,
  LocalPipelineConfig,
} from "./pipeline-types";
import type { AudioApi } from "../sources/source-types";

/** Convert a millisecond value to GStreamer nanoseconds (level element `interval` property). */
function msToGstNanoseconds(ms: number): number {
  return ms * 1_000_000;
}

/**
 * Append the standard audio processing tail shared by all pipeline types:
 * audioconvert -> audioresample -> level metering -> fakesink.
 */
function buildMeteringTail(levelIntervalNs: number): string {
  return (
    `audioconvert ! audioresample ! ` +
    `level interval=${levelIntervalNs} post-messages=true ! ` +
    `fakesink sync=false`
  );
}

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

/** Build an AES67 multicast RTP receive pipeline. */
function buildAes67Pipeline(
  config: Aes67PipelineConfig,
  levelIntervalNs: number,
): string {
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

  return (
    `${source} ! ` +
    `${jitterBuffer} ! ` +
    `${depayloader} ! ` +
    `${channelSelect}` +
    buildMeteringTail(levelIntervalNs)
  );
}

/** Build a WASAPI2 capture pipeline (regular capture or loopback). */
function buildWasapiPipeline(
  config: LocalPipelineConfig,
  levelIntervalNs: number,
): string {
  const { deviceId, selectedChannels, isLoopback } = config;

  let sourceElement: string;

  if (isLoopback) {
    // Loopback capture -- device param is optional (default output device if omitted)
    sourceElement = deviceId
      ? `wasapi2src device=${quoteDeviceId(deviceId)} loopback=true`
      : `wasapi2src loopback=true`;
  } else {
    sourceElement = `wasapi2src device=${quoteDeviceId(deviceId)} low-latency=true`;
  }

  // WASAPI does not expose total channel count in config, so deinterleave
  // is only applied when selectedChannels is explicitly a subset.
  // The caller is responsible for setting selectedChannels correctly.
  // For WASAPI, if selectedChannels length > 0 and the device has more channels,
  // we add deinterleave. Since we don't have totalChannels here, we skip
  // deinterleave when selectedChannels is not explicitly a mono/stereo subset.
  // The process manager will provide the correct selectedChannels.
  const channelSelect =
    selectedChannels.length > 0 && selectedChannels.length <= 2
      ? buildChannelSelectionForLocal(selectedChannels)
      : "";

  return `${sourceElement} ! ${channelSelect}${buildMeteringTail(levelIntervalNs)}`;
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

/** Build an ASIO capture pipeline. ASIO supports native channel selection. */
function buildAsioPipeline(
  config: LocalPipelineConfig,
  levelIntervalNs: number,
): string {
  const { deviceId, selectedChannels, bufferSize } = config;

  let sourceElement = `asiosrc device-clsid=${quoteDeviceId(deviceId)}`;

  // ASIO element supports native channel selection via input-channels property
  if (selectedChannels.length > 0) {
    sourceElement += ` input-channels="${selectedChannels.join(",")}"`;
  }

  if (bufferSize !== undefined && bufferSize > 0) {
    sourceElement += ` buffer-size=${bufferSize}`;
  }

  return `${sourceElement} ! ${buildMeteringTail(levelIntervalNs)}`;
}

/** Build a DirectSound capture pipeline (fallback for legacy compatibility). */
function buildDirectSoundPipeline(
  config: LocalPipelineConfig,
  levelIntervalNs: number,
): string {
  const { deviceId, selectedChannels } = config;

  const sourceElement = `directsoundsrc device-name=${quoteDeviceId(deviceId)}`;

  const channelSelect =
    selectedChannels.length > 0 && selectedChannels.length <= 2
      ? buildChannelSelectionForLocal(selectedChannels)
      : "";

  return `${sourceElement} ! ${channelSelect}${buildMeteringTail(levelIntervalNs)}`;
}

/** Dispatch table mapping AudioApi values to their pipeline builder functions. */
const LOCAL_PIPELINE_BUILDERS: Record<
  AudioApi,
  (config: LocalPipelineConfig, levelIntervalNs: number) => string
> = {
  wasapi2: buildWasapiPipeline,
  asio: buildAsioPipeline,
  directsound: buildDirectSoundPipeline,
};

/**
 * Build a complete GStreamer pipeline string from a PipelineConfig.
 *
 * The returned string is ready to be passed as arguments to `gst-launch-1.0 -m -e`.
 * Each source type produces a valid pipeline ending with level metering and fakesink.
 *
 * @throws Error if configuration is invalid (missing required config for source type).
 */
export function buildPipelineString(config: PipelineConfig): string {
  const levelIntervalNs = msToGstNanoseconds(config.levelIntervalMs);

  if (config.sourceType === "aes67") {
    if (!config.aes67Config) {
      throw new Error(
        `Pipeline config has sourceType "aes67" but aes67Config is missing.`,
      );
    }
    return buildAes67Pipeline(config.aes67Config, levelIntervalNs);
  }

  if (config.sourceType === "local") {
    if (!config.localConfig) {
      throw new Error(
        `Pipeline config has sourceType "local" but localConfig is missing.`,
      );
    }

    const builderFn = LOCAL_PIPELINE_BUILDERS[config.localConfig.api];
    if (!builderFn) {
      throw new Error(
        `Unsupported audio API: "${config.localConfig.api}". ` +
        `Supported APIs: ${Object.keys(LOCAL_PIPELINE_BUILDERS).join(", ")}.`,
      );
    }

    return builderFn(config.localConfig, levelIntervalNs);
  }

  // TypeScript exhaustiveness -- should never reach here with discriminated union
  throw new Error(`Unknown source type: "${(config as { sourceType: string }).sourceType}".`);
}
