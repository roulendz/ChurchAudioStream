---
phase: "04"
plan: "09"
subsystem: "audio-pipeline, streaming, shutdown"
tags: [graceful-shutdown, pipeline-manager, event-cleanup, race-condition]
requires:
  - "02-03 (PipelineManager auto-restart with exponential backoff)"
  - "04-05 (StreamingSubsystem lifecycle wiring)"
provides:
  - "Single Ctrl+C graceful shutdown without orphaned GStreamer processes"
  - "isShuttingDown guard preventing restart scheduling during teardown"
  - "Streaming event listener cleanup on stop()"
affects:
  - "Phase 8 (worker rotation -- shutdown guard pattern may extend)"
  - "Phase 10 (packaging -- clean shutdown important for installer/uninstaller)"
tech-stack:
  added: []
  patterns:
    - "Shutdown guard flag with defense-in-depth (3 check points)"
    - "Bound handler reference pattern for EventEmitter cleanup"
key-files:
  created: []
  modified:
    - "sidecar/src/audio/pipeline/pipeline-manager.ts"
    - "sidecar/src/audio/audio-subsystem.ts"
    - "sidecar/src/streaming/streaming-subsystem.ts"
    - "sidecar/src/index.ts"
key-decisions:
  - "shutdown() is separate from stopAll() per SRP: shutdown is a prepare signal, stopAll is actual teardown"
  - "Three layers of defense-in-depth: handleCrashedPipeline, scheduleRestart entry, setTimeout callback"
  - "removeAudioSubsystemListeners called as step 0 of streaming stop() before notification/drain"
  - "prepareShutdown() is synchronous and called before any async streaming teardown begins"
duration: "4 minutes"
completed: "2026-02-10"
---

# Phase 04 Plan 09: Graceful Shutdown Fix Summary

**isShuttingDown guard on PipelineManager + event listener cleanup prevents orphaned GStreamer processes during 5s streaming drain window**

## Performance

| Metric | Value |
|--------|-------|
| Duration | 4 minutes |
| Tasks | 2/2 |
| Commits | 2 |
| Files modified | 4 |
| Lines added | ~106 |
| Lines removed | ~27 |

## Accomplishments

1. **PipelineManager shutdown guard** -- Added `isShuttingDown` flag with `shutdown()` method that disables all restart scheduling. Three defense-in-depth guard points: `handleCrashedPipeline()` entry, `scheduleRestart()` entry, and `setTimeout` callback.

2. **AudioSubsystem.prepareShutdown()** -- New method that delegates to `pipelineManager.shutdown()`. Called synchronously from `index.ts` before any async streaming teardown begins, closing the race window.

3. **Shutdown sequence reordering** -- `setupGracefulShutdown()` in `index.ts` now calls `prepareShutdown()` -> `streamingSubsystem.stop()` -> `audioSubsystem.stop()`. The prepare step is instant (synchronous flag set), ensuring no restarts fire during the 5-second streaming drain.

4. **Streaming event listener cleanup** -- `wireAudioSubsystemEvents()` now stores bound handler references. New `removeAudioSubsystemListeners()` method removes them via `.off()`. Called as step 0 of `streaming.stop()` before notification/drain, preventing streaming from reacting to channel state changes during teardown.

## Task Commits

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Add shutdown guard + prepareShutdown | e67ed50 | isShuttingDown flag, 3 guard points, shutdown(), prepareShutdown() |
| 2 | Wire shutdown sequence + event cleanup | fd78e53 | prepareShutdown in index.ts, bound handlers, removeAudioSubsystemListeners() |

## Files Modified

| File | Changes |
|------|---------|
| `sidecar/src/audio/pipeline/pipeline-manager.ts` | Added `isShuttingDown` flag, `shutdown()` method, 3 guard points |
| `sidecar/src/audio/audio-subsystem.ts` | Added `prepareShutdown()` method |
| `sidecar/src/streaming/streaming-subsystem.ts` | Stored bound handler refs, added `removeAudioSubsystemListeners()`, called in `stop()` |
| `sidecar/src/index.ts` | Added `prepareShutdown()` call before streaming stop in shutdown sequence |

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| shutdown() separate from stopAll() | SRP: shutdown is prepare-only signal (set flag, clear timers); stopAll is actual teardown in audioSubsystem.stop() |
| Three defense-in-depth guards | Belt-and-suspenders: even if one guard is bypassed (e.g., timer already fired), the next catches it |
| removeAudioSubsystemListeners as step 0 | Must run before notification/drain to prevent streaming from reacting to audio events during teardown |
| Synchronous prepareShutdown before async stop | The flag must be set instantly, before any async work that could trigger pipeline crashes |

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

- Pre-existing TypeScript compilation errors from parallel 04-08 agent's work-in-progress were observed during Task 1 verification, but they did not affect this plan's files and resolved by Task 2 (04-08 completed in parallel).

## Next Phase Readiness

- Graceful shutdown is now clean: single Ctrl+C exits without orphaned processes
- Pipeline auto-restart still functions during normal operation (isShuttingDown only set in shutdown path)
- Pattern is extensible for Phase 8 worker rotation (could add similar guard for worker restart scheduling)

## Self-Check: PASSED
