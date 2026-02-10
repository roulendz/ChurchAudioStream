/**
 * Connection quality indicator with 3-bar signal icon.
 *
 * Displays WebRTC connection quality as a familiar signal strength icon:
 * - Good: all 3 bars green
 * - Fair: 2 bars yellow
 * - Poor: 1 bar red
 *
 * Small size (~24px), positioned in the player header area.
 */

import type { QualityLevel } from "../lib/connection-quality";

interface ConnectionQualityProps {
  readonly level: QualityLevel;
}

const QUALITY_COLORS: Record<QualityLevel, string> = {
  good: "#2ecc71",
  fair: "#f1c40f",
  poor: "#e74c3c",
};

const QUALITY_LABELS: Record<QualityLevel, string> = {
  good: "Good connection",
  fair: "Fair connection",
  poor: "Poor connection",
};

/** Inactive bar color (dimmed). */
const INACTIVE_BAR_COLOR = "rgba(255, 255, 255, 0.15)";

export function ConnectionQuality({ level }: ConnectionQualityProps) {
  const activeColor = QUALITY_COLORS[level];
  const activeBars = level === "good" ? 3 : level === "fair" ? 2 : 1;

  return (
    <div
      className="connection-quality"
      aria-label={QUALITY_LABELS[level]}
      role="img"
    >
      <svg
        className="connection-quality__icon"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
      >
        {/* Bar 1 (shortest, leftmost) */}
        <rect
          x="3"
          y="16"
          width="5"
          height="5"
          rx="1"
          fill={activeBars >= 1 ? activeColor : INACTIVE_BAR_COLOR}
        />
        {/* Bar 2 (medium) */}
        <rect
          x="10"
          y="10"
          width="5"
          height="11"
          rx="1"
          fill={activeBars >= 2 ? activeColor : INACTIVE_BAR_COLOR}
        />
        {/* Bar 3 (tallest, rightmost) */}
        <rect
          x="17"
          y="4"
          width="5"
          height="17"
          rx="1"
          fill={activeBars >= 3 ? activeColor : INACTIVE_BAR_COLOR}
        />
      </svg>
    </div>
  );
}
