/**
 * Screen Wake Lock hook.
 *
 * Asks the OS to keep the screen on while the listener is actively
 * playing. Solves the iOS lock-screen audio drop AND the Android tab-sleep
 * audio drop by simply preventing the device from locking in the first
 * place. The user pays a battery cost; we expose this as an opt-in toggle
 * in the player UI.
 *
 * Browser caveats handled here:
 *   - Wake Lock is auto-released when the page becomes hidden (per spec).
 *     We re-acquire on visibilitychange visible if the user hasn't
 *     manually disabled it.
 *   - iOS 16.4+ Safari supports Wake Lock; older iOS silently fails. We
 *     report supported=false so the toggle hides itself.
 *   - Wake Lock requires HTTPS or localhost. Sidecar already serves HTTPS.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  released: boolean;
  addEventListener: (event: "release", handler: () => void) => void;
};

type WakeLockApi = {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
};

function getWakeLockApi(): WakeLockApi | null {
  const nav = navigator as unknown as { wakeLock?: WakeLockApi };
  return nav.wakeLock ?? null;
}

export interface UseWakeLockResult {
  /** True when the API exists in this browser. */
  isSupported: boolean;
  /** True when the wake lock is currently held by us. */
  isActive: boolean;
  /** User-driven enable/disable. */
  setEnabled: (enabled: boolean) => void;
  enabled: boolean;
}

export function useWakeLock(): UseWakeLockResult {
  const [enabled, setEnabledState] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const isSupported = getWakeLockApi() !== null;

  const releaseLock = useCallback(async (): Promise<void> => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    setIsActive(false);
    if (!sentinel || sentinel.released) return;
    try {
      await sentinel.release();
    } catch {
      // Ignore release errors.
    }
  }, []);

  const acquireLock = useCallback(async (): Promise<void> => {
    const api = getWakeLockApi();
    if (!api) return;
    if (sentinelRef.current && !sentinelRef.current.released) return;
    try {
      const sentinel = await api.request("screen");
      sentinelRef.current = sentinel;
      setIsActive(true);
      sentinel.addEventListener("release", () => {
        // OS released the lock (e.g. tab hidden). Reflect in state; the
        // visibilitychange handler will re-acquire when we come back.
        if (sentinelRef.current === sentinel) {
          sentinelRef.current = null;
        }
        setIsActive(false);
      });
    } catch {
      // iOS < 16.4 throws here; treat as unsupported and stay disabled.
      setIsActive(false);
    }
  }, []);

  // Acquire / release in response to enabled state.
  useEffect(() => {
    if (!isSupported) return;
    if (enabled) {
      void acquireLock();
    } else {
      void releaseLock();
    }
  }, [enabled, isSupported, acquireLock, releaseLock]);

  // Re-acquire when the page becomes visible again. Wake Lock is
  // auto-released by the browser when the document hides.
  useEffect(() => {
    if (!isSupported) return;
    const onVisibility = (): void => {
      if (document.visibilityState !== "visible") return;
      if (!enabledRef.current) return;
      void acquireLock();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isSupported, acquireLock]);

  // Release on unmount.
  useEffect(() => {
    return () => {
      void releaseLock();
    };
  }, [releaseLock]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
  }, []);

  return { isSupported, isActive, enabled, setEnabled };
}
