---
phase: 02-audio-capture-pipeline
plan: 09
subsystem: audio-integration
tags: [websocket, audio-subsystem, facade, integration, sidecar-lifecycle]
requires: ["02-01", "02-02", "02-03", "02-04", "02-05", "02-06", "02-07", "02-08"]
provides:
  - "WebSocket API for audio source discovery and channel management"
  - "Real-time level data streaming to admin clients"
  - "Audio subsystem lifecycle integrated into sidecar startup/shutdown"
  - "End-to-end audio pipeline accessible via WebSocket"
affects: ["03-audio-processing", "06-admin-ui"]
tech-stack:
  added: []
  patterns:
    - "Facade pattern (AudioSubsystem wraps all audio components)"
    - "Event-driven broadcasting (throttled level data, real-time channel events)"
    - "SRP message routing (audio handler extracted from main WS switch)"
key-files:
  created:
    - sidecar/src/audio/audio-subsystem.ts
  modified:
    - sidecar/src/ws/handler.ts
    - sidecar/src/ws/types.ts
    - sidecar/src/server.ts
    - sidecar/src/index.ts
key-decisions:
  - "100ms level broadcast throttle interval (balances real-time feel with bandwidth)"
  - "Audio message handler extracted as separate function (SRP: main switch routes, audio handler processes)"
  - "AudioSubsystem persists across server restarts (created once, passed to new createServer calls)"
  - "Audio subsystem starts after server is ready (WebSocket must be listening before level broadcasts)"
  - "Graceful shutdown stops audio subsystem before closing servers (drain pipelines first)"
duration: 5 minutes
completed: 2026-02-07
---

# Phase 2 Plan 9: Audio Subsystem Integration Summary

**AudioSubsystem facade + WebSocket API + sidecar lifecycle wiring -- admin can discover sources, manage channels, and receive real-time level data via WebSocket.**

## Performance

- Duration: ~5 minutes
- TypeScript: clean compilation, zero errors
- No regressions in existing Phase 1 functionality

## Accomplishments

1. **AudioSubsystem facade** (created in prior commit 0c3c99c, part of this plan): Top-level entry point wiring SourceRegistry, PipelineManager, DiscoveryManager, LevelMonitor, ResourceMonitor, EventLogger, and ChannelManager. Event forwarding from all internal components to single-point subscription.

2. **WebSocket types extended**: 12 new payload interfaces (SourcesListPayload, ChannelListPayload, ChannelCreatePayload, ChannelUpdatePayload, ChannelSourceAddPayload, ChannelSourceRemovePayload, ChannelSourceUpdatePayload, ChannelActionPayload, LevelsPayload, StatsPayload, ChannelEventsPayload, SourcesChangedPayload). ServerMessageType union extended with 10 new audio message types.

3. **WebSocket handler extended**: Audio message router (handleAudioMessage) handles 13 message types: sources:list, channels:list, channel:create, channel:update, channel:remove, channel:source:add, channel:source:remove, channel:source:update, channel:start, channel:stop, channel:events, stats:get. All require admin role.

4. **Level data broadcasting**: Buffered at 100ms intervals, flushed as batch to all admin clients. Only sends when buffer has data. Timer cleaned up when WebSocket server closes.

5. **Event broadcasting**: Source changes, channel CRUD, channel state changes, and resource stats broadcast to admin clients in real-time via dedicated wireAudioBroadcasts function.

6. **Sidecar lifecycle integration**: AudioSubsystem created in main(), passed through createServer to setupWebSocket. Starts after server is ready. Stops before servers on graceful shutdown. Persists across server restarts.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create AudioSubsystem facade and extend WebSocket types | 0c3c99c | audio-subsystem.ts, ws/types.ts |
| 2 | Extend WebSocket handler and integrate into sidecar entry point | eb5b321 | ws/handler.ts, server.ts, index.ts |

## Files Created

- `sidecar/src/audio/audio-subsystem.ts` -- AudioSubsystem facade (238 lines)

## Files Modified

- `sidecar/src/ws/types.ts` -- Added 12 payload interfaces + 10 ServerMessageType entries
- `sidecar/src/ws/handler.ts` -- Added audio message routing, level broadcasting, event broadcasting (~350 lines added)
- `sidecar/src/server.ts` -- createServer accepts optional AudioSubsystem, passes to setupWebSocket
- `sidecar/src/index.ts` -- Creates AudioSubsystem, passes through lifecycle, starts/stops

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| 100ms level broadcast throttle | Matches configurable level metering default (100ms interval). Fast enough for responsive VU meters, avoids flooding WebSocket with per-pipeline per-frame updates |
| Audio handler extracted as separate function | SRP: main message switch stays clean, audio logic contained. Prefixes (sources:, channel:, channels:, levels:, stats:) routed before the switch |
| AudioSubsystem persists across server restarts | Audio pipelines should not stop when server config changes. Only the WebSocket/HTTP layer restarts; audio continues uninterrupted |
| Async error wrapping for audio handlers | All audio handlers wrapped in try/catch with uniform error response. Prevents unhandled rejections from async operations |

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

Phase 2 is now complete (9/9 plans). All audio capture pipeline components are built:
- Source types and pipeline types (02-01)
- GStreamer pipeline builders (02-02)
- GStreamer process wrapper and pipeline manager (02-03)
- SAP/SDP parser for AES67 discovery (02-04)
- Device enumerator for local audio (02-05)
- Source registry and discovery manager (02-06)
- Level monitor, resource monitor, and event logger (02-07)
- Channel manager with full lifecycle (02-08)
- AudioSubsystem facade + WebSocket API + sidecar integration (02-09)

**Ready for Phase 3** (Audio Processing): The WebSocket API provides the control plane. Phase 3 adds audio processing (normalization, AGC, Speech/Music mode) and multi-source mixing within channels.

## Self-Check: PASSED
