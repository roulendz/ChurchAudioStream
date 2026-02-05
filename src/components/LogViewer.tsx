import { useState, useEffect, useRef, useCallback } from "react";
import type { WsMessage } from "../hooks/useWebSocket";

const MAX_LOG_LINES = 200;

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal" | "unknown";

interface LogEntry {
  id: number;
  level: LogLevel;
  timestamp: string;
  message: string;
  raw: string;
}

interface LogViewerProps {
  subscribe: (type: string, handler: (msg: WsMessage) => void) => () => void;
}

const LOG_LEVEL_CLASS: Record<LogLevel, string> = {
  debug: "log-level--debug",
  info: "log-level--info",
  warn: "log-level--warn",
  error: "log-level--error",
  fatal: "log-level--error",
  unknown: "log-level--info",
};

let entryIdCounter = 0;

function parseLogLine(raw: string): LogEntry {
  try {
    const parsed = JSON.parse(raw) as {
      level?: string;
      ts?: string;
      msg?: string;
    };
    return {
      id: ++entryIdCounter,
      level: (parsed.level as LogLevel) ?? "unknown",
      timestamp: parsed.ts ?? new Date().toISOString(),
      message: parsed.msg ?? raw,
      raw,
    };
  } catch {
    return {
      id: ++entryIdCounter,
      level: "unknown",
      timestamp: new Date().toISOString(),
      message: raw,
      raw,
    };
  }
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function LogViewer({ subscribe }: LogViewerProps) {
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const isTauriRef = useRef(false);

  // Check if running in Tauri
  useEffect(() => {
    isTauriRef.current =
      typeof window !== "undefined" &&
      ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);
  }, []);

  const addLogEntry = useCallback((raw: string) => {
    const entry = parseLogLine(raw);
    setLogEntries((prev) => {
      const updated = [...prev, entry];
      if (updated.length > MAX_LOG_LINES) {
        return updated.slice(updated.length - MAX_LOG_LINES);
      }
      return updated;
    });
  }, []);

  // Set up Tauri event listeners if running in Tauri
  useEffect(() => {
    if (!isTauriRef.current) return;

    let cleanupFns: Array<() => void> = [];

    // Dynamically import Tauri API to avoid errors in browser mode
    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        const setupListeners = async () => {
          const unlistenLog = await listen<string>(
            "sidecar-log",
            (event) => {
              addLogEntry(event.payload);
            },
          );
          const unlistenError = await listen<string>(
            "sidecar-error",
            (event) => {
              addLogEntry(event.payload);
            },
          );
          cleanupFns.push(unlistenLog, unlistenError);
        };
        setupListeners().catch((error) => {
          console.warn(
            "Failed to set up Tauri sidecar log listeners:",
            error instanceof Error ? error.message : String(error),
          );
        });
      })
      .catch((error) => {
        console.warn(
          "Tauri event API not available, falling back to WebSocket logs:",
          error instanceof Error ? error.message : String(error),
        );
      });

    return () => {
      for (const cleanup of cleanupFns) {
        cleanup();
      }
    };
  }, [addLogEntry]);

  // Subscribe to WebSocket log messages (fallback for browser mode)
  useEffect(() => {
    if (isTauriRef.current) return;

    const unsubLog = subscribe("log:entry", (message: WsMessage) => {
      const payload = message.payload as { line?: string } | undefined;
      if (payload?.line) {
        addLogEntry(payload.line);
      }
    });

    return unsubLog;
  }, [subscribe, addLogEntry]);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop =
        logContainerRef.current.scrollHeight;
    }
  }, [logEntries, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 30;
    setAutoScroll(isAtBottom);
  }, []);

  const handleClear = useCallback(() => {
    setLogEntries([]);
  }, []);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <section className="log-viewer">
      <div className="log-viewer-header">
        <button
          type="button"
          className="log-viewer-toggle"
          onClick={toggleExpanded}
          aria-expanded={isExpanded}
        >
          <span className="toggle-arrow">{isExpanded ? "\u25BC" : "\u25B6"}</span>
          Sidecar Logs ({logEntries.length})
        </button>
        {isExpanded && (
          <button
            type="button"
            className="btn-clear-logs"
            onClick={handleClear}
          >
            Clear
          </button>
        )}
      </div>

      {isExpanded && (
        <div
          ref={logContainerRef}
          className="log-viewer-container"
          onScroll={handleScroll}
        >
          {logEntries.length === 0 ? (
            <p className="log-empty">No log entries yet...</p>
          ) : (
            logEntries.map((entry) => (
              <div
                key={entry.id}
                className={`log-entry ${LOG_LEVEL_CLASS[entry.level]}`}
              >
                <span className="log-time">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span className="log-level-badge">{entry.level}</span>
                <span className="log-message">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
