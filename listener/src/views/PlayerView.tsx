/**
 * Full-screen player view.
 *
 * State machine: connecting -> ready -> playing | reconnecting | channel-offline | error.
 *
 * Reconnect plumbing (iOS lock-screen fix):
 *   - reconnectTrigger prop bumps every time signaling re-establishes.
 *     When that happens AND we have already started playback once, we
 *     drop into "reconnecting" and re-run the full WebRTC handshake +
 *     startPlayback. The original Start Listening tap unlocked the audio
 *     context, so playback resumes without further user input.
 *   - visibilitychange listener mirrors the same behaviour for the case
 *     where the page becomes visible but the WS is still alive — handles
 *     Android tab-sleep and iOS unlock when WS held.
 *
 * Wake Lock:
 *   - Optional toggle. When active, the OS keeps the screen on while
 *     listening. This prevents the iOS / Android lock-screen audio drop
 *     entirely at the cost of battery.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { Peer } from "../lib/signaling-client";
import type { ListenerChannelInfo } from "../lib/types";
import type { QualityLevel } from "../lib/connection-quality";
import { assessConnectionQuality } from "../lib/connection-quality";
import { useMediaSession } from "../hooks/useMediaSession";
import type { MediaSessionConfig } from "../hooks/useMediaSession";
import { useWakeLock } from "../hooks/useWakeLock";
import { AudioVisualizer } from "../components/AudioVisualizer";
import { VolumeSlider } from "../components/VolumeSlider";
import { ConnectionQuality } from "../components/ConnectionQuality";
import { StatsPanel } from "../components/StatsPanel";
import { StreamUptime } from "../components/StreamUptime";
import type { ChannelAudioLevel } from "../lib/types";
import "../styles/player.css";

const DEFAULT_VOLUME = 0.7;
const QUALITY_POLL_INTERVAL_MS = 5000;
const ACCENT_COLOR = "#7c5cff";

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
  readonly connectToChannel: (
    channelId: string,
    peer: Peer,
  ) => Promise<MediaStreamTrack>;
  readonly startPlayback: (track: MediaStreamTrack) => Promise<void>;
  readonly disconnectMediasoup: () => void;
  readonly setVolume?: (value: number) => void;
  readonly mute?: () => void;
  readonly unmute?: () => void;
  readonly isMuted?: boolean;
  readonly getConsumer?: () => import("mediasoup-client").types.Consumer | null;
  readonly getAnalyser: () => AnalyserNode | null;
  readonly isSoftwareVolumeSupported: boolean;
  /** Bumped by App.tsx every time the signaling layer reconnects. */
  readonly reconnectTrigger: number;
  /** Latest server-side RMS for this channel (null until first frame). */
  readonly serverLevel?: ChannelAudioLevel | null;
}

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
  getAnalyser,
  isSoftwareVolumeSupported,
  reconnectTrigger,
  serverLevel,
}: PlayerViewProps) {
  const [playerState, setPlayerState] = useState<PlayerState>("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const mountedRef = useRef(true);
  /** True after the user has tapped Start Listening at least once. */
  const playbackStartedRef = useRef(false);

  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [localMuted, setLocalMuted] = useState(false);
  const volumeBeforeMuteRef = useRef(DEFAULT_VOLUME);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [qualityLevel, setQualityLevel] = useState<QualityLevel>("good");
  const qualityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [listenerCount, setListenerCount] = useState(channel.listenerCount);
  const [statsPanelOpen, setStatsPanelOpen] = useState(false);

  const wakeLock = useWakeLock();

  const isMuted = isMutedExternal ?? localMuted;

  const mediaSessionConfig = useMemo<MediaSessionConfig | null>(() => {
    if (playerState !== "playing" && playerState !== "reconnecting")
      return null;
    return {
      channelName: channel.name,
      description: channel.description || "Live translation",
      onPlay: () => {
        if (unmuteExternal) {
          unmuteExternal();
        } else {
          setLocalMuted(false);
        }
      },
      onPause: () => {
        if (muteExternal) {
          muteExternal();
        } else {
          setLocalMuted(true);
        }
      },
      onStop: () => {
        handleBack();
      },
    };
    // handleBack depends on disconnectMediasoup + onBack which are stable
    // refs from App.tsx; not listed to avoid recreating the config every
    // render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    playerState,
    channel.name,
    channel.description,
    muteExternal,
    unmuteExternal,
  ]);

  const { updatePlaybackState } = useMediaSession(mediaSessionConfig);

  useEffect(() => {
    if (playerState === "playing") {
      updatePlaybackState(isMuted ? "paused" : "playing");
    } else if (playerState === "reconnecting") {
      updatePlaybackState("paused");
    } else {
      updatePlaybackState("none");
    }
  }, [playerState, isMuted, updatePlaybackState]);

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

  useEffect(() => {
    let cancelled = false;

    const resumeAfterRestart = async (): Promise<void> => {
      if (cancelled || !mountedRef.current) return;
      try {
        const track = await connectToChannel(channel.id, peer);
        if (cancelled || !mountedRef.current) return;
        trackRef.current = track;
        await startPlayback(track);
        if (cancelled || !mountedRef.current) return;
        setPlayerState("playing");
      } catch (error) {
        if (cancelled || !mountedRef.current) return;
        handleConnectionError(error);
      }
    };

    const handleNotification = (notification: {
      method: string;
      data?: Record<string, unknown>;
    }) => {
      if (notification.method === "channelStopped") {
        const payload = notification.data as
          | { channelId?: string }
          | undefined;
        if (payload?.channelId !== channel.id) return;

        clearTimers();
        trackRef.current = null;
        disconnectMediasoup();
        setPlayerState("reconnecting");
        return;
      }

      if (
        notification.method === "activeChannels" ||
        notification.method === "listenerCounts"
      ) {
        const payload = notification.data as
          | { channels?: Array<{ id: string; hasActiveProducer: boolean }> }
          | undefined;
        const ours = payload?.channels?.find((ch) => ch.id === channel.id);

        if (
          playerState === "reconnecting" &&
          ours?.hasActiveProducer === true
        ) {
          void resumeAfterRestart();
        }

        if (notification.method === "listenerCounts" && ours) {
          const enriched = ours as unknown as { listenerCount?: number };
          if (typeof enriched.listenerCount === "number") {
            setListenerCount(enriched.listenerCount);
          }
        }
      }

      if (notification.method === "consumerClosed") {
        clearTimers();
        setPlayerState("channel-offline");
      }
    };

    peer.on("notification", handleNotification);
    return () => {
      cancelled = true;
      peer.off("notification", handleNotification);
    };
  }, [
    peer,
    channel.id,
    playerState,
    connectToChannel,
    startPlayback,
    disconnectMediasoup,
  ]);

  // ---- iOS lock-screen / Android tab-sleep recovery ----
  //
  // Two triggers funnel into the same recovery path:
  //   1. reconnectTrigger bumps when useSignaling fires "open" after a
  //      drop. The WebSocket is back; the WebRTC consumer it referenced
  //      is dead. We must re-run the full handshake.
  //   2. visibilitychange visible — when the page comes back AND the
  //      audio track has gone "ended" or the consumer is closed, force a
  //      restart. (If everything is still alive the audio engine alone
  //      handles the AudioContext resume.)
  useEffect(() => {
    if (!playbackStartedRef.current) return;
    if (reconnectTrigger === 0) return;

    clearTimers();
    trackRef.current = null;
    disconnectMediasoup();
    setPlayerState("reconnecting");

    let cancelled = false;
    const attempt = async (): Promise<void> => {
      try {
        const track = await connectToChannel(channel.id, peer);
        if (cancelled || !mountedRef.current) return;
        trackRef.current = track;
        await startPlayback(track);
        if (cancelled || !mountedRef.current) return;
        setPlayerState("playing");
      } catch (error) {
        if (cancelled || !mountedRef.current) return;
        handleConnectionError(error);
      }
    };
    void attempt();

    return () => {
      cancelled = true;
    };
  }, [
    reconnectTrigger,
    channel.id,
    peer,
    connectToChannel,
    startPlayback,
    disconnectMediasoup,
  ]);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState !== "visible") return;
      if (!playbackStartedRef.current) return;
      const consumer = getConsumer?.();
      const trackEnded =
        trackRef.current?.readyState === "ended" || !trackRef.current;
      const consumerDead = !consumer || consumer.closed;
      if (!trackEnded && !consumerDead) return;

      // Either the consumer or the track died while we were hidden — force
      // the same restart path used for signaling reconnects.
      clearTimers();
      trackRef.current = null;
      disconnectMediasoup();
      setPlayerState("reconnecting");
      void (async () => {
        try {
          const track = await connectToChannel(channel.id, peer);
          if (!mountedRef.current) return;
          trackRef.current = track;
          await startPlayback(track);
          if (!mountedRef.current) return;
          setPlayerState("playing");
        } catch (error) {
          if (!mountedRef.current) return;
          handleConnectionError(error);
        }
      })();
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    channel.id,
    peer,
    connectToChannel,
    startPlayback,
    disconnectMediasoup,
    getConsumer,
  ]);

  // Elapsed time only ticks while audibly playing — pauses when the user
  // hits the in-app pause button (which mutes via mute()/unmute()) so the
  // counter reflects "time you actually heard audio".
  useEffect(() => {
    if (playerState === "playing" && !isMuted) {
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }

    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [playerState, isMuted]);

  // Reset elapsed time only on a fresh play session (entering "playing"
  // from a non-playing state). Pausing/resuming preserves the count.
  useEffect(() => {
    if (playerState === "playing" && elapsedSeconds === 0) {
      // Already zero — nothing to do.
      return;
    }
    if (playerState !== "playing" && playerState !== "reconnecting") {
      setElapsedSeconds(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerState]);

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
      pollQuality();
      qualityTimerRef.current = setInterval(
        pollQuality,
        QUALITY_POLL_INTERVAL_MS,
      );
    } else if (qualityTimerRef.current) {
      clearInterval(qualityTimerRef.current);
      qualityTimerRef.current = null;
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

  const handleStartListening = useCallback(async () => {
    if (!trackRef.current) return;
    try {
      await startPlayback(trackRef.current);
      setVolumeExternal?.(DEFAULT_VOLUME);
      playbackStartedRef.current = true;
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
    wakeLock.setEnabled(false);
    disconnectMediasoup();
    onBack();
  }, [disconnectMediasoup, onBack, wakeLock]);

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
      const restoredVolume = volumeBeforeMuteRef.current;
      setVolume(restoredVolume);
      if (unmuteExternal) {
        unmuteExternal();
      } else {
        setLocalMuted(false);
      }
      setVolumeExternal?.(restoredVolume);
    } else {
      volumeBeforeMuteRef.current = volume;
      if (muteExternal) {
        muteExternal();
      } else {
        setLocalMuted(true);
      }
    }
  }, [isMuted, volume, muteExternal, unmuteExternal, setVolumeExternal]);

  const handleWakeLockToggle = useCallback(() => {
    wakeLock.setEnabled(!wakeLock.enabled);
  }, [wakeLock]);

  const isPlaying = playerState === "playing";
  const isVisualizerActive = isPlaying && !isMuted;
  const showVolumeArea =
    playerState === "playing" || playerState === "reconnecting";

  return (
    <div className="player-view">
      <div className="player-view__aurora" aria-hidden="true">
        <span className="player-view__aurora-blob player-view__aurora-blob--a" />
        <span className="player-view__aurora-blob player-view__aurora-blob--b" />
        <span className="player-view__aurora-blob player-view__aurora-blob--c" />
      </div>

      <header className="player-view__header">
        <button
          className="player-view__icon-btn"
          onClick={handleBack}
          aria-label="Back to channel list"
          type="button"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className="player-view__header-meta">
          <span className="player-view__eyebrow">Now listening</span>
          <span className="player-view__live-dot" data-live={isPlaying} />
        </div>

        <div className="player-view__header-tools">
          {wakeLock.isSupported && showVolumeArea && (
            <button
              className={`player-view__chip ${
                wakeLock.enabled ? "player-view__chip--on" : ""
              }`}
              onClick={handleWakeLockToggle}
              aria-pressed={wakeLock.enabled}
              aria-label={
                wakeLock.enabled
                  ? "Disable keep screen on"
                  : "Keep screen on"
              }
              type="button"
              title={
                wakeLock.enabled
                  ? "Screen will stay on"
                  : "Tap to keep screen on while listening"
              }
            >
              <KeepAwakeIcon active={wakeLock.enabled} />
              <span className="player-view__chip-label">Keep awake</span>
            </button>
          )}
          {isPlaying && (
            <button
              type="button"
              className="player-view__icon-btn"
              onClick={() => setStatsPanelOpen(true)}
              aria-label="Show connection stats"
              title="Tap for stream stats"
            >
              <ConnectionQuality level={qualityLevel} />
            </button>
          )}
        </div>
      </header>

      <main className="player-view__stage">
        <div className="player-view__viz-wrap">
          <AudioVisualizer
            getAnalyser={getAnalyser}
            isActive={isVisualizerActive}
            accentColor={ACCENT_COLOR}
          />
          <div className="player-view__viz-caption">
            <span className="player-view__flag">{channel.language.flag}</span>
            <h1 className="player-view__channel-name">{channel.name}</h1>
            <p className="player-view__language">{channel.language.label}</p>
          </div>
        </div>

        <div className="player-view__status">
          {playerState === "connecting" && (
            <div className="player-view__pill player-view__pill--muted">
              <span className="player-view__pulse-dot" />
              Connecting
            </div>
          )}

          {playerState === "ready" && (
            <button
              className="player-view__cta"
              onClick={handleStartListening}
              type="button"
            >
              <PlayIcon />
              <span>Start Listening</span>
            </button>
          )}

          {(playerState === "playing" || playerState === "reconnecting") && (
            <>
              <div
                className={`player-view__pill ${
                  playerState === "reconnecting" ? "player-view__pill--warn" : ""
                }`}
              >
                <span
                  className={`player-view__pulse-dot ${
                    playerState === "reconnecting"
                      ? "player-view__pulse-dot--warn"
                      : "player-view__pulse-dot--live"
                  }`}
                />
                {playerState === "reconnecting"
                  ? "Reconnecting"
                  : `Listening · ${formatElapsedTime(elapsedSeconds)}`}
                {playerState === "playing" &&
                  channel.displayToggles.showListenerCount && (
                    <>
                      <span className="player-view__pill-sep" />
                      {listenerCount}
                      {listenerCount === 1 ? " listener" : " listeners"}
                    </>
                  )}
                {playerState === "playing" && channel.producerStartedAt && (
                  <>
                    <span className="player-view__pill-sep" />
                    <StreamUptime startedAt={channel.producerStartedAt} />
                  </>
                )}
              </div>

              <button
                type="button"
                className={`player-view__playpause ${
                  isMuted ? "player-view__playpause--paused" : ""
                }`}
                onClick={handleMuteToggle}
                aria-label={isMuted ? "Resume audio" : "Pause audio"}
                aria-pressed={isMuted}
              >
                {isMuted ? <PlayIcon size={28} /> : <PauseIcon size={28} />}
              </button>
            </>
          )}

          {playerState === "channel-offline" && (
            <div className="player-view__pill player-view__pill--muted">
              Channel offline
            </div>
          )}

          {playerState === "error" && (
            <div className="player-view__error">
              <p className="player-view__error-text">{errorMessage}</p>
              <button
                className="player-view__cta player-view__cta--secondary"
                onClick={handleRetry}
                type="button"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </main>

      <footer className="player-view__footer">
        {showVolumeArea && (
          <>
            {isSoftwareVolumeSupported ? (
              <VolumeSlider
                volume={volume}
                onVolumeChange={handleVolumeChange}
                isMuted={isMuted}
                onMuteToggle={handleMuteToggle}
                disabled={!showVolumeArea}
              />
            ) : (
              <div className="player-view__ios-volume">
                <button
                  className={`player-view__icon-btn ${isMuted ? "player-view__icon-btn--on" : ""}`}
                  onClick={handleMuteToggle}
                  aria-label={isMuted ? "Unmute" : "Mute"}
                  type="button"
                >
                  <MuteIcon muted={isMuted} />
                </button>
                <p className="player-view__ios-volume-hint">
                  Use your phone's volume buttons
                </p>
              </div>
            )}
          </>
        )}
      </footer>

      {getConsumer && (
        <StatsPanel
          open={statsPanelOpen}
          onClose={() => setStatsPanelOpen(false)}
          getConsumer={getConsumer}
          serverCodec={channel.codec}
          pipelineRestartCount={channel.pipelineRestartCount}
          sourceLabel={channel.sourceLabel}
          producerStartedAt={channel.producerStartedAt}
        />
      )}
    </div>
  );
}

function PlayIcon({ size = 20 }: { readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M7 5.14v13.72c0 .79.87 1.27 1.54.84l10.78-6.86a1 1 0 0 0 0-1.68L8.54 4.3A1 1 0 0 0 7 5.14z" />
    </svg>
  );
}

function PauseIcon({ size = 20 }: { readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6" y="5" width="4" height="14" rx="1.4" />
      <rect x="14" y="5" width="4" height="14" rx="1.4" />
    </svg>
  );
}

function MuteIcon({ muted }: { readonly muted: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
      {muted ? (
        <>
          <line x1="16" y1="9" x2="22" y2="15" />
          <line x1="22" y1="9" x2="16" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 5.93a9 9 0 0 1 0 12.14" />
        </>
      )}
    </svg>
  );
}

function KeepAwakeIcon({ active }: { readonly active: boolean }) {
  // Phone outline + radiating arcs when active = "keep this device awake".
  // Looks nothing like a sun, so no light/dark-mode confusion.
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="7" y="3" width="10" height="18" rx="2.4" />
      <line x1="11" y1="18" x2="13" y2="18" />
      {active && (
        <>
          <path d="M19.5 7.5c1.4 1.4 1.4 4.6 0 6" stroke="currentColor" />
          <path d="M21.5 5.5c2.4 2.4 2.4 8.6 0 11" stroke="currentColor" opacity="0.6" />
        </>
      )}
    </svg>
  );
}
