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
  const { connectToChannel, disconnect, handleReconnect, getConsumer } =
    useMediasoup();
  const { startPlayback, stopPlayback, setVolume, mute, unmute, isMuted } =
    useAudioPlayback();
  const { preferences, setLastChannel, isReturningListener } = usePreferences();
  const { canInstall, promptInstall } = usePwaInstall(isReturningListener);

  /** Saved scroll position for the channel list view. */
  const scrollPositionRef = useRef(0);
  const channelListContainerRef = useRef<HTMLDivElement>(null);

  // Handle peer reconnection: reset mediasoup state
  useEffect(() => {
    if (isReconnect) {
      handleReconnect();
      clearReconnect();
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
        <OfflineScreen />
        <div className="app-spinner" />
        <p className="app-status">Connecting...</p>
      </div>
    );
  }

  if (connectionState === "disconnected") {
    return (
      <div className="app-container app-container--centered">
        <OfflineScreen />
        <p className="app-status">
          Can't reach the audio server. Make sure you're on the church WiFi.
        </p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <OfflineScreen />

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
          onSelectChannel={handleSelectChannel}
          lastChannelId={preferences.lastChannelId}
          listenerUrl={LISTENER_URL}
          canInstall={canInstall}
          promptInstall={promptInstall}
        />
      </div>

      {currentView === "player" && selectedChannel && peer && (
        <div className="app-view app-view--visible">
          <PlayerView
            channel={selectedChannel}
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
          />
        </div>
      )}
    </div>
  );
}

export default App;
