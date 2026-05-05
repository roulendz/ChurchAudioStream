/**
 * Audio engine for WebRTC stream playback + visualizer tap.
 *
 * Architecture:
 *   MediaStream -> HTMLAudioElement (audible sink, unmuted, autoplay)
 *                \-> MediaStreamSourceNode -> AnalyserNode (silent tap, no destination)
 *
 * Why HTMLAudioElement is the sole audible path:
 *   - MediaSession lock-screen / notification controls require an actively
 *     playing, NON-MUTED HTMLMediaElement on Chromium (Edge mobile, Chrome
 *     Android, Chrome desktop) and on iOS WebKit. The previous design used
 *     a muted hidden element + GainNode->destination for volume, but
 *     muted=true disqualifies the element from MediaSession, so lock-screen
 *     controls never appeared on Edge/Chromium phones.
 *   - HTMLAudioElement.volume is read-only on iOS (Apple docs), so iOS
 *     listeners use the device's hardware volume buttons. The on-screen
 *     slider becomes informational on iOS; on Android/desktop it controls
 *     audio.volume directly.
 *
 * Why AnalyserNode is parallel and unconnected:
 *   - AnalyserNode is a non-audible tap. We don't connect it to
 *     audioContext.destination, so it produces NO audio output. The
 *     HTMLAudioElement already plays the stream; the AudioContext tap only
 *     reads frequency/time-domain data for the visualizer.
 *   - Chromium decodes WebRTC RTP into the MediaStreamSourceNode normally
 *     because the HTMLAudioElement is consuming the same MediaStream
 *     (resolves the historical "silent buffer" bug differently than the
 *     old hidden-muted-element trick).
 */

const DEFAULT_VOLUME = 0.7;
const ANALYSER_FFT_SIZE = 256;
const ANALYSER_SMOOTHING = 0.8;

export interface AudioEngine {
  /** Attach the WebRTC track and start playback through the audio element. */
  playTrack(track: MediaStreamTrack): Promise<void>;
  /** Set software volume (0.0-1.0). No-op on iOS where audio.volume is read-only. */
  setVolume(value: number): void;
  /** Mute the audio element (preserves volume). */
  mute(): void;
  /** Unmute the audio element. */
  unmute(): void;
  isMuted(): boolean;
  /** Resume the AudioContext for the analyser. MUST be called inside a user gesture. */
  resume(): Promise<void>;
  /** AnalyserNode for the visualizer to read frequency / waveform data. */
  getAnalyser(): AnalyserNode | null;
  /** True if audio.volume mutates the audible level (false on iOS WebKit). */
  isSoftwareVolumeSupported(): boolean;
  close(): void;
}

function detectIosWebKit(): boolean {
  const ua = navigator.userAgent;
  const isIosDevice = /iPad|iPhone|iPod/.test(ua);
  const isIpadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return isIosDevice || isIpadOs;
}

export function createAudioEngine(): AudioEngine {
  const audioContext: AudioContext = new AudioContext();
  const analyser: AnalyserNode = audioContext.createAnalyser();
  analyser.fftSize = ANALYSER_FFT_SIZE;
  analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;

  // The audio element MUST be attached to the DOM for Chromium MediaSession
  // to surface lock-screen / notification controls. A detached `new Audio()`
  // node plays sound but never registers with the platform media controller
  // on Android Chrome / Edge / Chrome OS. Hide it visually but keep it in
  // the document body.
  const audioElement: HTMLAudioElement = document.createElement("audio");
  audioElement.autoplay = true;
  audioElement.controls = false;
  audioElement.setAttribute("playsinline", "true");
  audioElement.volume = DEFAULT_VOLUME;
  audioElement.style.position = "fixed";
  audioElement.style.width = "0";
  audioElement.style.height = "0";
  audioElement.style.opacity = "0";
  audioElement.style.pointerEvents = "none";
  audioElement.setAttribute("aria-hidden", "true");
  document.body.appendChild(audioElement);

  const isIos = detectIosWebKit();
  let currentSource: MediaStreamAudioSourceNode | null = null;
  let lastVolume = DEFAULT_VOLUME;

  const handleVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") return;
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {
        // No-op: may not have a fresh user gesture yet.
      });
    }
    // The HTMLAudioElement auto-resumes on visibility, but iOS sometimes
    // pauses it silently after a long screen-lock. Nudge it explicitly.
    if (audioElement.srcObject && audioElement.paused) {
      audioElement.play().catch(() => {
        // Ignore — the upstream reconnect flow will rebuild the track.
      });
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    async playTrack(track: MediaStreamTrack): Promise<void> {
      if (currentSource) {
        currentSource.disconnect();
        currentSource = null;
      }

      const stream = new MediaStream([track]);

      // Audible path: HTMLAudioElement plays the stream.
      audioElement.srcObject = stream;
      try {
        await audioElement.play();
      } catch {
        // Ignored: autoplay=true + a recent user gesture (Start Listening
        // tap) usually starts playback. If it threw, the caller's user
        // gesture has already unlocked audio context, so subsequent calls
        // recover on their own.
      }

      // Visualizer tap: same stream into the analyser, no destination.
      currentSource = audioContext.createMediaStreamSource(stream);
      currentSource.connect(analyser);
    },

    setVolume(value: number): void {
      lastVolume = value;
      audioElement.volume = value;
    },

    mute(): void {
      audioElement.muted = true;
    },

    unmute(): void {
      audioElement.muted = false;
      audioElement.volume = lastVolume;
    },

    isMuted(): boolean {
      return audioElement.muted;
    },

    async resume(): Promise<void> {
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
    },

    getAnalyser(): AnalyserNode | null {
      return analyser;
    },

    isSoftwareVolumeSupported(): boolean {
      return !isIos;
    },

    close(): void {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (currentSource) {
        currentSource.disconnect();
        currentSource = null;
      }
      audioElement.pause();
      audioElement.srcObject = null;
      if (audioElement.parentNode) {
        audioElement.parentNode.removeChild(audioElement);
      }
      audioContext.close().catch(() => {
        // Ignore close errors.
      });
    },
  };
}
