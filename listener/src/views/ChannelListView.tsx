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
import { useTranslation } from "react-i18next";
import type { ListenerChannelInfo, ChannelAudioLevel } from "../lib/types";
import { ChannelCard } from "../components/ChannelCard";
import { ShareButton } from "../components/ShareButton";
import { Toast } from "../components/Toast";

interface ChannelListViewProps {
  channels: ListenerChannelInfo[];
  /** Live RMS / clipping snapshots per channel from sidecar telemetry. */
  channelLevels: Map<string, ChannelAudioLevel>;
  onSelectChannel: (channelId: string) => void;
  /** Last-listened channel ID from preferences. */
  lastChannelId: string | null;
  /** Listener URL for the share button. */
  listenerUrl: string;
  /** Whether the browser PWA install prompt is available. */
  canInstall: boolean;
  /** Trigger the browser's native PWA install prompt. */
  promptInstall: () => Promise<void>;
  /** Open the global settings panel. */
  onOpenSettings: () => void;
}

export function ChannelListView({
  channels,
  channelLevels,
  onSelectChannel,
  lastChannelId,
  listenerUrl,
  canInstall,
  promptInstall,
  onOpenSettings,
}: ChannelListViewProps) {
  const { t } = useTranslation();
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
          <div className="channel-list-view__title-block">
            <span className="channel-list-view__eyebrow">{t("channelList.eyebrow")}</span>
            <h1 className="channel-list-view__title">{t("channelList.title")}</h1>
            {hasAnyListenerCountVisible && totalListeners > 0 && (
              <span className="channel-list-view__listener-count">
                {t("channel.listeningCount", { count: totalListeners })}
              </span>
            )}
          </div>
          <div className="channel-list-view__header-actions">
            <button
              className="player-view__tool-btn"
              onClick={onOpenSettings}
              aria-label={t("settings.title")}
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-1.42 3.42 2 2 0 01-1.41-.59l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <ShareButton listenerUrl={listenerUrl} />
          </div>
        </div>
      </header>

      {channels.length === 0 ? (
        <div className="channel-list-view__empty">
          <h2 className="channel-list-view__empty-title">{t("channelList.emptyTitle")}</h2>
          <p className="channel-list-view__empty-text">
            {t("channelList.emptyBody")}
          </p>
        </div>
      ) : (
        <div className="channel-list-view__cards">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              level={channelLevels.get(channel.id) ?? null}
              isLastListened={channel.id === lastChannelId}
              onTap={handleChannelTap}
            />
          ))}
        </div>
      )}

      {showInstallBanner && (
        <div className="install-banner">
          <p className="install-banner__text">
            {t("install.bannerText")}
          </p>
          <div className="install-banner__actions">
            <button
              className="install-banner__install-btn"
              onClick={handleInstall}
            >
              {t("install.button")}
            </button>
            <button
              className="install-banner__dismiss-btn"
              onClick={dismissInstallBanner}
              aria-label={t("install.dismiss")}
            >
              {t("install.dismiss")}
            </button>
          </div>
        </div>
      )}

      <Toast
        message={t("channel.offline")}
        visible={toastVisible}
        onHide={hideToast}
      />
    </div>
  );
}
