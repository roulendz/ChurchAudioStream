---
phase: 05-listener-web-ui
plan: 05
subsystem: streaming-and-listener-ui
tags: [gap-closure, offline-screen, channel-list, protoo, pipeline-teardown]
requires:
  - phase-04 (streaming subsystem, signaling handler, pipeline manager)
  - phase-05-01 (channel metadata, listener scaffold)
  - phase-05-02 (signaling client, channel list hook, offline screen)
  - phase-05-04 (offline screen component)
provides:
  - Stopped channels visible as offline cards in listener channel list
  - OfflineScreen shows on server disconnect (not just WiFi down)
  - 30s reconnection timeout stops protoo infinite retry loop
  - Safe pipeline teardown without ERR_UNHANDLED_ERROR
affects:
  - phase-06 (admin dashboard uses getActiveStreamingChannels which still returns active-only)
  - phase-08 (reliability features can build on reconnection timeout pattern)
tech-stack:
  added: []
  patterns:
    - channelListProvider callback for SignalingHandler decoupling
    - Wall-clock reconnection timeout over protoo infinite retry
    - Safety-net error handler for async stdio drain on process teardown
key-files:
  created: []
  modified:
    - sidecar/src/streaming/streaming-subsystem.ts
    - sidecar/src/streaming/signaling-handler.ts
    - sidecar/src/audio/pipeline/pipeline-manager.ts
    - listener/src/hooks/useSignaling.ts
    - listener/src/components/OfflineScreen.tsx
    - listener/src/App.tsx
key-decisions:
  - buildFullChannelList() lives in StreamingSubsystem (needs both AudioSubsystem and RouterManager)
  - channelListProvider as optional callback preserves SignalingHandler backward compatibility
  - 30s reconnect timeout chosen (15 protoo retry cycles at ~2s each)
  - OfflineScreen Try Again reloads page (necessary after protoo peer closes)
  - Safety-net uses setImmediate for stdio drain (not arbitrary setTimeout)
patterns-established:
  - Full channel list merging all configured channels with active router status
  - Application-level timeout wrapping library infinite-retry behavior
duration: 5 minutes
completed: 2026-02-10
---

# Phase 5 Plan 5: Gap Closure for UAT Tests 8 and 10 Summary

**One-liner:** Full channel list with offline cards, 30s reconnect timeout for OfflineScreen server-awareness, and safe pipeline teardown

## Performance

- Duration: 5 minutes
- Tasks: 2/2 completed
- TypeScript: Both sidecar and listener compile clean
- Build: Vite production build succeeds

## Accomplishments

1. **Stopped channels remain visible (UAT Test 8):** Added `buildFullChannelList()` to StreamingSubsystem that merges ALL configured channels from AudioSubsystem with active router status from RouterManager. Stopped channels now appear in the listener channel list with `hasActiveProducer: false` instead of vanishing when their router is removed.

2. **OfflineScreen shows on server disconnect (UAT Test 10):** Added a 30-second wall-clock reconnection timeout in `useSignaling` that transitions `connectionState` to "disconnected" after protoo exhausts its retry cycles. OfflineScreen now accepts a `connectionState` prop and shows its full-screen overlay when the server is unreachable (not just when WiFi is down).

3. **Safe pipeline teardown:** Added a safety-net error handler and `setImmediate` delay in `removePipeline()` to prevent `ERR_UNHANDLED_ERROR` from buffered stdio data arriving after `stop()` resolves but before listeners are removed.

## Task Commits

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Server-side full channel list | c591ab6 | buildFullChannelList(), channelListProvider, safe pipeline removal |
| 2 | Listener reconnection timeout + OfflineScreen | cafa23a | RECONNECT_TIMEOUT_MS, connectionState prop, page reload |

## Files Modified

| File | Changes |
|------|---------|
| sidecar/src/streaming/streaming-subsystem.ts | Added buildFullChannelList(), updated pushActiveChannelList(), pass channelListProvider to SignalingHandler |
| sidecar/src/streaming/signaling-handler.ts | Added channelListProvider callback, updated buildEnrichedChannelList(), removed filter in disconnectListenersFromChannel |
| sidecar/src/audio/pipeline/pipeline-manager.ts | Added safety-net error handler and setImmediate delay in removePipeline() |
| listener/src/hooks/useSignaling.ts | Added RECONNECT_TIMEOUT_MS, startReconnectTimeout/clearReconnectTimeout, peer.close on timeout |
| listener/src/components/OfflineScreen.tsx | Added connectionState prop, combined navigator.onLine with server reachability, reload on Try Again |
| listener/src/App.tsx | Pass connectionState to all 3 OfflineScreen instances |

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| buildFullChannelList() in StreamingSubsystem | Needs access to both AudioSubsystem (all channels) and RouterManager (active status) |
| channelListProvider as optional constructor param | Backward compatibility for SignalingHandler (defaults to RouterManager.getActiveChannelList) |
| 30s reconnect timeout | Covers ~15 protoo retry cycles at ~2s each; long enough to survive brief outages |
| Page reload on Try Again | Once protoo peer closes, only a fresh page load can create a new peer |
| setImmediate for stdio drain | Single event-loop tick sufficient for Node.js stdio buffer flush |
| Removed disconnectListenersFromChannel filter | Stopped channel should appear in remainingChannels as offline card |

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- **Phase 5 gap closure complete:** Both UAT Test 8 (stopped channels visible) and Test 10 (offline screen on server disconnect) gaps are addressed
- **Phase 5 can now be re-verified:** Run the full UAT suite to confirm 12/12 pass
- **No blockers for Phase 6:** Admin dashboard can proceed; `getActiveStreamingChannels()` still returns active-only for admin use cases (correct behavior)

## Self-Check: PASSED
