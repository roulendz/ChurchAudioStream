import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { EventEmitter } from "node:events";
import express from "express";
import { WebSocket } from "ws";
import type { AppConfig } from "./config/schema";
import type { ConfigStore } from "./config/store";
import { loadOrGenerateCert } from "./network/certificate";
import { publishService, unpublishService } from "./network/mdns";
import { setupWebSocket, type WebSocketSetupResult } from "./ws/handler";
import { logger } from "./utils/logger";

const SIDECAR_VERSION = "0.1.0";

interface ServerComponents {
  server: https.Server;
  app: express.Application;
  wss: WebSocketSetupResult["wss"];
  getClients: WebSocketSetupResult["getClients"];
  key: string;
  cert: string;
}

type StopServerFunction = () => Promise<void>;

export async function createServer(
  config: AppConfig,
  basePath: string,
  configStore: ConfigStore,
  serverEvents: EventEmitter,
): Promise<ServerComponents> {
  const { key, cert } = await loadOrGenerateCert(basePath, config);

  const app = express();
  app.use(express.json());

  const staticDirectory = resolveStaticDirectory(basePath);
  app.use(express.static(staticDirectory));

  app.get("/api/status", (_req, res) => {
    res.json({
      status: "running",
      version: SIDECAR_VERSION,
      uptime: process.uptime(),
    });
  });

  const httpsServer = https.createServer({ key, cert }, app);
  const { wss, getClients } = setupWebSocket(
    httpsServer,
    configStore,
    serverEvents,
  );

  return { server: httpsServer, app, wss, getClients, key, cert };
}

export async function startServer(
  components: ServerComponents,
  config: AppConfig,
): Promise<StopServerFunction> {
  const { server, wss } = components;

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(config.server.port, config.server.host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const boundAddress = server.address();
  const addressInfo =
    typeof boundAddress === "string"
      ? boundAddress
      : `${boundAddress?.address}:${boundAddress?.port}`;

  logger.info("Server listening", {
    address: addressInfo,
    url: `https://${config.server.host}:${config.server.port}`,
  });

  if (config.network.mdns.enabled) {
    publishService(config.server.port, config.network.mdns.domain);
  }

  const stopServer: StopServerFunction = async () => {
    logger.info("Stopping server");

    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1012, "Service Restart");
      }
    }

    if (config.network.mdns.enabled) {
      unpublishService();
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    logger.info("Server stopped");
  };

  return stopServer;
}

function resolveStaticDirectory(basePath: string): string {
  // Strategy: try multiple paths to find public/ directory
  // 1. Relative to basePath (production: binary directory)
  // 2. Relative to source file (dev: sidecar/src/../public)
  // 3. Current working directory fallback
  const candidates = [
    path.join(basePath, "public"),
    path.join(basePath, "sidecar", "public"),
  ];

  // In CJS (pkg build), __dirname points to the compiled JS location
  // In ESM (tsx dev), __dirname is shimmed by tsx
  try {
    candidates.unshift(path.join(__dirname, "..", "public"));
  } catch {
    // __dirname not available in strict ESM -- skip
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Last resort: basePath/public (even if not found, express.static handles gracefully)
  return path.join(basePath, "public");
}
