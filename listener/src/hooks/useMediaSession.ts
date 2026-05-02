/**
 * Media Session API hook for lock-screen / notification controls.
 *
 * Why this matters per platform:
 *   - iOS WebKit (Safari, Edge for iOS, Chrome for iOS): MediaSession only
 *     surfaces controls when an UNMUTED HTMLMediaElement is actively
 *     playing AND MediaMetadata.artwork is present. Without artwork iOS
 *     refuses to draw lock-screen UI. Multiple artwork sizes improve hit
 *     rate (Apple picks the closest match for the system surface).
 *   - Chromium (Edge for Android, Chrome for Android, Chrome desktop):
 *     surfaces controls as soon as any unmuted media element plays. Still
 *     wants artwork for the notification thumbnail.
 *
 * The hook also installs `stop` and intentionally-rejecting `seekto` /
 * `seekbackward` / `seekforward` handlers so the system controls render
 * play/pause + stop and skip the seek buttons that don't fit a live
 * stream.
 */

import { useEffect, useCallback, useRef } from "react";

export interface MediaSessionConfig {
  channelName: string;
  description: string;
  onPlay: () => void;
  onPause: () => void;
  onStop?: () => void;
}

function isMediaSessionSupported(): boolean {
  return "mediaSession" in navigator;
}

/** Built-in artwork list. The PWA already ships /icons/icon-192 + icon-512. */
function buildArtwork(): MediaImage[] {
  // Use the two real PNGs we ship; iOS still picks the best match.
  return [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
  ];
}

export function useMediaSession(config: MediaSessionConfig | null): {
  updatePlaybackState: (state: "playing" | "paused" | "none") => void;
} {
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (!isMediaSessionSupported() || !config) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: config.channelName,
      artist: config.description,
      album: "Church Audio Stream",
      artwork: buildArtwork(),
    });

    const playHandler = (): void => {
      configRef.current?.onPlay();
    };
    const pauseHandler = (): void => {
      configRef.current?.onPause();
    };
    const stopHandler = (): void => {
      configRef.current?.onStop?.();
    };

    navigator.mediaSession.setActionHandler("play", playHandler);
    navigator.mediaSession.setActionHandler("pause", pauseHandler);
    navigator.mediaSession.setActionHandler("stop", stopHandler);

    // Live-stream: explicitly disable seek so the OS draws play/pause only.
    try {
      navigator.mediaSession.setActionHandler("seekto", null);
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    } catch {
      // Older browsers may throw on unsupported actions; safe to ignore.
    }

    // Eagerly mark as playing so the system shows controls before the first
    // RTP frame arrives. Caller updates again via updatePlaybackState.
    navigator.mediaSession.playbackState = "playing";

    return () => {
      try {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("stop", null);
      } catch {
        // Ignore.
      }
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    };
  }, [config?.channelName, config?.description]);

  const updatePlaybackState = useCallback(
    (state: "playing" | "paused" | "none"): void => {
      if (!isMediaSessionSupported()) return;
      navigator.mediaSession.playbackState = state;
    },
    [],
  );

  return { updatePlaybackState };
}
