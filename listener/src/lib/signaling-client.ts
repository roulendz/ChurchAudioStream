/**
 * protoo-client wrapper for WebSocket signaling to the sidecar server.
 *
 * Thin wrapper that manages WebSocket URL construction and Peer creation.
 * Reconnection is handled by protoo-client's built-in retry logic
 * (10 attempts, exponential backoff). The caller (useSignaling hook)
 * handles "open" and "disconnected" events for state management.
 */

import { Peer, WebSocketTransport } from "protoo-client";

/**
 * Build the WebSocket URL for listener signaling from the current location.
 * Uses wss:// for HTTPS pages, ws:// for HTTP (dev mode).
 * Path is always /ws/listener per server routing in listener-handler.ts.
 */
export function buildWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/listener`;
}

/**
 * Create a protoo Peer connected to the sidecar signaling server.
 *
 * @param wsUrl - Full WebSocket URL (e.g. wss://192.168.1.5:7777/ws/listener)
 * @returns protoo Peer instance with built-in retry on connection failure
 */
export function createSignalingPeer(wsUrl: string): Peer {
  const transport = new WebSocketTransport(wsUrl);
  return new Peer(transport);
}

export type { Peer } from "protoo-client";
