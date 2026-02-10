/**
 * Custom hook managing the channel list from server protoo notifications.
 *
 * Listens for "activeChannels", "listenerCounts", and "channelStopped"
 * notifications to maintain an up-to-date, sorted channel list.
 *
 * Sorting: live channels (hasActiveProducer=true) first, offline last.
 * Within each group, server order is preserved (admin-defined).
 */

import { useEffect, useState, useRef } from "react";
import type { Peer } from "../lib/signaling-client";
import type { ListenerChannelInfo } from "../lib/types";

interface ActiveChannelsData {
  channels: ListenerChannelInfo[];
  defaultChannelId?: string;
}

interface ListenerCountsData {
  channels: ListenerChannelInfo[];
}

interface ChannelStoppedData {
  channelId: string;
  remainingChannels: ListenerChannelInfo[];
}

/**
 * Sort channels: live first (hasActiveProducer=true), offline last.
 * Within each group, preserve original server order.
 */
function sortChannels(channels: ListenerChannelInfo[]): ListenerChannelInfo[] {
  const live = channels.filter((ch) => ch.hasActiveProducer);
  const offline = channels.filter((ch) => !ch.hasActiveProducer);
  return [...live, ...offline];
}

export interface UseChannelListResult {
  /** Sorted channel list (live first, offline last). */
  channels: ListenerChannelInfo[];
  /** Server-suggested default channel ID for first-time listeners. */
  defaultChannelId: string | null;
}

export function useChannelList(peer: Peer | null): UseChannelListResult {
  const [channels, setChannels] = useState<ListenerChannelInfo[]>([]);
  const [defaultChannelId, setDefaultChannelId] = useState<string | null>(null);
  const peerRef = useRef(peer);
  peerRef.current = peer;

  useEffect(() => {
    if (!peer) return;

    const handleNotification = (notification: {
      method: string;
      data?: Record<string, unknown>;
    }): void => {
      switch (notification.method) {
        case "activeChannels": {
          const payload = notification.data as unknown as ActiveChannelsData;
          setChannels(sortChannels(payload.channels));
          if (payload.defaultChannelId !== undefined) {
            setDefaultChannelId(payload.defaultChannelId ?? null);
          }
          break;
        }

        case "listenerCounts": {
          const payload = notification.data as unknown as ListenerCountsData;
          // Replace full channel list with updated counts from server
          setChannels(sortChannels(payload.channels));
          break;
        }

        case "channelStopped": {
          const payload = notification.data as unknown as ChannelStoppedData;
          // Update the stopped channel to offline and merge with remaining
          setChannels((prev) => {
            const updated = prev.map((ch) =>
              ch.id === payload.channelId
                ? { ...ch, hasActiveProducer: false }
                : ch,
            );
            return sortChannels(updated);
          });
          break;
        }
      }
    };

    peer.on("notification", handleNotification);

    return () => {
      peer.off("notification", handleNotification);
    };
  }, [peer]);

  return { channels, defaultChannelId };
}
