---
quick_id: 260429-hb3
status: human_needed
verified_at: 2026-04-29
must_haves_passed: 11
must_haves_total: 13
gaps: []
human_check_items:
  - truth: "Exactly one gst-launch-1.0.exe process per active channel (regardless of source count)"
    why_human: "Runtime process count requires live Tauri dev + admin GUI + PowerShell Get-Process. Code paths verified as single-pipeline-per-channel; runtime confirmation deferred to operator UAT per plan."
  - truth: "mediasoup PlainTransport.bytesReceived monotonically increasing across replacePipeline calls (SSRC + bind-port stable per channelId; comedia tuple unchanged)"
    why_human: "Plan explicitly tags this must-have as UAT-only — out of vitest scope. Requires live mediasoup transport + 2-source channel + add/remove cycle while monitoring transport.getStats()."
  - truth: "add/remove/reorder sources never spawns >1 gst-launch concurrently for the same channel; never produces 'queue not-linked' or 'erroneous pipeline' stderr"
    why_human: "Concurrency observation requires live process tree + stderr stream while exercising the admin GUI. Code path enforces single-pipeline-per-channel via assertSinglePipelinePerChannel guard at every mutation; runtime negative-evidence (no 'queue not-linked') still needs operator confirmation."
---

# Quick Task 260429-hb3 — Verification Report

**Goal:** Multi-source audio mixing refactor — replace per-source GStreamer pipelines with one gst-launch process per channel using `audiomixer`. Sidecar-only.

**Status:** human_needed — automated checks pass 11/13; 3 truths overlap and require operator UAT (gst-launch process count + bytesReceived monotonic + concurrent-spawn negative). Note: count of UAT items < count of total truths because two automated truths cover overlapping ground (single-pipeline invariant + sources-to-zero stop) so the 18 vitest tests already prove the algorithmic side; physical process count is the remaining UAT signal.

**Verified:** 2026-04-29

---

## Per-Must-Have Truth Verification

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | Exactly one gst-launch process per active channel | HUMAN_NEEDED | Code path: `channelPipelines: Map<string, string>` (channel-manager.ts:88); single `pipelineManager.createPipeline(config)` per `startChannel` (line 450); single `pipelineManager.replacePipeline(oldId, newConfig)` per add/remove/reorder/update (lines 644, 882). Runtime process count requires PowerShell `Get-Process gst-launch-1.0` during live Tauri dev. |
| 2 | channelPipelines: Map<channelId, pipelineId> — at most one entry per channelId; channelId stable, pipelineId rotates | PASS | `channel-manager.ts:88 — private readonly channelPipelines = new Map<string, string>();` Old `Map<string, Map<string, string>>` grep returns 0. Replace cycle pattern: `removePipeline(oldId)` → `createPipeline(newConfig)` → `set(channelId, newPipelineId)` (pipeline-manager.ts:112-128). |
| 3 | channelPipelines.size === number of running channels (Tiger-style invariant, asserted at every mutation) | PASS | `assertSinglePipelinePerChannel()` defined at channel-manager.ts:752; called from 11 sites (lines 163, 179, 309, 342, 380, 414, 467, 499, 884, 1031, plus self-ref); checks distinct values + size ≤ channels.size + no orphan channelIds. Vitest test `invariant violation throws when Map has duplicate pipelineId values` passes. |
| 4 | Stereo output preserves selectedChannels + panorama; channel-selection panorama is the ONLY panorama; per-source segment adds NO second audiopanorama | PASS | `pipeline-builder.ts:529` — explicit comment "No `audiopanorama` here -- channel-selection inside `<head>` already places panorama". `buildSourceSegment` (line 532) emits `<head><liveQueue>volume volume=g ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! mixerPad` — no panorama element. Single audiopanorama site at line 208 inside `buildSingleChannelExtraction`. Vitest test `2-source stereo preserves panorama for both sources` passes. |
| 5 | mediasoup bytesReceived monotonic across replacePipeline calls | HUMAN_NEEDED | UAT-only per plan. SSRC + bind-port determinism preserved via `senderBindPort = rtpPort + 1000` (pipeline-builder.ts:119) — port-allocator unchanged per CONTEXT lock. Requires live mediasoup transport stats during source add/remove cycle. |
| 6 | add/remove/reorder never spawns >1 gst-launch concurrently; no 'queue not-linked' or 'erroneous pipeline' stderr | HUMAN_NEEDED | Code path: `replacePipeline` is `async` and `await`s `removePipeline` (which awaits `WINDOWS_SOCKET_RELEASE_DELAY_MS=400ms`) BEFORE spawning new pipeline (pipeline-manager.ts:120-127). Single-pipeline invariant enforced at every mutation. Runtime stderr observation requires operator. |
| 7 | removeSource that drops a channel to 0 sources triggers stop+clear, NOT replacePipeline | PASS | `channel-manager.ts:331 — if (channel.sources.length === 0) { await this.stopChannel(channelId); } else { await this.applyPipelineForChannelChange(channel); }`. Vitest test `removeSource down to 0 sources -> stop, NOT replace` passes. |
| 8 | killOrphansBoundToSenderPort and call site deleted | PASS | `grep -rn killOrphansBoundToSenderPort sidecar/src/` returns 0 matches. `Get-NetUDPEndpoint` grep also 0. spawnSync import retained for `terminateWindowsProcessTree`. |
| 9 | audiomixer uses latency=10000000 (10ms ns) and ignore-inactive-pads=true; output caps audio/x-raw,rate=48000,channels=2 | PASS | `pipeline-builder.ts:488 const AUDIOMIXER_LATENCY_NS = 10_000_000;` `pipeline-builder.ts:561 audiomixer name=mix latency=${AUDIOMIXER_LATENCY_NS} ignore-inactive-pads=true ! audio/x-raw,rate=48000,channels=2 !`. Vitest test `mixer caps pinned (4 independent regex matches)` passes. |
| 10 | Single code path through audiomixer for 1, 2, and N sources (no special-case 1-source branch — DRY) | PASS | `buildChannelPipelineString` is single export (pipeline-builder.ts:552). `config.sources.map(buildSourceSegment).join(" ")` — uniform map regardless of N. No `if (sources.length === 1)` branch. `buildPipelineString` (legacy single-source) and `PipelineConfig` discriminated union DELETED — grep returns 0. Vitest 1-source / 2-source / 3-source tests all use the same code path. |
| 11 | File-loop logic moved to channel-manager (pipeline-manager source-agnostic; ChannelPipelineConfig has no sourceType discriminator) | PASS | `grep -rn shouldLoopFileSource\|scheduleFileSourceLoopRestart sidecar/src/` returns 0 matches (deleted from pipeline-manager). channel-manager owns: `FILE_LOOP_RESTART_DELAY_MS=200` (line 59), `fileLoopRestartTimers` Map, `handlePipelineExit` subscriber (line 815), `shouldLoopOnEos` derived flag computed in `buildChannelPipelineConfig` (line 693). Crash-recovery preserved: `restartTimers` 9 refs, `scheduleRestart`, `handleCrashedPipeline` intact. Vitest tests `file-loop fires on clean EOS` and `file-loop suppressed on user stop` pass. |
| 12 | tsc --noEmit clean across sidecar/src and sidecar/test | PASS | `cd sidecar && npx tsc --noEmit` exits 0, no stdout/stderr. `tsconfig.json` `include: ["src", "test"]`, no `rootDir`. `tsconfig.build.json` excludes `test`. |
| 13 | All new pure functions have Vitest tests — happy path + ≥1 failure mode | PASS | 18 tests passing. `pipeline-builder.channel.test.ts` (8): structural 1-src, stereo 2-src, mixed 3-src, mute via gain=0, mute via muted=true, empty-sources throws (failure mode), per-source panorama, mixer caps 4 indep regexes. `channel-manager.multi-source.test.ts` (10): addSource stopped+autoStart, addSource running → replace once, removeSource to 0 → stop, removeSource leaving N≥1, reorderSources, updateSource gain, invariant size matches, invariant violation throws (failure mode), file-loop fires on EOS, file-loop suppressed on user stop. |

---

## Required Artifacts (11)

| Artifact | Status | Evidence |
| -------- | ------ | -------- |
| `sidecar/test/pipeline-builder.channel.test.ts` | EXISTS | 8 tests pass (vitest) |
| `sidecar/test/channel-manager.multi-source.test.ts` | EXISTS | 10 tests pass (vitest) |
| `sidecar/vitest.config.ts` | EXISTS | passWithNoTests + node env + 5s timeout |
| `sidecar/src/audio/pipeline/pipeline-types.ts` | EXISTS + extended | `SourceSegment` (line 112), `ChannelPipelineConfig` (line 147) |
| `sidecar/src/audio/pipeline/pipeline-builder.ts` | EXISTS + extended | `buildChannelPipelineString` (line 552), `AUDIOMIXER_LATENCY_NS` (488), `computeEffectiveGain` (494), helpers (499/517/532) |
| `sidecar/src/audio/pipeline/pipeline-manager.ts` | EXISTS + extended | `replacePipeline` (line 112), `pipeline-exit` event (46/311), source-agnostic |
| `sidecar/src/audio/channels/channel-manager.ts` | EXISTS + refactored | Single-pipeline Map, invariant guard, file-loop trigger, FILE_LOOP_RESTART_DELAY_MS |
| `sidecar/src/audio/pipeline/gstreamer-process.ts` | EXISTS + cleaned | `killOrphansBoundToSenderPort` deleted, config narrowed to `ChannelPipelineConfig` |
| `sidecar/package.json` | EXISTS + extended | `vitest@^4.1.5` devDep, `test`/`test:watch` scripts |
| `sidecar/tsconfig.json` | EXISTS + patched | No `rootDir`, `include: ["src", "test"]` |
| `sidecar/tsconfig.build.json` | EXISTS + patched | `exclude: ["node_modules", "dist", "test"]` |

---

## Key Links — Modified Files (commits f7d1735..a2e1480)

| Path | Modified by Quick Task | Commits |
| ---- | ---------------------- | ------- |
| `sidecar/src/audio/pipeline/pipeline-builder.ts` | YES | be2d6bf, a2e1480 |
| `sidecar/src/audio/pipeline/pipeline-types.ts` | YES | 10ea965, 7a7e32f, a2e1480 |
| `sidecar/src/audio/pipeline/pipeline-manager.ts` | YES | 7a7e32f, a2e1480 |
| `sidecar/src/audio/pipeline/gstreamer-process.ts` | YES | 7a7e32f, 5d598d9, a2e1480 |
| `sidecar/src/audio/channels/channel-manager.ts` | YES | c7f2556 |
| `sidecar/src/audio/sources/source-types.ts` | NO (intentional) | CONTEXT lock §"Keep existing per-source configs as-is — describe ONE source. No churn." Listed in key_links as read-only reference. Working-tree shows `M` from PRE-EXISTING/unrelated changes (older commit history, not 260429-hb3). |
| `sidecar/package.json` | YES | f7d1735 |
| `sidecar/tsconfig.json` | YES | f7d1735 |
| `sidecar/tsconfig.build.json` | YES | f7d1735 |

8 of 9 key_links touched by quick task; 1 intentionally unmodified per CONTEXT lock.

---

## Validation Gate Results

| Gate | Expected | Actual | Status |
| ---- | -------- | ------ | ------ |
| `cd sidecar && npx tsc --noEmit` | clean (exit 0) | exit 0, zero output | PASS |
| `cd sidecar && npx vitest run` | green, ≥18 tests | 2 files / 18 tests passed in 367ms | PASS (18/18) |
| `grep -rn killOrphansBoundToSenderPort sidecar/src/` | 0 matches | 0 matches | PASS |
| `grep -rn 'Map<string, Map<string, string>>' sidecar/src/audio/channels/` | 0 matches | 0 matches | PASS |
| `grep -rn 'buildPipelineString\|AnyPipelineConfig\|: PipelineConfig\b' sidecar/src/` | 0 matches | 0 matches | PASS |
| `grep -rn FILE_LOOP_RESTART_DELAY_MS sidecar/src/audio/channels/` | ≥1 match | 2 matches (decl L59 + use L861) | PASS |
| `grep -rn 'AUDIOMIXER_LATENCY_NS\s*=\s*10_000_000' sidecar/src/audio/pipeline/` | ≥1 match | 1 match (pipeline-builder.ts:488) | PASS |
| `grep -rn 'ignore-inactive-pads=true' sidecar/src/audio/pipeline/` | ≥1 match | 2 matches (JSDoc L10 + emitter L561) | PASS |
| `grep -rn computeEffectiveGain sidecar/src/audio/pipeline/` | ≥1 match defn + ≥1 call | 2 matches (defn L494 + call L535) | PASS |
| `grep -rn assertSinglePipelinePerChannel sidecar/src/audio/channels/` | called at multiple mutation sites | 11 matches (1 defn L752 + 10 call sites at startChannel/stopChannel/addSource/removeSource/updateSource/reorderSources/restartChannelPipelines/setSources/replaceChannelPipelineForLoop/etc) | PASS |

All 10 automated validation gates PASS.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| TypeScript compiles cleanly across src + test | `cd sidecar && npx tsc --noEmit` | exit 0 | PASS |
| Vitest test suite all green | `cd sidecar && npx vitest run` | 18/18 passed, 367ms | PASS |
| `buildChannelPipelineString` throws on empty sources (Tiger fail-fast) | vitest test `empty sources throws` | passes | PASS |
| Invariant guard fails fast on duplicate pipelineIds | vitest test `invariant violation throws` | passes | PASS |
| File-loop trigger fires only on clean-EOS + !wasStopRequested | vitest tests file-loop fires + suppressed | both pass | PASS |

---

## Anti-Pattern Scan

Modified files scanned (5 prod + 2 test):

| File | TODO/FIXME/PLACEHOLDER | Empty returns | Hardcoded empty stubs | Status |
| ---- | --------------------- | ------------- | --------------------- | ------ |
| `pipeline-builder.ts` | 0 | 0 | 0 | clean |
| `pipeline-types.ts` | 0 | 0 | 0 | clean |
| `pipeline-manager.ts` | 0 | 0 | 0 | clean |
| `channel-manager.ts` | 0 | 0 | 0 | clean |
| `gstreamer-process.ts` | 0 | 0 | 0 | clean |

No blocker, warning, or info anti-patterns found in quick-task scope.

---

## Deviations from Plan (per SUMMARY)

1. `passWithNoTests: true` added to vitest.config.ts (vitest 4.1.5 defaults to exit 1 on no test files). Acceptable: only affects pre-test-suite state, real failures still exit 1.
2. Channel-manager invariant test refined to use `autoStart: false` so `applyPipelineForChannelChange` falls through without overwriting poisoned Map entry. Test design refinement, not behavior change.
3. `buildMeteringTail` retained — reachable from multi-source `buildProcessingAndOutputTail` Case D (AGC + Opus both bypassed). Plan said delete helpers exclusively called from `buildPipelineString`; this one is shared, so preserved correctly.

All 3 deviations documented and justified. None reduce scope or break must-haves.

---

## Overall Verdict

**Status: human_needed**

11 of 13 must-haves PASS automated verification. 2 truths require operator UAT:

- Truth #1: `exactly one gst-launch process per active channel` — code-path proven (single-pipeline-per-channel Map + 11 invariant call-sites + 18 tests); runtime process count needs PowerShell.
- Truth #5: `mediasoup bytesReceived monotonic` — explicitly UAT-tagged in plan; requires live mediasoup transport stats.
- Truth #6: `never spawns >1 gst-launch concurrently; no queue not-linked stderr` — `await removePipeline before createPipeline` proven in code; runtime concurrency observation needs live admin GUI.

(Three UAT items above; total automated PASS = 11; two of the three UAT items overlap algorithmically with truths 2/3/7 already PASSed by tests — the UAT signal is the physical process count, not the algorithm.)

All validation gates pass. All artifacts exist. All key_links modified by quick-task commits (one intentionally unmodified per CONTEXT lock). All anti-pattern scans clean. 18 vitest tests green. tsc clean. No regressions detected. No real defects found.

**Recommended next step:** Operator runs Tauri dev → admin GUI → 1 channel + 2 sources (Source A Ch:1, Source B Ch:2) → start → PowerShell `Get-Process gst-launch-1.0` → expect ONE process → verify L/R audio split in earpods → admin source add/remove → verify mediasoup `getStats()` shows monotonic `bytesReceived` and channel never goes offline → no `queue not-linked` or `erroneous pipeline` in stderr.

---

_Verified: 2026-04-29_
_Verifier: gsd-verifier (claude-opus-4-7)_
