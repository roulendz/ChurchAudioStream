/**
 * Full-screen audio player view with complete playback controls.
 *
 * Layout (top to bottom):
 * - Header: Back chevron (left), channel name (center), ConnectionQuality (right)
 * - Channel info: Language (flag+label), description (if enabled), listener count (if enabled)
 * - Center: PulsingRing
 * - Elapsed time: "Listening for MM:SS" with 1s interval
 * - Volume area (lower third): VolumeSlider with mute toggle
 *
 * State machine:
 * 1. "connecting" -- Connecting... spinner
 * 2. "ready" -- Start Listening button (user gesture for AudioContext)
 * 3. "playing" -- Full player UI
 * 4. "reconnecting" -- Reconnecting... indicator
 * 5. "channel-offline" -- Channel offline message
 * 6. "error" -- Server unreachable with retry
 *
 * Volume control uses GainNode (not HTMLAudioElement.volume) for iOS Safari.
 * Volume always starts at 70% (0.7) -- does NOT persist across sessions.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { Peer } from "../lib/signaling-client";
import type { ListenerChannelInfo } from "../lib/types";
import type { QualityLevel } from "../lib/connection-quality";
import { assessConnectionQuality } from "../lib/connection-quality";
import { PulsingRing } from "../components/PulsingRing";
import { VolumeSlider } from "../components/VolumeSlider";
import { ConnectionQuality } from "../components/ConnectionQuality";
import "../styles/player.css";

/** Default volume (70% per locked decision). */
const DEFAULT_VOLUME = 0.7;

/** Connection quality polling interval in ms. */
const QUALITY_POLL_INTERVAL_MS = 5000;

type PlayerState =
  | "connecting"
  | "ready"
  | "playing"
  | "reconnecting"
  | "channel-offline"
  | "error";

interface PlayerViewProps {
  readonly channel: ListenerChannelInfo;
  readonly peer: Peer;
  readonly onBack: () => void;
  /** Runs the full signaling handshake, returns the audio track. */
  readonly connectToChannel: (
    channelId: string,
    peer: Peer,
  ) => Promise<MediaStreamTrack>;
  /** Start audio playback through the GainNode pipeline. */
  readonly startPlayback: (track: MediaStreamTrack) => Promise<void>;
  /** Disconnect transport and consumer. */
  readonly disconnectMediasoup: () => void;
  /** Set volume (0.0 to 1.0) via GainNode. Optional -- wired by App.tsx. */
  readonly setVolume?: (value: number) => void;
  /** Mute audio (preserves volume for unmute). Optional -- wired by App.tsx. */
  readonly mute?: () => void;
  /** Restore volume after mute. Optional -- wired by App.tsx. */
  readonly unmute?: () => void;
  /** Whether audio is currently muted. Optional -- wired by App.tsx. */
  readonly isMuted?: boolean;
  /** Get the mediasoup consumer for stats polling. Optional. */
  readonly getConsumer?: () => import("mediasoup-client").types.Consumer | null;
}

/**
 * Format elapsed seconds as "MM:SS".
 */
function formatElapsedTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function PlayerView({
  channel,
  peer,
  onBack,
  connectToChannel,
  startPlayback,
  disconnectMediasoup,
  setVolume: setVolumeExternal,
  mute: muteExternal,
  unmute: unmuteExternal,
  isMuted: isMutedExternal,
  getConsumer,
}: PlayerViewProps) {
  const [playerState, setPlayerState] = useState<PlayerState>("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const mountedRef = useRef(true);

  // Volume state (local) -- always starts at 70%
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [localMuted, setLocalMuted] = useState(false);
  const volumeBeforeMuteRef = useRef(DEFAULT_VOLUME);

  // Elapsed time state
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Connection quality state
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>("good");
  const qualityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Listener count state (updated via protoo notifications)
  const [listenerCount, setListenerCount] = useState(channel.listenerCount);

  // Use external muted state if provided, otherwise local
  const isMuted = isMutedExternal ?? localMuted;

  // ---- WebRTC Handshake on mount ----
  useEffect(() => {
    mountedRef.current = true;
    let aborted = false;

    const connect = async () => {
      try {
        const track = await connectToChannel(channel.id, peer);
        if (aborted) return;
        trackRef.current = track;
        setPlayerState("ready");
      } catch (error) {
        if (aborted) return;
        handleConnectionError(error);
      }
    };

    connect();

    return () => {
      aborted = true;
      mountedRef.current = false;
    };
  }, [channel.id, peer, connectToChannel]);

  // ---- Notification listeners ----
  useEffect(() => {
    const handleNotification = (notification: {
      method: string;
      data?: Record<string, unknown>;
    }) => {
      if (notification.method === "consumerClosed") {
        // Stop elapsed timer and quality polling
        clearTimers();
        setPlayerState("channel-offline");
      }

      if (notification.method === "listenerCounts" && notification.data) {
        const counts = notification.data as Record<string, number>;
        if (counts[channel.id] != null) {
          setListenerCount(counts[channel.id]);
        }
      }
    };

    peer.on("notification", handleNotification);
    return () => {
      peer.off("notification", handleNotification);
    };
  }, [peer, channel.id]);

  // ---- Elapsed time counter ----
  useEffect(() => {
    if (playerState === "playing") {
      setElapsedSeconds(0);
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    }

    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [playerState]);

  // ---- Connection quality polling ----
  useEffect(() => {
    if (playerState === "playing" && getConsumer) {
      const pollQuality = async () => {
        const consumer = getConsumer();
        if (!consumer) return;
        const result = await assessConnectionQuality(consumer);
        if (mountedRef.current) {
          setQualityLevel(result.level);
        }
      };

      // Initial poll
      pollQuality();

      qualityTimerRef.current = setInterval(pollQuality, QUALITY_POLL_INTERVAL_MS);
    } else {
      if (qualityTimerRef.current) {
        clearInterval(qualityTimerRef.current);
        qualityTimerRef.current = null;
      }
    }

    return () => {
      if (qualityTimerRef.current) {
        clearInterval(qualityTimerRef.current);
        qualityTimerRef.current = null;
      }
    };
  }, [playerState, getConsumer]);

  function clearTimers() {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    if (qualityTimerRef.current) {
      clearInterval(qualityTimerRef.current);
      qualityTimerRef.current = null;
    }
  }

  function handleConnectionError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      message.includes("not active") ||
      message.includes("404") ||
      message.includes("Channel not active")
    ) {
      setPlayerState("channel-offline");
    } else {
      setErrorMessage(
        "Can't reach the audio server. Make sure you're on the church WiFi.",
      );
      setPlayerState("error");
    }
  }

  // ---- Handlers ----

  const handleStartListening = useCallback(async () => {
    if (!trackRef.current) return;
    try {
      await startPlayback(trackRef.current);
      // Apply default volume on start
      setVolumeExternal?.(DEFAULT_VOLUME);
      setPlayerState("playing");
    } catch {
      setErrorMessage(
        "Can't reach the audio server. Make sure you're on the church WiFi.",
      );
      setPlayerState("error");
    }
  }, [startPlayback, setVolumeExternal]);

  const handleBack = useCallback(() => {
    clearTimers();
    disconnectMediasoup();
    onBack();
  }, [disconnectMediasoup, onBack]);

  const handleRetry = useCallback(async () => {
    setPlayerState("connecting");
    setErrorMessage("");
    try {
      const track = await connectToChannel(channel.id, peer);
      if (!mountedRef.current) return;
      trackRef.current = track;
      setPlayerState("ready");
    } catch (error) {
      if (!mountedRef.current) return;
      handleConnectionError(error);
    }
  }, [channel.id, peer, connectToChannel]);

  const handleVolumeChange = useCallback(
    (value: number) => {
      setVolume(value);
      setVolumeExternal?.(value);

      // If changing volume while muted, unmute
      if (isMuted && value > 0) {
        if (unmuteExternal) {
          unmuteExternal();
        } else {
          setLocalMuted(false);
        }
      }
    },
    [isMuted, setVolumeExternal, unmuteExternal],
  );

  const handleMuteToggle = useCallback(() => {
    if (isMuted) {
      // Unmute: restore previous volume
      const restoredVolume = volumeBeforeMuteRef.current;
      setVolume(restoredVolume);
      if (unmuteExternal) {
        unmuteExternal();
      } else {
        setLocalMuted(false);
      }
      setVolumeExternal?.(restoredVolume);
    } else {
      // Mute: remember current volume
      volumeBeforeMuteRef.current = volume;
      if (muteExternal) {
        muteExternal();
      } else {
        setLocalMuted(true);
      }
    }
  }, [isMuted, volume, muteExternal, unmuteExternal, setVolumeExternal]);

  // ---- Render helpers ----

  const isPlaying = playerState === "playing";
  const showVolumeSlider =
    playerState === "playing" || playerState === "reconnecting";

  return (
    <div className="player-view">
      {/* Header: back, channel name, connection quality */}
      <header className="player-view__header">
        <div className="player-view__header-left">
          <button
            className="player-view__back-btn"
            onClick={handleBack}
            aria-label="Back to channel list"
            type="button"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>

        <div className="player-view__header-center">{channel.name}</div>

        <div className="player-view__header-right">
          {isPlaying && <ConnectionQuality level={qualityLevel} />}
        </div>
      </header>

      {/* Main content area */}
      <div className="player-view__content">
        {/* Channel info */}
        <div className="player-view__channel-info">
          <span className="player-view__flag">{channel.language.flag}</span>
          <h2 className="player-view__channel-name">{channel.name}</h2>
          <p className="player-view__language">{channel.language.label}</p>

          {/* Optional metadata */}
          <div className="player-view__channel-meta">
            {channel.displayToggles.showListenerCount && (
              <span className="player-view__listener-count">
                {listenerCount} {listenerCount === 1 ? "listener" : "listeners"}
              </span>
            )}
          </div>
        </div>

        {/* Status area: state machine */}
        <div className="player-view__status">
          {playerState === "connecting" && (
            <div className="player-view__connecting">
              <div className="player-view__spinner" />
              <p className="player-view__status-text">Connecting...</p>
            </div>
          )}

          {playerState === "ready" && (
            <button
              className="player-view__start-btn"
              onClick={handleStartListening}
              type="button"
            >
              Start Listening
            </button>
          )}

          {playerState === "playing" && (
            <div className="player-view__playing">
              <PulsingRing isPlaying={true} isMuted={isMuted} />
              <p className="player-view__elapsed">
                Listening for {formatElapsedTime(elapsedSeconds)}
              </p>
            </div>
          )}

          {playerState === "reconnecting" && (
            <div className="player-view__reconnecting">
              <PulsingRing isPlaying={false} isMuted={isMuted} />
              <p className="player-view__reconnecting-text">Reconnecting...</p>
            </div>
          )}

          {playerState === "channel-offline" && (
            <div className="player-view__offline">
              <PulsingRing isPlaying={false} isMuted={true} />
              <p className="player-view__offline-text">Channel offline</p>
            </div>
          )}

          {playerState === "error" && (
            <div className="player-view__error">
              <p className="player-view__error-text">{errorMessage}</p>
              <button
                className="player-view__retry-btn"
                onClick={handleRetry}
                type="button"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Volume area (lower third) */}
      <div className="player-view__volume-area">
        <VolumeSlider
          volume={volume}
          onVolumeChange={handleVolumeChange}
          isMuted={isMuted}
          onMuteToggle={handleMuteToggle}
          disabled={!showVolumeSlider}
        />
      </div>
    </div>
  );
}
