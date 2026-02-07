---
status: diagnosed
phase: 02-audio-capture-pipeline
source: 02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md, 02-06-SUMMARY.md, 02-07-SUMMARY.md, 02-08-SUMMARY.md, 02-09-SUMMARY.md
started: 2026-02-07T15:00:00Z
updated: 2026-02-07T15:10:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Sidecar starts with audio subsystem
expected: Launch the Tauri app (or run the sidecar directly). In the console/logs, you should see log messages indicating the AudioSubsystem has been created and started -- messages about DiscoveryManager, SAP listener, device enumeration, and the audio subsystem being ready. No crash or error on startup.
result: issue
reported: "Sidecar starts and Phase 1 functionality works (config, HTTPS, mDNS) but no audio subsystem messages appear in logs -- no AudioSubsystem creation, no DiscoveryManager, no SAP listener, no device enumeration polling. Only Phase 1 startup messages visible."
severity: major

### 2. Local audio devices listed via WebSocket
expected: Connect to the WebSocket as admin and send a `sources:list` message. The response should include local audio input devices discovered on this machine (e.g., microphones, line-in, USB interfaces) with their API type (wasapi2, asio, or directsound), device name, and composite ID format (api:deviceId).
result: issue
reported: "Sending sources:list message returns {type:'error', payload:{message:'Invalid JSON'}}. Audio WebSocket handlers not registered."
severity: major

### 3. Channel CRUD via WebSocket
expected: Send a `channel:create` message with a name (e.g., "Main Audio"). The response should confirm creation with a UUID-based channel ID. Then send `channels:list` -- the new channel should appear.
result: issue
reported: "Sending channel:create returns {type:'error', payload:{message:'Unknown message type: channel:create', originalType:'channel:create'}}. Audio message router not registered in WebSocket handler."
severity: major

### 4. Source assignment to channel
expected: Create a channel, then send `channel:source:add` with a valid local device source ID from the sources list. The response should confirm the source was assigned.
result: skipped
reason: Blocked by audio subsystem not starting (Tests 1-3)

### 5. GStreamer pipeline starts on channel start
expected: With a channel that has a source assigned, send `channel:start`. GStreamer process should spawn, channel status should transition to "streaming".
result: skipped
reason: Blocked by audio subsystem not starting (Tests 1-3)

### 6. Audio level data received via WebSocket
expected: With a channel streaming, admin WebSocket client should receive `levels:update` broadcast messages at ~100ms intervals with peak, rms, and decay values.
result: skipped
reason: Blocked by audio subsystem not starting (Tests 1-3)

### 7. Channel stop kills GStreamer process
expected: Send `channel:stop` for the streaming channel. GStreamer process should terminate, channel status should return to "stopped".
result: skipped
reason: Blocked by audio subsystem not starting (Tests 1-3)

### 8. Multiple channels run independently
expected: Two channels with different sources both stream independently. Stopping one doesn't affect the other.
result: skipped
reason: Blocked by audio subsystem not starting (Tests 1-3)

### 9. Channel config persists across restart
expected: Channel and source assignment survive sidecar restart (loaded from JSON config file).
result: skipped
reason: Blocked by audio subsystem not starting (Tests 1-3)

### 10. Device hot-plug detection
expected: Plugging/unplugging a USB audio device triggers sources:changed broadcast within polling interval.
result: skipped
reason: Blocked by audio subsystem not starting (Tests 1-3)

### 11. Source switching on a channel
expected: Changing a channel's source stops old pipeline and starts new one automatically.
result: skipped
reason: Blocked by audio subsystem not starting (Tests 1-3)

### 12. Pipeline crash recovery
expected: Killing gst-launch-1.0 process triggers automatic restart with channel status cycling through crashed back to streaming.
result: skipped
reason: Blocked by audio subsystem not starting (Tests 1-3)

## Summary

total: 12
passed: 0
issues: 3
pending: 0
skipped: 9

## Gaps

- truth: "AudioSubsystem initializes on sidecar startup with log messages confirming DiscoveryManager, SAP listener, and device enumeration"
  status: failed
  reason: "User reported: Sidecar starts with Phase 1 functionality but no audio subsystem messages appear -- AudioSubsystem not created or started"
  severity: major
  test: 1
  root_cause: "Sidecar runs as pkg-compiled binary built from Phase 1 source before Phase 2 changes. dist/index.js has no AudioSubsystem import/creation. dist/audio/ directory does not exist."
  artifacts:
    - path: "sidecar/dist/index.js"
      issue: "Missing AudioSubsystem import, creation, and start() call"
    - path: "sidecar/dist/audio/"
      issue: "Entire directory missing from compiled output"
    - path: "src-tauri/binaries/server-x86_64-pc-windows-msvc.exe"
      issue: "Built from stale dist/ (Phase 1 only)"
  missing:
    - "Rebuild sidecar: run npm run build in sidecar/ to recompile TypeScript and regenerate pkg binary"
  debug_session: ".planning/debug/audio-subsystem-not-initializing.md"

- truth: "WebSocket sources:list returns discovered local audio devices"
  status: failed
  reason: "User reported: sources:list returns Invalid JSON error -- audio WebSocket handlers not registered"
  severity: major
  test: 2
  root_cause: "Same as Gap 1: stale binary. dist/ws/handler.js has no isAudioMessageType, handleAudioMessage, or wireAudioBroadcasts functions. Audio message types fall through to default case."
  artifacts:
    - path: "sidecar/dist/ws/handler.js"
      issue: "Missing all audio message routing (handleAudioMessage, isAudioMessageType, AUDIO_MESSAGE_PREFIXES)"
  missing:
    - "Rebuild sidecar binary to include Phase 2 audio WebSocket handlers"
  debug_session: ".planning/debug/audio-subsystem-not-initializing.md"

- truth: "WebSocket channel:create creates a new channel with UUID"
  status: failed
  reason: "User reported: channel:create returns Unknown message type error -- audio message router not wired into WebSocket handler"
  severity: major
  test: 3
  root_cause: "Same as Gap 1: stale binary. channel:create hits default branch in compiled handler.js which returns 'Unknown message type'."
  artifacts:
    - path: "sidecar/dist/ws/handler.js"
      issue: "No audio message prefix routing; channel:* messages unrecognized"
  missing:
    - "Rebuild sidecar binary to include Phase 2 audio WebSocket handlers"
  debug_session: ".planning/debug/audio-subsystem-not-initializing.md"
