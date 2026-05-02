/**
 * Root application component managing navigation between views.
 *
 * Uses internal React state for navigation (not pushState per discretion
 * recommendation). Simple fade CSS transition between channel list and
 * player views.
 *
 * Initializes signaling, channel list, preferences, and PWA install
 * hooks at the top level. Passes state down to child views.
 *
 * OfflineScreen renders as a full-screen overlay when the device is
 * offline, blocking interaction with the app beneath.
 *
 * Scroll position is saved when leaving the channel list and restored
 * when returning.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useSignaling } from "./hooks/useSignaling";
import { useChannelList } from "./hooks/useChannelList";
import { useChannelLevels } from "./hooks/useChannelLevels";
import { useMediasoup } from "./hooks/useMediasoup";
import { useAudioPlayback } from "./hooks/useAudioPlayback";
import { usePreferences } from "./hooks/usePreferences";
import { usePwaInstall } from "./hooks/usePwaInstall";
import { ChannelListView } from "./views/ChannelListView";
import { PlayerView } from "./views/PlayerView";
import { OfflineScreen } from "./components/OfflineScreen";
import type { ListenerChannelInfo } from "./lib/types";
import "./App.css";

type CurrentView = "channels" | "player";

/** Listener URL constructed from the current page origin. */
const LISTENER_URL = window.location.origin;

function App() {
  const [currentView, setCurrentView] = useState<CurrentView>("channels");
  const [selectedChannel, setSelectedChannel] =
    useState<ListenerChannelInfo | null>(null);

  const { peer, connectionState, isReconnect, clearReconnect } =
    useSignaling();
  const { channels } = useChannelList(peer);
  const channelLevels = useChannelLevels(peer);
  const { connectToChannel, disconnect, handleReconnect, getConsumer } =
    useMediasoup();
  const {
    startPlayback,
    stopPlayback,
    setVolume,
    mute,
    unmute,
    isMuted,
    getAnalyser,
    isSoftwareVolumeSupported,
  } = useAudioPlayback();
  const { preferences, setLastChannel, isReturningListener } = usePreferences();
  const { canInstall, promptInstall } = usePwaInstall(isReturningListener);

  /** Saved scroll position for the channel list view. */
  const scrollPositionRef = useRef(0);
  const channelListContainerRef = useRef<HTMLDivElement>(null);

  /**
   * Monotonic counter that bumps every time the signaling layer reconnects.
   * PlayerView watches it and re-runs the WebRTC handshake when the value
   * changes — fixes iOS lock-screen audio drop where the RTCPeerConnection
   * dies but the WebSocket comes back.
   */
  const [reconnectTrigger, setReconnectTrigger] = useState(0);

  useEffect(() => {
    if (isReconnect) {
      handleReconnect();
      clearReconnect();
      setReconnectTrigger((prev) => prev + 1);
    }
  }, [isReconnect, handleReconnect, clearReconnect]);

  // Restore scroll position when returning to channel list
  useEffect(() => {
    if (currentView === "channels" && channelListContainerRef.current) {
      channelListContainerRef.current.scrollTop = scrollPositionRef.current;
    }
  }, [currentView]);

  const handleSelectChannel = useCallback(
    (channelId: string) => {
      const channel = channels.find((ch) => ch.id === channelId);
      if (!channel) return;

      // Save scroll position before navigating away
      if (channelListContainerRef.current) {
        scrollPositionRef.current =
          channelListContainerRef.current.scrollTop;
      }

      // Persist last-listened channel
      setLastChannel(channelId);

      setSelectedChannel(channel);
      setCurrentView("player");
    },
    [channels, setLastChannel],
  );

  const handleBack = useCallback(() => {
    stopPlayback();
    setCurrentView("channels");
    setSelectedChannel(null);
  }, [stopPlayback]);

  // Show connecting state while signaling is not ready
  if (connectionState === "connecting") {
    return (
      <div className="app-container app-container--centered">
        <OfflineScreen connectionState={connectionState} />
        <div className="app-spinner" />
        <p className="app-status">Connecting...</p>
      </div>
    );
  }

  if (connectionState === "disconnected") {
    return (
      <div className="app-container app-container--centered">
        <OfflineScreen connectionState={connectionState} />
        <p className="app-status">
          Can't reach the audio server. Make sure you're on the church WiFi.
        </p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <OfflineScreen connectionState={connectionState} />

      {connectionState === "reconnecting" && (
        <div className="app-reconnecting-banner" role="alert">
          Reconnecting...
        </div>
      )}

      <div
        ref={channelListContainerRef}
        className={`app-view ${currentView === "channels" ? "app-view--visible" : "app-view--hidden"}`}
      >
        <ChannelListView
          channels={channels}
          channelLevels={channelLevels}
          onSelectChannel={handleSelectChannel}
          lastChannelId={preferences.lastChannelId}
          listenerUrl={LISTENER_URL}
          canInstall={canInstall}
          promptInstall={promptInstall}
        />
      </div>

      {currentView === "player" && selectedChannel && peer && (() => {
        // Re-resolve from the live channels[] so processingMode / uptime
        // / sourceLabel etc. update on telemetry pushes after the user
        // entered the player. Falls back to the snapshot taken at tap.
        const liveChannel =
          channels.find((ch) => ch.id === selectedChannel.id) ?? selectedChannel;
        return (
          <div className="app-view app-view--visible">
            <PlayerView
              channel={liveChannel}
              peer={peer}
              onBack={handleBack}
              connectToChannel={connectToChannel}
              startPlayback={startPlayback}
              disconnectMediasoup={disconnect}
              setVolume={setVolume}
              mute={mute}
              unmute={unmute}
              isMuted={isMuted}
              getConsumer={getConsumer}
              getAnalyser={getAnalyser}
              isSoftwareVolumeSupported={isSoftwareVolumeSupported}
              reconnectTrigger={reconnectTrigger}
              serverLevel={channelLevels.get(liveChannel.id) ?? null}
            />
          </div>
        );
      })()}
    </div>
  );
}

export default App;
