/**
 * Full-screen audio player view (skeleton).
 *
 * Shows connection states: "Connecting..." -> "Start Listening" button
 * -> playing indicator. The "Start Listening" button gates
 * AudioContext.resume() for autoplay policy compliance.
 *
 * Back arrow in top-left tears down the mediasoup transport (audio stops
 * immediately per locked decision) and returns to the channel list.
 *
 * Plan 03 will add: pulsing ring, volume slider, mute button, elapsed
 * time, connection quality, Media Session API.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { Peer } from "../lib/signaling-client";
import type { ListenerChannelInfo } from "../lib/types";

type PlayerState = "connecting" | "ready" | "playing" | "error";

interface PlayerViewProps {
  channel: ListenerChannelInfo;
  peer: Peer;
  onBack: () => void;
  /** Runs the full signaling handshake, returns the audio track. */
  connectToChannel: (
    channelId: string,
    peer: Peer,
  ) => Promise<MediaStreamTrack>;
  /** Start audio playback through the GainNode pipeline. */
  startPlayback: (track: MediaStreamTrack) => Promise<void>;
  /** Disconnect transport and consumer. */
  disconnectMediasoup: () => void;
}

export function PlayerView({
  channel,
  peer,
  onBack,
  connectToChannel,
  startPlayback,
  disconnectMediasoup,
}: PlayerViewProps) {
  const [playerState, setPlayerState] = useState<PlayerState>("connecting");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const mountedRef = useRef(true);

  // Run WebRTC handshake on mount
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
        const message =
          error instanceof Error ? error.message : String(error);

        if (
          message.includes("not active") ||
          message.includes("404") ||
          message.includes("Channel not active")
        ) {
          setErrorMessage("Channel offline");
        } else {
          setErrorMessage(
            "Can't reach the audio server. Make sure you're on the church WiFi.",
          );
        }
        setPlayerState("error");
      }
    };

    connect();

    return () => {
      aborted = true;
      mountedRef.current = false;
    };
  }, [channel.id, peer, connectToChannel]);

  // Listen for consumerClosed notification (producer went away)
  useEffect(() => {
    const handleNotification = (notification: {
      method: string;
      data?: Record<string, unknown>;
    }) => {
      if (notification.method === "consumerClosed") {
        setPlayerState("error");
        setErrorMessage("Channel offline");
      }
    };

    peer.on("notification", handleNotification);
    return () => {
      peer.off("notification", handleNotification);
    };
  }, [peer]);

  const handleStartListening = useCallback(async () => {
    if (!trackRef.current) return;
    try {
      await startPlayback(trackRef.current);
      setPlayerState("playing");
    } catch {
      setErrorMessage(
        "Can't reach the audio server. Make sure you're on the church WiFi.",
      );
      setPlayerState("error");
    }
  }, [startPlayback]);

  const handleBack = useCallback(() => {
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
      const message =
        error instanceof Error ? error.message : String(error);
      if (
        message.includes("not active") ||
        message.includes("404") ||
        message.includes("Channel not active")
      ) {
        setErrorMessage("Channel offline");
      } else {
        setErrorMessage(
          "Can't reach the audio server. Make sure you're on the church WiFi.",
        );
      }
      setPlayerState("error");
    }
  }, [channel.id, peer, connectToChannel]);

  return (
    <div className="player-view">
      <header className="player-view__header">
        <button
          className="player-view__back-btn"
          onClick={handleBack}
          aria-label="Back to channel list"
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
      </header>

      <div className="player-view__content">
        <div className="player-view__channel-info">
          <span className="player-view__flag">{channel.language.flag}</span>
          <h2 className="player-view__channel-name">{channel.name}</h2>
          <p className="player-view__language">{channel.language.label}</p>
        </div>

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
            >
              Start Listening
            </button>
          )}

          {playerState === "playing" && (
            <div className="player-view__playing">
              <div className="player-view__playing-indicator" />
              <p className="player-view__status-text">Listening</p>
            </div>
          )}

          {playerState === "error" && (
            <div className="player-view__error">
              <p className="player-view__error-text">{errorMessage}</p>
              <button
                className="player-view__retry-btn"
                onClick={handleRetry}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
