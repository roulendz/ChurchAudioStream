/**
 * Per-channel event logger with JSONL disk persistence.
 *
 * Logs channel lifecycle events (start, stop, crash, restart, etc.) to
 * individual JSONL files per channel. Events are append-only on disk and
 * cached in memory for fast access. Automatic 30-day retention cleanup
 * runs on startup and every 24 hours.
 *
 * JSONL format (one JSON object per line) is chosen for:
 * - Cheap append-only writes (no file rewrite for each event)
 * - Line-by-line parsing (tolerant of partial writes from crashes)
 * - Easy human inspection with standard tools
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "../../utils/logger.js";
import { scheduleDebounced, clearDebounceTimer, clearAllDebounceTimers } from "../../utils/debounce.js";

/** Types of events that can occur on a channel. */
export type ChannelEventType =
  | "start"
  | "stop"
  | "crash"
  | "restart"
  | "source-change"
  | "error"
  | "warning"
  | "info";

/** A single event associated with a channel. */
export interface ChannelEvent {
  readonly channelId: string;
  readonly timestamp: number;
  readonly type: ChannelEventType;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/** Map from event type to logger severity. */
const EVENT_TYPE_LOG_LEVEL: Record<
  ChannelEventType,
  "info" | "warn" | "error"
> = {
  start: "info",
  stop: "info",
  crash: "error",
  restart: "warn",
  "source-change": "info",
  error: "error",
  warning: "warn",
  info: "info",
};

/** Maximum events retained in memory per channel. */
const DEFAULT_MAX_EVENTS_IN_MEMORY = 1000;

/** Default retention period in days. */
const DEFAULT_RETENTION_DAYS = 30;

/** Debounce interval for flushing events to disk (ms). */
const FLUSH_DEBOUNCE_MS = 500;

/** Retention cleanup interval (24 hours in ms). */
const RETENTION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Per-channel event logger with JSONL disk persistence and automatic retention.
 *
 * Events are written to `{logDirectory}/{channelId}.jsonl` files.
 * Debounced writes prevent excessive disk I/O under rapid event bursts.
 * In-memory cache provides fast access for recent events.
 */
export class EventLogger {
  private readonly logDirectory: string;
  private readonly events = new Map<string, ChannelEvent[]>();
  private readonly maxEventsInMemory: number;
  private readonly retentionDays: number;

  /** Pending events not yet flushed to disk, keyed by channelId. */
  private readonly pendingFlush = new Map<string, ChannelEvent[]>();
  /** Per-channel debounce timers for disk writes. */
  private readonly flushTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  /** Periodic retention cleanup timer. */
  private retentionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    basePath: string,
    retentionDays: number = DEFAULT_RETENTION_DAYS,
    maxEventsInMemory: number = DEFAULT_MAX_EVENTS_IN_MEMORY,
  ) {
    this.logDirectory = path.join(basePath, "logs", "channels");
    this.retentionDays = retentionDays;
    this.maxEventsInMemory = maxEventsInMemory;

    fs.mkdirSync(this.logDirectory, { recursive: true });
    this.loadAllChannels();
    this.runRetentionCleanup();

    this.retentionTimer = setInterval(() => {
      this.runRetentionCleanup();
    }, RETENTION_CLEANUP_INTERVAL_MS);

    logger.info("Event logger initialized", {
      logDirectory: this.logDirectory,
      retentionDays: this.retentionDays,
    });
  }

  /**
   * Log a channel event. Adds to in-memory cache, schedules debounced
   * disk flush, and forwards to the structured logger.
   */
  log(event: ChannelEvent): void {
    const channelEvents = this.getOrCreateChannelEvents(event.channelId);
    channelEvents.push(event);

    // Trim oldest events if over memory limit
    if (channelEvents.length > this.maxEventsInMemory) {
      const excess = channelEvents.length - this.maxEventsInMemory;
      channelEvents.splice(0, excess);
    }

    // Queue for disk flush
    const pending = this.pendingFlush.get(event.channelId) ?? [];
    pending.push(event);
    this.pendingFlush.set(event.channelId, pending);

    this.scheduleDebouncedFlush(event.channelId);

    // Forward to structured logger
    const logLevel = EVENT_TYPE_LOG_LEVEL[event.type];
    logger[logLevel](`Channel event: ${event.message}`, {
      channelId: event.channelId,
      eventType: event.type,
      ...(event.details ?? {}),
    });
  }

  /**
   * Get events for a channel, most recent first.
   * Optionally limit the number of returned events.
   */
  getEvents(channelId: string, limit?: number): ChannelEvent[] {
    const channelEvents = this.events.get(channelId);
    if (!channelEvents || channelEvents.length === 0) {
      return [];
    }

    // Return most recent first (stored oldest-first, so reverse a copy)
    const reversed = [...channelEvents].reverse();
    return limit !== undefined ? reversed.slice(0, limit) : reversed;
  }

  /** Get events for a channel that are newer than the given timestamp. */
  getRecentEvents(channelId: string, sinceMs: number): ChannelEvent[] {
    const channelEvents = this.events.get(channelId);
    if (!channelEvents) {
      return [];
    }

    return channelEvents
      .filter((event) => event.timestamp > sinceMs)
      .reverse();
  }

  /** Remove all events for a channel from memory and disk. */
  clearChannel(channelId: string): void {
    this.events.delete(channelId);
    this.pendingFlush.delete(channelId);
    clearDebounceTimer(this.flushTimers, channelId);

    const filePath = this.channelFilePath(channelId);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      logger.warn("Failed to delete channel log file", {
        channelId,
        error: String(err),
      });
    }

    logger.info("Cleared channel event log", { channelId });
  }

  /** Flush all pending events to disk and clear timers. */
  stop(): void {
    // Flush all pending immediately
    for (const channelId of this.pendingFlush.keys()) {
      this.flushToDisk(channelId);
    }

    // Clear all debounce timers
    clearAllDebounceTimers(this.flushTimers);

    // Clear retention timer
    if (this.retentionTimer !== null) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }

    logger.info("Event logger stopped");
  }

  // ---------------------------------------------------------------------------
  // Private: Disk persistence
  // ---------------------------------------------------------------------------

  /** Build the JSONL file path for a channel. */
  private channelFilePath(channelId: string): string {
    return path.join(this.logDirectory, `${channelId}.jsonl`);
  }

  /** Schedule a debounced flush for a channel (500ms delay). */
  private scheduleDebouncedFlush(channelId: string): void {
    scheduleDebounced(this.flushTimers, channelId, FLUSH_DEBOUNCE_MS, () => {
      this.flushToDisk(channelId);
    });
  }

  /** Append pending events to the channel's JSONL file. */
  private flushToDisk(channelId: string): void {
    const pending = this.pendingFlush.get(channelId);
    if (!pending || pending.length === 0) {
      return;
    }

    this.pendingFlush.delete(channelId);

    const lines = pending.map((event) => JSON.stringify(event)).join("\n");
    const filePath = this.channelFilePath(channelId);

    try {
      fs.appendFileSync(filePath, lines + "\n", "utf-8");
    } catch (err) {
      logger.error("Failed to flush events to disk", {
        channelId,
        eventCount: pending.length,
        error: String(err),
      });
    }
  }

  /** Load existing JSONL logs from disk for all channel files. */
  private loadAllChannels(): void {
    let files: string[];
    try {
      files = fs.readdirSync(this.logDirectory);
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) {
        continue;
      }

      const channelId = file.replace(/\.jsonl$/, "");
      this.loadFromDisk(channelId);
    }
  }

  /** Load a single channel's events from its JSONL file. */
  private loadFromDisk(channelId: string): void {
    const filePath = this.channelFilePath(channelId);

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      return;
    }

    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    const loaded: ChannelEvent[] = [];
    let malformedCount = 0;

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as ChannelEvent;
        loaded.push(event);
      } catch {
        malformedCount++;
      }
    }

    if (malformedCount > 0) {
      logger.warn("Skipped malformed lines in channel log", {
        channelId,
        malformedCount,
      });
    }

    // Keep only the most recent maxEventsInMemory entries
    const trimmed =
      loaded.length > this.maxEventsInMemory
        ? loaded.slice(loaded.length - this.maxEventsInMemory)
        : loaded;

    if (trimmed.length > 0) {
      this.events.set(channelId, trimmed);
      logger.info("Loaded channel events from disk", {
        channelId,
        eventCount: trimmed.length,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Retention cleanup
  // ---------------------------------------------------------------------------

  /** Remove events older than retentionDays from all channel logs. */
  private runRetentionCleanup(): void {
    const cutoffMs = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;

    let files: string[];
    try {
      files = fs.readdirSync(this.logDirectory);
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) {
        continue;
      }

      const channelId = file.replace(/\.jsonl$/, "");
      this.cleanupChannelRetention(channelId, cutoffMs);
    }
  }

  /** Clean up old events for a single channel, rewriting its JSONL file. */
  private cleanupChannelRetention(
    channelId: string,
    cutoffMs: number,
  ): void {
    const filePath = this.channelFilePath(channelId);

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      return;
    }

    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    const retained: string[] = [];
    const retainedEvents: ChannelEvent[] = [];

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as ChannelEvent;
        if (event.timestamp >= cutoffMs) {
          retained.push(line);
          retainedEvents.push(event);
        }
      } catch {
        // Discard malformed lines during cleanup
      }
    }

    const removedCount = lines.length - retained.length;
    if (removedCount === 0) {
      return;
    }

    // Rewrite file with retained events only
    try {
      if (retained.length === 0) {
        fs.unlinkSync(filePath);
      } else {
        fs.writeFileSync(filePath, retained.join("\n") + "\n", "utf-8");
      }
    } catch (err) {
      logger.error("Failed to rewrite channel log during retention cleanup", {
        channelId,
        error: String(err),
      });
      return;
    }

    // Update in-memory cache
    const trimmed =
      retainedEvents.length > this.maxEventsInMemory
        ? retainedEvents.slice(
            retainedEvents.length - this.maxEventsInMemory,
          )
        : retainedEvents;

    if (trimmed.length > 0) {
      this.events.set(channelId, trimmed);
    } else {
      this.events.delete(channelId);
    }

    logger.info("Retention cleanup removed old events", {
      channelId,
      removedCount,
      retainedCount: retained.length,
    });
  }

  /** Get or create the in-memory event array for a channel. */
  private getOrCreateChannelEvents(channelId: string): ChannelEvent[] {
    let channelEvents = this.events.get(channelId);
    if (!channelEvents) {
      channelEvents = [];
      this.events.set(channelId, channelEvents);
    }
    return channelEvents;
  }
}
