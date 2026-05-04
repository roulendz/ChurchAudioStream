/**
 * Hook for toggling server-side audio processing (AGC) from the listener.
 *
 * Sends a single protoo request "toggleProcessing" with { channelId, enabled }.
 * The server applies the change to the GStreamer pipeline (1.5s debounced restart).
 * This affects ALL listeners on the channel (channel-level toggle, not per-listener).
 */

import { useCallback, useState } from "react";
import type { Peer } from "../lib/signaling-client";

export interface UseProcessingToggleResult {
  /** Current state of processing (optimistic, updated on server confirm) */
  processingEnabled: boolean;
  /** Toggle processing on/off */
  toggle: (channelId: string, peer: Peer) => Promise<void>;
  /** Set state directly (e.g., from server notification) */
  setProcessingEnabled: (enabled: boolean) => void;
}

export function useProcessingToggle(
  initialEnabled = true,
): UseProcessingToggleResult {
  const [processingEnabled, setProcessingEnabled] = useState(initialEnabled);

  const toggle = useCallback(
    async (channelId: string, peer: Peer): Promise<void> => {
      const newEnabled = !processingEnabled;
      // Optimistic update
      setProcessingEnabled(newEnabled);
      try {
        await peer.request("toggleProcessing", {
          channelId,
          enabled: newEnabled,
        });
      } catch {
        // Revert on failure
        setProcessingEnabled(!newEnabled);
      }
    },
    [processingEnabled],
  );

  return { processingEnabled, toggle, setProcessingEnabled };
}
