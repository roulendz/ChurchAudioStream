/**
 * Custom hook wrapping the Web Audio API engine for playback control.
 *
 * Creates the audio engine on mount, provides playback/volume/mute methods,
 * and cleans up on unmount. All audio flows through GainNode for iOS
 * Safari volume compatibility.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { createAudioEngine, type AudioEngine } from "../lib/audio-engine";

export interface UseAudioPlaybackResult {
  /** Resume AudioContext (user gesture) then route track through GainNode. */
  startPlayback: (track: MediaStreamTrack) => Promise<void>;
  /** Disconnect the current audio source. */
  stopPlayback: () => void;
  /** Set volume (0.0 to 1.0). */
  setVolume: (value: number) => void;
  /** Mute audio (preserves volume for unmute). */
  mute: () => void;
  /** Restore volume after mute. */
  unmute: () => void;
  /** Whether audio is currently muted. */
  isMuted: boolean;
}

export function useAudioPlayback(): UseAudioPlaybackResult {
  const engineRef = useRef<AudioEngine | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    engineRef.current = createAudioEngine();
    return () => {
      if (engineRef.current) {
        engineRef.current.close();
        engineRef.current = null;
      }
    };
  }, []);

  const startPlayback = useCallback(
    async (track: MediaStreamTrack): Promise<void> => {
      if (!engineRef.current) return;
      await engineRef.current.resume();
      engineRef.current.playTrack(track);
    },
    [],
  );

  const stopPlayback = useCallback(() => {
    // Close and recreate engine to fully disconnect source
    if (engineRef.current) {
      engineRef.current.close();
    }
    engineRef.current = createAudioEngine();
    setIsMuted(false);
  }, []);

  const setVolume = useCallback((value: number) => {
    engineRef.current?.setVolume(value);
  }, []);

  const mute = useCallback(() => {
    engineRef.current?.mute();
    setIsMuted(true);
  }, []);

  const unmute = useCallback(() => {
    // Unmute at current stored volume (engine tracks it internally)
    engineRef.current?.unmute(0.7);
    setIsMuted(false);
  }, []);

  return { startPlayback, stopPlayback, setVolume, mute, unmute, isMuted };
}
