---
phase: 07-listener-advanced-features
plan: "03"
subsystem: streaming
tags: [mediasoup, signaling, dual-channel, agc, protoo]
dependency_graph:
  requires: [07-01]
  provides: [consumeSecondary-handler, disconnectSecondary-handler, toggleProcessing-handler, connectSecondaryTransport-handler, resumeSecondaryConsumer-handler]
  affects: [signaling-handler, streaming-subsystem, streaming-types]
tech_stack:
  added: []
  patterns: [callback-injection-for-cross-subsystem-decoupling, secondary-peerId-suffix-convention]
key_files:
  created: []
  modified:
    - sidecar/src/streaming/streaming-types.ts
    - sidecar/src/streaming/signaling-handler.ts
    - sidecar/src/streaming/streaming-subsystem.ts
decisions:
  - "Direct callback from SignalingHandler to AudioSubsystem (no intermediate event) since StreamingSubsystem owns both references"
  - "Secondary transport uses peerId suffixed with __secondary for transport-manager key isolation"
  - "Only one secondary consumer per peer (closeSecondary before re-create prevents resource leaks)"
metrics:
  duration: "4 min"
  completed: "2026-05-05T22:51:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 07 Plan 03: Dual-Channel Mixing + Processing Toggle Handlers Summary

Server-side protoo handlers for secondary consumer lifecycle and AGC processing toggle via listener signaling.

## One-liner

Five new protoo request handlers (consumeSecondary, disconnectSecondary, connectSecondaryTransport, resumeSecondaryConsumer, toggleProcessing) enabling dual-channel mixing and per-channel AGC toggle from listener phones.

## Tasks Completed

| # | Name | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Extend ListenerPeerData + secondary consumer handlers | fb1488c | 3 nullable fields on ListenerPeerData; consumeSecondary creates transport on secondary router; closeSecondary helper; peer close cleanup |
| 2 | toggleProcessing handler with audio subsystem callback | 58eea5d | ProcessingToggleHandler type; constructor param; handleToggleProcessing validates + delegates; streaming-subsystem wires to audioSubsystem.updateProcessingConfig |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- `npx tsc --noEmit` exits 0 (clean compile)
- All 5 case labels present in handleRequest switch
- ListenerPeerData has 3 new fields (secondaryWebRtcTransport, secondaryConsumer, secondaryChannelId)
- ProcessingToggleHandler exported from signaling-handler.ts
- closeSecondary called in handlePeerClose for cleanup

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|-----------|
| T-07-06 | closeSecondary called before creating new secondary (bounds to 1 per peer) |
| T-07-07 | Both consumeSecondary and toggleProcessing validate channelId against routerManager.getRouterForChannel |
