import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { DiscoveredSource, SourceStatus } from "./source-types.js";
import { logger } from "../../utils/logger.js";
import { scheduleDebounced } from "../../utils/debounce.js";
import { toErrorMessage } from "../../utils/error-message.js";

/** Debounce delay for persisting sources to disk. */
const PERSIST_DEBOUNCE_MS = 2_000;

/** Minimum fields required for a valid cached source entry. */
const REQUIRED_SOURCE_FIELDS = ["id", "type", "name", "status"] as const;

/**
 * Unified in-memory store for all discovered audio sources (AES67 + local devices).
 *
 * Maintains a Map keyed by deterministic source IDs:
 * - AES67: "aes67:{originAddress}:{originSessionId}"
 * - Local: "local:{api}:{deviceId}"
 *
 * Sources persist to a JSON cache file with debounced writes so they survive
 * restarts. On load, all cached sources are marked "verifying" until live
 * discovery confirms them.
 *
 * Events:
 * - "source-added"    (source: DiscoveredSource)
 * - "source-updated"  (source: DiscoveredSource)
 * - "source-removed"  (sourceId: string)
 * - "sources-changed" ()
 */
export class SourceRegistry extends EventEmitter {
  private sources = new Map<string, DiscoveredSource>();
  private readonly cacheFilePath: string;
  private readonly persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(basePath: string) {
    super();
    this.cacheFilePath = path.join(basePath, "discovered-sources.json");
    this.loadFromDisk();
  }

  // -- Public API -----------------------------------------------------------

  /**
   * Add a new source or update an existing one.
   *
   * If the source ID already exists, relevant fields are compared and
   * "source-updated" is emitted only when something changed. The
   * `lastSeenAt` timestamp is always refreshed.
   *
   * If the source ID is new, it is added and "source-added" is emitted.
   */
  addOrUpdate(source: DiscoveredSource): void {
    const existing = this.sources.get(source.id);

    if (existing) {
      const changed = hasSourceChanged(existing, source);
      // Always refresh lastSeenAt
      existing.lastSeenAt = source.lastSeenAt;

      if (changed) {
        // Replace the entry with the incoming data (preserves mutable fields)
        this.sources.set(source.id, { ...source });
        this.emit("source-updated", this.sources.get(source.id)!);
      }
    } else {
      this.sources.set(source.id, { ...source });
      this.emit("source-added", this.sources.get(source.id)!);
    }

    this.emit("sources-changed");
    this.schedulePersist();
  }

  /** Update the status of an existing source. */
  updateStatus(sourceId: string, status: SourceStatus): void {
    const source = this.sources.get(sourceId);
    if (!source) return;

    if (source.status === status) return;

    source.status = status;
    this.emit("source-updated", source);
    this.emit("sources-changed");
    this.schedulePersist();
  }

  /**
   * Mark a source as unavailable (e.g., device unplugged, stream went offline).
   * The source is NOT removed -- it stays in the registry grayed-out so the
   * admin sees it and hot-plug recovery can re-activate it.
   */
  markUnavailable(sourceId: string): void {
    this.updateStatus(sourceId, "unavailable");
  }

  /**
   * Permanently remove a source from the registry.
   * Only for explicit removal (e.g., SAP deletion packet).
   * For temporary loss of connectivity, use markUnavailable() instead.
   */
  remove(sourceId: string): void {
    if (!this.sources.has(sourceId)) return;

    this.sources.delete(sourceId);
    this.emit("source-removed", sourceId);
    this.emit("sources-changed");
    this.schedulePersist();
  }

  /** Return all sources, sorted by type (aes67 first) then by name. */
  getAll(): DiscoveredSource[] {
    return Array.from(this.sources.values()).sort(compareSourcesByTypeAndName);
  }

  /** Lookup a single source by its deterministic ID. */
  getById(sourceId: string): DiscoveredSource | undefined {
    return this.sources.get(sourceId);
  }

  /** Return all sources of a given type. */
  getByType(type: "aes67" | "local"): DiscoveredSource[] {
    return Array.from(this.sources.values()).filter((s) => s.type === type);
  }

  /** Return sources that are available for use (status "available" or "in-use"). */
  getAvailable(): DiscoveredSource[] {
    return Array.from(this.sources.values()).filter(
      (s) => s.status === "available" || s.status === "in-use",
    );
  }

  // -- Persistence ----------------------------------------------------------

  /** Load cached sources from disk. All loaded sources are set to "verifying". */
  private loadFromDisk(): void {
    if (!fs.existsSync(this.cacheFilePath)) {
      logger.debug("No source cache file found, starting with empty registry", {
        path: this.cacheFilePath,
      });
      return;
    }

    try {
      const raw = fs.readFileSync(this.cacheFilePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        logger.warn("Source cache file has invalid format (expected array), starting empty", {
          path: this.cacheFilePath,
        });
        return;
      }

      let loadedCount = 0;
      for (const entry of parsed) {
        if (!isValidSourceEntry(entry)) continue;

        const source = entry as DiscoveredSource;
        // Mark all cached sources as "verifying" -- live discovery will confirm them
        source.status = "verifying";
        this.sources.set(source.id, source);
        loadedCount++;
      }

      logger.info("Loaded cached audio sources", {
        count: loadedCount,
        path: this.cacheFilePath,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      logger.warn("Failed to load source cache, starting with empty registry", {
        error: message,
        path: this.cacheFilePath,
      });
    }
  }

  /**
   * Schedule a debounced write of the sources map to disk.
   * Prevents excessive I/O during rapid discovery bursts.
   */
  private schedulePersist(): void {
    scheduleDebounced(this.persistTimers, "persist", PERSIST_DEBOUNCE_MS, () => {
      this.writeToDisk();
    });
  }

  /** Serialize the sources map to JSON and write to the cache file. */
  private writeToDisk(): void {
    try {
      const sourcesArray = Array.from(this.sources.values());
      const json = JSON.stringify(sourcesArray, null, 2);

      // Ensure the directory exists
      const dirPath = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      fs.writeFileSync(this.cacheFilePath, json, "utf-8");
      logger.debug("Persisted audio sources to disk", {
        count: sourcesArray.length,
        path: this.cacheFilePath,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      logger.error("Failed to persist audio sources to disk", {
        error: message,
        path: this.cacheFilePath,
      });
    }
  }
}

// -- Helpers ----------------------------------------------------------------

/** Sort comparator: AES67 before local, then alphabetical by name. */
function compareSourcesByTypeAndName(a: DiscoveredSource, b: DiscoveredSource): number {
  if (a.type !== b.type) {
    return a.type === "aes67" ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

/** Check whether a cached entry has the minimum required fields. */
function isValidSourceEntry(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const obj = entry as Record<string, unknown>;

  for (const field of REQUIRED_SOURCE_FIELDS) {
    if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
      return false;
    }
  }

  // Validate type discriminator
  return obj["type"] === "aes67" || obj["type"] === "local";
}

/**
 * Compare two sources to detect meaningful changes (ignoring lastSeenAt and status).
 * Returns true if any field other than lastSeenAt/status differs.
 */
function hasSourceChanged(existing: DiscoveredSource, incoming: DiscoveredSource): boolean {
  if (existing.type !== incoming.type) return true;
  if (existing.name !== incoming.name) return true;

  if (existing.type === "aes67" && incoming.type === "aes67") {
    return (
      existing.multicastAddress !== incoming.multicastAddress ||
      existing.port !== incoming.port ||
      existing.sampleRate !== incoming.sampleRate ||
      existing.bitDepth !== incoming.bitDepth ||
      existing.channelCount !== incoming.channelCount ||
      existing.payloadType !== incoming.payloadType ||
      existing.description !== incoming.description
    );
  }

  if (existing.type === "local" && incoming.type === "local") {
    return (
      existing.sampleRate !== incoming.sampleRate ||
      existing.bitDepth !== incoming.bitDepth ||
      existing.channelCount !== incoming.channelCount ||
      existing.isLoopback !== incoming.isLoopback
    );
  }

  return false;
}
