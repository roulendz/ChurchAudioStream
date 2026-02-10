/**
 * Canvas-based VU meter with 60fps rendering via requestAnimationFrame.
 *
 * Displays RMS bar (semi-transparent), peak hold line (bright), and
 * a clipping indicator (red flash at top). Supports HiDPI displays
 * by scaling the canvas by devicePixelRatio.
 */

import { useRef, useEffect, useCallback } from "react";
import type { ChannelLevelData } from "../../hooks/useAudioLevels";

/** Smooth decay factor applied per frame (~0.92 gives natural VU fall-off). */
const DECAY_FACTOR = 0.92;

/** Peak hold time in frames before the peak indicator begins to fall. */
const PEAK_HOLD_FRAMES = 30;

/** Colors for the VU meter gradient. */
const COLOR_GREEN = "#4caf50";
const COLOR_YELLOW = "#ff9800";
const COLOR_RED = "#f44336";
const COLOR_RMS = "rgba(90, 156, 245, 0.5)";
const COLOR_PEAK_LINE = "#e0e0e0";
const COLOR_CLIPPING = "#f44336";
const COLOR_BACKGROUND = "#1a1a2e";
const COLOR_TRACK = "#2a3a5e";

interface VuMeterProps {
  channelName: string;
  getLevels: () => ChannelLevelData | null;
  width?: number;
  height?: number;
}

interface MeterState {
  smoothedRms: number;
  smoothedPeak: number;
  peakHold: number;
  peakHoldCounter: number;
}

/**
 * Create a vertical gradient for the meter bar: green at bottom, yellow
 * in the middle, red at the top.
 */
function createMeterGradient(
  ctx: CanvasRenderingContext2D,
  barTop: number,
  barBottom: number,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, barBottom, 0, barTop);
  gradient.addColorStop(0, COLOR_GREEN);
  gradient.addColorStop(0.6, COLOR_GREEN);
  gradient.addColorStop(0.8, COLOR_YELLOW);
  gradient.addColorStop(1.0, COLOR_RED);
  return gradient;
}

export function VuMeter({ channelName, getLevels, width = 40, height = 160 }: VuMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);
  const stateRef = useRef<MeterState>({
    smoothedRms: 0,
    smoothedPeak: 0,
    peakHold: 0,
    peakHoldCounter: 0,
  });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const drawWidth = width * dpr;
    const drawHeight = height * dpr;

    // Resize canvas backing store for HiDPI if needed
    if (canvas.width !== drawWidth || canvas.height !== drawHeight) {
      canvas.width = drawWidth;
      canvas.height = drawHeight;
    }

    ctx.scale(dpr, dpr);

    // Get current level data (non-blocking ref read)
    const levels = getLevels();
    const state = stateRef.current;

    // Compute mono-mixed values (max across channels)
    const rawRms = levels ? Math.max(...levels.rms) : 0;
    const rawPeak = levels ? Math.max(...levels.peak) : 0;
    const isClipping = levels?.clipping ?? false;

    // Smooth decay: rise instantly, fall with decay factor
    state.smoothedRms = rawRms > state.smoothedRms
      ? rawRms
      : state.smoothedRms * DECAY_FACTOR;
    state.smoothedPeak = rawPeak > state.smoothedPeak
      ? rawPeak
      : state.smoothedPeak * DECAY_FACTOR;

    // Peak hold logic
    if (rawPeak > state.peakHold) {
      state.peakHold = rawPeak;
      state.peakHoldCounter = PEAK_HOLD_FRAMES;
    } else if (state.peakHoldCounter > 0) {
      state.peakHoldCounter--;
    } else {
      state.peakHold = state.peakHold * DECAY_FACTOR;
    }

    // Layout constants
    const padding = 2;
    const clipIndicatorHeight = 6;
    const barTop = padding + clipIndicatorHeight + 2;
    const barBottom = height - padding;
    const barHeight = barBottom - barTop;
    const barLeft = padding;
    const barWidth = width - padding * 2;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = COLOR_BACKGROUND;
    ctx.fillRect(0, 0, width, height);

    // Track (empty meter area)
    ctx.fillStyle = COLOR_TRACK;
    ctx.fillRect(barLeft, barTop, barWidth, barHeight);

    // RMS bar (semi-transparent blue)
    const rmsHeight = state.smoothedRms * barHeight;
    if (rmsHeight > 0) {
      ctx.fillStyle = COLOR_RMS;
      ctx.fillRect(barLeft, barBottom - rmsHeight, barWidth, rmsHeight);
    }

    // Peak bar (gradient)
    const peakHeight = state.smoothedPeak * barHeight;
    if (peakHeight > 0) {
      const gradient = createMeterGradient(ctx, barTop, barBottom);
      ctx.fillStyle = gradient;
      ctx.fillRect(barLeft, barBottom - peakHeight, barWidth, peakHeight);
    }

    // Peak hold line
    if (state.peakHold > 0.01) {
      const peakHoldY = barBottom - state.peakHold * barHeight;
      ctx.strokeStyle = COLOR_PEAK_LINE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(barLeft, peakHoldY);
      ctx.lineTo(barLeft + barWidth, peakHoldY);
      ctx.stroke();
    }

    // Clipping indicator (red rectangle at top)
    if (isClipping) {
      ctx.fillStyle = COLOR_CLIPPING;
      ctx.fillRect(barLeft, padding, barWidth, clipIndicatorHeight);
    } else {
      ctx.fillStyle = COLOR_TRACK;
      ctx.fillRect(barLeft, padding, barWidth, clipIndicatorHeight);
    }

    // Reset transform for next frame
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Schedule next frame
    animationFrameRef.current = requestAnimationFrame(draw);
  }, [getLevels, width, height]);

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [draw]);

  return (
    <div className="vu-meter">
      <canvas
        ref={canvasRef}
        style={{ width: `${width}px`, height: `${height}px` }}
      />
      <span className="vu-meter-label">{channelName}</span>
    </div>
  );
}
