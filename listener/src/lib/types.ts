/**
 * Shared type definitions for the listener PWA.
 *
 * These types mirror the server-side ListenerChannelInfo from
 * sidecar/src/streaming/streaming-types.ts. Defined locally to
 * avoid cross-project imports.
 */

/** Channel info pushed from the server via protoo notifications. */
export interface ListenerChannelInfo {
  readonly id: string;
  readonly name: string;
  readonly outputFormat: "mono" | "stereo";
  readonly defaultChannel: boolean;
  readonly hasActiveProducer: boolean;
  readonly latencyMode: "live" | "stable";
  readonly lossRecovery: "nack" | "plc";
  readonly description: string;
  readonly language: {
    readonly code: string;
    readonly label: string;
    readonly flag: string;
  };
  readonly listenerCount: number;
  readonly displayToggles: {
    readonly showDescription: boolean;
    readonly showListenerCount: boolean;
    readonly showLiveBadge: boolean;
  };

  // ---- Telemetry (sidecar Round 1) — all optional for forward compat. ----
  /** Wall-clock ms when the producer started; null when offline. */
  readonly producerStartedAt?: number | null;
  /** Speech / Music — server-truth processing mode. */
  readonly processingMode?: "speech" | "music";
  /** Real source device name (e.g. "USB: Wireless Mic"). */
  readonly sourceLabel?: string;
  /** Cumulative GStreamer pipeline restarts since service start. */
  readonly pipelineRestartCount?: number;
  /** Server-truth codec parameters. */
  readonly codec?: {
    readonly mimeType: string;
    readonly sampleRateHz: number;
    readonly channels: number;
    readonly bitrateKbps: number;
    readonly fec: boolean;
    readonly frameSizeMs: number;
  };
}

/** Per-channel audio-level snapshot pushed via "audioLevels" notifications. */
export interface ChannelAudioLevel {
  readonly channelId: string;
  readonly rms: number[];
  readonly rmsDb: number[];
  readonly clipping: boolean;
}
