/**
 * GStreamer child process wrapper.
 *
 * Wraps a single `gst-launch-1.0` child process with full lifecycle management:
 * spawning, state tracking, stderr metering, graceful shutdown, and error handling.
 *
 * Each audio source runs as a separate GStreamer process for fault isolation --
 * killing one process does not affect other running pipelines.
 *
 * IMPORTANT: Never reuse a gst-launch-1.0 process. Always kill and spawn new
 * (Research Pitfall 3). The process is one-shot: start -> (run) -> stop/crash.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { buildPipelineString } from "./pipeline-builder.js";
import { createStderrLineParser } from "./metering-parser.js";
import type {
  PipelineConfig,
  PipelineState,
  AudioLevels,
  PipelineError,
} from "./pipeline-types.js";
import { logger } from "../../utils/logger.js";

/** Default drain timeout in milliseconds before SIGKILL on stop. */
const DEFAULT_DRAIN_TIMEOUT_MS = 500;

/** States in which the pipeline process is considered actively running. */
const RUNNING_STATES: ReadonlySet<PipelineState> = new Set([
  "initializing",
  "connecting",
  "buffering",
  "streaming",
]);

/** States that transition to "streaming" upon receiving the first level data. */
const PRE_STREAMING_STATES: ReadonlySet<PipelineState> = new Set([
  "initializing",
  "connecting",
  "buffering",
]);

export interface GStreamerProcessEvents {
  "state-change": (state: PipelineState) => void;
  levels: (levels: AudioLevels) => void;
  error: (error: PipelineError) => void;
  exit: (code: number | null, signal: string | null) => void;
}

/**
 * Wraps a single gst-launch-1.0 child process.
 *
 * Emits typed events for state changes, audio level metering, errors, and exit.
 * The process is one-shot: each instance represents one lifecycle from start to stop/crash.
 */
export class GStreamerProcess extends EventEmitter {
  readonly id: string;
  readonly config: PipelineConfig;

  private currentState: PipelineState = "stopped";
  private childProcess: ChildProcess | null = null;
  private currentPid: number | null = null;
  private processStartedAt: number | null = null;
  private stopRequested = false;

  constructor(config: PipelineConfig) {
    super();
    this.id = randomUUID();
    this.config = config;
  }

  /** Current lifecycle state of this pipeline process. */
  get state(): PipelineState {
    return this.currentState;
  }

  /** PID of the child process when running, null otherwise. */
  get pid(): number | null {
    return this.currentPid;
  }

  /** Timestamp (ms since epoch) when the process was last started, null if never started. */
  get startedAt(): number | null {
    return this.processStartedAt;
  }

  /**
   * Spawn the gst-launch-1.0 child process.
   *
   * Builds the pipeline string from config, spawns with -m (bus messages) and -e (EOS on interrupt),
   * and wires up stderr parsing for level metering and error detection.
   *
   * @throws Error if the process is already running.
   */
  start(): void {
    if (RUNNING_STATES.has(this.currentState)) {
      throw new Error(
        `Cannot start pipeline "${this.config.label}" (${this.id}): already in state "${this.currentState}"`,
      );
    }

    this.stopRequested = false;
    this.transitionState("initializing");

    const pipelineString = buildPipelineString(this.config);

    logger.info(`Spawning GStreamer pipeline "${this.config.label}"`, {
      pipelineId: this.id,
      pipelineString,
    });

    // Use shell: true on Windows -- the pipeline string contains characters
    // (!, =, quotes) that need shell interpretation by gst-launch-1.0.
    const child = spawn("gst-launch-1.0", ["-m", "-e", pipelineString], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.childProcess = child;
    this.currentPid = child.pid ?? null;
    this.processStartedAt = Date.now();

    this.attachStderrParser(child);
    this.attachStdoutHandler(child);
    this.attachExitHandler(child);
    this.attachSpawnErrorHandler(child);

    this.transitionState("connecting");
  }

  /**
   * Gracefully stop the child process.
   *
   * Sends SIGTERM (gst-launch-1.0 with -e handles EOS cleanly on SIGTERM),
   * then falls back to SIGKILL after the drain timeout.
   *
   * @returns Promise that resolves when the process has exited.
   */
  stop(): Promise<void> {
    if (!this.childProcess || !RUNNING_STATES.has(this.currentState)) {
      return Promise.resolve();
    }

    this.stopRequested = true;
    this.transitionState("stopping");

    return new Promise<void>((resolve) => {
      const child = this.childProcess;
      if (!child) {
        resolve();
        return;
      }

      const drainTimeout = DEFAULT_DRAIN_TIMEOUT_MS;

      // Resolve once the process exits (either from SIGTERM or SIGKILL)
      const onExit = (): void => {
        clearTimeout(killTimer);
        resolve();
      };
      child.once("exit", onExit);

      // Send SIGTERM for graceful EOS shutdown
      child.kill("SIGTERM");

      // SIGKILL fallback if process does not exit within drain timeout
      const killTimer = setTimeout(() => {
        if (this.childProcess) {
          logger.warn(
            `Pipeline "${this.config.label}" did not exit within ${drainTimeout}ms, sending SIGKILL`,
            { pipelineId: this.id },
          );
          child.kill("SIGKILL");
        }
      }, drainTimeout);
    });
  }

  /**
   * Returns elapsed time in milliseconds since the process was started.
   * Returns 0 if the process is not running.
   */
  getUptime(): number {
    if (this.processStartedAt === null || !RUNNING_STATES.has(this.currentState)) {
      return 0;
    }
    return Date.now() - this.processStartedAt;
  }

  // -- Private helpers --

  /** Transition to a new state and emit the state-change event. */
  private transitionState(newState: PipelineState): void {
    const previousState = this.currentState;
    this.currentState = newState;
    logger.debug(`Pipeline "${this.config.label}" state: ${previousState} -> ${newState}`, {
      pipelineId: this.id,
    });
    this.emit("state-change", newState);
  }

  /** Attach stderr line parser for level metering and error detection. */
  private attachStderrParser(child: ChildProcess): void {
    if (!child.stderr) return;

    const parseChunk = createStderrLineParser(
      (levels: AudioLevels) => {
        this.emit("levels", levels);
        // First level data = pipeline is actively streaming
        if (PRE_STREAMING_STATES.has(this.currentState)) {
          this.transitionState("streaming");
        }
      },
      (errorLine: string) => {
        const pipelineError: PipelineError = {
          code: "GSTREAMER_ERROR",
          message: `GStreamer error in pipeline "${this.config.label}"`,
          technicalDetails: errorLine,
          timestamp: Date.now(),
        };
        this.emit("error", pipelineError);
      },
    );

    child.stderr.on("data", parseChunk);
  }

  /** Attach stdout handler to log debug output from gst-launch-1.0. */
  private attachStdoutHandler(child: ChildProcess): void {
    if (!child.stdout) return;

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8").trimEnd();
      if (text.length > 0) {
        logger.debug(`Pipeline "${this.config.label}" stdout: ${text}`, {
          pipelineId: this.id,
        });
      }
    });
  }

  /** Attach exit handler for process termination. */
  private attachExitHandler(child: ChildProcess): void {
    child.on("exit", (code, signal) => {
      if (code === 0 || this.stopRequested) {
        this.transitionState("stopped");
      } else {
        this.transitionState("crashed");
        const crashError: PipelineError = {
          code: "PROCESS_CRASH",
          message: `Pipeline "${this.config.label}" crashed with exit code ${code}`,
          technicalDetails: `Exit code: ${code}, signal: ${signal}`,
          timestamp: Date.now(),
        };
        this.emit("error", crashError);
      }

      this.emit("exit", code, signal);
      this.cleanupProcess();
    });
  }

  /**
   * Attach spawn error handler.
   * Handles ENOENT (gst-launch-1.0 not found) with a clear installation message.
   */
  private attachSpawnErrorHandler(child: ChildProcess): void {
    child.on("error", (err: NodeJS.ErrnoException) => {
      const isNotFound = err.code === "ENOENT";
      const errorMessage = isNotFound
        ? "GStreamer not found. Install GStreamer 1.26 and add to PATH."
        : `Failed to spawn gst-launch-1.0: ${err.message}`;

      logger.error(errorMessage, {
        pipelineId: this.id,
        label: this.config.label,
        errorCode: err.code,
      });

      this.transitionState("crashed");

      const spawnError: PipelineError = {
        code: isNotFound ? "GSTREAMER_NOT_FOUND" : "SPAWN_ERROR",
        message: errorMessage,
        technicalDetails: err.stack ?? err.message,
        timestamp: Date.now(),
      };
      this.emit("error", spawnError);
    });
  }

  /** Clean up child process references after exit. */
  private cleanupProcess(): void {
    this.childProcess = null;
    this.currentPid = null;
  }
}
