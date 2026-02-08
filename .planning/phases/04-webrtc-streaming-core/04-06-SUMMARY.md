---
phase: 04-webrtc-streaming-core
plan: 06
subsystem: streaming
tags: [latency-estimator, channel-switching, nack-plc, admin-metrics, latency-monitoring, ws-api]
depends_on:
  requires: [04-01, 04-04, 04-05]
  provides: [latency-estimation, channel-switching-complete, admin-streaming-metrics, streaming-ws-api-complete]
  affects: [05-listener-ui, 08-reliability]
tech-stack:
  added: []
  patterns: [component-based-latency-estimation, config-resolver-callback, display-mode-filtering, periodic-monitoring-loop]
key-files:
  created:
    - sidecar/src/streaming/latency-estimator.ts
  modified:
    - sidecar/src/streaming/signaling-handler.ts
    - sidecar/src/streaming/streaming-subsystem.ts
    - sidecar/src/streaming/streaming-types.ts
    - sidecar/src/streaming/router-manager.ts
    - sidecar/src/ws/handler.ts
    - sidecar/src/ws/types.ts
key-decisions:
  - "ChannelStreamingConfigResolver callback decouples SignalingHandler from config store"
  - "PLC mode strips NACK and transport-cc from consumer rtpCapabilities"
  - "ListenerChannelInfo extended with latencyMode and lossRecovery for Phase 5 client config"
  - "ChannelMetadataResolver extended with latencyMode and lossRecovery (not just display metadata)"
  - "disconnectListenersFromChannel: hard-cut + notify with remaining channels (replaces simple consumerClosed)"
  - "defaultChannelId pushed on initial connect for first-time listener auto-connect"
  - "30s latency monitoring loop with 200ms threshold emits latency-warning event"
  - "streaming:listeners displayMode (all/flagged/off) filters per admin preference"
  - "DRY: buildMetadataResolver() extracted -- used by 3 call sites"
duration: 12 minutes
completed: 2026-02-08
---

# Phase 4 Plan 06: Channel Switching, Latency Estimation, and Admin Metrics Summary

**One-liner:** LatencyEstimator with component-based estimation (72ms live / 112ms stable at 20ms frame), NACK/PLC per-channel consumer config via capability stripping, full channel switch with fallback chain and default channel auto-connect, 30s latency monitoring loop with 200ms threshold warning, and 8 typed streaming admin WebSocket payloads.

## Performance

| Metric | Value |
|--------|-------|
| Duration | 12 minutes |
| Started | 2026-02-08T11:08:28Z |
| Completed | 2026-02-08T11:20:34Z |
| Tasks | 4/4 |
| Files created | 1 |
| Files modified | 6 |

## Accomplishments

1. **LatencyEstimator module** -- Component-based latency estimation summing GStreamer buffer (frame size + AGC), Opus encode, mediasoup forwarding, WebRTC jitter buffer, and network. Live mode: ~72ms total (20ms frame, AGC on). Stable mode: ~112ms. `checkLatencyThreshold(estimate, thresholdMs)` returns boolean for admin warnings. No active measurement per locked decision -- configuration-based estimation only.

2. **NACK/PLC consumer configuration** -- Per-channel `lossRecovery` setting ("nack" or "plc") configures consumer RTP capabilities. NACK mode: default mediasoup behavior with retransmission. PLC mode: strips `nack` and `transport-cc` from `rtcpFeedback` in the consumer's RTP capabilities so mediasoup skips retransmission. Opus PLC on the browser side handles lost packets. Applied in all consumer creation paths: `handleConsume`, `handleSwitchChannel`, and `recreateTransportAndConsumer`.

3. **Channel switching completion** -- Hard cut (close consumer instantly), transport recreation on target channel's router, full fallback chain (target -> previous -> active channel list). `disconnectListenersFromChannel()` replaces simple `consumerClosed` notification -- now closes consumer and transport, notifies with remaining channels and channelStopped event. `getDefaultChannelId()` returns admin-set default or first alphabetical. Initial connect pushes `defaultChannelId` for auto-connect. `ListenerChannelInfo` extended with `latencyMode` and `lossRecovery` for Phase 5 client configuration.

4. **Admin metrics and monitoring** -- `getStreamingStatus()` returns per-channel status with latency estimates, listener counts, mode, and recovery setting. `getPerListenerStats(channelId?)` returns per-listener packet loss, jitter, session duration. `getChannelLatencyEstimate(channelId)` returns latency breakdown for a specific channel. 30-second latency monitoring loop checks all active channels against 200ms threshold, emits `latency-warning` event.

5. **Streaming WebSocket API completion** -- `streaming:status` enhanced with `ChannelStreamingStatus[]` including latency estimates. `streaming:channel-latency` returns `LatencyEstimate` for a specific channel. `streaming:listeners` respects `displayMode` (all/flagged/off) with per-listener stats. `streaming:latency-warning` broadcast wired. 8 payload types added: `StreamingStatusPayload`, `StreamingWorkersPayload`, `StreamingListenersPayload`, `StreamingRestartWorkersPayload`, `StreamingChannelLatencyPayload`, `StreamingListenerCountPayload`, `StreamingLatencyWarningPayload`, `StreamingWorkerAlertPayload`.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | LatencyEstimator and Live/Stable mode consumer config | e7aeb3d | latency-estimator.ts, signaling-handler.ts, streaming-subsystem.ts |
| 2 | Channel switching with full locked decision compliance | 75fbe6f | signaling-handler.ts, streaming-subsystem.ts, streaming-types.ts, router-manager.ts |
| 3 | Admin metrics and latency monitoring | 4fc8218 | streaming-subsystem.ts |
| 4 | Streaming admin WebSocket messages and types | 2bb6dba | handler.ts, types.ts |

## Files Created

| File | Purpose |
|------|---------|
| `sidecar/src/streaming/latency-estimator.ts` | Component-based latency estimation with threshold checking |

## Files Modified

| File | Changes |
|------|---------|
| `sidecar/src/streaming/signaling-handler.ts` | ChannelStreamingConfigResolver, NACK/PLC capability stripping, disconnectListenersFromChannel, getDefaultChannelId, defaultChannelId push on connect |
| `sidecar/src/streaming/streaming-subsystem.ts` | LatencyEstimator integration, getStreamingStatus, getPerListenerStats, getChannelLatencyEstimate, latency monitoring loop, buildMetadataResolver DRY extraction |
| `sidecar/src/streaming/streaming-types.ts` | ListenerChannelInfo extended with latencyMode and lossRecovery |
| `sidecar/src/streaming/router-manager.ts` | ChannelMetadataResolver extended with latencyMode and lossRecovery |
| `sidecar/src/ws/handler.ts` | streaming:channel-latency handler, streaming:status enhanced, streaming:listeners with displayMode, latency-warning broadcast |
| `sidecar/src/ws/types.ts` | 8 streaming payload types, ServerMessageType extended with streaming message types |

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| ChannelStreamingConfigResolver callback pattern | SignalingHandler needs latencyMode/lossRecovery/defaultChannel from config store but should not depend on ConfigStore directly. Callback pattern matches existing ChannelMetadataResolver approach (consistent, decoupled). |
| PLC mode strips NACK from consumer rtpCapabilities | mediasoup consumer inherits RTCP feedback from the capabilities passed to `transport.consume()`. Stripping `nack` and `transport-cc` feedback types prevents mediasoup from setting up retransmission for that consumer. Browser relies on Opus PLC instead. |
| ListenerChannelInfo extended (not a new type) | Phase 5 listener UI needs latencyMode and lossRecovery to configure mediasoup-client jitter buffer. Adding to existing type avoids a second channel info query. |
| disconnectListenersFromChannel replaces consumerClosed notify | Simple `consumerClosed` left the transport open and channel assignment stale. Full disconnect (close consumer + transport + clear channelId) is cleaner for admin stop/hide. Listeners get `channelStopped` with remaining channels. |
| 30s latency monitoring interval | Latency estimates are configuration-based (not measured), so they only change when admin changes config. 30s is frequent enough to catch config changes quickly without wasting CPU on repeated calculations. |
| displayMode filtering in streaming:listeners | Admin setting for listener stats display: "all", "flagged" (packet loss > 0 or jitter > 50ms), or "off". Filtering server-side reduces payload for large listener counts. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] ChannelMetadataResolver needed latencyMode and lossRecovery**

- **Found during:** Task 2
- **Issue:** Plan's must_haves says "Channel switching reuses WebRtcTransport" but 04-04 decision noted consumers must be on same router as producer, requiring transport recreation. The existing `ChannelMetadataResolver` only had name/outputFormat/defaultChannel. ListenerChannelInfo needed latencyMode/lossRecovery for Phase 5 client configuration.
- **Fix:** Extended ChannelMetadataResolver and ListenerChannelInfo with latencyMode and lossRecovery. Updated all metadata resolver call sites.
- **Files modified:** router-manager.ts, streaming-types.ts, streaming-subsystem.ts
- **Commit:** 75fbe6f

**2. [Rule 2 - Missing Critical] Channel stop/hide needed full listener disconnect**

- **Found during:** Task 2
- **Issue:** Previous implementation only sent `consumerClosed` notification when a channel was stopped. This left the WebRtcTransport open and the peer's channelId stale. Listeners needed to be fully disconnected and given remaining channel list.
- **Fix:** Added `disconnectListenersFromChannel()` that closes consumer, transport, clears channel assignment, and notifies with `channelStopped` event including remaining channels.
- **Files modified:** signaling-handler.ts, streaming-subsystem.ts
- **Commit:** 75fbe6f

**3. [Rule 1 - Bug] Metadata resolver hardcoded defaultChannel: false**

- **Found during:** Task 1
- **Issue:** Three metadata resolver closures in streaming-subsystem.ts all hardcoded `defaultChannel: false` with a comment "Phase 6 adds admin-set default channel". Phase 6 is this plan, so the hardcoding needed to be replaced.
- **Fix:** All metadata resolvers now read defaultChannel from config store via `resolveChannelConfig()`. Extracted `buildMetadataResolver()` for DRY.
- **Files modified:** streaming-subsystem.ts
- **Commit:** e7aeb3d

## Issues Encountered

None.

## Next Phase Readiness

- **Phase 5 (Listener UI):** All server-side streaming APIs are complete. ListenerChannelInfo includes latencyMode and lossRecovery for client-side jitter buffer configuration. Consumer accept payloads include latencyMode and lossRecovery. Default channel auto-connect is ready.
- **Phase 8 (Reliability):** streaming:restart-workers remains stubbed (deferred from 04-05). Latency monitoring loop can be extended with active measurement if needed. Worker rotation can leverage existing LatencyEstimator for pre/post restart comparison.

## Self-Check: PASSED
