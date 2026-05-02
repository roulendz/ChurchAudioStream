/**
 * Channel card for the listener channel list.
 *
 * Always visible (regardless of admin display toggles, which gate
 * optional metadata like description / listener count):
 *   - Language flag (or globe fallback)
 *   - Language label
 *   - Live indicator pill on live channels (the "LIVE" badge admin
 *     toggle is for the explicit text label; we still show a coloured
 *     dot + animated mini-waveform so users instantly know which
 *     channels are streaming).
 *   - Channel name
 *
 * Optional, gated by displayToggles:
 *   - Description (showDescription)
 *   - "LIVE / OFFLINE" text badge (showLiveBadge)
 *   - Listener count (showListenerCount)
 */

import type { ListenerChannelInfo, ChannelAudioLevel } from "../lib/types";
import { StreamUptime } from "./StreamUptime";
import { LevelMeter } from "./LevelMeter";

interface ChannelCardProps {
  channel: ListenerChannelInfo;
  /** Latest server-side RMS level for this channel; null = no signal yet. */
  level: ChannelAudioLevel | null;
  isLastListened: boolean;
  onTap: (channelId: string) => void;
}

const FALLBACK_FLAG = "🌐";

export function ChannelCard({
  channel,
  level,
  isLastListened,
  onTap,
}: ChannelCardProps) {
  const isLive = channel.hasActiveProducer;
  const { displayToggles } = channel;
  const flag = channel.language.flag || FALLBACK_FLAG;
  const langLabel = channel.language.label || "Channel";
  const hasSignal =
    isLive && level != null && level.rms.some((v) => v > 0.01);

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
      <div className="channel-card__flag-tile" aria-hidden="true">
        <span className="channel-card__flag">{flag}</span>
        {isLive && hasSignal ? (
          <LevelMeter
            rms={level?.rms}
            clipping={level?.clipping}
            barCount={3}
            className="channel-card__waveform channel-card__waveform--live"
            variant="horizontal"
          />
        ) : (
          isLive && <MiniWaveform />
        )}
      </div>

      <div className="channel-card__body">
        <div className="channel-card__row">
          <span className="channel-card__lang-label">{langLabel}</span>
          {displayToggles.showLiveBadge && (
            <span
              className={`channel-card__badge ${isLive ? "channel-card__badge--live" : "channel-card__badge--offline"}`}
            >
              {isLive ? "Live" : "Offline"}
            </span>
          )}
          {!displayToggles.showLiveBadge && isLive && (
            <span className="channel-card__live-dot" aria-label="Live">
              <span className="channel-card__live-dot-inner" />
            </span>
          )}
        </div>

        <h3 className="channel-card__name">{channel.name}</h3>

        {displayToggles.showDescription && channel.description && (
          <p className="channel-card__description">{channel.description}</p>
        )}

        <div className="channel-card__footer">
          <StreamUptime
            startedAt={channel.producerStartedAt}
            className="channel-card__uptime"
          />
          {displayToggles.showListenerCount && isLive && (
            <span className="channel-card__listeners">
              {channel.listenerCount}{" "}
              {channel.listenerCount === 1 ? "listener" : "listeners"}
            </span>
          )}
          {isLive &&
            !displayToggles.showListenerCount &&
            channel.producerStartedAt == null && (
              <span className="channel-card__hint">Tap to listen</span>
            )}
          {!isLive && (
            <span className="channel-card__hint channel-card__hint--muted">
              Not streaming
            </span>
          )}
          {isLastListened && (
            <span className="channel-card__last-listened">Last listened</span>
          )}
        </div>
      </div>

      <div className="channel-card__chevron" aria-hidden="true">
        {isLive && (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
      </div>
    </div>
  );
}

function MiniWaveform() {
  // Three CSS-animated bars overlaying the flag tile so live channels
  // visually pulse on the list. Pure CSS, no JS / canvas overhead.
  return (
    <span className="channel-card__waveform" aria-hidden="true">
      <span className="channel-card__waveform-bar" />
      <span className="channel-card__waveform-bar" />
      <span className="channel-card__waveform-bar" />
    </span>
  );
}
