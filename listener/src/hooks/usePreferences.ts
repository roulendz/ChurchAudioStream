/**
 * localStorage-backed listener preference persistence.
 *
 * Stores last-listened channel ID and visit count. Volume does NOT
 * persist (always starts at 70% per locked decision).
 *
 * localStorage keys:
 * - cas_last_channel: last-listened channel ID
 * - cas_visit_count: number of app loads
 */

import { useState, useCallback, useRef, useEffect } from "react";

const LAST_CHANNEL_KEY = "cas_last_channel";
const VISIT_COUNT_KEY = "cas_visit_count";

export interface ListenerPreferences {
  lastChannelId: string | null;
  visitCount: number;
}

export interface UsePreferencesResult {
  preferences: ListenerPreferences;
  setLastChannel: (channelId: string) => void;
  incrementVisitCount: () => void;
  /** True when visitCount >= 2 (second visit or later). */
  isReturningListener: boolean;
}

function readPreferences(): ListenerPreferences {
  const lastChannelId = localStorage.getItem(LAST_CHANNEL_KEY);
  const rawVisitCount = localStorage.getItem(VISIT_COUNT_KEY);
  const visitCount =
    rawVisitCount !== null ? parseInt(rawVisitCount, 10) : 0;
  return {
    lastChannelId,
    visitCount: Number.isNaN(visitCount) ? 0 : visitCount,
  };
}

export function usePreferences(): UsePreferencesResult {
  const [preferences, setPreferences] = useState<ListenerPreferences>(
    readPreferences,
  );
  const hasIncrementedRef = useRef(false);

  const setLastChannel = useCallback((channelId: string) => {
    localStorage.setItem(LAST_CHANNEL_KEY, channelId);
    setPreferences((prev) => ({ ...prev, lastChannelId: channelId }));
  }, []);

  const incrementVisitCount = useCallback(() => {
    if (hasIncrementedRef.current) return;
    hasIncrementedRef.current = true;

    const current = readPreferences().visitCount;
    const next = current + 1;
    localStorage.setItem(VISIT_COUNT_KEY, String(next));
    setPreferences((prev) => ({ ...prev, visitCount: next }));
  }, []);

  // Increment visit count once on mount
  useEffect(() => {
    incrementVisitCount();
  }, [incrementVisitCount]);

  const isReturningListener = preferences.visitCount >= 2;

  return { preferences, setLastChannel, incrementVisitCount, isReturningListener };
}
