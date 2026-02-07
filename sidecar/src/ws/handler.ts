import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import type { ConfigStore } from "../config/store";
import { listNetworkInterfaces } from "../network/interfaces";
import type {
  WsMessage,
  IdentifyPayload,
  ClientMetadata,
  ServerStatusPayload,
  ConfigUpdateResponsePayload,
} from "./types";
import { logger } from "../utils/logger";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const IDENTIFY_TIMEOUT_MS = 10_000;
const RESTART_SIGNAL_DELAY_MS = 1_000;

const SIDECAR_VERSION = "0.1.0";

const RESTART_TRIGGERING_FIELDS = new Set([
  "server.port",
  "server.host",
  "server.interface",
  "network.domain",
  "network.hostsFile.enabled",
]);

type ExtendedWebSocket = WebSocket & { metadata: ClientMetadata };

export interface WebSocketSetupResult {
  wss: WebSocketServer;
  getClients: () => Map<string, ClientMetadata>;
}

export function setupWebSocket(
  server: HttpServer | HttpsServer,
  configStore: ConfigStore,
  serverEvents: EventEmitter,
): WebSocketSetupResult {
  const wss = new WebSocketServer({ server });
  const clientMap = new Map<string, ExtendedWebSocket>();

  startHeartbeat(wss, clientMap);

  wss.on("connection", (rawSocket) => {
    const clientId = crypto.randomUUID();
    const extSocket = rawSocket as ExtendedWebSocket;

    extSocket.metadata = {
      clientId,
      role: "unidentified",
      connectedAt: new Date(),
      isAlive: true,
    };

    clientMap.set(clientId, extSocket);

    sendMessage(extSocket, "welcome", {
      version: SIDECAR_VERSION,
      clientId,
    });

    const identifyTimeout = setTimeout(() => {
      if (extSocket.metadata.role === "unidentified") {
        logger.warn("Client did not identify within timeout, closing", {
          clientId,
        });
        extSocket.close(4001, "Identify timeout");
      }
    }, IDENTIFY_TIMEOUT_MS);

    extSocket.on("pong", () => {
      extSocket.metadata.isAlive = true;
    });

    extSocket.on("message", (rawData) => {
      handleIncomingMessage(
        extSocket,
        rawData,
        configStore,
        serverEvents,
        clientMap,
        identifyTimeout,
      );
    });

    extSocket.on("close", () => {
      clearTimeout(identifyTimeout);
      clientMap.delete(clientId);
      logger.info("Client disconnected", {
        clientId,
        role: extSocket.metadata.role,
      });
    });

    extSocket.on("error", (error) => {
      logger.error("WebSocket client error", {
        clientId,
        error: error.message,
      });
    });

    logger.info("Client connected", { clientId });
  });

  const getClients = (): Map<string, ClientMetadata> => {
    const snapshot = new Map<string, ClientMetadata>();
    for (const [id, ws] of clientMap) {
      snapshot.set(id, { ...ws.metadata });
    }
    return snapshot;
  };

  return { wss, getClients };
}

function startHeartbeat(
  wss: WebSocketServer,
  clientMap: Map<string, ExtendedWebSocket>,
): void {
  const heartbeatInterval = setInterval(() => {
    for (const [clientId, extSocket] of clientMap) {
      if (!extSocket.metadata.isAlive) {
        logger.warn("Client heartbeat timeout, terminating", { clientId });
        extSocket.terminate();
        continue;
      }
      extSocket.metadata.isAlive = false;
      extSocket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => clearInterval(heartbeatInterval));
}

function handleIncomingMessage(
  socket: ExtendedWebSocket,
  rawData: WebSocket.RawData,

  configStore: ConfigStore,
  serverEvents: EventEmitter,
  clientMap: Map<string, ExtendedWebSocket>,
  identifyTimeout: NodeJS.Timeout,
): void {
  let message: WsMessage;
  try {
    message = JSON.parse(rawData.toString());
  } catch {
    sendMessage(socket, "error", {
      message: "Invalid JSON",
    });
    return;
  }

  if (!message.type || typeof message.type !== "string") {
    sendMessage(
      socket,
      "error",
      { message: "Missing or invalid message type" },
      message.requestId,
    );
    return;
  }

  switch (message.type) {
    case "identify":
      handleIdentify(socket, message, identifyTimeout);
      break;
    case "ping":
      sendMessage(socket, "pong", undefined, message.requestId);
      break;
    case "config:get":
      handleConfigGet(socket, message, configStore);
      break;
    case "config:update":
      handleConfigUpdate(socket, message, configStore, serverEvents, clientMap);
      break;
    case "server:status":
      handleServerStatus(socket, message, configStore, clientMap);
      break;
    case "interfaces:list":
      handleInterfacesList(socket, message);
      break;
    default:
      sendMessage(
        socket,
        "error",
        {
          message: `Unknown message type: ${message.type}`,
          originalType: message.type,
        },
        message.requestId,
      );
  }
}

function handleIdentify(
  socket: ExtendedWebSocket,
  message: WsMessage,
  identifyTimeout: NodeJS.Timeout,
): void {
  const payload = message.payload as IdentifyPayload | undefined;
  if (!payload?.role || !["admin", "listener"].includes(payload.role)) {
    sendMessage(
      socket,
      "error",
      { message: "Invalid identify payload: role must be 'admin' or 'listener'" },
      message.requestId,
    );
    return;
  }

  clearTimeout(identifyTimeout);
  socket.metadata.role = payload.role;

  logger.info("Client identified", {
    clientId: socket.metadata.clientId,
    role: payload.role,
  });

  sendMessage(
    socket,
    "identify:ack",
    { clientId: socket.metadata.clientId, role: payload.role },
    message.requestId,
  );
}

function handleConfigGet(
  socket: ExtendedWebSocket,
  message: WsMessage,
  configStore: ConfigStore,
): void {
  if (socket.metadata.role !== "admin") {
    sendMessage(
      socket,
      "error",
      { message: "Unauthorized: admin role required" },
      message.requestId,
    );
    return;
  }

  sendMessage(
    socket,
    "config:response",
    configStore.get(),
    message.requestId,
  );
}

function handleConfigUpdate(
  socket: ExtendedWebSocket,
  message: WsMessage,
  configStore: ConfigStore,
  serverEvents: EventEmitter,
  clientMap: Map<string, ExtendedWebSocket>,
): void {
  if (socket.metadata.role !== "admin") {
    sendMessage(
      socket,
      "error",
      { message: "Unauthorized: admin role required" },
      message.requestId,
    );
    return;
  }

  if (!message.payload || typeof message.payload !== "object") {
    sendMessage(
      socket,
      "error",
      { message: "Invalid config update payload" },
      message.requestId,
    );
    return;
  }

  const previousConfig = configStore.get();
  const updateResult = configStore.update(
    message.payload as Record<string, unknown>,
  );

  const requiresRestart = updateResult.success
    ? detectRestartRequired(previousConfig, updateResult.config)
    : false;

  const responsePayload: ConfigUpdateResponsePayload = {
    success: updateResult.success,
    config: updateResult.config,
    errors: updateResult.errors,
    requiresRestart,
  };

  sendMessage(socket, "config:response", responsePayload, message.requestId);

  if (updateResult.success) {
    broadcastToAdminClients(clientMap, "config:updated", updateResult.config);

    if (requiresRestart) {
      logger.info(
        "Config change requires server restart, signaling after delay",
      );
      setTimeout(() => {
        serverEvents.emit("restart-needed");
      }, RESTART_SIGNAL_DELAY_MS);
    }
  }
}

function handleServerStatus(
  socket: ExtendedWebSocket,
  message: WsMessage,
  configStore: ConfigStore,
  clientMap: Map<string, ExtendedWebSocket>,
): void {
  const config = configStore.get();
  const connectionCounts = countConnectionsByRole(clientMap);

  const statusPayload: ServerStatusPayload = {
    uptime: process.uptime(),
    connections: connectionCounts,
    config: {
      port: config.server.port,
      host: config.server.host,
      domain: config.network.domain,
    },
  };

  sendMessage(socket, "server:status", statusPayload, message.requestId);
}

function detectRestartRequired(
  previousConfig: Record<string, unknown>,
  newConfig: Record<string, unknown>,
): boolean {
  for (const fieldPath of RESTART_TRIGGERING_FIELDS) {
    const previousValue = getNestedValue(previousConfig, fieldPath);
    const newValue = getNestedValue(newConfig, fieldPath);
    if (previousValue !== newValue) {
      return true;
    }
  }
  return false;
}

function getNestedValue(
  obj: Record<string, unknown>,
  dotPath: string,
): unknown {
  let current: unknown = obj;
  for (const segment of dotPath.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function countConnectionsByRole(
  clientMap: Map<string, ExtendedWebSocket>,
): ServerStatusPayload["connections"] {
  let adminCount = 0;
  let listenerCount = 0;
  let unidentifiedCount = 0;

  for (const [, ws] of clientMap) {
    switch (ws.metadata.role) {
      case "admin":
        adminCount++;
        break;
      case "listener":
        listenerCount++;
        break;
      default:
        unidentifiedCount++;
    }
  }

  return {
    total: clientMap.size,
    admin: adminCount,
    listener: listenerCount,
    unidentified: unidentifiedCount,
  };
}

function broadcastToAdminClients(
  clientMap: Map<string, ExtendedWebSocket>,
  type: string,
  payload: unknown,
): void {
  for (const [, ws] of clientMap) {
    if (ws.metadata.role === "admin" && ws.readyState === WebSocket.OPEN) {
      sendMessage(ws, type, payload);
    }
  }
}

function handleInterfacesList(
  socket: ExtendedWebSocket,
  message: WsMessage,
): void {
  const interfaces = listNetworkInterfaces();
  sendMessage(
    socket,
    "interfaces:list",
    { interfaces },
    message.requestId,
  );
}

function sendMessage(
  socket: WebSocket,
  type: string,
  payload?: unknown,
  requestId?: string,
): void {
  if (socket.readyState !== WebSocket.OPEN) return;

  const message: WsMessage = { type };
  if (payload !== undefined) message.payload = payload;
  if (requestId !== undefined) message.requestId = requestId;

  socket.send(JSON.stringify(message));
}
