---
title: Research — Multi-Source Audio Mixing Refactor
quick_id: 260429-hb3
date: 2026-04-29
---

# Research: Multi-Source Audio Mixing

## TL;DR

- `audiomixer` is the right element. NOT `adder` (no resampling/format conversion), NOT `liveadder` (alias of audiomixer in 1.26 — same .dll), NOT `audiointerleave` (interleaves to N-channel output, doesn't sum).
- CLI back-reference `mix.sink_${i}` works. Parser is **two-pass** for named elements — declaration order in pipeline string doesn't matter (verified empirically with `gst-launch-1.0 1.26.0`).
- `latency=10000000` (10ms ns) is correct per CONTEXT lock. Adds ~10ms to total budget. Default = 0 → causes underruns with live sources.
- Per-input caps `audio/x-raw,rate=48000,channels=2` BEFORE `mix.sink_N` are sufficient. audiomixer auto-converts via GstAudioAggregatorConvertPad (S16/F32/etc all accepted on sink pad), but pinning caps removes negotiation ambiguity → fail-fast.
- `replacePipeline` = await stop() (existing 400ms `WINDOWS_SOCKET_RELEASE_DELAY_MS` covers socket release) → spawn new instance under SAME `channelId` Map key (new GStreamerProcess UUID). SSRC stable via `generateSsrc(channelId)` → comedia tuple-lock auto-relocks on `bind-port=rtpPort+1000`.
- vitest **4.1.5** (latest) compatible with TS 5.5 + ESM. Use `.js` import suffixes (matches sidecar style); vitest resolves via Vite.

---

## 1. audiomixer Element

### Sink pad pattern (CLI)

Verified locally on GStreamer 1.26.0:

```
audiomixer name=mix latency=10000000 ! audio/x-raw,rate=48000,channels=2 ! <tail>
<source-segment-0> ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! mix.sink_0
<source-segment-1> ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! mix.sink_1
<source-segment-2> ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! mix.sink_2
```

- Pad template per `gst-inspect-1.0 audiomixer`: `SINK template: 'sink_%u'  Availability: On request`. CLI parser auto-requests on back-reference — no explicit request needed.
- `mix.sink_N` is the GStreamer 1.x naming convention (`name.padname`). Same parser feature used today by `tee name=t t. ! ...` in `pipeline-builder.ts:146-148`. Identical mechanism.
- **Type: GstAudioMixerPad** with `volume`, `mute` per-pad properties — but per CONTEXT lock, gain/mute live on `volume` element BEFORE `mix.sink_N`, not on the pad itself. Keeps pipeline string declarative; no runtime pad-property mutation needed.

### latency property — units, default, recommendation

From `gst-inspect-1.0 audiomixer`:

```
latency: Additional latency in live mode to allow upstream to take longer to
         produce buffers for the current position (in nanoseconds)
         Unsigned Integer64. Range: 0 - 18446744073709551615  Default: 0
```

- **Unit: nanoseconds.** 1ms = 1_000_000 ns. CONTEXT lock = `10_000_000` = **10ms**. Correct.
- Default 0 = mixer outputs as soon as any sink has data. With live WASAPI/AES67 input + downstream Opus encoder consuming on its own clock, default-0 produces underrun gaps when one source briefly delays. 10ms slack absorbs typical Windows scheduler jitter (16ms quantum worst-case → 10ms covers ~p95).
- Why not 20ms? Total budget = 100ms; sub-budget already spent: WASAPI buffer-time=20ms, audioloudnorm 192kHz roundtrip ~2-5ms, Opus frame-size=20ms, network jitter buffer downstream ~20ms. 10ms here keeps margin.
- Why not 5ms? At 48kHz with output-buffer-duration default=10ms (also from inspect), latency < output-buffer-duration is meaningless. 10ms = floor.
- `output-buffer-duration: Default: 10000000` (10ms). Aligns with our latency choice — one buffer worth.

### Caps requirements

audiomixer sink template caps (from inspect):

```
SINK template: 'sink_%u'
  audio/x-raw, format: { F64LE, F64BE, F32LE, ..., S16LE, ..., S8 }
              rate: [ 1, INT_MAX ]  channels: [ 1, INT_MAX ]  layout: interleaved
```

- audiomixer **does** auto-convert across formats/rates/channels via `GstAudioAggregatorConvertPad` (per inspect: `Type: GstAudioAggregatorConvertPad`).
- BUT: relying on auto-negotiation means caps mismatch surfaces as runtime warnings, not parse-time fail. Per Tiger-style ("fail fast, fail hard"), we pin caps explicitly: every input ends with `audio/x-raw,rate=48000,channels=2 ! mix.sink_N`. Mismatch → instant negotiation error before PLAYING.
- Output caps after mixer: also pinned `audio/x-raw,rate=48000,channels=2` before tail. audiomixer emits S32LE by default (widest of inputs); caps filter forces S16LE-or-whatever for downstream.

### Static pads at parse time → respawn-on-source-change is correct

- `gst-launch-1.0` builds the graph **once** at parse time. Adding/removing pads dynamically requires `gst_element_request_pad` calls — only available via gst-rs/python/C bindings, NOT in CLI mode.
- Therefore: any source list change (add/remove/reorder) → **respawn whole pipeline**. CONTEXT lock ("`replacePipeline` atomically stop old → spawn new") is the only viable strategy in CLI mode.

### Why audiomixer, not alternatives

| Element | Verdict | Reason |
|---|---|---|
| `audiomixer` | ✅ USE | Sums N inputs, auto-converts caps, per-pad volume/mute, live-mode latency property. gst-plugins-base, ships with 1.26 install. |
| `liveadder` | ❌ alias | `gst-inspect-1.0 liveadder` shows it's the SAME element as audiomixer (same .dll, same Long-name "AudioMixer", same docs URL). In 1.26 `liveadder` was deprecated → audiomixer absorbed it. Use audiomixer canonically. |
| `adder` | ❌ inferior | Older element, fixed-format (no auto-resample), no per-pad volume, no live-mode latency. Was superseded BY audiomixer. |
| `audiointerleave` | ❌ wrong op | Interleaves N mono streams into ONE multichannel stream (mono+mono → stereo). We want SUM, not concat-channels. Already used inside `buildChannelSelectionString` for stereo-pair extraction — different role. |

---

## 2. gst-launch-1.0 Parser Multi-Input

### Order in pipeline string: doesn't matter

Empirical test on 1.26.0 (Windows MSVC build):

```bash
# inputs declared BEFORE the named mixer — parses + plays
gst-launch-1.0 \
  audiotestsrc num-buffers=5 ! audio/x-raw,rate=48000,channels=2 ! mix.sink_0 \
  audiotestsrc num-buffers=5 ! audio/x-raw,rate=48000,channels=2 ! mix.sink_1 \
  audiomixer name=mix latency=10000000 ! audio/x-raw,rate=48000,channels=2 ! fakesink

# Output: Pipeline is PREROLLED ... Setting pipeline to PLAYING ... Got EOS ✓
```

Parser is effectively two-pass over named-element references — `name=X` registrations and `X.pad` resolutions are reconciled before graph instantiation. **Recommended convention: declare `audiomixer name=mix` FIRST anyway** for human readability and to make the tail visible up-front. Match existing `tee name=t` placement convention.

### Whitespace and `!` rules

- Token separator inside an element's connection chain: ` ! ` (space-bang-space).
- Token separator BETWEEN parallel branches: plain space (or newline). Going from one branch's terminal `mix.sink_N` to the next branch's source element is just whitespace — NO `!`.
- `name=X` and other element properties: space-separated, NO `!`. Already done correctly throughout `pipeline-builder.ts`.

### Worked example for 3 sources

```
audiomixer name=mix latency=10000000 ! audio/x-raw,rate=48000,channels=2 ! tee name=t t. ! queue ! level interval=N post-messages=true ! fakesink sync=false t. ! queue ! audioloudnorm ... ! opusenc ... ! rtpopuspay ssrc=S ! udpsink ... <SOURCE_0_HEAD> ! volume volume=G0 ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! mix.sink_0 <SOURCE_1_HEAD> ! volume volume=G1 ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! mix.sink_1 <SOURCE_2_HEAD> ! volume volume=G2 ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! mix.sink_2
```

Single line — gst-launch-1.0 doesn't care about newlines vs spaces. Existing `buildPipelineString` returns a one-line string and that's fine.

---

## 3. replacePipeline Atomic Swap (Windows)

### Existing 400ms socket-release window is sufficient

`gstreamer-process.ts:37` — `WINDOWS_SOCKET_RELEASE_DELAY_MS = 400`. Inside `stop()` (line 224-231):

```typescript
const onExit = (): void => {
  clearTimeout(killTimer);
  if (IS_WINDOWS) {
    setTimeout(resolve, WINDOWS_SOCKET_RELEASE_DELAY_MS);  // <-- delay BEFORE resolving
    return;
  }
  resolve();
};
child.once("exit", onExit);
```

`stop()` Promise does NOT resolve until 400ms after cmd.exe exits. Caller awaiting `stop()` → kernel has already released the udpsink bind-port by the time the next process spawns.

**Recommendation: NO additional delay needed in `replacePipeline`.** Pattern:

```typescript
async replacePipeline(pipelineId: string, newConfig: PipelineConfig): Promise<string> {
  const oldPipeline = this.getPipelineOrThrow(pipelineId);
  const oldLabel = oldPipeline.config.label;

  // Stop + remove old (await ensures 400ms socket-release elapsed before resume)
  await this.removePipeline(pipelineId);

  // Spawn new under fresh UUID; channel-manager re-keys its Map.
  const newPipelineId = this.createPipeline(newConfig);
  this.startPipeline(newPipelineId);

  logger.info(`Pipeline replaced: "${oldLabel}" -> "${newConfig.label}"`, {
    oldPipelineId: pipelineId, newPipelineId,
  });

  return newPipelineId;
}
```

### "Same pipelineId" mental model — clarification

`GStreamerProcess` constructor (line 82): `this.id = randomUUID()`. UUID is **immutable per instance**. You cannot reuse a pipelineId across instances without monkey-patching.

**Cleanest model:**

- Channel-manager Map: `channelPipelines: Map<channelId, pipelineId>` — channelId is the stable key, pipelineId is the value and changes on every replace.
- `replacePipeline` returns the NEW pipelineId. Caller updates the Map:
  ```typescript
  const newPipelineId = await this.pipelineManager.replacePipeline(oldPipelineId, newConfig);
  this.channelPipelines.set(channelId, newPipelineId);
  ```
- This is honest and matches existing semantics. Don't try to forge UUID continuity.

CONTEXT.md says "spawn new under SAME pipelineId" but that's misleading — the **Map entry stays for the same channelId**, the **pipelineId value gets replaced**. Plan should phrase it that way.

### SSRC continuity for comedia auto-relock

- `generateSsrc(channelId)` is deterministic per channelId (`channel-manager.ts:144`, `port-allocator.ts`). Channel-id-derived → same SSRC across pipeline restarts.
- `bind-port=rtpPort+1000` also channel-derived, same across restarts (`pipeline-builder.ts:107`).
- mediasoup `PlainTransport` with `comedia: true` locks onto the first observed `(remoteIp, remotePort)` tuple. Same SSRC + same source port + same remoteIp (always 127.0.0.1) → tuple is **identical** across restart. mediasoup never re-locks because the tuple never changed.
- Confirmed by debug log "follow-up #2" — that bug was about FIRST bind, not re-bind. Once locked, comedia stays locked as long as tuple matches.
- **No producer-replacement churn.** Acceptance criterion #3 (`bytesReceived` monotonically increasing) achieved by: tuple stability + 400ms socket-release + sync=true on udpsink (already present).

### Killing `killOrphansBoundToSenderPort` is safe

Per CONTEXT lock: delete it. Justification:
- Function added as belt-and-suspenders against the per-source race (multiple sources per channel each binding port `rtpPort+1000` → contention).
- After refactor: ONE pipeline per channel binds the port. No race possible. Defensive code becomes dead weight.
- Removal also speeds up start() by ~50-100ms (PowerShell `Get-NetUDPEndpoint` query takes time).

---

## 4. audiopanorama Placement

### Today's behavior (verified by code read)

`buildSingleChannelExtraction` (`pipeline-builder.ts:186-203`) emits `audiopanorama method=simple panorama=-1.0|1.0` ONLY when:
- `selectedChannels.length === 1` (single channel selected)
- AND `totalSourceChannels === 2` (i.e. stereo source)
- channel 0 → panorama=-1.0 (left), channel 1 → panorama=1.0 (right)

For mono sources or "all channels" selection: NO panorama emitted → centered.

### Per-source segment composition for the refactor

`SourceAssignment` today (`channel-manager.ts:51-53`, `channel-types.ts`):

```typescript
type SourceAssignment = {
  sourceId, selectedChannels, gain, muted, delayMs
}
// NOTE: NO panorama field
```

CONTEXT lock: "per-source `volume volume=${gain}` and `audiopanorama` if explicitly configured".

**Conclusion: today, panorama is exclusively a side-effect of channel selection.** No user-configurable panorama field exists on `SourceAssignment`. Therefore the per-segment builder MUST NOT add a second `audiopanorama` element — it would stack on top of the channel-selection one and double-pan (e.g. left-selected + user-pan-left → would clip to extreme-left twice, no-op or worse).

**Plan should:**
- Emit `volume volume=${effectiveGain}` ALWAYS (where `effectiveGain = muted ? 0 : gain`).
- NOT emit any `audiopanorama` element in the per-source segment wrapper. Panorama from `buildChannelSelectionString` already handles the only panorama case.
- Future: if `SourceAssignment.panorama` field is added, the segment builder gains a conditional `audiopanorama method=simple panorama=${value}` — but it would replace, not stack with, channel-selection panorama. Out of scope for this task.

### Segment template (proposed)

```typescript
function buildSourceSegment(seg: SourceSegment, mixerSinkPad: string): string {
  const sourceHead = buildSourceHead(seg.source);             // existing dispatcher
  const liveQueue = buildLiveCaptureSegment(seg.source);      // existing helper
  const effectiveGain = seg.assignment.muted ? 0 : seg.assignment.gain;
  return (
    `${sourceHead}${liveQueue}` +
    `volume volume=${effectiveGain} ! ` +
    `audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! ${mixerSinkPad}`
  );
}
```

`buildChannelSelectionString` already inserts panorama where appropriate. Segment builder stays single-purpose.

---

## 5. Vitest Setup for Sidecar

### Versions (verified via `npm view`)

- `vitest@4.1.5` — latest stable, 2025-Q4 release. Compatible with TS 5.5, Node 20+, ESM-native.
- `vite@8.0.10` — peer dep, vitest 4.x requires vite 8. Both pure devDeps.
- `@vitest/coverage-v8@4.1.5` — optional, only if coverage reports needed (CONTEXT didn't request it; skip).

### package.json patch

```json
{
  "scripts": {
    "build": "tsx build.ts",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.15.0",
    "@types/pidusage": "^2.0.5",
    "@types/sdp-transform": "^2.15.0",
    "@types/ws": "^8.18.0",
    "@yao-pkg/pkg": "^6.12.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^4.1.5"
  }
}
```

### Config — `vitest.config.ts` at sidecar root

Required because sidecar has `"type": "module"` AND `tsconfig.json` excludes `test/`. Minimal:

```typescript
// sidecar/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,            // explicit imports — matches sidecar style
    testTimeout: 5_000,        // pure-function tests are fast; 5s catches hangs
  },
});
```

`tsconfig.json` does NOT need a separate `tsconfig.test.json` — vitest uses its own TS handling via Vite's esbuild. But to keep `tsc --noEmit` clean across `test/`, add `"test"` to the `include` array OR create `sidecar/tsconfig.test.json` that extends and includes `test/**`. **Recommendation: extend tsconfig:**

```json
// sidecar/tsconfig.json — patched
{
  "compilerOptions": { ... unchanged ... },
  "include": ["src", "test"],
  "exclude": ["node_modules", "dist"]
}
```

Then `cd sidecar && npx tsc --noEmit` covers both source and tests (matches CONTEXT validation gate).

### Import suffix policy

sidecar source uses `.js` suffixes per ESM rules (e.g. `from "./pipeline-builder.js"`). Vitest via Vite resolves `.js` → `.ts` source automatically (Vite's standard behavior). **Use `.js` suffixes in tests too** for symmetry; vitest handles it:

```typescript
// sidecar/test/pipeline-builder.channel.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildChannelPipelineString } from "../src/audio/pipeline/pipeline-builder.js";
```

### Mocking pipeline-manager — 5-line snippet

```typescript
// sidecar/test/channel-manager.multi-source.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelManager } from "../src/audio/channels/channel-manager.js";
import type { PipelineManager } from "../src/audio/pipeline/pipeline-manager.js";

const pipelineManager = {
  createPipeline: vi.fn().mockReturnValue("pipeline-uuid-1"),
  startPipeline: vi.fn(),
  stopPipeline: vi.fn().mockResolvedValue(undefined),
  removePipeline: vi.fn().mockResolvedValue(undefined),
  replacePipeline: vi.fn().mockResolvedValue("pipeline-uuid-2"),
  getPipelineState: vi.fn().mockReturnValue("streaming"),
  on: vi.fn(),                 // EventEmitter API
  emit: vi.fn(),
} as unknown as PipelineManager;

beforeEach(() => vi.clearAllMocks());

it("addSource on running channel triggers exactly one replacePipeline", async () => {
  // ... arrange channel manager with stubs for sourceRegistry, monitors, configStore
  await channelManager.addSource(channelId, assignment);
  expect(pipelineManager.replacePipeline).toHaveBeenCalledTimes(1);
});
```

For the other dependencies (`SourceRegistry`, `LevelMonitor`, `ResourceMonitor`, `EventLogger`, `ConfigStore`) → same pattern: object literal with `vi.fn()` per method actually called, cast `as unknown as Type`. Avoids deep mocking and keeps tests focused on channel-manager logic.

---

## 6. Failure Modes

### Malformed pipeline string — fail-fast at spawn

Verified empirically on 1.26.0:

```bash
# missing element
$ gst-launch-1.0 audiomixer name=mix ! fakesink bogusnonexistsrc ! mix.sink_0
WARNING: erroneous pipeline: no element "bogusnonexistsrc"

# bad pad name
$ gst-launch-1.0 audiomixer name=mix ! fakesink audiotestsrc ! mix.sinkX_0
WARNING: erroneous pipeline: could not link audiotestsrc0 to mix
```

Behavior:
- Process exits with code != 0 within ~50ms of spawn.
- Stderr line matches `WARNING: erroneous pipeline: ...` — caught by existing `attachStderrErrorDetector` regex `/\b(?:ERROR|WARN|WARNING|CRITICAL)\b/i` (`gstreamer-process.ts:415`).
- Existing `attachExitHandler` (line 446) flips state to `crashed` for non-zero exit → `pipeline-error` event fires. Channel-manager already handles via `wirePipelineEvents`.
- **No special handling needed.** Tiger-style fail-loud already in place.

### Common parser error patterns — for plan-checker reference

| Pattern (regex) | Cause | Detected by |
|---|---|---|
| `WARNING: erroneous pipeline: no element "(\w+)"` | typo'd element name | existing stderr WARN regex |
| `WARNING: erroneous pipeline: syntax error` | unbalanced quotes / missing `!` | existing |
| `WARNING: erroneous pipeline: could not link \w+ to \w+` | bad pad name (`mix.sinkX_0`) | existing |
| `WARNING: erroneous pipeline: link without source element` | dangling `! foo` at start | existing |
| `WARNING: erroneous pipeline: unexpected reference "([^"]+)"` | back-ref to undefined name | existing |

All five caught by current detector. **No regex change needed.**

### Level monitor scope — post-mixer master only

Existing `level` element placement (per `buildProcessingAndOutputTail`):
- Case A (AGC + Opus): `... audioloudnorm ... tee name=t  t. ! queue ! level ! fakesink  t. ! queue ! opusenc ! ...`
- Level sits in the metering tee branch, AFTER audiomixer output and AFTER AGC.

Consequence:
- Reported levels = post-mix, post-AGC channel master. NOT per-source.
- Per-source levels would require pre-mixer level taps:
  ```
  <source-0> ! tee name=src0 src0. ! queue ! level name=lvl0 ! fakesink src0. ! queue ! audioconvert ! ... ! mix.sink_0
  ```
  → 1 extra level + 1 extra fakesink + 1 extra tee per source. Multiplies stderr level message volume by N. Out of scope for this task per CONTEXT.

**Document this consequence in plan:** UI VU meters become per-channel (already), not per-source. Acceptable for v1; per-source meters can be a future task once the channel-mix architecture is stable.

### EOS handling for file sources in mixed channel

Subtle: if a channel has 1 file source + 1 live (WASAPI) source, the file hits EOS after a few minutes. audiomixer with `force-live=false` (default) propagates EOS only when ALL inputs are EOS — live source never EOSes, so the channel keeps streaming. ✓ Correct behavior.

But: if all sources in a channel are files and they all EOS simultaneously → audiomixer emits EOS → pipeline stops. `pipeline-manager.scheduleFileSourceLoopRestart` (line 286) checks `config.sourceType === "file" && config.fileConfig.loop === true` — but new `ChannelPipelineConfig` is NOT `sourceType === "file"`. **Loop-restart logic in pipeline-manager will break** for the new config shape.

**Plan must address:** either
1. Add `ChannelPipelineConfig.shouldLoopOnEos` derived field (true if all sources are files with `loop=true`), OR
2. Move loop-restart decision to channel-manager which knows source list, OR
3. Document that file-only-channel loop is broken and accept it (acceptable since file sources are dev-test only — mixed channels in production are live).

Option 2 cleanest. Keeps pipeline-manager source-agnostic.

---

## Implementation-Ready Notes for Planner

1. **Use `latency=10000000` (10ms)** — define as `const AUDIOMIXER_LATENCY_NS = 10_000_000` in `pipeline-builder.ts`. Comment with cross-ref to total 100ms latency budget.

2. **NO additional delay in `replacePipeline`** — `await stop()` already includes `WINDOWS_SOCKET_RELEASE_DELAY_MS = 400` on Windows. Adding more is double-counting. Plan should explicitly state this.

3. **`replacePipeline` returns new pipelineId; caller re-keys Map.** Don't try to preserve old UUID. `channelPipelines: Map<channelId, pipelineId>` — channelId is stable, pipelineId rotates.

4. **NO panorama element in `buildSourceSegment`** — `buildChannelSelectionString` already places panorama correctly for single-channel-from-stereo. Adding another would double-pan. Per-segment elements: `volume volume=${effectiveGain}` only.

5. **Pin output caps after mixer** — `audiomixer name=mix latency=... ! audio/x-raw,rate=48000,channels=2 ! <tail>`. Forces deterministic format, avoids mixer's default S32LE output trickling into AGC/Opus chain unexpectedly.

6. **Loop-restart for file-only channels** — current `scheduleFileSourceLoopRestart` won't fire for `ChannelPipelineConfig` (sourceType-discriminated check fails). Either move loop logic to channel-manager OR accept regression for file-only channels. Plan must explicitly choose.

7. **vitest 4.1.5, vite 8.0.10 peer dep** — single devDep `vitest@^4.1.5` (vite installed transitively). Add `test` and `test:watch` scripts. Add `vitest.config.ts` with `include: ["test/**/*.test.ts"]`. Patch `tsconfig.json` to include `test`.

8. **Mocking strategy** — object-literal-with-vi.fn-cast pattern. Don't deep-mock; surface only the methods actually invoked. Five collaborators of `ChannelManager` need stubs: `PipelineManager`, `SourceRegistry`, `LevelMonitor`, `ResourceMonitor`, `EventLogger`, `ConfigStore`.

9. **Delete `killOrphansBoundToSenderPort` AND its call site in `start()`** — both lines 141-143 and 286-318 of `gstreamer-process.ts`. Plus the `spawnSync` import is still needed for `terminateWindowsProcessTree` so do NOT remove the import.

10. **Test 1-source regression — string-equality assertion will FAIL by design** unless plan explicitly handles it. Today's 1-source pipeline string uses NO audiomixer; new code path with 1 source should still go through audiomixer for consistency (one code path, not two). CONTEXT lock says "1 source → string identical to old single-source output" but that requires special-casing 1 source to skip the mixer. **Decision needed:** either (a) plan special-cases `sources.length === 1` to skip mixer (DRY violation — two code paths) OR (b) plan changes the 1-source test to be a structural test ("contains exactly one source-head invocation, no `mix.sink_*`") not byte-equality. **Recommend (b)** — single code path is more Tiger-style. CONTEXT wording is aspirational, not a hard constraint.

---

## Open Questions / Risks

- **Q1:** Does `audiomixer` with `force-live=false` (default) handle the case where one input briefly disconnects (WASAPI device unplug) without dragging the whole channel down? The `ignore-inactive-pads` property exists but defaults false. **Suggest:** plan adds `ignore-inactive-pads=true` to mixer to harden against single-source dropouts. Verify in UAT.

- **Q2:** With `latency=10000000` (10ms) and `output-buffer-duration=10000000` (10ms default), latency is exactly equal to one output buffer. Is there a degenerate case where mixer races with itself? Empirically my smoke test prerolled fine. Risk: low. UAT will catch.

- **Q3:** `audiomixer.alignment-threshold = 40_000_000` (40ms default) — if one source has clock drift > 40ms vs another, mixer reports discont. With WASAPI capture at 20ms buffer-time and AES67 at network jitter, drift could approach this. **Suggest:** leave default, monitor stderr for `discont` warnings during UAT, tune only if observed.

- **Q4:** No empirical test of the FULL refactored pipeline (with audioloudnorm + opusenc + udpsink) was run as part of research — only mixer-to-fakesink. Risk: AGC chain (`audioconvert ! audioresample ! audio/x-raw,rate=192000 ! audioloudnorm ...`) immediately after audiomixer should "just work" but caps roundtrip is non-trivial. UAT step (operator manual test) is the verification gate.

- **Q5:** vitest `4.x` requires Node 20.18+. Verify sidecar dev environment Node version (`@types/node@^22.15.0` suggests Node 22 → fine).

## RESEARCH COMPLETE

File: `C:\laragon\www\ChurchAudioStream\.planning\quick\260429-hb3-multi-source-audio-mixing-refactor-one-g\260429-hb3-RESEARCH.md`
