---
status: complete
phase: 04-webrtc-streaming-core
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md, 04-06-SUMMARY.md]
started: 2026-02-08T11:30:00Z
updated: 2026-02-09T20:17:00Z
---

## Current Test

[testing complete]

## Tests

### 1. mediasoup and protoo-server installed
expected: Running `node -e "require('mediasoup'); require('protoo-server'); console.log('OK')"` in the sidecar directory loads both packages without errors and prints "OK".
result: pass

### 2. Streaming config schema has factory defaults
expected: Starting the app with an existing config.json that has no streaming/mediasoup fields works without errors -- the new fields (mediasoup workerCount, rtcMinPort, rtcMaxPort, streaming heartbeatIntervalMs, per-channel latencyMode/lossRecovery) are auto-filled with Zod factory defaults.
result: pass

### 3. mediasoup workers start on app launch
expected: When the sidecar starts, the log output shows mediasoup workers being created (one per CPU core by default or as configured). No "worker died" errors appear during normal startup.
result: pass

### 4. Listener WebSocket endpoint available
expected: After the app starts, connecting to `wss://<host>:<port>/ws/listener` with a WebSocket client establishes a connection (protoo handshake). The connection is NOT routed to the admin WebSocket handler.
result: pass

### 5. Admin streaming status via WebSocket
expected: Sending `{"type":"streaming:status"}` on the admin WebSocket returns a response with streaming status including worker info, active channels (empty if no channels streaming), and listener count (0).
result: pass

### 6. Channel starts streaming when audio pipeline is active
expected: When a channel is configured with an audio source and its pipeline starts (audio level data flowing), the streaming subsystem automatically creates a mediasoup Router and PlainTransport for that channel. The admin streaming:status shows the channel as active.
result: issue
reported: "Channel stuck at 'starting' status forever despite GStreamer level data flowing continuously. streaming:status shows 0 channels, routerCount 0. Root cause: level parser attached to stderr but gst-launch-1.0 -m sends bus messages (level data) to stdout. Also format mismatch: parser expects peak=(double) but GStreamer outputs peak=(GValueArray)< value >."
severity: blocker

### 7. Listener can receive audio via WebRTC
expected: A browser connecting to `/ws/listener`, completing the protoo signaling flow (getRouterRtpCapabilities -> createWebRtcTransport -> connectWebRtcTransport -> consume -> resumeConsumer), receives Opus audio from an active channel. Audio plays in the browser.
result: issue
reported: "Blocked by Test 6 -- no channel reaches streaming state, so no router/producer exists to consume from."
severity: blocker

### 8. Multiple listeners on same channel
expected: Two or more browser tabs/phones connected to the same channel all receive audio simultaneously. The server does NOT re-encode per listener (SFU forwarding).
result: issue
reported: "Blocked by Test 6 -- no channel reaches streaming state."
severity: blocker

### 9. Channel switching
expected: A connected listener can send a switchChannel request to move to a different active channel. Audio from the new channel starts playing. If the target channel is unavailable, the listener falls back to the previous channel (or receives a list of active channels).
result: issue
reported: "Blocked by Test 6 -- no channel reaches streaming state."
severity: blocker

### 10. Rate limiting on listener connections
expected: Rapidly opening more than 5 connections from the same IP within 10 seconds causes new connections to be rejected. Normal reconnection after the window passes works fine.
result: pass

### 11. Graceful shutdown stops streaming before audio
expected: When the app shuts down (Ctrl+C or close), the log shows streaming subsystem stopping first (listeners notified, transports closed, workers closed), then audio subsystem stopping. No crash or unhandled error on exit.
result: pass

### 12. Latency estimation in admin API
expected: Sending `{"type":"streaming:channel-latency","channelId":"<id>"}` on the admin WebSocket returns a latency breakdown (gstreamerBuffer, opusEncode, mediasoupForward, webrtcJitterBuffer, network, total) with reasonable values (~72ms for live mode, ~112ms for stable mode with 20ms frame size).
result: issue
reported: "Blocked by Test 6 -- channel not streaming, latency estimation requires active streaming channel with router."
severity: blocker

### 13. Default channel auto-connect
expected: When a listener connects for the first time (no prior channel selection), the server pushes a `defaultChannelId` notification so the client knows which channel to auto-connect to.
result: pass

### 14. Admin listener display modes
expected: Sending `{"type":"streaming:listeners","displayMode":"flagged"}` on the admin WebSocket returns only listeners with packet loss > 0 or jitter > 50ms. Sending with `"all"` returns all listeners.
result: issue
reported: "Blocked by Test 6 -- no listeners connected to streaming channels, so no meaningful listener data to filter."
severity: blocker

## Summary

total: 14
passed: 7
issues: 7
pending: 0
skipped: 0

## Gaps

- truth: "Channel transitions to streaming state when GStreamer pipeline produces level data"
  status: failed
  reason: "User reported: Channel stuck at 'starting' forever. Level parser on stderr, data on stdout (-m flag). Format mismatch: expects (double), gets (GValueArray)."
  severity: blocker
  test: 6
  root_cause: "metering-parser.ts createStderrLineParser attached to child.stderr (line 261) but gst-launch-1.0 -m outputs bus messages to stdout. Also PEAK_PATTERN expects peak=(double) but GStreamer 1.26 outputs peak=(GValueArray)< value >."
  artifacts:
    - path: "sidecar/src/audio/pipeline/gstreamer-process.ts"
      issue: "Line 261: child.stderr.on('data', parseChunk) -- should be child.stdout or parser should also process stdout"
    - path: "sidecar/src/audio/pipeline/metering-parser.ts"
      issue: "Lines 36-44: buildFieldPattern expects (double) format but GStreamer 1.26 outputs (GValueArray)< value > format"
  missing:
    - "Attach level parser to stdout instead of (or in addition to) stderr"
    - "Update PEAK_PATTERN, RMS_PATTERN, DECAY_PATTERN to match (GValueArray)< value > format"
    - "Verify pipeline state transitions to streaming after fix"
  debug_session: ""

- truth: "Listener receives Opus audio via WebRTC from active channel"
  status: failed
  reason: "Blocked by level parser bug -- no channel reaches streaming state, no router/producer created."
  severity: blocker
  test: 7
  root_cause: "Same as Test 6 -- level parser bug prevents channel streaming state"
  artifacts: []
  missing: []
  debug_session: ""

- truth: "Multiple listeners receive audio simultaneously via SFU"
  status: failed
  reason: "Blocked by level parser bug -- no streaming channels."
  severity: blocker
  test: 8
  root_cause: "Same as Test 6"
  artifacts: []
  missing: []
  debug_session: ""

- truth: "Listener can switch channels with fallback"
  status: failed
  reason: "Blocked by level parser bug -- no streaming channels."
  severity: blocker
  test: 9
  root_cause: "Same as Test 6"
  artifacts: []
  missing: []
  debug_session: ""

- truth: "Admin can query latency breakdown for streaming channel"
  status: failed
  reason: "Blocked by level parser bug -- latency estimation requires active streaming channel."
  severity: blocker
  test: 12
  root_cause: "Same as Test 6"
  artifacts: []
  missing: []
  debug_session: ""

- truth: "Admin can filter listeners by display mode (all/flagged)"
  status: failed
  reason: "Blocked by level parser bug -- no listeners connected to streaming channels."
  severity: blocker
  test: 14
  root_cause: "Same as Test 6"
  artifacts: []
  missing: []
  debug_session: ""

- truth: "mediasoup-worker.exe bundled in pkg-compiled sidecar binary"
  status: failed
  reason: "Fatal startup error: spawn C:\\snapshot\\sidecar\\node_modules\\mediasoup\\worker\\out\\Release\\mediasoup-worker ENOENT -- pkg does not bundle native mediasoup worker binary"
  severity: major
  test: 3
  root_cause: "pkg virtual filesystem (C:\\snapshot\\) cannot include native executables. mediasoup-worker.exe exists in node_modules but is not bundled into the compiled sidecar binary."
  artifacts:
    - path: "sidecar/node_modules/mediasoup/worker/out/Release/mediasoup-worker.exe"
      issue: "Native binary not included in pkg output"
  missing:
    - "Configure pkg assets to include mediasoup-worker.exe alongside compiled binary"
    - "Or set MEDIASOUP_WORKER_BIN env var to external path"
  debug_session: ""
