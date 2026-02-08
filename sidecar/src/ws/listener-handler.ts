/**
 * protoo WebSocket server for listener connections on /ws/listener path.
 *
 * Handles WebSocket upgrade requests from phone browsers, applies per-IP
 * rate limiting, and delegates peer lifecycle to SignalingHandler. Heartbeat
 * zombie detection runs on a configurable interval.
 *
 * Path routing note: protoo-server hooks into the HTTP "upgrade" event.
 * Since the admin WebSocket also uses "upgrade", path-based routing is
 * handled in the connectionrequest handler by checking request.url. Full
 * server.ts integration (mounting alongside admin WS) is in Plan 04-05.
 */

import type { Server as HttpsServer } from "node:https";
import * as protooServer from "protoo-server";
import type { SignalingHandler } from "../streaming/signaling-handler.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** WebSocket path for listener connections. */
const LISTENER_WS_PATH = "/ws/listener";

// ---------------------------------------------------------------------------
// SlidingWindowRateLimiter (private helper -- SRP)
// ---------------------------------------------------------------------------

/**
 * Tracks connection attempts per IP within a sliding time window.
 * Rejects connections that exceed the configured limit.
 */
class SlidingWindowRateLimiter {
  private readonly maxAttemptsPerWindow: number;
  private readonly windowMs: number;
  private readonly attemptsByIp: Map<string, number[]> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(maxAttemptsPerWindow: number, windowMs: number) {
    this.maxAttemptsPerWindow = maxAttemptsPerWindow;
    this.windowMs = windowMs;

    // Periodically clean up stale IP entries to prevent memory growth
    this.cleanupInterval = setInterval(() => {
      this.purgeExpiredEntries();
    }, windowMs * 2);
  }

  /**
   * Check if a connection attempt from the given IP should be allowed.
   * If allowed, records the attempt and returns true.
   * If rate-limited, returns false without recording.
   */
  allowConnection(ipAddress: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let attempts = this.attemptsByIp.get(ipAddress);
    if (!attempts) {
      attempts = [];
      this.attemptsByIp.set(ipAddress, attempts);
    }

    // Remove attempts outside the sliding window
    const recentAttempts = attempts.filter(
      (timestamp) => timestamp > windowStart,
    );
    this.attemptsByIp.set(ipAddress, recentAttempts);

    if (recentAttempts.length >= this.maxAttemptsPerWindow) {
      return false;
    }

    recentAttempts.push(now);
    return true;
  }

  /** Remove IP entries with no recent attempts. */
  private purgeExpiredEntries(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [ip, attempts] of this.attemptsByIp) {
      const recent = attempts.filter((ts) => ts > windowStart);
      if (recent.length === 0) {
        this.attemptsByIp.delete(ip);
      } else {
        this.attemptsByIp.set(ip, recent);
      }
    }
  }

  /** Stop the cleanup interval. */
  stop(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.attemptsByIp.clear();
  }
}

// ---------------------------------------------------------------------------
// ListenerWebSocketHandler
// ---------------------------------------------------------------------------

interface ListenerHandlerConfig {
  readonly rateLimitPerIp: number;
  readonly rateLimitWindowMs: number;
  readonly heartbeatIntervalMs: number;
}

export class ListenerWebSocketHandler {
  private readonly signalingHandler: SignalingHandler;
  private readonly protooWsServer: protooServer.WebSocketServer;
  private readonly protooRoom: protooServer.Room;
  private readonly rateLimiter: SlidingWindowRateLimiter;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private peerCounter = 0;

  /**
   * @param httpsServer       The HTTPS server to attach the protoo WebSocket server to
   * @param signalingHandler  Handles peer request/notification lifecycle
   * @param config            Rate limit and heartbeat configuration from streaming config
   */
  constructor(
    httpsServer: HttpsServer,
    signalingHandler: SignalingHandler,
    config: ListenerHandlerConfig,
  ) {
    this.signalingHandler = signalingHandler;

    this.rateLimiter = new SlidingWindowRateLimiter(
      config.rateLimitPerIp,
      config.rateLimitWindowMs,
    );

    // Create protoo Room for managing peers
    this.protooRoom = new protooServer.Room();

    // Create protoo WebSocketServer (wraps ws internally)
    this.protooWsServer = new protooServer.WebSocketServer(httpsServer);

    // Handle incoming connection requests
    this.protooWsServer.on(
      "connectionrequest",
      (
        info: protooServer.ConnectionRequestInfo,
        accept: () => protooServer.WebSocketTransport,
        reject: (code?: number, reason?: string) => void,
      ) => {
        this.handleConnectionRequest(info, accept, reject);
      },
    );

    // Start heartbeat zombie detection
    this.startHeartbeat(config.heartbeatIntervalMs);

    logger.info("Listener WebSocket handler initialized", {
      path: LISTENER_WS_PATH,
      rateLimitPerIp: config.rateLimitPerIp,
      rateLimitWindowMs: config.rateLimitWindowMs,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
    });
  }

  // -----------------------------------------------------------------------
  // Connection handling
  // -----------------------------------------------------------------------

  private handleConnectionRequest(
    info: protooServer.ConnectionRequestInfo,
    accept: () => protooServer.WebSocketTransport,
    reject: (code?: number, reason?: string) => void,
  ): void {
    // Validate path -- only accept /ws/listener connections
    const requestUrl = info.request.url ?? "";
    if (!requestUrl.startsWith(LISTENER_WS_PATH)) {
      // Not for us -- reject so other upgrade handlers can process
      reject(404, "Not found");
      return;
    }

    // Extract client IP for rate limiting
    const clientIp = this.extractClientIp(info);

    // Apply rate limiting
    if (!this.rateLimiter.allowConnection(clientIp)) {
      logger.warn("Listener connection rate-limited", { clientIp });
      reject(429, "Too many connections");
      return;
    }

    // Accept the WebSocket connection
    const transport = accept();

    // Create a unique peer ID
    this.peerCounter++;
    const peerId = `listener-${this.peerCounter}-${Date.now()}`;

    // Create peer in the protoo Room
    try {
      const peer = this.protooRoom.createPeer(peerId, transport);

      // Delegate to SignalingHandler for request/notification handling
      this.signalingHandler.handlePeer(peer);

      logger.info("Listener WebSocket connection accepted", {
        peerId,
        clientIp,
      });
    } catch (error) {
      logger.error("Failed to create protoo peer", {
        peerId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Transport was already accepted; it will be cleaned up by protoo
    }
  }

  // -----------------------------------------------------------------------
  // Heartbeat zombie detection
  // -----------------------------------------------------------------------

  private startHeartbeat(intervalMs: number): void {
    this.heartbeatInterval = setInterval(() => {
      const zombieCount = this.signalingHandler.closeZombiePeers();
      if (zombieCount > 0) {
        logger.info("Heartbeat: closed zombie listener peers", {
          count: zombieCount,
        });
      }
    }, intervalMs);

    logger.info("Listener heartbeat started", { intervalMs });
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Close all listener connections and stop the WebSocket server.
   */
  close(): void {
    // Stop heartbeat
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Stop rate limiter cleanup
    this.rateLimiter.stop();

    // Close protoo room (disconnects all peers)
    this.protooRoom.close();

    // Stop protoo WebSocket server
    this.protooWsServer.stop();

    logger.info("Listener WebSocket handler closed");
  }

  // -----------------------------------------------------------------------
  // Utilities
  // -----------------------------------------------------------------------

  /**
   * Extract the client IP from the connection request.
   * Uses x-forwarded-for header if present (reverse proxy), otherwise
   * falls back to the socket remote address.
   */
  private extractClientIp(info: protooServer.ConnectionRequestInfo): string {
    const forwardedFor = info.request.headers["x-forwarded-for"];
    if (typeof forwardedFor === "string") {
      // x-forwarded-for can be comma-separated; take the first (client) IP
      return forwardedFor.split(",")[0].trim();
    }

    return info.socket.remoteAddress ?? "unknown";
  }
}
