/**
 * Pipeline process management type definitions.
 *
 * These types model the lifecycle, configuration, metering, and error handling
 * of GStreamer child processes spawned by the Node.js sidecar.
 */

import type { AudioApi } from "../sources/source-types";
import type { ProcessingConfig } from "../processing/processing-types";

/** GStreamer pipeline lifecycle state. */
export type PipelineState =
  | "initializing"
  | "connecting"
  | "buffering"
  | "streaming"
  | "stopping"
  | "stopped"
  | "crashed";

/**
 * Audio level data parsed from GStreamer `level` element messages.
 *
 * All dB values are negative (0 dB = full scale).
 * Arrays contain one value per audio channel in the pipeline.
 */
export interface AudioLevels {
  readonly peak: number[];
  readonly rms: number[];
  readonly decay: number[];
  readonly timestamp: number;
  readonly clipping: boolean;
}

/**
 * Runtime resource usage stats for a single GStreamer pipeline process.
 *
 * Populated via `pidusage` polling of the child process PID.
 */
export interface PipelineStats {
  readonly cpuPercent: number;
  readonly memoryMb: number;
  readonly uptimeMs: number;
  readonly pid: number;
}

/**
 * Structured error from a GStreamer pipeline process.
 *
 * Separates user-friendly message from full GStreamer error output
 * so the admin UI can show a clean message with expandable details.
 */
export interface PipelineError {
  readonly code: string;
  readonly message: string;
  readonly technicalDetails: string;
  readonly timestamp: number;
}

/** AES67-specific pipeline configuration for multicast RTP reception. */
export interface Aes67PipelineConfig {
  readonly multicastAddress: string;
  readonly port: number;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly bitDepth: number;
  readonly payloadType: number;
  readonly selectedChannels: number[];
}

/**
 * File-backed test source configuration.
 *
 * Drives a `multifilesrc` GStreamer pipeline that decodes and loops a media
 * file. Used for verifying meters and downstream encode/stream paths without
 * real audio hardware.
 */
export interface FilePipelineConfig {
  readonly filePath: string;
  readonly loop: boolean;
  readonly selectedChannels: number[];
}

/** Local device-specific pipeline configuration. */
export interface LocalPipelineConfig {
  readonly deviceId: string;
  readonly api: AudioApi;
  readonly selectedChannels: number[];
  /**
   * Total channel count reported by the source device. Used so the pipeline
   * builder can detect "all channels selected" and skip deinterleave/interleave
   * (which is fragile and can fail with `not-negotiated`). Optional for
   * backward compatibility with sources that don't report a count.
   */
  readonly totalChannelCount?: number;
  readonly bufferSize?: number;
  readonly isLoopback?: boolean;
}

/**
 * Complete configuration needed to construct and run a GStreamer pipeline.
 *
 * Discriminated by `sourceType`: exactly one of `aes67Config` or `localConfig`
 * will be populated based on the source type.
 *
 * When `processing` is present, the pipeline builder produces a Phase 3
 * processing + encoding pipeline (AGC -> Opus -> RTP).
 * When `processing` is undefined, it produces the Phase 2 metering-only pipeline.
 */
export type PipelineConfig = {
  readonly levelIntervalMs: number;
  readonly label: string;
  readonly processing?: ProcessingConfig;
} & (
  | { readonly sourceType: "aes67"; readonly aes67Config: Aes67PipelineConfig; readonly localConfig?: never; readonly fileConfig?: never }
  | { readonly sourceType: "local"; readonly localConfig: LocalPipelineConfig; readonly aes67Config?: never; readonly fileConfig?: never }
  | { readonly sourceType: "file"; readonly fileConfig: FilePipelineConfig; readonly aes67Config?: never; readonly localConfig?: never }
);

/**
 * A single source within a multi-source channel pipeline.
 *
 * `mixerPadName` is the literal pipeline-string token like `mix.sink_0` that
 * the corresponding source segment terminates at. Caller assigns these in
 * source-array order so the segments map to GstAudioMixerPad indices.
 *
 * Per-source `audiopanorama` is intentionally absent: the channel-selection
 * step inside the source head (see `buildSingleChannelExtraction`) places
 * panorama for stereo single-channel selection. Adding another panorama
 * element here would double-pan.
 */
export interface SourceSegment {
  readonly source:
    | { readonly kind: "file"; readonly config: FilePipelineConfig }
    | { readonly kind: "local"; readonly config: LocalPipelineConfig }
    | { readonly kind: "aes67"; readonly config: Aes67PipelineConfig };
  readonly assignment: {
    readonly sourceId: string;
    readonly gain: number;
    readonly muted: boolean;
    readonly delayMs: number;
  };
  readonly mixerPadName: string;
}

/**
 * Multi-source channel pipeline config. One gst-launch process per channel
 * with N sources combined via `audiomixer name=mix`.
 *
 * `shouldLoopOnEos` is a derived flag set by the channel manager: true when
 * every source is `kind: "file"` AND that file's config has `loop=true`.
 * Channel manager uses this to schedule a loop-restart on clean EOS without
 * the pipeline manager needing to know anything about source kinds.
 *
 * @example
 * const cfg: ChannelPipelineConfig = {
 *   label: "English - Mic A + Mic B",
 *   levelIntervalMs: 50,
 *   processing: { ...processingConfig },
 *   sources: [
 *     { source: { kind: "local", config: micA }, assignment: a0, mixerPadName: "mix.sink_0" },
 *     { source: { kind: "local", config: micB }, assignment: a1, mixerPadName: "mix.sink_1" },
 *   ],
 *   shouldLoopOnEos: false,
 * };
 */
export interface ChannelPipelineConfig {
  readonly label: string;
  readonly levelIntervalMs: number;
  readonly processing: ProcessingConfig;
  readonly sources: ReadonlyArray<SourceSegment>;
  readonly shouldLoopOnEos: boolean;
}

/**
 * Union of single-source and multi-source pipeline configs. Bridge type used
 * during the migration from per-source pipelines to one-pipeline-per-channel.
 * Task 7 collapses this back to `ChannelPipelineConfig` once `PipelineConfig`
 * has no remaining callers.
 */
export type AnyPipelineConfig = PipelineConfig | ChannelPipelineConfig;
