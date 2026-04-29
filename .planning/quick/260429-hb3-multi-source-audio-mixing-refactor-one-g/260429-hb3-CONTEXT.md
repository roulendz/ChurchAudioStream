---
quick_id: 260429-hb3
title: Multi-source audio mixing refactor — one gst-launch pipeline per channel
status: locked
gathered: 2026-04-29
---

# Quick Task 260429-hb3: Multi-Source Audio Mixing Refactor - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Task Boundary

Refactor sidecar audio orchestration: replace per-source gst-launch processes with **one gst-launch pipeline per channel** that combines multiple sources via GStreamer's `audiomixer` element. Eliminates bind-port + SSRC race condition that today kills all but one source per channel.

**Scope:** `sidecar/src/audio/**` only. No listener PWA, no Tauri admin UI, no signaling protocol changes.

</domain>

<decisions>
## Implementation Decisions (LOCKED — do not revisit)

### Pipeline composition model
- **One gst-launch process per channel.** Multiple sources combined inside via `audiomixer name=mix latency=10000000`.
- mediasoup receives one coherent RTP stream per channel.
- Audio flow: per-source segment → channel selection → volume + panorama → audioconvert + audioresample → `mix.sink_${i}` → audiomixer → existing processing/output tail (AGC + Opus + RTP).

### New types in `pipeline-types.ts`
- Add `SourceSegment { source: FilePipelineConfig | LocalPipelineConfig | Aes67PipelineConfig; assignment: SourceAssignment; mixerPadName: string }`.
- Add `ChannelPipelineConfig { label; levelIntervalMs; processing; sources: ReadonlyArray<SourceSegment> }`.
- **Keep existing per-source configs (FilePipelineConfig etc.) as-is** — describe ONE source. No churn.

### Pipeline string builder (`pipeline-builder.ts`)
- New top-level: `export function buildChannelPipelineString(config: ChannelPipelineConfig): string`.
- Reuse existing source head builders (`buildFileSourceHead`, WASAPI, AES67) — extend, don't duplicate.
- Reuse `buildChannelSelectionString` + `buildSingleChannelExtraction`.
- Per-source segment terminator: ` ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=2 ! mix.sink_${i}`.
- Top of string: `audiomixer name=mix latency=10000000 ignore-inactive-pads=true ! audio/x-raw,rate=48000,channels=2 ! ` then existing `buildProcessingAndOutputTail`.
- Mixer latency (ns) from named constant `AUDIOMIXER_LATENCY_NS = 10_000_000` (10ms — within 100ms total budget per research §1).
- Mute (`gain=0` or `muted=true`) → segment uses `volume volume=0`. Effective gain helper: `effectiveGain = muted ? 0 : gain`.
- **No `audiopanorama` element in per-source segment** (research §4): `buildChannelSelectionString` already places panorama for single-channel-from-stereo selection. Adding another would double-pan.
- `SourceAssignment` has NO panorama field today; plan must NOT introduce one.
- Helpers: `buildSourceSegment(seg, mixerSinkPad)` etc. **No inline ternaries building multi-line strings.**

### Channel orchestration (`channel-manager.ts`)
- Replace `channelPipelines: Map<channelId, Map<sourceIndex, pipelineId>>` with `Map<channelId, pipelineId>` (one pipelineId per channel).
- Lifecycle:
  - `startChannel(channelId)` → build `ChannelPipelineConfig` from all sources → `pipelineManager.createPipeline()` → start. Skip if `sources.length === 0` (already does).
  - `addSource` / `updateSource` / `reorderSources` → recompose config → `replacePipeline(oldId, newConfig)` returning new id → update Map.
  - `removeSource` → if remaining sources > 0 → `replacePipeline`. If remaining sources === 0 → **stop**, clear Map entry. (Research §6 confirms: 0-source channels must stop, not replace.)
  - `stopChannel` → kill pipeline, clear map entry.
- Delete `startPipelineForSource`, `stopPipelineForSource`, `rekeyPipelineMappings`.
- Delete source-index branching in `aggregateChannelStatus`; channel status mirrors single pipeline state.
- Tiger-style invariant guard at every mutation: `if (this.channelPipelines.size !== distinctPipelines) throw` — fail fast, fail loud. Helper: `assertSinglePipelinePerChannel()`.
- File-loop logic moved here (per research §6 option 2): when `pipeline-manager` emits a clean-EOS exit for a channel whose all sources are files with `loop=true`, channel-manager triggers `replacePipeline` with same config. Pipeline-manager loses the `scheduleFileSourceLoopRestart` source-type check.

### Pipeline manager (`pipeline-manager.ts`)
- New `replacePipeline(oldPipelineId, newConfig): Promise<string>` — returns the NEW pipelineId.
- Implementation: `await this.removePipeline(oldPipelineId)` (await ensures `WINDOWS_SOCKET_RELEASE_DELAY_MS = 400ms` already elapsed before this resolves — NO extra delay needed per research §3) → `createPipeline(newConfig)` → `startPipeline(newId)` → return new id.
- Caller updates `channelPipelines.set(channelId, newPipelineId)`. Map key (channelId) is stable; value (pipelineId) rotates.
- **Mental model correction (per research):** "spawn new under SAME pipelineId" was misleading in original spec. UUIDs are immutable per `GStreamerProcess` instance. Stable identity is `channelId`, not `pipelineId`.
- Loop-restart regression: `pipeline-manager.scheduleFileSourceLoopRestart` checks `config.sourceType === "file"` which won't match `ChannelPipelineConfig`. **Plan must move file-loop logic to channel-manager** (which has source-list visibility) — option (2) per research §6. Pipeline-manager stays source-agnostic.
- Add mixer hardening: `ignore-inactive-pads=true` on `audiomixer` element so single-source dropout (WASAPI unplug) doesn't stall the channel (research Q1).

### Bind-port (`pipeline-builder.ts` + `gstreamer-process.ts`)
- Keep `bind-port=rtpPort+1000` on udpsink (correct now: one pipeline per channel = one process binding port).
- **DELETE** `killOrphansBoundToSenderPort` from `gstreamer-process.ts` — workaround no longer needed.
- Remove call site in `start()`.

### Code quality bar (per CLAUDE.md)
- DRY, SRP, self-explanatory naming, fail-fast Tiger-style.
- **Max 2 levels of indentation** in any function. Guard clauses with `return`. No nested-if-in-if.
- Comments only on **why** non-obvious choices were made (e.g. why audiomixer.latency = 10ms specifically). Never on **what**.

### Testing (Vitest in `sidecar/test/`)
- **NOTE (per research 260429-hb3-RESEARCH.md §10):** sidecar has NO existing test/ dir, NO vitest dep. Plan MUST add `vitest@^4.1.5` devDep, `test`/`test:watch` scripts, `vitest.config.ts` at sidecar root, and patch `tsconfig.json` `include` to add `"test"`.
- `pipeline-builder.channel.test.ts`:
  - 1 source → STRUCTURAL assertion (per research recommendation): contains exactly one source-head invocation, contains `audiomixer name=mix`, contains exactly one `mix.sink_0`. **NOT byte-equality with old single-source output** (research §6 — single code path is Tiger-style, special-casing for 1 source = DRY violation).
  - 2 sources stereo [0,1] → exactly one `audiomixer name=mix`, two `mix.sink_` references, no `tee` before mixer.
  - 3 sources mixed kinds (file + WASAPI + AES67) → exactly 3 `mix.sink_N` and one tail.
  - Mute (gain=0 OR muted=true) → segment has `volume=0`.
  - Single-channel selection on each source preserves panorama.
- `channel-manager.multi-source.test.ts`:
  - addSource on running channel → exactly one `replacePipeline` call (mock pipeline-manager).
  - removeSource down to 0 → triggers `stop`, not `replace`.
  - reorderSources → triggers `replace` with new mixerPadName order.
  - Invariant: `channelPipelines.size === number of running channels`.

### Validation gates (must pass before declaring done)
- `cd sidecar && npx tsc --noEmit` clean.
- `cd sidecar && npx vitest run` green.
- `npm run build` (root, with PATH cargo export) rebuilds sidecar binary.
- Manual UAT (user does, not agent): tauri dev → 2 sources on 1 channel (Ch:1 only / Ch:2 only) → 1 gst-launch process, audio in both earpods, no restart cycle.

### Claude's Discretion
- Exact value of Windows socket-release delay in `replacePipeline` — pick from existing code conventions; default 200-500ms if no precedent.
- Internal helper naming (e.g. `composeMixerInputs`, `assertSinglePipelinePerChannel`) — keep self-explanatory per CLAUDE.md.
- Test file structure within `sidecar/test/` — follow existing test conventions.

</decisions>

<specifics>
## Specific Files To Touch

- `sidecar/src/audio/pipeline/pipeline-builder.ts`
- `sidecar/src/audio/pipeline/pipeline-types.ts`
- `sidecar/src/audio/channels/channel-manager.ts`
- `sidecar/src/audio/pipeline/pipeline-manager.ts`
- `sidecar/src/audio/pipeline/gstreamer-process.ts`
- `sidecar/src/audio/processing/port-allocator.ts` (READ ONLY — do NOT change)
- `sidecar/src/audio/sources/source-types.ts`
- `.planning/debug/resolved/pipeline-stuck-connecting.md` (READ for context)

## Acceptance Criteria

1. Channel with N sources → exactly **1** gst-launch-1.0.exe process.
2. Stereo output preserves each source's selectedChannels + panorama.
3. mediasoup `PlainTransport.bytesReceived` monotonically increasing — no producer-replacement churn.
4. add/remove/reorder sources never spawns >1 gst-launch, never produces "queue not-linked" stderr.
5. `npx tsc --noEmit` from `sidecar/` clean.
6. Every new pure function has Vitest test (happy path + ≥1 failure mode).

</specifics>

<canonical_refs>
## Canonical References

- `C:\laragon\www\ChurchAudioStream\CLAUDE.md` — DRY/SRP/self-explanatory/Tiger-style/no-spaghetti rules.
- `.planning/debug/resolved/pipeline-stuck-connecting.md` — context on prior bind-port + SSRC race bugs.
- GStreamer `audiomixer` element docs (sink pad pattern: `mix.sink_${i}`).

## Hard Prohibitions

- Do NOT touch `listener/`, `src/` (admin React), or Tauri Rust shell.
- Do NOT change WebSocket protoo signaling, mediasoup PlainTransport/WebRtcTransport setup.
- Do NOT change `port-allocator.ts` (rtpPort scheme is correct).
- Do NOT introduce new dependencies. Use existing GStreamer + Node primitives.
- Do NOT patch `killOrphansBoundToSenderPort` to be smarter — **delete it**.
- Do NOT skip tests because typecheck is clean.
- Do NOT write summary/decision/planning markdown beyond what GSD workflow generates.

</canonical_refs>
