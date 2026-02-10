/**
 * CSS-only pulsing ring visualization for the audio player.
 *
 * Two concentric rings for depth: inner solid circle + outer pulsing ring.
 * Uses transform: scale() for GPU-accelerated animation.
 * Animation pauses when muted or not playing (visual feedback).
 *
 * Ring size: ~120px diameter, centered.
 * Animation: Scale 1.0 -> 1.08 -> 1.0 over 2s, ease-in-out.
 * Outer ring opacity cycles 0.6 -> 1.0 -> 0.6.
 */

interface PulsingRingProps {
  /** Whether audio is actively playing. */
  readonly isPlaying: boolean;
  /** Whether audio is muted (ring pauses). */
  readonly isMuted: boolean;
}

export function PulsingRing({ isPlaying, isMuted }: PulsingRingProps) {
  const isAnimating = isPlaying && !isMuted;

  return (
    <div
      className="pulsing-ring"
      role="presentation"
      aria-hidden="true"
    >
      <div
        className={`pulsing-ring__outer ${isAnimating ? "pulsing-ring__outer--active" : "pulsing-ring__outer--paused"}`}
      />
      <div
        className={`pulsing-ring__inner ${isAnimating ? "pulsing-ring__inner--active" : "pulsing-ring__inner--paused"}`}
      />
    </div>
  );
}
