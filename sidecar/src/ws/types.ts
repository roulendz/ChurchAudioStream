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
  // Audio: level metering
  | "levels:update"
  // Audio: resource stats
  | "stats:update"
  // Audio: channel events
  | "channel:events";

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
