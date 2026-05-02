/**
 * Subscribe to the sidecar's `audioLevels` notification and expose the
 * latest RMS / clipping snapshot per channel.
 *
 * Sidecar coalesces level updates into a 250ms broadcast window. We just
 * keep the freshest sample in a Map and expose it as React state. Stale
 * channels (no update for >2s) are dropped so meters fall to silent
 * instead of freezing on the last value.
 */

import { useEffect, useState } from "react";
import type { Peer } from "../lib/signaling-client";
import type { ChannelAudioLevel } from "../lib/types";

const STALE_TIMEOUT_MS = 2000;
const CLEANUP_INTERVAL_MS = 1000;

interface AudioLevelsPayload {
  levels: ChannelAudioLevel[];
}

interface LevelEntry extends ChannelAudioLevel {
  receivedAt: number;
}

export function useChannelLevels(
  peer: Peer | null,
): Map<string, ChannelAudioLevel> {
  const [levels, setLevels] = useState<Map<string, ChannelAudioLevel>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!peer) return;
    const internalRef = new Map<string, LevelEntry>();

    const handleNotification = (notification: {
      method: string;
      data?: Record<string, unknown>;
    }): void => {
      if (notification.method !== "audioLevels") return;
      const payload = notification.data as unknown as AudioLevelsPayload;
      if (!payload?.levels) return;

      const now = Date.now();
      for (const level of payload.levels) {
        internalRef.set(level.channelId, { ...level, receivedAt: now });
      }
      const next = new Map<string, ChannelAudioLevel>();
      for (const [channelId, entry] of internalRef) {
        next.set(channelId, {
          channelId: entry.channelId,
          rms: entry.rms,
          rmsDb: entry.rmsDb,
          clipping: entry.clipping,
        });
      }
      setLevels(next);
    };

    peer.on("notification", handleNotification);

    const cleanupTimer = window.setInterval(() => {
      const now = Date.now();
      let mutated = false;
      for (const [channelId, entry] of internalRef) {
        if (now - entry.receivedAt > STALE_TIMEOUT_MS) {
          internalRef.delete(channelId);
          mutated = true;
        }
      }
      if (mutated) {
        const next = new Map<string, ChannelAudioLevel>();
        for (const [channelId, entry] of internalRef) {
          next.set(channelId, {
            channelId: entry.channelId,
            rms: entry.rms,
            rmsDb: entry.rmsDb,
            clipping: entry.clipping,
          });
        }
        setLevels(next);
      }
    }, CLEANUP_INTERVAL_MS);

    return () => {
      peer.off("notification", handleNotification);
      window.clearInterval(cleanupTimer);
    };
  }, [peer]);

  return levels;
}
