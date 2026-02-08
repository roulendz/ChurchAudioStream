import path from "node:path";
import { EventEmitter } from "node:events";
import { logger, stderrLog } from "./utils/logger";
import { toErrorMessage } from "./utils/error-message";
import { ConfigStore } from "./config/store";
import { AudioSubsystem } from "./audio/audio-subsystem";
import { StreamingSubsystem } from "./streaming/streaming-subsystem";
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
  audioSubsystem: AudioSubsystem,
  streamingSubsystem: StreamingSubsystem,
): void {
  const shutdownSignals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

  for (const signal of shutdownSignals) {
    process.on(signal, async () => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      // Shutdown order: streaming first (notify listeners, drain, close mediasoup)
      // then audio (close GStreamer pipelines), then servers
      await streamingSubsystem.stop();
      await audioSubsystem.stop();
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
  audioSubsystem: AudioSubsystem,
  streamingSubsystem: StreamingSubsystem,
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
      // Stop streaming before stopping server (listener WS is on httpsServer)
      await streamingSubsystem.stop();

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
        audioSubsystem,
      );
      const newStopServer = await startServer(components, newConfig);
      setStopServer(newStopServer);

      // Restart streaming on the new HTTPS server
      await streamingSubsystem.start(components.httpsServer);

      logger.info(
        `Server restarted — phones: https://${newConfig.server.host}:${newConfig.server.port} | admin: http://127.0.0.1:${ADMIN_LOOPBACK_PORT}`,
      );
    } catch (err) {
      const errorMessage = toErrorMessage(err);
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
          audioSubsystem,
        );
        const fallbackStopServer = await startServer(components, fallbackConfig);
        setStopServer(fallbackStopServer);

        // Restart streaming on fallback server
        await streamingSubsystem.start(components.httpsServer);
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
    `Config loaded from ${configStore.getPath()} — port=${config.server.port}, host=${config.server.host}, domain=${config.network.domain}, mdns=${config.network.mdns.enabled ? "on" : "off"}, hostsFile=${config.network.hostsFile.enabled ? "on" : "off"}`,
  );

  logFirewallReminder(config.server.port);

  // Create audio subsystem (wires all audio components together)
  const audioSubsystem = new AudioSubsystem(configStore, basePath);

  // Create streaming subsystem (wires mediasoup components, syncs with audio)
  const streamingSubsystem = new StreamingSubsystem(configStore, audioSubsystem);

  const serverEvents = new EventEmitter();

  const components = await createServer(
    config,
    basePath,
    configStore,
    serverEvents,
    audioSubsystem,
  );

  let currentStopServer: StopServerFunction | null = await startServer(
    components,
    config,
  );

  setupGracefulShutdown(() => currentStopServer, audioSubsystem, streamingSubsystem);

  setupRestartListener(
    serverEvents,
    configStore,
    basePath,
    (stopFn) => {
      currentStopServer = stopFn;
    },
    () => currentStopServer,
    audioSubsystem,
    streamingSubsystem,
  );

  // Start streaming subsystem (creates workers, attaches to httpsServer for listener WS)
  await streamingSubsystem.start(components.httpsServer);

  // Start audio subsystem after server and streaming are ready
  // (discovery, monitoring, auto-start channels -- channels emit events that streaming subscribes to)
  await audioSubsystem.start();

  const channelCount = audioSubsystem.getChannels().length;
  logger.info(
    `Sidecar ready — phones: https://${config.server.host}:${config.server.port} | admin: http://127.0.0.1:${ADMIN_LOOPBACK_PORT} | audio: ${channelCount} channel(s)`,
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
