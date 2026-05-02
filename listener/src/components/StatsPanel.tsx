/**
 * Geek-mode connection stats modal.
 *
 * Polls the consumer's RTCPeerConnection.getStats() at 1s intervals
 * while open and renders a flat key/value grid: bitrate, RTT, jitter,
 * packet loss %, codec, transport. Closes on backdrop tap or X button.
 */

import { useEffect, useRef, useState } from "react";
import type { types as mediasoupTypes } from "mediasoup-client";
import {
  captureConnectionStats,
  EMPTY_CONNECTION_STATS,
  type ConnectionStatsSnapshot,
} from "../lib/connection-stats";

interface StatsPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly getConsumer: () => mediasoupTypes.Consumer | null;
  /** Server-truth telemetry from the channel notification (overrides
   *  WebRTC stats where available — e.g. codec / sample rate / channels). */
  readonly serverCodec?: {
    readonly mimeType: string;
    readonly sampleRateHz: number;
    readonly channels: number;
    readonly bitrateKbps: number;
    readonly fec: boolean;
    readonly frameSizeMs: number;
  };
  readonly pipelineRestartCount?: number;
  readonly sourceLabel?: string;
  readonly producerStartedAt?: number | null;
  /** Server epoch ms at last activeChannels notification (for clock skew). */
  readonly serverNow?: number | null;
}

const POLL_INTERVAL_MS = 1000;

export function StatsPanel({
  open,
  onClose,
  getConsumer,
  serverCodec,
  pipelineRestartCount,
  sourceLabel,
  producerStartedAt,
}: StatsPanelProps) {
  const [snapshot, setSnapshot] = useState<ConnectionStatsSnapshot>(
    EMPTY_CONNECTION_STATS,
  );
  const previousRef = useRef<ConnectionStatsSnapshot | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const poll = async (): Promise<void> => {
      const consumer = getConsumer();
      if (!consumer) return;
      const next = await captureConnectionStats(consumer, previousRef.current);
      if (cancelled) return;
      previousRef.current = next;
      setSnapshot(next);
    };

    void poll();
    const id = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, getConsumer]);

  if (!open) return null;

  return (
    <div
      className="stats-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Connection stats"
      onClick={onClose}
    >
      <div
        className="stats-panel__sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="stats-panel__header">
          <span className="stats-panel__eyebrow">Connection</span>
          <h2 className="stats-panel__title">Stream stats</h2>
          <span className="stats-panel__refresh-note">
            Updates every {POLL_INTERVAL_MS / 1000}s
          </span>
          <button
            className="stats-panel__close"
            type="button"
            onClick={onClose}
            aria-label="Close stats"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="stats-panel__grid">
          <Stat label="Bitrate" value={`${snapshot.bitrateKbps.toFixed(0)} kbps`} />
          <Stat
            label="Round-trip"
            value={`${snapshot.roundTripTimeMs.toFixed(0)} ms`}
          />
          <Stat
            label="Jitter"
            value={`${snapshot.jitterMs.toFixed(1)} ms`}
          />
          <Stat
            label="Packet loss"
            value={`${snapshot.packetLossPercent.toFixed(2)} %`}
            warn={snapshot.packetLossPercent > 1}
          />
          <Stat
            label="Packets lost"
            value={snapshot.packetsLost.toLocaleString()}
          />
          <Stat
            label="Packets in"
            value={snapshot.packetsReceived.toLocaleString()}
          />
          <Stat
            label="Bytes in"
            value={formatBytes(snapshot.bytesReceived)}
          />
          <Stat
            label="Codec"
            value={
              serverCodec?.mimeType || snapshot.codec || "—"
            }
            mono
          />
          <Stat
            label="Sample rate"
            value={
              serverCodec?.sampleRateHz
                ? `${(serverCodec.sampleRateHz / 1000).toFixed(1)} kHz`
                : snapshot.sampleRateHz
                  ? `${(snapshot.sampleRateHz / 1000).toFixed(1)} kHz`
                  : "—"
            }
          />
          <Stat
            label="Channels"
            value={
              serverCodec?.channels
                ? String(serverCodec.channels)
                : snapshot.channelCount
                  ? String(snapshot.channelCount)
                  : "—"
            }
          />
          {serverCodec && (
            <>
              <Stat
                label="Server bitrate"
                value={`${serverCodec.bitrateKbps} kbps`}
              />
              <Stat
                label="Frame size"
                value={`${serverCodec.frameSizeMs} ms`}
              />
              <Stat label="FEC" value={serverCodec.fec ? "On" : "Off"} />
            </>
          )}
          <Stat
            label="ICE path"
            value={
              snapshot.candidateType
                ? `${snapshot.candidateType} ↔ ${snapshot.remoteCandidateType || "?"}`
                : "—"
            }
            mono
            warn={
              snapshot.candidateType === "relay" ||
              snapshot.remoteCandidateType === "relay"
            }
          />
          {pipelineRestartCount != null && (
            <Stat
              label="Restarts"
              value={String(pipelineRestartCount)}
              warn={pipelineRestartCount > 0}
            />
          )}
          {sourceLabel && (
            <Stat label="Source" value={sourceLabel} mono />
          )}
          {producerStartedAt != null && (
            <Stat
              label="Stream uptime"
              value={formatUptime(Date.now() - producerStartedAt)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
  mono,
}: {
  readonly label: string;
  readonly value: string;
  readonly warn?: boolean;
  readonly mono?: boolean;
}) {
  return (
    <div className="stats-panel__cell">
      <div className="stats-panel__label">{label}</div>
      <div
        className={`stats-panel__value ${warn ? "stats-panel__value--warn" : ""} ${
          mono ? "stats-panel__value--mono" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatUptime(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
