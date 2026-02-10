/**
 * Custom hook managing protoo peer lifecycle for listener signaling.
 *
 * Creates a protoo Peer on mount, tracks connection state, and exposes
 * the peer for making requests. Handles reconnection detection so the
 * mediasoup hook can re-run the full handshake after WiFi drops.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  createSignalingPeer,
  buildWsUrl,
  type Peer,
} from "../lib/signaling-client";

export type ConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

export interface UseSignalingResult {
  /** The protoo Peer instance (null until created). */
  peer: Peer | null;
  /** Current WebSocket connection state. */
  connectionState: ConnectionState;
  /**
   * True when the peer reconnects after a disconnection (not first connect).
   * The mediasoup hook should re-run the full handshake when this flips.
   */
  isReconnect: boolean;
  /** Reset the reconnect flag after handling it. */
  clearReconnect: () => void;
}

export function useSignaling(): UseSignalingResult {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [isReconnect, setIsReconnect] = useState(false);
  const peerRef = useRef<Peer | null>(null);
  const hasConnectedOnce = useRef(false);
  const abortedRef = useRef(false);

  const clearReconnect = useCallback(() => {
    setIsReconnect(false);
  }, []);

  useEffect(() => {
    abortedRef.current = false;

    const wsUrl = buildWsUrl();
    const peer = createSignalingPeer(wsUrl);
    peerRef.current = peer;

    peer.on("open", () => {
      if (abortedRef.current) return;

      if (hasConnectedOnce.current) {
        // Reconnected after a disconnection
        setIsReconnect(true);
        setConnectionState("connected");
      } else {
        hasConnectedOnce.current = true;
        setConnectionState("connected");
      }
    });

    peer.on("disconnected", () => {
      if (abortedRef.current) return;
      setConnectionState("reconnecting");
    });

    peer.on("close", () => {
      if (abortedRef.current) return;
      setConnectionState("disconnected");
    });

    peer.on("failed", () => {
      if (abortedRef.current) return;
      // Still retrying -- keep showing reconnecting
      setConnectionState("reconnecting");
    });

    return () => {
      abortedRef.current = true;
      if (!peer.closed) {
        peer.close();
      }
      peerRef.current = null;
    };
  }, []);

  return {
    peer: peerRef.current,
    connectionState,
    isReconnect,
    clearReconnect,
  };
}
