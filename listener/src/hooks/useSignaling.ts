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

/** Max time (ms) to stay in "reconnecting" before giving up and showing offline screen. */
const RECONNECT_TIMEOUT_MS = 30_000;

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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReconnect = useCallback(() => {
    setIsReconnect(false);
  }, []);

  /**
   * Start the reconnection wall-clock timeout if not already running.
   * After RECONNECT_TIMEOUT_MS, gives up and transitions to "disconnected"
   * (which triggers the OfflineScreen). Also closes the protoo peer to stop
   * its infinite _runWebSocket() retry loop.
   */
  const startReconnectTimeout = useCallback(() => {
    if (reconnectTimerRef.current) return; // Already running
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (abortedRef.current) return;
      setConnectionState("disconnected");
      // Close the peer to stop protoo's infinite retry loop
      if (peerRef.current && !peerRef.current.closed) {
        peerRef.current.close();
      }
    }, RECONNECT_TIMEOUT_MS);
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    abortedRef.current = false;

    const wsUrl = buildWsUrl();
    const peer = createSignalingPeer(wsUrl);
    peerRef.current = peer;

    peer.on("open", () => {
      if (abortedRef.current) return;

      clearReconnectTimeout();

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
      startReconnectTimeout();
    });

    peer.on("close", () => {
      if (abortedRef.current) return;
      setConnectionState("disconnected");
    });

    peer.on("failed", () => {
      if (abortedRef.current) return;
      // Still retrying -- keep showing reconnecting
      setConnectionState("reconnecting");
      startReconnectTimeout();
    });

    return () => {
      abortedRef.current = true;
      clearReconnectTimeout();
      if (!peer.closed) {
        peer.close();
      }
      peerRef.current = null;
    };
  }, [startReconnectTimeout, clearReconnectTimeout]);

  return {
    peer: peerRef.current,
    connectionState,
    isReconnect,
    clearReconnect,
  };
}
