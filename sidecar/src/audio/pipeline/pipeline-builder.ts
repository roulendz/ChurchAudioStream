/**
 * GStreamer pipeline string builder.
 *
 * Constructs `gst-launch-1.0` CLI pipeline strings for one-pipeline-per-channel
 * deployments: N source segments combined inside a single process via
 * `audiomixer name=mix`. Supported source kinds: AES67 multicast, WASAPI v1/v2
 * (regular + loopback), ASIO, DirectSound, file (decodebin).
 *
 * Pipeline string layout:
 *   audiomixer name=mix latency=10000000 ignore-inactive-pads=true
 *     ! audio/x-raw,rate=48000,channels=2 ! <processing+output tail>
 *   <source-0-head> ! <queue if live> volume volume=g0 ! audioconvert
 *     ! audioresample ! audio/x-raw,rate=48000,channels=2 ! mix.sink_0
 *   ...repeated for each source...
 *
 * Pure function module -- no side effects, no state, no I/O. Process manager
 * consumes the returned string to spawn one GStreamer child per channel.
 */

import type {
  Aes67PipelineConfig,
  LocalPipelineConfig,
  FilePipelineConfig,
  ChannelPipelineConfig,
  SourceSegment,
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
    `audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! `
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
 * SSRC is set on rtpopuspay directly. mediasoup PlainTransport with
 * `comedia: true` auto-detects the sender from the first RTP packet, so
 * sender-side RTCP is not required. We previously routed through rtpbin
 * for RTCP generation, but rtpbin's auto-pad linkage in a tee branch
 * caused queue not-linked errors mid-stream (the auto-link to
 * send_rtp_src_0 is fragile). Direct udpsink avoids the issue and runs
 * stably under load.
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

  // bind-port fixes the local UDP source port the sender uses. mediasoup
  // PlainTransport with comedia=true locks onto the FIRST source tuple it
  // sees (remoteIp:remotePort) and ignores RTP from any other tuple. With an
  // ephemeral source port, every gst-launch restart picks a new port and
  // mediasoup silently drops the new packets. Pinning to rtpPort+1000 gives
  // each channel a unique, predictable sender port that survives pipeline
  // restarts.
  const senderBindPort = rtp.rtpPort + 1000;
  return (
    `opusenc bitrate=${bitrateBps} frame-size=${frameSizeNumber} ` +
    `audio-type=${opus.audioType} bitrate-type=${bitrateTypeGst} ` +
    `inband-fec=${opus.fec} dtx=false ! ` +
    `rtpopuspay pt=101 ssrc=${rtp.ssrc} ! ` +
    `udpsink host=${rtp.host} port=${rtp.rtpPort} bind-port=${senderBindPort} sync=true async=false`
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
      `audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! ` +
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
 * Extract one channel from a multichannel stream and place it in the stereo
 * output bus at the position the user expects to hear it.
 *
 * For a stereo source (totalSourceChannels === 2):
 *   - ch 0 selected -> hard-left earpod, right is silent
 *   - ch 1 selected -> hard-right earpod, left is silent
 * For mono or unknown-total sources, the extracted channel is centered
 * (audioconvert duplicates mono to both stereo channels) -- no audiopanorama,
 * so a mono mic doesn't get arbitrarily panned to one ear.
 */
function buildSingleChannelExtraction(
  channelIndex: number,
  totalSourceChannels?: number,
): string {
  const head = `deinterleave name=d d.src_${channelIndex} ! queue ! `;
  const isStereoSource = totalSourceChannels === 2;
  if (!isStereoSource) {
    return head;
  }
  // audiopanorama accepts mono input and ALWAYS emits stereo, so we feed the
  // deinterleaved mono pad directly. Pre-upmixing to stereo with audioconvert
  // and then panning gave broken timestamps in some pipelines (Opus branch
  // stalled while the sibling level branch kept emitting -- monitors moved
  // but no RTP reached mediasoup). Letting audiopanorama do the mono->stereo
  // expansion itself avoids that.
  const panorama = channelIndex === 0 ? "-1.0" : "1.0";
  return `${head}audiopanorama method=simple panorama=${panorama} ! `;
}

/**
 * Build deinterleave + optional interleave elements for channel selection
 * from a multichannel stream.
 *
 * When `totalSourceChannels` is provided (AES67 sources), all-channel selection
 * is detected and deinterleave is skipped. When omitted (local devices), only
 * explicit mono/stereo extraction is supported.
 *
 * - 1 channel selected: deinterleave -> pick one pad
 * - 2 channels selected: deinterleave -> interleave two pads
 * - All channels selected (totalSourceChannels known): pass through
 * - N channels selected (N > 2, totalSourceChannels known): deinterleave + interleave N pads
 */
function buildChannelSelectionString(
  selectedChannels: number[],
  totalSourceChannels?: number,
): string {
  // When total is known and all channels are selected, no deinterleave needed
  if (totalSourceChannels !== undefined && selectedChannels.length === totalSourceChannels) {
    return "";
  }

  if (selectedChannels.length === 1) {
    return buildSingleChannelExtraction(selectedChannels[0], totalSourceChannels);
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

  // More than 2 but total unknown (local devices) -- cannot deinterleave safely
  if (totalSourceChannels === undefined) {
    return "";
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
// Live-capture decoupling segment
// ---------------------------------------------------------------------------

/**
 * Live-capture queue inserted between local source and processing tail.
 *
 * Rationale (industry-standard live-audio pattern):
 * - Live capture sources (WASAPI/ASIO/DirectSound) cannot pause -- they emit
 *   real-time samples whether or not downstream is ready. Brief downstream
 *   stalls (encoder warmup, GC, network burst) cause the source's internal
 *   ring buffer to overflow, producing "Dropped N samples" then "Internal
 *   data stream error" then a fatal pipeline crash.
 * - This queue absorbs up to 50ms of slack. Steady-state latency is ~0ms
 *   (queue stays empty when downstream healthy). Cap reached only on stall.
 * - `leaky=downstream` drops the OLDEST queued samples instead of blocking
 *   the source. Result: brief audible micro-glitch on overload, never a
 *   pipeline crash. Live-audio standard.
 *
 * AES67 sources use `rtpjitterbuffer` instead (network-jitter aware).
 */
const LIVE_CAPTURE_QUEUE_NS = 50_000_000; // 50ms in nanoseconds
const LIVE_CAPTURE_QUEUE_SEGMENT =
  `queue max-size-time=${LIVE_CAPTURE_QUEUE_NS} ` +
  `max-size-bytes=0 max-size-buffers=0 leaky=downstream`;

/**
 * Audiobasesrc buffer/latency timings shared across WASAPI v1/v2 sources.
 *
 * - `buffer-time=20000` (20ms ring buffer) survives Windows scheduler jitter.
 * - `latency-time=10000` (10ms callback period) keeps capture responsive.
 *
 * Replaces the `low-latency=true` flag that previously set ~10ms / 2ms --
 * too tight for sustained capture, caused the "Can't record audio fast
 * enough" warnings then crashes seen in v0.1.
 */
const WASAPI_LIVE_BUFFER_PROPS = `buffer-time=20000 latency-time=10000`;

// ---------------------------------------------------------------------------
// Source head builders (return source + channel selection, no tail)
// ---------------------------------------------------------------------------

/**
 * Build the file test source head.
 *
 * Uses `filesrc + decodebin` for codec-agnostic playback (MP3/WAV/FLAC/Ogg/etc).
 * The format is normalized to S16LE 48kHz stereo so downstream pipeline stages
 * have stable caps regardless of the file's native format.
 *
 * Note on looping: `multifilesrc loop=true` is GStreamer's only built-in
 * element for cycling files, but it's intended for sequential file lists
 * (e.g. `frame%04d.png`) and breaks decodebin's typefind on a single-file
 * replay. True seamless looping requires a custom seek-on-EOS pad probe,
 * which lives outside `gst-launch` in CLI mode. For now: file plays once,
 * pipeline manager schedules a clean restart when `loop=true`.
 */
function buildFileSourceHead(config: FilePipelineConfig): string {
  const { filePath, selectedChannels } = config;
  // GStreamer's pipeline parser uses '\' as an escape character, so backslashes
  // in Windows paths get stripped (`G:\Downloads` -> `G:Downloads`). Forward
  // slashes are accepted on Windows by both Windows APIs and GStreamer's
  // parser, so normalize before embedding.
  const gstSafePath = filePath.replace(/\\/g, "/");
  // File sources are always normalized to stereo at this stage; pass total=2
  // so an "all channels" selection short-circuits to a no-op.
  const channelSelect = buildChannelSelectionString(selectedChannels, 2);
  return (
    `filesrc location="${gstSafePath}" ! decodebin ! audioconvert ! audioresample ! ` +
    `audio/x-raw,rate=48000,channels=2 ! ${channelSelect}`
  );
}

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

  const channelSelect = buildChannelSelectionString(selectedChannels, channelCount);

  return `${source} ! ${jitterBuffer} ! ${depayloader} ! ${channelSelect}`;
}

/**
 * Build the channel-selection segment for a local source.
 *
 * Passes `totalChannelCount` to `buildChannelSelectionString` so it can detect
 * "all source channels selected" and skip deinterleave/interleave entirely
 * (which is fragile and produces `not-negotiated` errors for some sources).
 *
 * Returns empty string when no channels are selected, or when more than 2 are
 * selected without a known total (ambiguous routing for non-AES67 sources).
 */
function buildLocalChannelSelectionSegment(config: LocalPipelineConfig): string {
  const { selectedChannels, totalChannelCount } = config;
  if (selectedChannels.length === 0) return "";
  if (selectedChannels.length > 2 && totalChannelCount === undefined) return "";
  return buildChannelSelectionString(selectedChannels, totalChannelCount);
}

/** Build a WASAPI2 capture source head (regular capture or loopback). */
function buildWasapi2SourceHead(config: LocalPipelineConfig): string {
  const { deviceId, isLoopback } = config;

  let sourceElement: string;

  if (isLoopback) {
    sourceElement = deviceId
      ? `wasapi2src device=${quoteDeviceId(deviceId)} loopback=true ${WASAPI_LIVE_BUFFER_PROPS}`
      : `wasapi2src loopback=true ${WASAPI_LIVE_BUFFER_PROPS}`;
  } else {
    sourceElement = `wasapi2src device=${quoteDeviceId(deviceId)} ${WASAPI_LIVE_BUFFER_PROPS}`;
  }

  return `${sourceElement} ! ${buildLocalChannelSelectionSegment(config)}`;
}

/**
 * Build a WASAPI v1 (wasapisrc) capture source head.
 *
 * Used for non-default WASAPI devices because wasapi2src cannot open devices
 * via the long `\\?\SWD#MMDEVAPI#...` path in gst-launch-1.0 CLI mode
 * (GStreamer issue #922). The wasapi v1 plugin uses simpler `{flow}.{GUID}`
 * endpoint IDs that work reliably.
 */
function buildWasapiV1SourceHead(config: LocalPipelineConfig): string {
  const { deviceId, isLoopback } = config;

  let sourceElement: string;

  if (isLoopback) {
    sourceElement = deviceId
      ? `wasapisrc device=${quoteDeviceId(deviceId)} loopback=true ${WASAPI_LIVE_BUFFER_PROPS}`
      : `wasapisrc loopback=true ${WASAPI_LIVE_BUFFER_PROPS}`;
  } else {
    sourceElement = `wasapisrc device=${quoteDeviceId(deviceId)} ${WASAPI_LIVE_BUFFER_PROPS}`;
  }

  return `${sourceElement} ! ${buildLocalChannelSelectionSegment(config)}`;
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
  const { deviceId } = config;

  const sourceElement = `directsoundsrc device-name=${quoteDeviceId(deviceId)}`;

  return `${sourceElement} ! ${buildLocalChannelSelectionSegment(config)}`;
}

/** Dispatch table mapping AudioApi values to their source head builder functions. */
const LOCAL_SOURCE_HEAD_BUILDERS: Record<
  AudioApi,
  (config: LocalPipelineConfig) => string
> = {
  wasapi2: buildWasapi2SourceHead,
  wasapi: buildWasapiV1SourceHead,
  asio: buildAsioSourceHead,
  directsound: buildDirectSoundSourceHead,
};

// ---------------------------------------------------------------------------
// Multi-source channel pipeline (audiomixer)
// ---------------------------------------------------------------------------

/**
 * Audiomixer latency in nanoseconds. 10ms slack absorbs Windows scheduler
 * jitter without breaching the 100ms total budget (sub-budget already spent
 * on WASAPI buffer-time=20ms, audioloudnorm 192kHz roundtrip ~5ms, Opus
 * frame-size=20ms, network jitter ~20ms). RESEARCH 260429-hb3 §1.
 */
const AUDIOMIXER_LATENCY_NS = 10_000_000;

/**
 * Effective gain after honoring mute. Single source of truth -- called from
 * buildSourceSegment only. Mute wins over any nonzero gain (CLAUDE.md SRP).
 */
function computeEffectiveGain(assignment: SourceSegment["assignment"]): number {
  return assignment.muted ? 0 : assignment.gain;
}

/** Pure dispatcher -- picks correct head builder per source kind. */
function buildSourceHeadForSegment(seg: SourceSegment): string {
  const { source } = seg;
  if (source.kind === "file") return buildFileSourceHead(source.config);
  if (source.kind === "aes67") return buildAes67SourceHead(source.config);
  const builderFn = LOCAL_SOURCE_HEAD_BUILDERS[source.config.api];
  if (!builderFn) {
    throw new Error(
      `Unsupported audio API: "${source.config.api}". ` +
      `Supported APIs: ${Object.keys(LOCAL_SOURCE_HEAD_BUILDERS).join(", ")}.`,
    );
  }
  return builderFn(source.config);
}

/**
 * Per-source live-capture queue: empty for file/aes67, leaky queue for live
 * local capture. Mirrors `buildLiveCaptureSegment` for the multi-source path.
 */
function buildLiveCaptureSegmentForSegment(seg: SourceSegment): string {
  if (seg.source.kind === "aes67") return "";
  if (seg.source.kind === "file") return "";
  return `${LIVE_CAPTURE_QUEUE_SEGMENT} ! `;
}

/**
 * Build one parallel branch ending at the mixer sink pad.
 *
 * Layout: `<head><liveQueue>volume volume=<g> ! audioconvert ! audioresample
 *          ! audio/x-raw,rate=48000,channels=2 ! <mixerPadName>`
 *
 * No `audiopanorama` here -- channel-selection inside `<head>` already places
 * panorama for stereo single-channel selection. A second one would double-pan.
 */
function buildSourceSegment(seg: SourceSegment): string {
  const head = buildSourceHeadForSegment(seg);
  const liveQueue = buildLiveCaptureSegmentForSegment(seg);
  const effectiveGain = computeEffectiveGain(seg.assignment);
  return (
    `${head}${liveQueue}volume volume=${effectiveGain} ! ` +
    `audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! ` +
    `${seg.mixerPadName}`
  );
}

/**
 * Build a complete multi-source channel pipeline string. One gst-launch
 * process per channel, sources combined via `audiomixer name=mix`.
 *
 * Single code path for 1, 2, and N sources -- no special-case branch for
 * single-source channels (Tiger-style: one path, no DRY violations).
 *
 * @throws Error if `config.sources` is empty (channel-manager guarantees ≥1).
 */
export function buildChannelPipelineString(config: ChannelPipelineConfig): string {
  if (config.sources.length === 0) {
    throw new Error(
      `buildChannelPipelineString: channel "${config.label}" has zero sources`,
    );
  }
  const levelIntervalNs = msToGstNanoseconds(config.levelIntervalMs);
  const tail = buildProcessingAndOutputTail(config.processing, levelIntervalNs);
  const mixerHead =
    `audiomixer name=mix latency=${AUDIOMIXER_LATENCY_NS} ignore-inactive-pads=true ` +
    `! audio/x-raw,rate=48000,channels=2 ! ${tail} `;
  const segments = config.sources.map(buildSourceSegment).join(" ");
  return mixerHead + segments;
}
