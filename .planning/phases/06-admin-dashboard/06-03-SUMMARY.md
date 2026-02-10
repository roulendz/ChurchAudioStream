---
phase: 06-admin-dashboard
plan: 03
subsystem: admin-ui-monitoring
tags: [canvas, vu-meter, audio-levels, processing-controls, requestAnimationFrame, HiDPI]
depends_on:
  requires: ["06-01"]
  provides: ["VU meter components", "useAudioLevels hook", "ProcessingControls component"]
  affects: ["06-04"]
tech-stack:
  added: []
  patterns: ["Canvas 2D rendering with rAF loop", "useRef for high-frequency data (no re-renders)", "Debounced slider control"]
key-files:
  created:
    - src/hooks/useAudioLevels.ts
    - src/components/monitoring/VuMeter.tsx
    - src/components/monitoring/VuMeterBank.tsx
    - src/components/channels/ProcessingControls.tsx
  modified:
    - src/App.tsx
    - src/App.css
    - src/components/channels/ChannelConfigPanel.tsx
decisions:
  - "useAudioLevels stores all level data in useRef<Map> -- zero React re-renders from 100ms level broadcasts"
  - "VuMeter uses requestAnimationFrame for 60fps rendering independent of React lifecycle"
  - "HiDPI support via devicePixelRatio canvas scaling"
  - "Smooth decay factor 0.92 per frame with 30-frame peak hold"
  - "ProcessingControls sendMessage prop is optional on ChannelConfigPanel for backward compatibility"
  - "Slider debounce: 300ms timeout cancelled on mouseup/touchend for immediate commit"
  - "Level data merged per-channel across pipelines (component-wise max for peak/rms, OR for clipping)"
metrics:
  duration: 8 minutes
  completed: 2026-02-10
---

# Phase 06 Plan 03: VU Meters and Processing Controls Summary

Canvas-based VU meters with 60fps rAF rendering, useRef-only level storage, and per-channel Speech/Music + AGC controls with debounced WS updates.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Canvas VU meters + audio levels hook | 26db6e4 | useAudioLevels.ts, VuMeter.tsx, VuMeterBank.tsx |
| 2 | Per-channel processing controls | c46a8d5 | ProcessingControls.tsx, ChannelConfigPanel.tsx |

## Decisions Made

1. **useRef for level data**: Level data from the 100ms broadcast cycle is stored in `useRef<Map>` -- VuMeter components read via rAF callbacks, never triggering React re-renders. This is critical for 60fps rendering without React overhead.

2. **Canvas 2D rendering**: Each VuMeter uses a dedicated Canvas with requestAnimationFrame loop. HiDPI displays are handled via devicePixelRatio scaling of the canvas backing store.

3. **Smooth decay + peak hold**: RMS and peak values rise instantly but decay at 0.92 factor per frame. Peak hold line stays for 30 frames before decaying -- natural VU meter behavior.

4. **Pipeline-to-channel merging**: Multiple pipelines may map to the same channel. useAudioLevels groups by channelId, takes component-wise max for peak/rms, ORs clipping flags, and takes max gainReductionDb.

5. **Debounced slider**: AGC target slider debounces at 300ms during drag, but sends immediately on mouseup/touchend to ensure the final value is committed without delay.

6. **Optional sendMessage prop**: ProcessingControls integration uses an optional `sendMessage` prop on ChannelConfigPanel, so the component works regardless of whether callers pass it.

## Parallel Plan Coordination

Plans 02 and 04 were running concurrently. This plan successfully:
- Used the `useChannels` hook created by Plan 02 (already existed when this plan started)
- Made additive changes to App.tsx (imports + monitoring section content)
- Appended CSS styles to App.css without modifying existing styles from other plans
- Added `sendMessage` as an optional prop to ChannelConfigPanel (created by Plan 02) for ProcessingControls wiring

## Deviations from Plan

None -- plan executed exactly as written.

## Next Phase Readiness

- VU meters render immediately when channels start streaming
- Processing controls send updates via existing `channel:processing:update` WS endpoint (built in Phase 3)
- Stale level data auto-pruned after 2 seconds (handles channel stop gracefully)

## Self-Check: PASSED
