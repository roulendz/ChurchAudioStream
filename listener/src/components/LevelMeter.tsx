/**
 * Server-side audio level meter.
 *
 * Renders a small horizontal stack of bars driven by the latest RMS
 * snapshot from the sidecar. Unlike the client-side AnalyserNode
 * visualizer (which goes silent if the listener mutes audio locally),
 * this meter reflects what the SOURCE is actually emitting — useful
 * feedback for "yes, the speaker is talking, you're just muted".
 *
 * No animation loop: the parent re-renders when the level snapshot
 * changes (~250ms). Bars use CSS transitions for smooth motion.
 */

interface LevelMeterProps {
  /** Latest RMS snapshot for this channel; null = silence / no signal. */
  readonly rms?: number[] | null;
  readonly clipping?: boolean;
  readonly barCount?: number;
  readonly className?: string;
  /** Render style: horizontal mini bars or vertical full meter. */
  readonly variant?: "horizontal" | "vertical";
}

const DEFAULT_BAR_COUNT = 12;

/** Pick the loudest channel of the per-output RMS array (mono = 1, stereo = 2). */
function peakRms(rms?: number[] | null): number {
  if (!rms || rms.length === 0) return 0;
  let max = 0;
  for (let i = 0; i < rms.length; i++) {
    if (rms[i] > max) max = rms[i];
  }
  return Math.min(max, 1);
}

/**
 * Apply a perceptual gamma curve so quiet speech (~0.1 normalized RMS,
 * which would otherwise light only 1 of 6 bars) reads as a healthy 3-4
 * bars. Cubic-root mapping: 0.1 → 0.46, 0.3 → 0.67, 0.7 → 0.89, 1 → 1.
 * Matches how human ears perceive loudness vs raw amplitude.
 */
function perceptualLevel(linear: number): number {
  if (linear <= 0) return 0;
  return Math.cbrt(linear);
}

export function LevelMeter({
  rms,
  clipping = false,
  barCount = DEFAULT_BAR_COUNT,
  className = "",
  variant = "horizontal",
}: LevelMeterProps) {
  const linearLevel = peakRms(rms);
  const level = perceptualLevel(linearLevel);
  const litBars = Math.round(level * barCount);

  return (
    <div
      className={`level-meter level-meter--${variant} ${
        clipping ? "level-meter--clipping" : ""
      } ${className}`}
      role="presentation"
      aria-hidden="true"
    >
      {Array.from({ length: barCount }, (_, i) => {
        const isLit = i < litBars;
        // Color zones: green up to 60%, yellow 60-85%, red 85+
        const ratio = i / barCount;
        const zone =
          ratio < 0.6 ? "green" : ratio < 0.85 ? "yellow" : "red";
        return (
          <span
            key={i}
            className={`level-meter__bar level-meter__bar--${zone} ${
              isLit ? "level-meter__bar--lit" : ""
            }`}
          />
        );
      })}
    </div>
  );
}
