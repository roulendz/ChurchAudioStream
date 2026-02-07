---
phase: 03-audio-processing
plan: 03
subsystem: audio
tags: [processing, websocket, debounce, agc, opus, pipeline-restart, channel-manager]

# Dependency graph
requires:
  - phase: 03-01
    provides: ProcessingConfig type system, Zod schemas, port allocator, SSRC generator
  - phase: 03-02
    provides: Pipeline builder processing chain (AGC, Opus, RTP), gain reduction estimation
  - phase: 02-09
    provides: AudioSubsystem facade, WebSocket handler, channel manager, level broadcast
provides:
  - Processing config integrated into channel lifecycle (create, load, persist, restart)
  - Debounced pipeline restart on processing config changes (1.5s)
  - WebSocket API for processing config (get, update, reset)
  - ProcessingConfigUpdate type for partial nested updates
  - AudioSubsystem facade methods for processing config
affects: [04-mediasoup-webrtc, admin-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Debounced pipeline restart pattern: per-channel timer map with configurable delay"
    - "ProcessingConfigUpdate type: partial nested updates with deep-merge at channel manager"
    - "frameSize string-to-number conversion at WebSocket boundary"

key-files:
  modified:
    - sidecar/src/audio/channels/channel-manager.ts
    - sidecar/src/audio/channels/channel-types.ts
    - sidecar/src/audio/audio-subsystem.ts
    - sidecar/src/audio/processing/processing-types.ts
    - sidecar/src/ws/handler.ts
    - sidecar/src/ws/types.ts

key-decisions:
  - "ProcessingConfigUpdate type for partial nested updates (avoids requiring full sub-config objects)"
  - "1.5s debounce delay for processing config change restarts (within 1-2s spec)"
  - "RTP ports not exposed in WebSocket update payload (auto-allocated, prevents admin errors)"
  - "frameSize converted from string to number at WebSocket boundary (JSON serializes as string)"
  - "Processing config separate from ChannelUpdatableFields (dedicated method with debounce, per SRP)"

patterns-established:
  - "Debounced restart: per-channel timer map, clear on stop/remove, fire-and-forget with error logging"
  - "Deep-merge pattern: check each nested key individually, spread-merge at nested level"

# Metrics
duration: 8min
completed: 2026-02-07
---

# Phase 3 Plan 3: Processing Config Runtime Integration Summary

**WebSocket API wired to channel manager with debounced pipeline restart for processing config changes (AGC, Opus, mode switch)**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-07T17:21:57Z
- **Completed:** 2026-02-07T17:30:21Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Processing config fully integrated into channel lifecycle: create with defaults, load from config, persist on change
- Debounced pipeline restart (1.5s) on processing config changes -- only when channel is actively streaming
- WebSocket API for admin: get, update (partial), and reset processing config per channel
- Mode switch (speech/music) auto-derives audioType and maxTruePeakDbtp via deriveSettingsFromMode
- AGC target set on level monitor at pipeline start for gain reduction computation

## Task Commits

Each task was committed atomically:

1. **Task 1: Channel manager processing integration with debounced restart** - `1ed6fac` (feat)
2. **Task 2: AudioSubsystem facade and WebSocket API for processing config** - `97d29cd` (feat)

## Files Created/Modified
- `sidecar/src/audio/channels/channel-types.ts` - Added ProcessingConfig to AppChannel interface
- `sidecar/src/audio/channels/channel-manager.ts` - updateProcessingConfig, resetProcessingDefaults, debounced restart, processing in pipeline config
- `sidecar/src/audio/processing/processing-types.ts` - Added ProcessingConfigUpdate type for partial nested updates
- `sidecar/src/audio/audio-subsystem.ts` - Facade methods: updateProcessingConfig, resetProcessingDefaults, getProcessingConfig
- `sidecar/src/ws/handler.ts` - WebSocket handlers: channel:processing:get, channel:processing:update, channel:processing:reset
- `sidecar/src/ws/types.ts` - ProcessingUpdatePayload, ProcessingResetPayload, ProcessingGetPayload, channel:processing:updated

## Decisions Made
- **ProcessingConfigUpdate type:** Created a dedicated partial-nested update type rather than using `Partial<ProcessingConfig>` which requires full nested objects. The channel manager deep-merges at runtime.
- **1.5s debounce:** Chosen as the midpoint of the 1-2s spec range. Prevents rapid pipeline restarts from slider drag while still feeling responsive.
- **RTP ports excluded from WebSocket payload:** Admin cannot manually set RTP ports -- they are auto-allocated by the port allocator based on channel index. Prevents admin from breaking port allocation.
- **frameSize string-to-number conversion:** frameSize is stored as string in Zod/JSON ("10", "20", "40") but as number in TypeScript (10, 20, 40). Conversion happens at WebSocket handler boundary.
- **Processing config separate from ChannelUpdatableFields:** Processing uses a dedicated method with debounce logic rather than going through the generic updateChannel path. Follows SRP.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added ProcessingConfigUpdate type for type-safe partial nested updates**
- **Found during:** Task 2 (WebSocket handler compilation)
- **Issue:** `Partial<ProcessingConfig>` requires full nested objects (e.g., complete AgcConfig), but WebSocket payloads send partial nested objects (e.g., just `{ targetLufs: -18 }`). TypeScript rejected the assignment.
- **Fix:** Created `ProcessingConfigUpdate` interface in processing-types.ts with `Partial<AgcConfig>`, `Partial<OpusEncodingConfig>`, `Partial<RtpOutputConfig>` nested types. Updated channel manager and audio subsystem to use it.
- **Files modified:** sidecar/src/audio/processing/processing-types.ts, sidecar/src/audio/channels/channel-manager.ts, sidecar/src/audio/audio-subsystem.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** 97d29cd (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Type fix necessary for correct TypeScript compilation. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3 (Audio Processing) is now complete: type system (Plan 01), pipeline builder (Plan 02), and runtime integration (Plan 03) all wired together
- Ready for Phase 4 (mediasoup/WebRTC): processing pipelines produce Opus/RTP output on localhost, which mediasoup PlainTransport will consume
- Admin can control all processing settings via WebSocket before Phase 4 begins
- Gain reduction data flows through existing level broadcasts for VU meter display

## Self-Check: PASSED

---
*Phase: 03-audio-processing*
*Completed: 2026-02-07*
