/**
 * mediasoup Worker lifecycle management.
 *
 * Creates a configurable pool of mediasoup C++ workers, monitors their
 * memory usage via a delegated helper, and auto-restarts crashed workers.
 *
 * Events emitted:
 * - "worker-died"          { workerIndex, error }
 * - "worker-restarted"     { workerIndex }
 * - "workers-restarted"    (no payload)
 * - "worker-memory-warning" { workerIndex, memoryMb, thresholdMb }
 * - "worker-resource-update" { workerIndex, peakMemoryKb }
 */

import { EventEmitter } from "node:events";
import * as path from "node:path";
import * as fs from "node:fs";
import * as mediasoup from "mediasoup";
import type { types as mediasoupTypes } from "mediasoup";
import type { WorkerState, WorkerResourceInfo } from "./streaming-types.js";
import { logger } from "../utils/logger.js";
import { toErrorMessage } from "../utils/error-message.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKER_MEMORY_WARNING_THRESHOLD_KB = 512_000; // 500 MB
const WORKER_MEMORY_CHECK_INTERVAL_MS = 60_000; // 60 seconds

// ---------------------------------------------------------------------------
// pkg-safe mediasoup worker binary resolution
// ---------------------------------------------------------------------------

/**
 * Build the list of directories where mediasoup-worker might live.
 *
 * When the sidecar runs as a pkg binary inside Tauri, the default
 * mediasoup resolution points into the virtual `C:\snapshot\...`
 * filesystem which cannot contain native executables. We search:
 *
 *  1. Next to the compiled executable  (process.execPath dir)
 *  2. `binaries/` subdirectory         (Tauri resources preserve relative paths)
 *  3. Current working directory         (fallback)
 *  4. `binaries/` under cwd            (fallback for Tauri resource layout)
 */
function buildWorkerBinCandidateDirs(): string[] {
  const exeDir = path.dirname(process.execPath);
  const cwd = process.cwd();
  const dirs = [
    exeDir,
    path.join(exeDir, "binaries"),
    cwd,
    path.join(cwd, "binaries"),
  ];

  // Deduplicate (exeDir and cwd may be the same)
  return [...new Set(dirs.map((d) => path.resolve(d)))];
}

/**
 * Resolve the mediasoup-worker binary path.
 *
 * Inside a pkg snapshot (`process.execPath` points to the compiled binary),
 * mediasoup's default resolution returns a `C:\snapshot\...` path that
 * doesn't exist on disk. In that case, search several candidate directories
 * where Tauri may have placed the worker binary as a bundled resource.
 */
function resolveWorkerBin(): string | undefined {
  // If env explicitly set, honour it
  if (process.env["MEDIASOUP_WORKER_BIN"]) {
    return process.env["MEDIASOUP_WORKER_BIN"];
  }

  const defaultBin = mediasoup.workerBin;

  // If the default path exists on disk, mediasoup can find it (dev mode)
  if (fs.existsSync(defaultBin) || fs.existsSync(defaultBin + ".exe")) {
    return undefined; // let mediasoup use its default
  }

  // pkg mode: search candidate directories for the worker binary
  const workerName =
    process.platform === "win32" ? "mediasoup-worker.exe" : "mediasoup-worker";

  const candidateDirs = buildWorkerBinCandidateDirs();

  for (const dir of candidateDirs) {
    const candidate = path.join(dir, workerName);
    if (fs.existsSync(candidate)) {
      logger.info(`Using mediasoup worker found at: ${candidate}`);
      return candidate;
    }
  }

  // Not found — log all searched paths to aid debugging, then let mediasoup
  // throw its normal ENOENT error with the default path.
  const searchedPaths = candidateDirs
    .map((dir) => path.join(dir, workerName))
    .join(", ");
  logger.warn(
    `mediasoup-worker not found at default path (${defaultBin}) or any candidate: ${searchedPaths}`,
  );
  return undefined;
}

const resolvedWorkerBin = resolveWorkerBin();

// ---------------------------------------------------------------------------
// WorkerMemoryMonitor (private helper -- SRP)
// ---------------------------------------------------------------------------

/**
 * Periodically checks a single worker's memory usage and invokes callbacks
 * when thresholds are exceeded. Separated from WorkerManager per SRP so
 * Phase 8 worker-rotation logic can be added without modifying WorkerManager.
 */
class WorkerMemoryMonitor {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly worker: mediasoupTypes.Worker,
    private readonly workerIndex: number,
    private readonly onWarning: (info: {
      workerIndex: number;
      memoryMb: number;
      thresholdMb: number;
    }) => void,
    private readonly onResourceUpdate: (info: {
      workerIndex: number;
      peakMemoryKb: number;
    }) => void,
  ) {}

  start(): void {
    this.intervalHandle = setInterval(async () => {
      try {
        const usage = await this.worker.getResourceUsage();
        const peakMemoryKb = usage.ru_maxrss;

        this.onResourceUpdate({
          workerIndex: this.workerIndex,
          peakMemoryKb,
        });

        if (peakMemoryKb > WORKER_MEMORY_WARNING_THRESHOLD_KB) {
          const memoryMb = Math.round(peakMemoryKb / 1024);
          const thresholdMb = Math.round(
            WORKER_MEMORY_WARNING_THRESHOLD_KB / 1024,
          );

          logger.warn("mediasoup worker memory exceeds threshold", {
            workerIndex: this.workerIndex,
            memoryMb,
            thresholdMb,
          });

          this.onWarning({
            workerIndex: this.workerIndex,
            memoryMb,
            thresholdMb,
          });
        }
      } catch {
        // Worker may have died between scheduling and execution -- ignore
      }
    }, WORKER_MEMORY_CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  getIntervalHandle(): ReturnType<typeof setInterval> | null {
    return this.intervalHandle;
  }
}

// ---------------------------------------------------------------------------
// WorkerManager
// ---------------------------------------------------------------------------

interface WorkerManagerConfig {
  readonly workerCount: number;
  readonly rtcMinPort: number;
  readonly rtcMaxPort: number;
  readonly logLevel: "debug" | "warn" | "error" | "none";
}

export class WorkerManager extends EventEmitter {
  private readonly config: WorkerManagerConfig;
  private readonly workers: WorkerState[] = [];
  private readonly memoryMonitors: Map<number, WorkerMemoryMonitor> =
    new Map();

  constructor(config: WorkerManagerConfig) {
    super();
    this.config = config;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Create and start all configured mediasoup workers.
   * Must be called once before using any other method.
   */
  async start(): Promise<void> {
    logger.info("Starting mediasoup workers", {
      workerCount: this.config.workerCount,
      rtcMinPort: this.config.rtcMinPort,
      rtcMaxPort: this.config.rtcMaxPort,
    });

    const workerPromises: Promise<void>[] = [];
    for (let i = 0; i < this.config.workerCount; i++) {
      workerPromises.push(this.createWorkerAtIndex(i));
    }

    await Promise.all(workerPromises);

    logger.info("All mediasoup workers started", {
      count: this.workers.length,
    });
  }

  /**
   * Stop all workers and clean up monitoring intervals.
   */
  async stop(): Promise<void> {
    logger.info("Stopping mediasoup workers", { count: this.workers.length });

    for (const monitor of this.memoryMonitors.values()) {
      monitor.stop();
    }
    this.memoryMonitors.clear();

    for (const workerState of this.workers) {
      workerState.worker.close();
    }
    this.workers.length = 0;

    logger.info("All mediasoup workers stopped");
  }

  /**
   * Close all existing workers and recreate them from scratch.
   * Used by the admin "restart workers" action.
   */
  async restartAllWorkers(): Promise<void> {
    logger.warn("Restarting all mediasoup workers");

    // Stop monitors and close existing workers
    for (const monitor of this.memoryMonitors.values()) {
      monitor.stop();
    }
    this.memoryMonitors.clear();

    for (const workerState of this.workers) {
      workerState.worker.close();
    }
    this.workers.length = 0;

    // Recreate all workers
    const workerPromises: Promise<void>[] = [];
    for (let i = 0; i < this.config.workerCount; i++) {
      workerPromises.push(this.createWorkerAtIndex(i));
    }
    await Promise.all(workerPromises);

    this.emit("workers-restarted");
    logger.info("All mediasoup workers restarted", {
      count: this.workers.length,
    });
  }

  // -----------------------------------------------------------------------
  // Worker access
  // -----------------------------------------------------------------------

  /**
   * Get the worker assigned to a given channel via deterministic round-robin.
   * Hashes the channelId to a worker index (modulo workerCount).
   */
  getWorkerForChannel(channelId: string): mediasoupTypes.Worker {
    const index = this.hashChannelToIndex(channelId);
    return this.workers[index].worker;
  }

  /**
   * Get the worker index assigned to a given channel.
   * Used by RouterManager to track which worker a channel's router lives on.
   */
  getWorkerIndexForChannel(channelId: string): number {
    return this.hashChannelToIndex(channelId);
  }

  /**
   * Return resource usage snapshots for all workers.
   * Used by admin dashboard to display worker status.
   */
  async getWorkerResourceInfo(): Promise<WorkerResourceInfo[]> {
    const results: WorkerResourceInfo[] = [];

    for (const workerState of this.workers) {
      try {
        const usage = await workerState.worker.getResourceUsage();
        results.push({
          index: workerState.index,
          peakMemoryKb: usage.ru_maxrss,
          routerCount: 0, // Filled by caller (RouterManager knows router counts)
          alive: true,
        });
      } catch {
        results.push({
          index: workerState.index,
          peakMemoryKb: 0,
          routerCount: 0,
          alive: false,
        });
      }
    }

    return results;
  }

  /**
   * Return the total number of active workers.
   */
  getWorkerCount(): number {
    return this.workers.length;
  }

  // -----------------------------------------------------------------------
  // Internal: worker creation and crash recovery
  // -----------------------------------------------------------------------

  private async createWorkerAtIndex(index: number): Promise<void> {
    const worker = await mediasoup.createWorker({
      logLevel: this.config.logLevel,
      rtcMinPort: this.config.rtcMinPort,
      rtcMaxPort: this.config.rtcMaxPort,
      ...(resolvedWorkerBin ? { workerBin: resolvedWorkerBin } : {}),
    });

    const monitor = new WorkerMemoryMonitor(
      worker,
      index,
      (info) => this.emit("worker-memory-warning", info),
      (info) => this.emit("worker-resource-update", info),
    );
    monitor.start();

    const workerState: WorkerState = {
      worker,
      index,
      memoryMonitorInterval: monitor.getIntervalHandle(),
    };

    // Register crash handler
    worker.on("died", (error) => {
      logger.error("mediasoup worker died, restarting", {
        workerIndex: index,
        error: toErrorMessage(error),
      });
      this.emit("worker-died", { workerIndex: index, error });
      this.restartWorker(index).catch((restartError) => {
        logger.error("Failed to restart mediasoup worker", {
          workerIndex: index,
          error: toErrorMessage(restartError),
        });
      });
    });

    // Store in slot
    this.workers[index] = workerState;
    this.memoryMonitors.set(index, monitor);

    logger.info("mediasoup worker started", { workerIndex: index });
  }

  private async restartWorker(index: number): Promise<void> {
    // Clean up old monitor
    const oldMonitor = this.memoryMonitors.get(index);
    if (oldMonitor) {
      oldMonitor.stop();
      this.memoryMonitors.delete(index);
    }

    // Create new worker at the same index
    await this.createWorkerAtIndex(index);

    this.emit("worker-restarted", { workerIndex: index });
    logger.info("mediasoup worker restarted", { workerIndex: index });
  }

  /**
   * Deterministic channel-to-worker mapping using simple hash modulo.
   */
  private hashChannelToIndex(channelId: string): number {
    let hash = 0;
    for (let i = 0; i < channelId.length; i++) {
      hash = (hash * 31 + channelId.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % this.workers.length;
  }
}
