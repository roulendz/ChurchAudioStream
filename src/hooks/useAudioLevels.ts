/**
 * Hook for subscribing to real-time audio level data from the sidecar.
 *
 * Level data is stored entirely in useRef (no useState) to avoid React
 * re-renders on every 100ms level broadcast. Components that display
 * levels (VuMeter) read from the ref via requestAnimationFrame.
 */

import { useEffect, useRef, useCallback } from "react";
import type { WsMessage } from "./useWebSocket";

/** Level data for a single channel, aggregated from all its pipelines. */
export interface ChannelLevelData {
  peak: number[];
  rms: number[];
  clipping: boolean;
  gainReductionDb: number;
  timestamp: number;
}

/**
 * Shape of an individual level entry received from the sidecar.
 * Mirrors NormalizedLevels + the channelId enrichment added by 06-01.
 */
interface PipelineLevelEntry {
  pipelineId: string;
  peak: number[];
  rms: number[];
  peakDb: number[];
  rmsDb: number[];
  clipping: boolean;
  timestamp: number;
  gainReductionDb: number;
  channelId: string | null;
}

/** Payload shape for the levels:update WS message. */
interface LevelsUpdatePayload {
  levels: Record<string, PipelineLevelEntry>;
}

/** Maximum age (ms) before level data is considered stale and pruned. */
const STALE_THRESHOLD_MS = 2000;

type SubscribeFn = (type: string, handler: (msg: WsMessage) => void) => () => void;

export interface UseAudioLevelsReturn {
  getLevels: (channelId: string) => ChannelLevelData | null;
  getActiveLevelChannelIds: () => string[];
}

/**
 * Merge multiple pipeline level entries for the same channel into a single
 * ChannelLevelData by taking component-wise maximums for peak/rms arrays
 * and OR-ing the clipping flag.
 */
function mergePipelineLevels(entries: PipelineLevelEntry[]): ChannelLevelData {
  if (entries.length === 1) {
    const entry = entries[0];
    return {
      peak: entry.peak,
      rms: entry.rms,
      clipping: entry.clipping,
      gainReductionDb: entry.gainReductionDb,
      timestamp: entry.timestamp,
    };
  }

  // Determine max channel count across pipelines
  const maxChannels = Math.max(...entries.map((e) => e.peak.length));
  const mergedPeak = new Array<number>(maxChannels).fill(0);
  const mergedRms = new Array<number>(maxChannels).fill(0);
  let mergedClipping = false;
  let maxGainReduction = 0;
  let latestTimestamp = 0;

  for (const entry of entries) {
    for (let ch = 0; ch < entry.peak.length; ch++) {
      mergedPeak[ch] = Math.max(mergedPeak[ch], entry.peak[ch]);
      mergedRms[ch] = Math.max(mergedRms[ch], entry.rms[ch]);
    }
    if (entry.clipping) mergedClipping = true;
    maxGainReduction = Math.max(maxGainReduction, entry.gainReductionDb);
    latestTimestamp = Math.max(latestTimestamp, entry.timestamp);
  }

  return {
    peak: mergedPeak,
    rms: mergedRms,
    clipping: mergedClipping,
    gainReductionDb: maxGainReduction,
    timestamp: latestTimestamp,
  };
}

export function useAudioLevels(subscribe: SubscribeFn): UseAudioLevelsReturn {
  const levelsRef = useRef<Map<string, ChannelLevelData>>(new Map());

  useEffect(() => {
    const unsubscribe = subscribe("levels:update", (msg: WsMessage) => {
      const payload = msg.payload as LevelsUpdatePayload | undefined;
      if (!payload?.levels) return;

      // Group pipeline entries by channelId
      const byChannel = new Map<string, PipelineLevelEntry[]>();
      for (const entry of Object.values(payload.levels)) {
        const channelId = entry.channelId;
        if (!channelId) continue;

        const existing = byChannel.get(channelId);
        if (existing) {
          existing.push(entry);
        } else {
          byChannel.set(channelId, [entry]);
        }
      }

      // Merge and store per-channel
      for (const [channelId, entries] of byChannel) {
        levelsRef.current.set(channelId, mergePipelineLevels(entries));
      }

      // Prune stale entries
      const now = Date.now();
      for (const [channelId, data] of levelsRef.current) {
        if (now - data.timestamp > STALE_THRESHOLD_MS) {
          levelsRef.current.delete(channelId);
        }
      }
    });

    return unsubscribe;
  }, [subscribe]);

  const getLevels = useCallback(
    (channelId: string): ChannelLevelData | null => {
      return levelsRef.current.get(channelId) ?? null;
    },
    [],
  );

  const getActiveLevelChannelIds = useCallback((): string[] => {
    return Array.from(levelsRef.current.keys());
  }, []);

  return { getLevels, getActiveLevelChannelIds };
}
