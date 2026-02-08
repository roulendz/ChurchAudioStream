/**
 * Minimal type declarations for protoo-server v4.x.
 *
 * protoo-server does not ship TypeScript types. These declarations cover
 * the API surface used by the streaming subsystem: WebSocketServer for
 * accepting listener connections, Room for peer management, and Peer for
 * signaling (request/response/notification).
 */

declare module "protoo-server" {
  import type { Server as HttpServer } from "node:http";
  import type { Server as HttpsServer } from "node:https";
  import type { IncomingMessage } from "node:http";
  import type { Socket } from "node:net";

  // -------------------------------------------------------------------------
  // Transport (returned by accept() in connectionrequest)
  // -------------------------------------------------------------------------

  interface WebSocketTransport {
    readonly closed: boolean;
    close(): void;
    // Internal -- used by Room/Peer, not directly by application code
  }

  // -------------------------------------------------------------------------
  // Connection request info object
  // -------------------------------------------------------------------------

  interface ConnectionRequestInfo {
    /** The underlying HTTP request from the WebSocket upgrade. */
    request: IncomingMessage;
    /** The request origin header value. */
    origin: string;
    /** The underlying TCP socket. */
    socket: Socket;
  }

  // -------------------------------------------------------------------------
  // Protoo request/notification message shapes
  // -------------------------------------------------------------------------

  interface ProtooRequest {
    request: true;
    id: number;
    method: string;
    data?: Record<string, unknown>;
  }

  interface ProtooNotification {
    notification: true;
    method: string;
    data?: Record<string, unknown>;
  }

  type AcceptFn = (data?: unknown) => void;
  type RejectFn = (errorCode: number | Error, errorReason?: string | Error) => void;

  // -------------------------------------------------------------------------
  // Peer
  // -------------------------------------------------------------------------

  class Peer {
    readonly id: string;
    readonly closed: boolean;
    /** Application-specific data store. Freely writable, not replaceable. */
    readonly data: Record<string, unknown>;

    close(): void;

    /** Send a request to the remote peer and await the response. */
    request(method: string, data?: unknown): Promise<unknown>;

    /** Send a one-way notification to the remote peer. */
    notify(method: string, data?: unknown): Promise<void>;

    on(event: "close", listener: () => void): this;
    on(
      event: "request",
      listener: (
        request: ProtooRequest,
        accept: AcceptFn,
        reject: RejectFn,
      ) => void,
    ): this;
    on(
      event: "notification",
      listener: (notification: ProtooNotification) => void,
    ): this;
  }

  // -------------------------------------------------------------------------
  // Room
  // -------------------------------------------------------------------------

  class Room {
    readonly closed: boolean;
    readonly peers: Peer[];

    close(): void;
    createPeer(peerId: string, transport: WebSocketTransport): Peer;
    hasPeer(peerId: string): boolean;
    getPeer(peerId: string): Peer | undefined;

    on(event: "close", listener: () => void): this;
  }

  // -------------------------------------------------------------------------
  // WebSocketServer
  // -------------------------------------------------------------------------

  class WebSocketServer {
    constructor(
      httpServer: HttpServer | HttpsServer,
      options?: Record<string, unknown>,
    );

    /** Stop the WebSocket server (does NOT close the HTTP server). */
    stop(): void;

    on(
      event: "connectionrequest",
      listener: (
        info: ConnectionRequestInfo,
        accept: () => WebSocketTransport,
        reject: (code?: number, reason?: string) => void,
      ) => void,
    ): this;
  }

  const version: string;
}
