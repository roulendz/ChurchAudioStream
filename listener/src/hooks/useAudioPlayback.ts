/**
 * React hook wrapping the audio engine.
 *
 * Exposes playback control + the AnalyserNode for the visualizer + a
 * platform flag (isSoftwareVolumeSupported) so the UI can hide the
 * software volume slider on iOS where audio.volume is read-only.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { createAudioEngine, type AudioEngine } from "../lib/audio-engine";

export interface UseAudioPlaybackResult {
  startPlayback: (track: MediaStreamTrack) => Promise<void>;
  stopPlayback: () => void;
  setVolume: (value: number) => void;
  mute: () => void;
  unmute: () => void;
  isMuted: boolean;
  /** Live AnalyserNode for the visualizer. Null until first playTrack. */
  getAnalyser: () => AnalyserNode | null;
  /** False on iOS WebKit where audio.volume cannot be set. */
  isSoftwareVolumeSupported: boolean;
}

export function useAudioPlayback(): UseAudioPlaybackResult {
  const engineRef = useRef<AudioEngine | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSoftwareVolumeSupported, setIsSoftwareVolumeSupported] =
    useState(true);

  useEffect(() => {
    const engine = createAudioEngine();
    engineRef.current = engine;
    setIsSoftwareVolumeSupported(engine.isSoftwareVolumeSupported());
    return () => {
      engine.close();
      engineRef.current = null;
    };
  }, []);

  const startPlayback = useCallback(
    async (track: MediaStreamTrack): Promise<void> => {
      const engine = engineRef.current;
      if (!engine) return;
      await engine.resume();
      await engine.playTrack(track);
    },
    [],
  );

  const stopPlayback = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.close();
    const fresh = createAudioEngine();
    engineRef.current = fresh;
    setIsSoftwareVolumeSupported(fresh.isSoftwareVolumeSupported());
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
    engineRef.current?.unmute();
    setIsMuted(false);
  }, []);

  const getAnalyser = useCallback((): AnalyserNode | null => {
    return engineRef.current?.getAnalyser() ?? null;
  }, []);

  return {
    startPlayback,
    stopPlayback,
    setVolume,
    mute,
    unmute,
    isMuted,
    getAnalyser,
    isSoftwareVolumeSupported,
  };
}
