type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  ts: string;
  msg: string;
  data?: Record<string, unknown>;
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

/**
 * Structured JSON logger that writes to stdout for Tauri to capture.
 * All levels use console.log (stdout) so Tauri's stdout handler receives them.
 */
export const logger = {
  debug(message: string, data?: Record<string, unknown>): void {
    console.log(formatLogEntry("debug", message, data));
  },

  info(message: string, data?: Record<string, unknown>): void {
    console.log(formatLogEntry("info", message, data));
  },

  warn(message: string, data?: Record<string, unknown>): void {
    console.log(formatLogEntry("warn", message, data));
  },

  error(message: string, data?: Record<string, unknown>): void {
    console.log(formatLogEntry("error", message, data));
  },
};

/**
 * Critical error logger that writes to stderr.
 * Use only for truly fatal errors that should bypass Tauri's stdout handler.
 */
export function stderrLog(message: string): void {
  console.error(
    JSON.stringify({
      level: "fatal",
      ts: new Date().toISOString(),
      msg: message,
    }),
  );
}
