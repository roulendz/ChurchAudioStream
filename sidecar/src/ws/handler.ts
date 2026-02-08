import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import type { ConfigStore } from "../config/store";
import type { AudioSubsystem } from "../audio/audio-subsystem";
import type { ProcessingConfigUpdate } from "../audio/processing/processing-types";
import { listNetworkInterfaces } from "../network/interfaces";
import type {
  WsMessage,
  IdentifyPayload,
  ClientMetadata,
  ServerStatusPayload,
  ConfigUpdateResponsePayload,
  ChannelCreatePayload,
  ChannelUpdatePayload,
  ChannelSourceAddPayload,
  ChannelSourceRemovePayload,
  ChannelSourceUpdatePayload,
  ChannelActionPayload,
  ProcessingUpdatePayload,
  ProcessingResetPayload,
  ProcessingGetPayload,
} from "./types";
import { logger } from "../utils/logger";
import { toErrorMessage } from "../utils/error-message";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const IDENTIFY_TIMEOUT_MS = 10_000;
const RESTART_SIGNAL_DELAY_MS = 1_000;

/** Interval (ms) for flushing buffered level data to admin clients. */
const LEVEL_BROADCAST_INTERVAL_MS = 100;

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

/** WebSocket path reserved for protoo listener connections (do not route to admin WS). */
export const LISTENER_WS_PATH = "/ws/listener";

export function setupWebSocket(
  server: HttpServer | HttpsServer,
  configStore: ConfigStore,
  serverEvents: EventEmitter,
  audioSubsystem?: AudioSubsystem,
): WebSocketSetupResult {
  const wss = new WebSocketServer({ noServer: true });
  const clientMap = new Map<string, ExtendedWebSocket>();

  // Route HTTP upgrade requests to this admin WebSocket server.
  // Requests to /ws/listener are skipped (handled by protoo via WebSocket-Node).
  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url ?? "";
    if (pathname.startsWith(LISTENER_WS_PATH)) {
      // Reserved for protoo listener WebSocket -- do not handle here
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  startHeartbeat(wss, clientMap);

  if (audioSubsystem) {
    wireAudioBroadcasts(audioSubsystem, clientMap, wss);
  }

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
        audioSubsystem,
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
  audioSubsystem?: AudioSubsystem,
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

  // Route audio message types to the dedicated handler
  if (isAudioMessageType(message.type)) {
    handleAudioMessage(socket, message, audioSubsystem);
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

// ---------------------------------------------------------------------------
// Audio message handling (SRP: separate from core WebSocket message router)
// ---------------------------------------------------------------------------

/** Audio-related message type prefixes that route to the audio handler. */
const AUDIO_MESSAGE_PREFIXES = [
  "sources:",
  "channel:",
  "channels:",
  "levels:",
  "stats:",
  "processing:",
] as const;

/** Check if a message type is an audio-related message. */
function isAudioMessageType(type: string): boolean {
  return AUDIO_MESSAGE_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/**
 * Handle all audio-related WebSocket messages.
 *
 * All audio operations require admin role. If audioSubsystem is not available
 * (e.g., during early startup), returns an error.
 */
function handleAudioMessage(
  socket: ExtendedWebSocket,
  message: WsMessage,
  audioSubsystem?: AudioSubsystem,
): void {
  if (socket.metadata.role !== "admin") {
    sendMessage(
      socket,
      "error",
      { message: "Unauthorized: admin role required", originalType: message.type },
      message.requestId,
    );
    return;
  }

  if (!audioSubsystem) {
    sendMessage(
      socket,
      "error",
      { message: "Audio subsystem not available", originalType: message.type },
      message.requestId,
    );
    return;
  }

  // Wrap all handlers in a promise to catch async errors uniformly
  handleAudioMessageAsync(socket, message, audioSubsystem).catch((err) => {
    const errorMessage = toErrorMessage(err);
    logger.error("Audio message handler error", {
      type: message.type,
      error: errorMessage,
    });
    sendMessage(
      socket,
      "error",
      { message: errorMessage, originalType: message.type },
      message.requestId,
    );
  });
}

/** Async handler for audio messages -- dispatches to specific operations. */
async function handleAudioMessageAsync(
  socket: ExtendedWebSocket,
  message: WsMessage,
  audioSubsystem: AudioSubsystem,
): Promise<void> {
  switch (message.type) {
    // -- Source discovery --
    case "sources:list": {
      const sources = audioSubsystem.getSources();
      sendMessage(socket, "sources:list", { sources }, message.requestId);
      break;
    }

    // -- Channel listing --
    case "channels:list": {
      const channels = audioSubsystem.getChannels();
      sendMessage(socket, "channels:list", { channels }, message.requestId);
      break;
    }

    // -- Channel CRUD --
    case "channel:create": {
      const payload = message.payload as ChannelCreatePayload | undefined;
      if (!payload?.name) {
        sendMessage(
          socket,
          "error",
          { message: "Missing required field: name", originalType: message.type },
          message.requestId,
        );
        return;
      }
      const created = audioSubsystem.createChannel(payload.name, payload.outputFormat);
      sendMessage(socket, "channel:created", created, message.requestId);
      break;
    }

    case "channel:update": {
      const payload = message.payload as ChannelUpdatePayload | undefined;
      if (!payload?.channelId) {
        sendMessage(
          socket,
          "error",
          { message: "Missing required field: channelId", originalType: message.type },
          message.requestId,
        );
        return;
      }
      const updated = audioSubsystem.updateChannel(payload.channelId, {
        name: payload.name,
        outputFormat: payload.outputFormat,
        autoStart: payload.autoStart,
      });
      sendMessage(socket, "channel:updated", updated, message.requestId);
      break;
    }

    case "channel:remove": {
      const payload = message.payload as ChannelActionPayload | undefined;
      if (!payload?.channelId) {
        sendMessage(
          socket,
          "error",
          { message: "Missing required field: channelId", originalType: message.type },
          message.requestId,
        );
        return;
      }
      await audioSubsystem.removeChannel(payload.channelId);
      sendMessage(socket, "channel:removed", { channelId: payload.channelId }, message.requestId);
      break;
    }

    // -- Source assignment --
    case "channel:source:add": {
      const payload = message.payload as ChannelSourceAddPayload | undefined;
      if (!payload?.channelId || !payload.sourceId || !payload.selectedChannels) {
        sendMessage(
          socket,
          "error",
          { message: "Missing required fields: channelId, sourceId, selectedChannels", originalType: message.type },
          message.requestId,
        );
        return;
      }
      const channelAfterAdd = await audioSubsystem.addSource(payload.channelId, {
        sourceId: payload.sourceId,
        selectedChannels: payload.selectedChannels,
        gain: payload.gain ?? 1.0,
        muted: payload.muted ?? false,
        delayMs: payload.delayMs ?? 0,
      });
      sendMessage(socket, "channel:updated", channelAfterAdd, message.requestId);
      break;
    }

    case "channel:source:remove": {
      const payload = message.payload as ChannelSourceRemovePayload | undefined;
      if (!payload?.channelId || payload.sourceIndex === undefined) {
        sendMessage(
          socket,
          "error",
          { message: "Missing required fields: channelId, sourceIndex", originalType: message.type },
          message.requestId,
        );
        return;
      }
      const channelAfterRemove = await audioSubsystem.removeSource(
        payload.channelId,
        payload.sourceIndex,
      );
      sendMessage(socket, "channel:updated", channelAfterRemove, message.requestId);
      break;
    }

    case "channel:source:update": {
      const payload = message.payload as ChannelSourceUpdatePayload | undefined;
      if (!payload?.channelId || payload.sourceIndex === undefined) {
        sendMessage(
          socket,
          "error",
          { message: "Missing required fields: channelId, sourceIndex", originalType: message.type },
          message.requestId,
        );
        return;
      }
      const channelAfterUpdate = await audioSubsystem.updateSource(
        payload.channelId,
        payload.sourceIndex,
        {
          gain: payload.gain,
          muted: payload.muted,
          delayMs: payload.delayMs,
          selectedChannels: payload.selectedChannels,
        },
      );
      sendMessage(socket, "channel:updated", channelAfterUpdate, message.requestId);
      break;
    }

    // -- Channel lifecycle --
    case "channel:start": {
      const payload = message.payload as ChannelActionPayload | undefined;
      if (!payload?.channelId) {
        sendMessage(
          socket,
          "error",
          { message: "Missing required field: channelId", originalType: message.type },
          message.requestId,
        );
        return;
      }
      await audioSubsystem.startChannel(payload.channelId);
      sendMessage(socket, "channel:state", { channelId: payload.channelId, action: "started" }, message.requestId);
      break;
    }

    case "channel:stop": {
      const payload = message.payload as ChannelActionPayload | undefined;
      if (!payload?.channelId) {
        sendMessage(
          socket,
          "error",
          { message: "Missing required field: channelId", originalType: message.type },
          message.requestId,
        );
        return;
      }
      await audioSubsystem.stopChannel(payload.channelId);
      sendMessage(socket, "channel:state", { channelId: payload.channelId, action: "stopped" }, message.requestId);
      break;
    }

    // -- Channel events --
    case "channel:events": {
      const payload = message.payload as ChannelActionPayload | undefined;
      if (!payload?.channelId) {
        sendMessage(
          socket,
          "error",
          { message: "Missing required field: channelId", originalType: message.type },
          message.requestId,
        );
        return;
      }
      const events = audioSubsystem.getChannelEvents(payload.channelId);
      sendMessage(socket, "channel:events", { channelId: payload.channelId, events }, message.requestId);
      break;
    }

    // -- Processing config --
    case "channel:processing:get": {
      const payload = message.payload as ProcessingGetPayload | undefined;
      if (!payload?.channelId) {
        sendMessage(
          socket,
          "error",
          { message: "Missing required field: channelId", originalType: message.type },
          message.requestId,
        );
        return;
      }
      const processingConfig = audioSubsystem.getProcessingConfig(payload.channelId);
      if (!processingConfig) {
        sendMessage(
          socket,
          "error",
          { message: `Channel not found: ${payload.channelId}`, originalType: message.type },
          message.requestId,
        );
        return;
      }
      sendMessage(
        socket,
        "channel:processing:updated",
        { channelId: payload.channelId, processing: processingConfig },
        message.requestId,
      );
      break;
    }

    case "channel:processing:update": {
      const payload = message.payload as ProcessingUpdatePayload | undefined;
      if (!payload?.channelId) {
        sendMessage(
          socket,
          "error",
          { message: "Missing required field: channelId", originalType: message.type },
          message.requestId,
        );
        return;
      }
      // Convert frameSize from string ("20") to number (20) if present
      let opusUpdate: ProcessingConfigUpdate["opus"];
      if (payload.opus) {
        const { frameSize: frameSizeStr, ...restOpus } = payload.opus;
        opusUpdate = {
          ...restOpus,
          ...(frameSizeStr !== undefined
            ? { frameSize: Number(frameSizeStr) as 10 | 20 | 40 }
            : {}),
        };
      }

      const updatedChannel = audioSubsystem.updateProcessingConfig(
        payload.channelId,
        {
          mode: payload.mode,
          agc: payload.agc,
          opus: opusUpdate,
        },
      );
      sendMessage(socket, "channel:updated", updatedChannel, message.requestId);
      break;
    }

    case "channel:processing:reset": {
      const payload = message.payload as ProcessingResetPayload | undefined;
      if (!payload?.channelId) {
        sendMessage(
          socket,
          "error",
          { message: "Missing required field: channelId", originalType: message.type },
          message.requestId,
        );
        return;
      }
      const resetChannel = audioSubsystem.resetProcessingDefaults(payload.channelId);
      sendMessage(socket, "channel:updated", resetChannel, message.requestId);
      break;
    }

    // -- Stats --
    case "stats:get": {
      const allStats = audioSubsystem.getAllStats();
      const statsObject: Record<string, unknown> = {};
      for (const [pipelineId, stats] of allStats) {
        statsObject[pipelineId] = stats;
      }
      sendMessage(socket, "stats:update", { stats: statsObject }, message.requestId);
      break;
    }

    default:
      sendMessage(
        socket,
        "error",
        { message: `Unknown audio message type: ${message.type}`, originalType: message.type },
        message.requestId,
      );
  }
}

// ---------------------------------------------------------------------------
// Audio event broadcasting to admin clients
// ---------------------------------------------------------------------------

/**
 * Wire AudioSubsystem events to broadcast to admin WebSocket clients.
 *
 * Level data is buffered and flushed at a fixed interval to avoid flooding
 * clients with per-pipeline, per-frame updates. Source and channel change
 * events are broadcast immediately (low frequency).
 */
function wireAudioBroadcasts(
  audioSubsystem: AudioSubsystem,
  clientMap: Map<string, ExtendedWebSocket>,
  wss: WebSocketServer,
): void {
  // -- Level data buffering and broadcast --
  let levelBuffer: Record<string, unknown> = {};
  let hasBufferedLevels = false;

  audioSubsystem.on("levels-updated", (levels: { pipelineId: string }) => {
    levelBuffer[levels.pipelineId] = levels;
    hasBufferedLevels = true;
  });

  const levelFlushInterval = setInterval(() => {
    if (!hasBufferedLevels) return;

    const payload = { levels: levelBuffer };
    broadcastToAdminClients(clientMap, "levels:update", payload);

    levelBuffer = {};
    hasBufferedLevels = false;
  }, LEVEL_BROADCAST_INTERVAL_MS);

  // Clean up level flush timer when WebSocket server closes
  wss.on("close", () => clearInterval(levelFlushInterval));

  // -- Source change broadcast --
  audioSubsystem.on("sources-changed", () => {
    broadcastToAdminClients(clientMap, "sources:changed", {});
  });

  // -- Channel change broadcasts --
  audioSubsystem.on("channel-created", (channel: unknown) => {
    broadcastToAdminClients(clientMap, "channel:created", channel);
  });

  audioSubsystem.on("channel-updated", (channel: unknown) => {
    broadcastToAdminClients(clientMap, "channel:updated", channel);
  });

  audioSubsystem.on("channel-removed", (channelId: string) => {
    broadcastToAdminClients(clientMap, "channel:removed", { channelId });
  });

  audioSubsystem.on("channel-state-changed", (channelId: string, status: string) => {
    broadcastToAdminClients(clientMap, "channel:state", { channelId, status });
  });

  // -- Resource stats broadcast --
  audioSubsystem.on("stats-updated", (pipelineId: string, stats: unknown) => {
    broadcastToAdminClients(clientMap, "stats:update", {
      stats: { [pipelineId]: stats },
    });
  });
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
