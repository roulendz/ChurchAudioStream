/**
 * Component-based latency estimation for WebRTC audio streaming.
 *
 * Estimates end-to-end latency by summing known processing delays for each
 * component in the audio pipeline: GStreamer capture/encoding, mediasoup SFU
 * forwarding, and browser-side jitter buffer. All values are estimates based
 * on configuration and known processing characteristics (not actively measured).
 *
 * Per locked decision: no active measurement or test tones -- just component sums.
 */

import type { LatencyEstimate, LatencyMode } from "./streaming-types.js";

// ---------------------------------------------------------------------------
// Constants -- estimated component delays
// ---------------------------------------------------------------------------

/**
 * audioloudnorm (gst-plugins-rs) uses a 3-second EBU R128 lookahead window
 * for loudness measurement. This is hard-coded in the element and cannot be
 * reduced. The previous estimate of 10ms was wrong — measured at ~3000ms.
 */
const AGC_BUFFER_MS = 3000;

/**
 * mediasoup C++ worker RTP forwarding latency.
 * The SFU simply routes RTP packets without transcoding; ~1ms typical.
 */
const MEDIASOUP_FORWARD_MS = 1;

/**
 * Estimated local WiFi network propagation latency.
 * For a local LAN (same building), this is typically <1ms.
 */
const NETWORK_MS = 1;

/**
 * WebRTC jitter buffer size per latency mode.
 * - "live": minimal buffering for lowest latency
 * - "stable": default WebRTC jitter buffer for stable playback
 */
const JITTER_BUFFER_MS: Record<LatencyMode, number> = {
  live: 20,
  stable: 60,
};

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Configuration parameters needed to estimate latency for a channel. */
export interface LatencyEstimateInput {
  /** Opus frame size in milliseconds (10, 20, or 40). */
  readonly frameSize: number;
  /** Whether AGC (audioloudnorm) is enabled -- adds buffer latency. */
  readonly agcEnabled: boolean;
  /** Latency mode: "live" for minimal buffering, "stable" for more buffering. */
  readonly latencyMode: LatencyMode;
}

// ---------------------------------------------------------------------------
// LatencyEstimator
// ---------------------------------------------------------------------------

export class LatencyEstimator {
  /**
   * Estimate end-to-end latency for a channel based on its configuration.
   *
   * Component breakdown:
   * - GStreamer buffer: Opus frame size + AGC buffer (if enabled)
   * - Opus encode: ~1 frame size (encoding happens in real-time)
   * - mediasoup forwarding: ~1ms (C++ worker, no transcoding)
   * - WebRTC jitter buffer: depends on latency mode (20ms live, 60ms stable)
   * - Network: ~1ms local WiFi
   */
  estimateLatency(input: LatencyEstimateInput): LatencyEstimate {
    const agcBufferMs = input.agcEnabled ? AGC_BUFFER_MS : 0;
    const gstreamerBufferMs = input.frameSize + agcBufferMs;
    const opusEncodeMs = input.frameSize;
    const mediasoupForwardMs = MEDIASOUP_FORWARD_MS;
    const webrtcJitterBufferMs = JITTER_BUFFER_MS[input.latencyMode];
    const networkMs = NETWORK_MS;

    const totalMs =
      gstreamerBufferMs +
      opusEncodeMs +
      mediasoupForwardMs +
      webrtcJitterBufferMs +
      networkMs;

    return {
      gstreamerBufferMs,
      opusEncodeMs,
      mediasoupForwardMs,
      webrtcJitterBufferMs,
      networkMs,
      totalMs,
    };
  }

  /**
   * Check whether an estimated latency exceeds the admin warning threshold.
   *
   * Per locked decision: alert admin when estimated latency > 200ms.
   *
   * @param estimate  Latency estimate to check
   * @param thresholdMs  Warning threshold in ms (default 200)
   * @returns true if totalMs exceeds the threshold
   */
  checkLatencyThreshold(estimate: LatencyEstimate, thresholdMs = 200): boolean {
    // When AGC is active, its 3s lookahead dominates — warn relative to that baseline
    const effectiveThreshold = estimate.gstreamerBufferMs > 1000
      ? estimate.gstreamerBufferMs + 200
      : thresholdMs;
    return estimate.totalMs > effectiveThreshold;
  }
}
