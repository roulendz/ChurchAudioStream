---
phase: "07"
plan: "04"
subsystem: listener-pwa
tags: [web-audio, dual-channel, mixing, crossfade, protoo, mediasoup, hooks, ui-components]
dependency_graph:
  requires: [07-02, 07-03]
  provides: [useMixBalance, useProcessingToggle, MixBalanceSlider, MixChannelPicker, AudioEngine.getAudioContext, AudioEngine.getAudioElement]
  affects: [listener/src/lib/audio-engine.ts, listener/src/styles/player.css]
tech_stack:
  added: []
  patterns: [equal-power-crossfade, optimistic-update-revert, secondary-transport-lifecycle, bottom-sheet-picker]
key_files:
  created:
    - listener/src/hooks/useMixBalance.ts
    - listener/src/hooks/useMixBalance.test.ts
    - listener/src/hooks/useProcessingToggle.ts
    - listener/src/hooks/useProcessingToggle.test.ts
    - listener/src/components/MixBalanceSlider.tsx
    - listener/src/components/MixChannelPicker.tsx
  modified:
    - listener/src/lib/audio-engine.ts
    - listener/src/styles/player.css
decisions:
  - "Secondary device loaded fresh per connection (not cached like primary) since secondary router may differ"
  - "Equal-power cosine crossfade (cos/sin) chosen over linear for constant-power property"
  - "Optimistic UI with revert-on-failure for processing toggle (avoids perceived latency)"
metrics:
  duration: "4 minutes"
  completed: "2026-05-05T01:57:57Z"
  tasks_completed: 3
  tasks_total: 3
  test_count: 10
  files_changed: 8
---

# Phase 07 Plan 04: Mix Balance & Processing Toggle (Client) Summary

**Client-side dual-channel mix balance with Web Audio API crossfade and processing toggle hook**

## Completed Tasks

| # | Name | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Extend audio-engine + useMixBalance hook + tests | 5760160 | audio-engine.ts, useMixBalance.ts, useMixBalance.test.ts |
| 2 | useProcessingToggle hook + tests | ecd5ca9 | useProcessingToggle.ts, useProcessingToggle.test.ts |
| 3 | MixBalanceSlider + MixChannelPicker components | 81832b4 | MixBalanceSlider.tsx, MixChannelPicker.tsx, player.css |

## Implementation Details

### useMixBalance Hook
- Full secondary transport lifecycle: Device load -> createRecvTransport(device, transportInfo) -> transport.on("connect") DTLS wiring -> consume -> resume
- Web Audio graph: two MediaStreamSources -> individual GainNodes -> shared MasterGain -> destination
- Equal-power crossfade: `cos(balance * PI/2)` for primary, `sin(balance * PI/2)` for secondary
- HTMLAudioElement paused during mix mode (Web Audio owns output); resumed on disconnect
- Balance clamped to [0,1] before applying (T-07-09 mitigation)

### useProcessingToggle Hook
- Sends `peer.request("toggleProcessing", { channelId, enabled })` to server
- Optimistic state update; reverts if server request fails
- `setProcessingEnabled()` for direct sync from server notifications

### UI Components
- MixBalanceSlider: range input 0-100, channel labels left/right, close button, identical styling to VolumeSlider
- MixChannelPicker: bottom sheet with `hasActiveProducer` filter, `language?.flag` display, role=dialog, aria-modal

## Verification

- All 25 listener tests pass (4 test files)
- TypeScript clean (`tsc -b --noEmit` exits 0)
- `createRecvTransport(secondaryDevice, response.transportInfo)` confirmed in source
- `secondaryTransport.on("connect"` confirmed in source
- `hasActiveProducer` (not isActive) confirmed in MixChannelPicker
- `language?.flag` (not flagEmoji) confirmed in MixChannelPicker

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- [x] listener/src/hooks/useMixBalance.ts EXISTS
- [x] listener/src/hooks/useMixBalance.test.ts EXISTS
- [x] listener/src/hooks/useProcessingToggle.ts EXISTS
- [x] listener/src/hooks/useProcessingToggle.test.ts EXISTS
- [x] listener/src/components/MixBalanceSlider.tsx EXISTS
- [x] listener/src/components/MixChannelPicker.tsx EXISTS
- [x] Commits 5760160, ecd5ca9, 81832b4 exist in git log
