/**
 * Canvas VU meter for the player footer — same visual language as the
 * Tauri admin VuMeter but tuned for the listener PWA footer.
 *
 * Driven by the latest sidecar audioLevels snapshot. Smooth decay
 * (0.92/frame) gives natural fall-off; peak hold marker lingers ~30
 * frames before falling, which is the difference between "1 bar
 * blinking" and the full dynamics of speech being readable at a
 * glance.
 */

import { useEffect, useRef } from "react";
import type { ChannelAudioLevel } from "../lib/types";

const DECAY_FACTOR = 0.92;
const PEAK_HOLD_FRAMES = 30;

/** Light-touch perceptual curve so quiet speech (~0.1 raw RMS) reaches
 *  ~30% of the meter instead of ~10%. Less aggressive than cbrt, more
 *  forgiving than linear. */
function perceptualLevel(linear: number): number {
  if (linear <= 0) return 0;
  return Math.sqrt(linear);
}

interface SourceLevelMeterProps {
  /** Latest sidecar RMS snapshot, null if no data yet. */
  readonly level: ChannelAudioLevel | null;
  /** CSS width in px (canvas backing scaled by DPR). */
  readonly width?: number;
  /** CSS height in px. */
  readonly height?: number;
  readonly className?: string;
}

interface MeterState {
  smoothedLevel: number;
  peakHold: number;
  peakHoldCounter: number;
}

export function SourceLevelMeter({
  level,
  width = 14,
  height = 44,
  className = "",
}: SourceLevelMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const stateRef = useRef<MeterState>({
    smoothedLevel: 0,
    peakHold: 0,
    peakHoldCounter: 0,
  });
  // Live ref so the rAF loop sees the latest snapshot without
  // re-binding the effect.
  const levelRef = useRef<ChannelAudioLevel | null>(level);
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    const draw = (): void => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const state = stateRef.current;
      const data = levelRef.current;

      const rawPeak = data ? Math.max(...data.rms) : 0;
      const target = perceptualLevel(Math.min(rawPeak, 1));
      const isClipping = data?.clipping ?? false;

      // Rise instantly; fall with smooth decay.
      state.smoothedLevel =
        target > state.smoothedLevel
          ? target
          : state.smoothedLevel * DECAY_FACTOR;

      // Peak hold: hold a ceiling marker for PEAK_HOLD_FRAMES, then fall.
      if (target > state.peakHold) {
        state.peakHold = target;
        state.peakHoldCounter = PEAK_HOLD_FRAMES;
      } else if (state.peakHoldCounter > 0) {
        state.peakHoldCounter -= 1;
      } else {
        state.peakHold = state.peakHold * DECAY_FACTOR;
      }

      const padding = 2;
      const clipIndicatorHeight = 4;
      const barTop = padding + clipIndicatorHeight + 2;
      const barBottom = height - padding;
      const barHeight = barBottom - barTop;
      const barLeft = padding;
      const barWidth = width - padding * 2;

      ctx.clearRect(0, 0, width, height);

      // Track
      ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
      ctx.fillRect(barLeft, barTop, barWidth, barHeight);

      // Active bar with green->yellow->red gradient
      const fillHeight = state.smoothedLevel * barHeight;
      if (fillHeight > 0) {
        const gradient = ctx.createLinearGradient(0, barBottom, 0, barTop);
        gradient.addColorStop(0, "#2af2c8");
        gradient.addColorStop(0.6, "#2af2c8");
        gradient.addColorStop(0.78, "#ffd23f");
        gradient.addColorStop(1, "#ff5b6f");
        ctx.fillStyle = gradient;
        ctx.fillRect(
          barLeft,
          barBottom - fillHeight,
          barWidth,
          fillHeight,
        );
      }

      // Peak hold line
      if (state.peakHold > 0.01) {
        const peakY = barBottom - state.peakHold * barHeight;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(barLeft, peakY);
        ctx.lineTo(barLeft + barWidth, peakY);
        ctx.stroke();
      }

      // Clipping indicator (top swatch)
      ctx.fillStyle = isClipping ? "#ff5b6f" : "rgba(255, 255, 255, 0.06)";
      ctx.fillRect(barLeft, padding, barWidth, clipIndicatorHeight);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      animationRef.current = requestAnimationFrame(draw);
    };

    animationRef.current = requestAnimationFrame(draw);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      className={`source-level-meter ${className}`}
      style={{ width: `${width}px`, height: `${height}px` }}
      aria-hidden="true"
    />
  );
}
