---
phase: 04-webrtc-streaming-core
plan: 08
subsystem: websocket
tags: [websocket, protoo, upgrade-dispatcher, admin-wss, bug-fix, gap-closure]

requires:
  - phase: 04-webrtc-streaming-core
    provides: "Phase 4 streaming infrastructure (plans 01-06)"
provides:
  - "Single upgrade dispatcher pattern preventing protoo/admin WS conflict"
  - "Isolated protoo WebSocket-Node via dummy HTTP server"
  - "Admin WSS connections on port 7777 complete full message exchange"
affects: [05-listener-web-ui, 06-admin-dashboard]

tech-stack:
  added: []
  patterns: ["dummy HTTP server for WebSocket-Node isolation", "closure-based deferred handler wiring"]

key-files:
  created: []
  modified:
    - sidecar/src/ws/listener-handler.ts
    - sidecar/src/ws/handler.ts
    - sidecar/src/streaming/streaming-subsystem.ts
    - sidecar/src/index.ts

key-decisions:
  - "Dummy http.Server (never listened) isolates protoo's WebSocket-Node upgrade handler from httpsServer"
  - "handler.ts is the sole upgrade listener on each server; /ws/listener -> forwardUpgrade(), all else -> admin ws"
  - "setListenerHandler closure callback resolves chicken-and-egg timing (server created before streaming subsystem)"
  - "HTTP loopback server does NOT get listener handler (protoo only serves on HTTPS for phone browsers)"

duration: 6m
completed: 2026-02-10
---

# Phase 4 Plan 08: WSS Admin Upgrade Interference Fix Summary

**Single upgrade dispatcher pattern isolating protoo WebSocket-Node from admin ws on httpsServer, fixing WSS admin connection corruption where identify:ack timed out**

## Performance
- **Duration:** 6 minutes
- **Started:** 2026-02-09T22:05:03Z
- **Completed:** 2026-02-09T22:11:20Z
- **Tasks:** 2/2
- **Files modified:** 4

## Accomplishments
- Replaced direct `httpsServer` attachment of protoo's `WebSocketServer` with a private dummy `http.Server` that is never listened on any port, serving only as an EventEmitter target for WebSocket-Node's upgrade handler
- Added public `forwardUpgrade(request, socket, head)` method to `ListenerWebSocketHandler` that manually emits the upgrade event on the dummy server when the dispatcher routes a /ws/listener path
- Made `handler.ts` the single upgrade dispatcher on each HTTP(S) server: listener paths forward to protoo via `forwardUpgrade()`, all other paths handled by admin ws `handleUpgrade()`
- Added `setListenerHandler` closure-based callback to `WebSocketSetupResult` to solve the chicken-and-egg timing issue (server is created before streaming subsystem starts)
- Updated `StreamingSubsystem.start()` to accept `setListenerHandler` callback, wiring the listener handler into the HTTPS server's upgrade dispatcher after construction
- Updated all three call sites in `index.ts` (main startup, restart, fallback restart) to pass `setListenerHandler`
- Admin WSS connections on `wss://<LAN_IP>:7777` now complete the full handshake without WebSocket-Node interference, allowing identify:ack and all subsequent message types to work

## Task Commits
1. **Task 1: Isolate protoo WebSocketServer with dummy server and upgrade forwarding** - `9275bce` (fix)
2. **Task 2: Wire single upgrade dispatcher in handler.ts and update call sites** - `247b26a` (fix)

## Files Created/Modified
- `sidecar/src/ws/listener-handler.ts` - Replaced httpsServer constructor parameter with private dummy http.Server; added forwardUpgrade() public method; updated module doc; null out dummy server in close()
- `sidecar/src/ws/handler.ts` - Added ListenerWebSocketHandler import; added setListenerHandler to WebSocketSetupResult; closure-based listenerHandler variable in upgrade handler; forward /ws/listener upgrades via forwardUpgrade()
- `sidecar/src/streaming/streaming-subsystem.ts` - Updated start() to accept setListenerHandler callback; removed httpsServer from ListenerWebSocketHandler constructor call; wire handler after creation
- `sidecar/src/index.ts` - Pass setListenerHandler callback in main(), restart, and fallback restart paths

## Decisions Made
1. **Dummy HTTP server isolation** - protoo's WebSocket-Node requires an httpServer constructor argument but will consume ALL upgrade events on it. Creating a private dummy server that never listens isolates its upgrade handler completely.
2. **Closure-based deferred wiring** - The `setListenerHandler` callback uses a closure variable that the upgrade handler reads. This avoids needing to re-register the upgrade handler when the listener handler is created later.
3. **HTTP loopback excluded** - The loopback HTTP server on port 7778 does NOT receive a listener handler because protoo should only serve on HTTPS (phone browsers connect via wss://).

## Deviations from Plan
### Auto-fixed Issues

**1. [Rule 3 - Blocking] Streaming subsystem and index.ts changes already committed in 04-09**
- **Found during:** Task 2
- **Issue:** A prior gap closure agent (04-09) already committed the streaming-subsystem.ts and index.ts call-site changes as part of fd78e53, which included both prepareShutdown wiring AND the setListenerHandler changes
- **Fix:** Committed only the remaining handler.ts changes in Task 2 commit; verified all files are consistent
- **Files affected:** sidecar/src/streaming/streaming-subsystem.ts, sidecar/src/index.ts

## Issues Encountered
- The 04-09 gap closure plan pre-applied some 04-08 call-site changes (streaming-subsystem.ts constructor and index.ts start() calls). This was discovered when git staging showed no changes to those files. Verified via `git show` that fd78e53 already contained the setListenerHandler wiring. The core fix (listener-handler.ts dummy server + handler.ts dispatcher) was not yet applied and was committed in this plan.

## Next Phase Readiness
- Admin WSS connections now work correctly alongside protoo listener connections on the same HTTPS server
- No blockers for Phase 5 (Listener Web UI) which needs both admin dashboard WS and listener protoo WS
- The single upgrade dispatcher pattern is extensible if additional WS paths are needed in future phases

## Self-Check: PASSED
