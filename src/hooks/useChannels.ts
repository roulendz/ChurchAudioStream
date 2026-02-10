import { useEffect, useState, useCallback } from "react";
import type { WsMessage } from "./useWebSocket";

// ---------------------------------------------------------------------------
// Local type definitions (mirror server-side channel-types.ts, not imported)
// ---------------------------------------------------------------------------

export type ChannelOutputFormat = "mono" | "stereo";

export type ChannelStatus =
  | "stopped"
  | "starting"
  | "streaming"
  | "error"
  | "crashed";

export interface SourceAssignment {
  readonly sourceId: string;
  readonly selectedChannels: number[];
  gain: number;
  muted: boolean;
  delayMs: number;
}

/** Client-side channel model matching the server AppChannel interface. */
export interface AdminChannel {
  readonly id: string;
  name: string;
  sources: SourceAssignment[];
  outputFormat: ChannelOutputFormat;
  autoStart: boolean;
  visible: boolean;
  sortOrder: number;
  status: ChannelStatus;
  processing: Record<string, unknown>;
  readonly createdAt: number;
}

// ---------------------------------------------------------------------------
// Hook signature types
// ---------------------------------------------------------------------------

type SendMessage = (type: string, payload?: unknown, requestId?: string) => void;
type Subscribe = (type: string, handler: (msg: WsMessage) => void) => () => void;

export interface UseChannelsReturn {
  channels: AdminChannel[];
  createChannel: (name: string, outputFormat?: ChannelOutputFormat) => void;
  updateChannel: (
    channelId: string,
    updates: {
      name?: string;
      outputFormat?: ChannelOutputFormat;
      autoStart?: boolean;
      visible?: boolean;
    },
  ) => void;
  removeChannel: (channelId: string) => void;
  startChannel: (channelId: string) => void;
  stopChannel: (channelId: string) => void;
  reorderChannels: (channelIds: string[]) => void;
  addSource: (
    channelId: string,
    sourceId: string,
    selectedChannels: number[],
  ) => void;
  removeSource: (channelId: string, sourceIndex: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortBySortOrder(list: AdminChannel[]): AdminChannel[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChannels(
  sendMessage: SendMessage,
  subscribe: Subscribe,
): UseChannelsReturn {
  const [channels, setChannels] = useState<AdminChannel[]>([]);

  // --- Subscriptions + initial request ---
  useEffect(() => {
    // Request full channel list on mount
    sendMessage("channels:list");

    const unsubList = subscribe("channels:list", (msg: WsMessage) => {
      const payload = msg.payload as { channels: AdminChannel[] } | undefined;
      if (payload?.channels) {
        setChannels(sortBySortOrder(payload.channels));
      }
    });

    const unsubCreated = subscribe("channel:created", (msg: WsMessage) => {
      const created = msg.payload as AdminChannel | undefined;
      if (created) {
        setChannels((prev) => sortBySortOrder([...prev, created]));
      }
    });

    const unsubUpdated = subscribe("channel:updated", (msg: WsMessage) => {
      const updated = msg.payload as AdminChannel | undefined;
      if (updated) {
        setChannels((prev) =>
          sortBySortOrder(prev.map((ch) => (ch.id === updated.id ? updated : ch))),
        );
      }
    });

    const unsubRemoved = subscribe("channel:removed", (msg: WsMessage) => {
      const payload = msg.payload as { channelId: string } | undefined;
      if (payload?.channelId) {
        setChannels((prev) => prev.filter((ch) => ch.id !== payload.channelId));
      }
    });

    const unsubState = subscribe("channel:state", (msg: WsMessage) => {
      const payload = msg.payload as
        | { channelId: string; status?: ChannelStatus; action?: string }
        | undefined;
      if (payload?.channelId) {
        setChannels((prev) =>
          prev.map((ch) => {
            if (ch.id !== payload.channelId) return ch;
            // Server sends either a status field directly or an action string
            const newStatus: ChannelStatus =
              payload.status ??
              (payload.action === "started" ? "starting" : "stopped");
            return { ...ch, status: newStatus };
          }),
        );
      }
    });

    return () => {
      unsubList();
      unsubCreated();
      unsubUpdated();
      unsubRemoved();
      unsubState();
    };
  }, [sendMessage, subscribe]);

  // --- CRUD operations (send WS messages, no optimistic update) ---

  const createChannel = useCallback(
    (name: string, outputFormat?: ChannelOutputFormat) => {
      sendMessage("channel:create", { name, outputFormat });
    },
    [sendMessage],
  );

  const updateChannel = useCallback(
    (
      channelId: string,
      updates: {
        name?: string;
        outputFormat?: ChannelOutputFormat;
        autoStart?: boolean;
        visible?: boolean;
      },
    ) => {
      sendMessage("channel:update", { channelId, ...updates });
    },
    [sendMessage],
  );

  const removeChannel = useCallback(
    (channelId: string) => {
      sendMessage("channel:remove", { channelId });
    },
    [sendMessage],
  );

  const startChannel = useCallback(
    (channelId: string) => {
      sendMessage("channel:start", { channelId });
    },
    [sendMessage],
  );

  const stopChannel = useCallback(
    (channelId: string) => {
      sendMessage("channel:stop", { channelId });
    },
    [sendMessage],
  );

  const reorderChannels = useCallback(
    (channelIds: string[]) => {
      sendMessage("channel:reorder", { channelIds });
    },
    [sendMessage],
  );

  const addSource = useCallback(
    (channelId: string, sourceId: string, selectedChannels: number[]) => {
      sendMessage("channel:source:add", {
        channelId,
        sourceId,
        selectedChannels,
      });
    },
    [sendMessage],
  );

  const removeSource = useCallback(
    (channelId: string, sourceIndex: number) => {
      sendMessage("channel:source:remove", { channelId, sourceIndex });
    },
    [sendMessage],
  );

  return {
    channels,
    createChannel,
    updateChannel,
    removeChannel,
    startChannel,
    stopChannel,
    reorderChannels,
    addSource,
    removeSource,
  };
}
