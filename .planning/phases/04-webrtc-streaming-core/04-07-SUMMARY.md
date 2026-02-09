---
phase: 04-webrtc-streaming-core
plan: 07
subsystem: audio
tags: [gstreamer, metering, parser, regex, GValueArray, bug-fix, gap-closure]

requires:
  - phase: 04-webrtc-streaming-core
    provides: "Phase 4 streaming infrastructure (plans 01-06)"
provides:
  - "Fixed GStreamer level parser supporting GValueArray format"
  - "Correct stdout/stderr wiring for level metering and error detection"
affects: [05-listener-web-ui, 06-admin-dashboard]

tech-stack:
  added: []
  patterns: ["dual-format regex parsing", "stdout metering / stderr error detection"]

key-files:
  created: []
  modified:
    - sidecar/src/audio/pipeline/metering-parser.ts
    - sidecar/src/audio/pipeline/gstreamer-process.ts

key-decisions:
  - "Unified regex handles both (double) and (GValueArray) type annotations via \\([^)]+\\) wildcard"
  - "Level parser wired to stdout (where gst-launch-1.0 -m outputs bus messages)"
  - "Separate stderr error detector for GStreamer errors/warnings with line-by-line buffering"
  - "Defense-in-depth: error pattern checked on both stdout and stderr"

duration: 4m
completed: 2026-02-09
---

# Phase 4 Plan 07: GStreamer Level Parser Bug Fix Summary

**Fix two critical bugs in metering parser: GValueArray regex support and stdout/stderr wiring swap, unblocking 6 of 14 UAT tests**

## Performance
- **Duration:** 4 minutes
- **Started:** 2026-02-09T20:32:06Z
- **Completed:** 2026-02-09T20:36:31Z
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments
- Updated `buildFieldPattern` regex to match both `(double)` and `(GValueArray)` type annotations using `\([^)]+\)` wildcard, supporting GStreamer 1.26's `peak=(GValueArray)< -90.308 >` output format while maintaining backward compatibility with `peak=(double)-12.5`
- Rewired GStreamerProcess to parse level metering data from `child.stdout` (where `gst-launch-1.0 -m` outputs bus messages) instead of the incorrect `child.stderr`
- Added dedicated `attachStderrErrorDetector` method with proper line-by-line buffering for detecting GStreamer errors/warnings on stderr, with non-error lines logged at debug level
- Renamed functions for accuracy: `createStderrLineParser` -> `createBusMessageLineParser`, `attachStderrParser` -> `attachStdoutLevelParser`, `attachStdoutHandler` -> `attachStderrErrorDetector`
- Verified all 6 format variants parse correctly: double single, double multi (braces), GValueArray single, GValueArray multi, -inf, and full real GStreamer 1.26 output
- Channels can now transition from pre-streaming state to "streaming" on first level data, unblocking UAT Tests 6, 7, 8, 9, 12, and 14

## Task Commits
1. **Task 1: Fix metering parser regex to handle GValueArray format** - `aa1c9fe` (fix)
2. **Task 2: Rewire stdout for level parsing, stderr for error detection** - `0385c58` (fix)

## Files Created/Modified
- `sidecar/src/audio/pipeline/metering-parser.ts` - Updated buildFieldPattern regex to handle both (double) and (GValueArray) type annotations; renamed createStderrLineParser to createBusMessageLineParser; updated all JSDoc comments to reflect stdout bus message processing
- `sidecar/src/audio/pipeline/gstreamer-process.ts` - Rewired level parsing to child.stdout; added attachStderrErrorDetector with line-by-line buffering for GStreamer error/warning detection on stderr; updated import to createBusMessageLineParser; updated JSDoc comments

## Decisions Made
1. **Unified regex over two-pattern approach**: Single regex `\([^)]+\)` matches any GStreamer type annotation (double, GValueArray, future types) rather than maintaining separate patterns per type. Tested against 6 format variants.
2. **Defense-in-depth error detection**: Error pattern checked on both stdout (via createBusMessageLineParser onError callback) and stderr (via attachStderrErrorDetector). Redundant but harmless -- catches errors regardless of which stream GStreamer writes them to.
3. **Line-by-line stderr buffering**: New attachStderrErrorDetector uses the same partial-line accumulation pattern as the bus message parser, properly handling chunk boundaries and Windows \r line endings.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## Next Phase Readiness
- Both bugs that blocked streaming state transitions are fixed
- UAT Tests 6, 7, 8, 9, 12, and 14 should now pass (channels reach "streaming" state when GStreamer outputs level data)
- Phase 4 gap closure complete; ready for Phase 5 (Listener Web UI)

## Self-Check: PASSED

---
*Phase: 04-webrtc-streaming-core*
*Completed: 2026-02-09*
