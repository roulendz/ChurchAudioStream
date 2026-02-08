---
phase: 04-webrtc-streaming-core
plan: 05
subsystem: streaming
tags: [streaming-subsystem, facade, lifecycle, graceful-shutdown, admin-api, event-wiring]
depends_on:
  requires: [04-01, 04-04]
  provides: [streaming-subsystem, streaming-admin-api, lifecycle-integration]
  affects: [04-06]
tech-stack:
  added: []
  patterns: [subsystem-facade, event-driven-sync, graceful-shutdown-sequence, path-based-ws-routing]
key-files:
  created:
    - sidecar/src/streaming/streaming-subsystem.ts
  modified:
    - sidecar/src/ws/handler.ts
    - sidecar/src/server.ts
    - sidecar/src/index.ts
key-decisions:
  - "Admin WS uses noServer mode with manual upgrade routing to coexist with protoo WebSocket-Node"
  - "StreamingSubsystem created before createServer so admin WS can wire streaming event broadcasts"
  - "Streaming started after server is ready but before audio (audio events need streaming listeners)"
  - "streaming:restart-workers deferred to Phase 8 (worker rotation adds complexity)"
  - "Listener count events emit on both connect and disconnect for real-time admin dashboard updates"
  - "MetadataResolver callback pattern reused from RouterManager (avoids circular dependency)"
duration: 10 minutes
completed: 2026-02-08
---

# Phase 4 Plan 05: Streaming Subsystem Integration Summary

**One-liner:** StreamingSubsystem facade wiring all mediasoup components with AudioSubsystem event-driven sync, path-based WS upgrade routing for protoo coexistence, graceful shutdown (notify -> drain -> close mediasoup -> close GStreamer), and 4 streaming admin API messages.

## Performance

| Metric | Value |
|--------|-------|
| Duration | 10 minutes |
| Started | 2026-02-08T10:54:34Z |
| Completed | 2026-02-08T11:04:06Z |
| Tasks | 4/4 |
| Files created | 1 |
| Files modified | 3 |

## Accomplishments

1. **StreamingSubsystem facade** -- Single entry point for all streaming functionality (pattern matches AudioSubsystem). Wires WorkerManager, PlainTransportManager, RouterManager, TransportManager, SignalingHandler, and ListenerWebSocketHandler. `start(httpsServer)` creates all components and wires event listeners. `stop()` implements graceful shutdown: notify listeners -> drain 5s -> close WS handler -> close WebRTC transports -> close routers -> close workers. Delegated admin accessors: `getListenerCount`, `getListenerSessions`, `getWorkerResourceInfo`, `getActiveStreamingChannels`. Emits `listener-count-changed` and `worker-alert` events for admin dashboard.

2. **AudioSubsystem event-driven sync** -- StreamingSubsystem subscribes to `channel-state-changed` (creates/removes Router+PlainTransport on streaming/stopped/error/crashed), `channel-removed` (notify listeners, remove router), and `channel-created` (push updated channel list to all listeners per locked decision). WorkerManager `worker-died` and `worker-memory-warning` events forwarded as admin alerts.

3. **Server lifecycle integration** -- Admin WebSocketServer changed to `noServer: true` with manual upgrade routing. HTTP upgrade requests to `/ws/listener` are skipped (reserved for protoo's WebSocket-Node). All other upgrade requests routed to admin WS via `handleUpgrade`. StreamingSubsystem created in `main()` after AudioSubsystem, started after server, stopped before audio on shutdown. Server restart: stop streaming -> stop server -> recreate server -> restart streaming.

4. **Streaming admin WebSocket API** -- Four message types added: `streaming:status` (listener counts per channel + worker info + active channels), `streaming:workers` (WorkerResourceInfo[]), `streaming:listeners` (ListenerSessionInfo[]), `streaming:restart-workers` (deferred to Phase 8). Event broadcasts: `streaming:listener-count` on connect/disconnect, `streaming:worker-alert` on worker death/memory warning.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create StreamingSubsystem facade | 5230677 | src/streaming/streaming-subsystem.ts |
| 2 | Integrate into server.ts and index.ts lifecycle | 5103faa | src/index.ts, src/ws/handler.ts |
| 3 | Add streaming admin WebSocket API messages | 7361c47 | src/ws/handler.ts, src/server.ts, src/index.ts |
| 4 | Verify AudioSubsystem event compatibility | -- | (verification only, no code changes) |

## Files Created

| File | Purpose |
|------|---------|
| `sidecar/src/streaming/streaming-subsystem.ts` | Streaming subsystem facade wiring all components with AudioSubsystem sync and graceful shutdown |

## Files Modified

| File | Changes |
|------|---------|
| `sidecar/src/ws/handler.ts` | noServer mode, upgrade routing, streaming message handler, streaming event broadcasts |
| `sidecar/src/server.ts` | Pass StreamingSubsystem through createServer to setupWebSocket |
| `sidecar/src/index.ts` | Create StreamingSubsystem, wire lifecycle, update shutdown order |

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Admin WS `noServer: true` with manual upgrade routing | protoo uses WebSocket-Node (separate library from ws). Both hook HTTP `upgrade` event. `noServer` mode prevents admin WS from grabbing listener connections. Path-based routing sends `/ws/listener` to protoo, everything else to admin. |
| StreamingSubsystem created before createServer | The admin WS needs a reference to StreamingSubsystem for streaming message handling and event broadcasts. Creating it early (but not started) allows passing through the createServer chain. |
| Streaming started after server, before audio | Streaming needs httpsServer for protoo WebSocket. Audio emits channel events that streaming subscribes to. Starting streaming first ensures events are not missed when audio auto-starts channels. |
| streaming:restart-workers deferred to Phase 8 | Worker restart is available on WorkerManager but exposing it through admin API requires coordinating router recreation and listener reconnection. Phase 8 (reliability/self-healing) handles this properly. |
| MetadataResolver callback pattern for channel info | Avoids StreamingSubsystem importing ChannelManager directly. Uses AudioSubsystem.getChannel() through a closure, keeping the dependency graph clean. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] streaming:restart-workers returns error instead of executing**

- **Found during:** Task 3
- **Issue:** Plan specified `streaming:restart-workers` should trigger worker restart. However, WorkerManager.restartAllWorkers() closes all workers and routers, which would require RouterManager to recreate all channel routers after. This coordination is complex and properly belongs in Phase 8.
- **Fix:** Return an informative error message ("available in Phase 8") instead of incomplete implementation
- **Files modified:** sidecar/src/ws/handler.ts
- **Commit:** 7361c47

**2. [Rule 3 - Blocking] server.ts needed StreamingSubsystem parameter pass-through**

- **Found during:** Task 3
- **Issue:** createServer needed to forward StreamingSubsystem to setupWebSocket for admin streaming message handling. Plan only listed server.ts changes in Task 2, but the actual parameter pass-through was needed for Task 3.
- **Fix:** Added streamingSubsystem parameter to createServer and setupWebSocket
- **Files modified:** sidecar/src/server.ts, sidecar/src/index.ts
- **Commit:** 7361c47

## Issues Encountered

None.

## Next Phase Readiness

- **04-06 (Integration testing):** All streaming components are wired. End-to-end flow: AudioSubsystem emits channel-state-changed -> StreamingSubsystem creates Router+PlainTransport -> Listener connects via protoo -> SignalingHandler creates consumer -> Audio flows. Admin can query streaming status via existing WebSocket API.
- **Phase 8 (Reliability):** streaming:restart-workers API endpoint is stubbed and ready to implement once worker rotation logic is added.

## Self-Check: PASSED
