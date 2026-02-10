import { useEffect, useState, useCallback } from "react";
import type { WsMessage } from "./useWebSocket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StreamingStatusChannel {
  channelId: string;
  listenerCount: number;
}

interface StreamingStatusPayload {
  totalListeners: number;
  channels: StreamingStatusChannel[];
}

interface ListenerCountPayload {
  channelId: string | null;
  count: number;
  totalListeners: number;
}

interface UseListenerCountsReturn {
  totalListeners: number;
  channelCounts: Map<string, number>;
  getChannelListenerCount: (channelId: string) => number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useListenerCounts(
  sendMessage: (type: string, payload?: unknown, requestId?: string) => void,
  subscribe: (type: string, handler: (msg: WsMessage) => void) => () => void,
): UseListenerCountsReturn {
  const [totalListeners, setTotalListeners] = useState(0);
  const [channelCounts, setChannelCounts] = useState<Map<string, number>>(
    () => new Map(),
  );

  // Request initial snapshot and subscribe to updates
  useEffect(() => {
    // Request current streaming status for initial counts
    sendMessage("streaming:status");

    // Subscribe to full status response (initial snapshot)
    const unsubStatus = subscribe(
      "streaming:status",
      (message: WsMessage) => {
        const payload = message.payload as StreamingStatusPayload;
        if (!payload?.channels) return;

        setTotalListeners(payload.totalListeners ?? 0);
        setChannelCounts((prev) => {
          const next = new Map(prev);
          for (const channel of payload.channels) {
            next.set(channel.channelId, channel.listenerCount ?? 0);
          }
          return next;
        });
      },
    );

    // Subscribe to incremental listener count broadcasts (pushed by server)
    const unsubCount = subscribe(
      "streaming:listener-count",
      (message: WsMessage) => {
        const payload = message.payload as ListenerCountPayload;
        if (payload == null) return;

        setTotalListeners(payload.totalListeners);
        if (payload.channelId != null) {
          setChannelCounts((prev) => {
            const next = new Map(prev);
            next.set(payload.channelId as string, payload.count);
            return next;
          });
        }
      },
    );

    return () => {
      unsubStatus();
      unsubCount();
    };
  }, [sendMessage, subscribe]);

  const getChannelListenerCount = useCallback(
    (channelId: string): number => channelCounts.get(channelId) ?? 0,
    [channelCounts],
  );

  return { totalListeners, channelCounts, getChannelListenerCount };
}
