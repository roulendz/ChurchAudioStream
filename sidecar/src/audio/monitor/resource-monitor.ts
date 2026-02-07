/**
 * Per-pipeline resource usage monitor.
 *
 * Polls pidusage at a configurable interval (default 5s) to track CPU%
 * and memory consumption of each GStreamer child process. The 5-second
 * interval accounts for pidusage using wmic on Windows, which is slow.
 *
 * Consumers subscribe to "stats-updated" events for real-time dashboard
 * or call getStats()/getAllStats() for snapshot access.
 *
 * Stale PIDs (process exited) are automatically untracked when pidusage
 * throws an error for a non-existent process.
 */

import { EventEmitter } from "node:events";
import pidusage from "pidusage";
import type { PipelineStats } from "../pipeline/pipeline-types.js";
import { logger } from "../../utils/logger.js";

interface TrackedPipeline {
  readonly pid: number;
  readonly startedAt: number;
}

export interface ResourceMonitorEvents {
  "stats-updated": [pipelineId: string, stats: PipelineStats];
}

/** Default polling interval in milliseconds (5 seconds for wmic tolerance). */
const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * Tracks CPU% and memory usage per GStreamer pipeline process via pidusage.
 *
 * CPU% is percentage of one core (0-100+ on multi-core systems).
 * Memory is reported in megabytes.
 */
export class ResourceMonitor extends EventEmitter<ResourceMonitorEvents> {
  private readonly trackedPids = new Map<string, TrackedPipeline>();
  private readonly latestStats = new Map<string, PipelineStats>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;

  constructor(pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS) {
    super();
    this.pollIntervalMs = pollIntervalMs;
  }

  /** Start tracking resource usage for a pipeline's GStreamer process. */
  trackPipeline(pipelineId: string, pid: number): void {
    this.trackedPids.set(pipelineId, { pid, startedAt: Date.now() });
    logger.info("Resource monitor tracking pipeline", { pipelineId, pid });
  }

  /** Stop tracking a pipeline (e.g., when pipeline stops or is removed). */
  untrackPipeline(pipelineId: string): void {
    this.trackedPids.delete(pipelineId);
    this.latestStats.delete(pipelineId);
    logger.info("Resource monitor untracked pipeline", { pipelineId });
  }

  /** Start the periodic polling loop. */
  start(): void {
    if (this.pollTimer !== null) {
      return;
    }

    this.pollTimer = setInterval(() => {
      this.pollAllPipelines();
    }, this.pollIntervalMs);

    logger.info("Resource monitor started", {
      pollIntervalMs: this.pollIntervalMs,
    });
  }

  /** Stop polling and clear all timers. */
  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    pidusage.clear();

    logger.info("Resource monitor stopped");
  }

  /** Get latest resource stats for a specific pipeline. */
  getStats(pipelineId: string): PipelineStats | undefined {
    return this.latestStats.get(pipelineId);
  }

  /** Get a snapshot copy of all latest resource stats. */
  getAllStats(): Map<string, PipelineStats> {
    return new Map(this.latestStats);
  }

  /**
   * Poll pidusage for each tracked pipeline PID.
   *
   * If a PID no longer exists (process exited), the error is caught
   * and the pipeline is automatically untracked.
   */
  private async pollAllPipelines(): Promise<void> {
    const pollPromises: Promise<void>[] = [];

    for (const [pipelineId, tracked] of this.trackedPids) {
      pollPromises.push(this.pollSinglePipeline(pipelineId, tracked));
    }

    await Promise.allSettled(pollPromises);
  }

  private async pollSinglePipeline(
    pipelineId: string,
    tracked: TrackedPipeline,
  ): Promise<void> {
    try {
      const stat = await pidusage(tracked.pid);

      const stats: PipelineStats = {
        cpuPercent: stat.cpu,
        memoryMb: stat.memory / (1024 * 1024),
        uptimeMs: Date.now() - tracked.startedAt,
        pid: tracked.pid,
      };

      this.latestStats.set(pipelineId, stats);
      this.emit("stats-updated", pipelineId, stats);
    } catch {
      // PID no longer exists -- process likely exited
      logger.warn("Stale PID detected, untracking pipeline", {
        pipelineId,
        pid: tracked.pid,
      });
      this.untrackPipeline(pipelineId);
    }
  }
}
