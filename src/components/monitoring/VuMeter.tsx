import { useRef, useEffect, useCallback } from "react";
import type { ChannelLevelData } from "../../hooks/useAudioLevels";

const DECAY_FACTOR = 0.92;
const PEAK_HOLD_FRAMES = 30;

const COLOR_GREEN = "#4caf50";
const COLOR_YELLOW = "#ff9800";
const COLOR_RED = "#f44336";
const COLOR_RMS = "rgba(90, 156, 245, 0.5)";
const COLOR_PEAK_LINE = "#e0e0e0";
const COLOR_CLIPPING = "#f44336";
const COLOR_BACKGROUND = "#1a1a2e";
const COLOR_TRACK = "#2a3a5e";

const STEREO_GAP = 2;

interface VuMeterProps {
  channelName: string;
  getLevels: () => ChannelLevelData | null;
  width?: number;
  height?: number;
  channelCount?: 1 | 2;
}

interface MeterState {
  smoothedRms: number;
  smoothedPeak: number;
  peakHold: number;
  peakHoldCounter: number;
}

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

function createDefaultMeterState(): MeterState {
  return { smoothedRms: 0, smoothedPeak: 0, peakHold: 0, peakHoldCounter: 0 };
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  state: MeterState,
  rawRms: number,
  rawPeak: number,
  isClipping: boolean,
  barLeft: number,
  barWidth: number,
  barTop: number,
  barBottom: number,
  barHeight: number,
  padding: number,
  clipIndicatorHeight: number,
): void {
  state.smoothedRms = rawRms > state.smoothedRms
    ? rawRms
    : state.smoothedRms * DECAY_FACTOR;
  state.smoothedPeak = rawPeak > state.smoothedPeak
    ? rawPeak
    : state.smoothedPeak * DECAY_FACTOR;

  if (rawPeak > state.peakHold) {
    state.peakHold = rawPeak;
    state.peakHoldCounter = PEAK_HOLD_FRAMES;
  } else if (state.peakHoldCounter > 0) {
    state.peakHoldCounter--;
  } else {
    state.peakHold *= DECAY_FACTOR;
  }

  ctx.fillStyle = COLOR_TRACK;
  ctx.fillRect(barLeft, barTop, barWidth, barHeight);

  const rmsHeight = state.smoothedRms * barHeight;
  if (rmsHeight > 0) {
    ctx.fillStyle = COLOR_RMS;
    ctx.fillRect(barLeft, barBottom - rmsHeight, barWidth, rmsHeight);
  }

  const peakHeight = state.smoothedPeak * barHeight;
  if (peakHeight > 0) {
    ctx.fillStyle = createMeterGradient(ctx, barTop, barBottom);
    ctx.fillRect(barLeft, barBottom - peakHeight, barWidth, peakHeight);
  }

  if (state.peakHold > 0.01) {
    const peakHoldY = barBottom - state.peakHold * barHeight;
    ctx.strokeStyle = COLOR_PEAK_LINE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(barLeft, peakHoldY);
    ctx.lineTo(barLeft + barWidth, peakHoldY);
    ctx.stroke();
  }

  ctx.fillStyle = isClipping ? COLOR_CLIPPING : COLOR_TRACK;
  ctx.fillRect(barLeft, padding, barWidth, clipIndicatorHeight);
}

export function VuMeter({
  channelName,
  getLevels,
  width = 40,
  height = 160,
  channelCount = 1,
}: VuMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);
  const stateRef = useRef<MeterState[]>([]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const drawWidth = width * dpr;
    const drawHeight = height * dpr;

    if (canvas.width !== drawWidth || canvas.height !== drawHeight) {
      canvas.width = drawWidth;
      canvas.height = drawHeight;
    }

    ctx.scale(dpr, dpr);

    const levels = getLevels();

    while (stateRef.current.length < channelCount) {
      stateRef.current.push(createDefaultMeterState());
    }

    const padding = 2;
    const clipIndicatorHeight = 6;
    const barTop = padding + clipIndicatorHeight + 2;
    const barBottom = height - padding;
    const barHeight = barBottom - barTop;
    const gap = channelCount === 2 ? STEREO_GAP : 0;
    const totalBarArea = width - padding * 2;
    const singleBarWidth = channelCount === 2
      ? (totalBarArea - gap) / 2
      : totalBarArea;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLOR_BACKGROUND;
    ctx.fillRect(0, 0, width, height);

    const isClipping = levels?.clipping ?? false;

    for (let i = 0; i < channelCount; i++) {
      const barLeft = padding + i * (singleBarWidth + gap);
      const rawRms = levels ? (levels.rms[i] ?? levels.rms[0] ?? 0) : 0;
      const rawPeak = levels ? (levels.peak[i] ?? levels.peak[0] ?? 0) : 0;

      drawBar(
        ctx,
        stateRef.current[i],
        rawRms,
        rawPeak,
        isClipping,
        barLeft,
        singleBarWidth,
        barTop,
        barBottom,
        barHeight,
        padding,
        clipIndicatorHeight,
      );
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    animationFrameRef.current = requestAnimationFrame(draw);
  }, [getLevels, width, height, channelCount]);

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [draw]);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <canvas
        ref={canvasRef}
        className="rounded-sm"
        style={{ width: `${width}px`, height: `${height}px` }}
      />
      <span className="max-w-[60px] truncate text-center text-xs text-muted-foreground">
        {channelName}
      </span>
    </div>
  );
}
