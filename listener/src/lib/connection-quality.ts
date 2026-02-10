/**
 * WebRTC connection quality assessment via consumer stats polling.
 *
 * Polls consumer.getStats() and classifies connection quality as
 * Good / Fair / Poor based on RTT and packet loss thresholds.
 *
 * Thresholds:
 * - Good: RTT < 50ms AND loss < 1%
 * - Fair: RTT < 150ms AND loss < 5%
 * - Poor: anything worse
 */

import type { types as mediasoupTypes } from "mediasoup-client";

export type QualityLevel = "good" | "fair" | "poor";

export interface ConnectionQualityResult {
  readonly level: QualityLevel;
  readonly roundTripTimeMs: number;
  readonly packetLossPercent: number;
}

/** RTT and loss thresholds for quality classification. */
const GOOD_RTT_MS = 50;
const GOOD_LOSS_PERCENT = 1;
const FAIR_RTT_MS = 150;
const FAIR_LOSS_PERCENT = 5;

/**
 * Assess connection quality from a mediasoup consumer's WebRTC stats.
 *
 * Returns "good" as default when stats are not yet available
 * (e.g., immediately after connection before any RTCP arrives).
 */
export async function assessConnectionQuality(
  consumer: mediasoupTypes.Consumer,
): Promise<ConnectionQualityResult> {
  const defaultResult: ConnectionQualityResult = {
    level: "good",
    roundTripTimeMs: 0,
    packetLossPercent: 0,
  };

  try {
    const stats = await consumer.getStats();

    let roundTripTimeMs = 0;
    let packetsReceived = 0;
    let packetsLost = 0;

    stats.forEach((report) => {
      // Extract RTT from candidate-pair stats
      if (report.type === "candidate-pair" && report.currentRoundTripTime != null) {
        roundTripTimeMs = report.currentRoundTripTime * 1000; // seconds -> ms
      }

      // Extract packet loss from inbound-rtp stats
      if (report.type === "inbound-rtp" && report.kind === "audio") {
        packetsReceived = report.packetsReceived ?? 0;
        packetsLost = report.packetsLost ?? 0;
      }
    });

    const totalPackets = packetsReceived + packetsLost;
    const packetLossPercent = totalPackets > 0
      ? (packetsLost / totalPackets) * 100
      : 0;

    const level = classifyQuality(roundTripTimeMs, packetLossPercent);

    return { level, roundTripTimeMs, packetLossPercent };
  } catch {
    // Stats unavailable (consumer closed, transport not connected yet)
    return defaultResult;
  }
}

function classifyQuality(rttMs: number, lossPercent: number): QualityLevel {
  if (rttMs < GOOD_RTT_MS && lossPercent < GOOD_LOSS_PERCENT) return "good";
  if (rttMs < FAIR_RTT_MS && lossPercent < FAIR_LOSS_PERCENT) return "fair";
  return "poor";
}
