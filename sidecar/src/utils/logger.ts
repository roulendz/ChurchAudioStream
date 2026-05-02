import { FileLogWriter } from "./file-log-writer";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  ts: string;
  msg: string;
  data?: Record<string, unknown>;
}

let fileWriter: FileLogWriter | null = null;

/**
 * Enable persistent file logging. Subsequent `logger.*` calls write each
 * line to `<directory>/<sessionFilename>.log` in addition to stdout.
 *
 * Call once at sidecar startup before the first log entry. Throws if the
 * directory cannot be created (fail-fast on boot misconfiguration).
 */
export function setLogDirectory(directory: string): void {
  fileWriter = new FileLogWriter(directory);
}

/** Returns the active log file path, or null if file logging is not enabled. */
export function getLogFilePath(): string | null {
  return fileWriter?.getPath() ?? null;
}

function formatLogEntry(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
): string {
  const entry: LogEntry = {
    level,
    ts: new Date().toISOString(),
    msg: message,
  };
  if (data !== undefined) {
    entry.data = data;
  }
  return JSON.stringify(entry);
}

function emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  const line = formatLogEntry(level, message, data);
  console.log(line);
  fileWriter?.append(line);
}

/**
 * Structured JSON logger. Writes to stdout (Tauri captures + emits
 * `sidecar-log` events to the admin UI) and, if `setLogDirectory` has
 * been called, also appends to the persistent session log file.
 */
export const logger = {
  debug(message: string, data?: Record<string, unknown>): void {
    emit("debug", message, data);
  },

  info(message: string, data?: Record<string, unknown>): void {
    emit("info", message, data);
  },

  warn(message: string, data?: Record<string, unknown>): void {
    emit("warn", message, data);
  },

  error(message: string, data?: Record<string, unknown>): void {
    emit("error", message, data);
  },
};

/**
 * Critical error logger that writes to stderr and the persistent file
 * (when enabled). Use only for truly fatal errors that should bypass
 * Tauri's stdout handler.
 */
export function stderrLog(message: string): void {
  const line = JSON.stringify({
    level: "fatal",
    ts: new Date().toISOString(),
    msg: message,
  });
  console.error(line);
  fileWriter?.append(line);
}
