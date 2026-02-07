/**
 * Audio level aggregation monitor.
 *
 * Receives raw dB-scale audio levels from GStreamer pipeline metering
 * and converts them to a normalized 0.0-1.0 range suitable for VU meter
 * display in the admin UI. Tracks momentary clipping per pipeline.
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
}

export interface LevelMonitorEvents {
  "levels-updated": [levels: NormalizedLevels];
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

  /**
   * Process raw audio levels from a pipeline's GStreamer level element.
   *
   * Converts dB values to normalized 0.0-1.0 range, detects clipping,
   * stores the result, and emits a "levels-updated" event.
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

    const normalized: NormalizedLevels = {
      pipelineId,
      peak: peakNormalized,
      rms: rmsNormalized,
      peakDb: [...rawLevels.peak],
      rmsDb: [...rawLevels.rms],
      clipping: isClipping,
      timestamp: rawLevels.timestamp,
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
  }
}
