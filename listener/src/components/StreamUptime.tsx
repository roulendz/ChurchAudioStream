/**
 * Auto-ticking "Live for Xm" indicator. Re-renders every 30s so the
 * value stays accurate without burning a per-second timer for every
 * channel card.
 *
 * Returns null when startedAt is null/undefined (channel offline).
 */

import { useEffect, useState } from "react";

interface StreamUptimeProps {
  /** Wall-clock ms when the producer started, from sidecar telemetry. */
  readonly startedAt?: number | null;
  /** Optional formatter override. */
  readonly format?: (durationMs: number) => string;
  readonly className?: string;
}

const TICK_INTERVAL_MS = 30_000;

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `<1m`;
}

export function StreamUptime({
  startedAt,
  format = formatDuration,
  className = "",
}: StreamUptimeProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [startedAt]);

  if (startedAt == null) return null;
  const durationMs = now - startedAt;
  if (durationMs < 0) return null;

  return <span className={className}>Live for {format(durationMs)}</span>;
}
