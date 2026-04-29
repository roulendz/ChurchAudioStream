/**
 * Integration test: spawn an ACTUAL gst-launch-1.0 process and verify the
 * multi-source channel mix produces audible left + right content.
 *
 * Why: pure pipeline-string tests confirm the string is well-formed but
 * cannot catch GStreamer-side runtime failures (e.g. duplicate element
 * names like `deinterleave name=d` colliding when 2 segments share one
 * pipeline -- parser silently drops one and only the first source plays).
 *
 * What this test catches that string tests cannot:
 *   - element-name collisions across segments
 *   - caps negotiation failures between segment tail and audiomixer sink
 *   - runtime errors that gst-launch reports on stderr
 *   - silent-output regressions (one channel dead, one alive)
 *
 * SKIP CONDITIONS:
 *   - gst-launch-1.0 not on PATH (CI without GStreamer)
 *   - Node fs ops on temp dir fail
 */

import { describe, it, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildChannelPipelineString } from "../../src/audio/pipeline/pipeline-builder";
import type {
  ChannelPipelineConfig,
  SourceSegment,
  FilePipelineConfig,
} from "../../src/audio/pipeline/pipeline-types";
import type { ProcessingConfig } from "../../src/audio/processing/processing-types";

const PROCESSING: ProcessingConfig = {
  mode: "speech",
  agc: { enabled: false, targetLufs: -16, maxTruePeakDbtp: -2 },
  opus: {
    enabled: false,
    bitrateKbps: 96,
    frameSize: 20,
    fec: false,
    dtx: false,
    bitrateMode: "vbr",
    audioType: "voice",
  },
  rtpOutput: { rtpPort: 5004, rtcpPort: 5005, host: "127.0.0.1", ssrc: 1 },
};

const IS_WINDOWS = process.platform === "win32";

// Module-level probe + WAV generation: runs at TEST DEFINITION time so
// `it.runIf` sees the resolved boolean. `beforeAll` runs too late --
// vitest evaluates `runIf` while collecting tests, before any hooks fire.
const { gstAvailable, workDir, testStereoWavPath } = (() => {
  const probe = spawnSync("gst-launch-1.0", ["--version"], {
    encoding: "utf8",
    shell: IS_WINDOWS,
  });
  if (probe.status !== 0) {
    console.warn("[integration] gst-launch-1.0 not on PATH -- skipping integration tests");
    return { gstAvailable: false, workDir: "", testStereoWavPath: "" };
  }

  const dir = mkdtempSync(path.join(tmpdir(), "cas-mix-"));
  const wavPath = path.join(dir, "stereo-test.wav").replace(/\\/g, "/");

  // 3-second stereo test WAV: left=440Hz sine, right=1000Hz sine. Two
  // audiotestsrc instances -> interleave -> stereo WAV. Distinct freqs prove
  // each side carries independent content (per-channel content survival).
  const generatePipeline = [
    `audiotestsrc wave=sine freq=440 num-buffers=300 ! audio/x-raw,rate=48000,channels=1 ! interleave name=mk`,
    `audiotestsrc wave=sine freq=1000 num-buffers=300 ! audio/x-raw,rate=48000,channels=1 ! mk.`,
    `mk. ! audioconvert ! audio/x-raw,format=S16LE,rate=48000,channels=2 ! wavenc ! filesink location="${wavPath}"`,
  ].join(" ");

  const generated = spawnSync("gst-launch-1.0", ["-e", generatePipeline], {
    shell: IS_WINDOWS,
    encoding: "utf8",
    timeout: 15_000,
  });
  if (generated.status !== 0 || !existsSync(wavPath)) {
    console.warn("[integration] failed to generate test WAV -- skipping integration tests");
    console.warn(generated.stderr);
    return { gstAvailable: false, workDir: dir, testStereoWavPath: "" };
  }

  return { gstAvailable: true, workDir: dir, testStereoWavPath: wavPath };
})();

function fileSegment(
  filePath: string,
  selectedChannels: number[],
  mixerPadName: string,
): SourceSegment {
  const cfg: FilePipelineConfig = { filePath, loop: false, selectedChannels };
  return {
    source: { kind: "file", config: cfg },
    assignment: {
      sourceId: `src-${mixerPadName}`,
      gain: 1,
      muted: false,
      delayMs: 0,
    },
    mixerPadName,
  };
}

/**
 * Parse a 16-bit PCM stereo WAV file and compute per-channel RMS.
 * Returns { leftRms, rightRms } as 0..1 normalized values.
 *
 * Pure-JS, no deps. Assumes well-formed PCM16 stereo at 48kHz.
 * Skips the `data` chunk header dynamically (some encoders add LIST chunks
 * between fmt and data, so a fixed 44-byte offset is unsafe).
 */
function parseStereoWavRms(wavPath: string): { leftRms: number; rightRms: number; sampleCount: number } {
  const buf = readFileSync(wavPath);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Not a WAV file: ${wavPath}`);
  }

  // Walk chunks to find the data chunk
  let offset = 12;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
  }
  if (dataOffset < 0) {
    throw new Error(`No data chunk in ${wavPath}`);
  }

  let leftSumSq = 0;
  let rightSumSq = 0;
  let sampleCount = 0;
  // Stereo PCM16: 4 bytes per frame (2ch * 2 bytes)
  for (let i = dataOffset; i + 4 <= dataOffset + dataSize && i + 4 <= buf.length; i += 4) {
    const left = buf.readInt16LE(i) / 32768;
    const right = buf.readInt16LE(i + 2) / 32768;
    leftSumSq += left * left;
    rightSumSq += right * right;
    sampleCount++;
  }

  if (sampleCount === 0) return { leftRms: 0, rightRms: 0, sampleCount: 0 };
  return {
    leftRms: Math.sqrt(leftSumSq / sampleCount),
    rightRms: Math.sqrt(rightSumSq / sampleCount),
    sampleCount,
  };
}

/**
 * Run gst-launch-1.0 with the given pipeline string for `runMs` ms,
 * then EOS-kill it. Returns stderr for diagnostics.
 */
function runGstPipeline(
  pipelineString: string,
  runMs: number,
): Promise<{ stderr: string; exitCode: number | null }> {
  return new Promise<{ stderr: string; exitCode: number | null }>((resolve) => {
    const child = spawn("gst-launch-1.0", ["-e", pipelineString], {
      shell: IS_WINDOWS,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    const killTimer = setTimeout(() => {
      // EOS via stdin close on Windows, SIGINT on Unix (gst-launch -e converts to EOS).
      if (IS_WINDOWS) {
        try { child.stdin?.end(); } catch { /* already destroyed */ }
        // Force-kill after 2s if still alive
        setTimeout(() => {
          if (!child.killed && child.pid !== undefined) {
            try { spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)]); } catch { /* best-effort */ }
          }
        }, 2_000);
      } else {
        child.kill("SIGINT");
        setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 2_000);
      }
    }, runMs);
    child.on("exit", (code) => {
      clearTimeout(killTimer);
      resolve({ stderr, exitCode: code });
    });
  });
}

describe("integration: multi-source channel mix produces audible left + right", () => {
  it.runIf(gstAvailable)(
    "2 file segments (Ch:0 left, Ch:1 right of same stereo file) produce non-silent stereo output",
    async () => {
      const outputWavPath = path.join(workDir, "mix-output.wav").replace(/\\/g, "/");

      // Two segments referencing the same stereo source, each extracting one channel.
      // Source A pulls left channel (440Hz) -> pans hard-left.
      // Source B pulls right channel (1000Hz) -> pans hard-right.
      const cfg: ChannelPipelineConfig = {
        label: "integration-2src",
        levelIntervalMs: 50,
        processing: PROCESSING,
        sources: [
          fileSegment(testStereoWavPath, [0], "mix.sink_0"),
          fileSegment(testStereoWavPath, [1], "mix.sink_1"),
        ],
        shouldLoopOnEos: false,
      };

      // Override tail: dump mixer output to a WAV file we can inspect.
      const tailOverride = `audioconvert ! audio/x-raw,format=S16LE,rate=48000,channels=2 ! wavenc ! filesink location="${outputWavPath}"`;
      const pipelineString = buildChannelPipelineString(cfg, tailOverride);

      const result = await runGstPipeline(pipelineString, 2_000);

      // Hard fail if gst-launch reported a parser error (e.g. duplicate element names).
      expect(result.stderr).not.toMatch(/erroneous pipeline/i);
      expect(result.stderr).not.toMatch(/more than one element with name/i);

      // File must exist and have non-trivial content.
      expect(existsSync(outputWavPath)).toBe(true);
      const { leftRms, rightRms, sampleCount } = parseStereoWavRms(outputWavPath);
      expect(sampleCount).toBeGreaterThan(48000); // > 1 second at 48kHz

      const SILENCE_THRESHOLD = 0.01; // -40 dBFS-ish
      expect(leftRms).toBeGreaterThan(SILENCE_THRESHOLD);
      expect(rightRms).toBeGreaterThan(SILENCE_THRESHOLD);

      rmSync(outputWavPath, { force: true });
    },
    20_000,
  );

  it.runIf(gstAvailable)(
    "swapping source order swaps which segment lands on which mixer pad (and audio still plays)",
    async () => {
      const outputWavPath = path.join(workDir, "mix-swapped.wav").replace(/\\/g, "/");

      // Reverse the order: B first, A second. Both channels still must be audible.
      const cfg: ChannelPipelineConfig = {
        label: "integration-2src-swapped",
        levelIntervalMs: 50,
        processing: PROCESSING,
        sources: [
          fileSegment(testStereoWavPath, [1], "mix.sink_0"),
          fileSegment(testStereoWavPath, [0], "mix.sink_1"),
        ],
        shouldLoopOnEos: false,
      };

      const tailOverride = `audioconvert ! audio/x-raw,format=S16LE,rate=48000,channels=2 ! wavenc ! filesink location="${outputWavPath}"`;
      const pipelineString = buildChannelPipelineString(cfg, tailOverride);

      const result = await runGstPipeline(pipelineString, 2_000);
      expect(result.stderr).not.toMatch(/erroneous pipeline/i);
      expect(existsSync(outputWavPath)).toBe(true);

      const { leftRms, rightRms } = parseStereoWavRms(outputWavPath);
      expect(leftRms).toBeGreaterThan(0.01);
      expect(rightRms).toBeGreaterThan(0.01);

      rmSync(outputWavPath, { force: true });
    },
    20_000,
  );

  it.runIf(gstAvailable)(
    "muting one source still leaves the other audible (mute does not crash mixer)",
    async () => {
      const outputWavPath = path.join(workDir, "mix-muted.wav").replace(/\\/g, "/");

      const segMuted = fileSegment(testStereoWavPath, [0], "mix.sink_0");
      const segLive = fileSegment(testStereoWavPath, [1], "mix.sink_1");
      const cfg: ChannelPipelineConfig = {
        label: "integration-2src-muted",
        levelIntervalMs: 50,
        processing: PROCESSING,
        sources: [
          { ...segMuted, assignment: { ...segMuted.assignment, muted: true } },
          segLive,
        ],
        shouldLoopOnEos: false,
      };

      const tailOverride = `audioconvert ! audio/x-raw,format=S16LE,rate=48000,channels=2 ! wavenc ! filesink location="${outputWavPath}"`;
      const pipelineString = buildChannelPipelineString(cfg, tailOverride);

      const result = await runGstPipeline(pipelineString, 2_000);
      expect(result.stderr).not.toMatch(/erroneous pipeline/i);
      expect(existsSync(outputWavPath)).toBe(true);

      // Mixer mixes muted (silent) with the live source. The live source had
      // its [1] channel selected -> hard-right pan, so right side must carry
      // content. Left side may be near-silent (the muted seg + the panned-to-
      // right live seg). Strong assertion: right > silence threshold.
      const { rightRms } = parseStereoWavRms(outputWavPath);
      expect(rightRms).toBeGreaterThan(0.01);

      rmSync(outputWavPath, { force: true });
    },
    20_000,
  );
});
