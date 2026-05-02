/**
 * Rich WebRTC stats snapshot for the geek panel.
 *
 * Pulls inbound-rtp + candidate-pair + codec reports from the mediasoup
 * consumer's RTCPeerConnection and folds them into a flat structure the
 * UI can render. All values are best-effort; missing fields stay 0 / "".
 *
 * Bitrate is computed as a delta between two consecutive snapshots, so
 * the caller passes in the previous snapshot to get a non-zero value.
 */

import type { types as mediasoupTypes } from "mediasoup-client";

export interface ConnectionStatsSnapshot {
  /** Round-trip time in ms (from candidate-pair). */
  readonly roundTripTimeMs: number;
  /** Cumulative packet loss percent (lost / (received+lost)). */
  readonly packetLossPercent: number;
  /** Lost packets since stream start. */
  readonly packetsLost: number;
  /** Received packets since stream start. */
  readonly packetsReceived: number;
  /** Inter-arrival jitter in ms. */
  readonly jitterMs: number;
  /** Audio bitrate in kbps over the last sampling window. */
  readonly bitrateKbps: number;
  /** Codec MIME type (e.g. "audio/opus"). */
  readonly codec: string;
  /** Codec sample rate in Hz. */
  readonly sampleRateHz: number;
  /** Codec channel count. */
  readonly channelCount: number;
  /** ICE transport selected pair description. */
  readonly transport: string;
  /** Local ICE candidate type — host (LAN), srflx (NAT), relay (TURN). */
  readonly candidateType: string;
  /** Remote ICE candidate type. */
  readonly remoteCandidateType: string;
  /** Bytes received since stream start. */
  readonly bytesReceived: number;
  /** Total time the consumer has been receiving (ms). */
  readonly receivingDurationMs: number;
  /** Wall-clock timestamp of this snapshot (ms since epoch). */
  readonly capturedAt: number;
}

const EMPTY_SNAPSHOT: ConnectionStatsSnapshot = {
  roundTripTimeMs: 0,
  packetLossPercent: 0,
  packetsLost: 0,
  packetsReceived: 0,
  jitterMs: 0,
  bitrateKbps: 0,
  codec: "",
  sampleRateHz: 0,
  channelCount: 0,
  transport: "",
  candidateType: "",
  remoteCandidateType: "",
  bytesReceived: 0,
  receivingDurationMs: 0,
  capturedAt: 0,
};

export async function captureConnectionStats(
  consumer: mediasoupTypes.Consumer,
  previous: ConnectionStatsSnapshot | null,
): Promise<ConnectionStatsSnapshot> {
  try {
    const stats = await consumer.getStats();
    const now = Date.now();

    let rttMs = 0;
    let packetsReceived = 0;
    let packetsLost = 0;
    let jitterMs = 0;
    let bytesReceived = 0;
    let codec = "";
    let sampleRateHz = 0;
    let channelCount = 0;
    let transport = "";
    let receivingMs = 0;
    let selectedLocalCandidateId = "";
    let selectedRemoteCandidateId = "";
    let candidateType = "";
    let remoteCandidateType = "";

    // Build candidate id -> type lookup so we can resolve the selected
    // pair after walking once.
    const candidateTypeById = new Map<string, string>();
    stats.forEach((report) => {
      if (
        report.type === "local-candidate" ||
        report.type === "remote-candidate"
      ) {
        if (typeof report.candidateType === "string") {
          candidateTypeById.set(report.id, report.candidateType);
        }
      }
    });

    const codecIdToMime = new Map<string, string>();
    const codecMeta = new Map<
      string,
      { sampleRate: number; channels: number }
    >();

    stats.forEach((report) => {
      if (report.type === "codec") {
        codecIdToMime.set(report.id, report.mimeType ?? "");
        codecMeta.set(report.id, {
          sampleRate: report.clockRate ?? 0,
          channels: report.channels ?? 0,
        });
      }
    });

    stats.forEach((report) => {
      if (report.type === "candidate-pair") {
        const isSelected =
          report.selected === true || report.state === "succeeded";
        if (isSelected) {
          if (typeof report.currentRoundTripTime === "number") {
            rttMs = report.currentRoundTripTime * 1000;
          }
          selectedLocalCandidateId =
            (report.localCandidateId as string) ?? "";
          selectedRemoteCandidateId =
            (report.remoteCandidateId as string) ?? "";
        }
      }

      if (report.type === "inbound-rtp" && report.kind === "audio") {
        packetsReceived = report.packetsReceived ?? 0;
        packetsLost = report.packetsLost ?? 0;
        jitterMs = (report.jitter ?? 0) * 1000;
        bytesReceived = report.bytesReceived ?? 0;
        const codecId = report.codecId as string | undefined;
        if (codecId) {
          codec = codecIdToMime.get(codecId) ?? "";
          const meta = codecMeta.get(codecId);
          if (meta) {
            sampleRateHz = meta.sampleRate;
            channelCount = meta.channels;
          }
        }
        if (typeof report.totalSamplesDuration === "number") {
          receivingMs = report.totalSamplesDuration * 1000;
        }
      }
    });

    candidateType = candidateTypeById.get(selectedLocalCandidateId) ?? "";
    remoteCandidateType =
      candidateTypeById.get(selectedRemoteCandidateId) ?? "";
    if (candidateType || remoteCandidateType) {
      transport = `${candidateType || "?"} ↔ ${remoteCandidateType || "?"}`;
    }

    let bitrateKbps = 0;
    if (previous && previous.capturedAt > 0) {
      const dtMs = now - previous.capturedAt;
      const dBytes = bytesReceived - previous.bytesReceived;
      if (dtMs > 0 && dBytes > 0) {
        bitrateKbps = (dBytes * 8) / dtMs; // bytes*8/ms == kbps
      }
    }

    const totalPackets = packetsReceived + packetsLost;
    const packetLossPercent =
      totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;

    return {
      roundTripTimeMs: rttMs,
      packetLossPercent,
      packetsLost,
      packetsReceived,
      jitterMs,
      bitrateKbps,
      codec,
      sampleRateHz,
      channelCount,
      transport,
      candidateType,
      remoteCandidateType,
      bytesReceived,
      receivingDurationMs: receivingMs,
      capturedAt: now,
    };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export const EMPTY_CONNECTION_STATS = EMPTY_SNAPSHOT;
