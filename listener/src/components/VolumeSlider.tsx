/**
 * Horizontal volume slider with mute toggle button.
 *
 * Positioned in the lower third of the player view. Uses a native
 * <input type="range"> with custom CSS for wide track (8px) and large
 * thumb (28px) for easy mobile interaction.
 *
 * Volume icon on the left acts as the mute toggle:
 * - Muted: crossed-out speaker
 * - Low (0-33%): one sound wave
 * - Medium (34-66%): two sound waves
 * - High (67-100%): three sound waves
 *
 * When muted, the slider thumb moves to 0 visually but the parent
 * component remembers the previous volume for unmute.
 */

import { useCallback } from "react";

interface VolumeSliderProps {
  /** Current volume level (0.0 to 1.0). */
  readonly volume: number;
  /** Called when the user drags the slider. Value is 0.0 to 1.0. */
  readonly onVolumeChange: (value: number) => void;
  /** Whether audio is currently muted. */
  readonly isMuted: boolean;
  /** Toggle mute on/off. */
  readonly onMuteToggle: () => void;
  /** Greyed out when not playing. */
  readonly disabled: boolean;
}

type VolumeLevel = "muted" | "low" | "medium" | "high";

function getVolumeLevel(volume: number, isMuted: boolean): VolumeLevel {
  if (isMuted || volume === 0) return "muted";
  if (volume <= 0.33) return "low";
  if (volume <= 0.66) return "medium";
  return "high";
}

/** SVG speaker icon that changes with volume level. */
function VolumeIcon({ level }: { readonly level: VolumeLevel }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Speaker body (always shown) */}
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />

      {level === "muted" && (
        <>
          <line x1="16" y1="9" x2="22" y2="15" />
          <line x1="22" y1="9" x2="16" y2="15" />
        </>
      )}

      {(level === "low" || level === "medium" || level === "high") && (
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      )}

      {(level === "medium" || level === "high") && (
        <path d="M18.07 5.93a9 9 0 0 1 0 12.14" />
      )}

      {level === "high" && (
        <path d="M20.6 3.4a13 13 0 0 1 0 17.2" />
      )}
    </svg>
  );
}

export function VolumeSlider({
  volume,
  onVolumeChange,
  isMuted,
  onMuteToggle,
  disabled,
}: VolumeSliderProps) {
  const displayVolume = isMuted ? 0 : Math.round(volume * 100);
  const volumeLevel = getVolumeLevel(volume, isMuted);

  const handleSliderChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onVolumeChange(Number(event.target.value) / 100);
    },
    [onVolumeChange],
  );

  return (
    <div className={`volume-slider ${disabled ? "volume-slider--disabled" : ""}`}>
      <button
        className="volume-slider__mute-btn"
        onClick={onMuteToggle}
        disabled={disabled}
        aria-label={isMuted ? "Unmute" : "Mute"}
        type="button"
      >
        <VolumeIcon level={volumeLevel} />
      </button>

      <input
        className="volume-slider__range"
        type="range"
        min="0"
        max="100"
        step="1"
        value={displayVolume}
        onChange={handleSliderChange}
        disabled={disabled}
        aria-label="Volume"
        style={
          {
            "--volume-fill": `${displayVolume}%`,
          } as React.CSSProperties
        }
      />
    </div>
  );
}
