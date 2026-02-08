export interface WsMessage {
  type: string;
  payload?: unknown;
  requestId?: string;
}

export interface IdentifyPayload {
  role: "admin" | "listener";
  clientId?: string;
}

export interface WelcomePayload {
  version: string;
  clientId: string;
}

export interface ErrorPayload {
  message: string;
  originalType?: string;
}

export interface ServerStatusPayload {
  uptime: number;
  connections: {
    total: number;
    admin: number;
    listener: number;
    unidentified: number;
  };
  config: {
    port: number;
    host: string;
    domain: string;
  };
}

export interface ConfigUpdateResponsePayload {
  success: boolean;
  config?: unknown;
  errors?: string[];
  requiresRestart?: boolean;
}

export interface ClientMetadata {
  clientId: string;
  role: "admin" | "listener" | "unidentified";
  connectedAt: Date;
  isAlive: boolean;
}

export type ServerMessageType =
  | "welcome"
  | "error"
  | "pong"
  | "identify:ack"
  | "config:response"
  | "config:updated"
  | "server:status"
  | "server:restarting"
  | "interfaces:list"
  // Audio: source discovery
  | "sources:list"
  | "sources:changed"
  // Audio: channel management
  | "channels:list"
  | "channel:created"
  | "channel:updated"
  | "channel:removed"
  | "channel:state"
  // Audio: processing config
  | "channel:processing:updated"
  // Audio: level metering
  | "levels:update"
  // Audio: resource stats
  | "stats:update"
  // Audio: channel events
  | "channel:events"
  // Streaming: admin API
  | "streaming:status"
  | "streaming:workers"
  | "streaming:listeners"
  | "streaming:restart-workers"
  | "streaming:channel-latency"
  | "streaming:listener-count"
  | "streaming:latency-warning"
  | "streaming:worker-alert";

// ---------------------------------------------------------------------------
// Audio WebSocket payload types
// ---------------------------------------------------------------------------

/** Response payload for sources:list. */
export interface SourcesListPayload {
  sources: unknown[];
}

/** Notification payload when sources change. */
export interface SourcesChangedPayload {
  /** Empty -- clients should re-request sources:list. */
}

/** Response payload for channels:list. */
export interface ChannelListPayload {
  channels: unknown[];
}

/** Request payload for channel:create. */
export interface ChannelCreatePayload {
  name: string;
  outputFormat?: "mono" | "stereo";
}

/** Request payload for channel:update. */
export interface ChannelUpdatePayload {
  channelId: string;
  name?: string;
  outputFormat?: "mono" | "stereo";
  autoStart?: boolean;
}

/** Request payload for channel:source:add. */
export interface ChannelSourceAddPayload {
  channelId: string;
  sourceId: string;
  selectedChannels: number[];
  gain?: number;
  muted?: boolean;
  delayMs?: number;
}

/** Request payload for channel:source:remove. */
export interface ChannelSourceRemovePayload {
  channelId: string;
  sourceIndex: number;
}

/** Request payload for channel:source:update. */
export interface ChannelSourceUpdatePayload {
  channelId: string;
  sourceIndex: number;
  gain?: number;
  muted?: boolean;
  delayMs?: number;
  selectedChannels?: number[];
}

/** Request payload for channel:start, channel:stop, channel:remove, channel:events. */
export interface ChannelActionPayload {
  channelId: string;
}

/** Broadcast payload for levels:update. */
export interface LevelsPayload {
  levels: Record<string, unknown>;
}

/** Response payload for stats:get. */
export interface StatsPayload {
  stats: Record<string, unknown>;
}

/** Response payload for channel:events. */
export interface ChannelEventsPayload {
  channelId: string;
  events: unknown[];
}

// ---------------------------------------------------------------------------
// Processing config WebSocket payload types
// ---------------------------------------------------------------------------

/** Request payload for channel:processing:update. */
export interface ProcessingUpdatePayload {
  channelId: string;
  mode?: "speech" | "music";
  agc?: {
    enabled?: boolean;
    targetLufs?: number;
  };
  opus?: {
    enabled?: boolean;
    bitrateKbps?: number;
    frameSize?: "10" | "20" | "40";
    fec?: boolean;
    bitrateMode?: "vbr" | "cbr";
  };
}

/** Request payload for channel:processing:reset. */
export interface ProcessingResetPayload {
  channelId: string;
}

/** Request payload for channel:processing:get. */
export interface ProcessingGetPayload {
  channelId: string;
}

// ---------------------------------------------------------------------------
// Streaming WebSocket payload types
// ---------------------------------------------------------------------------

/** Response payload for streaming:status. */
export interface StreamingStatusPayload {
  totalListeners: number;
  channels: Array<{
    channelId: string;
    name: string;
    isActive: boolean;
    listenerCount: number;
    latencyEstimate: {
      gstreamerBufferMs: number;
      opusEncodeMs: number;
      mediasoupForwardMs: number;
      webrtcJitterBufferMs: number;
      networkMs: number;
      totalMs: number;
    };
    latencyMode: "live" | "stable";
    lossRecovery: "nack" | "plc";
  }>;
  workers: Array<{
    index: number;
    peakMemoryKb: number;
    routerCount: number;
    alive: boolean;
  }>;
}

/** Response payload for streaming:workers. */
export interface StreamingWorkersPayload {
  workers: Array<{
    index: number;
    peakMemoryKb: number;
    routerCount: number;
    alive: boolean;
  }>;
}

/** Request payload for streaming:listeners. */
export interface StreamingListenersPayload {
  /** Admin display mode: "all" shows all, "flagged" shows degraded only, "off" disables. */
  displayMode?: "all" | "flagged" | "off";
  /** Optional channel ID filter. */
  channelId?: string;
}

/** Request payload for streaming:restart-workers. */
export interface StreamingRestartWorkersPayload {
  /** Confirmation flag (UI should prompt before sending). */
  confirmed: boolean;
}

/** Request payload for streaming:channel-latency. */
export interface StreamingChannelLatencyPayload {
  channelId: string;
}

/** Broadcast payload for streaming:listener-count. */
export interface StreamingListenerCountPayload {
  channelId: string | null;
  count: number;
  totalListeners: number;
}

/** Broadcast payload for streaming:latency-warning. */
export interface StreamingLatencyWarningPayload {
  warnings: Array<{
    channelId: string;
    name: string;
    estimate: {
      gstreamerBufferMs: number;
      opusEncodeMs: number;
      mediasoupForwardMs: number;
      webrtcJitterBufferMs: number;
      networkMs: number;
      totalMs: number;
    };
  }>;
  timestamp: string;
}

/** Broadcast payload for streaming:worker-alert. */
export interface StreamingWorkerAlertPayload {
  alertType: "worker-died" | "worker-memory-warning";
  workerIndex: number;
  timestamp: string;
  /** Present for worker-died alerts. */
  error?: string;
  /** Present for memory-warning alerts. */
  memoryMb?: number;
  /** Present for memory-warning alerts. */
  thresholdMb?: number;
}
