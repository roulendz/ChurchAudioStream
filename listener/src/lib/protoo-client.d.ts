/**
 * Minimal type declarations for protoo-client v4.x (browser build).
 *
 * protoo-client does not ship TypeScript types. These declarations cover
 * the API surface used by the listener PWA: WebSocketTransport for
 * connecting to the server, and Peer for signaling (request/response/notification).
 */

declare module "protoo-client" {
  // ---------------------------------------------------------------------------
  // WebSocketTransport
  // ---------------------------------------------------------------------------

  interface WebSocketTransportOptions {
    retry?: {
      retries?: number;
      factor?: number;
      minTimeout?: number;
      maxTimeout?: number;
    };
  }

  class WebSocketTransport {
    constructor(url: string, options?: WebSocketTransportOptions);
    readonly closed: boolean;
    close(): void;
  }

  // ---------------------------------------------------------------------------
  // Notification shape
  // ---------------------------------------------------------------------------

  interface ProtooNotification {
    notification: true;
    method: string;
    data?: Record<string, unknown>;
  }

  // ---------------------------------------------------------------------------
  // Peer
  // ---------------------------------------------------------------------------

  class Peer {
    constructor(transport: WebSocketTransport);
    readonly closed: boolean;
    readonly data: Record<string, unknown>;

    close(): void;

    /** Send a request to the server peer and await the response. */
    request(method: string, data?: unknown): Promise<unknown>;

    /** Send a one-way notification to the server peer. */
    notify(method: string, data?: unknown): Promise<void>;

    on(event: "open", listener: () => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "disconnected", listener: () => void): this;
    on(event: "failed", listener: (currentAttempt: number) => void): this;
    on(
      event: "notification",
      listener: (notification: ProtooNotification) => void,
    ): this;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    off(event: string, listener: (...args: any[]) => void): this;
  }

  const version: string;
}
