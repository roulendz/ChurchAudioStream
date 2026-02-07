---
phase: 02-audio-capture-pipeline
plan: 08
subsystem: audio
tags: [channel-manager, pipeline-orchestration, source-assignment, config-persistence, event-emitter]

# Dependency graph
requires:
  - phase: 02-01
    provides: "Pipeline types (PipelineConfig discriminated union, PipelineState, AudioLevels)"
  - phase: 02-03
    provides: "PipelineManager lifecycle (create/start/stop/remove pipelines)"
  - phase: 02-06
    provides: "SourceRegistry with getById for source validation"
  - phase: 02-07
    provides: "LevelMonitor, ResourceMonitor, EventLogger for runtime monitoring"
provides:
  - "ChannelManager class for full app channel lifecycle orchestration"
  - "Channel CRUD with config persistence via ConfigStore"
  - "Source assignment validation against SourceRegistry"
  - "Pipeline orchestration: 1 pipeline per source assignment"
  - "Auto-start channels on app launch"
  - "Channel status aggregation from pipeline states"
affects: ["02-09 (WebSocket API exposes ChannelManager methods)", "Phase 3 (audio processing hooks into pipeline config)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Channel-to-pipeline mapping via sourceIndex -> pipelineId Maps"
    - "Instant cut source switching (stop old pipeline, start new)"
    - "Runtime-only fields (status, createdAt) stripped before config persistence"
    - "Stale source graceful handling (log and skip, don't fail)"

key-files:
  created:
    - sidecar/src/audio/channels/channel-manager.ts
  modified: []

key-decisions:
  - "PipelineManager does not expose PIDs, so ResourceMonitor.trackPipeline is called on untrack only (cleanup); PID tracking deferred to PipelineManager extension"
  - "AppConfig.update() requires Partial<AppConfig> cast for nested partial updates (deepMerge handles arrays at runtime)"
  - "Source assignment index used as string key in pipeline mapping (Map<string, string>) for consistent key identity"
  - "rekeyPipelineMappings shifts indices after source splice to maintain correct pipeline-to-source mapping"

patterns-established:
  - "ChannelManager as central coordinator pattern: owns channel state, delegates to PipelineManager/SourceRegistry/monitors"
  - "Event forwarding chain: GStreamerProcess -> PipelineManager -> ChannelManager -> LevelMonitor/EventLogger"
  - "Config persistence strips runtime fields to match Zod schema"

# Metrics
duration: 3min
completed: 2026-02-07
---

# Phase 2, Plan 8: Channel Manager Summary

**ChannelManager orchestrator with channel CRUD, source assignment validation, pipeline-per-source lifecycle, status aggregation, and config persistence via ConfigStore**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-07T14:17:57Z
- **Completed:** 2026-02-07T14:21:11Z
- **Tasks:** 1
- **Files created:** 1

## Accomplishments
- Full channel lifecycle: create, update, remove with UUID-based IDs and config persistence
- Source assignment management: add, remove, update with SourceRegistry validation and channel-range checks
- Pipeline orchestration: each source assignment spawns an independent GStreamer pipeline via PipelineManager
- Status aggregation: channel status derived from pipeline states (stopped/starting/streaming/error/crashed)
- Auto-start: startAll() launches channels with autoStart=true on app launch
- Event wiring: pipeline-state-change, pipeline-levels, and pipeline-error forwarded to monitors and EventLogger
- Instant cut source switching: selectedChannels change stops old pipeline, starts new one
- Stale source resilience: missing sources are logged and skipped, not treated as errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ChannelManager with full lifecycle management** - `592bbfb` (feat)

**Plan metadata:** (pending)

## Files Created/Modified
- `sidecar/src/audio/channels/channel-manager.ts` - Central orchestrator for app channel lifecycle, source-to-pipeline mapping, config persistence, and status aggregation

## Decisions Made
- PipelineManager does not expose PIDs via its public API, so ResourceMonitor PID tracking is limited to cleanup (untrackPipeline) in this plan. Full PID tracking can be added when PipelineManager gains a getPipelinePid() method.
- Used `Partial<AppConfig>` cast for configStore.update() because TypeScript cannot infer that deepMerge handles partial nested objects -- the runtime behavior is correct.
- Pipeline mappings use stringified source index as key (`Map<string, string>`) because source assignments are array-indexed and indices shift on removal, requiring a rekey operation.
- Hot-add supported: adding a source to an already-streaming channel starts a new pipeline immediately.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TypeScript type error on ConfigStore.update() partial audio object**
- **Found during:** Task 1 (ChannelManager implementation)
- **Issue:** `configStore.update({ audio: { channels: [...] } })` fails TypeScript because the audio sub-object is missing levelMetering, pipelineRecovery, discoveryCache fields
- **Fix:** Added `as Partial<AppConfig>` cast and imported AppConfig from config/schema -- deepMerge handles the partial at runtime
- **Files modified:** sidecar/src/audio/channels/channel-manager.ts
- **Verification:** `npx tsc --noEmit` passes cleanly
- **Committed in:** 592bbfb (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** TypeScript type cast necessary for correct compilation. No scope creep.

## Issues Encountered
None beyond the TypeScript type issue documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ChannelManager ready for Plan 09 (WebSocket API) to expose channel CRUD, source assignment, and start/stop to admin clients
- All Phase 2 subsystems (PipelineManager, SourceRegistry, discovery, monitoring) are now wired together through ChannelManager
- Phase 3 audio processing can hook into pipeline config construction (buildPipelineConfigFromAssignment) to add DSP parameters

---
*Phase: 02-audio-capture-pipeline*
*Completed: 2026-02-07*
