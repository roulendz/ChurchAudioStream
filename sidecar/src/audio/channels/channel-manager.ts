/**
 * Channel manager -- central orchestrator for app channel lifecycle.
 *
 * Manages the full lifecycle of app channels: creation, source assignment,
 * pipeline orchestration, and config persistence. Each source assignment
 * spawns an independent GStreamer pipeline via PipelineManager.
 *
 * Coordinates PipelineManager, SourceRegistry, LevelMonitor, ResourceMonitor,
 * EventLogger, and ConfigStore into a cohesive channel control plane.
 *
 * Events:
 * - "channel-created"       (channel: AppChannel)
 * - "channel-updated"       (channel: AppChannel)
 * - "channel-removed"       (channelId: string)
 * - "channel-state-changed" (channelId: string, status: ChannelStatus)
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  AppChannel,
  SourceAssignment,
  ChannelStatus,
  ChannelOutputFormat,
} from "./channel-types.js";
import type { PipelineManager } from "../pipeline/pipeline-manager.js";
import type { PipelineConfig, PipelineState, AudioLevels, PipelineError } from "../pipeline/pipeline-types.js";
import type { SourceRegistry } from "../sources/source-registry.js";
import type { AES67Source, LocalDeviceSource, DiscoveredSource } from "../sources/source-types.js";
import type { LevelMonitor } from "../monitor/level-monitor.js";
import type { ResourceMonitor } from "../monitor/resource-monitor.js";
import type { EventLogger, ChannelEventType } from "../monitor/event-logger.js";
import type { ConfigStore } from "../../config/store.js";
import type { AppConfig } from "../../config/schema.js";
import { logger } from "../../utils/logger.js";

/** Subset of AppChannel fields that can be updated after creation. */
export type ChannelUpdatableFields = Partial<
  Pick<AppChannel, "name" | "outputFormat" | "autoStart">
>;

/** Subset of SourceAssignment fields that can be updated after assignment. */
export type SourceUpdatableFields = Partial<
  Pick<SourceAssignment, "gain" | "muted" | "delayMs" | "selectedChannels">
>;

export interface ChannelManagerEvents {
  "channel-created": (channel: AppChannel) => void;
  "channel-updated": (channel: AppChannel) => void;
  "channel-removed": (channelId: string) => void;
  "channel-state-changed": (channelId: string, status: ChannelStatus) => void;
}

/**
 * Central orchestrator for app channel lifecycle and source-to-pipeline mapping.
 *
 * Each source assignment within a channel maps to exactly one GStreamer pipeline.
 * Phase 2 does not mix multiple sources -- each pipeline runs independently.
 * Source switching uses instant cut (stop old pipeline, start new).
 */
export class ChannelManager extends EventEmitter {
  private readonly channels = new Map<string, AppChannel>();

  /**
   * Maps channelId -> Map<sourceIndex (as string), pipelineId>.
   * Source index is stringified because Map keys use identity comparison.
   */
  private readonly channelPipelines = new Map<string, Map<string, string>>();

  private readonly pipelineManager: PipelineManager;
  private readonly sourceRegistry: SourceRegistry;
  private readonly levelMonitor: LevelMonitor;
  private readonly resourceMonitor: ResourceMonitor;
  private readonly eventLogger: EventLogger;
  private readonly configStore: ConfigStore;

  constructor(
    pipelineManager: PipelineManager,
    sourceRegistry: SourceRegistry,
    levelMonitor: LevelMonitor,
    resourceMonitor: ResourceMonitor,
    eventLogger: EventLogger,
    configStore: ConfigStore,
  ) {
    super();
    this.pipelineManager = pipelineManager;
    this.sourceRegistry = sourceRegistry;
    this.levelMonitor = levelMonitor;
    this.resourceMonitor = resourceMonitor;
    this.eventLogger = eventLogger;
    this.configStore = configStore;

    this.wirePipelineEvents();
    this.loadChannelsFromConfig();
  }

  // ---------------------------------------------------------------------------
  // Channel CRUD
  // ---------------------------------------------------------------------------

  /**
   * Create a new app channel with default settings.
   *
   * The channel starts with no source assignments and status "stopped".
   * AutoStart defaults to true so the channel starts on next app launch.
   */
  createChannel(
    name: string,
    outputFormat: ChannelOutputFormat = "mono",
  ): AppChannel {
    const channel: AppChannel = {
      id: randomUUID(),
      name,
      sources: [],
      outputFormat,
      autoStart: true,
      status: "stopped",
      createdAt: Date.now(),
    };

    this.channels.set(channel.id, channel);
    this.channelPipelines.set(channel.id, new Map());
    this.persistChannels();

    this.logChannelEvent(channel.id, "info", `Channel created: "${name}"`);
    this.emit("channel-created", channel);

    logger.info(`Channel created: "${name}"`, { channelId: channel.id });
    return channel;
  }

  /**
   * Remove a channel and stop all its pipelines.
   *
   * Event logs are preserved for admin review (not cleared on removal).
   */
  async removeChannel(channelId: string): Promise<void> {
    const channel = this.getChannelOrThrow(channelId);

    await this.stopChannel(channelId);

    this.channels.delete(channelId);
    this.channelPipelines.delete(channelId);
    this.persistChannels();

    this.emit("channel-removed", channelId);
    logger.info(`Channel removed: "${channel.name}"`, { channelId });
  }

  /**
   * Update mutable channel properties (name, outputFormat, autoStart).
   *
   * Does not affect running pipelines -- format changes take effect on next start.
   */
  updateChannel(channelId: string, updates: ChannelUpdatableFields): AppChannel {
    const channel = this.getChannelOrThrow(channelId);

    if (updates.name !== undefined) {
      channel.name = updates.name;
    }
    if (updates.outputFormat !== undefined) {
      channel.outputFormat = updates.outputFormat;
    }
    if (updates.autoStart !== undefined) {
      channel.autoStart = updates.autoStart;
    }

    this.persistChannels();
    this.emit("channel-updated", channel);

    logger.info(`Channel updated: "${channel.name}"`, { channelId });
    return channel;
  }

  // ---------------------------------------------------------------------------
  // Source Assignment
  // ---------------------------------------------------------------------------

  /**
   * Add a source assignment to a channel.
   *
   * Validates the source exists in the registry and that selected channels
   * are within the source's channel count. If the channel is currently
   * streaming, hot-adds a new pipeline for the assignment.
   */
  async addSource(channelId: string, assignment: SourceAssignment): Promise<AppChannel> {
    const channel = this.getChannelOrThrow(channelId);

    const source = this.sourceRegistry.getById(assignment.sourceId);
    if (!source) {
      throw new Error(`Source not found: ${assignment.sourceId}`);
    }

    this.validateSelectedChannels(source, assignment.selectedChannels);

    channel.sources.push({ ...assignment });

    // Hot-add: if channel is streaming, start a pipeline for the new source
    if (channel.status === "streaming" || channel.status === "starting") {
      const sourceIndex = channel.sources.length - 1;
      await this.startPipelineForSource(channelId, sourceIndex, assignment);
    }

    this.persistChannels();
    this.logChannelEvent(
      channelId,
      "source-change",
      `Source added: "${source.name}"`,
      { sourceId: assignment.sourceId },
    );
    this.emit("channel-updated", channel);

    return channel;
  }

  /**
   * Remove a source assignment from a channel by index.
   *
   * Stops the corresponding pipeline if one is running.
   */
  async removeSource(channelId: string, sourceIndex: number): Promise<AppChannel> {
    const channel = this.getChannelOrThrow(channelId);

    if (sourceIndex < 0 || sourceIndex >= channel.sources.length) {
      throw new Error(
        `Source index ${sourceIndex} out of bounds (channel has ${channel.sources.length} sources)`,
      );
    }

    // Stop pipeline for this source if running
    await this.stopPipelineForSource(channelId, sourceIndex);

    // Remove the source assignment
    channel.sources.splice(sourceIndex, 1);

    // Re-key pipeline mappings after splice (indices shifted)
    this.rekeyPipelineMappings(channelId, sourceIndex);

    this.persistChannels();
    this.logChannelEvent(channelId, "source-change", "Source removed", {
      removedIndex: sourceIndex,
    });
    this.emit("channel-updated", channel);

    // Re-aggregate status after source removal
    this.updateChannelStatus(channelId);

    return channel;
  }

  /**
   * Update a source assignment's properties (gain, mute, delay, selectedChannels).
   *
   * If selectedChannels changed and the pipeline is running, it is restarted
   * via instant cut (stop old, start new). Gain/mute/delay are persisted
   * but not applied to running pipelines until Phase 3 (mixing).
   */
  async updateSource(
    channelId: string,
    sourceIndex: number,
    updates: SourceUpdatableFields,
  ): Promise<AppChannel> {
    const channel = this.getChannelOrThrow(channelId);

    if (sourceIndex < 0 || sourceIndex >= channel.sources.length) {
      throw new Error(
        `Source index ${sourceIndex} out of bounds (channel has ${channel.sources.length} sources)`,
      );
    }

    const assignment = channel.sources[sourceIndex];
    const selectedChannelsChanged =
      updates.selectedChannels !== undefined &&
      !arraysEqual(updates.selectedChannels, assignment.selectedChannels);

    // Apply updates to assignment
    if (updates.gain !== undefined) {
      (assignment as { gain: number }).gain = updates.gain;
    }
    if (updates.muted !== undefined) {
      (assignment as { muted: boolean }).muted = updates.muted;
    }
    if (updates.delayMs !== undefined) {
      (assignment as { delayMs: number }).delayMs = updates.delayMs;
    }
    if (updates.selectedChannels !== undefined) {
      // selectedChannels is readonly on the interface -- use object spread to replace
      channel.sources[sourceIndex] = {
        ...assignment,
        selectedChannels: updates.selectedChannels,
      };
    }

    // Instant cut: restart pipeline if selectedChannels changed while running
    if (selectedChannelsChanged) {
      const pipelineMap = this.channelPipelines.get(channelId);
      const existingPipelineId = pipelineMap?.get(String(sourceIndex));

      if (existingPipelineId) {
        await this.stopAndRemovePipeline(channelId, sourceIndex, existingPipelineId);
        await this.startPipelineForSource(
          channelId,
          sourceIndex,
          channel.sources[sourceIndex],
        );
      }
    }

    this.persistChannels();
    this.emit("channel-updated", channel);

    return channel;
  }

  // ---------------------------------------------------------------------------
  // Pipeline Orchestration
  // ---------------------------------------------------------------------------

  /**
   * Start all pipelines for a channel's source assignments.
   *
   * Sources that no longer exist in the registry (stale config) are logged
   * and skipped rather than causing a failure.
   */
  async startChannel(channelId: string): Promise<void> {
    const channel = this.getChannelOrThrow(channelId);

    if (channel.sources.length === 0) {
      logger.warn(`Channel "${channel.name}" has no sources, nothing to start`, {
        channelId,
      });
      return;
    }

    this.setChannelStatus(channelId, "starting");
    this.logChannelEvent(
      channelId,
      "start",
      `Channel starting with ${channel.sources.length} source(s)`,
    );

    let startedCount = 0;

    for (let i = 0; i < channel.sources.length; i++) {
      const assignment = channel.sources[i];
      const source = this.sourceRegistry.getById(assignment.sourceId);

      if (!source) {
        logger.warn(
          `Skipping stale source "${assignment.sourceId}" in channel "${channel.name}"`,
          { channelId, sourceIndex: i },
        );
        this.logChannelEvent(channelId, "warning", `Stale source skipped: ${assignment.sourceId}`, {
          sourceIndex: i,
        });
        continue;
      }

      try {
        await this.startPipelineForSource(channelId, i, assignment);
        startedCount++;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error(
          `Failed to start pipeline for source "${source.name}" in channel "${channel.name}"`,
          { channelId, sourceIndex: i, error: errorMessage },
        );
        this.logChannelEvent(channelId, "error", `Failed to start source: "${source.name}"`, {
          sourceIndex: i,
          error: errorMessage,
        });
      }
    }

    logger.info(
      `Channel "${channel.name}" started ${startedCount}/${channel.sources.length} pipeline(s)`,
      { channelId },
    );
  }

  /**
   * Stop all pipelines for a channel.
   *
   * Unregisters from resource monitor and clears level data for each pipeline.
   */
  async stopChannel(channelId: string): Promise<void> {
    const pipelineMap = this.channelPipelines.get(channelId);
    if (!pipelineMap || pipelineMap.size === 0) {
      const channel = this.channels.get(channelId);
      if (channel) {
        this.setChannelStatus(channelId, "stopped");
      }
      return;
    }

    const pipelineIds = Array.from(pipelineMap.values());

    await Promise.allSettled(
      pipelineIds.map(async (pipelineId) => {
        try {
          await this.pipelineManager.removePipeline(pipelineId);
        } catch (err) {
          logger.warn(`Failed to stop pipeline ${pipelineId}`, {
            channelId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        this.resourceMonitor.untrackPipeline(pipelineId);
        this.levelMonitor.clearPipeline(pipelineId);
      }),
    );

    pipelineMap.clear();
    this.setChannelStatus(channelId, "stopped");

    const channel = this.channels.get(channelId);
    const channelName = channel?.name ?? channelId;
    this.logChannelEvent(channelId, "stop", "Channel stopped");
    logger.info(`Channel "${channelName}" stopped`, { channelId });
  }

  /**
   * Auto-start all channels where autoStart is true.
   * Called from sidecar/src/index.ts on app launch.
   */
  async startAll(): Promise<void> {
    const autoStartChannels = Array.from(this.channels.values()).filter(
      (ch) => ch.autoStart,
    );

    if (autoStartChannels.length === 0) {
      logger.info("No channels configured for auto-start");
      return;
    }

    logger.info(`Auto-starting ${autoStartChannels.length} channel(s)`);

    for (const channel of autoStartChannels) {
      try {
        await this.startChannel(channel.id);
      } catch (err) {
        logger.error(`Failed to auto-start channel "${channel.name}"`, {
          channelId: channel.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info(`Auto-started ${autoStartChannels.length} channel(s)`);
  }

  /** Stop all channels. Called during graceful shutdown. */
  async stopAll(): Promise<void> {
    const channelIds = Array.from(this.channels.keys());

    await Promise.allSettled(
      channelIds.map((channelId) => this.stopChannel(channelId)),
    );

    logger.info(`All channels stopped (${channelIds.length} total)`);
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Get a channel by ID, or undefined if not found. */
  getChannel(channelId: string): AppChannel | undefined {
    return this.channels.get(channelId);
  }

  /** Get all channels as an array. */
  getAllChannels(): AppChannel[] {
    return Array.from(this.channels.values());
  }

  /** Get all pipeline IDs associated with a channel. */
  getChannelPipelineIds(channelId: string): string[] {
    const pipelineMap = this.channelPipelines.get(channelId);
    return pipelineMap ? Array.from(pipelineMap.values()) : [];
  }

  // ---------------------------------------------------------------------------
  // Private: Pipeline lifecycle helpers
  // ---------------------------------------------------------------------------

  /** Start a single pipeline for a source assignment within a channel. */
  private async startPipelineForSource(
    channelId: string,
    sourceIndex: number,
    assignment: SourceAssignment,
  ): Promise<void> {
    const pipelineConfig = this.buildPipelineConfigFromAssignment(
      channelId,
      assignment,
    );

    if (!pipelineConfig) {
      return;
    }

    const pipelineId = this.pipelineManager.createPipeline(pipelineConfig);
    this.pipelineManager.startPipeline(pipelineId);

    const pipelineMap = this.getOrCreatePipelineMap(channelId);
    pipelineMap.set(String(sourceIndex), pipelineId);
  }

  /** Stop and remove a single pipeline, cleaning up monitor state. */
  private async stopAndRemovePipeline(
    channelId: string,
    sourceIndex: number,
    pipelineId: string,
  ): Promise<void> {
    await this.pipelineManager.removePipeline(pipelineId);
    this.resourceMonitor.untrackPipeline(pipelineId);
    this.levelMonitor.clearPipeline(pipelineId);

    const pipelineMap = this.channelPipelines.get(channelId);
    pipelineMap?.delete(String(sourceIndex));
  }

  /** Stop the pipeline for a specific source index if one exists. */
  private async stopPipelineForSource(
    channelId: string,
    sourceIndex: number,
  ): Promise<void> {
    const pipelineMap = this.channelPipelines.get(channelId);
    const pipelineId = pipelineMap?.get(String(sourceIndex));

    if (pipelineId) {
      await this.stopAndRemovePipeline(channelId, sourceIndex, pipelineId);
    }
  }

  /**
   * Re-key pipeline mappings after a source is spliced out.
   *
   * When source at index N is removed, all sources at index > N shift down by 1.
   * Pipeline mappings must be updated to match the new indices.
   */
  private rekeyPipelineMappings(
    channelId: string,
    removedIndex: number,
  ): void {
    const pipelineMap = this.channelPipelines.get(channelId);
    if (!pipelineMap) return;

    const newMap = new Map<string, string>();

    for (const [indexStr, pipelineId] of pipelineMap) {
      const index = Number(indexStr);
      if (index < removedIndex) {
        newMap.set(indexStr, pipelineId);
      } else if (index > removedIndex) {
        newMap.set(String(index - 1), pipelineId);
      }
      // index === removedIndex is skipped (already stopped)
    }

    this.channelPipelines.set(channelId, newMap);
  }

  // ---------------------------------------------------------------------------
  // Private: Pipeline config construction
  // ---------------------------------------------------------------------------

  /**
   * Build a PipelineConfig from a source assignment and registry data.
   *
   * Returns null if the source is not found in the registry (stale config).
   */
  private buildPipelineConfigFromAssignment(
    channelId: string,
    assignment: SourceAssignment,
  ): PipelineConfig | null {
    const source = this.sourceRegistry.getById(assignment.sourceId);
    if (!source) {
      logger.warn(`Cannot build pipeline: source "${assignment.sourceId}" not found in registry`, {
        channelId,
      });
      return null;
    }

    const channel = this.channels.get(channelId);
    const channelName = channel?.name ?? "Unknown";
    const label = `${channelName} - ${source.name}`;

    const levelIntervalMs =
      this.configStore.get().audio.levelMetering.intervalMs;

    if (source.type === "aes67") {
      return this.buildAes67PipelineConfig(source, assignment, label, levelIntervalMs);
    }

    return this.buildLocalPipelineConfig(source, assignment, label, levelIntervalMs);
  }

  /** Build PipelineConfig for an AES67 multicast source. */
  private buildAes67PipelineConfig(
    source: AES67Source,
    assignment: SourceAssignment,
    label: string,
    levelIntervalMs: number,
  ): PipelineConfig {
    return {
      sourceType: "aes67",
      label,
      levelIntervalMs,
      aes67Config: {
        multicastAddress: source.multicastAddress,
        port: source.port,
        sampleRate: source.sampleRate,
        channelCount: source.channelCount,
        bitDepth: source.bitDepth,
        payloadType: source.payloadType,
        selectedChannels: assignment.selectedChannels,
      },
    };
  }

  /** Build PipelineConfig for a local audio device source. */
  private buildLocalPipelineConfig(
    source: LocalDeviceSource,
    assignment: SourceAssignment,
    label: string,
    levelIntervalMs: number,
  ): PipelineConfig {
    return {
      sourceType: "local",
      label,
      levelIntervalMs,
      localConfig: {
        deviceId: source.deviceId,
        api: source.api,
        selectedChannels: assignment.selectedChannels,
        isLoopback: source.isLoopback,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Status aggregation
  // ---------------------------------------------------------------------------

  /**
   * Derive channel status from the aggregate state of its pipelines.
   *
   * Priority: error/crashed > streaming > starting states > stopped
   */
  private aggregateChannelStatus(channelId: string): ChannelStatus {
    const pipelineIds = this.getChannelPipelineIds(channelId);

    if (pipelineIds.length === 0) {
      return "stopped";
    }

    const states: PipelineState[] = [];
    for (const pipelineId of pipelineIds) {
      const state = this.pipelineManager.getPipelineState(pipelineId);
      if (state !== null) {
        states.push(state);
      }
    }

    if (states.length === 0) {
      return "stopped";
    }

    if (states.some((s) => s === "crashed")) return "crashed";
    if (states.some((s) => s === "stopped" && pipelineIds.length > 0)) {
      // If some pipelines stopped unexpectedly while others run, report error
      if (states.some((s) => s === "streaming")) return "error";
    }
    if (states.every((s) => s === "streaming")) return "streaming";
    if (states.some((s) => s === "initializing" || s === "connecting" || s === "buffering")) {
      return "starting";
    }
    if (states.every((s) => s === "stopped" || s === "stopping")) return "stopped";

    return "stopped";
  }

  /** Update a channel's status and emit event if changed. */
  private updateChannelStatus(channelId: string): void {
    const channel = this.channels.get(channelId);
    if (!channel) return;

    const newStatus = this.aggregateChannelStatus(channelId);
    if (channel.status === newStatus) return;

    channel.status = newStatus;
    this.emit("channel-state-changed", channelId, newStatus);
  }

  /** Set channel status directly (used for explicit start/stop transitions). */
  private setChannelStatus(channelId: string, status: ChannelStatus): void {
    const channel = this.channels.get(channelId);
    if (!channel) return;

    if (channel.status === status) return;

    channel.status = status;
    this.emit("channel-state-changed", channelId, status);
  }

  // ---------------------------------------------------------------------------
  // Private: Event wiring
  // ---------------------------------------------------------------------------

  /** Wire PipelineManager events to channel status updates and monitor forwarding. */
  private wirePipelineEvents(): void {
    this.pipelineManager.on(
      "pipeline-state-change",
      (pipelineId: string, _state: PipelineState) => {
        const channelId = this.findChannelByPipelineId(pipelineId);
        if (channelId) {
          this.updateChannelStatus(channelId);
        }
      },
    );

    this.pipelineManager.on(
      "pipeline-levels",
      (pipelineId: string, levels: AudioLevels) => {
        this.levelMonitor.handleLevels(pipelineId, levels);
      },
    );

    this.pipelineManager.on(
      "pipeline-error",
      (pipelineId: string, error: PipelineError) => {
        const channelId = this.findChannelByPipelineId(pipelineId);
        if (channelId) {
          this.logChannelEvent(channelId, "error", error.message, {
            pipelineId,
            errorCode: error.code,
            technicalDetails: error.technicalDetails,
          });
          this.updateChannelStatus(channelId);
        }
      },
    );
  }

  /** Find which channel owns a pipeline ID by searching the pipeline maps. */
  private findChannelByPipelineId(pipelineId: string): string | null {
    for (const [channelId, pipelineMap] of this.channelPipelines) {
      for (const mappedPipelineId of pipelineMap.values()) {
        if (mappedPipelineId === pipelineId) {
          return channelId;
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Private: Config persistence
  // ---------------------------------------------------------------------------

  /** Load channels from the config store on startup. */
  private loadChannelsFromConfig(): void {
    const config = this.configStore.get();
    const savedChannels = config.audio.channels;

    for (const saved of savedChannels) {
      const channel: AppChannel = {
        id: saved.id,
        name: saved.name,
        sources: saved.sources.map((s) => ({
          sourceId: s.sourceId,
          selectedChannels: [...s.selectedChannels],
          gain: s.gain,
          muted: s.muted,
          delayMs: s.delayMs,
        })),
        outputFormat: saved.outputFormat,
        autoStart: saved.autoStart,
        status: "stopped",
        createdAt: Date.now(),
      };

      this.channels.set(channel.id, channel);
      this.channelPipelines.set(channel.id, new Map());
    }

    if (savedChannels.length > 0) {
      logger.info(`Loaded ${savedChannels.length} channel(s) from config`);
    }
  }

  /**
   * Persist all channels to the config store.
   *
   * Strips runtime-only fields (status, createdAt) to match ChannelSchema.
   */
  private persistChannels(): void {
    const channelArray = Array.from(this.channels.values()).map((ch) => ({
      id: ch.id,
      name: ch.name,
      sources: ch.sources.map((s) => ({
        sourceId: s.sourceId,
        selectedChannels: [...s.selectedChannels],
        gain: s.gain,
        muted: s.muted,
        delayMs: s.delayMs,
      })),
      outputFormat: ch.outputFormat,
      autoStart: ch.autoStart,
    }));

    const result = this.configStore.update({
      audio: { channels: channelArray },
    } as Partial<AppConfig>);

    if (!result.success) {
      logger.error("Failed to persist channels to config", {
        errors: result.errors,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Helpers
  // ---------------------------------------------------------------------------

  /** Get a channel by ID or throw if not found. */
  private getChannelOrThrow(channelId: string): AppChannel {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    return channel;
  }

  /** Get or create the pipeline map for a channel. */
  private getOrCreatePipelineMap(channelId: string): Map<string, string> {
    let pipelineMap = this.channelPipelines.get(channelId);
    if (!pipelineMap) {
      pipelineMap = new Map();
      this.channelPipelines.set(channelId, pipelineMap);
    }
    return pipelineMap;
  }

  /**
   * Validate that selected channels are within the source's channel count.
   * Channel indices are 0-based.
   */
  private validateSelectedChannels(
    source: DiscoveredSource,
    selectedChannels: number[],
  ): void {
    const maxChannel = source.channelCount - 1;

    for (const ch of selectedChannels) {
      if (ch < 0 || ch > maxChannel) {
        throw new Error(
          `Selected channel ${ch} is out of range for source "${source.name}" (0-${maxChannel})`,
        );
      }
    }
  }

  /** Log an event for a channel via the EventLogger. */
  private logChannelEvent(
    channelId: string,
    type: ChannelEventType,
    message: string,
    details?: Record<string, unknown>,
  ): void {
    this.eventLogger.log({
      channelId,
      timestamp: Date.now(),
      type,
      message,
      details,
    });
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

/** Shallow comparison of two number arrays. */
function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
