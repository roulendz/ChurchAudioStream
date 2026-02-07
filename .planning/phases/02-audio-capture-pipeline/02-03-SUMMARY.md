---
phase: 02-audio-capture-pipeline
plan: 03
subsystem: audio
tags: [gstreamer, child-process, pipeline, crash-recovery, event-emitter]

# Dependency graph
requires:
  - phase: 02-01
    provides: PipelineConfig, PipelineState, AudioLevels, PipelineError type definitions
  - phase: 02-02
    provides: buildPipelineString function, createStderrLineParser for stderr metering
provides:
  - GStreamerProcess class wrapping one gst-launch-1.0 child process with lifecycle management
  - PipelineManager class managing all active pipelines with crash recovery
affects: [02-08-channel-manager, 02-09-integration, 03-audio-processing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "EventEmitter forwarding with ID prefix for multiplexed pipeline events"
    - "SIGTERM + SIGKILL drain timeout for graceful child process shutdown"
    - "Restart counter with streaming-state reset for crash recovery"

key-files:
  created:
    - sidecar/src/audio/pipeline/gstreamer-process.ts
    - sidecar/src/audio/pipeline/pipeline-manager.ts
  modified: []

key-decisions:
  - "shell:true on spawn for Windows gst-launch-1.0 compatibility (pipeline strings contain !, =, quotes)"
  - "First level data triggers state transition to streaming (no separate handshake needed)"
  - "Pipeline IDs are UUIDs not channel IDs -- 1:N channel-to-pipeline mapping deferred to Plan 08"
  - "Restart counter resets on streaming state to allow recovery cycles after stable operation"

patterns-established:
  - "One-shot process pattern: GStreamerProcess instances are never reused, always kill and create new"
  - "Event forwarding with ID: pipeline events re-emitted at manager level with pipelineId for downstream routing"
  - "Configurable recovery: RecoveryConfig separates crash recovery policy from process implementation"

# Metrics
duration: 6min
completed: 2026-02-07
---

# Phase 2 Plan 3: GStreamer Process Wrapper and Pipeline Manager Summary

**GStreamerProcess wraps gst-launch-1.0 with lifecycle/metering/crash-detection; PipelineManager provides registry with configurable auto-restart recovery**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-07T14:07:01Z
- **Completed:** 2026-02-07T14:12:46Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments
- GStreamerProcess wraps a single gst-launch-1.0 child process with full state lifecycle (stopped -> initializing -> connecting -> streaming | crashed)
- Level metering data parsed from stderr via createStderrLineParser and emitted as typed events
- Graceful shutdown with SIGTERM + drain timeout + SIGKILL fallback
- PipelineManager registry with crash recovery: auto-restart with configurable attempt limit, delay, and streaming-state counter reset

## Task Commits

Each task was committed atomically:

1. **Task 1: Create GStreamerProcess child process wrapper** - `def6588` (feat)
2. **Task 2: Create PipelineManager registry with crash recovery** - `b311477` (feat)

## Files Created/Modified
- `sidecar/src/audio/pipeline/gstreamer-process.ts` - GStreamerProcess class wrapping one gst-launch-1.0 child process with spawn, stop, state transitions, stderr parsing, and error handling
- `sidecar/src/audio/pipeline/pipeline-manager.ts` - PipelineManager class managing all active pipelines with create/start/stop/remove lifecycle, event forwarding with pipeline IDs, and configurable crash recovery

## Decisions Made
- Used `shell: true` on spawn for Windows compatibility -- pipeline strings contain GStreamer-specific syntax (!, =, quoted device paths) that need shell interpretation
- First level data from stderr parser triggers automatic transition to "streaming" state -- no separate handshake or health-check needed
- Pipeline IDs are crypto.randomUUID() values, not channel IDs -- the channel-to-pipeline mapping is handled by PipelineManager consumers (Plan 08 channel manager)
- Restart counter resets to zero when pipeline reaches "streaming" state -- allows unlimited recovery cycles as long as each recovery succeeds

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- GStreamerProcess and PipelineManager ready for consumption by channel manager (Plan 08)
- Pipeline builder (02-02) and metering parser (02-02) correctly integrated via imports
- Crash recovery tested at type level; runtime validation will occur in integration (Plan 09)

---
*Phase: 02-audio-capture-pipeline*
*Completed: 2026-02-07*
