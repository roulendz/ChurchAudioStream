/**
 * Full-screen offline overlay.
 *
 * Detects online/offline via navigator.onLine + window events.
 * Shows a friendly church WiFi message when the device is offline.
 * Returns null when online (renders nothing).
 */

import { useState, useEffect, useCallback } from "react";

export function OfflineScreen() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = (): void => setIsOffline(false);
    const handleOffline = (): void => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleTryAgain = useCallback(() => {
    if (navigator.onLine) {
      setIsOffline(false);
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

        <h1 className="offline-screen__title">No connection</h1>
        <p className="offline-screen__message">
          Connect to the church WiFi to listen to live translations
        </p>

        <button className="offline-screen__retry-btn" onClick={handleTryAgain}>
          Try Again
        </button>
      </div>
    </div>
  );
}
