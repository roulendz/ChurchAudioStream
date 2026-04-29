---
quick_id: 260429-hb3
title: "Code Review — Multi-Source Audio Mixing Refactor"
date: 2026-04-29
status: complete
verdict: minor
ship_blocker: false
findings:
  critical: 0
  major: 6
  minor: 7
---

# Code Review — Multi-Source Audio Mixing Refactor (260429-hb3)

## Summary

Solid refactor. Pipeline-builder pure-function design clean. `audiomixer name=mix latency=10000000 ignore-inactive-pads=true` correct. `replacePipeline` atomic-swap correct (await `removePipeline` includes 400ms Windows socket-release before spawn → no double-bind race). `assertSinglePipelinePerChannel` invariant-guard called at every Map mutation point (createChannel, removeChannel, addSource, removeSource, updateSource, reorderSources, startChannel, stopChannel, replaceChannelPipelineForLoop, restartChannelPipelines). `computeEffectiveGain` single source of truth — only call site is `buildSourceSegment`. `FILE_LOOP_RESTART_DELAY_MS` named const, no magic. `killOrphansBoundToSenderPort` fully deleted (grep clean across sidecar). `restartTimers` Map preserved with crash-recovery + exponential backoff intact. 18 tests, structural assertions only — no byte-equality. Zero `any`, zero `as any` in pipeline source. **Verdict: minor; ship-ready, two real defects worth fixing in next pass.**

## Findings

### Critical (bug, security, broken contract)

**None.**

### Major (code quality, will hurt later)

- **`assignment.delayMs` declared but silently ignored in pipeline string.** `pipeline-types.ts:121` declares `readonly delayMs: number` on `SourceSegment.assignment`. `pipeline-builder.ts:532-541` `buildSourceSegment` never emits an `audiodelay` / `audiobuffersplit` / time-shift element. `channel-manager.ts:368` accepts `delayMs` updates and triggers `replacePipeline`, so user-facing API claims live time-alignment but nothing happens downstream. Tiger-style fail-fast violation: silent no-op.
  Fix: either (a) emit `audiodelay time=<ns>` between `<liveQueue>` and `volume` when `delayMs > 0`, or (b) drop `delayMs` from `SourceAssignment` until v2 + `throw new Error("delayMs not yet supported")` if non-zero.

- **`getChannelIndex` returns out-of-range index instead of throwing on miss.** `channel-manager.ts:1061-1068`:
  ```ts
  private getChannelIndex(channelId: string): number {
    let index = 0;
    for (const id of this.channels.keys()) {
      if (id === channelId) return index;
      index++;
    }
    return index; // == this.channels.size, silently wrong
  }
  ```
  Falls through to `return index` (== `this.channels.size`) for unknown channelId. `getPortsForChannel(badIndex)` then yields a port outside the valid grid — channel binds to wrong RTP port, mediasoup never sees packets. Fail-loud violation per CLAUDE.md rule 5. Fix: `throw new Error(\`getChannelIndex: unknown channelId ${channelId}\`)` after loop.

- **`(assignment as { gain: number }).gain = …` cast pattern in `updateSource`** (`channel-manager.ts:366-368`). `SourceAssignment.gain/muted/delayMs` are NOT `readonly` (`channel-types.ts:26-28`), so the cast is dead weight that hides the mutation from readers and bypasses TS structural checks. Just write `assignment.gain = updates.gain`. Removes 3 ugly casts and improves "self-explanatory" rule compliance.

- **`replaceChannelPipelineForLoop` does NOT clear `levelMonitor` / `resourceMonitor` for old pipelineId** (`channel-manager.ts:866-891`). Compare with `replaceRunningPipeline:646-647` which calls `untrackPipeline(oldPipelineId)` and `clearPipeline(oldPipelineId)`. File-loop EOS path leaks meter / pidusage entries on every loop iteration. With a 30-second loop file streaming for an hour, you accumulate 120 stale Map entries. DRY violation: extract a `swapMonitorBookkeeping(oldId, newId, channel)` helper called by both paths.

- **`updateProcessingConfig` mutates `channel.processing` but does NOT call `assertSinglePipelinePerChannel`** (`channel-manager.ts:204-247`). Same for `resetProcessingDefaults:249-278`. Both eventually trigger debounced `restartChannelPipelines` which DOES assert (`:1031`), but the assert comes ~1500ms later. Brief window where invariant is unverified after every processing-config edit. Cheap to fix — add the call before `return channel;`.

- **`updateSource` selectedChannels branch creates new object with stale `assignment` reference** (`channel-manager.ts:369-374`):
  ```ts
  if (updates.selectedChannels !== undefined) {
    channel.sources[sourceIndex] = {
      ...assignment,  // captured BEFORE the gain/muted/delayMs writes above
      selectedChannels: updates.selectedChannels,
    };
  }
  ```
  The `(assignment as { gain }).gain = …` lines mutate in place, so spreading `...assignment` here picks up the mutated values correctly — works by accident. But it's spaghetti: two different mutation styles for sibling fields in one function. Refactor to one immutable replacement:
  ```ts
  channel.sources[sourceIndex] = { ...assignment, ...updates };
  ```

### Minor (style, polish)

- **`pipeline-manager.ts:262-264`** `destroyAll` calls both `clearAllRestartTimers()` (line 255) AND clears `restartTimers` again at 264. `clearAllRestartTimers` already does `this.restartTimers.clear()` (line 417). Belt-and-braces but redundant.

- **`pipeline-manager.ts:170`** `safetyErrorHandler = (): void => {}` empty function as event handler. Acceptable here (intentional swallow with comment) but the empty `catch {}` pattern in `gstreamer-process.ts:255-257` lacks even a comment justifying silence — add `// stdin already destroyed; harmless` to satisfy quick-grep "empty catch" rule.

- **`channel-manager.ts:1110`** trailing closing brace then 2 blank lines then module-level helpers. Long file (1208 lines) handles 9 responsibilities (CRUD, processing config, source assignment, lifecycle, status, invariant, events, persistence, debounce + helpers). Already at SRP limit per pre-Phase-04 audit (was 1220, now 1208 — held the line). Defer split to next phase but flag for follow-up.

- **`channel-manager.ts:331-335`** `removeSource` 0-source branch calls `stopChannel` directly. Good. But `replaceRunningPipeline:628-632` ALSO has a 0-source defensive path. Documented as "caller should have routed empty-source case" — consider promoting to invariant assert: if you reach `replaceRunningPipeline` with 0 sources, that's a bug, fail loud.

- **`pipeline-builder.ts:307-309`** `LIVE_CAPTURE_QUEUE_SEGMENT` constant string concatenation works but loses the named-const-per-attribute granularity. Not a bug, just preference.

- **`gstreamer-process.ts:362`** `GSTREAMER_ERROR_PATTERN = /\b(?:ERROR|WARN|WARNING|CRITICAL)\b/i` — matches `WARNING` first-line of `gst-launch -m` startup banner if locale-tweaked. Low risk; just noting potential false-positive `error` event during cold start.

- **`channel-manager.ts:362`** error message `"Source index ${sourceIndex} out of bounds (channel has ${channel.sources.length} sources)"` — duplicated nearly verbatim in `removeSource:325` and `updateSource:359`. Extract `assertSourceIndexInRange(channel, sourceIndex)` helper (DRY).

- **`channel-manager.ts:902-907`** `findChannelByPipelineId` linear scan acceptable for ≤10 channels, but `getPipelineToChannelMap()` already builds the reverse map. If you cache it, both lookups are O(1). Defer; not on hot path.

### Strengths

- Pipeline-builder is a pure function module — zero side effects, documented in module header.
- Single code path for 1/2/N sources — no special-case branch in `buildChannelPipelineString`. Matches Tiger-style "one path".
- `computeEffectiveGain` extracted with explicit "Single source of truth" doc comment.
- `FILE_LOOP_RESTART_DELAY_MS = 200` named, justified in comment.
- 18 tests with **structural** regex assertions (`/audiomixer name=mix\b/`, `/mix\.sink_\d+/g`) — survive attribute-order refactors. No byte-equality on full pipeline strings.
- `assertSinglePipelinePerChannel` 3-condition invariant (no duplicate values, size ≤ channels, no orphan keys) — comprehensive guard.
- `replacePipeline` correctly relies on `removePipeline`'s embedded 400ms Windows-socket-release; doesn't double-delay.
- `wasStopRequested` exposed as live getter (not closure-captured) — pipeline-manager forwarding semantics correct.
- Test #346 ("invariant violation throws") proactively poisons the Map and asserts the invariant fires. Tiger-style "test the failure path".
- Zero `any`, zero `as any` in pipeline source. Test stubs use `as unknown as PipelineManager` documented in test scaffolding header.
- Crash recovery (`restartTimers`, `streamingStabilityTimers`, exponential backoff capped at `maxRestartDelayMs`, `STREAMING_STABILITY_MS = 5000` reset gate) untouched by refactor.

## Recommendations

Not a ship blocker. Two functional fixes worth landing while context is fresh:
1. `getChannelIndex` fail-loud on unknown id (Major #2)
2. Decision on `delayMs` (implement-or-reject — currently a phantom API) (Major #1)

Other items are polish; batch into next chore commit.
