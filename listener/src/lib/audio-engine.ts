/**
 * Web Audio API engine with GainNode volume control.
 *
 * Audio output flows through AudioContext -> MediaStreamSourceNode -> GainNode
 * -> destination. GainNode controls volume because HTMLAudioElement.volume is
 * read-only on iOS Safari (Apple docs confirm).
 *
 * In parallel, the MediaStream is also attached to a hidden, MUTED
 * HTMLAudioElement. This is required on Chromium desktop: a MediaStream from
 * a WebRTC RTCPeerConnection produces SILENT samples in MediaStreamSourceNode
 * unless the stream is also being consumed by an HTMLMediaElement that has
 * been started with .play() (Chromium bug #121673; mobile Chrome / iOS Safari
 * decode without it). The element is muted at the HTMLMediaElement level so
 * audio output comes exclusively from the GainNode path -- iOS Safari's
 * read-only volume property has no effect on what the user hears.
 *
 * Pattern: Research Pattern 2 (iOS Safari volume fix) + Chromium WebRTC
 * keep-alive workaround.
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

  // Hidden, muted HTMLAudioElement that holds a parallel reference to the
  // active MediaStream. Required on Chromium desktop for the WebRTC pipeline
  // to actually decode received RTP frames into the MediaStreamSourceNode --
  // without an HTMLMediaElement consuming the stream the source node receives
  // silent buffers. element.muted=true makes the element produce no audio
  // output of its own, so all audible output flows through the GainNode.
  const sinkElement: HTMLAudioElement = new Audio();
  sinkElement.muted = true;
  sinkElement.autoplay = true;
  // playsinline is harmless on desktop and prevents iOS from forcing
  // fullscreen video player chrome on the (silent) element.
  sinkElement.setAttribute("playsinline", "true");

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

      // Pin the stream to the hidden sink element so Chromium decodes the
      // WebRTC RTP frames. Without this, MediaStreamSourceNode delivers
      // silent buffers on Chrome desktop. play() may reject if called outside
      // a user gesture stack on some browsers; ignore -- autoplay=true and
      // muted=true make Chromium allow it on the gesture that already
      // triggered audioContext.resume() upstream.
      sinkElement.srcObject = stream;
      sinkElement.play().catch(() => {
        // Safe to ignore: stream is still attached, decoder pipeline is
        // active even without an explicit play() promise resolution on
        // browsers that already auto-started the muted element.
      });
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

      // Detach the hidden sink so the MediaStream can be garbage-collected
      // and the underlying RTCPeerConnection consumer can close cleanly.
      sinkElement.pause();
      sinkElement.srcObject = null;

      if (audioContext) {
        audioContext.close().catch(() => {
          // Ignore close errors
        });
        audioContext = null;
      }
    },
  };
}
