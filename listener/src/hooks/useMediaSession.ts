/**
 * Media Session API hook for lock-screen / notification controls.
 *
 * Sets navigator.mediaSession.metadata with channel info and wires
 * play/pause action handlers. Updates playbackState when playing or
 * paused.
 *
 * Guard: if (!("mediaSession" in navigator)) all operations are no-ops.
 */

import { useEffect, useCallback, useRef } from "react";

export interface MediaSessionConfig {
  channelName: string;
  description: string;
  /** Called when the user taps play on lock screen. */
  onPlay: () => void;
  /** Called when the user taps pause on lock screen. */
  onPause: () => void;
}

function isMediaSessionSupported(): boolean {
  return "mediaSession" in navigator;
}

export function useMediaSession(config: MediaSessionConfig | null): {
  updatePlaybackState: (state: "playing" | "paused" | "none") => void;
} {
  const configRef = useRef(config);
  configRef.current = config;

  // Set metadata and action handlers when config changes
  useEffect(() => {
    if (!isMediaSessionSupported() || !config) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: config.channelName,
      artist: config.description,
      album: "Church Audio Stream",
    });

    const playHandler = (): void => {
      configRef.current?.onPlay();
    };

    const pauseHandler = (): void => {
      configRef.current?.onPause();
    };

    navigator.mediaSession.setActionHandler("play", playHandler);
    navigator.mediaSession.setActionHandler("pause", pauseHandler);

    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.metadata = null;
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
