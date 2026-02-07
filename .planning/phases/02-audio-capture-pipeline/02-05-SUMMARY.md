---
phase: 02-audio-capture-pipeline
plan: 05
subsystem: audio
tags: [gstreamer, wasapi2, asio, directsound, device-enumeration, hot-plug, polling]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: logger utility, TypeScript project structure, Node.js sidecar
provides:
  - DeviceEnumerator class for discovering local audio input/output devices via gst-device-monitor-1.0
  - EnumeratedDevice type with API categorization (wasapi2/asio/directsound)
  - Polling-based hot-plug detection with device-added/device-removed events
  - Output device enumeration for audio monitor feature
affects: [02-06-discovery-manager, 02-08-channel-manager, 06-02-channel-config-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "execFile with timeout for CLI tool invocation (gst-device-monitor-1.0)"
    - "Polling-based device change detection via Map diff comparison"
    - "EventEmitter for device lifecycle events"

key-files:
  created:
    - sidecar/src/audio/discovery/device-enumerator.ts
  modified: []

key-decisions:
  - "Composite device ID format: ${api}:${deviceId} ensures same physical device appears separately per API"
  - "Bluetooth detection uses both name patterns and device path patterns for thorough filtering"
  - "WASAPI loopback detection checks both explicit device.loopback property and name heuristics"
  - "runDeviceMonitor is a shared helper used for both Audio/Source and Audio/Sink enumeration"
  - "Polling errors log and continue rather than stopping the poll timer (transient error resilience)"

patterns-established:
  - "GStreamer CLI tool wrapper: execFile with timeout, ENOENT detection, JSON parse with fallback"
  - "Device diff pattern: Map keyed by composite ID, symmetric difference for add/remove events"

# Metrics
duration: 4min
completed: 2026-02-07
---

# Phase 2 Plan 5: Local Audio Device Enumeration Summary

**DeviceEnumerator class wrapping gst-device-monitor-1.0 with API categorization (wasapi2/asio/directsound), Bluetooth filtering, loopback flagging, and polling-based hot-plug detection**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-07T13:46:01Z
- **Completed:** 2026-02-07T13:49:54Z
- **Tasks:** 1
- **Files created:** 1

## Accomplishments

- DeviceEnumerator discovers local audio input devices by running gst-device-monitor-1.0 with -f json flag and 10s timeout
- Devices categorized by Windows audio API (wasapi2, asio, directsound) from GStreamer element factory properties
- Bluetooth devices detected via name and path patterns, filtered from all results
- WASAPI loopback devices identified via explicit property and name-based heuristics
- Polling-based hot-plug detection compares device snapshots via Map diff, emits device-added/device-removed
- Output device enumeration (Audio/Sink) provided for the audio monitor feature
- Defensive JSON parsing with fallback logging for older GStreamer versions without -f json support
- Clear error message when GStreamer is not installed

## Task Commits

Each task was committed atomically:

1. **Task 1: Create device enumerator with gst-device-monitor-1.0 JSON parsing** - `1cbb05c` (feat)

## Files Created/Modified

- `sidecar/src/audio/discovery/device-enumerator.ts` - DeviceEnumerator class with enumerate(), enumerateOutputDevices(), startPolling(), stopPolling(), getCurrentDevices(), getDeviceById() methods

## Decisions Made

- **Composite device ID format (`${api}:${deviceId}`)**: Ensures the same physical device appears as separate entries per audio API, matching the CONTEXT.md requirement that admins see "Focusrite (ASIO)" and "Focusrite (WASAPI)" separately
- **Shared `runDeviceMonitor` helper**: Both Audio/Source and Audio/Sink enumeration share the same GStreamer invocation and parsing logic (DRY)
- **Polling resilience**: Poll errors are logged and the timer continues, preventing transient GStreamer failures from killing device monitoring
- **Defensive property lookup**: Multiple property key candidates are checked for API detection (device.api, device.plugin, factory.name, etc.) because GStreamer JSON output structure may vary across versions

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. GStreamer must be installed (documented in error message).

## Next Phase Readiness

- DeviceEnumerator is ready for integration into the discovery manager (02-06)
- The EnumeratedDevice type provides all fields needed for pipeline builder (02-02) to construct correct GStreamer pipeline strings per API
- Output device enumeration supports the audio monitor feature referenced in CONTEXT.md

---
*Phase: 02-audio-capture-pipeline*
*Completed: 2026-02-07*
