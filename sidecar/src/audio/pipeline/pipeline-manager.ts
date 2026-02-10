/**
 * Pipeline manager -- registry and coordinator for all active GStreamer pipelines.
 *
 * Manages the full lifecycle of multiple GStreamerProcess instances:
 * creation, starting, stopping, removal, and crash recovery.
 *
 * Events from individual pipelines are forwarded with pipeline IDs so
 * downstream consumers (WebSocket broadcast, admin UI) can identify the source.
 *
 * Pipeline IDs are GStreamerProcess UUIDs, not channel IDs. One channel may
 * have multiple pipelines. The channel manager (Plan 08) maps channel IDs
 * to pipeline IDs.
 */

import { EventEmitter } from "node:events";
import { GStreamerProcess } from "./gstreamer-process.js";
import type {
  PipelineConfig,
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
  readonly restartDelayMs: number;
  readonly maxRestartDelayMs: number;
  readonly drainTimeoutMs: number;
}

export interface PipelineManagerEvents {
  "pipeline-state-change": (pipelineId: string, state: PipelineState) => void;
  "pipeline-levels": (pipelineId: string, levels: AudioLevels) => void;
  "pipeline-error": (pipelineId: string, error: PipelineError) => void;
}

/**
 * Registry and coordinator for all active GStreamer pipelines.
 *
 * Provides create/start/stop/remove lifecycle methods, forwards events with
 * pipeline IDs, and implements auto-restart with configurable attempt limits.
 */
export class PipelineManager extends EventEmitter {
  private readonly pipelines = new Map<string, GStreamerProcess>();
  private readonly restartAttempts = new Map<string, number>();
  private readonly restartTimers = new Map<string, NodeJS.Timeout>();
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
  createPipeline(config: PipelineConfig): string {
    const pipeline = new GStreamerProcess(config);
    const pipelineId = pipeline.id;

    this.wireEventForwarding(pipeline);
    this.pipelines.set(pipelineId, pipeline);
    this.restartAttempts.set(pipelineId, 0);

    logger.info(`Pipeline created: "${config.label}"`, { pipelineId });

    return pipelineId;
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
  getPipelineConfig(pipelineId: string): PipelineConfig | null {
    const pipeline = this.pipelines.get(pipelineId);
    return pipeline ? pipeline.config : null;
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
      // Successful streaming resets the restart counter
      if (state === "streaming") {
        this.restartAttempts.set(pipelineId, 0);
      }
      this.emit("pipeline-state-change", pipelineId, state);
    });

    pipeline.on("levels", (levels: AudioLevels) => {
      this.emit("pipeline-levels", pipelineId, levels);
    });

    pipeline.on("error", (error: PipelineError) => {
      this.emit("pipeline-error", pipelineId, error);
    });

    pipeline.on("exit", (_code: number | null, _signal: string | null) => {
      if (pipeline.state === "crashed") {
        this.handleCrashedPipeline(pipelineId);
      }
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
   * Compute exponential backoff delay: `baseDelay * 2^(attempt-1)`, capped.
   *
   * Attempt 1 = baseDelay, attempt 2 = 2x, attempt 3 = 4x, etc.
   * Capped at maxRestartDelayMs to prevent absurdly long waits.
   */
  private computeBackoffDelay(attempt: number): number {
    const baseDelay = this.recoveryConfig.restartDelayMs;
    const maxDelay = this.recoveryConfig.maxRestartDelayMs;
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
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
  }
}
