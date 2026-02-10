/**
 * Root application component managing navigation between views.
 *
 * Uses internal React state for navigation (not pushState per discretion
 * recommendation). Simple fade CSS transition between channel list and
 * player views.
 *
 * Initializes signaling and channel list hooks at the top level, passes
 * peer and connection state down to child views.
 */

import { useState, useCallback, useEffect } from "react";
import { useSignaling } from "./hooks/useSignaling";
import { useChannelList } from "./hooks/useChannelList";
import { useMediasoup } from "./hooks/useMediasoup";
import { useAudioPlayback } from "./hooks/useAudioPlayback";
import { ChannelListView } from "./views/ChannelListView";
import { PlayerView } from "./views/PlayerView";
import type { ListenerChannelInfo } from "./lib/types";
import "./App.css";

type CurrentView = "channels" | "player";

function App() {
  const [currentView, setCurrentView] = useState<CurrentView>("channels");
  const [selectedChannel, setSelectedChannel] =
    useState<ListenerChannelInfo | null>(null);

  const { peer, connectionState, isReconnect, clearReconnect } =
    useSignaling();
  const { channels } = useChannelList(peer);
  const { connectToChannel, disconnect, handleReconnect } = useMediasoup();
  const { startPlayback, stopPlayback } = useAudioPlayback();

  // Handle peer reconnection: reset mediasoup state
  useEffect(() => {
    if (isReconnect) {
      handleReconnect();
      clearReconnect();
    }
  }, [isReconnect, handleReconnect, clearReconnect]);

  const handleSelectChannel = useCallback(
    (channelId: string) => {
      const channel = channels.find((ch) => ch.id === channelId);
      if (!channel) return;
      setSelectedChannel(channel);
      setCurrentView("player");
    },
    [channels],
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
        <div className="app-spinner" />
        <p className="app-status">Connecting...</p>
      </div>
    );
  }

  if (connectionState === "disconnected") {
    return (
      <div className="app-container app-container--centered">
        <p className="app-status">
          Can't reach the audio server. Make sure you're on the church WiFi.
        </p>
      </div>
    );
  }

  return (
    <div className="app-container">
      {connectionState === "reconnecting" && (
        <div className="app-reconnecting-banner" role="alert">
          Reconnecting...
        </div>
      )}

      <div
        className={`app-view ${currentView === "channels" ? "app-view--visible" : "app-view--hidden"}`}
      >
        <ChannelListView
          channels={channels}
          onSelectChannel={handleSelectChannel}
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
          />
        </div>
      )}
    </div>
  );
}

export default App;
