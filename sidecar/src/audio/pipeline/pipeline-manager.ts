/**
 * Pipeline manager -- registry and coordinator for all active GStreamer pipelines.
 *
 * Manages the full lifecycle of multiple GStreamerProcess instances:
 * creation, starting, stopping, atomic replacement, removal, and crash recovery.
 *
 * Events from individual pipelines are forwarded with pipeline IDs so
 * downstream consumers (WebSocket broadcast, admin UI) can identify the source.
 *
 * Pipeline IDs are GStreamerProcess UUIDs (immutable per instance). After the
 * 260429-hb3 refactor each channel runs ONE pipeline; channelId is the stable
 * external key, pipelineId rotates on every replacePipeline call. The pipeline
 * manager itself stays source-agnostic: it does not inspect source kinds. EOS
 * loop policy lives in the channel manager (which owns the source list).
 */

import { EventEmitter } from "node:events";
import { GStreamerProcess } from "./gstreamer-process.js";
import type {
  ChannelPipelineConfig,
  PipelineState,
  AudioLevels,
  PipelineError,
} from "./pipeline-types.js";
import { logger } from "../../utils/logger.js";
import { toErrorMessage } from "../../utils/error-message.js";

/** Configuration for crash recovery behavior. */
export interface RecoveryConfig {
  readonly autoRestart: boolean;
  readonly maxRestartAttempts: number;
  /**
   * Delay (ms) before the FIRST restart attempt after a crash. Kept short to
   * minimise listener silence on transient external kills. Subsequent attempts
   * use `restartDelayMs` with exponential backoff so flapping devices still
   * get rate-limited.
   */
  readonly firstAttemptDelayMs: number;
  readonly restartDelayMs: number;
  readonly maxRestartDelayMs: number;
  readonly drainTimeoutMs: number;
}

export interface PipelineManagerEvents {
  "pipeline-state-change": (pipelineId: string, state: PipelineState) => void;
  "pipeline-levels": (pipelineId: string, levels: AudioLevels) => void;
  "pipeline-error": (pipelineId: string, error: PipelineError) => void;
  /**
   * Fires for every non-crashed pipeline exit (clean stop or natural EOS).
   * `wasStopRequested` is read at emit time from the live getter, so consumers
   * see the actual flag value rather than a stale closure capture.
   */
  "pipeline-exit": (
    pipelineId: string,
    code: number | null,
    signal: string | null,
    wasStopRequested: boolean,
  ) => void;
}

/**
 * Registry and coordinator for all active GStreamer pipelines.
 *
 * Provides create/start/stop/remove lifecycle methods, forwards events with
 * pipeline IDs, and implements auto-restart with configurable attempt limits.
 */
export class PipelineManager extends EventEmitter {
  /**
   * How long a pipeline must remain in `streaming` state before its restart
   * attempt counter is reset to zero. Prevents transient-streaming crash loops:
   * a flaky source (WASAPI under jitter) can briefly enter `streaming` then
   * crash within ~100ms -- without this gate, the counter resets on every
   * such blip and the backoff never grows, so a degraded device thrashes
   * forever instead of giving up.
   */
  private static readonly STREAMING_STABILITY_MS = 5000;

  private readonly pipelines = new Map<string, GStreamerProcess>();
  private readonly restartAttempts = new Map<string, number>();
  private readonly restartTimers = new Map<string, NodeJS.Timeout>();
  private readonly streamingStabilityTimers = new Map<string, NodeJS.Timeout>();
  private readonly recoveryConfig: RecoveryConfig;
  private isShuttingDown = false;

  constructor(recoveryConfig: RecoveryConfig) {
    super();
    this.recoveryConfig = recoveryConfig;
  }

  /**
   * Create a new pipeline from config without starting it.
   *
   * Wires up event forwarding and crash recovery listeners.
   * Returns the pipeline ID (UUID) for subsequent lifecycle calls.
   */
  createPipeline(config: ChannelPipelineConfig): string {
    const pipeline = new GStreamerProcess(config);
    const pipelineId = pipeline.id;

    this.wireEventForwarding(pipeline);
    this.pipelines.set(pipelineId, pipeline);
    this.restartAttempts.set(pipelineId, 0);

    logger.info(`Pipeline created: "${config.label}"`, { pipelineId });

    return pipelineId;
  }

  /**
   * Atomically swap a running pipeline: stop+remove old, spawn new, return new id.
   *
   * `await this.removePipeline()` already includes the 400ms
   * WINDOWS_SOCKET_RELEASE_DELAY_MS, so NO additional delay is needed
   * (RESEARCH 260429-hb3 §3). Caller is responsible for re-keying any
   * external Maps (e.g. channelPipelines).
   *
   * @throws Error if `oldPipelineId` is not registered.
   */
  async replacePipeline(
    oldPipelineId: string,
    newConfig: ChannelPipelineConfig,
  ): Promise<string> {
    const oldPipeline = this.pipelines.get(oldPipelineId);
    if (!oldPipeline) {
      throw new Error(`replacePipeline: old pipeline not found: ${oldPipelineId}`);
    }
    const oldLabel = oldPipeline.config.label;

    await this.removePipeline(oldPipelineId);

    const newPipelineId = this.createPipeline(newConfig);
    this.startPipeline(newPipelineId);

    logger.info(`Pipeline replaced: "${oldLabel}" -> "${newConfig.label}"`, {
      oldPipelineId,
      newPipelineId,
    });
    return newPipelineId;
  }

  /**
   * Start a pipeline by ID.
   *
   * @throws Error if pipeline ID is not found.
   */
  startPipeline(pipelineId: string): void {
    const pipeline = this.getPipelineOrThrow(pipelineId);
    pipeline.start();
  }

  /**
   * Stop a pipeline by ID. Clears any pending restart timer.
   *
   * @throws Error if pipeline ID is not found.
   */
  async stopPipeline(pipelineId: string): Promise<void> {
    const pipeline = this.getPipelineOrThrow(pipelineId);
    this.clearRestartTimer(pipelineId);
    await pipeline.stop();
  }

  /**
   * Remove a pipeline entirely: stop it, remove all listeners, and delete from registry.
   *
   * A safety-net error handler is attached before stop() to prevent ERR_UNHANDLED_ERROR
   * when buffered stdio data arrives after the exit event but before listeners are removed.
   * A single event-loop tick (setImmediate) allows stdio streams to drain before cleanup.
   */
  async removePipeline(pipelineId: string): Promise<void> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) return;

    this.clearRestartTimer(pipelineId);

    // Safety net: catch errors emitted during shutdown teardown to prevent
    // ERR_UNHANDLED_ERROR when stdio buffers flush after stop resolves
    const safetyErrorHandler = (): void => {};
    pipeline.on("error", safetyErrorHandler);

    await pipeline.stop();

    // Allow one event-loop tick for stdio to drain before removing listeners
    await new Promise<void>((resolve) => setImmediate(resolve));
    pipeline.removeAllListeners();

    this.disarmStreamingStability(pipelineId);
    this.pipelines.delete(pipelineId);
    this.restartAttempts.delete(pipelineId);
    this.restartTimers.delete(pipelineId);

    logger.info(`Pipeline removed: "${pipeline.config.label}"`, { pipelineId });
  }

  /**
   * Get the current state of a pipeline, or null if not found.
   */
  getPipelineState(pipelineId: string): PipelineState | null {
    const pipeline = this.pipelines.get(pipelineId);
    return pipeline ? pipeline.state : null;
  }

  /**
   * Get all pipeline IDs currently in the registry.
   */
  getAllPipelineIds(): string[] {
    return Array.from(this.pipelines.keys());
  }

  /**
   * Get the config of a pipeline, or null if not found.
   */
  getPipelineConfig(pipelineId: string): ChannelPipelineConfig | null {
    const pipeline = this.pipelines.get(pipelineId);
    return pipeline ? pipeline.config : null;
  }

  /**
   * Get the OS process id of a pipeline's gst-launch child, or null if the
   * pipeline is unknown or not currently running. Used by ChannelManager to
   * wire ResourceMonitor on every (re)start of the underlying process.
   */
  getPipelinePid(pipelineId: string): number | null {
    const pipeline = this.pipelines.get(pipelineId);
    return pipeline ? pipeline.pid : null;
  }

  /** Cumulative restart attempts since service start (or since last
   *  5s-stable streaming window, which resets the counter). Surfaces in
   *  listener StatsPanel + admin diagnostics. */
  getRestartCount(pipelineId: string): number {
    return this.restartAttempts.get(pipelineId) ?? 0;
  }

  /**
   * Stop all pipelines concurrently. Clears all restart timers first
   * to prevent zombie restarts during shutdown.
   */
  async stopAll(): Promise<void> {
    this.clearAllRestartTimers();

    const pipelineIds = this.getAllPipelineIds();
    if (pipelineIds.length === 0) return;

    logger.info(`Stopping all pipelines (${pipelineIds.length} total)`);

    const stopResults = await Promise.allSettled(
      pipelineIds.map((id) => {
        const pipeline = this.pipelines.get(id);
        return pipeline ? pipeline.stop() : Promise.resolve();
      }),
    );

    const failedCount = stopResults.filter((r) => r.status === "rejected").length;
    if (failedCount > 0) {
      logger.warn(`${failedCount} pipeline(s) failed to stop cleanly`);
    }

    logger.info(`All pipelines stopped (${pipelineIds.length - failedCount} clean, ${failedCount} failed)`);
  }

  /**
   * Signal shutdown intent: disable auto-restart scheduling and clear pending timers.
   *
   * Called BEFORE streaming teardown begins so that pipeline crashes during
   * the 5-second drain window do not spawn orphaned GStreamer processes.
   * Intentionally separate from stopAll() -- shutdown() is a "prepare" signal,
   * stopAll() is the actual teardown that happens later in audioSubsystem.stop().
   */
  shutdown(): void {
    this.isShuttingDown = true;
    this.clearAllRestartTimers();
    logger.info("PipelineManager shutdown initiated, restart scheduling disabled");
  }

  /**
   * Remove all pipelines: stop, remove listeners, and clear all tracking maps.
   */
  async destroyAll(): Promise<void> {
    this.clearAllRestartTimers();

    const pipelineIds = this.getAllPipelineIds();
    await Promise.allSettled(
      pipelineIds.map((id) => this.removePipeline(id)),
    );

    this.pipelines.clear();
    this.restartAttempts.clear();
    this.restartTimers.clear();

    logger.info("All pipelines destroyed");
  }

  // -- Private helpers --

  /** Retrieve a pipeline by ID, throwing if not found. */
  private getPipelineOrThrow(pipelineId: string): GStreamerProcess {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }
    return pipeline;
  }

  /** Wire up event forwarding from a GStreamerProcess to PipelineManager events. */
  private wireEventForwarding(pipeline: GStreamerProcess): void {
    const pipelineId = pipeline.id;

    pipeline.on("state-change", (state: PipelineState) => {
      // Counter reset is gated by sustained `streaming` -- see armStreamingStability.
      if (state === "streaming") {
        this.armStreamingStability(pipelineId);
      } else {
        this.disarmStreamingStability(pipelineId);
      }
      this.emit("pipeline-state-change", pipelineId, state);
    });

    pipeline.on("levels", (levels: AudioLevels) => {
      this.emit("pipeline-levels", pipelineId, levels);
    });

    pipeline.on("error", (error: PipelineError) => {
      this.emit("pipeline-error", pipelineId, error);
    });

    pipeline.on("exit", (code: number | null, signal: string | null) => {
      if (pipeline.state === "crashed") {
        this.handleCrashedPipeline(pipelineId);
        return;
      }
      // Pipeline manager is source-agnostic: emit a generic exit event with a
      // live `wasStopRequested` snapshot. Channel-manager owns the file-loop
      // decision because only it has the source list (RESEARCH §6 option 2).
      this.emit(
        "pipeline-exit",
        pipelineId,
        code,
        signal,
        pipeline.wasStopRequested,
      );
    });
  }

  /** Handle a crashed pipeline by scheduling a restart if recovery is enabled. */
  private handleCrashedPipeline(pipelineId: string): void {
    if (this.isShuttingDown) return;
    if (!this.recoveryConfig.autoRestart) return;
    if (!this.pipelines.has(pipelineId)) return;

    this.scheduleRestart(pipelineId);
  }

  /**
   * Schedule a restart for a crashed pipeline with exponential backoff.
   *
   * Increments the restart attempt counter. If max attempts are reached,
   * emits an error and does not restart. Successful streaming (detected via
   * state-change listener) resets the counter to zero.
   *
   * Backoff formula: `baseDelay * 2^(attempt-1)`, capped at `maxRestartDelayMs`.
   * This prevents rapid restart loops when a device is unplugged or driver crashes.
   */
  private scheduleRestart(pipelineId: string): void {
    if (this.isShuttingDown) return;
    const attempts = (this.restartAttempts.get(pipelineId) ?? 0) + 1;
    this.restartAttempts.set(pipelineId, attempts);

    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) return;

    const label = pipeline.config.label;

    if (attempts > this.recoveryConfig.maxRestartAttempts) {
      logger.error(
        `Max restart attempts reached for pipeline "${label}" (${attempts - 1}/${this.recoveryConfig.maxRestartAttempts})`,
        { pipelineId },
      );
      const maxAttemptsError: PipelineError = {
        code: "MAX_RESTARTS_EXCEEDED",
        message: `Pipeline "${label}" exceeded maximum restart attempts (${this.recoveryConfig.maxRestartAttempts})`,
        technicalDetails: `Restart attempts exhausted after ${attempts - 1} tries. Manual intervention required.`,
        timestamp: Date.now(),
      };
      this.emit("pipeline-error", pipelineId, maxAttemptsError);
      return;
    }

    const backoffDelayMs = this.computeBackoffDelay(attempts);

    logger.info(
      `Scheduling restart for pipeline "${label}" (attempt ${attempts}/${this.recoveryConfig.maxRestartAttempts}) in ${backoffDelayMs}ms`,
      { pipelineId },
    );

    const timer = setTimeout(() => {
      this.restartTimers.delete(pipelineId);
      if (this.isShuttingDown) return;
      const currentPipeline = this.pipelines.get(pipelineId);
      if (!currentPipeline) return;

      try {
        currentPipeline.start();
      } catch (err) {
        logger.error(
          `Failed to restart pipeline "${label}": ${toErrorMessage(err)}`,
          { pipelineId },
        );
      }
    }, backoffDelayMs);

    this.restartTimers.set(pipelineId, timer);
  }

  /**
   * Compute restart delay.
   *
   * Attempt 1 uses `firstAttemptDelayMs` (fast path -- transient kill recovery).
   * Attempts 2..N use exponential backoff `restartDelayMs * 2^(attempt-2)` so
   * flapping devices get rate-limited (4s, 8s, 16s, capped at maxRestartDelayMs).
   */
  private computeBackoffDelay(attempt: number): number {
    if (attempt <= 1) return this.recoveryConfig.firstAttemptDelayMs;
    const baseDelay = this.recoveryConfig.restartDelayMs;
    const maxDelay = this.recoveryConfig.maxRestartDelayMs;
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 2);
    return Math.min(exponentialDelay, maxDelay);
  }

  /** Clear a pending restart timer for a specific pipeline. */
  private clearRestartTimer(pipelineId: string): void {
    const timer = this.restartTimers.get(pipelineId);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(pipelineId);
    }
  }

  /** Clear all pending restart timers. */
  private clearAllRestartTimers(): void {
    for (const timer of this.restartTimers.values()) {
      clearTimeout(timer);
    }
    this.restartTimers.clear();
    this.clearAllStreamingStabilityTimers();
  }

  /**
   * Arm the streaming-stability timer: if the pipeline stays in `streaming`
   * for STREAMING_STABILITY_MS, the restart attempt counter is reset to zero.
   * Re-arming cancels any prior pending reset.
   */
  private armStreamingStability(pipelineId: string): void {
    this.disarmStreamingStability(pipelineId);
    const timer = setTimeout(() => {
      this.streamingStabilityTimers.delete(pipelineId);
      this.restartAttempts.set(pipelineId, 0);
      logger.debug("Pipeline streaming stable; restart counter reset", { pipelineId });
    }, PipelineManager.STREAMING_STABILITY_MS);
    this.streamingStabilityTimers.set(pipelineId, timer);
  }

  /** Cancel any pending stability timer for a pipeline (called when leaving `streaming`). */
  private disarmStreamingStability(pipelineId: string): void {
    const timer = this.streamingStabilityTimers.get(pipelineId);
    if (!timer) return;
    clearTimeout(timer);
    this.streamingStabilityTimers.delete(pipelineId);
  }

  /** Cancel all pending stability timers (used on shutdown / destroy). */
  private clearAllStreamingStabilityTimers(): void {
    for (const timer of this.streamingStabilityTimers.values()) {
      clearTimeout(timer);
    }
    this.streamingStabilityTimers.clear();
  }
}
