/**
 * Full-screen offline overlay with auto-recovery.
 *
 * Shows when EITHER the device has no network (navigator.onLine === false)
 * OR the signaling server is unreachable (connectionState === "disconnected").
 *
 * Auto-pings the server every 3 seconds. When a response comes back,
 * reloads the page to create a fresh protoo peer.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectionState } from "../hooks/useSignaling";
import { forceVersionReload } from "../lib/sw-lifecycle";

interface OfflineScreenProps {
  connectionState?: ConnectionState;
}

export function OfflineScreen({ connectionState }: OfflineScreenProps) {
  const { t } = useTranslation();
  const [isNetworkOffline, setIsNetworkOffline] = useState(!navigator.onLine);
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const handleOnline = (): void => setIsNetworkOffline(false);
    const handleOffline = (): void => setIsNetworkOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const isOffline = isNetworkOffline || connectionState === "disconnected";

  useEffect(() => {
    if (!isOffline) {
      if (retryTimerRef.current) {
        clearInterval(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      return;
    }

    retryTimerRef.current = setInterval(async () => {
      if (!navigator.onLine) return;
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as { instanceId?: string };
        const storedInstanceId = sessionStorage.getItem("cas_instance_id");
        if (typeof data.instanceId === "string" && storedInstanceId && data.instanceId !== storedInstanceId) {
          forceVersionReload();
          return;
        }
        window.location.reload();
      } catch {
        // Server still down, keep retrying
      }
    }, 3000);

    return () => {
      if (retryTimerRef.current) {
        clearInterval(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [isOffline]);

  const handleTryAgain = useCallback(() => {
    if (navigator.onLine) {
      window.location.reload();
    }
  }, []);

  if (!isOffline) return null;

  return (
    <div className="offline-screen" role="alert">
      <div className="offline-screen__content">
        {/* WiFi icon (inline SVG) */}
        <svg
          className="offline-screen__icon"
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12.55a11 11 0 0 1 14.08 0" />
          <path d="M1.42 9a16 16 0 0 1 21.16 0" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <circle cx="12" cy="20" r="1" fill="currentColor" />
          {/* Diagonal slash indicating disconnected */}
          <line x1="2" y1="2" x2="22" y2="22" strokeWidth="2" />
        </svg>

        <h1 className="offline-screen__title">{t("offline.title")}</h1>
        <p className="offline-screen__message">
          {t("offline.message")}
        </p>

        <button className="offline-screen__retry-btn" onClick={handleTryAgain}>
          {t("offline.retry")}
        </button>
      </div>
    </div>
  );
}
