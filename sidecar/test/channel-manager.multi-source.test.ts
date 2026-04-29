/**
 * Tests for ChannelManager single-pipeline-per-channel refactor.
 *
 * Object-literal-with-vi.fn cast pattern (RESEARCH §5). Mocks surface only
 * the methods the channel-manager actually invokes. Avoids touching the real
 * config store, source registry, or pipeline manager internals.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChannelManager } from "../src/audio/channels/channel-manager";
import type { PipelineManager } from "../src/audio/pipeline/pipeline-manager";
import type { SourceRegistry } from "../src/audio/sources/source-registry";
import type { LevelMonitor } from "../src/audio/monitor/level-monitor";
import type { ResourceMonitor } from "../src/audio/monitor/resource-monitor";
import type { EventLogger } from "../src/audio/monitor/event-logger";
import type { ConfigStore } from "../src/config/store";
import type { FileSource } from "../src/audio/sources/source-types";
import type { ChannelPipelineConfig } from "../src/audio/pipeline/pipeline-types";

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

interface PipelineEventBus {
  emit(event: string, ...args: unknown[]): void;
  handlers: Map<string, Array<(...args: unknown[]) => void>>;
}

function makePipelineEventBus(): PipelineEventBus {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    handlers,
    emit(event: string, ...args: unknown[]): void {
      const list = handlers.get(event);
      if (!list) return;
      for (const h of list) h(...args);
    },
  };
}

function makePipelineManagerMock(bus: PipelineEventBus, options: {
  initialState?: "streaming" | "stopped" | "crashed";
} = {}) {
  let nextPipelineCounter = 0;
  let nextPid = 10000;
  const createdPipelines: Array<{ id: string; config: ChannelPipelineConfig }> = [];
  const pipelinePids = new Map<string, number>();

  const createPipeline = vi.fn((config: ChannelPipelineConfig) => {
    nextPipelineCounter += 1;
    const id = `pipeline-${nextPipelineCounter}`;
    createdPipelines.push({ id, config });
    pipelinePids.set(id, ++nextPid);
    return id;
  });
  const startPipeline = vi.fn();
  const removePipeline = vi.fn(async (id: string) => {
    pipelinePids.delete(id);
  });
  const replacePipeline = vi.fn(async (oldId: string, config: ChannelPipelineConfig) => {
    nextPipelineCounter += 1;
    const id = `pipeline-${nextPipelineCounter}`;
    createdPipelines.push({ id, config });
    pipelinePids.delete(oldId);
    pipelinePids.set(id, ++nextPid);
    return id;
  });
  const getPipelineState = vi.fn().mockReturnValue(options.initialState ?? "streaming");
  const getPipelinePid = vi.fn((id: string) => pipelinePids.get(id) ?? null);

  const on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    let list = bus.handlers.get(event);
    if (!list) {
      list = [];
      bus.handlers.set(event, list);
    }
    list.push(handler);
  });

  const pipelineManager = {
    createPipeline,
    startPipeline,
    stopPipeline: vi.fn().mockResolvedValue(undefined),
    removePipeline,
    replacePipeline,
    getPipelineState,
    getPipelinePid,
    on,
    emit: vi.fn(),
  } as unknown as PipelineManager;

  return {
    pipelineManager,
    createdPipelines,
    pipelinePids,
    mocks: {
      createPipeline,
      startPipeline,
      removePipeline,
      replacePipeline,
      getPipelineState,
      getPipelinePid,
      on,
    },
  };
}

function makeFileSource(id: string, name: string, loop: boolean): FileSource {
  return {
    id,
    type: "file",
    name,
    filePath: `C:/test/${name}.mp3`,
    sampleRate: 48000,
    bitDepth: 16,
    channelCount: 2,
    loop,
    status: "available",
    lastSeenAt: Date.now(),
  };
}

function makeSourceRegistry(sources: FileSource[]): SourceRegistry {
  return {
    getById: vi.fn((id: string) => sources.find((s) => s.id === id)),
    getAll: vi.fn(() => sources),
  } as unknown as SourceRegistry;
}

function makeStubMonitors() {
  const levelMonitor = {
    setProcessingTarget: vi.fn(),
    clearPipeline: vi.fn(),
    handleLevels: vi.fn(),
  } as unknown as LevelMonitor;

  const resourceMonitor = {
    trackPipeline: vi.fn(),
    untrackPipeline: vi.fn(),
  } as unknown as ResourceMonitor;

  const eventLogger = {
    log: vi.fn(),
  } as unknown as EventLogger;

  return { levelMonitor, resourceMonitor, eventLogger };
}

function makeConfigStore(): ConfigStore {
  return {
    get: vi.fn(() => ({
      audio: {
        channels: [],
        levelMetering: { intervalMs: 50 },
      },
    })),
    update: vi.fn(() => ({ success: true })),
  } as unknown as ConfigStore;
}

function makeManager(options: {
  sources: FileSource[];
  initialState?: "streaming" | "stopped" | "crashed";
} = { sources: [] }) {
  const bus = makePipelineEventBus();
  const { pipelineManager, mocks, createdPipelines, pipelinePids } = makePipelineManagerMock(bus, {
    initialState: options.initialState,
  });
  const sourceRegistry = makeSourceRegistry(options.sources);
  const { levelMonitor, resourceMonitor, eventLogger } = makeStubMonitors();
  const configStore = makeConfigStore();

  const manager = new ChannelManager(
    pipelineManager,
    sourceRegistry,
    levelMonitor,
    resourceMonitor,
    eventLogger,
    configStore,
  );
  return { manager, bus, mocks, createdPipelines, pipelinePids, pipelineManager, sourceRegistry };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChannelManager - single-pipeline-per-channel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("addSource on stopped channel + autoStart=true -> createPipeline once with 1 source", async () => {
    const sourceA = makeFileSource("src-a", "A", true);
    const { manager, mocks, createdPipelines } = makeManager({ sources: [sourceA] });

    const channel = manager.createChannel("ch1", "stereo");
    // Default autoStart=true is set in createChannel; status starts "stopped".
    await manager.addSource(channel.id, {
      sourceId: "src-a",
      selectedChannels: [0],
      gain: 1,
      muted: false,
      delayMs: 0,
    });

    expect(mocks.createPipeline).toHaveBeenCalledTimes(1);
    expect(createdPipelines.length).toBe(1);
    expect(createdPipelines[0].config.sources.length).toBe(1);
    expect(createdPipelines[0].config.sources[0].mixerPadName).toBe("mix.sink_0");
    expect(manager.getChannelPipelineIds(channel.id).length).toBe(1);
  });

  it("addSource on running channel -> replacePipeline with N+1 sources", async () => {
    const sourceA = makeFileSource("src-a", "A", true);
    const sourceB = makeFileSource("src-b", "B", true);
    const { manager, mocks, createdPipelines } = makeManager({ sources: [sourceA, sourceB] });

    const channel = manager.createChannel("ch1", "stereo");
    await manager.addSource(channel.id, {
      sourceId: "src-a",
      selectedChannels: [0],
      gain: 1,
      muted: false,
      delayMs: 0,
    });
    // Channel now has pipeline-1 with 1 source. Force "streaming" status to
    // exercise the running-channel branch in addSource.
    (manager.getChannel(channel.id) as { status: string }).status = "streaming";

    await manager.addSource(channel.id, {
      sourceId: "src-b",
      selectedChannels: [1],
      gain: 1,
      muted: false,
      delayMs: 0,
    });

    expect(mocks.replacePipeline).toHaveBeenCalledTimes(1);
    const lastConfig = createdPipelines[createdPipelines.length - 1].config;
    expect(lastConfig.sources.length).toBe(2);
    expect(lastConfig.sources[0].mixerPadName).toBe("mix.sink_0");
    expect(lastConfig.sources[1].mixerPadName).toBe("mix.sink_1");
  });

  it("removeSource down to 0 sources on running channel -> removePipeline (NOT replacePipeline)", async () => {
    const sourceA = makeFileSource("src-a", "A", true);
    const { manager, mocks } = makeManager({ sources: [sourceA] });

    const channel = manager.createChannel("ch1", "stereo");
    await manager.addSource(channel.id, {
      sourceId: "src-a",
      selectedChannels: [0],
      gain: 1,
      muted: false,
      delayMs: 0,
    });
    (manager.getChannel(channel.id) as { status: string }).status = "streaming";

    mocks.replacePipeline.mockClear();
    mocks.removePipeline.mockClear();

    await manager.removeSource(channel.id, 0);

    expect(mocks.removePipeline).toHaveBeenCalledTimes(1);
    expect(mocks.replacePipeline).not.toHaveBeenCalled();
    expect(manager.getChannelPipelineIds(channel.id).length).toBe(0);
  });

  it("removeSource leaving 1+ on running channel -> replacePipeline once", async () => {
    const sourceA = makeFileSource("src-a", "A", true);
    const sourceB = makeFileSource("src-b", "B", true);
    const { manager, mocks, createdPipelines } = makeManager({ sources: [sourceA, sourceB] });

    const channel = manager.createChannel("ch1", "stereo");
    await manager.addSource(channel.id, {
      sourceId: "src-a", selectedChannels: [0], gain: 1, muted: false, delayMs: 0,
    });
    (manager.getChannel(channel.id) as { status: string }).status = "streaming";
    await manager.addSource(channel.id, {
      sourceId: "src-b", selectedChannels: [1], gain: 1, muted: false, delayMs: 0,
    });

    mocks.replacePipeline.mockClear();
    await manager.removeSource(channel.id, 0);

    expect(mocks.replacePipeline).toHaveBeenCalledTimes(1);
    const lastConfig = createdPipelines[createdPipelines.length - 1].config;
    expect(lastConfig.sources.length).toBe(1);
    expect(lastConfig.sources[0].assignment.sourceId).toBe("src-b");
  });

  it("reorderSources on running channel -> replacePipeline with permuted sources", async () => {
    const sourceA = makeFileSource("src-a", "A", true);
    const sourceB = makeFileSource("src-b", "B", true);
    const { manager, mocks, createdPipelines } = makeManager({ sources: [sourceA, sourceB] });

    const channel = manager.createChannel("ch1", "stereo");
    await manager.addSource(channel.id, {
      sourceId: "src-a", selectedChannels: [0], gain: 1, muted: false, delayMs: 0,
    });
    (manager.getChannel(channel.id) as { status: string }).status = "streaming";
    await manager.addSource(channel.id, {
      sourceId: "src-b", selectedChannels: [1], gain: 1, muted: false, delayMs: 0,
    });

    mocks.replacePipeline.mockClear();
    await manager.reorderSources(channel.id, [1, 0]);

    expect(mocks.replacePipeline).toHaveBeenCalledTimes(1);
    const lastConfig = createdPipelines[createdPipelines.length - 1].config;
    expect(lastConfig.sources[0].assignment.sourceId).toBe("src-b");
    expect(lastConfig.sources[0].mixerPadName).toBe("mix.sink_0");
    expect(lastConfig.sources[1].assignment.sourceId).toBe("src-a");
    expect(lastConfig.sources[1].mixerPadName).toBe("mix.sink_1");
  });

  it("updateSource gain on running channel -> replacePipeline with new gain", async () => {
    const sourceA = makeFileSource("src-a", "A", true);
    const { manager, mocks, createdPipelines } = makeManager({ sources: [sourceA] });

    const channel = manager.createChannel("ch1", "stereo");
    await manager.addSource(channel.id, {
      sourceId: "src-a", selectedChannels: [0], gain: 1, muted: false, delayMs: 0,
    });
    (manager.getChannel(channel.id) as { status: string }).status = "streaming";

    mocks.replacePipeline.mockClear();
    await manager.updateSource(channel.id, 0, { gain: 0.5 });

    expect(mocks.replacePipeline).toHaveBeenCalledTimes(1);
    const lastConfig = createdPipelines[createdPipelines.length - 1].config;
    expect(lastConfig.sources[0].assignment.gain).toBe(0.5);
  });

  it("invariant: channelPipelines.size matches running channel count across lifecycle", async () => {
    const sourceA = makeFileSource("src-a", "A", true);
    const { manager } = makeManager({ sources: [sourceA] });

    const ch1 = manager.createChannel("ch1", "stereo");
    const ch2 = manager.createChannel("ch2", "stereo");
    const ch3 = manager.createChannel("ch3", "stereo");

    await manager.addSource(ch1.id, {
      sourceId: "src-a", selectedChannels: [0], gain: 1, muted: false, delayMs: 0,
    });
    await manager.addSource(ch2.id, {
      sourceId: "src-a", selectedChannels: [0], gain: 1, muted: false, delayMs: 0,
    });
    // ch3 left empty
    expect(manager.getChannelPipelineIds(ch1.id).length).toBe(1);
    expect(manager.getChannelPipelineIds(ch2.id).length).toBe(1);
    expect(manager.getChannelPipelineIds(ch3.id).length).toBe(0);

    await manager.stopChannel(ch1.id);
    expect(manager.getChannelPipelineIds(ch1.id).length).toBe(0);
    expect(manager.getChannelPipelineIds(ch2.id).length).toBe(1);

    await manager.removeChannel(ch2.id);
    expect(manager.getChannelPipelineIds(ch2.id).length).toBe(0);
    // No leftover entries -- reverse map must be empty too
    expect(manager.getPipelineToChannelMap().size).toBe(0);
  });

  it("invariant violation throws when Map has duplicate pipelineId values", async () => {
    const sourceA = makeFileSource("src-a", "A", true);
    const { manager } = makeManager({ sources: [sourceA] });

    const ch1 = manager.createChannel("ch1", "stereo");
    const ch2 = manager.createChannel("ch2", "stereo");
    // Disable autoStart so addSource on stopped channel hits the no-op branch
    // (persist only) and falls through to assertSinglePipelinePerChannel,
    // exposing the poisoned Map without overwriting it via createPipeline.
    manager.updateChannel(ch1.id, { autoStart: false });
    manager.updateChannel(ch2.id, { autoStart: false });

    const internal = manager as unknown as { channelPipelines: Map<string, string> };
    internal.channelPipelines.set(ch1.id, "shared-pipeline-id");
    internal.channelPipelines.set(ch2.id, "shared-pipeline-id");

    await expect(async () => {
      await manager.addSource(ch1.id, {
        sourceId: "src-a", selectedChannels: [0], gain: 1, muted: false, delayMs: 0,
      });
    }).rejects.toThrow(/INVARIANT VIOLATED/);
  });

  it("file-loop trigger fires on clean EOS for all-file+loop channel", async () => {
    vi.useFakeTimers();
    const sourceA = makeFileSource("src-a", "A", true);
    const { manager, bus, mocks } = makeManager({ sources: [sourceA] });

    const channel = manager.createChannel("ch1", "stereo");
    await manager.addSource(channel.id, {
      sourceId: "src-a", selectedChannels: [0], gain: 1, muted: false, delayMs: 0,
    });
    (manager.getChannel(channel.id) as { status: string }).status = "streaming";

    const pipelineId = manager.getChannelPipelineIds(channel.id)[0];
    expect(pipelineId).toBeDefined();

    mocks.replacePipeline.mockClear();

    // Emit pipeline-exit: code=0, wasStopRequested=false
    bus.emit("pipeline-exit", pipelineId, 0, null, false);

    // Timer pending; not yet fired
    expect(mocks.replacePipeline).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);

    expect(mocks.replacePipeline).toHaveBeenCalledTimes(1);
  });

  it("file-loop does NOT fire on user stop (wasStopRequested=true)", async () => {
    vi.useFakeTimers();
    const sourceA = makeFileSource("src-a", "A", true);
    const { manager, bus, mocks } = makeManager({ sources: [sourceA] });

    const channel = manager.createChannel("ch1", "stereo");
    await manager.addSource(channel.id, {
      sourceId: "src-a", selectedChannels: [0], gain: 1, muted: false, delayMs: 0,
    });
    (manager.getChannel(channel.id) as { status: string }).status = "streaming";

    const pipelineId = manager.getChannelPipelineIds(channel.id)[0];
    expect(pipelineId).toBeDefined();

    mocks.replacePipeline.mockClear();

    bus.emit("pipeline-exit", pipelineId, 0, null, true);
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.replacePipeline).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // ResourceMonitor wiring (latent bug #1: trackPipeline never called)
  // -------------------------------------------------------------------------

  it("emits trackPipeline with PID on pipeline state -> connecting (initial start)", async () => {
    const sourceA = makeFileSource("src-a", "A", true);
    const { manager, bus, pipelinePids, mocks } = makeManager({ sources: [sourceA] });

    const trackPipeline = vi.mocked(
      (manager as unknown as { resourceMonitor: { trackPipeline: ReturnType<typeof vi.fn> } })
        .resourceMonitor.trackPipeline,
    );

    const channel = manager.createChannel("ch1", "stereo");
    await manager.addSource(channel.id, {
      sourceId: "src-a", selectedChannels: [0], gain: 1, muted: false, delayMs: 0,
    });

    const pipelineId = manager.getChannelPipelineIds(channel.id)[0];
    expect(pipelineId).toBeDefined();

    expect(trackPipeline).not.toHaveBeenCalled();

    bus.emit("pipeline-state-change", pipelineId, "connecting");

    expect(trackPipeline).toHaveBeenCalledTimes(1);
    expect(trackPipeline).toHaveBeenCalledWith(pipelineId, pipelinePids.get(pipelineId));
    expect(mocks.getPipelinePid).toHaveBeenCalledWith(pipelineId);
  });

  it("re-tracks resource on respawn (same pipelineId, new PID)", async () => {
    const sourceA = makeFileSource("src-a", "A", true);
    const { manager, bus, pipelinePids } = makeManager({ sources: [sourceA] });

    const trackPipeline = vi.mocked(
      (manager as unknown as { resourceMonitor: { trackPipeline: ReturnType<typeof vi.fn> } })
        .resourceMonitor.trackPipeline,
    );

    const channel = manager.createChannel("ch1", "stereo");
    await manager.addSource(channel.id, {
      sourceId: "src-a", selectedChannels: [0], gain: 1, muted: false, delayMs: 0,
    });

    const pipelineId = manager.getChannelPipelineIds(channel.id)[0];
    bus.emit("pipeline-state-change", pipelineId, "connecting");
    const firstCallPid = trackPipeline.mock.calls[0][1] as number;

    // Simulate respawn: same pipelineId, new PID assigned by pipeline-manager.
    pipelinePids.set(pipelineId, firstCallPid + 999);
    bus.emit("pipeline-state-change", pipelineId, "connecting");

    expect(trackPipeline).toHaveBeenCalledTimes(2);
    expect(trackPipeline.mock.calls[1][0]).toBe(pipelineId);
    expect(trackPipeline.mock.calls[1][1]).toBe(firstCallPid + 999);
  });

  it("skips trackPipeline silently when getPipelinePid returns null", async () => {
    const sourceA = makeFileSource("src-a", "A", true);
    const { manager, bus, mocks } = makeManager({ sources: [sourceA] });

    const trackPipeline = vi.mocked(
      (manager as unknown as { resourceMonitor: { trackPipeline: ReturnType<typeof vi.fn> } })
        .resourceMonitor.trackPipeline,
    );

    const channel = manager.createChannel("ch1", "stereo");
    await manager.addSource(channel.id, {
      sourceId: "src-a", selectedChannels: [0], gain: 1, muted: false, delayMs: 0,
    });

    const pipelineId = manager.getChannelPipelineIds(channel.id)[0];
    mocks.getPipelinePid.mockReturnValueOnce(null);
    trackPipeline.mockClear();

    bus.emit("pipeline-state-change", pipelineId, "connecting");

    expect(trackPipeline).not.toHaveBeenCalled();
  });

  it("untrack still fires for OLD pipelineId on replacePipeline (swap path)", async () => {
    const sourceA = makeFileSource("src-a", "A", true);
    const sourceB = makeFileSource("src-b", "B", true);
    const { manager, bus } = makeManager({ sources: [sourceA, sourceB] });

    const untrackPipeline = vi.mocked(
      (manager as unknown as { resourceMonitor: { untrackPipeline: ReturnType<typeof vi.fn> } })
        .resourceMonitor.untrackPipeline,
    );

    const channel = manager.createChannel("ch1", "stereo");
    await manager.addSource(channel.id, {
      sourceId: "src-a", selectedChannels: [0], gain: 1, muted: false, delayMs: 0,
    });
    const oldPipelineId = manager.getChannelPipelineIds(channel.id)[0];
    bus.emit("pipeline-state-change", oldPipelineId, "connecting");

    (manager.getChannel(channel.id) as { status: string }).status = "streaming";
    untrackPipeline.mockClear();

    await manager.addSource(channel.id, {
      sourceId: "src-b", selectedChannels: [1], gain: 1, muted: false, delayMs: 0,
    });

    expect(untrackPipeline).toHaveBeenCalledWith(oldPipelineId);
  });

  // -------------------------------------------------------------------------
  // MAX_RESTARTS_EXCEEDED zombie cleanup (latent bug #2)
  // -------------------------------------------------------------------------

  it("MAX_RESTARTS_EXCEEDED triggers stopChannel cleanup (removePipeline + map cleared)", async () => {
    const sourceA = makeFileSource("src-a", "A", true);
    const { manager, bus, mocks } = makeManager({ sources: [sourceA] });

    const channel = manager.createChannel("ch1", "stereo");
    await manager.addSource(channel.id, {
      sourceId: "src-a", selectedChannels: [0], gain: 1, muted: false, delayMs: 0,
    });
    (manager.getChannel(channel.id) as { status: string }).status = "streaming";

    const pipelineId = manager.getChannelPipelineIds(channel.id)[0];
    expect(pipelineId).toBeDefined();
    mocks.removePipeline.mockClear();

    bus.emit("pipeline-error", pipelineId, {
      code: "MAX_RESTARTS_EXCEEDED",
      message: "exceeded",
      technicalDetails: "test",
      timestamp: Date.now(),
    });

    // stopChannel awaits pipelineManager.removePipeline -- give the promise a tick.
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mocks.removePipeline).toHaveBeenCalledWith(pipelineId);
    expect(manager.getChannelPipelineIds(channel.id).length).toBe(0);
    expect(manager.getPipelineToChannelMap().size).toBe(0);
  });

  it("MAX_RESTARTS_EXCEEDED logs auto-stopped reason and clears resource tracking", async () => {
    const sourceA = makeFileSource("src-a", "A", true);
    const { manager, bus } = makeManager({ sources: [sourceA] });

    const eventLogger = (manager as unknown as { eventLogger: { log: ReturnType<typeof vi.fn> } }).eventLogger;
    const untrackPipeline = vi.mocked(
      (manager as unknown as { resourceMonitor: { untrackPipeline: ReturnType<typeof vi.fn> } })
        .resourceMonitor.untrackPipeline,
    );

    const channel = manager.createChannel("ch1", "stereo");
    await manager.addSource(channel.id, {
      sourceId: "src-a", selectedChannels: [0], gain: 1, muted: false, delayMs: 0,
    });
    (manager.getChannel(channel.id) as { status: string }).status = "streaming";

    const pipelineId = manager.getChannelPipelineIds(channel.id)[0];
    eventLogger.log.mockClear();
    untrackPipeline.mockClear();

    bus.emit("pipeline-error", pipelineId, {
      code: "MAX_RESTARTS_EXCEEDED",
      message: "exceeded",
      technicalDetails: "test",
      timestamp: Date.now(),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    const messages = eventLogger.log.mock.calls.map((c) => (c[0] as { message: string }).message);
    expect(messages).toContain("Channel auto-stopped: pipeline exceeded max restart attempts");
    expect(untrackPipeline).toHaveBeenCalledWith(pipelineId);
  });
});
