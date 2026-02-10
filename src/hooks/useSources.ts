import { useEffect, useState } from "react";
import type { WsMessage } from "./useWebSocket";

// ---------------------------------------------------------------------------
// Local type definitions (mirror server-side source-types.ts, not imported)
// ---------------------------------------------------------------------------

export type AudioApi = "wasapi2" | "asio" | "directsound";
export type SourceStatus = "available" | "unavailable" | "in-use" | "verifying";

export interface AES67Source {
  readonly id: string;
  readonly type: "aes67";
  readonly name: string;
  readonly description: string;
  readonly multicastAddress: string;
  readonly port: number;
  readonly sampleRate: number;
  readonly bitDepth: number;
  readonly channelCount: number;
  readonly channelLabels: string[];
  status: SourceStatus;
}

export interface LocalDeviceSource {
  readonly id: string;
  readonly type: "local";
  readonly name: string;
  readonly api: AudioApi;
  readonly sampleRate: number;
  readonly bitDepth: number;
  readonly channelCount: number;
  readonly isLoopback: boolean;
  status: SourceStatus;
}

export type DiscoveredSource = AES67Source | LocalDeviceSource;

// ---------------------------------------------------------------------------
// Hook signature types
// ---------------------------------------------------------------------------

type SendMessage = (type: string, payload?: unknown, requestId?: string) => void;
type Subscribe = (type: string, handler: (msg: WsMessage) => void) => () => void;

export interface UseSourcesReturn {
  sources: DiscoveredSource[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSources(
  sendMessage: SendMessage,
  subscribe: Subscribe,
): UseSourcesReturn {
  const [sources, setSources] = useState<DiscoveredSource[]>([]);

  useEffect(() => {
    // Request full source list on mount
    sendMessage("sources:list");

    const unsubList = subscribe("sources:list", (msg: WsMessage) => {
      const payload = msg.payload as
        | { sources: DiscoveredSource[] }
        | undefined;
      if (payload?.sources) {
        setSources(payload.sources);
      }
    });

    const unsubChanged = subscribe("sources:changed", () => {
      // Server notifies that sources changed; re-request the full list
      sendMessage("sources:list");
    });

    return () => {
      unsubList();
      unsubChanged();
    };
  }, [sendMessage, subscribe]);

  return { sources };
}
