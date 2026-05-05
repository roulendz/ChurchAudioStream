interface LevelMeterProps {
  readonly rms?: number[] | null;
  readonly clipping?: boolean;
  readonly barCount?: number;
  readonly className?: string;
  readonly variant?: "horizontal" | "vertical";
  readonly channelCount?: 1 | 2;
}

const DEFAULT_BAR_COUNT = 12;

function perceptualLevel(linear: number): number {
  if (linear <= 0) return 0;
  return Math.cbrt(linear);
}

function MeterColumn({
  level,
  clipping,
  barCount,
  variant,
  className = "",
}: {
  level: number;
  clipping: boolean;
  barCount: number;
  variant: "horizontal" | "vertical";
  className?: string;
}) {
  const perceptual = perceptualLevel(level);
  const litBars = Math.round(perceptual * barCount);

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

/** Pick the loudest channel of the per-output RMS array (mono = 1, stereo = 2). */
function peakRms(rms?: number[] | null): number {
  if (!rms || rms.length === 0) return 0;
  let max = 0;
  for (let i = 0; i < rms.length; i++) {
    if (rms[i] > max) max = rms[i];
  }
  return Math.min(max, 1);
}

export function LevelMeter({
  rms,
  clipping = false,
  barCount = DEFAULT_BAR_COUNT,
  className = "",
  variant = "horizontal",
  channelCount = 1,
}: LevelMeterProps) {
  if (channelCount === 2) {
    const leftLevel = Math.min(rms?.[0] ?? 0, 1);
    const rightLevel = Math.min(rms?.[1] ?? rms?.[0] ?? 0, 1);

    return (
      <div
        className={`flex gap-0.5 ${className}`}
        role="presentation"
        aria-hidden="true"
      >
        <MeterColumn
          level={leftLevel}
          clipping={clipping}
          barCount={barCount}
          variant={variant}
        />
        <MeterColumn
          level={rightLevel}
          clipping={clipping}
          barCount={barCount}
          variant={variant}
        />
      </div>
    );
  }

  return (
    <MeterColumn
      level={peakRms(rms)}
      clipping={clipping}
      barCount={barCount}
      variant={variant}
      className={className}
    />
  );
}
