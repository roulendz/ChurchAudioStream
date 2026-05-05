import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
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

const LOG_LEVEL_BADGE_COLORS: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-foreground",
  warn: "text-warning",
  error: "text-destructive",
  fatal: "text-destructive",
  unknown: "text-foreground",
};

const LOG_LEVEL_MESSAGE_COLORS: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-foreground",
  warn: "text-warning",
  error: "text-destructive",
  fatal: "text-destructive",
  unknown: "text-foreground",
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

  // Fetch early sidecar logs that were buffered in Rust before this component mounted.
  // drain() on the Rust side ensures logs are replayed at most once, even with StrictMode
  // double-mount (second invoke returns an empty array).
  useEffect(() => {
    if (!isTauriRef.current) return;

    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke<string[]>("get_buffered_logs")
          .then((bufferedLines) => {
            for (const line of bufferedLines) {
              addLogEntry(line);
            }
          })
          .catch((error) => {
            console.warn(
              "Failed to fetch buffered sidecar logs:",
              error instanceof Error ? error.message : String(error),
            );
          });
      })
      .catch(() => {
        // Tauri core API not available -- ignore (browser mode)
      });
  }, [addLogEntry]);

  // Ref to hold Tauri listener cleanup functions so the cleanup closure
  // always accesses the latest value (survives async registration race)
  const tauriListenerCleanupRef = useRef<Array<() => void>>([]);

  // Set up Tauri event listeners if running in Tauri.
  // Uses an `aborted` flag to handle React StrictMode's unmount/remount cycle:
  //   Mount 1: aborted=false, async import starts, listeners register
  //   Unmount 1 (StrictMode): aborted=true, cleanup runs or async guard prevents registration
  //   Mount 2: new aborted=false, listeners register once
  //   Result: exactly one set of active listeners
  useEffect(() => {
    if (!isTauriRef.current) return;
    let aborted = false;

    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        if (aborted) return;

        const setupListeners = async () => {
          const unlistenLog = await listen<string>(
            "sidecar-log",
            (event) => {
              if (!aborted) addLogEntry(event.payload);
            },
          );
          const unlistenError = await listen<string>(
            "sidecar-error",
            (event) => {
              if (!aborted) addLogEntry(event.payload);
            },
          );
          if (aborted) {
            unlistenLog();
            unlistenError();
            return;
          }
          tauriListenerCleanupRef.current = [unlistenLog, unlistenError];
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
      aborted = true;
      for (const cleanup of tauriListenerCleanupRef.current) {
        cleanup();
      }
      tauriListenerCleanupRef.current = [];
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
    <section className="bg-card border border-border rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-secondary border-b border-border">
        <button
          type="button"
          className="bg-transparent border-none text-foreground text-sm font-medium cursor-pointer flex items-center gap-2 py-1 hover:text-primary"
          onClick={toggleExpanded}
          aria-expanded={isExpanded}
        >
          <span className="text-[0.7rem] w-[1em] inline-block">{isExpanded ? "▼" : "▶"}</span>
          Sidecar Logs ({logEntries.length})
        </button>
        {isExpanded && (
          <button
            type="button"
            className="px-3 py-1 bg-transparent border border-border rounded-md text-muted-foreground text-xs cursor-pointer transition-all hover:border-muted-foreground hover:text-foreground"
            onClick={handleClear}
          >
            Clear
          </button>
        )}
      </div>

      {isExpanded && (
        <div
          ref={logContainerRef}
          className="max-h-[300px] overflow-y-auto p-2 font-[family-name:var(--font-mono)] text-xs leading-relaxed"
          onScroll={handleScroll}
        >
          {logEntries.length === 0 ? (
            <p className="text-muted-foreground text-center py-4 font-sans italic">
              No log entries yet...
            </p>
          ) : (
            logEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex gap-2 px-1 py-px rounded-sm whitespace-nowrap hover:bg-white/[0.03]"
              >
                <span className="text-muted-foreground shrink-0">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span
                  className={cn(
                    "shrink-0 min-w-[3.5em] uppercase font-semibold text-[0.7rem] leading-relaxed",
                    LOG_LEVEL_BADGE_COLORS[entry.level]
                  )}
                >
                  {entry.level}
                </span>
                <span
                  className={cn(
                    "overflow-hidden text-ellipsis",
                    LOG_LEVEL_MESSAGE_COLORS[entry.level]
                  )}
                >
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
