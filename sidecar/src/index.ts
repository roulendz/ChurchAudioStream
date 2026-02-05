import path from "node:path";
import { EventEmitter } from "node:events";
import { logger, stderrLog } from "./utils/logger";
import { ConfigStore } from "./config/store";
import { createServer, startServer } from "./server";

function resolveBasePath(): string {
  const configPathArgIndex = process.argv.indexOf("--config-path");
  if (configPathArgIndex !== -1 && process.argv[configPathArgIndex + 1]) {
    return path.resolve(process.argv[configPathArgIndex + 1]);
  }
  return path.dirname(process.execPath);
}

function setupOrphanPrevention(): void {
  process.stdin.resume();
  process.stdin.on("end", () => {
    logger.info("Parent process closed stdin, shutting down");
    process.exit(0);
  });
  process.stdin.on("error", () => {
    logger.warn("Stdin error detected, parent may have exited");
  });
}

function setupGracefulShutdown(
  stopServer: (() => Promise<void>) | null,
): void {
  const shutdownSignals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

  for (const signal of shutdownSignals) {
    process.on(signal, async () => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      if (stopServer) {
        await stopServer();
      }
      process.exit(0);
    });
  }

  process.on("uncaughtException", (error) => {
    stderrLog(`Uncaught exception: ${error.message}`);
    logger.error("Uncaught exception, shutting down", {
      error: error.message,
      stack: error.stack ?? "no stack",
    });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    const message =
      reason instanceof Error ? reason.message : String(reason);
    logger.error("Unhandled promise rejection", { reason: message });
  });
}

async function main(): Promise<void> {
  const basePath = resolveBasePath();

  logger.info("ChurchAudioStream sidecar starting", {
    version: "0.1.0",
    nodeVersion: process.version,
    pid: process.pid,
    basePath,
  });

  setupOrphanPrevention();

  const configStore = new ConfigStore(basePath);
  const config = configStore.get();

  logger.info("Config loaded", {
    configPath: configStore.getPath(),
    port: config.server.port,
    host: config.server.host,
    mdnsEnabled: config.network.mdns.enabled,
    mdnsDomain: config.network.mdns.domain,
  });

  const serverEvents = new EventEmitter();

  const components = await createServer(
    config,
    basePath,
    configStore,
    serverEvents,
  );

  const stopServer = await startServer(components, config);

  setupGracefulShutdown(stopServer);

  logger.info("Sidecar fully initialized", {
    url: `https://${config.server.host}:${config.server.port}`,
  });
}

main().catch((error) => {
  stderrLog(`Fatal startup error: ${error.message}`);
  logger.error("Failed to start sidecar", {
    error: error.message,
    stack: error.stack ?? "no stack",
  });
  process.exit(1);
});
