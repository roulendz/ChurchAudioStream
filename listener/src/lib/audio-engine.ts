/**
 * Web Audio API engine with GainNode volume control.
 *
 * All audio routing goes through AudioContext -> MediaStreamSourceNode
 * -> GainNode -> destination. This is MANDATORY for iOS Safari where
 * HTMLAudioElement.volume is read-only (Apple docs confirm).
 *
 * CRITICAL: This module does NOT use HTMLAudioElement or new Audio().
 * Volume is controlled exclusively via GainNode.gain.
 *
 * Pattern: Research Pattern 2 (iOS Safari volume fix).
 */

/** Default volume level (70% per locked decision). */
const DEFAULT_VOLUME = 0.7;

export interface AudioEngine {
  /** Route a MediaStreamTrack through the GainNode pipeline. */
  playTrack(track: MediaStreamTrack): void;
  /** Set volume (0.0 to 1.0) via GainNode for glitch-free updates. */
  setVolume(value: number): void;
  /** Mute audio by setting gain to 0 (preserves volume for unmute). */
  mute(): void;
  /** Restore audio to the given volume level. */
  unmute(volume: number): void;
  /** Whether audio is currently muted. */
  isMuted(): boolean;
  /** Resume AudioContext -- MUST be called from a user gesture handler. */
  resume(): Promise<void>;
  /** Get the underlying AudioContext (for state checks). */
  getContext(): AudioContext;
  /** Close the AudioContext and release all resources. */
  close(): void;
}

/**
 * Create a Web Audio API engine with GainNode volume control.
 *
 * AudioContext is created suspended -- call resume() inside a user gesture
 * (the "Start Listening" button tap) for autoplay policy compliance.
 */
export function createAudioEngine(): AudioEngine {
  let audioContext: AudioContext | null = new AudioContext();
  const gainNode = audioContext.createGain();
  gainNode.gain.value = DEFAULT_VOLUME;
  gainNode.connect(audioContext.destination);

  let currentSource: MediaStreamAudioSourceNode | null = null;
  let muted = false;
  let volumeBeforeMute = DEFAULT_VOLUME;

  /**
   * Handle visibilitychange: resume AudioContext when page becomes visible
   * again after mobile browser power saving suspends it (research pitfall 5).
   */
  const handleVisibilityChange = (): void => {
    if (
      document.visibilityState === "visible" &&
      audioContext &&
      audioContext.state === "suspended"
    ) {
      audioContext.resume().catch(() => {
        // Ignore -- may not have user gesture yet
      });
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    playTrack(track: MediaStreamTrack): void {
      if (!audioContext) return;

      // Disconnect previous source (channel switch case)
      if (currentSource) {
        currentSource.disconnect();
        currentSource = null;
      }

      const stream = new MediaStream([track]);
      currentSource = audioContext.createMediaStreamSource(stream);
      currentSource.connect(gainNode);
    },

    setVolume(value: number): void {
      if (!audioContext) return;
      gainNode.gain.setValueAtTime(value, audioContext.currentTime);
      if (!muted) {
        volumeBeforeMute = value;
      }
    },

    mute(): void {
      if (!audioContext || muted) return;
      volumeBeforeMute = gainNode.gain.value;
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      muted = true;
    },

    unmute(volume: number): void {
      if (!audioContext || !muted) return;
      gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
      muted = false;
    },

    isMuted(): boolean {
      return muted;
    },

    async resume(): Promise<void> {
      if (!audioContext) return;
      await audioContext.resume();
    },

    getContext(): AudioContext {
      if (!audioContext) {
        throw new Error("AudioEngine has been closed");
      }
      return audioContext;
    },

    close(): void {
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (currentSource) {
        currentSource.disconnect();
        currentSource = null;
      }

      if (audioContext) {
        audioContext.close().catch(() => {
          // Ignore close errors
        });
        audioContext = null;
      }
    },
  };
}
