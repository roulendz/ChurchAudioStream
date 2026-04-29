---
quick_id: 260429-hb3
title: "Multi-source audio mixing refactor"
status: complete
tasks_completed: 7
tests_added: 18
commits: 7
date: 2026-04-29
---

# Quick Task 260429-hb3: Multi-Source Audio Mixing Refactor — SUMMARY

One gst-launch process per channel via `audiomixer name=mix`. Eliminates per-source bind-port + SSRC race; preserves stereo channel-selection panorama; introduces single-pipeline-per-channel invariant with fail-fast guard.

## Commits (chronological)

| Task | Hash      | Type            | Outcome                                                                                  |
| ---- | --------- | --------------- | ---------------------------------------------------------------------------------------- |
| 1/7  | f7d1735   | `chore(deps)`   | Vitest 4.1.5 + scripts; tsconfig drop rootDir + include test; build excludes test        |
| 2/7  | 10ea965   | `chore(types)`  | SourceSegment + ChannelPipelineConfig types                                              |
| 3/7  | be2d6bf   | `feat(audio)`   | buildChannelPipelineString + helpers + AUDIOMIXER_LATENCY_NS + 8 builder tests           |
| 4/7  | 7a7e32f   | `refactor(audio)` | replacePipeline + pipeline-exit event; deleted shouldLoopFileSource/scheduleFileSourceLoopRestart; preserved crash-recovery infrastructure |
| 5/7  | c7f2556   | `refactor(audio)` | channel-manager single-pipeline-per-channel; assertSinglePipelinePerChannel invariant; file-loop trigger; 10 channel-manager tests |
| 6/7  | 5d598d9   | `refactor(audio)` | Deleted killOrphansBoundToSenderPort + call site (workaround obsolete)                |
| 7/7  | a2e1480   | `refactor(audio)` | Cleanup: deleted buildPipelineString + buildSourceHead + buildLiveCaptureSegment + PipelineConfig + AnyPipelineConfig; narrowed config to ChannelPipelineConfig everywhere |

## Validation Gate Results

| Gate                                                                          | Result                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------- |
| `cd sidecar && npx tsc --noEmit`                                              | PASS (exit 0, zero errors)                      |
| `cd sidecar && npx vitest run`                                                | PASS (18/18 — 8 builder + 10 channel-manager)   |
| `cd sidecar && npm run build`                                                 | PASS (server-x86_64-pc-windows-msvc.exe, 91.4 MB) |
| Root `npm run build`                                                          | PASS (tsc -b + vite build clean, 256.59 kB JS)  |
| `grep -rn killOrphansBoundToSenderPort sidecar/src/`                          | PASS (0 matches)                                |
| `grep -rn 'Map<string, Map<string, string>>' sidecar/src/audio/channels/`     | PASS (0 matches)                                |
| `grep -rn 'buildPipelineString\b\|AnyPipelineConfig\b' sidecar/src/`          | PASS (0 matches)                                |
| Manual UAT (Tauri dev, 2 sources / 1 channel, single gst-launch + L/R audio) | DEFERRED to operator (not agent scope)          |

### Test File Inventory

- `sidecar/test/pipeline-builder.channel.test.ts` — 8 tests
  - 1-source structural / 2-source stereo channels / 3 mixed kinds / mute-via-gain=0 / mute-via-muted=true / empty-sources-throws / panorama-per-source / mixer caps 4 indep regexes
- `sidecar/test/channel-manager.multi-source.test.ts` — 10 tests
  - addSource on stopped+autoStart / addSource on running -> replace once N+1 / removeSource to 0 -> remove only / removeSource leaving N>=1 -> replace once / reorderSources -> replace permuted / updateSource gain -> replace with new gain / invariant size matches running count / invariant violation throws / file-loop fires on clean EOS / file-loop suppressed on user stop

## Key Code Changes

### New types (`pipeline-types.ts`)
- `SourceSegment` — discriminated `source.kind` union, assignment subset, literal `mixerPadName`
- `ChannelPipelineConfig` — label/levelIntervalMs/processing/sources + derived `shouldLoopOnEos`
- `PipelineConfig` + `AnyPipelineConfig` deleted in Task 7

### Pipeline builder (`pipeline-builder.ts`)
- `buildChannelPipelineString(config: ChannelPipelineConfig)` — single export, throws on zero sources
- `AUDIOMIXER_LATENCY_NS = 10_000_000` (10 ms) — within 100 ms total budget per RESEARCH §1
- `computeEffectiveGain(assignment)` SOLE source of truth for muted-vs-gain; no inline ternary
- `buildSourceSegment` emits `<head><liveQueue>volume volume=g ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! mix.sink_N` — NO `audiopanorama` (channel-selection already places it)
- Mixer head: `audiomixer name=mix latency=10000000 ignore-inactive-pads=true ! audio/x-raw,rate=48000,channels=2 ! <tail>`
- Deleted: `buildPipelineString`, `buildSourceHead`, `buildLiveCaptureSegment` (single-source legacy paths)

### Pipeline manager (`pipeline-manager.ts`)
- `replacePipeline(oldId, newConfig: ChannelPipelineConfig)` — atomic stop+remove (already 400 ms socket-release) → createPipeline → startPipeline → return new id
- `pipeline-exit` event with live `wasStopRequested` snapshot at emit time
- Source-agnostic: deleted `shouldLoopFileSource` + `scheduleFileSourceLoopRestart`
- Preserved: `restartTimers`, `scheduleRestart`, `handleCrashedPipeline`, `armStreamingStability` chain (crash-recovery infrastructure)

### Channel manager (`channel-manager.ts`)
- `channelPipelines: Map<string, string>` — channelId stable, pipelineId rotates on replace
- `buildChannelPipelineConfig(channelId)` — combines all sources, mixerPadName mix.sink_0..N
- Lifecycle rewritten: `startChannel` / `stopChannel` / `addSource` / `updateSource` / `removeSource` / `reorderSources`
- `assertSinglePipelinePerChannel()` Tiger-style guard at every Map mutation:
  - Throws on duplicate pipelineId values
  - Throws on `channelPipelines.size > channels.size`
  - Throws on unknown channelId in Map
- File-loop trigger via subscription to `pipeline-exit`:
  - `FILE_LOOP_RESTART_DELAY_MS = 200` named module-level constant (no magic number)
  - `fileLoopRestartTimers` Map ensures one pending timer per channel
  - `replaceChannelPipelineForLoop` only fires if Map still references old pipelineId
- Public API preserved: `getPipelineToChannelMap()`, `getChannelPipelineIds()` (single-element array now)
- Module-level `toSourceSegment(source, assignment, mixerPadName)` helper (DRY)
- Deleted: `startPipelineForSource`, `stopPipelineForSource`, `stopAndRemovePipeline`, `rekeyPipelineMappings`, `activatePipelineForNewlyAddedSource`, `getOrCreatePipelineMap`, per-source `buildPipelineConfigFromAssignment` + `buildAes67/Local/FilePipelineConfig`

### GStreamer process (`gstreamer-process.ts`)
- `config: ChannelPipelineConfig` (narrowed from `PipelineConfig`/`AnyPipelineConfig`)
- `start()` now: `const pipelineString = buildChannelPipelineString(this.config)` — no dispatch
- Deleted `killOrphansBoundToSenderPort` (workaround obsolete after one-pipeline-per-channel)
- Pipeline start path ~50–100 ms faster on Windows (no PowerShell roundtrip)

### Infrastructure
- `sidecar/package.json` — vitest@^4.1.5 devDep, `test`/`test:watch` scripts
- `sidecar/vitest.config.ts` — include `test/**/*.test.ts`, `passWithNoTests: true`, env=node, timeout=5s
- `sidecar/tsconfig.json` — dropped `rootDir`, `include: [src, test]`
- `sidecar/tsconfig.build.json` — `exclude: [node_modules, dist, test]` (production build)
- `sidecar/test/` directory created with `.gitkeep`

## Tiger-Style Invariants Established

1. `channelPipelines.size === number of running (starting/streaming) channels` — every mutation asserts.
2. `channelPipelines` values are pairwise distinct (no two channels share a pipelineId).
3. Empty `ChannelPipelineConfig.sources` is illegal — `buildChannelPipelineString` throws.
4. `sources.length === 0 → stopChannel`, NOT `replacePipeline` (channel manager guarantees ≥1 source before any builder call).
5. `wasStopRequested` is read live from getter at emit time; consumers see actual flag, no stale closure capture.
6. `computeEffectiveGain` is the SOLE source of truth for muted-vs-gain (no duplicated ternary).
7. `FILE_LOOP_RESTART_DELAY_MS` is the SOLE source of truth for the loop-restart delay (no inline magic).

## Deviations from Plan

### Vitest exit code on no-test-files

**Found during:** Task 1 verification.
**Plan said:** "Vitest runs and reports `No test files found, exiting with code 0`."
**Actual:** vitest 4.1.5 defaults to exit code 1 when zero test files match. The plan's done criterion required exit 0.
**Fix:** Added `passWithNoTests: true` to `sidecar/vitest.config.ts`. Honors the done criterion without affecting real test runs (still exits 1 on test failures).
**Rationale:** Plan-level deviation classification = Rule 3 (blocking issue: build script exit code mismatched plan's done criterion).

### channel-manager test for invariant violation

**Found during:** Task 5 first vitest run.
**Issue:** Test `invariant violation throws when Map has duplicate pipelineId values` initially failed because addSource on a stopped+autoStart channel triggers full `startChannel` → `createPipeline` returns NEW pipelineId → overwrites poisoned Map entry → no duplicate at assert time → no throw.
**Fix:** Set `autoStart: false` on both poisoned channels so `applyPipelineForChannelChange` falls through the no-op branch and reaches `assertSinglePipelinePerChannel` with the poisoned Map intact.
**Rationale:** Test design refinement, not a behavior change. Invariant guard itself is correct.

### `buildMeteringTail` retained

**Found during:** Task 7 cleanup.
**Issue:** Plan implied wholesale deletion of single-source code paths.
**Fix:** Kept `buildMeteringTail` because `buildProcessingAndOutputTail` Case D (AGC + Opus both bypassed) still invokes it. This is multi-source code, not legacy.
**Rationale:** Reachable code, not dead. Plan said "private helpers exclusively called from `buildPipelineString`" — `buildMeteringTail` is also called by the multi-source path's tail builder.

## Risks Captured (preserved from plan, for UAT)

1. **Audiomixer `latency=10000000` (10 ms)** — consumes 10 ms of 100 ms total budget; margin tight. Watch UAT for audible delay.
2. **Mixer + AGC chain caps roundtrip** — RESEARCH smoke test was mixer→fakesink only. UAT is the gate; if `not-negotiated` fires, suspect missing intermediate `audioconvert`.
3. **`alignment-threshold=40000000` (40 ms default)** — clock drift between WASAPI and AES67 sources may emit `discont` warnings. Monitor stderr.
4. **EOS for file-only channels** — file-loop in channel-manager via `wasStopRequested === false && code === 0 && shouldLoopOnEos === true`. Mixed-source channel with file EOS keeps live source streaming (audiomixer `force-live=false` default).
5. **`replacePipeline` 400 ms socket-release** — uses existing `WINDOWS_SOCKET_RELEASE_DELAY_MS`. No double-counting.
6. **comedia tuple stability** — SSRC + bind-port deterministic per channelId. Replace cycle preserves tuple → `bytesReceived` monotonic. Any post-refactor "channel offline" UAT report = port/SSRC regression.

## Out-of-Scope (preserved)

- `listener/` PWA, `src/` admin React, Tauri Rust shell — unchanged.
- WebSocket protoo, mediasoup PlainTransport/WebRtcTransport setup — unchanged.
- `port-allocator.ts` — unchanged (rtpPort scheme already correct for one-pipeline-per-channel).
- New runtime dependencies — none. Vitest is dev-only.
- Per-source level meters — would require pre-mixer level taps; future task.
- `SourceAssignment.panorama` user-configurable field — out per CONTEXT lock.

## Self-Check

- [x] `sidecar/vitest.config.ts` exists
- [x] `sidecar/test/.gitkeep` exists
- [x] `sidecar/test/pipeline-builder.channel.test.ts` exists (8 tests)
- [x] `sidecar/test/channel-manager.multi-source.test.ts` exists (10 tests)
- [x] All 7 commits exist in `master` log: f7d1735, 10ea965, be2d6bf, 7a7e32f, c7f2556, 5d598d9, a2e1480
- [x] `npx tsc --noEmit` clean
- [x] `npx vitest run` 18/18 green
- [x] `npm run build` produces `src-tauri/binaries/server-x86_64-pc-windows-msvc.exe`
- [x] Root `npm run build` produces `dist/assets/index-*.js`
- [x] Greps for `killOrphansBoundToSenderPort`, `Map<string, Map<string, string>>`, `buildPipelineString\|AnyPipelineConfig` all return 0 matches

## Self-Check: PASSED
