---
phase: 04-webrtc-streaming-core
plan: 02
subsystem: streaming
tags: [mediasoup, protoo, webrtc, types, config, opus, rtp]
depends_on:
  requires: [03-01, 03-02]
  provides: [streaming-types, mediasoup-config-schema, protoo-types]
  affects: [04-03, 04-04, 04-05, 04-06]
tech-stack:
  added: [mediasoup@3.19.17, protoo-server@4.0.7]
  patterns: [type-driven-design, config-schema-extension, ambient-declarations]
key-files:
  created:
    - sidecar/src/streaming/streaming-types.ts
    - sidecar/src/streaming/protoo-types.d.ts
  modified:
    - sidecar/package.json
    - sidecar/package-lock.json
    - sidecar/src/config/schema.ts
key-decisions:
  - "OPUS_PAYLOAD_TYPE=101 as shared const (matches rtpopuspay pt=101 in pipeline-builder)"
  - "preferredPayloadType set on OPUS_RTP_CODEC (mediasoup type requires it)"
  - "protoo-server ambient declarations (.d.ts) since library ships no types"
  - "Re-export protoo types from streaming-types for single import point"
  - "buildOpusRtpParameters() helper to avoid repeating codec construction"
duration: 6 minutes
completed: 2026-02-08
---

# Phase 4 Plan 02: Dependencies, Config Schema, and Streaming Types Summary

**One-liner:** mediasoup 3.19.17 + protoo-server 4.0.7 installed, config schema extended with mediasoup/streaming/per-channel fields, comprehensive streaming type definitions with protoo ambient declarations.

## Performance

| Metric | Value |
|--------|-------|
| Duration | 6 minutes |
| Started | 2026-02-08T10:26:50Z |
| Completed | 2026-02-08T10:32:46Z |
| Tasks | 3/3 |
| Files modified | 5 |

## Accomplishments

1. **Installed mediasoup and protoo-server** -- mediasoup 3.19.17 with compiled C++ worker binary (node-gyp), protoo-server 4.0.7 for WebSocket signaling protocol. Both verified loading cleanly.

2. **Extended config schema** -- Added `MediasoupSchema` (workerCount, rtcMinPort, rtcMaxPort, logLevel), `StreamingSchema` (heartbeatIntervalMs, rateLimitPerIp, rateLimitWindowMs, shutdownDrainMs), and per-channel fields (latencyMode, lossRecovery, defaultChannel). All backward-compatible with factory defaults.

3. **Created streaming type definitions** -- 12 type exports covering the full streaming domain: worker state, channel streaming state, listener peer data, admin DTOs, latency estimation, and RTP codec constants. Also created ambient type declarations for protoo-server (WebSocketServer, Room, Peer, Transport).

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Install mediasoup and protoo-server | a29d019 | package.json, package-lock.json |
| 2 | Extend config schema | 6195f10 | src/config/schema.ts |
| 3 | Create streaming type definitions | 3108b22 | src/streaming/streaming-types.ts, src/streaming/protoo-types.d.ts |

## Files Created

| File | Purpose |
|------|---------|
| `sidecar/src/streaming/streaming-types.ts` | All streaming domain types, RTP codec constants, buildOpusRtpParameters helper |
| `sidecar/src/streaming/protoo-types.d.ts` | Ambient type declarations for protoo-server v4.x |

## Files Modified

| File | Changes |
|------|---------|
| `sidecar/package.json` | Added mediasoup@^3.19.17 and protoo-server@^4.0.7 dependencies |
| `sidecar/package-lock.json` | Lock file updated (29 new packages) |
| `sidecar/src/config/schema.ts` | Added MediasoupSchema, StreamingSchema, per-channel latencyMode/lossRecovery/defaultChannel |

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| OPUS_PAYLOAD_TYPE=101 as shared const | Must match `rtpopuspay pt=101` in pipeline-builder.ts; single source of truth prevents mismatch |
| preferredPayloadType set on OPUS_RTP_CODEC | mediasoup TypeScript type requires it; set to 101 for consistency |
| Ambient .d.ts for protoo-server | Library ships no TypeScript types; minimal declarations covering used API surface |
| Re-export protoo types from streaming-types.ts | Single import point for streaming modules; avoids scattered protoo-server imports |
| buildOpusRtpParameters(ssrc) helper | Encapsulates Opus RTP parameter construction; avoids repeating codec object in multiple call sites |

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- **04-03 (Worker Manager):** All types ready -- WorkerState, OPUS_RTP_CODEC, MediasoupSchema config
- **04-04 (Router/PlainTransport):** ChannelStreamingState, buildOpusRtpParameters, OPUS_PAYLOAD_TYPE ready
- **04-05 (Signaling):** ListenerPeerData, protoo types, StreamingSchema config ready
- **04-06 (Streaming Subsystem):** All types provide the foundation for wiring components together

## Self-Check: PASSED
