/**
 * Streaming domain type definitions for WebRTC audio delivery via mediasoup.
 *
 * Covers:
 * - Config-driven enums (LatencyMode, LossRecoveryMode)
 * - Per-worker state tracking (WorkerState)
 * - Per-channel streaming state (ChannelStreamingState)
 * - Per-listener peer data (ListenerPeerData)
 * - Admin dashboard DTOs (ListenerSessionInfo, ListenerChannelInfo, WorkerResourceInfo)
 * - Latency estimation (LatencyEstimate)
 * - RTP codec constants matching Phase 3 pipeline builder
 */

import type { types as mediasoupTypes } from "mediasoup";

// Re-export so streaming modules can import protoo types from one place
export type {
  Peer as ProtooPeer,
  Room as ProtooRoom,
  WebSocketServer as ProtooWebSocketServer,
  WebSocketTransport as ProtooTransport,
  ConnectionRequestInfo as ProtooConnectionRequestInfo,
  ProtooRequest,
  AcceptFn as ProtooAcceptFn,
  RejectFn as ProtooRejectFn,
} from "protoo-server";

// ---------------------------------------------------------------------------
// Config-driven enums
// ---------------------------------------------------------------------------

/**
 * Per-channel latency mode.
 * - "live": minimal buffering for lowest latency
 * - "stable": more buffering for stable audio on poor networks
 */
export type LatencyMode = "live" | "stable";

/**
 * Per-channel loss recovery strategy.
 * - "nack": mediasoup retransmits lost packets (higher quality, slightly more latency)
 * - "plc": browser relies on Opus Packet Loss Concealment (lower latency, lower quality)
 */
export type LossRecoveryMode = "nack" | "plc";

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

/** Tracked state for a single mediasoup C++ worker process. */
export interface WorkerState {
  /** The mediasoup Worker instance. */
  readonly worker: mediasoupTypes.Worker;
  /** Zero-based index of this worker in the worker pool. */
  readonly index: number;
  /** Interval handle for periodic memory monitoring. */
  memoryMonitorInterval: ReturnType<typeof setInterval> | null;
}

// ---------------------------------------------------------------------------
// Channel streaming state
// ---------------------------------------------------------------------------

/**
 * Per-channel mediasoup object graph.
 *
 * Each channel gets its own Router (isolation), PlainTransport (GStreamer ingest),
 * and Producer (audio source for consumers). The PlainTransport persists across
 * GStreamer pipeline restarts.
 */
export interface ChannelStreamingState {
  /** Channel UUID this state belongs to. */
  readonly channelId: string;
  /** mediasoup Router for this channel (owns transports and producers). */
  readonly router: mediasoupTypes.Router;
  /** PlainTransport receiving RTP from GStreamer on localhost. */
  readonly plainTransport: mediasoupTypes.PlainTransport;
  /** Audio Producer created on the PlainTransport. */
  readonly audioProducer: mediasoupTypes.Producer;
}

// ---------------------------------------------------------------------------
// Listener peer data (attached to protoo Peer.data)
// ---------------------------------------------------------------------------

/**
 * Application data stored on each protoo Peer instance (peer.data).
 *
 * Tracks the listener's session, WebRTC transport, current consumer,
 * and connection metadata for admin dashboard display.
 */
export interface ListenerPeerData {
  /** Random anonymous session identifier. */
  readonly sessionId: string;
  /** ISO timestamp when the listener connected. */
  readonly connectedAt: string;
  /** Client's RTP capabilities (received during device load). */
  rtpCapabilities: mediasoupTypes.RtpCapabilities | null;
  /** The listener's WebRTC receive transport. */
  webRtcTransport: mediasoupTypes.WebRtcTransport | null;
  /** The currently active audio Consumer (one at a time per Phase 4). */
  currentConsumer: mediasoupTypes.Consumer | null;
  /** Channel ID the listener is currently subscribed to. */
  currentChannelId: string | null;
  /** Whether this peer is an admin preview connection (excluded from listener counts). */
  isAdmin: boolean;
}

// ---------------------------------------------------------------------------
// Admin dashboard DTOs
// ---------------------------------------------------------------------------

/** Subset of listener peer data exposed in the admin dashboard. */
export interface ListenerSessionInfo {
  /** Anonymous session identifier. */
  readonly sessionId: string;
  /** ISO timestamp when connected. */
  readonly connectedAt: string;
  /** Channel the listener is currently on (null if not subscribed). */
  readonly currentChannelId: string | null;
  /** Whether this is an admin preview connection. */
  readonly isAdmin: boolean;
}

/** Channel info pushed to listeners on connect and when channels change. */
export interface ListenerChannelInfo {
  /** Channel UUID. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** Output format (mono/stereo). */
  readonly outputFormat: "mono" | "stereo";
  /** Whether this is the default channel for first-time listeners. */
  readonly defaultChannel: boolean;
  /** Whether the channel has an active audio producer. */
  readonly hasActiveProducer: boolean;
}

/** Worker resource snapshot for admin dashboard display. */
export interface WorkerResourceInfo {
  /** Zero-based worker index. */
  readonly index: number;
  /** Peak resident set size in kilobytes (from getResourceUsage().ru_maxrss). */
  readonly peakMemoryKb: number;
  /** Number of Routers on this worker. */
  readonly routerCount: number;
  /** Whether the worker process is alive. */
  readonly alive: boolean;
}

// ---------------------------------------------------------------------------
// Latency estimation
// ---------------------------------------------------------------------------

/**
 * Component-based latency breakdown for admin dashboard display.
 *
 * All values are estimated (not actively measured) based on configuration
 * and known processing characteristics.
 */
export interface LatencyEstimate {
  /** GStreamer pipeline buffer latency in ms. */
  readonly gstreamerBufferMs: number;
  /** Opus encoding latency in ms (based on frame size). */
  readonly opusEncodeMs: number;
  /** mediasoup SFU forwarding latency in ms (typically <1ms). */
  readonly mediasoupForwardMs: number;
  /** WebRTC jitter buffer latency in ms (browser-side, estimated). */
  readonly webrtcJitterBufferMs: number;
  /** Network propagation latency in ms (local WiFi, estimated). */
  readonly networkMs: number;
  /** Total estimated end-to-end latency in ms. */
  readonly totalMs: number;
}

// ---------------------------------------------------------------------------
// Streaming config (inferred from schema, used by streaming modules)
// ---------------------------------------------------------------------------

/** Streaming subsystem configuration (inferred from ConfigSchema). */
export interface StreamingConfig {
  readonly mediasoup: {
    readonly workerCount: number;
    readonly rtcMinPort: number;
    readonly rtcMaxPort: number;
    readonly logLevel: "debug" | "warn" | "error" | "none";
  };
  readonly streaming: {
    readonly heartbeatIntervalMs: number;
    readonly rateLimitPerIp: number;
    readonly rateLimitWindowMs: number;
    readonly shutdownDrainMs: number;
  };
}

// ---------------------------------------------------------------------------
// RTP codec constants (must match Phase 3 pipeline builder)
// ---------------------------------------------------------------------------

/**
 * RTP payload type for Opus.
 * Must match `rtpopuspay pt=101` in pipeline-builder.ts.
 */
export const OPUS_PAYLOAD_TYPE = 101 as const;

/**
 * Opus RTP codec definition for mediasoup Router and Producer creation.
 *
 * Matches the GStreamer pipeline builder output:
 * - opusenc encodes stereo audio
 * - rtpopuspay pt=101 sets payload type
 * - sprop-stereo=1 signals stereo in SDP
 */
export const OPUS_RTP_CODEC: mediasoupTypes.RtpCodecCapability = {
  kind: "audio",
  mimeType: "audio/opus",
  preferredPayloadType: OPUS_PAYLOAD_TYPE,
  clockRate: 48000,
  channels: 2,
};

/**
 * Opus RTP parameters for PlainTransport Producer creation.
 * Used when creating the audio producer from GStreamer RTP input.
 *
 * @param ssrc - Channel-specific SSRC from generateSsrc(channelId)
 */
export function buildOpusRtpParameters(
  ssrc: number,
): mediasoupTypes.RtpParameters {
  return {
    codecs: [
      {
        mimeType: "audio/opus",
        clockRate: 48000,
        payloadType: OPUS_PAYLOAD_TYPE,
        channels: 2,
        parameters: { "sprop-stereo": 1 },
      },
    ],
    encodings: [{ ssrc }],
  };
}
