/**
 * Audio engine for WebRTC stream playback + visualizer tap.
 *
 * Architecture (non-iOS):
 *   MediaStream -> AudioContext.createMediaStreamSource()
 *                    -> GainNode (volume) -> AudioContext.destination (audible, low-latency)
 *                    \-> AnalyserNode (silent tap for visualizer)
 *   HTMLAudioElement plays the same stream at near-zero volume solely to
 *   register with MediaSession (lock-screen / notification controls).
 *
 * Architecture (iOS):
 *   MediaStream -> HTMLAudioElement (audible sink, unmuted)
 *                \-> MediaStreamSourceNode -> AnalyserNode (silent tap)
 *   iOS WebKit makes audio.volume read-only, so we cannot silence the element.
 *   Web Audio API destination would double-play. Use <audio> only on iOS.
 *
 * Why Web Audio API instead of <audio> element for output:
 *   HTMLAudioElement has large internal playback buffers on mobile browsers
 *   (observed: 3-4 seconds on Chrome Android). These buffers are invisible
 *   to WebRTC stats (jitterBufferDelay, RTT, etc.) and add massive latency.
 *   Web Audio API's MediaStreamSource -> destination path bypasses this
 *   buffer entirely, matching how Discord/Zoom/Teams achieve low latency.
 *
 * Why keep <audio> element at all:
 *   Chromium MediaSession requires an actively playing, NON-MUTED
 *   HTMLMediaElement for lock-screen / notification controls. We set
 *   volume=0.001 (-60dB, inaudible) instead of muted=true because
 *   muted=true disqualifies the element from MediaSession.
 */

const DEFAULT_VOLUME = 0.7;
const ANALYSER_FFT_SIZE = 256;
const ANALYSER_SMOOTHING = 0.8;

// Near-zero volume for the <audio> element's MediaSession-only role.
// Low enough to be inaudible, high enough that Chromium considers it "playing".
const MEDIA_SESSION_VOLUME = 0.001;

export interface AudioEngine {
  playTrack(track: MediaStreamTrack): Promise<void>;
  setVolume(value: number): void;
  mute(): void;
  unmute(): void;
  isMuted(): boolean;
  resume(): Promise<void>;
  getAnalyser(): AnalyserNode | null;
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
  const isIos = detectIosWebKit();

  const audioContext: AudioContext = new AudioContext({
    latencyHint: "interactive",
    sampleRate: 48000,
  });
  const analyser: AnalyserNode = audioContext.createAnalyser();
  analyser.fftSize = ANALYSER_FFT_SIZE;
  analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;

  const audioElement: HTMLAudioElement = document.createElement("audio");
  audioElement.autoplay = true;
  audioElement.controls = false;
  audioElement.setAttribute("playsinline", "true");
  audioElement.volume = isIos ? DEFAULT_VOLUME : MEDIA_SESSION_VOLUME;
  audioElement.style.position = "fixed";
  audioElement.style.width = "0";
  audioElement.style.height = "0";
  audioElement.style.opacity = "0";
  audioElement.style.pointerEvents = "none";
  audioElement.setAttribute("aria-hidden", "true");
  document.body.appendChild(audioElement);

  let currentSource: MediaStreamAudioSourceNode | null = null;
  let gainNode: GainNode | null = null;
  let lastVolume = DEFAULT_VOLUME;
  let muted = false;

  const handleVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") return;
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    if (audioElement.srcObject && audioElement.paused) {
      audioElement.play().catch(() => {});
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    async playTrack(track: MediaStreamTrack): Promise<void> {
      if (currentSource) {
        currentSource.disconnect();
        currentSource = null;
      }
      if (gainNode) {
        gainNode.disconnect();
        gainNode = null;
      }

      const stream = new MediaStream([track]);

      // <audio> element: audible on iOS, near-silent MediaSession shim elsewhere
      audioElement.srcObject = stream;
      try {
        await audioElement.play();
      } catch {
        // Autoplay blocked — upstream user gesture should recover.
      }

      currentSource = audioContext.createMediaStreamSource(stream);

      if (!isIos) {
        // Low-latency audible output via Web Audio API (bypasses <audio> buffer)
        gainNode = audioContext.createGain();
        gainNode.gain.value = muted ? 0 : lastVolume;
        currentSource.connect(gainNode);
        gainNode.connect(audioContext.destination);
      }

      // Visualizer tap (non-audible, no destination connection)
      currentSource.connect(analyser);
    },

    setVolume(value: number): void {
      lastVolume = value;
      if (isIos) {
        audioElement.volume = value;
      } else if (gainNode) {
        gainNode.gain.value = muted ? 0 : value;
      }
    },

    mute(): void {
      muted = true;
      if (isIos) {
        audioElement.muted = true;
      } else if (gainNode) {
        gainNode.gain.value = 0;
      }
    },

    unmute(): void {
      muted = false;
      if (isIos) {
        audioElement.muted = false;
        audioElement.volume = lastVolume;
      } else if (gainNode) {
        gainNode.gain.value = lastVolume;
      }
    },

    isMuted(): boolean {
      return muted;
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
      if (gainNode) {
        gainNode.disconnect();
        gainNode = null;
      }
      if (currentSource) {
        currentSource.disconnect();
        currentSource = null;
      }
      audioElement.pause();
      audioElement.srcObject = null;
      if (audioElement.parentNode) {
        audioElement.parentNode.removeChild(audioElement);
      }
      audioContext.close().catch(() => {});
    },
  };
}
