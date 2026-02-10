---
status: diagnosed
trigger: "Listener UI shows Reconnecting banner + empty channel list instead of OfflineScreen when server goes down"
created: 2026-02-10T00:00:00Z
updated: 2026-02-10T00:01:00Z
---

## Current Focus

hypothesis: CONFIRMED - Two independent root causes found
test: Code trace of protoo-client reconnection flow + OfflineScreen trigger
expecting: n/a
next_action: Return diagnosis

## Symptoms

expected: After server shutdown and reconnection failure, show OfflineScreen overlay (z-index 500, WiFi icon, "Connect to church WiFi", Try Again button)
actual: Shows "Reconnecting..." banner + empty channel list with "Please be patient while we connect translators"
errors: Also ERR_UNHANDLED_ERROR from GStreamerProcess.emit during EOS on sidecar shutdown
reproduction: Stop sidecar with Ctrl+C, observe listener UI
started: Likely always been this way - design gap

## Eliminated

## Evidence

- timestamp: 2026-02-10T00:00:10Z
  checked: OfflineScreen component (listener/src/components/OfflineScreen.tsx)
  found: OfflineScreen uses ONLY `navigator.onLine` + window "online"/"offline" events to decide visibility. Returns null when `navigator.onLine` is true.
  implication: OfflineScreen only detects OS-level network loss (WiFi off, airplane mode), NOT server-level unreachability

- timestamp: 2026-02-10T00:00:20Z
  checked: protoo-client WebSocketTransport (node_modules/protoo-client/lib/transports/WebSocketTransport.js)
  found: When WS was previously connected (wasConnected=true) and closes, transport emits "disconnected" and calls _runWebSocket() recursively to start NEW retry loop (10 attempts). This means after each disconnection, a FRESH 10-attempt retry cycle begins. It NEVER gives up permanently for a previously-connected peer.
  implication: connectionState will cycle between "reconnecting" and "reconnecting" (via failed events) forever. It never reaches "disconnected" state permanently.

- timestamp: 2026-02-10T00:00:30Z
  checked: useSignaling hook (listener/src/hooks/useSignaling.ts) lines 68-82
  found: peer "disconnected" -> sets "reconnecting". peer "failed" -> sets "reconnecting". peer "close" -> sets "disconnected". But "close" only fires when transport._closed is set true, which only happens on explicit peer.close() or server code 4000. During server-down reconnection loops, "close" is NEVER emitted.
  implication: connectionState is stuck at "reconnecting" permanently when server is unreachable but network is up

- timestamp: 2026-02-10T00:00:40Z
  checked: App.tsx rendering logic lines 97-126
  found: Three connection states handled: "connecting" (shows spinner+OfflineScreen), "disconnected" (shows OfflineScreen+message), "reconnecting" (shows banner over channel list). The "reconnecting" state shows the banner + normal app content (empty channel list with "Please be patient" message).
  implication: Confirms the observed behavior matches the code: reconnecting = banner + empty list

- timestamp: 2026-02-10T00:00:50Z
  checked: protoo-client reconnection flow for previously-connected peers
  found: Flow is: disconnect -> emit "disconnected" -> _runWebSocket() -> retry 10 times (emitting "failed" each) -> if all 10 fail, the onclose handler falls through to set _closed=true and emit "close" -> BUT WAIT: re-reading the code at line 157-158: if wasConnected=false and retry returns false (exhausted), it falls through to line 173 (set _closed, emit close). If wasConnected=true (line 159-169), it ALWAYS calls _runWebSocket() recursively, NEVER falling through to the close emission. This creates an infinite retry loop.
  implication: CONFIRMED: protoo-client intentionally retries forever for previously-connected peers. The "close" event (which maps to connectionState="disconnected") is unreachable for server-down scenarios.

- timestamp: 2026-02-10T00:01:00Z
  checked: Secondary issue - GStreamerProcess ERR_UNHANDLED_ERROR
  found: In pipeline-manager.ts removePipeline() at line 107-108: `await pipeline.stop()` resolves on child "exit" event, then immediately calls `removeAllListeners()`. Node.js child_process "exit" can fire BEFORE all stdio streams are fully consumed. Queued stdout/stderr data callbacks may fire AFTER removeAllListeners() has removed the "error" handler. When stderr parser detects WARNING/CRITICAL pattern during EOS teardown, it calls `this.emit("error", ...)` with zero listeners -> ERR_UNHANDLED_ERROR.
  implication: Race condition between stdio flush and listener cleanup during shutdown

## Resolution

root_cause_primary: OfflineScreen only detects OS-level network loss (navigator.onLine), not server unreachability. protoo-client retries FOREVER for previously-connected peers (never emits "close"), so connectionState never reaches "disconnected". The app is stuck in "reconnecting" state permanently.
root_cause_secondary: pipeline-manager.removePipeline() calls removeAllListeners() after stop() resolves, but Node.js child "exit" fires before stdio is fully drained. Buffered stderr data arriving after listener removal causes ERR_UNHANDLED_ERROR.
fix:
verification:
files_changed: []
