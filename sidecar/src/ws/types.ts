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
  | "interfaces:list";
