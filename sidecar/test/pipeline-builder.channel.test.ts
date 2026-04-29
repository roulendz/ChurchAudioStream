/**
 * Tests for buildChannelPipelineString and helpers.
 *
 * Structural assertions only (RESEARCH §6) — no byte-equality with prior
 * single-source output. Tests survive benign refactors of attribute order.
 */

import { describe, it, expect } from "vitest";
import { buildChannelPipelineString } from "../src/audio/pipeline/pipeline-builder";
import type {
  ChannelPipelineConfig,
  SourceSegment,
  Aes67PipelineConfig,
  FilePipelineConfig,
  LocalPipelineConfig,
} from "../src/audio/pipeline/pipeline-types";
import type { ProcessingConfig } from "../src/audio/processing/processing-types";

const PROCESSING: ProcessingConfig = {
  mode: "speech",
  agc: { enabled: true, targetLufs: -16, maxTruePeakDbtp: -2 },
  opus: {
    enabled: true,
    bitrateKbps: 96,
    frameSize: 20,
    fec: false,
    dtx: false,
    bitrateMode: "vbr",
    audioType: "voice",
  },
  rtpOutput: { rtpPort: 5004, rtcpPort: 5005, host: "127.0.0.1", ssrc: 0xdeadbeef },
};

function fileSegment(
  filePath: string,
  selectedChannels: number[],
  mixerPadName: string,
  options: { gain?: number; muted?: boolean } = {},
): SourceSegment {
  const cfg: FilePipelineConfig = { filePath, loop: true, selectedChannels };
  return {
    source: { kind: "file", config: cfg },
    assignment: {
      sourceId: `src-${mixerPadName}`,
      gain: options.gain ?? 1,
      muted: options.muted ?? false,
      delayMs: 0,
    },
    mixerPadName,
  };
}

function localWasapi2Segment(
  deviceId: string,
  selectedChannels: number[],
  mixerPadName: string,
): SourceSegment {
  const cfg: LocalPipelineConfig = {
    deviceId,
    api: "wasapi2",
    selectedChannels,
    totalChannelCount: 2,
  };
  return {
    source: { kind: "local", config: cfg },
    assignment: {
      sourceId: `src-${mixerPadName}`,
      gain: 1,
      muted: false,
      delayMs: 0,
    },
    mixerPadName,
  };
}

function aes67Segment(
  selectedChannels: number[],
  mixerPadName: string,
): SourceSegment {
  const cfg: Aes67PipelineConfig = {
    multicastAddress: "239.69.0.1",
    port: 5004,
    sampleRate: 48000,
    channelCount: 8,
    bitDepth: 24,
    payloadType: 96,
    selectedChannels,
  };
  return {
    source: { kind: "aes67", config: cfg },
    assignment: {
      sourceId: `src-${mixerPadName}`,
      gain: 1,
      muted: false,
      delayMs: 0,
    },
    mixerPadName,
  };
}

describe("buildChannelPipelineString", () => {
  it("1 source (file mono): contains audiomixer with required props and exactly one mix.sink_", () => {
    const cfg: ChannelPipelineConfig = {
      label: "ch-1source",
      levelIntervalMs: 50,
      processing: PROCESSING,
      sources: [fileSegment("C:/a.mp3", [0], "mix.sink_0")],
      shouldLoopOnEos: true,
    };
    const out = buildChannelPipelineString(cfg);

    expect(out).toMatch(/audiomixer name=mix\b/);
    expect(out).toMatch(/\blatency=10000000\b/);
    expect(out).toMatch(/\bignore-inactive-pads=true\b/);
    const mixSinkRefs = out.match(/mix\.sink_\d+/g) ?? [];
    expect(mixSinkRefs.length).toBe(1);
    const filesrcRefs = out.match(/filesrc location=/g) ?? [];
    expect(filesrcRefs.length).toBe(1);
  });

  it("2 sources stereo channels [0]+[1]: two mix.sink_ refs, both panorama values present, no pre-mixer tee", () => {
    const cfg: ChannelPipelineConfig = {
      label: "ch-2src-stereo",
      levelIntervalMs: 50,
      processing: PROCESSING,
      sources: [
        fileSegment("C:/left.mp3", [0], "mix.sink_0"),
        fileSegment("C:/right.mp3", [1], "mix.sink_1"),
      ],
      shouldLoopOnEos: true,
    };
    const out = buildChannelPipelineString(cfg);

    expect(out).toMatch(/audiomixer name=mix\b/);
    expect(out).toMatch(/mix\.sink_0\b/);
    expect(out).toMatch(/mix\.sink_1\b/);
    const mixSinkRefs = out.match(/mix\.sink_\d+/g) ?? [];
    expect(mixSinkRefs.length).toBe(2);

    // Panorama from channel-selection (left=-1.0 for ch0, right=1.0 for ch1)
    expect(out).toMatch(/audiopanorama method=simple panorama=-1\.0/);
    expect(out).toMatch(/audiopanorama method=simple panorama=1\.0/);

    // Only the post-mixer metering tee is allowed; no per-source tee BEFORE mix.sink_*
    const teeIdx = out.indexOf("tee name=t");
    const firstMixSink = out.indexOf("mix.sink_");
    expect(teeIdx).toBeGreaterThan(-1);
    // tee appears in tail (placed before mix.sink references in string layout)
    expect(teeIdx).toBeLessThan(firstMixSink);
    // exactly one tee in entire string
    expect((out.match(/\btee name=t\b/g) ?? []).length).toBe(1);
  });

  it("3 mixed-kind sources (file + wasapi2 + aes67): three mix.sink_ refs and exactly one tail (audioloudnorm + opusenc)", () => {
    const cfg: ChannelPipelineConfig = {
      label: "ch-3src-mixed",
      levelIntervalMs: 50,
      processing: PROCESSING,
      sources: [
        fileSegment("C:/a.mp3", [0], "mix.sink_0"),
        localWasapi2Segment("{abc}", [0], "mix.sink_1"),
        aes67Segment([0, 1], "mix.sink_2"),
      ],
      shouldLoopOnEos: false,
    };
    const out = buildChannelPipelineString(cfg);

    expect(out).toMatch(/mix\.sink_0\b/);
    expect(out).toMatch(/mix\.sink_1\b/);
    expect(out).toMatch(/mix\.sink_2\b/);
    const mixSinkRefs = out.match(/mix\.sink_\d+/g) ?? [];
    expect(mixSinkRefs.length).toBe(3);

    expect((out.match(/\baudioloudnorm\b/g) ?? []).length).toBe(1);
    expect((out.match(/\bopusenc\b/g) ?? []).length).toBe(1);
  });

  it("mute via gain=0 emits volume volume=0", () => {
    const cfg: ChannelPipelineConfig = {
      label: "ch-mute-gain0",
      levelIntervalMs: 50,
      processing: PROCESSING,
      sources: [fileSegment("C:/a.mp3", [0], "mix.sink_0", { gain: 0, muted: false })],
      shouldLoopOnEos: true,
    };
    const out = buildChannelPipelineString(cfg);
    expect(out).toMatch(/volume volume=0\b/);
  });

  it("mute via muted=true overrides nonzero gain (computeEffectiveGain)", () => {
    const cfg: ChannelPipelineConfig = {
      label: "ch-mute-true",
      levelIntervalMs: 50,
      processing: PROCESSING,
      sources: [fileSegment("C:/a.mp3", [0], "mix.sink_0", { gain: 1, muted: true })],
      shouldLoopOnEos: true,
    };
    const out = buildChannelPipelineString(cfg);
    expect(out).toMatch(/volume volume=0\b/);
  });

  it("empty sources throws (channel-manager invariant)", () => {
    const cfg: ChannelPipelineConfig = {
      label: "ch-empty",
      levelIntervalMs: 50,
      processing: PROCESSING,
      sources: [],
      shouldLoopOnEos: false,
    };
    expect(() => buildChannelPipelineString(cfg)).toThrow(/zero sources/);
  });

  it("preserves panorama on each source independently for single-channel selection", () => {
    // Two file sources, one selects ch 0 (left, -1.0), the other selects ch 1 (right, 1.0)
    const cfg: ChannelPipelineConfig = {
      label: "ch-pan",
      levelIntervalMs: 50,
      processing: PROCESSING,
      sources: [
        fileSegment("C:/left.mp3", [0], "mix.sink_0"),
        fileSegment("C:/right.mp3", [1], "mix.sink_1"),
      ],
      shouldLoopOnEos: true,
    };
    const out = buildChannelPipelineString(cfg);
    // Each panorama present at least once
    expect((out.match(/panorama=-1\.0/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((out.match(/panorama=1\.0/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("throws when any source segment has delayMs > 0 (fail-loud, not silently ignored)", () => {
    const seg = fileSegment("C:/a.mp3", [0], "mix.sink_0");
    const segWithDelay: SourceSegment = {
      ...seg,
      assignment: { ...seg.assignment, delayMs: 50 },
    };
    const cfg: ChannelPipelineConfig = {
      label: "ch-delayms",
      levelIntervalMs: 50,
      processing: PROCESSING,
      sources: [segWithDelay],
      shouldLoopOnEos: true,
    };
    expect(() => buildChannelPipelineString(cfg)).toThrow(/delayMs not supported yet/);
  });

  it("mixer caps pinned: four independent regex matches survive attribute-order refactors", () => {
    const cfg: ChannelPipelineConfig = {
      label: "ch-caps",
      levelIntervalMs: 50,
      processing: PROCESSING,
      sources: [fileSegment("C:/a.mp3", [0], "mix.sink_0")],
      shouldLoopOnEos: true,
    };
    const out = buildChannelPipelineString(cfg);
    expect(out).toMatch(/audiomixer name=mix\b/);
    expect(out).toMatch(/\blatency=10000000\b/);
    expect(out).toMatch(/\bignore-inactive-pads=true\b/);
    expect(out).toMatch(/audio\/x-raw,rate=48000,channels=2\b/);
  });
});
