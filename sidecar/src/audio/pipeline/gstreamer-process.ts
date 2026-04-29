/**
 * GStreamer child process wrapper.
 *
 * Wraps a single `gst-launch-1.0` child process with full lifecycle management:
 * spawning, state tracking, stdout metering, graceful shutdown, and error handling.
 *
 * Each audio source runs as a separate GStreamer process for fault isolation --
 * killing one process does not affect other running pipelines.
 *
 * IMPORTANT: Never reuse a gst-launch-1.0 process. Always kill and spawn new
 * (Research Pitfall 3). The process is one-shot: start -> (run) -> stop/crash.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { buildPipelineString, buildChannelPipelineString } from "./pipeline-builder.js";
import { createBusMessageLineParser } from "./metering-parser.js";
import type {
  AnyPipelineConfig,
  PipelineState,
  AudioLevels,
  PipelineError,
} from "./pipeline-types.js";
import { logger } from "../../utils/logger.js";

/** Default drain timeout in milliseconds before SIGKILL on stop. */
const DEFAULT_DRAIN_TIMEOUT_MS = 500;

/**
 * Settle window after the cmd.exe wrapper exits on Windows, before stop()
 * resolves. The gst-launch.exe grandchild releases its UDP sockets (notably
 * the rtp udpsink bind-port) a few hundred ms after the parent shell dies;
 * resolving stop() too early lets the next pipeline race to bind the same
 * port and lose, falling back to an ephemeral port that mediasoup ignores.
 */
const WINDOWS_SOCKET_RELEASE_DELAY_MS = 400;

/** Whether the current platform is Windows. */
const IS_WINDOWS = process.platform === "win32";

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
  readonly config: AnyPipelineConfig;

  private currentState: PipelineState = "stopped";
  private childProcess: ChildProcess | null = null;
  private currentPid: number | null = null;
  private processStartedAt: number | null = null;
  private stopRequested = false;

  constructor(config: AnyPipelineConfig) {
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

  /**
   * Whether the most recent exit was triggered by a `stop()` call (user/system
   * request) versus the process exiting on its own (EOS or crash). Used by
   * supervising code to distinguish "user stopped this" from "stream ended
   * naturally" (e.g. file source EOS for loop-restart).
   */
  get wasStopRequested(): boolean {
    return this.stopRequested;
  }

  /** Timestamp (ms since epoch) when the process was last started, null if never started. */
  get startedAt(): number | null {
    return this.processStartedAt;
  }

  /**
   * Spawn the gst-launch-1.0 child process.
   *
   * Builds the pipeline string from config, spawns with -m (bus messages) and -e (EOS on interrupt),
   * and wires up stdout parsing for level metering and stderr for error detection.
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

    // Self-explanatory: presence of `sources` field uniquely identifies
    // ChannelPipelineConfig (multi-source). Otherwise legacy PipelineConfig
    // (per-source). Task 7 collapses this once channel-manager only emits
    // ChannelPipelineConfig.
    const pipelineString = "sources" in this.config
      ? buildChannelPipelineString(this.config)
      : buildPipelineString(this.config);

    logger.info(`Spawning GStreamer pipeline "${this.config.label}"`, {
      pipelineId: this.id,
      pipelineString,
    });

    // shell: true is REQUIRED on Windows. With shell: false, Node's argv quoting
    // escapes the inner `"..."` quotes around device IDs (e.g. wasapi2src
    // device="{...}"), and gst-launch's argv parser doesn't unescape them
    // correctly -- result is "erroneous pipeline: syntax error" for ALL pipelines.
    // shell: true means cmd.exe parses the command line, which preserves the
    // pipeline string as gst-launch's pipeline parser expects to receive it.
    //
    // CONSEQUENCE: On Windows the direct child is cmd.exe, and gst-launch-1.0.exe
    // is the GRANDCHILD. `child.kill()` calls TerminateProcess on cmd.exe ONLY,
    // which orphans gst-launch.exe (re-parented to System, keeps running, holds
    // file/device + RTP socket forever). MUST tree-kill via `taskkill /F /T /PID`
    // -- see `terminateWindowsProcessTree`.
    //
    // Side effect: file paths with spaces won't survive cmd.exe's quote handling.
    // Mitigated upstream by `SourceRegistry.registerTestSources` which copies
    // file sources to a sanitized no-spaces path before they reach the pipeline.
    const child = spawn("gst-launch-1.0", ["-m", "-e", pipelineString], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.childProcess = child;
    this.currentPid = child.pid ?? null;
    this.processStartedAt = Date.now();

    this.attachStdoutLevelParser(child);
    this.attachStderrErrorDetector(child);
    this.attachExitHandler(child);
    this.attachSpawnErrorHandler(child);

    this.transitionState("connecting");
  }

  /**
   * Gracefully stop the child process.
   *
   * Platform-specific shutdown strategy:
   * - **Unix**: Sends SIGINT which triggers EOS processing when gst-launch-1.0
   *   runs with the `-e` flag. Falls back to SIGKILL after drain timeout.
   * - **Windows**: Closes stdin (best-effort cleanup hint), waits for the drain
   *   window, then tree-kills via `taskkill /F /T /PID <cmdPid>` so the
   *   gst-launch.exe GRANDCHILD is also terminated. `child.kill()` alone only
   *   kills the cmd.exe shell wrapper, leaving gst-launch.exe orphaned.
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
      const cmdPid = child.pid ?? null;

      // Resolve once the process exits. On Windows, child.exit fires when
      // the cmd.exe shell wrapper exits, but the gst-launch.exe grandchild's
      // UDP sockets (notably the rtp udpsink bind-port) take ~50-200ms more
      // to release back to the kernel. If the next pipeline tries to bind
      // the same port immediately, bind fails and udpsink falls back to an
      // ephemeral source port -- mediasoup's PlainTransport (locked to the
      // original tuple by comedia) then silently drops every packet. The
      // settling delay below gives the kernel time to reclaim the socket
      // before the caller respawns.
      const onExit = (): void => {
        clearTimeout(killTimer);
        if (IS_WINDOWS) {
          setTimeout(resolve, WINDOWS_SOCKET_RELEASE_DELAY_MS);
          return;
        }
        resolve();
      };
      child.once("exit", onExit);

      this.sendShutdownSignal(child);

      // Force-kill fallback if process does not exit within drain timeout.
      // On Windows, MUST tree-kill: `child.kill()` only kills the cmd.exe shell,
      // leaving gst-launch.exe orphaned (re-parented, keeps holding device).
      const killTimer = setTimeout(() => {
        if (!this.childProcess) return;
        logger.warn(
          `Pipeline "${this.config.label}" did not exit within ${drainTimeout}ms, force-killing`,
          { pipelineId: this.id },
        );
        if (IS_WINDOWS && cmdPid !== null) {
          this.terminateWindowsProcessTree(cmdPid);
        } else {
          child.kill("SIGKILL");
        }
      }, drainTimeout);
    });
  }

  /**
   * Send a platform-appropriate shutdown signal to the GStreamer child process.
   *
   * - Unix: SIGINT triggers EOS drain when `-e` flag is active.
   * - Windows: Close stdin as a best-effort cleanup hint. Node.js on Windows
   *   maps all kill signals to `TerminateProcess()` (instant kill, no EOS) and
   *   only on the cmd.exe direct child -- so the force-kill timer relies on
   *   `taskkill /F /T` to actually reach the gst-launch grandchild.
   */
  private sendShutdownSignal(child: ChildProcess): void {
    if (IS_WINDOWS) {
      // Close stdin — gst-launch-1.0 may detect EOF and begin teardown.
      // This is best-effort; the force-kill timer guarantees termination.
      try {
        child.stdin?.end();
      } catch {
        // stdin may already be closed or destroyed
      }
      logger.debug(`Pipeline "${this.config.label}" stdin closed (Windows shutdown)`, {
        pipelineId: this.id,
      });
    } else {
      // SIGINT triggers EOS processing in gst-launch-1.0 with -e flag
      child.kill("SIGINT");
    }
  }

  /**
   * Tree-kill a Windows process subtree rooted at `pid`.
   *
   * Why: when `spawn(..., { shell: true })` is used on Windows, Node spawns
   * cmd.exe as the direct child and gst-launch-1.0.exe as a GRANDCHILD.
   * `ChildProcess.kill()` invokes TerminateProcess on the cmd.exe handle only,
   * orphaning the grandchild (re-parented, keeps holding device handles, RTP
   * sockets, file descriptors). `taskkill /F /T /PID <cmdPid>` walks the
   * descendant tree and force-terminates every process in it.
   *
   * Synchronous spawn: terminating an audio pipeline must complete before the
   * stop() Promise resolves so the caller can immediately reuse device/port.
   */
  private terminateWindowsProcessTree(pid: number): void {
    try {
      const result = spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
        windowsHide: true,
        stdio: "ignore",
      });
      if (result.error) {
        logger.error(
          `taskkill failed for pipeline "${this.config.label}" (pid ${pid}): ${result.error.message}`,
          { pipelineId: this.id },
        );
      } else if (result.status !== 0) {
        // status 128 = process not found (already exited) -- benign.
        logger.debug(
          `taskkill exited ${result.status} for pipeline "${this.config.label}" (pid ${pid})`,
          { pipelineId: this.id },
        );
      }
    } catch (err) {
      logger.error(
        `taskkill threw for pipeline "${this.config.label}" (pid ${pid}): ${
          err instanceof Error ? err.message : String(err)
        }`,
        { pipelineId: this.id },
      );
    }
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

  /** Attach stdout parser for level metering from gst-launch-1.0 -m bus messages. */
  private attachStdoutLevelParser(child: ChildProcess): void {
    if (!child.stdout) return;

    const parseChunk = createBusMessageLineParser(
      (levels: AudioLevels) => {
        this.emit("levels", levels);
        // First level data = pipeline is actively streaming
        if (PRE_STREAMING_STATES.has(this.currentState)) {
          this.transitionState("streaming");
        }
      },
      (errorLine: string) => {
        // Defense-in-depth: catch error patterns on stdout if GStreamer ever sends them here
        const pipelineError: PipelineError = {
          code: "GSTREAMER_ERROR",
          message: `GStreamer error in pipeline "${this.config.label}"`,
          technicalDetails: errorLine,
          timestamp: Date.now(),
        };
        this.emit("error", pipelineError);
      },
    );

    child.stdout.on("data", parseChunk);
  }

  /** Attach stderr error detector for GStreamer errors and warnings. */
  private attachStderrErrorDetector(child: ChildProcess): void {
    if (!child.stderr) return;

    const GSTREAMER_ERROR_PATTERN = /\b(?:ERROR|WARN|WARNING|CRITICAL)\b/i;
    let partialLine = "";

    child.stderr.on("data", (chunk: Buffer) => {
      const text = partialLine + chunk.toString("utf-8");
      const lines = text.split("\n");
      partialLine = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (line.length === 0) continue;

        if (GSTREAMER_ERROR_PATTERN.test(line)) {
          const pipelineError: PipelineError = {
            code: "GSTREAMER_ERROR",
            message: `GStreamer error in pipeline "${this.config.label}"`,
            technicalDetails: line,
            timestamp: Date.now(),
          };
          this.emit("error", pipelineError);
        } else {
          logger.debug(`Pipeline "${this.config.label}" stderr: ${line}`, {
            pipelineId: this.id,
          });
        }
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
