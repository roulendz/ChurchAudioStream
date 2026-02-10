/**
 * Welcome screen with channel cards.
 *
 * Shows a brief welcome message, total listener count (if any channel
 * has showListenerCount enabled), and a list of channel cards. Live
 * channels sort to top, offline channels are dimmed and non-tappable.
 *
 * Empty state: friendly message when no channels are available.
 */

import { useState, useCallback } from "react";
import type { ListenerChannelInfo } from "../lib/types";
import { ChannelCard } from "../components/ChannelCard";
import { Toast } from "../components/Toast";

/** localStorage key for the last-listened channel ID. */
const LAST_CHANNEL_KEY = "cas_last_channel";

interface ChannelListViewProps {
  channels: ListenerChannelInfo[];
  onSelectChannel: (channelId: string) => void;
}

export function ChannelListView({
  channels,
  onSelectChannel,
}: ChannelListViewProps) {
  const [toastVisible, setToastVisible] = useState(false);
  const lastChannelId = localStorage.getItem(LAST_CHANNEL_KEY);

  // Compute total listener count (only from channels with showListenerCount on)
  const hasAnyListenerCountVisible = channels.some(
    (ch) => ch.displayToggles.showListenerCount,
  );
  const totalListeners = hasAnyListenerCountVisible
    ? channels.reduce((sum, ch) => sum + ch.listenerCount, 0)
    : 0;

  const handleChannelTap = useCallback(
    (channelId: string) => {
      const channel = channels.find((ch) => ch.id === channelId);
      if (!channel) return;

      if (!channel.hasActiveProducer) {
        setToastVisible(true);
        return;
      }

      // Save as last-listened channel
      localStorage.setItem(LAST_CHANNEL_KEY, channelId);
      onSelectChannel(channelId);
    },
    [channels, onSelectChannel],
  );

  const hideToast = useCallback(() => {
    setToastVisible(false);
  }, []);

  return (
    <div className="channel-list-view">
      <header className="channel-list-view__header">
        <h1 className="channel-list-view__title">Select a channel to listen</h1>
        {hasAnyListenerCountVisible && totalListeners > 0 && (
          <p className="channel-list-view__listener-count">
            {totalListeners} {totalListeners === 1 ? "person" : "people"}{" "}
            listening
          </p>
        )}
      </header>

      {channels.length === 0 ? (
        <div className="channel-list-view__empty">
          <p className="channel-list-view__empty-text">
            Please be patient while we connect translators
          </p>
        </div>
      ) : (
        <div className="channel-list-view__cards">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              isLastListened={channel.id === lastChannelId}
              onTap={handleChannelTap}
            />
          ))}
        </div>
      )}

      <Toast
        message="This channel is not live right now"
        visible={toastVisible}
        onHide={hideToast}
      />
    </div>
  );
}
