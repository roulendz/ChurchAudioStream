---
status: diagnosed
phase: 04-webrtc-streaming-core
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md, 04-06-SUMMARY.md, 04-07-SUMMARY.md]
started: 2026-02-09T21:00:00Z
updated: 2026-02-09T23:50:00Z
---

## Current Test

[testing complete]

## Tests

### 1. WS and WSS connectivity test script
expected: Run `node test-ws.cjs` in the sidecar directory (with sidecar running separately). Both WS and WSS suites pass all 12 tests each. The listener path test shows path routing is active. Summary shows 0 failures.
result: issue
reported: "WS loopback 12/12 pass. WSS connects + welcome OK, but identify:ack times out (8s). Protoo path routing works (2/2). Total 15/16. WSS admin broken -- protoo WebSocket-Node on HTTPS server interferes with admin ws upgrade."
severity: major

### 2. Channel reaches streaming state with level data
expected: A channel configured with an audio source starts its GStreamer pipeline and transitions to "streaming" state when level data flows. Admin WS `streaming:status` shows the channel as active with listenerCount=0 and a latency estimate.
result: pass

### 3. Latency estimation for active channel
expected: Sending `streaming:channel-latency` with a streaming channel's ID returns a latency breakdown with gstreamerBufferMs, opusEncodeMs, mediasoupForwardMs, webrtcJitterBufferMs, networkMs, and totalMs. Live mode total is ~72ms, stable mode ~112ms with 20ms frame.
result: pass
verified: "totalMs: 72, gstreamerBufferMs: 30, opusEncodeMs: 20, mediasoupForwardMs: 1, webrtcJitterBufferMs: 20, networkMs: 1"

### 4. Streaming workers info
expected: `streaming:workers` returns an array of worker objects with index, peakMemoryKb, routerCount, and alive=true. At least one worker exists.
result: pass
verified: "1 worker, index: 0, alive: true, peakMemoryKb: 18656, routerCount: 0"

### 5. Admin listener display modes
expected: `streaming:listeners` with displayMode "all" returns sessions and stats arrays. With displayMode "off" returns empty arrays. Both respond without error.
result: pass
verified: "displayMode 'all' returns sessions: [], stats: [], displayMode: 'all' -- no errors, correct structure"

### 6. Graceful shutdown order
expected: Pressing Ctrl+C shows streaming subsystem stopping before audio subsystem in the logs. No crashes or unhandled promise rejections on exit.
result: issue
reported: "Shutdown order is correct (streaming->audio->servers) but needs 3x Ctrl+C. First SIGINT triggers pipeline crash (mediasoup transport closed) which schedules pipeline restart during shutdown. New GStreamer process spawns 2s later. Must press Ctrl+C again to kill it."
severity: major

## Summary

total: 6
passed: 4
issues: 2
pending: 0
skipped: 0

## Gaps

- truth: "Admin WSS connections (wss://<LAN_IP>:port) work for full message exchange (identify, config:get, etc.)"
  status: failed
  reason: "User reported: WSS connects + welcome OK, but identify:ack times out. WS loopback works perfectly (12/12). Protoo WebSocket-Node on HTTPS server interferes with admin ws upgrade handling."
  severity: major
  test: 1
  root_cause: "Two WebSocket libraries (ws and WebSocket-Node via protoo-server) both register upgrade handlers on httpsServer. WebSocket-Node unconditionally consumes ALL upgrade requests with no path filtering, corrupting admin ws connections."
  artifacts:
    - path: "sidecar/src/ws/handler.ts"
      issue: "Registers upgrade handler on httpsServer but WebSocket-Node also fires on same event"
    - path: "sidecar/src/ws/listener-handler.ts"
      issue: "Creates protooServer.WebSocketServer(httpsServer) registering competing upgrade handler"
    - path: "sidecar/node_modules/websocket/lib/WebSocketServer.js"
      issue: "WebSocket-Node unconditionally consumes ALL upgrade requests with no path filtering"
  missing:
    - "Single upgrade dispatcher that routes by path: /ws/listener -> protoo, else -> admin ws"
    - "Remove httpsServer from protoo WebSocketServer constructor; manually forward /ws/listener upgrades"
  debug_session: ".planning/debug/wss-admin-upgrade.md"

- truth: "First Ctrl+C shuts down sidecar cleanly without needing multiple SIGINT signals"
  status: failed
  reason: "User reported: Needs 3x Ctrl+C. First SIGINT causes pipeline crash (mediasoup transport closed), pipeline restart scheduler fires during shutdown spawning new GStreamer process 2s later."
  severity: major
  test: 6
  root_cause: "PipelineManager lacks isShuttingDown flag; 5s streaming drain window (shutdownDrainMs=5000) allows crash-triggered restarts to spawn new GStreamer processes before audioSubsystem.stop() begins."
  artifacts:
    - path: "sidecar/src/audio/pipeline/pipeline-manager.ts"
      issue: "No isShuttingDown guard in handleCrashedPipeline() or scheduleRestart()"
    - path: "sidecar/src/index.ts"
      issue: "setupGracefulShutdown() does not signal PipelineManager before streamingSubsystem.stop()"
    - path: "sidecar/src/audio/pipeline/gstreamer-process.ts"
      issue: "stopRequested is per-instance, only set by explicit stop() -- no global shutdown awareness"
    - path: "sidecar/src/streaming/streaming-subsystem.ts"
      issue: "stop() never removes event listeners from audioSubsystem"
  missing:
    - "PipelineManager needs shutdown() method: set isShuttingDown flag, clear restart timers, bail out of handleCrashedPipeline()"
    - "setupGracefulShutdown() must call pipelineManager.shutdown() BEFORE streamingSubsystem.stop()"
    - "AudioSubsystem needs prepareShutdown() to pass signal to PipelineManager"
    - "StreamingSubsystem.stop() should remove event listeners from audioSubsystem"
  debug_session: ".planning/debug/graceful-shutdown.md"
