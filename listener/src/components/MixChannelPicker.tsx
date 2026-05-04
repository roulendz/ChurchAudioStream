/**
 * Bottom sheet for selecting a secondary channel to mix.
 *
 * Displays available channels (excluding the current primary).
 * Uses same modal/sheet animation pattern as StatsPanel.
 *
 * Field mapping from ListenerChannelInfo:
 *   - Active check: ch.hasActiveProducer (boolean)
 *   - Flag emoji: ch.language?.flag (string)
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ListenerChannelInfo } from "../lib/types";

interface MixChannelPickerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSelectChannel: (channelId: string) => void;
  readonly channels: readonly ListenerChannelInfo[];
  readonly primaryChannelId: string;
}

export function MixChannelPicker({
  open,
  onClose,
  onSelectChannel,
  channels,
  primaryChannelId,
}: MixChannelPickerProps) {
  const { t } = useTranslation();

  const handleSelect = useCallback(
    (channelId: string) => {
      onSelectChannel(channelId);
      onClose();
    },
    [onSelectChannel, onClose],
  );

  if (!open) return null;

  // Filter out primary channel and offline channels
  // NOTE: ListenerChannelInfo uses "hasActiveProducer" (NOT "isActive")
  const availableChannels = channels.filter(
    (ch) => ch.id !== primaryChannelId && ch.hasActiveProducer,
  );

  return (
    <div
      className="mix-picker"
      role="dialog"
      aria-modal="true"
      aria-label={t("mix.selectChannel")}
      onClick={onClose}
    >
      <div
        className="mix-picker__sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mix-picker__header">
          <h2 className="mix-picker__title">{t("mix.selectChannel")}</h2>
          <button
            className="mix-picker__close-btn"
            onClick={onClose}
            aria-label={t("share.close")}
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M5 5l10 10M15 5l-10 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {availableChannels.length === 0 ? (
          <p className="mix-picker__empty">{t("channelList.emptyTitle")}</p>
        ) : (
          <div className="mix-picker__list" role="listbox">
            {availableChannels.map((channel) => (
              <button
                key={channel.id}
                className="mix-picker__channel-btn"
                onClick={() => handleSelect(channel.id)}
                role="option"
                aria-selected={false}
                type="button"
              >
                <span className="mix-picker__channel-flag">
                  {channel.language?.flag ?? ""}
                </span>
                <span className="mix-picker__channel-name">
                  {channel.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
