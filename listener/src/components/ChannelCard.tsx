/**
 * Channel card component for the channel list view.
 *
 * Displays channel name, language (flag + label), and conditionally shows
 * description, listener count, and live badge based on admin display toggles.
 *
 * Live channels are tappable; offline channels are dimmed with pointer-events
 * disabled. Last-listened channel gets a highlight badge.
 */

import type { ListenerChannelInfo } from "../lib/types";

interface ChannelCardProps {
  channel: ListenerChannelInfo;
  isLastListened: boolean;
  onTap: (channelId: string) => void;
}

export function ChannelCard({
  channel,
  isLastListened,
  onTap,
}: ChannelCardProps) {
  const isLive = channel.hasActiveProducer;
  const { displayToggles } = channel;

  const handleTap = () => {
    onTap(channel.id);
  };

  return (
    <div
      className={`channel-card ${isLive ? "channel-card--live" : "channel-card--offline"}`}
      onClick={isLive ? handleTap : undefined}
      role="button"
      tabIndex={isLive ? 0 : -1}
      aria-disabled={!isLive}
      onKeyDown={
        isLive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") handleTap();
            }
          : undefined
      }
    >
      <div className="channel-card__header">
        <div className="channel-card__language">
          <span className="channel-card__flag">{channel.language.flag}</span>
          <span className="channel-card__lang-label">
            {channel.language.label}
          </span>
        </div>
        {displayToggles.showLiveBadge && (
          <span
            className={`channel-card__badge ${isLive ? "channel-card__badge--live" : "channel-card__badge--offline"}`}
          >
            {isLive ? "Live" : "Offline"}
          </span>
        )}
      </div>

      <h3 className="channel-card__name">{channel.name}</h3>

      {displayToggles.showDescription && channel.description && (
        <p className="channel-card__description">{channel.description}</p>
      )}

      <div className="channel-card__footer">
        {displayToggles.showListenerCount && isLive && (
          <span className="channel-card__listeners">
            {channel.listenerCount}{" "}
            {channel.listenerCount === 1 ? "listener" : "listeners"}
          </span>
        )}
        {isLastListened && (
          <span className="channel-card__last-listened">Last listened</span>
        )}
      </div>

      {!isLive && (
        <div className="channel-card__offline-overlay" aria-hidden="true" />
      )}
    </div>
  );
}
