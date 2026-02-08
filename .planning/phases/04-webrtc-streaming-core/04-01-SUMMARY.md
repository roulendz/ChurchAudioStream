---
phase: 04
plan: 01
subsystem: audio-utilities
tags: [dry, refactor, debounce, error-handling, pipeline-builder]
requires:
  - phase-03 (processing config, pipeline builder)
provides:
  - shared debounce utility (scheduleDebounced, clearDebounceTimer, clearAllDebounceTimers)
  - shared error message utility (toErrorMessage)
  - consolidated channel selection builder (buildChannelSelectionString)
  - normalized channel data mapping helpers (normalizeSourceAssignment, normalizeAgcConfig)
affects:
  - 04-02 through 04-06 (new streaming code can reuse utilities)
  - future phases adding error handling or debounce patterns
tech-stack:
  added: []
  patterns:
    - shared utility extraction for DRY compliance
    - map-based debounce timer management
key-files:
  created:
    - sidecar/src/utils/debounce.ts
    - sidecar/src/utils/error-message.ts
  modified:
    - sidecar/src/audio/channels/channel-manager.ts
    - sidecar/src/audio/monitor/event-logger.ts
    - sidecar/src/audio/pipeline/pipeline-manager.ts
    - sidecar/src/audio/pipeline/pipeline-builder.ts
    - sidecar/src/audio/sources/source-registry.ts
    - sidecar/src/audio/discovery/device-enumerator.ts
    - sidecar/src/audio/discovery/discovery-manager.ts
    - sidecar/src/config/store.ts
    - sidecar/src/network/trustedCa.ts
    - sidecar/src/network/certificate.ts
    - sidecar/src/network/hosts.ts
    - sidecar/src/ws/handler.ts
    - sidecar/src/index.ts
key-decisions:
  - pipeline-manager.ts left unchanged (exponential backoff restart is not a debounce pattern)
  - source-registry.ts converted single-timer to Map<string, Timeout> with "persist" key for consistency with shared utility
  - toErrorMessage applied to all 11 files with the pattern, not just the 5 listed in the plan (complete codebase cleanup)
  - normalizeAgcConfig extracted alongside normalizeSourceAssignment (agc mapping was identical in load/persist; opus mapping differs due to type conversions)
  - buildChannelSelectionString uses optional totalSourceChannels param to handle both AES67 and local device cases
duration: 9 min
completed: 2026-02-08
---

# Phase 04 Plan 01: Pre-Phase 04 Audit DRY/SRP Cleanup Summary

Extracted debounce and error-message utilities, consolidated channel selection builder, normalized channel data mapping helpers across 15 files

## Performance

| Metric | Value |
|--------|-------|
| Duration | 9 min |
| Started | 2026-02-08T10:13:47Z |
| Completed | 2026-02-08T10:23:06Z |
| Tasks | 4/4 |
| Files created | 2 |
| Files modified | 13 |

## Accomplishments

1. **scheduleDebounced utility** -- Extracted the repeated setTimeout+clearTimeout debounce pattern into `sidecar/src/utils/debounce.ts` with three exports: `scheduleDebounced`, `clearDebounceTimer`, `clearAllDebounceTimers`. Now used by 3 files (channel-manager, event-logger, source-registry).

2. **toErrorMessage utility** -- Extracted `err instanceof Error ? err.message : String(err)` into `sidecar/src/utils/error-message.ts`. Replaced 13+ inline occurrences across 11 files. Zero remaining inline patterns in the codebase.

3. **Consolidated channel selection builder** -- Merged `buildChannelSelection` (AES67) and `buildChannelSelectionForLocal` (local devices) into single `buildChannelSelectionString(selectedChannels, totalSourceChannels?)`. Optional parameter elegantly handles both source types. Removed 19-line duplicate function.

4. **Normalized channel data mapping** -- Extracted `normalizeSourceAssignment()` and `normalizeAgcConfig()` helpers in channel-manager.ts, eliminating duplicated field mapping between `loadChannelsFromConfig` and `persistChannels`.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Extract scheduleDebounced utility | 5701f88 | utils/debounce.ts, channel-manager.ts, event-logger.ts, source-registry.ts |
| 2 | Extract toErrorMessage utility | 51b3481 | utils/error-message.ts + 11 consumer files |
| 3 | Consolidate channel selection builder | 1a71660 | pipeline-builder.ts |
| 4 | Normalize channel data mapping | 8e77f38 | channel-manager.ts |

## Files Created

| File | Purpose |
|------|---------|
| sidecar/src/utils/debounce.ts | Reusable debounce utilities (scheduleDebounced, clearDebounceTimer, clearAllDebounceTimers) |
| sidecar/src/utils/error-message.ts | Reusable error narrowing utility (toErrorMessage) |

## Files Modified

| File | Changes |
|------|---------|
| sidecar/src/audio/channels/channel-manager.ts | Replaced inline debounce, error narrowing, and data mapping with shared utilities |
| sidecar/src/audio/monitor/event-logger.ts | Replaced inline debounce and timer clearing with shared debounce utility |
| sidecar/src/audio/pipeline/pipeline-manager.ts | Replaced inline error narrowing with toErrorMessage |
| sidecar/src/audio/pipeline/pipeline-builder.ts | Consolidated two channel selection functions into one |
| sidecar/src/audio/sources/source-registry.ts | Replaced inline debounce and error narrowing with shared utilities |
| sidecar/src/audio/discovery/device-enumerator.ts | Replaced inline error narrowing with toErrorMessage |
| sidecar/src/audio/discovery/discovery-manager.ts | Replaced inline error narrowing with toErrorMessage |
| sidecar/src/config/store.ts | Replaced inline error narrowing with toErrorMessage |
| sidecar/src/network/trustedCa.ts | Replaced inline error narrowing with toErrorMessage |
| sidecar/src/network/certificate.ts | Replaced inline error narrowing with toErrorMessage |
| sidecar/src/network/hosts.ts | Replaced inline error narrowing with toErrorMessage |
| sidecar/src/ws/handler.ts | Replaced inline error narrowing with toErrorMessage |
| sidecar/src/index.ts | Replaced inline error narrowing with toErrorMessage |

## Decisions Made

1. **pipeline-manager.ts left as-is for debounce**: The `scheduleRestart` method uses exponential backoff with per-attempt delay calculation, not a simple debounce. Forcing it into `scheduleDebounced` would lose the backoff semantics.

2. **source-registry converted to Map-based timer**: Changed from single `persistTimer` variable to `Map<string, Timeout>` with a `"persist"` key, for API consistency with the shared `scheduleDebounced` utility.

3. **toErrorMessage applied to all 11 files**: Plan listed 5 target files, but the instruction said "search all .ts files." Applied consistently across the entire codebase for complete DRY compliance.

4. **normalizeAgcConfig but not normalizeProcessingConfig**: The AGC config mapping is identical between load and persist. Opus config differs (string/number frameSize conversion, dtx field, audioType derivation). Forcing a shared function would add complexity.

5. **buildChannelSelectionString with optional totalSourceChannels**: When provided (AES67), detects all-channel selection to skip deinterleave. When omitted (local devices), only supports explicit mono/stereo extraction. Preserves exact prior behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Extended toErrorMessage to all codebase files**

- **Found during:** Task 2
- **Issue:** Plan listed 5 files for toErrorMessage replacement, but 6 additional files had the same inline pattern (config/store.ts, network/trustedCa.ts, network/certificate.ts, network/hosts.ts, discovery-manager.ts, ws/handler.ts)
- **Fix:** Applied toErrorMessage to all 11 files with the pattern for complete DRY compliance
- **Files modified:** 6 additional files beyond plan
- **Commit:** 51b3481

### No Other Deviations

All 4 tasks executed as planned. Pipeline-manager.ts correctly identified as not-a-debounce-pattern and left unchanged.

## Issues

None. All tasks completed without blocking issues.

## Next Phase Readiness

- Both new utilities (`scheduleDebounced`, `toErrorMessage`) are ready for use by Phase 04 Plans 02-06
- All 5 audit DRY/SRP findings addressed
- ChannelManager remains under SRP limit (net code reduction)
- Zero TypeScript compilation errors
- All existing audio pipeline behavior preserved (refactor only, no logic changes)

## Self-Check: PASSED
