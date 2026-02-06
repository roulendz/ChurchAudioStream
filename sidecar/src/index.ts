import path from "node:path";
import { EventEmitter } from "node:events";
import { logger, stderrLog } from "./utils/logger";
import { ConfigStore } from "./config/store";
import { createServer, startServer, ADMIN_LOOPBACK_PORT, type StopServerFunction } from "./server";
import { logFirewallReminder } from "./network/firewall";
import { removeHostsEntry } from "./network/hosts";

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
  getStopServer: () => StopServerFunction | null,
): void {
  const shutdownSignals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

  for (const signal of shutdownSignals) {
    process.on(signal, async () => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      const stopServer = getStopServer();
      if (stopServer) {
        await stopServer();
      }
      try {
        removeHostsEntry();
      } catch {
        // Best-effort: don't block shutdown if hosts cleanup fails
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

const TCP_TIME_WAIT_MS = 500;

function setupRestartListener(
  serverEvents: EventEmitter,
  configStore: ConfigStore,
  basePath: string,
  setStopServer: (stopFn: StopServerFunction) => void,
  getStopServer: () => StopServerFunction | null,
): void {
  let isRestarting = false;

  serverEvents.on("restart-needed", async () => {
    if (isRestarting) {
      logger.warn("Restart already in progress, ignoring duplicate request");
      return;
    }
    isRestarting = true;

    const newConfig = configStore.get();
    logger.info("Server restart requested due to config change", {
      newPort: newConfig.server.port,
      newHost: newConfig.server.host,
      newListenHost: newConfig.server.listenHost,
    });

    try {
      const stopServer = getStopServer();
      if (stopServer) {
        await stopServer(newConfig.server.host, newConfig.server.port);
      }

      await new Promise((resolve) => setTimeout(resolve, TCP_TIME_WAIT_MS));

      logFirewallReminder(newConfig.server.port);

      const components = await createServer(
        newConfig,
        basePath,
        configStore,
        serverEvents,
      );
      const newStopServer = await startServer(components, newConfig);
      setStopServer(newStopServer);

      logger.info(
        `Server restarted — phones: https://${newConfig.server.host}:${newConfig.server.port} | admin: http://127.0.0.1:${ADMIN_LOOPBACK_PORT}`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("Failed to restart server on new config", {
        error: errorMessage,
      });

      // Fallback: attempt to restart on old config by re-reading from store
      // (configStore already saved the new config, so this is a best-effort recovery)
      logger.info("Attempting fallback restart...");
      try {
        const fallbackConfig = configStore.get();
        const components = await createServer(
          fallbackConfig,
          basePath,
          configStore,
          serverEvents,
        );
        const fallbackStopServer = await startServer(components, fallbackConfig);
        setStopServer(fallbackStopServer);
        logger.info("Fallback restart succeeded");
      } catch (fallbackErr) {
        const fallbackMessage =
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        logger.error("Fallback restart also failed, server is down", {
          error: fallbackMessage,
        });
      }
    } finally {
      isRestarting = false;
    }
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

  logger.info(
    `Config loaded from ${configStore.getPath()} — port=${config.server.port}, host=${config.server.host}, mdns=${config.network.mdns.enabled ? config.network.mdns.domain : "off"}`,
  );

  logFirewallReminder(config.server.port);

  const serverEvents = new EventEmitter();

  const components = await createServer(
    config,
    basePath,
    configStore,
    serverEvents,
  );

  let currentStopServer: StopServerFunction | null = await startServer(
    components,
    config,
  );

  setupGracefulShutdown(() => currentStopServer);

  setupRestartListener(
    serverEvents,
    configStore,
    basePath,
    (stopFn) => {
      currentStopServer = stopFn;
    },
    () => currentStopServer,
  );

  logger.info(
    `Sidecar ready — phones: https://${config.server.host}:${config.server.port} | admin: http://127.0.0.1:${ADMIN_LOOPBACK_PORT}`,
  );
}

main().catch((error) => {
  stderrLog(`Fatal startup error: ${error.message}`);
  logger.error("Failed to start sidecar", {
    error: error.message,
    stack: error.stack ?? "no stack",
  });
  process.exit(1);
});
