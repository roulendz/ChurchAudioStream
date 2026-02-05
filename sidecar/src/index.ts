import path from "node:path";
import { logger, stderrLog } from "./utils/logger";

function resolveConfigPath(): string {
  const configPathArgIndex = process.argv.indexOf("--config-path");
  if (configPathArgIndex !== -1 && process.argv[configPathArgIndex + 1]) {
    return path.resolve(process.argv[configPathArgIndex + 1]);
  }
  // Default: directory containing the executable (works for both pkg and dev)
  const executableDirectory = path.dirname(process.execPath);
  return path.resolve(executableDirectory, "config.json");
}

function setupOrphanPrevention(): void {
  // Detect when parent process closes stdin (Tauri exited or crashed).
  // This prevents orphaned sidecar processes on Windows.
  process.stdin.resume();
  process.stdin.on("end", () => {
    logger.info("Parent process closed stdin, shutting down");
    process.exit(0);
  });
  process.stdin.on("error", () => {
    // stdin error likely means parent died
    logger.warn("Stdin error detected, parent may have exited");
  });
}

function setupGracefulShutdown(): void {
  const shutdownSignals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

  for (const signal of shutdownSignals) {
    process.on(signal, () => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      // Future: close server, WebSocket connections, etc.
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

function main(): void {
  const configFilePath = resolveConfigPath();

  logger.info("ChurchAudioStream sidecar starting", {
    version: "0.1.0",
    nodeVersion: process.version,
    pid: process.pid,
    configPath: configFilePath,
  });

  setupOrphanPrevention();
  setupGracefulShutdown();

  logger.info("Sidecar initialized, waiting for connections", {
    configPath: configFilePath,
  });

  // Server creation happens in Plan 02 (Express + WebSocket setup)
  // For now, the process stays alive via stdin.resume() above
}

main();
