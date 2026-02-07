/**
 * Audio level aggregation monitor.
 *
 * Receives raw dB-scale audio levels from GStreamer pipeline metering
 * and converts them to a normalized 0.0-1.0 range suitable for VU meter
 * display in the admin UI. Tracks momentary clipping per pipeline.
 *
 * Phase 3 addition: computes estimated gain reduction (dB) by comparing
 * post-AGC output levels to the AGC target LUFS. The admin dashboard
 * displays this as a simple compression activity indicator.
 *
 * Consumers subscribe to "levels-updated" events for real-time VU meters
 * or call getLevels()/getAllLevels() for snapshot access.
 */

import { EventEmitter } from "node:events";
import type { AudioLevels } from "../pipeline/pipeline-types.js";
import { dbToNormalized } from "../pipeline/metering-parser.js";

/** Audio levels normalized to 0.0-1.0 range with both raw dB and normalized values. */
export interface NormalizedLevels {
  readonly pipelineId: string;
  /** Per-channel peak values in 0.0-1.0 range. */
  readonly peak: number[];
  /** Per-channel RMS values in 0.0-1.0 range. */
  readonly rms: number[];
  /** Per-channel peak values in dB (0 dB = full scale). */
  readonly peakDb: number[];
  /** Per-channel RMS values in dB (0 dB = full scale). */
  readonly rmsDb: number[];
  /** True if any channel peak is at or above clipping threshold. */
  readonly clipping: boolean;
  /** Unix timestamp (ms) when these levels were captured. */
  readonly timestamp: number;
  /**
   * Estimated gain reduction in dB.
   *
   * Computed as (average RMS dB - target LUFS).
   * - Negative: AGC is compressing (reducing gain) -- normal operation.
   * - Near zero: AGC has converged on target.
   * - Positive: output momentarily louder than target (transient overshoot).
   * - Zero when no processing target is set or input is silence.
   */
  readonly gainReductionDb: number;
}

export interface LevelMonitorEvents {
  "levels-updated": [levels: NormalizedLevels];
}

/**
 * Compute the arithmetic mean of an array of dB values, ignoring -Infinity (silence).
 * Returns -Infinity if all values are -Infinity (complete silence).
 */
function computeAverageRmsDb(rmsDbValues: number[]): number {
  const finiteValues = rmsDbValues.filter((v) => isFinite(v));
  if (finiteValues.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  return finiteValues.reduce((sum, v) => sum + v, 0) / finiteValues.length;
}

/**
 * Aggregates raw GStreamer audio levels from all pipelines, converts dB
 * to normalized 0.0-1.0 range, and emits events for downstream broadcast.
 */
export class LevelMonitor extends EventEmitter<LevelMonitorEvents> {
  private readonly latestLevels = new Map<string, NormalizedLevels>();
  private readonly clippingState = new Map<
    string,
    { clipping: boolean; clearedAt: number }
  >();
  private readonly processingTargets = new Map<
    string,
    { targetLufs: number }
  >();

  /**
   * Register the AGC target LUFS for a pipeline.
   * When set, gain reduction will be estimated from post-AGC levels vs this target.
   */
  setProcessingTarget(pipelineId: string, targetLufs: number): void {
    this.processingTargets.set(pipelineId, { targetLufs });
  }

  /** Remove the processing target for a pipeline. */
  clearProcessingTarget(pipelineId: string): void {
    this.processingTargets.delete(pipelineId);
  }

  /**
   * Process raw audio levels from a pipeline's GStreamer level element.
   *
   * Converts dB values to normalized 0.0-1.0 range, detects clipping,
   * computes gain reduction estimate, stores the result, and emits
   * a "levels-updated" event.
   */
  handleLevels(pipelineId: string, rawLevels: AudioLevels): void {
    const peakNormalized = rawLevels.peak.map(dbToNormalized);
    const rmsNormalized = rawLevels.rms.map(dbToNormalized);

    if (rawLevels.clipping) {
      this.clippingState.set(pipelineId, {
        clipping: true,
        clearedAt: 0,
      });
    }

    const clippingEntry = this.clippingState.get(pipelineId);
    const isClipping = clippingEntry?.clipping ?? false;

    const gainReductionDb = this.computeGainReduction(pipelineId, rawLevels.rms);

    const normalized: NormalizedLevels = {
      pipelineId,
      peak: peakNormalized,
      rms: rmsNormalized,
      peakDb: [...rawLevels.peak],
      rmsDb: [...rawLevels.rms],
      clipping: isClipping,
      timestamp: rawLevels.timestamp,
      gainReductionDb,
    };

    this.latestLevels.set(pipelineId, normalized);
    this.emit("levels-updated", normalized);

    // Auto-clear clipping state after emitting so the next non-clipping
    // frame will show clipping=false (momentary red flash behavior).
    if (rawLevels.clipping) {
      // Keep clipping true for this frame, clear for next
    } else if (clippingEntry?.clipping) {
      this.clippingState.set(pipelineId, {
        clipping: false,
        clearedAt: Date.now(),
      });
    }
  }

  /** Get the latest normalized levels for a specific pipeline. */
  getLevels(pipelineId: string): NormalizedLevels | undefined {
    return this.latestLevels.get(pipelineId);
  }

  /** Get a snapshot copy of all latest normalized levels. */
  getAllLevels(): Map<string, NormalizedLevels> {
    return new Map(this.latestLevels);
  }

  /** Remove all tracked state for a pipeline (e.g., when pipeline stops). */
  clearPipeline(pipelineId: string): void {
    this.latestLevels.delete(pipelineId);
    this.clippingState.delete(pipelineId);
    this.clearProcessingTarget(pipelineId);
  }

  /**
   * Compute estimated gain reduction for a pipeline.
   *
   * Gain reduction = avgRmsDb - targetLufs
   * - When input is silence (-Infinity), returns 0 (no meaningful estimate).
   * - When no processing target is set, returns 0.
   */
  private computeGainReduction(pipelineId: string, rmsDbValues: number[]): number {
    const target = this.processingTargets.get(pipelineId);
    if (!target) {
      return 0;
    }

    const avgRmsDb = computeAverageRmsDb(rmsDbValues);
    if (!isFinite(avgRmsDb)) {
      return 0;
    }

    return avgRmsDb - target.targetLufs;
  }
}
