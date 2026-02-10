/**
 * Welcome screen with channel cards.
 *
 * Shows a brief welcome message, total listener count (if any channel
 * has showListenerCount enabled), and a list of channel cards. Live
 * channels sort to top, offline channels are dimmed and non-tappable.
 *
 * Features:
 * - Last-listened channel highlighted with "Continue listening" badge
 * - ShareButton in header (top-right)
 * - PWA install banner (dismissable) on second visit when available
 * - Empty state: friendly message when no channels are available
 */

import { useState, useCallback } from "react";
import type { ListenerChannelInfo } from "../lib/types";
import { ChannelCard } from "../components/ChannelCard";
import { ShareButton } from "../components/ShareButton";
import { Toast } from "../components/Toast";

interface ChannelListViewProps {
  channels: ListenerChannelInfo[];
  onSelectChannel: (channelId: string) => void;
  /** Last-listened channel ID from preferences. */
  lastChannelId: string | null;
  /** Listener URL for the share button. */
  listenerUrl: string;
  /** Whether the browser PWA install prompt is available. */
  canInstall: boolean;
  /** Trigger the browser's native PWA install prompt. */
  promptInstall: () => Promise<void>;
}

export function ChannelListView({
  channels,
  onSelectChannel,
  lastChannelId,
  listenerUrl,
  canInstall,
  promptInstall,
}: ChannelListViewProps) {
  const [toastVisible, setToastVisible] = useState(false);
  const [installBannerDismissed, setInstallBannerDismissed] = useState(false);

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

      onSelectChannel(channelId);
    },
    [channels, onSelectChannel],
  );

  const hideToast = useCallback(() => {
    setToastVisible(false);
  }, []);

  const dismissInstallBanner = useCallback(() => {
    setInstallBannerDismissed(true);
  }, []);

  const handleInstall = useCallback(async () => {
    await promptInstall();
    setInstallBannerDismissed(true);
  }, [promptInstall]);

  const showInstallBanner = canInstall && !installBannerDismissed;

  return (
    <div className="channel-list-view">
      <header className="channel-list-view__header">
        <div className="channel-list-view__header-row">
          <h1 className="channel-list-view__title">Select a channel to listen</h1>
          <ShareButton listenerUrl={listenerUrl} />
        </div>
        {hasAnyListenerCountVisible && totalListeners > 0 && (
          <p className="channel-list-view__listener-count">
            {totalListeners} {totalListeners === 1 ? "person" : "people"}{" "}
            listening
          </p>
        )}
      </header>

      {showInstallBanner && (
        <div className="install-banner">
          <p className="install-banner__text">
            Add to Home Screen for quick access
          </p>
          <div className="install-banner__actions">
            <button
              className="install-banner__install-btn"
              onClick={handleInstall}
            >
              Install
            </button>
            <button
              className="install-banner__dismiss-btn"
              onClick={dismissInstallBanner}
              aria-label="Dismiss install banner"
            >
              Not now
            </button>
          </div>
        </div>
      )}

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
