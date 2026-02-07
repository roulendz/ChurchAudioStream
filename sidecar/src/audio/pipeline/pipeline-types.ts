/**
 * Pipeline process management type definitions.
 *
 * These types model the lifecycle, configuration, metering, and error handling
 * of GStreamer child processes spawned by the Node.js sidecar.
 */

import type { AudioApi } from "../sources/source-types";

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

/** Local device-specific pipeline configuration. */
export interface LocalPipelineConfig {
  readonly deviceId: string;
  readonly api: AudioApi;
  readonly selectedChannels: number[];
  readonly bufferSize?: number;
  readonly isLoopback?: boolean;
}

/**
 * Complete configuration needed to construct and run a GStreamer pipeline.
 *
 * Discriminated by `sourceType`: exactly one of `aes67Config` or `localConfig`
 * will be populated based on the source type.
 */
export type PipelineConfig = {
  readonly levelIntervalMs: number;
  readonly label: string;
} & (
  | { readonly sourceType: "aes67"; readonly aes67Config: Aes67PipelineConfig; readonly localConfig?: never }
  | { readonly sourceType: "local"; readonly localConfig: LocalPipelineConfig; readonly aes67Config?: never }
);
