---
phase: 04-webrtc-streaming-core
plan: 03
subsystem: streaming
tags: [mediasoup, worker, router, plain-transport, rtp, comedia, crash-recovery]
depends_on:
  requires: [04-02]
  provides: [worker-manager, router-manager, plain-transport-manager]
  affects: [04-04, 04-05, 04-06]
tech-stack:
  added: []
  patterns: [event-emitter-lifecycle, delegated-monitoring, crash-recovery, comedia-rtp-ingestion]
key-files:
  created:
    - sidecar/src/streaming/worker-manager.ts
    - sidecar/src/streaming/router-manager.ts
    - sidecar/src/streaming/plain-transport-manager.ts
  modified: []
key-decisions:
  - "Private WorkerMemoryMonitor helper class per SRP (Phase 8 rotation can extract without changing WorkerManager API)"
  - "Deterministic channel-to-worker mapping via hash modulo (not random assignment)"
  - "ChannelRouterEntry stores port/SSRC info for crash recovery recreation"
  - "ChannelMetadataResolver callback avoids RouterManager depending on ChannelManager"
  - "PlainTransportStats aligned to actual mediasoup BaseTransportStats fields (not hypothetical fields)"
duration: 5 minutes
completed: 2026-02-08
---

# Phase 4 Plan 03: mediasoup Server-Side Infrastructure Summary

**One-liner:** WorkerManager with delegated memory monitoring and crash auto-restart, per-channel RouterManager with worker-restart recovery, PlainTransportManager with comedia mode persisting across GStreamer restarts.

## Performance

| Metric | Value |
|--------|-------|
| Duration | 5 minutes |
| Started | 2026-02-08T10:36:28Z |
| Completed | 2026-02-08T10:41:46Z |
| Tasks | 3/3 |
| Files created | 3 |

## Accomplishments

1. **WorkerManager** -- Creates configurable pool of mediasoup C++ workers with crash auto-restart via `worker.on("died")`. Memory monitoring delegated to private `WorkerMemoryMonitor` helper (SRP) that checks every 60s and warns at 500MB threshold. Deterministic channel-to-worker mapping via hash modulo. Events emitted for dashboard integration.

2. **RouterManager** -- Per-channel Router creation with Opus codec capability. Coordinates WorkerManager (get worker) and PlainTransportManager (create transport/producer). Stores full `ChannelRouterEntry` with port/SSRC info enabling worker-restart recovery. `getActiveChannelList()` uses a metadata resolver callback to avoid depending on ChannelManager directly.

3. **PlainTransportManager** -- Creates PlainTransports with `rtcpMux: false` and `comedia: true` on each channel's dedicated UDP port pair. Producer SSRC matches `generateSsrc(channelId)` from port-allocator. Transports persist across GStreamer pipeline restarts per audit finding #3. Stats method returns actual mediasoup `BaseTransportStats` fields.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Implement WorkerManager | 2afb2eb | src/streaming/worker-manager.ts |
| 2 | Implement RouterManager | bc704af | src/streaming/router-manager.ts |
| 3 | Implement PlainTransportManager | a32d3e2 | src/streaming/plain-transport-manager.ts |

## Files Created

| File | Purpose |
|------|---------|
| `sidecar/src/streaming/worker-manager.ts` | mediasoup Worker lifecycle: create, monitor memory, crash recovery, restart all |
| `sidecar/src/streaming/router-manager.ts` | Per-channel Router + PlainTransport + Producer orchestration, worker restart recovery |
| `sidecar/src/streaming/plain-transport-manager.ts` | PlainTransport creation with comedia mode, Producer with matching SSRC, transport stats |

## Files Modified

None.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Private WorkerMemoryMonitor helper class | SRP: memory monitoring is a separate concern. Phase 8 worker rotation can extract to its own file without changing WorkerManager's public API |
| Deterministic channel-to-worker mapping (hash modulo) | Consistent assignment; same channel always goes to same worker. Simple and predictable for debugging |
| ChannelRouterEntry stores port/SSRC for recovery | Worker crash recovery needs to recreate router/transport/producer with same ports and SSRC so GStreamer can resume sending to same addresses |
| ChannelMetadataResolver callback pattern | RouterManager provides channel list to listeners but doesn't depend on ChannelManager. Dependency inversion keeps streaming layer decoupled from audio layer |
| PlainTransportStats aligned to actual mediasoup types | Initial draft had hypothetical fields (rtpPacketsReceived, jitter). Fixed to use actual BaseTransportStats fields (bytesReceived, rtpBytesReceived, recvBitrate, rtpPacketLossReceived) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed PlainTransportStats type mismatch**
- **Found during:** Task 3
- **Issue:** Initial implementation used `Record<string, unknown>` casting and referenced fields not present on mediasoup's `BaseTransportStats` type (`rtpPacketsReceived`, `rtpPacketsLost`, `jitter`)
- **Fix:** Aligned `PlainTransportStats` interface to actual `BaseTransportStats` fields (`bytesReceived`, `rtpBytesReceived`, `rtxBytesReceived`, `recvBitrate`, `rtpRecvBitrate`, `rtpPacketLossReceived`) and removed unsafe type casting
- **Files modified:** `sidecar/src/streaming/plain-transport-manager.ts`
- **Commit:** a32d3e2

## Issues Encountered

None.

## Next Phase Readiness

- **04-04 (WebRtcTransport Manager):** WorkerManager and RouterManager ready for creating listener WebRTC transports on channel routers
- **04-05 (Signaling Handler):** RouterManager provides `getActiveChannelList()`, `getRouterForChannel()`, `getProducerForChannel()` for protoo request handling
- **04-06 (Streaming Subsystem):** All three managers ready to be wired together in the facade class

## Self-Check: PASSED
