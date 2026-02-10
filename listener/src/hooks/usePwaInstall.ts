/**
 * PWA install prompt hook.
 *
 * Captures the browser's `beforeinstallprompt` event and exposes it
 * for deferred triggering. canInstall is only true when the event has
 * been captured AND the listener has visited at least twice (second
 * visit per locked decision).
 *
 * On iOS (no beforeinstallprompt support), canInstall remains false.
 */

import { useState, useEffect, useCallback, useRef } from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface UsePwaInstallResult {
  /** True when PWA install is available AND visitCount >= 2. */
  canInstall: boolean;
  /** Trigger the browser's native install prompt. */
  promptInstall: () => Promise<void>;
}

export function usePwaInstall(isReturningListener: boolean): UsePwaInstallResult {
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [hasPromptEvent, setHasPromptEvent] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event): void => {
      event.preventDefault();
      deferredPromptRef.current = event as BeforeInstallPromptEvent;
      setHasPromptEvent(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      deferredPromptRef.current = null;
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<void> => {
    if (!deferredPromptRef.current) return;

    const result = await deferredPromptRef.current.prompt();
    if (result.outcome === "accepted") {
      deferredPromptRef.current = null;
      setHasPromptEvent(false);
    }
  }, []);

  const canInstall = hasPromptEvent && isReturningListener;

  return { canInstall, promptInstall };
}
