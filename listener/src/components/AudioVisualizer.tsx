/**
 * Circular audio visualizer driven by an AnalyserNode.
 *
 * Renders 64 radial bars around a centred orb. Bar length is mapped from
 * the frequency bin amplitude (0-255), smoothed by the analyser's own
 * smoothingTimeConstant. When no audio is flowing (offline / muted) the
 * bars fall to a low idle height and the orb breathes slowly so the UI
 * still feels alive.
 *
 * Implementation notes:
 *   - Single requestAnimationFrame loop. Cancels on unmount or visibility
 *     hidden so we don't burn CPU when the user can't see anything.
 *   - Canvas resizes with devicePixelRatio for crisp rendering on phones.
 *   - Drawing is purely 2D canvas — no WebGL, no extra deps.
 */

import { useEffect, useRef } from "react";

interface AudioVisualizerProps {
  /** Returns the live AnalyserNode. May return null before first track arrives. */
  readonly getAnalyser: () => AnalyserNode | null;
  /** Animate at full intensity when true. Otherwise renders idle motion. */
  readonly isActive: boolean;
  /** Hex / rgb colour for the bars and orb. */
  readonly accentColor: string;
}

const RADIAL_BAR_COUNT = 72;
const IDLE_BAR_LEVEL = 0.18;
const ACTIVE_BAR_GAIN = 1.4;
/** Floor so even silent frequencies render a visible tick (prevents the
 *  bottom-half "missing bars" effect when most energy is in low freqs). */
const MIN_BAR_AMPLITUDE = 0.18;
const ORB_INNER_RADIUS_RATIO = 0.20;
const BAR_INNER_RADIUS_RATIO = 0.28;
/** Tuned so (BAR_INNER_RADIUS_RATIO + BAR_MAX_LENGTH_RATIO) stays ≤ 0.48
 *  — bars never cross the canvas edge (0.50) at full amplitude. */
const BAR_MAX_LENGTH_RATIO = 0.18;
const BAR_WIDTH_PX = 3;
const ORB_GLOW_BLUR_PX = 32;

function configureCanvasForDpr(
  canvas: HTMLCanvasElement,
  cssSize: number,
): { ctx: CanvasRenderingContext2D | null; pixelSize: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelSize = Math.floor(cssSize * dpr);
  canvas.width = pixelSize;
  canvas.height = pixelSize;
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return { ctx, pixelSize };
}

function selectFrequencyBins(
  buffer: Uint8Array,
  sampleCount: number,
): Float32Array {
  // Mirror the spectrum so the radial display is symmetric:
  //   - First half of `samples` walks low → mid frequencies clockwise
  //     down the right side.
  //   - Second half walks the same data in reverse down the left side.
  // This avoids the bottom-half being dead because most audio energy
  // lives in low frequencies on Opus voice/music streams.
  const usableBins = Math.floor(buffer.length * 0.65);
  const half = Math.floor(sampleCount / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < half; i++) {
    const sourceIndex = Math.floor((i / half) * usableBins);
    const value = buffer[sourceIndex] / 255;
    samples[i] = value;
    // Mirror across the vertical axis (i and sampleCount-1-i are mirrors
    // because angles run clockwise from the top).
    samples[sampleCount - 1 - i] = value;
  }
  return samples;
}

export function AudioVisualizer({
  getAnalyser,
  isActive,
  accentColor,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const idlePhaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const cssSize = Math.min(container.clientWidth, container.clientHeight);
    const { ctx } = configureCanvasForDpr(canvas, cssSize);
    if (!ctx) return;

    const center = cssSize / 2;
    const orbRadius = cssSize * ORB_INNER_RADIUS_RATIO;
    const barInnerRadius = cssSize * BAR_INNER_RADIUS_RATIO;
    const barMaxLength = cssSize * BAR_MAX_LENGTH_RATIO;
    const angleStep = (Math.PI * 2) / RADIAL_BAR_COUNT;

    const draw = (): void => {
      const analyser = getAnalyser();
      let samples: Float32Array;

      if (analyser && isActive) {
        const buffer = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(buffer);
        samples = selectFrequencyBins(buffer, RADIAL_BAR_COUNT);
      } else {
        idlePhaseRef.current += 0.015;
        samples = new Float32Array(RADIAL_BAR_COUNT);
        for (let i = 0; i < RADIAL_BAR_COUNT; i++) {
          const wave =
            Math.sin(idlePhaseRef.current + i * 0.18) * 0.5 + 0.5;
          samples[i] = IDLE_BAR_LEVEL + wave * 0.05;
        }
      }

      ctx.clearRect(0, 0, cssSize, cssSize);

      // Bars
      ctx.lineCap = "round";
      ctx.lineWidth = BAR_WIDTH_PX;
      for (let i = 0; i < RADIAL_BAR_COUNT; i++) {
        const rawAmplitude = Math.min(samples[i] * ACTIVE_BAR_GAIN, 1);
        const amplitude = Math.max(rawAmplitude, MIN_BAR_AMPLITUDE);
        const length = barMaxLength * amplitude;
        const angle = i * angleStep - Math.PI / 2;
        const x1 = center + Math.cos(angle) * barInnerRadius;
        const y1 = center + Math.sin(angle) * barInnerRadius;
        const x2 = center + Math.cos(angle) * (barInnerRadius + length);
        const y2 = center + Math.sin(angle) * (barInnerRadius + length);
        const alpha = 0.5 + amplitude * 0.5;
        ctx.strokeStyle = withAlpha(accentColor, alpha);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Orb (centre)
      const breathe =
        isActive && analyser
          ? 1 + averageAmplitude(samples) * 0.18
          : 1 + Math.sin(idlePhaseRef.current * 1.4) * 0.04;

      ctx.shadowColor = accentColor;
      ctx.shadowBlur = ORB_GLOW_BLUR_PX;
      const gradient = ctx.createRadialGradient(
        center,
        center,
        orbRadius * 0.2,
        center,
        center,
        orbRadius * breathe,
      );
      gradient.addColorStop(0, withAlpha(accentColor, 0.95));
      gradient.addColorStop(0.6, withAlpha(accentColor, 0.55));
      gradient.addColorStop(1, withAlpha(accentColor, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(center, center, orbRadius * breathe, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") {
        if (animationFrameRef.current === null) {
          animationFrameRef.current = requestAnimationFrame(draw);
        }
      } else if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [getAnalyser, isActive, accentColor]);

  return (
    <div
      ref={containerRef}
      className="audio-visualizer"
      role="presentation"
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="audio-visualizer__canvas" />
    </div>
  );
}

function averageAmplitude(samples: Float32Array): number {
  let total = 0;
  for (let i = 0; i < samples.length; i++) total += samples[i];
  return total / samples.length;
}

function withAlpha(color: string, alpha: number): string {
  // Accepts #rrggbb or rgb(...) and returns rgba.
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  }
  return color;
}
