import { useEffect, useRef, useCallback, useState } from "react";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

export interface WsMessage {
  type: string;
  payload?: unknown;
  requestId?: string;
}

type MessageHandler = (message: WsMessage) => void;

interface UseWebSocketOptions {
  url: string;
  role?: "admin" | "listener";
}

interface UseWebSocketReturn {
  status: ConnectionStatus;
  sendMessage: (type: string, payload?: unknown, requestId?: string) => void;
  subscribe: (type: string, handler: MessageHandler) => () => void;
  lastMessage: WsMessage | null;
  reconnectAttempts: number;
}

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const RECONNECT_BACKOFF_FACTOR = 2;

function buildReconnectDelay(attempt: number): number {
  const delay =
    INITIAL_RECONNECT_DELAY_MS *
    Math.pow(RECONNECT_BACKOFF_FACTOR, attempt);
  return Math.min(delay, MAX_RECONNECT_DELAY_MS);
}

export function useWebSocket({
  url,
  role = "admin",
}: UseWebSocketOptions): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlRef = useRef(url);
  const isMountedRef = useRef(true);
  const isServerRestartRef = useRef(false);

  // Keep urlRef in sync so reconnect uses latest URL
  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const notifySubscribers = useCallback((message: WsMessage) => {
    const handlers = subscribersRef.current.get(message.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(message);
      }
    }
  }, []);

  const scheduleReconnect = useCallback(
    (attempt: number) => {
      if (!isMountedRef.current) return;
      clearReconnectTimer();

      const delay = buildReconnectDelay(attempt);
      setStatus("reconnecting");
      setReconnectAttempts(attempt + 1);

      reconnectTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          connect();
        }
      }, delay);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const connect = useCallback(() => {
    if (!isMountedRef.current) return;

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(urlRef.current);
    } catch {
      scheduleReconnect(reconnectAttempts);
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMountedRef.current) return;
      setStatus("connected");
      setReconnectAttempts(0);
      isServerRestartRef.current = false;

      // Send identify message immediately after connection
      const identifyMessage: WsMessage = {
        type: "identify",
        payload: { role },
      };
      ws.send(JSON.stringify(identifyMessage));
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!isMountedRef.current) return;

      let message: WsMessage;
      try {
        message = JSON.parse(event.data as string);
      } catch {
        return;
      }

      setLastMessage(message);

      // Handle server restart notification: update reconnect URL
      // The payload port is the HTTPS port; Tauri uses ws:// on loopback (port+1)
      if (message.type === "server:restarting") {
        isServerRestartRef.current = true;
        const payload = message.payload as
          | { host?: string; port?: number }
          | undefined;
        if (payload?.port) {
          const currentUrl = new URL(urlRef.current);
          const isTauri = currentUrl.protocol === "ws:";
          if (payload.host && !isTauri) {
            currentUrl.hostname = payload.host;
          }
          currentUrl.port = isTauri
            ? String(payload.port + 1)
            : String(payload.port);
          urlRef.current = currentUrl.toString();
        }
      }

      notifySubscribers(message);
    };

    ws.onclose = (event: CloseEvent) => {
      if (!isMountedRef.current) return;
      wsRef.current = null;

      // Close code 1012 = server restart, reconnect immediately
      if (event.code === 1012 || isServerRestartRef.current) {
        isServerRestartRef.current = false;
        setStatus("reconnecting");
        setReconnectAttempts(0);
        // Short delay to allow server to start
        reconnectTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            connect();
          }
        }, 1500);
        return;
      }

      setStatus("disconnected");
      scheduleReconnect(reconnectAttempts);
    };

    ws.onerror = () => {
      // onclose will fire after onerror, so we handle reconnect there
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, notifySubscribers]);

  const sendMessage = useCallback(
    (type: string, payload?: unknown, requestId?: string) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      const message: WsMessage = { type };
      if (payload !== undefined) message.payload = payload;
      if (requestId !== undefined) message.requestId = requestId;
      wsRef.current.send(JSON.stringify(message));
    },
    [],
  );

  const subscribe = useCallback(
    (type: string, handler: MessageHandler): (() => void) => {
      if (!subscribersRef.current.has(type)) {
        subscribersRef.current.set(type, new Set());
      }
      subscribersRef.current.get(type)!.add(handler);

      return () => {
        const handlers = subscribersRef.current.get(type);
        if (handlers) {
          handlers.delete(handler);
          if (handlers.size === 0) {
            subscribersRef.current.delete(type);
          }
        }
      };
    },
    [],
  );

  // Connect on mount, cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    connect();

    return () => {
      isMountedRef.current = false;
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconnect when URL changes (e.g., port changed in settings)
  useEffect(() => {
    if (status === "connected" || status === "connecting") {
      // URL changed while connected -- disconnect and reconnect to new URL
      urlRef.current = url;
      connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return {
    status,
    sendMessage,
    subscribe,
    lastMessage,
    reconnectAttempts,
  };
}
