import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { EventEmitter } from "node:events";
import express from "express";
import { WebSocket } from "ws";
import type { AppConfig } from "./config/schema";
import type { ConfigStore } from "./config/store";
import type { AudioSubsystem } from "./audio/audio-subsystem";
import { loadOrGenerateCert } from "./network/certificate";
import { ensureHostsEntry } from "./network/hosts";
import { publishService, unpublishService } from "./network/mdns";
import { setupWebSocket, type WebSocketSetupResult } from "./ws/handler";
import { logger } from "./utils/logger";

const SIDECAR_VERSION = "0.1.0";

/**
 * Fixed loopback port for the Tauri admin UI WebSocket connection.
 *
 * This port is intentionally NOT derived from config.server.port so that
 * changing the external HTTPS port in settings never breaks the admin
 * GUI's ability to reconnect. The admin GUI hardcodes this same value.
 */
export const ADMIN_LOOPBACK_PORT = 7778;

interface ServerComponents {
  httpsServer: https.Server;
  httpServer: http.Server;
  app: express.Application;
  httpsWsSetup: WebSocketSetupResult;
  httpWsSetup: WebSocketSetupResult;
  key: string;
  cert: string;
}

export type StopServerFunction = (
  newHost?: string,
  newPort?: number,
) => Promise<void>;

export async function createServer(
  config: AppConfig,
  basePath: string,
  configStore: ConfigStore,
  serverEvents: EventEmitter,
  audioSubsystem?: AudioSubsystem,
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
  const httpsWsSetup = setupWebSocket(httpsServer, configStore, serverEvents, audioSubsystem);

  const httpServer = http.createServer(app);
  const httpWsSetup = setupWebSocket(httpServer, configStore, serverEvents, audioSubsystem);

  return { httpsServer, httpServer, app, httpsWsSetup, httpWsSetup, key, cert };
}

export async function startServer(
  components: ServerComponents,
  config: AppConfig,
): Promise<StopServerFunction> {
  const { httpsServer, httpServer, httpsWsSetup, httpWsSetup } = components;

  // Start HTTPS server on all interfaces (for phone browsers)
  await new Promise<void>((resolve, reject) => {
    httpsServer.on("error", reject);
    httpsServer.listen(config.server.port, config.server.listenHost, () => {
      httpsServer.removeListener("error", reject);
      resolve();
    });
  });

  logger.info(
    `HTTPS server listening on https://${config.server.host}:${config.server.port} (bound to ${config.server.listenHost})`,
  );

  // Start HTTP server on loopback only (for Tauri admin UI)
  await new Promise<void>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(ADMIN_LOOPBACK_PORT, "127.0.0.1", () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  logger.info(
    `Admin loopback listening on http://127.0.0.1:${ADMIN_LOOPBACK_PORT}`,
  );

  if (config.network.mdns.enabled) {
    publishService(config.server.port, config.network.domain);
  }

  if (config.network.hostsFile.enabled) {
    try {
      ensureHostsEntry(config.server.host, config.network.domain);
    } catch (hostsError) {
      const errorMessage = hostsError instanceof Error ? hostsError.message : String(hostsError);
      logger.warn(
        `Failed to update hosts file for ${config.network.domain} → ${config.server.host}: ${errorMessage}`,
      );
    }
  }

  const broadcastAndCloseAll = (
    newHost?: string,
    newPort?: number,
  ): void => {
    const restartPayload = {
      type: "server:restarting" as const,
      payload: { host: newHost, port: newPort },
    };
    const restartMessage = JSON.stringify(restartPayload);

    const allWssInstances = [httpsWsSetup.wss, httpWsSetup.wss];
    for (const wss of allWssInstances) {
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(restartMessage);
          client.close(1012, "Service Restart");
        }
      }
    }
  };

  const stopServer: StopServerFunction = async (
    newHost?: string,
    newPort?: number,
  ) => {
    logger.info("Stopping servers (HTTPS + HTTP loopback)");

    broadcastAndCloseAll(newHost, newPort);

    if (config.network.mdns.enabled) {
      unpublishService();
    }

    await Promise.all([
      new Promise<void>((resolve) => httpsServer.close(() => resolve())),
      new Promise<void>((resolve) => httpServer.close(() => resolve())),
    ]);

    logger.info("Both servers stopped");
  };

  return stopServer;
}

function resolveStaticDirectory(basePath: string): string {
  const cwd = process.cwd();
  const execDir = path.dirname(process.execPath);
  const candidates = [
    path.join(basePath, "public"),
    path.join(basePath, "sidecar", "public"),
    path.join(cwd, "public"),
    path.join(cwd, "sidecar", "public"),
    path.join(execDir, "public"),
    path.join(execDir, "..", "..", "..", "sidecar", "public"),
  ];

  try {
    candidates.unshift(path.join(__dirname, "..", "public"));
  } catch {
    // __dirname not available in strict ESM
  }

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved) && fs.existsSync(path.join(resolved, "index.html"))) {
      logger.info(`Static directory resolved: ${resolved}`);
      return resolved;
    }
  }

  const fallback = path.join(basePath, "public");
  logger.warn(`No static directory with index.html found, using fallback: ${fallback}`);
  return fallback;
}
