/**
 * Mix balance slider for dual-channel blending.
 *
 * Range: 0 (primary only) to 100 (secondary only), centered at 50.
 * Uses identical styling to VolumeSlider (6px track, accent fill, 22px thumb).
 * Labels show primary channel name on left, secondary on right.
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";

interface MixBalanceSliderProps {
  readonly balance: number; // 0.0 - 1.0
  readonly onBalanceChange: (value: number) => void;
  readonly primaryLabel: string;
  readonly secondaryLabel: string;
  readonly onDisconnect: () => void;
  readonly disabled: boolean;
}

export function MixBalanceSlider({
  balance,
  onBalanceChange,
  primaryLabel,
  secondaryLabel,
  onDisconnect,
  disabled,
}: MixBalanceSliderProps) {
  const { t } = useTranslation();
  const displayBalance = Math.round(balance * 100);

  const handleSliderChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onBalanceChange(Number(event.target.value) / 100);
    },
    [onBalanceChange],
  );

  return (
    <div className={`mix-balance ${disabled ? "mix-balance--disabled" : ""}`}>
      <div className="mix-balance__header">
        <span className="mix-balance__label">{t("player.mix")}</span>
        <button
          className="mix-balance__close-btn"
          onClick={onDisconnect}
          aria-label={t("share.close")}
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div className="mix-balance__slider-row">
        <span className="mix-balance__channel-label">{primaryLabel}</span>
        <input
          className="mix-balance__range"
          type="range"
          min="0"
          max="100"
          step="1"
          value={displayBalance}
          onChange={handleSliderChange}
          disabled={disabled}
          role="slider"
          aria-label="Mix balance"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={displayBalance}
          style={{ "--mix-fill": `${displayBalance}%` } as React.CSSProperties}
        />
        <span className="mix-balance__channel-label">{secondaryLabel}</span>
      </div>
    </div>
  );
}
