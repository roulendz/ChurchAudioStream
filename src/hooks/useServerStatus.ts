import { useEffect, useState, useCallback, useRef } from "react";
import {
  useWebSocket,
  type ConnectionStatus,
  type WsMessage,
} from "./useWebSocket";

export interface AppConfig {
  server: {
    port: number;
    host: string;
    interface?: string;
  };
  network: {
    domain: string;
    mdns: {
      enabled: boolean;
    };
    hostsFile: {
      enabled: boolean;
    };
  };
  certificate: {
    certPath: string;
    keyPath: string;
  };
}

export interface NetworkInterface {
  name: string;
  address: string;
  family: "IPv4" | "IPv6";
  mac: string;
  internal: boolean;
}

export interface ConfigUpdateResult {
  success: boolean;
  config?: AppConfig;
  errors?: string[];
  requiresRestart?: boolean;
}

interface UseServerStatusReturn {
  config: AppConfig | null;
  connectionStatus: ConnectionStatus;
  reconnectAttempts: number;
  interfaces: NetworkInterface[];
  updateConfig: (
    partial: Partial<AppConfig>,
  ) => Promise<ConfigUpdateResult>;
  sendMessage: (type: string, payload?: unknown, requestId?: string) => void;
  subscribe: (type: string, handler: (msg: WsMessage) => void) => () => void;
}

const DEFAULT_HTTPS_PORT = 7777;

/**
 * Fixed loopback port for the admin WebSocket connection.
 * Must match ADMIN_LOOPBACK_PORT in sidecar/src/server.ts.
 * Intentionally NOT derived from config.server.port so that
 * changing the external HTTPS port never breaks the admin connection.
 */
const ADMIN_LOOPBACK_PORT = 7778;

function isTauriEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  );
}

function resolveWebSocketUrl(): string {
  // Tauri admin UI connects via plain ws:// to the HTTP loopback server (no TLS cert issues)
  // Phone browsers connect via wss:// to the HTTPS server (encrypted for WiFi)
  if (typeof window !== "undefined" && window.location) {
    if (isTauriEnvironment()) {
      return `ws://127.0.0.1:${ADMIN_LOOPBACK_PORT}`;
    }
    // Running in browser: derive from current URL
    const host = window.location.hostname;
    const port = window.location.port || String(DEFAULT_HTTPS_PORT);
    return `wss://${host}:${port}`;
  }
  return `ws://127.0.0.1:${ADMIN_LOOPBACK_PORT}`;
}

let requestIdCounter = 0;
function generateRequestId(): string {
  return `req-${Date.now()}-${++requestIdCounter}`;
}

export function useServerStatus(): UseServerStatusReturn {
  const [wsUrl, setWsUrl] = useState(resolveWebSocketUrl);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([]);

  const pendingRequests = useRef<
    Map<string, (result: ConfigUpdateResult) => void>
  >(new Map());

  const {
    status: connectionStatus,
    sendMessage,
    subscribe,
    reconnectAttempts,
  } = useWebSocket({ url: wsUrl, role: "admin" });

  // When connected, fetch initial config and interfaces
  useEffect(() => {
    if (connectionStatus !== "connected") return;

    const requestConfigId = generateRequestId();
    sendMessage("config:get", undefined, requestConfigId);
    sendMessage("interfaces:list", undefined, generateRequestId());
  }, [connectionStatus, sendMessage]);

  // Subscribe to config:response messages (both initial load and update responses)
  useEffect(() => {
    const unsubConfigResponse = subscribe(
      "config:response",
      (message: WsMessage) => {
        const payload = message.payload as ConfigUpdateResult | AppConfig;

        // If it has a "success" field, it's a config update response
        if ("success" in payload) {
          const updateResult = payload as ConfigUpdateResult;
          if (updateResult.success && updateResult.config) {
            setConfig(updateResult.config);
            updateWsUrlFromConfig(updateResult.config);
          }

          // Resolve pending request if any
          if (message.requestId) {
            const resolver = pendingRequests.current.get(message.requestId);
            if (resolver) {
              resolver(updateResult);
              pendingRequests.current.delete(message.requestId);
            }
          }
        } else {
          // Plain config response (from config:get)
          setConfig(payload as AppConfig);
          updateWsUrlFromConfig(payload as AppConfig);
        }
      },
    );

    const unsubConfigUpdated = subscribe(
      "config:updated",
      (message: WsMessage) => {
        const updatedConfig = message.payload as AppConfig;
        setConfig(updatedConfig);
        updateWsUrlFromConfig(updatedConfig);
      },
    );

    const unsubInterfaces = subscribe(
      "interfaces:list",
      (message: WsMessage) => {
        const payload = message.payload as {
          interfaces: NetworkInterface[];
        };
        setInterfaces(payload.interfaces);
      },
    );

    return () => {
      unsubConfigResponse();
      unsubConfigUpdated();
      unsubInterfaces();
    };
  }, [subscribe]);

  function updateWsUrlFromConfig(newConfig: AppConfig): void {
    if (isTauriEnvironment()) {
      // Loopback port is fixed -- no update needed for Tauri admin.
      // Only browser clients need to track config port changes.
      return;
    }
    const host = window.location.hostname;
    setWsUrl(`wss://${host}:${newConfig.server.port}`);
  }

  const updateConfig = useCallback(
    (partial: Partial<AppConfig>): Promise<ConfigUpdateResult> => {
      return new Promise((resolve) => {
        const requestId = generateRequestId();

        // Set a timeout so the promise doesn't hang forever
        const timeout = setTimeout(() => {
          pendingRequests.current.delete(requestId);
          resolve({
            success: false,
            errors: ["Request timed out after 10 seconds"],
          });
        }, 10_000);

        pendingRequests.current.set(requestId, (result) => {
          clearTimeout(timeout);
          resolve(result);
        });

        sendMessage("config:update", partial, requestId);
      });
    },
    [sendMessage],
  );

  return {
    config,
    connectionStatus,
    reconnectAttempts,
    interfaces,
    updateConfig,
    sendMessage,
    subscribe,
  };
}
