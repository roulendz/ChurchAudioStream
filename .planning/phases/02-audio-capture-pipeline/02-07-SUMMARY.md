---
phase: 02-audio-capture-pipeline
plan: 07
subsystem: audio-monitoring
tags: [pidusage, eventEmitter, jsonl, metering, resource-tracking]

# Dependency graph
requires:
  - phase: 02-audio-capture-pipeline
    plan: 01
    provides: "PipelineConfig, AudioLevels, PipelineStats types"
  - phase: 02-audio-capture-pipeline
    plan: 02
    provides: "dbToNormalized metering utility, metering parser"
provides:
  - "LevelMonitor: real-time audio level aggregation with dB-to-normalized conversion"
  - "ResourceMonitor: per-pipeline CPU/memory tracking via pidusage polling"
  - "EventLogger: per-channel event persistence with JSONL disk format and 30-day retention"
affects:
  - 02-08 (integration will wire monitors into pipeline lifecycle)
  - 02-09 (WebSocket broadcast consumes monitor events)

# Tech tracking
tech-stack:
  added: ["@types/pidusage (dev)"]
  patterns:
    - "JSONL append-only log format for crash-safe persistence"
    - "Debounced disk writes (500ms) to prevent I/O storms"
    - "Typed EventEmitter generics for type-safe event subscriptions"
    - "Automatic stale PID cleanup when process exits"

key-files:
  created:
    - sidecar/src/audio/monitor/level-monitor.ts
    - sidecar/src/audio/monitor/resource-monitor.ts
    - sidecar/src/audio/monitor/event-logger.ts
  modified:
    - sidecar/package.json
    - sidecar/package-lock.json

key-decisions:
  - "5-second pidusage polling interval (wmic on Windows is slow)"
  - "JSONL format for event logs (append-only, crash-safe, line-by-line parsing)"
  - "1000-event in-memory cache per channel with oldest-first eviction"
  - "Momentary clipping: true for one frame then auto-cleared"

patterns-established:
  - "Monitor pattern: EventEmitter with typed events + getter methods for snapshots"
  - "JSONL persistence: append-only writes, load with malformed-line skip, periodic retention rewrite"

# Metrics
duration: 5min
completed: 2026-02-07
---

# Phase 2 Plan 7: Monitoring Subsystem Summary

**Level aggregation (dB to 0-1 normalized), per-pipeline CPU/memory tracking via pidusage, and per-channel JSONL event logging with 30-day retention**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-07T14:08:20Z
- **Completed:** 2026-02-07T14:12:56Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments
- LevelMonitor converts raw GStreamer dB levels to normalized 0.0-1.0 range with momentary clipping detection for VU meters
- ResourceMonitor polls pidusage every 5 seconds for per-pipeline CPU% and memory, auto-untracks stale PIDs
- EventLogger persists per-channel events (start, stop, crash, error, etc.) to JSONL files with debounced writes, 1000-event memory cache, and 30-day retention cleanup

## Task Commits

Each task was committed atomically:

1. **Task 1: Create LevelMonitor and ResourceMonitor** - `682bcdb` (feat)
2. **Task 2: Create EventLogger with disk persistence and retention** - `d6fae80` (feat)

## Files Created/Modified
- `sidecar/src/audio/monitor/level-monitor.ts` - Aggregates audio levels from all pipelines, converts dB to 0-1 normalized range, emits "levels-updated" events
- `sidecar/src/audio/monitor/resource-monitor.ts` - Polls pidusage for CPU%/memory per pipeline PID, auto-untracks exited processes
- `sidecar/src/audio/monitor/event-logger.ts` - Per-channel JSONL event logging with debounced writes, in-memory cache, and 30-day retention
- `sidecar/package.json` - Added @types/pidusage dev dependency
- `sidecar/package-lock.json` - Lockfile updated

## Decisions Made
- **5-second polling interval for pidusage:** wmic on Windows is slow; 5s prevents overloading while still providing useful resource data for admin dashboard
- **JSONL format for event logs:** Append-only writes are cheap (no file rewrite), line-by-line parsing is tolerant of partial writes from crashes, and malformed lines are safely skipped on load
- **1000-event in-memory cache per channel:** Balances fast snapshot access with bounded memory usage; oldest events evicted first
- **Momentary clipping detection:** Clipping flag is true for the frame it occurs, then auto-cleared on next non-clipping frame (matches "momentary red flash" UX from CONTEXT.md)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed @types/pidusage dev dependency**
- **Found during:** Task 1 (ResourceMonitor)
- **Issue:** pidusage v4 ships no TypeScript type definitions; `import pidusage from "pidusage"` fails tsc without types
- **Fix:** Installed @types/pidusage as dev dependency
- **Files modified:** sidecar/package.json, sidecar/package-lock.json
- **Verification:** npx tsc --noEmit passes
- **Committed in:** 682bcdb (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for TypeScript compilation. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three monitoring modules ready to be wired into PipelineManager and ChannelManager (Plan 08 integration)
- LevelMonitor.handleLevels() is the callback for pipeline metering events
- ResourceMonitor.trackPipeline() should be called when pipelines start, untrackPipeline() on stop
- EventLogger.log() should be called on channel lifecycle events

---
*Phase: 02-audio-capture-pipeline*
*Completed: 2026-02-07*
