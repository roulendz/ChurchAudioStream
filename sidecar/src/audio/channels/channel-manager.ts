/**
 * Channel manager -- central orchestrator for app channel lifecycle.
 *
 * After 260429-hb3 refactor: ONE GStreamer pipeline per channel, multiple
 * sources combined inside via `audiomixer name=mix`. channelPipelines is a
 * `Map<channelId, pipelineId>` -- channelId is the stable external key,
 * pipelineId rotates on every replacePipeline call.
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
import type {
  ChannelPipelineConfig,
  SourceSegment,
  PipelineState,
  AudioLevels,
  PipelineError,
} from "../pipeline/pipeline-types.js";
import type { SourceRegistry } from "../sources/source-registry.js";
import type { DiscoveredSource } from "../sources/source-types.js";
import type { LevelMonitor } from "../monitor/level-monitor.js";
import type { ResourceMonitor } from "../monitor/resource-monitor.js";
import type { EventLogger, ChannelEventType } from "../monitor/event-logger.js";
import type { ConfigStore } from "../../config/store.js";
import type { AppConfig } from "../../config/schema.js";
import type { ProcessingConfig, ProcessingConfigUpdate } from "../processing/processing-types.js";
import { ProcessingDefaults, deriveSettingsFromMode } from "../processing/processing-types.js";
import { getPortsForChannel, generateSsrc } from "../processing/port-allocator.js";
import { logger } from "../../utils/logger.js";
import { scheduleDebounced, clearDebounceTimer } from "../../utils/debounce.js";
import { toErrorMessage } from "../../utils/error-message.js";

/** Debounce delay (ms) before restarting pipelines after processing config change. */
const PROCESSING_DEBOUNCE_MS = 1500;

/**
 * Delay before respawning a file-loop pipeline on clean EOS.
 *
 * Matches the prior pipeline-manager constant (200ms). Short delay prevents
 * tight respawn loops on instantly-EOSing files (e.g. zero-byte or corrupted
 * media). Named module-level constant -- no inline magic number.
 */
const FILE_LOOP_RESTART_DELAY_MS = 200;

/** Subset of AppChannel fields that can be updated after creation. */
export type ChannelUpdatableFields = Partial<
  Pick<AppChannel, "name" | "outputFormat" | "autoStart" | "visible">
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
 * One pipeline per channel; sources combined via `audiomixer`. channelId is
 * the stable external key, pipelineId rotates on replace.
 */
export class ChannelManager extends EventEmitter {
  private readonly channels = new Map<string, AppChannel>();

  /** channelId -> pipelineId (single pipeline per channel; value rotates on replace). */
  private readonly channelPipelines = new Map<string, string>();

  /** Per-channel debounce timers for processing config change restarts. */
  private readonly restartDebounceTimers = new Map<string, NodeJS.Timeout>();

  /** Per-channel timers for file-loop EOS restart (only one pending per channel). */
  private readonly fileLoopRestartTimers = new Map<string, NodeJS.Timeout>();

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

  createChannel(
    name: string,
    outputFormat: ChannelOutputFormat = "mono",
  ): AppChannel {
    const channelId = randomUUID();
    const channelIndex = this.channels.size;
    const ports = getPortsForChannel(channelIndex);

    const channel: AppChannel = {
      id: channelId,
      name,
      sources: [],
      outputFormat,
      autoStart: true,
      visible: true,
      sortOrder: this.channels.size,
      status: "stopped",
      processing: {
        ...ProcessingDefaults,
        agc: { ...ProcessingDefaults.agc },
        opus: { ...ProcessingDefaults.opus },
        rtpOutput: {
          ...ProcessingDefaults.rtpOutput,
          rtpPort: ports.rtpPort,
          rtcpPort: ports.rtcpPort,
          ssrc: generateSsrc(channelId),
        },
      },
      createdAt: Date.now(),
    };

    this.channels.set(channel.id, channel);
    this.persistChannels();

    this.logChannelEvent(channel.id, "info", `Channel created: "${name}"`);
    this.emit("channel-created", channel);
    this.assertSinglePipelinePerChannel();

    logger.info(`Channel created: "${name}"`, { channelId: channel.id });
    return channel;
  }

  async removeChannel(channelId: string): Promise<void> {
    const channel = this.getChannelOrThrow(channelId);

    this.clearDebouncedRestart(channelId);
    this.clearFileLoopTimer(channelId);
    await this.stopChannel(channelId);

    this.channels.delete(channelId);
    this.channelPipelines.delete(channelId);
    this.persistChannels();
    this.assertSinglePipelinePerChannel();

    this.emit("channel-removed", channelId);
    logger.info(`Channel removed: "${channel.name}"`, { channelId });
  }

  updateChannel(channelId: string, updates: ChannelUpdatableFields): AppChannel {
    const channel = this.getChannelOrThrow(channelId);

    if (updates.name !== undefined) channel.name = updates.name;
    if (updates.outputFormat !== undefined) channel.outputFormat = updates.outputFormat;
    if (updates.autoStart !== undefined) channel.autoStart = updates.autoStart;
    if (updates.visible !== undefined) channel.visible = updates.visible;

    this.persistChannels();
    this.emit("channel-updated", channel);

    logger.info(`Channel updated: "${channel.name}"`, { channelId });
    return channel;
  }

  // ---------------------------------------------------------------------------
  // Processing Config
  // ---------------------------------------------------------------------------

  updateProcessingConfig(
    channelId: string,
    updates: ProcessingConfigUpdate,
  ): AppChannel {
    const channel = this.getChannelOrThrow(channelId);

    if (updates.agc) {
      channel.processing = {
        ...channel.processing,
        agc: { ...channel.processing.agc, ...updates.agc },
      };
    }
    if (updates.opus) {
      channel.processing = {
        ...channel.processing,
        opus: { ...channel.processing.opus, ...updates.opus },
      };
    }
    if (updates.rtpOutput) {
      channel.processing = {
        ...channel.processing,
        rtpOutput: { ...channel.processing.rtpOutput, ...updates.rtpOutput },
      };
    }

    if (updates.mode !== undefined) {
      channel.processing = deriveSettingsFromMode(
        updates.mode,
        channel.processing,
      );
    }

    this.persistChannels();

    if (channel.status === "streaming" || channel.status === "starting") {
      this.scheduleDebouncedRestart(channelId);
    }

    this.emit("channel-updated", channel);
    logger.info(`Processing config updated for channel "${channel.name}"`, {
      channelId,
    });
    this.assertSinglePipelinePerChannel();
    return channel;
  }

  resetProcessingDefaults(channelId: string): AppChannel {
    const channel = this.getChannelOrThrow(channelId);

    const channelIndex = this.getChannelIndex(channelId);
    const ports = getPortsForChannel(channelIndex);

    channel.processing = {
      ...ProcessingDefaults,
      agc: { ...ProcessingDefaults.agc },
      opus: { ...ProcessingDefaults.opus },
      rtpOutput: {
        ...ProcessingDefaults.rtpOutput,
        rtpPort: ports.rtpPort,
        rtcpPort: ports.rtcpPort,
        ssrc: generateSsrc(channelId),
      },
    };

    this.persistChannels();

    if (channel.status === "streaming" || channel.status === "starting") {
      this.scheduleDebouncedRestart(channelId);
    }

    this.emit("channel-updated", channel);
    logger.info(`Processing config reset for channel "${channel.name}"`, {
      channelId,
    });
    this.assertSinglePipelinePerChannel();
    return channel;
  }

  // ---------------------------------------------------------------------------
  // Source Assignment
  // ---------------------------------------------------------------------------

  /**
   * Add a source assignment to a channel.
   *
   * If channel running: build new ChannelPipelineConfig + replacePipeline.
   * If channel stopped + autoStart: startChannel.
   * Otherwise: persist for next start.
   */
  async addSource(channelId: string, assignment: SourceAssignment): Promise<AppChannel> {
    const channel = this.getChannelOrThrow(channelId);

    const source = this.sourceRegistry.getById(assignment.sourceId);
    if (!source) {
      throw new Error(`Source not found: ${assignment.sourceId}`);
    }

    this.validateSelectedChannels(source, assignment.selectedChannels);

    channel.sources.push({ ...assignment });
    await this.applyPipelineForChannelChange(channel);

    this.persistChannels();
    this.logChannelEvent(channelId, "source-change", `Source added: "${source.name}"`, {
      sourceId: assignment.sourceId,
    });
    this.emit("channel-updated", channel);
    this.assertSinglePipelinePerChannel();
    return channel;
  }

  /**
   * Remove a source assignment from a channel by index.
   *
   * If remaining sources > 0 and channel running: replacePipeline with smaller
   * source list. If remaining === 0: stop pipeline + clear Map entry (NOT
   * replacePipeline -- empty mixers are illegal). Otherwise: persist.
   */
  async removeSource(channelId: string, sourceIndex: number): Promise<AppChannel> {
    const channel = this.getChannelOrThrow(channelId);

    if (sourceIndex < 0 || sourceIndex >= channel.sources.length) {
      throw new Error(
        `Source index ${sourceIndex} out of bounds (channel has ${channel.sources.length} sources)`,
      );
    }

    channel.sources.splice(sourceIndex, 1);

    if (channel.sources.length === 0) {
      await this.stopChannel(channelId);
    } else {
      await this.applyPipelineForChannelChange(channel);
    }

    this.persistChannels();
    this.logChannelEvent(channelId, "source-change", "Source removed", {
      removedIndex: sourceIndex,
    });
    this.emit("channel-updated", channel);
    this.assertSinglePipelinePerChannel();
    return channel;
  }

  /**
   * Update a source assignment. selectedChannels/gain/muted/delayMs all flow
   * into the pipeline string now (Task 5 makes gain/mute live), so any change
   * triggers replacePipeline when the channel is running.
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

    // SourceAssignment.gain/muted/delayMs/selectedChannels are not readonly,
    // so a single immutable replacement is enough. The previous `as` casts
    // were dead weight (fields are mutable) and mixed mutation styles within
    // one function. One replace, one mental model.
    channel.sources[sourceIndex] = {
      ...channel.sources[sourceIndex],
      ...updates,
    };

    await this.applyPipelineForChannelChange(channel);

    this.persistChannels();
    this.emit("channel-updated", channel);
    this.assertSinglePipelinePerChannel();
    return channel;
  }

  /**
   * Reorder sources in a channel. mixerPadName is reassigned in array order on
   * the next pipeline build, so a permutation triggers replacePipeline.
   */
  async reorderSources(channelId: string, newOrder: number[]): Promise<AppChannel> {
    const channel = this.getChannelOrThrow(channelId);

    if (newOrder.length !== channel.sources.length) {
      throw new Error(
        `Reorder array length (${newOrder.length}) does not match source count (${channel.sources.length})`,
      );
    }
    const seen = new Set<number>();
    for (const idx of newOrder) {
      if (idx < 0 || idx >= channel.sources.length) {
        throw new Error(`Reorder index ${idx} out of range`);
      }
      if (seen.has(idx)) {
        throw new Error(`Reorder array has duplicate index ${idx}`);
      }
      seen.add(idx);
    }

    const reordered = newOrder.map((idx) => channel.sources[idx]);
    channel.sources = reordered;

    await this.applyPipelineForChannelChange(channel);

    this.persistChannels();
    this.emit("channel-updated", channel);
    this.assertSinglePipelinePerChannel();
    return channel;
  }

  // ---------------------------------------------------------------------------
  // Pipeline Orchestration
  // ---------------------------------------------------------------------------

  /**
   * Start the single pipeline for this channel from all assigned sources.
   *
   * Skips when zero sources (matches prior behavior).
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
    this.logChannelEvent(channelId, "start", `Channel starting with ${channel.sources.length} source(s)`);

    const config = this.buildChannelPipelineConfig(channelId);
    if (!config) {
      logger.warn(`Channel "${channel.name}": no valid sources after stale-source filter`, {
        channelId,
      });
      this.setChannelStatus(channelId, "stopped");
      return;
    }

    try {
      const pipelineId = this.pipelineManager.createPipeline(config);
      this.pipelineManager.startPipeline(pipelineId);
      this.channelPipelines.set(channelId, pipelineId);

      if (channel.processing.agc.enabled) {
        this.levelMonitor.setProcessingTarget(pipelineId, channel.processing.agc.targetLufs);
      }
    } catch (err) {
      const errorMessage = toErrorMessage(err);
      logger.error(`Failed to start pipeline for channel "${channel.name}"`, {
        channelId,
        error: errorMessage,
      });
      this.logChannelEvent(channelId, "error", `Failed to start channel: ${errorMessage}`);
      this.setChannelStatus(channelId, "stopped");
    }

    this.assertSinglePipelinePerChannel();
    logger.info(`Channel "${channel.name}" started`, { channelId });
  }

  async stopChannel(channelId: string): Promise<void> {
    this.clearDebouncedRestart(channelId);
    this.clearFileLoopTimer(channelId);

    const pipelineId = this.channelPipelines.get(channelId);
    if (!pipelineId) {
      const channel = this.channels.get(channelId);
      if (channel) this.setChannelStatus(channelId, "stopped");
      return;
    }

    try {
      await this.pipelineManager.removePipeline(pipelineId);
    } catch (err) {
      logger.warn(`Failed to stop pipeline ${pipelineId}`, {
        channelId,
        error: toErrorMessage(err),
      });
    }
    this.resourceMonitor.untrackPipeline(pipelineId);
    this.levelMonitor.clearPipeline(pipelineId);
    this.channelPipelines.delete(channelId);

    this.setChannelStatus(channelId, "stopped");

    const channel = this.channels.get(channelId);
    const channelName = channel?.name ?? channelId;
    this.logChannelEvent(channelId, "stop", "Channel stopped");
    this.assertSinglePipelinePerChannel();
    logger.info(`Channel "${channelName}" stopped`, { channelId });
  }

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
          error: toErrorMessage(err),
        });
      }
    }
    logger.info(`Auto-started ${autoStartChannels.length} channel(s)`);
  }

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

  getChannel(channelId: string): AppChannel | undefined {
    return this.channels.get(channelId);
  }

  getAllChannels(): AppChannel[] {
    return Array.from(this.channels.values()).sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
  }

  reorderChannels(orderedIds: string[]): AppChannel[] {
    if (orderedIds.length !== this.channels.size) {
      throw new Error(
        `Reorder array length (${orderedIds.length}) does not match channel count (${this.channels.size})`,
      );
    }
    for (const id of orderedIds) {
      if (!this.channels.has(id)) {
        throw new Error(`Channel not found: ${id}`);
      }
    }

    for (let i = 0; i < orderedIds.length; i++) {
      const channel = this.channels.get(orderedIds[i])!;
      if (channel.sortOrder !== i) {
        channel.sortOrder = i;
        this.emit("channel-updated", channel);
      }
    }
    this.persistChannels();

    logger.info(`Channels reordered`, { order: orderedIds });
    return this.getAllChannels();
  }

  /** Reverse map pipelineId -> channelId. One entry per active channel. */
  getPipelineToChannelMap(): Map<string, string> {
    const reverseMap = new Map<string, string>();
    for (const [channelId, pipelineId] of this.channelPipelines) {
      reverseMap.set(pipelineId, channelId);
    }
    return reverseMap;
  }

  /** Single-element array (or empty) -- public API preserved for callers. */
  getChannelPipelineIds(channelId: string): string[] {
    const pipelineId = this.channelPipelines.get(channelId);
    return pipelineId ? [pipelineId] : [];
  }

  // ---------------------------------------------------------------------------
  // Private: Pipeline lifecycle helpers
  // ---------------------------------------------------------------------------

  /**
   * Apply a channel-source change to the running pipeline (or trigger autoStart).
   *
   * - Channel running (streaming/starting): build new config, replacePipeline, update Map.
   * - Channel stopped + autoStart: full startChannel.
   * - Otherwise: do nothing (next start picks up new sources).
   */
  private async applyPipelineForChannelChange(channel: AppChannel): Promise<void> {
    const isRunning = channel.status === "streaming" || channel.status === "starting";
    if (isRunning) {
      await this.replaceRunningPipeline(channel.id);
      return;
    }
    if (channel.autoStart && channel.sources.length > 0 && channel.status === "stopped") {
      await this.startChannel(channel.id);
    }
  }

  /**
   * Rebuild the channel pipeline config and atomically replace the running
   * pipeline. Caller already mutated `channel.sources` to the desired state.
   */
  private async replaceRunningPipeline(channelId: string): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) return;

    const oldPipelineId = this.channelPipelines.get(channelId);
    if (!oldPipelineId) {
      logger.warn(`replaceRunningPipeline: no current pipeline for "${channel.name}", starting fresh`, {
        channelId,
      });
      await this.startChannel(channelId);
      return;
    }

    if (channel.sources.length === 0) {
      // Defensive: caller should have routed empty-source case to stopChannel.
      await this.stopChannel(channelId);
      return;
    }

    const newConfig = this.buildChannelPipelineConfig(channelId);
    if (!newConfig) {
      logger.warn(`replaceRunningPipeline: no valid config for "${channel.name}", stopping`, {
        channelId,
      });
      await this.stopChannel(channelId);
      return;
    }

    try {
      const newPipelineId = await this.pipelineManager.replacePipeline(oldPipelineId, newConfig);
      this.swapMonitorBookkeeping(oldPipelineId, newPipelineId, channel);
      this.channelPipelines.set(channelId, newPipelineId);
    } catch (err) {
      logger.error(`replaceRunningPipeline failed for "${channel.name}"`, {
        channelId,
        error: toErrorMessage(err),
      });
      this.channelPipelines.delete(channelId);
      this.setChannelStatus(channelId, "stopped");
    }
  }

  /**
   * Swap monitor + level state from an old pipelineId to a new one when a
   * channel's pipeline is atomically replaced (config change, source edit,
   * file-loop EOS restart). Single source of truth for both replace paths --
   * file-loop path used to skip this and leaked Map entries every loop.
   *
   * Note: ResourceMonitor.trackPipeline for the NEW pipelineId is wired by the
   * "connecting" state-change handler (see wirePipelineEvents). Only the
   * untrack of the OLD pipelineId belongs here -- the new pipeline announces
   * itself once gst-launch has a PID.
   */
  private swapMonitorBookkeeping(
    oldPipelineId: string,
    newPipelineId: string,
    channel: AppChannel,
  ): void {
    this.resourceMonitor.untrackPipeline(oldPipelineId);
    this.levelMonitor.clearPipeline(oldPipelineId);
    if (channel.processing.agc.enabled) {
      this.levelMonitor.setProcessingTarget(newPipelineId, channel.processing.agc.targetLufs);
    }
  }

  /**
   * Wire ResourceMonitor for a pipeline once gst-launch has a PID. Called from
   * the "connecting" state-change handler so the same call site covers initial
   * start, replace, and crash respawn. Skips silently when the PID is not yet
   * available (race where state-change fires before child.pid lands).
   */
  private trackPipelineResource(pipelineId: string): void {
    const pid = this.pipelineManager.getPipelinePid(pipelineId);
    if (pid === null) return;
    this.resourceMonitor.trackPipeline(pipelineId, pid);
  }

  // ---------------------------------------------------------------------------
  // Private: Pipeline config construction
  // ---------------------------------------------------------------------------

  /**
   * Build a ChannelPipelineConfig combining all sources of a channel.
   *
   * Skips stale sources (warn logged). Returns null if zero valid sources
   * remain. mixerPadName is assigned in source-array order so segment ordering
   * matches admin UI ordering.
   */
  private buildChannelPipelineConfig(channelId: string): ChannelPipelineConfig | null {
    const channel = this.channels.get(channelId);
    if (!channel) return null;

    const segments: SourceSegment[] = [];
    for (let i = 0; i < channel.sources.length; i++) {
      const assignment = channel.sources[i];
      const source = this.sourceRegistry.getById(assignment.sourceId);
      if (!source) {
        logger.warn(`Skipping stale source "${assignment.sourceId}" in channel "${channel.name}"`, {
          channelId,
          sourceIndex: i,
        });
        continue;
      }
      segments.push(toSourceSegment(source, assignment, `mix.sink_${segments.length}`));
    }

    if (segments.length === 0) return null;

    const shouldLoopOnEos = segments.every(
      (seg) => seg.source.kind === "file" && seg.source.config.loop === true,
    );

    return {
      label: channel.name,
      levelIntervalMs: this.configStore.get().audio.levelMetering.intervalMs,
      processing: this.buildProcessingForPipeline(channel),
      sources: segments,
      shouldLoopOnEos,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Status aggregation
  // ---------------------------------------------------------------------------

  private aggregateChannelStatus(channelId: string): ChannelStatus {
    const pipelineId = this.channelPipelines.get(channelId);
    if (!pipelineId) return "stopped";

    const state = this.pipelineManager.getPipelineState(pipelineId);
    if (state === null) return "stopped";
    if (state === "crashed") return "crashed";
    if (state === "streaming") return "streaming";
    if (state === "initializing" || state === "connecting" || state === "buffering") {
      return "starting";
    }
    return "stopped";
  }

  private updateChannelStatus(channelId: string): void {
    const channel = this.channels.get(channelId);
    if (!channel) return;

    const newStatus = this.aggregateChannelStatus(channelId);
    if (channel.status === newStatus) return;

    channel.status = newStatus;
    this.emit("channel-state-changed", channelId, newStatus);
  }

  private setChannelStatus(channelId: string, status: ChannelStatus): void {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    if (channel.status === status) return;

    channel.status = status;
    this.emit("channel-state-changed", channelId, status);
  }

  // ---------------------------------------------------------------------------
  // Private: Tiger-style invariant guard
  // ---------------------------------------------------------------------------

  /**
   * Tiger-style: every Map mutation must preserve the single-pipeline-per-channel
   * invariant. Throws (fail-fast, fail-loud) on any violation.
   */
  private assertSinglePipelinePerChannel(): void {
    const distinctPipelineIds = new Set(this.channelPipelines.values());
    if (distinctPipelineIds.size !== this.channelPipelines.size) {
      throw new Error(
        `INVARIANT VIOLATED: channelPipelines has duplicate pipelineId values. ` +
        `entries=${this.channelPipelines.size}, distinct=${distinctPipelineIds.size}`,
      );
    }
    if (this.channelPipelines.size > this.channels.size) {
      throw new Error(
        `INVARIANT VIOLATED: channelPipelines.size (${this.channelPipelines.size}) ` +
        `> channels.size (${this.channels.size})`,
      );
    }
    for (const channelId of this.channelPipelines.keys()) {
      if (!this.channels.has(channelId)) {
        throw new Error(
          `INVARIANT VIOLATED: channelPipelines has entry for unknown channelId "${channelId}"`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Event wiring
  // ---------------------------------------------------------------------------

  private wirePipelineEvents(): void {
    this.pipelineManager.on(
      "pipeline-state-change",
      (pipelineId: string, state: PipelineState) => {
        // Track resource usage as soon as the gst-launch child has a PID.
        // Covers (a) initial startChannel, (b) replacePipeline, (c) crash
        // respawn (same pipelineId, new PID -- Map.set overwrites).
        // Centralised here so a single state-driven path keeps ResourceMonitor
        // and PipelineManager in lockstep (DRY).
        if (state === "connecting") {
          this.trackPipelineResource(pipelineId);
        }
        const channelId = this.findChannelByPipelineId(pipelineId);
        if (channelId) this.updateChannelStatus(channelId);
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
        if (!channelId) return;
        this.logChannelEvent(channelId, "error", error.message, {
          pipelineId,
          errorCode: error.code,
          technicalDetails: error.technicalDetails,
        });
        if (error.code === "MAX_RESTARTS_EXCEEDED") {
          // Pipeline gave up. Tear it down via stopChannel (DRY: same path as
          // user-initiated stop) so the dead GStreamerProcess is removed from
          // pipelineManager.pipelines and channelPipelines is cleared --
          // otherwise aggregateChannelStatus reports "crashed" forever.
          this.handleMaxRestartsExceeded(channelId, pipelineId);
          return;
        }
        this.updateChannelStatus(channelId);
      },
    );

    this.pipelineManager.on(
      "pipeline-exit",
      (pipelineId: string, code: number | null, _signal: string | null, wasStopRequested: boolean) => {
        this.handlePipelineExit(pipelineId, code, wasStopRequested);
      },
    );
  }

  /**
   * Decide whether a clean EOS exit should trigger a file-loop restart.
   *
   * Triggers only when ALL of:
   * - exit was clean (`code === 0`)
   * - user did NOT request stop (`wasStopRequested === false`)
   * - the pipeline still belongs to a channel we manage
   * - the channel's computed `shouldLoopOnEos` is true (all sources file+loop)
   */
  private handlePipelineExit(
    pipelineId: string,
    code: number | null,
    wasStopRequested: boolean,
  ): void {
    if (wasStopRequested) return;
    if (code !== 0) return;

    const channelId = this.findChannelByPipelineId(pipelineId);
    if (!channelId) return;

    const channel = this.channels.get(channelId);
    if (!channel || channel.sources.length === 0) return;

    const config = this.buildChannelPipelineConfig(channelId);
    if (!config || !config.shouldLoopOnEos) return;

    this.scheduleFileLoopRestart(channelId, pipelineId);
  }

  private scheduleFileLoopRestart(channelId: string, oldPipelineId: string): void {
    const existing = this.fileLoopRestartTimers.get(channelId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.fileLoopRestartTimers.delete(channelId);
      this.replaceChannelPipelineForLoop(channelId, oldPipelineId).catch((err) => {
        logger.error(`File-loop restart failed for channel ${channelId}`, {
          error: toErrorMessage(err),
        });
      });
    }, FILE_LOOP_RESTART_DELAY_MS);

    this.fileLoopRestartTimers.set(channelId, timer);
  }

  private async replaceChannelPipelineForLoop(
    channelId: string,
    oldPipelineId: string,
  ): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    // Only attempt if Map still references the old pipeline -- otherwise the
    // user replaced/removed sources mid-loop, in which case the new lifecycle
    // path already handled the restart.
    const currentPipelineId = this.channelPipelines.get(channelId);
    if (currentPipelineId !== oldPipelineId) return;

    const config = this.buildChannelPipelineConfig(channelId);
    if (!config) return;

    try {
      const newPipelineId = await this.pipelineManager.replacePipeline(oldPipelineId, config);
      this.swapMonitorBookkeeping(oldPipelineId, newPipelineId, channel);
      this.channelPipelines.set(channelId, newPipelineId);
      this.assertSinglePipelinePerChannel();
    } catch (err) {
      logger.error(`Failed to loop-restart channel pipeline "${channel.name}"`, {
        channelId,
        error: toErrorMessage(err),
      });
    }
  }

  private clearFileLoopTimer(channelId: string): void {
    const timer = this.fileLoopRestartTimers.get(channelId);
    if (timer) {
      clearTimeout(timer);
      this.fileLoopRestartTimers.delete(channelId);
    }
  }

  /**
   * Auto-stop a channel after its pipeline exhausted the restart budget.
   * Reuses stopChannel for cleanup (DRY) so the dead GStreamerProcess is
   * removed from pipelineManager.pipelines and the channelPipelines mapping
   * is cleared. Without this the channel reports "crashed" forever and the
   * admin must manually stop+remove.
   */
  private handleMaxRestartsExceeded(channelId: string, pipelineId: string): void {
    this.logChannelEvent(
      channelId,
      "error",
      "Channel auto-stopped: pipeline exceeded max restart attempts",
      { pipelineId },
    );
    this.stopChannel(channelId).catch((err) => {
      logger.error(`Failed to cleanup zombie pipeline ${pipelineId}`, {
        channelId,
        error: toErrorMessage(err),
      });
    });
  }

  /** Linear scan of channelPipelines (single-pipeline Map). */
  private findChannelByPipelineId(pipelineId: string): string | null {
    for (const [channelId, mappedPipelineId] of this.channelPipelines) {
      if (mappedPipelineId === pipelineId) return channelId;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Private: Config persistence
  // ---------------------------------------------------------------------------

  private loadChannelsFromConfig(): void {
    const config = this.configStore.get();
    const savedChannels = config.audio.channels;

    for (let i = 0; i < savedChannels.length; i++) {
      const saved = savedChannels[i];
      const ports = getPortsForChannel(i);

      const channel: AppChannel = {
        id: saved.id,
        name: saved.name,
        sources: saved.sources.map(normalizeSourceAssignment),
        outputFormat: saved.outputFormat,
        autoStart: saved.autoStart,
        visible: saved.visible ?? true,
        sortOrder: saved.sortOrder ?? i,
        status: "stopped",
        processing: {
          mode: saved.processing.mode as ProcessingConfig["mode"],
          agc: normalizeAgcConfig(saved.processing.agc),
          opus: {
            enabled: saved.processing.opus.enabled,
            bitrateKbps: saved.processing.opus.bitrateKbps,
            frameSize: Number(saved.processing.opus.frameSize) as 10 | 20 | 40,
            fec: saved.processing.opus.fec,
            dtx: false,
            bitrateMode: saved.processing.opus.bitrateMode,
            audioType: saved.processing.mode === "music" ? "generic" : "voice",
          },
          rtpOutput: {
            rtpPort: ports.rtpPort,
            rtcpPort: ports.rtcpPort,
            host: "127.0.0.1",
            ssrc: generateSsrc(saved.id),
          },
        },
        createdAt: Date.now(),
      };

      this.channels.set(channel.id, channel);
    }

    if (savedChannels.length > 0) {
      logger.info(`Loaded ${savedChannels.length} channel(s) from config`);
    }
  }

  private persistChannels(): void {
    const channelArray = Array.from(this.channels.values()).map((ch) => ({
      id: ch.id,
      name: ch.name,
      sources: ch.sources.map(normalizeSourceAssignment),
      outputFormat: ch.outputFormat,
      autoStart: ch.autoStart,
      visible: ch.visible,
      sortOrder: ch.sortOrder,
      processing: {
        mode: ch.processing.mode,
        agc: normalizeAgcConfig(ch.processing.agc),
        opus: {
          enabled: ch.processing.opus.enabled,
          bitrateKbps: ch.processing.opus.bitrateKbps,
          frameSize: String(ch.processing.opus.frameSize) as "10" | "20" | "40",
          fec: ch.processing.opus.fec,
          bitrateMode: ch.processing.opus.bitrateMode,
        },
        rtpOutput: {
          rtpPort: ch.processing.rtpOutput.rtpPort,
          rtcpPort: ch.processing.rtpOutput.rtcpPort,
          ssrc: ch.processing.rtpOutput.ssrc,
        },
      },
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
  // Private: Debounced pipeline restart (processing-config changes)
  // ---------------------------------------------------------------------------

  private scheduleDebouncedRestart(channelId: string): void {
    scheduleDebounced(
      this.restartDebounceTimers,
      channelId,
      PROCESSING_DEBOUNCE_MS,
      () => {
        this.restartChannelPipelines(channelId).catch((err) => {
          logger.error(`Failed to restart pipelines for channel ${channelId}`, {
            error: toErrorMessage(err),
          });
        });
      },
    );
  }

  private clearDebouncedRestart(channelId: string): void {
    clearDebounceTimer(this.restartDebounceTimers, channelId);
  }

  /** Rebuild the pipeline config and replace the single pipeline atomically. */
  private async restartChannelPipelines(channelId: string): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) return;

    logger.info(`Restarting pipeline for channel "${channel.name}" (processing config changed)`, {
      channelId,
    });

    await this.replaceRunningPipeline(channelId);
    this.assertSinglePipelinePerChannel();

    this.logChannelEvent(channelId, "info", "Pipeline restarted (processing config changed)");
  }

  // ---------------------------------------------------------------------------
  // Private: Processing config helpers
  // ---------------------------------------------------------------------------

  private buildProcessingForPipeline(channel: AppChannel): ProcessingConfig {
    const channelIndex = this.getChannelIndex(channel.id);
    const ports = getPortsForChannel(channelIndex);

    return {
      ...channel.processing,
      agc: { ...channel.processing.agc },
      opus: {
        ...channel.processing.opus,
        audioType: channel.processing.mode === "music" ? "generic" : "voice",
      },
      rtpOutput: {
        ...channel.processing.rtpOutput,
        rtpPort: ports.rtpPort,
        rtcpPort: ports.rtcpPort,
        host: "127.0.0.1",
        ssrc: generateSsrc(channel.id),
      },
    };
  }

  /**
   * Channel index used for deterministic port allocation. Throws on miss --
   * silent fall-through previously yielded an out-of-range index, leading
   * `getPortsForChannel` to bind the channel to a port mediasoup never sees.
   * Tiger-style: fail-loud at the boundary.
   */
  private getChannelIndex(channelId: string): number {
    let index = 0;
    for (const id of this.channels.keys()) {
      if (id === channelId) return index;
      index++;
    }
    throw new Error(`getChannelIndex: unknown channelId ${channelId}`);
  }

  // ---------------------------------------------------------------------------
  // Private: Helpers
  // ---------------------------------------------------------------------------

  private getChannelOrThrow(channelId: string): AppChannel {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    return channel;
  }

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

/**
 * Convert a (DiscoveredSource, SourceAssignment) pair into a SourceSegment.
 * Single source of truth for source -> SourceSegment mapping (DRY).
 */
function toSourceSegment(
  source: DiscoveredSource,
  assignment: SourceAssignment,
  mixerPadName: string,
): SourceSegment {
  const segmentAssignment = {
    sourceId: assignment.sourceId,
    gain: assignment.gain,
    muted: assignment.muted,
    delayMs: assignment.delayMs,
  };

  if (source.type === "aes67") {
    return {
      source: {
        kind: "aes67",
        config: {
          multicastAddress: source.multicastAddress,
          port: source.port,
          sampleRate: source.sampleRate,
          channelCount: source.channelCount,
          bitDepth: source.bitDepth,
          payloadType: source.payloadType,
          selectedChannels: assignment.selectedChannels,
        },
      },
      assignment: segmentAssignment,
      mixerPadName,
    };
  }

  if (source.type === "file") {
    return {
      source: {
        kind: "file",
        config: {
          filePath: source.filePath,
          loop: source.loop,
          selectedChannels: assignment.selectedChannels,
        },
      },
      assignment: segmentAssignment,
      mixerPadName,
    };
  }

  return {
    source: {
      kind: "local",
      config: {
        deviceId: source.deviceId,
        api: source.api,
        selectedChannels: assignment.selectedChannels,
        totalChannelCount: source.channelCount,
        isLoopback: source.isLoopback,
      },
    },
    assignment: segmentAssignment,
    mixerPadName,
  };
}

/**
 * Normalize a source assignment to a plain object with a fresh selectedChannels copy.
 * Used by load-from-config and persist-to-config paths.
 */
function normalizeSourceAssignment(
  s: SourceAssignment,
): { sourceId: string; selectedChannels: number[]; gain: number; muted: boolean; delayMs: number } {
  return {
    sourceId: s.sourceId,
    selectedChannels: [...s.selectedChannels],
    gain: s.gain,
    muted: s.muted,
    delayMs: s.delayMs,
  };
}

/** Normalize an AGC config to a plain object. */
function normalizeAgcConfig(
  agc: { enabled: boolean; targetLufs: number; maxTruePeakDbtp: number },
): { enabled: boolean; targetLufs: number; maxTruePeakDbtp: number } {
  return {
    enabled: agc.enabled,
    targetLufs: agc.targetLufs,
    maxTruePeakDbtp: agc.maxTruePeakDbtp,
  };
}
