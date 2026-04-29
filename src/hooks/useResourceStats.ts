import { useEffect, useState, useRef } from "react";
import type { WsMessage } from "./useWebSocket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResourceStats {
  uptime: number; // seconds
  connections: {
    total: number;
    admin: number;
    listener: number;
    unidentified: number;
  };
  config: {
    port: number;
    host: string;
    domain: string;
  };
  cpuPercent: number | null;
  memoryMb: number | null;
}

export interface WorkerInfo {
  index: number;
  peakMemoryKb: number;
  routerCount: number;
  alive: boolean;
}

interface ServerStatusPayload {
  uptime: number;
  connections: {
    total: number;
    admin: number;
    listener: number;
    unidentified: number;
  };
  config: {
    port: number;
    host: string;
    domain: string;
  };
}

interface StreamingStatusPayload {
  workers: WorkerInfo[];
}

interface UseResourceStatsReturn {
  stats: ResourceStats | null;
  workers: WorkerInfo[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useResourceStats(
  sendMessage: (type: string, payload?: unknown, requestId?: string) => void,
  subscribe: (type: string, handler: (msg: WsMessage) => void) => () => void,
): UseResourceStatsReturn {
  const [stats, setStats] = useState<ResourceStats | null>(null);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Subscribe to server:status and streaming:status responses
  useEffect(() => {
    const unsubServerStatus = subscribe(
      "server:status",
      (message: WsMessage) => {
        const payload = message.payload as ServerStatusPayload;
        if (!payload) return;

        setStats({
          uptime: payload.uptime,
          connections: payload.connections,
          config: payload.config,
          // Server-level CPU/memory not tracked yet -- Phase 9
          cpuPercent: null,
          memoryMb: null,
        });
      },
    );

    const unsubStreamingStatus = subscribe(
      "streaming:status",
      (message: WsMessage) => {
        const payload = message.payload as StreamingStatusPayload;
        if (payload?.workers) {
          setWorkers(payload.workers);
        }
      },
    );

    return () => {
      unsubServerStatus();
      unsubStreamingStatus();
    };
  }, [subscribe]);

  // Poll server:status AND streaming:status on mount and every POLL_INTERVAL_MS.
  // streaming:status was previously polled only once on mount, so the workers
  // list captured "0 workers" before any channel had started and never
  // refreshed -- audio played fine, UI lied.
  useEffect(() => {
    sendMessage("server:status");
    sendMessage("streaming:status");

    pollTimerRef.current = setInterval(() => {
      sendMessage("server:status");
      sendMessage("streaming:status");
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current !== null) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [sendMessage]);

  return { stats, workers };
}
