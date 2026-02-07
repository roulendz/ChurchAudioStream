/**
 * AudioSubsystem facade -- top-level entry point for all audio functionality.
 *
 * Creates, wires, and manages the lifecycle of all audio components:
 * SourceRegistry, PipelineManager, DiscoveryManager, LevelMonitor,
 * ResourceMonitor, EventLogger, and ChannelManager.
 *
 * External code (index.ts, WebSocket handler) interacts with this facade
 * exclusively -- never with individual audio components directly.
 *
 * Events (re-emitted from internal components):
 * - "sources-changed"       ()
 * - "channel-created"       (channel: AppChannel)
 * - "channel-updated"       (channel: AppChannel)
 * - "channel-removed"       (channelId: string)
 * - "channel-state-changed" (channelId: string, status: ChannelStatus)
 * - "levels-updated"        (levels: NormalizedLevels)
 * - "stats-updated"         (pipelineId: string, stats: PipelineStats)
 */

import { EventEmitter } from "node:events";
import { SourceRegistry } from "./sources/source-registry.js";
import { PipelineManager } from "./pipeline/pipeline-manager.js";
import { DiscoveryManager } from "./discovery/discovery-manager.js";
import { LevelMonitor, type NormalizedLevels } from "./monitor/level-monitor.js";
import { ResourceMonitor } from "./monitor/resource-monitor.js";
import { EventLogger, type ChannelEvent } from "./monitor/event-logger.js";
import { ChannelManager, type ChannelUpdatableFields, type SourceUpdatableFields } from "./channels/channel-manager.js";
import type { DiscoveredSource } from "./sources/source-types.js";
import type { AppChannel, ChannelOutputFormat, SourceAssignment } from "./channels/channel-types.js";
import type { ProcessingConfig, ProcessingConfigUpdate } from "./processing/processing-types.js";
import type { PipelineStats } from "./pipeline/pipeline-types.js";
import type { ConfigStore } from "../config/store.js";
import { logger } from "../utils/logger.js";

export class AudioSubsystem extends EventEmitter {
  private readonly sourceRegistry: SourceRegistry;
  private readonly pipelineManager: PipelineManager;
  private readonly discoveryManager: DiscoveryManager;
  private readonly levelMonitor: LevelMonitor;
  private readonly resourceMonitor: ResourceMonitor;
  private readonly eventLogger: EventLogger;
  private readonly channelManager: ChannelManager;

  constructor(
    private readonly configStore: ConfigStore,
    private readonly basePath: string,
  ) {
    super();

    const config = this.configStore.get();

    this.sourceRegistry = new SourceRegistry(basePath);

    this.pipelineManager = new PipelineManager(config.audio.pipelineRecovery);

    this.discoveryManager = new DiscoveryManager(this.sourceRegistry, {
      devicePollIntervalMs: config.audio.discoveryCache.devicePollIntervalMs,
    });

    this.levelMonitor = new LevelMonitor();
    this.resourceMonitor = new ResourceMonitor();
    this.eventLogger = new EventLogger(basePath);

    this.channelManager = new ChannelManager(
      this.pipelineManager,
      this.sourceRegistry,
      this.levelMonitor,
      this.resourceMonitor,
      this.eventLogger,
      this.configStore,
    );

    this.wireEventForwarding();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Start all audio subsystem components: discovery, monitoring, auto-start channels. */
  async start(): Promise<void> {
    await this.discoveryManager.start();
    this.resourceMonitor.start();
    await this.channelManager.startAll();
    logger.info("Audio subsystem started");
  }

  /** Stop all audio subsystem components in order: channels, discovery, monitors, logger. */
  async stop(): Promise<void> {
    await this.channelManager.stopAll();
    await this.discoveryManager.stop();
    this.resourceMonitor.stop();
    this.eventLogger.stop();
    logger.info("Audio subsystem stopped");
  }

  // ---------------------------------------------------------------------------
  // Source accessors (delegate to SourceRegistry)
  // ---------------------------------------------------------------------------

  getSources(): DiscoveredSource[] {
    return this.sourceRegistry.getAll();
  }

  getSourceById(id: string): DiscoveredSource | undefined {
    return this.sourceRegistry.getById(id);
  }

  // ---------------------------------------------------------------------------
  // Channel management (delegate to ChannelManager)
  // ---------------------------------------------------------------------------

  getChannels(): AppChannel[] {
    return this.channelManager.getAllChannels();
  }

  getChannel(id: string): AppChannel | undefined {
    return this.channelManager.getChannel(id);
  }

  createChannel(name: string, outputFormat?: ChannelOutputFormat): AppChannel {
    return this.channelManager.createChannel(name, outputFormat);
  }

  async removeChannel(id: string): Promise<void> {
    return this.channelManager.removeChannel(id);
  }

  updateChannel(id: string, updates: ChannelUpdatableFields): AppChannel {
    return this.channelManager.updateChannel(id, updates);
  }

  async addSource(channelId: string, assignment: SourceAssignment): Promise<AppChannel> {
    return this.channelManager.addSource(channelId, assignment);
  }

  async removeSource(channelId: string, sourceIndex: number): Promise<AppChannel> {
    return this.channelManager.removeSource(channelId, sourceIndex);
  }

  async updateSource(
    channelId: string,
    sourceIndex: number,
    updates: SourceUpdatableFields,
  ): Promise<AppChannel> {
    return this.channelManager.updateSource(channelId, sourceIndex, updates);
  }

  async startChannel(id: string): Promise<void> {
    return this.channelManager.startChannel(id);
  }

  async stopChannel(id: string): Promise<void> {
    return this.channelManager.stopChannel(id);
  }

  // ---------------------------------------------------------------------------
  // Processing config (delegate to ChannelManager)
  // ---------------------------------------------------------------------------

  updateProcessingConfig(
    channelId: string,
    updates: ProcessingConfigUpdate,
  ): AppChannel {
    return this.channelManager.updateProcessingConfig(channelId, updates);
  }

  resetProcessingDefaults(channelId: string): AppChannel {
    return this.channelManager.resetProcessingDefaults(channelId);
  }

  getProcessingConfig(channelId: string): ProcessingConfig | undefined {
    const channel = this.channelManager.getChannel(channelId);
    return channel?.processing;
  }

  // ---------------------------------------------------------------------------
  // Level monitoring (delegate to LevelMonitor)
  // ---------------------------------------------------------------------------

  getLevels(pipelineId: string): NormalizedLevels | undefined {
    return this.levelMonitor.getLevels(pipelineId);
  }

  getAllLevels(): Map<string, NormalizedLevels> {
    return this.levelMonitor.getAllLevels();
  }

  // ---------------------------------------------------------------------------
  // Resource monitoring (delegate to ResourceMonitor)
  // ---------------------------------------------------------------------------

  getStats(pipelineId: string): PipelineStats | undefined {
    return this.resourceMonitor.getStats(pipelineId);
  }

  getAllStats(): Map<string, PipelineStats> {
    return this.resourceMonitor.getAllStats();
  }

  // ---------------------------------------------------------------------------
  // Event log access (delegate to EventLogger)
  // ---------------------------------------------------------------------------

  getChannelEvents(channelId: string, limit?: number): ChannelEvent[] {
    return this.eventLogger.getEvents(channelId, limit);
  }

  // ---------------------------------------------------------------------------
  // Pipeline ID mapping (delegate to ChannelManager)
  // ---------------------------------------------------------------------------

  getChannelPipelineIds(channelId: string): string[] {
    return this.channelManager.getChannelPipelineIds(channelId);
  }

  // ---------------------------------------------------------------------------
  // Private: Event forwarding
  // ---------------------------------------------------------------------------

  /**
   * Forward events from internal components to this facade so external
   * consumers (WebSocket handler) only need to subscribe to one EventEmitter.
   */
  private wireEventForwarding(): void {
    // Source registry events
    this.sourceRegistry.on("sources-changed", () => {
      this.emit("sources-changed");
    });

    // Channel manager events
    this.channelManager.on("channel-created", (channel: AppChannel) => {
      this.emit("channel-created", channel);
    });

    this.channelManager.on("channel-updated", (channel: AppChannel) => {
      this.emit("channel-updated", channel);
    });

    this.channelManager.on("channel-removed", (channelId: string) => {
      this.emit("channel-removed", channelId);
    });

    this.channelManager.on("channel-state-changed", (channelId: string, status: string) => {
      this.emit("channel-state-changed", channelId, status);
    });

    // Level monitor events
    this.levelMonitor.on("levels-updated", (levels: NormalizedLevels) => {
      this.emit("levels-updated", levels);
    });

    // Resource monitor events
    this.resourceMonitor.on("stats-updated", (pipelineId: string, stats: PipelineStats) => {
      this.emit("stats-updated", pipelineId, stats);
    });
  }
}
