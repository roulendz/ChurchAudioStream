---
status: complete
phase: 03-audio-processing
source: [03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md]
started: 2026-02-07T18:00:00Z
updated: 2026-02-07T20:55:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Processing config defaults on channel creation
expected: When creating a new channel via WebSocket, the channel data includes a `processing` field with AGC enabled (targetLufs -16), Opus encoding enabled (bitrate 128, frameSize 20), mode "speech", and auto-allocated RTP port/SSRC.
result: pass

### 2. Get processing config via WebSocket
expected: Sending `channel:processing:get` with a channel ID returns the full processing config (agc, opusEncoding, rtpOutput, mode) for that channel.
result: pass

### 3. Update processing config via WebSocket (partial update)
expected: Sending `channel:processing:update` with partial data (e.g., just `{ agc: { targetLufs: -18 } }`) updates only the specified fields. Other fields remain unchanged. Server responds with `channel:updated` containing the full updated config.
result: pass

### 4. Speech/Music mode switch
expected: Updating mode from "speech" to "music" via `channel:processing:update` causes audioType to change from "voice" to "generic" and maxTruePeakDbtp to change from -2 to -1. Switching back restores original values.
result: pass

### 5. Reset processing config to defaults
expected: Sending `channel:processing:reset` restores the channel's processing config to factory defaults (AGC enabled, targetLufs -16, bitrate 128, mode "speech"). Server responds with `channel:updated` containing the reset config.
result: pass

### 6. Pipeline includes AGC chain when enabled
expected: When a channel is started with AGC enabled, the GStreamer pipeline string (visible in logs) includes `audioloudnorm` wrapped in `audioresample` elements (48kHz to 192kHz and back).
result: skipped
reason: No audio sources available on test machine (no Dante, device polling not surfacing local WASAPI devices)

### 7. Pipeline includes Opus/RTP output when enabled
expected: When a channel is started with Opus encoding enabled, the GStreamer pipeline string (visible in logs) includes `opusenc`, `rtpopuspay`, and `udpsink` targeting localhost on the allocated RTP port.
result: skipped
reason: No audio sources available on test machine (no Dante, device polling not surfacing local WASAPI devices)

### 8. Debounced pipeline restart on config change
expected: When you update processing config on a running channel, the pipeline restarts after ~1.5 seconds (not instantly). Rapid successive updates only trigger one restart. Visible in logs as pipeline stop + start with new config.
result: skipped
reason: No audio sources available on test machine (no Dante, device polling not surfacing local WASAPI devices)

### 9. Gain reduction in level data
expected: When AGC is active on a channel, the level broadcast data includes a `gainReductionDb` field (number). When AGC is off, gainReductionDb is 0.
result: skipped
reason: No audio sources available on test machine (no Dante, device polling not surfacing local WASAPI devices)

### 10. Phase 2 backward compatibility
expected: Existing channels from Phase 2 (no explicit processing config) continue to work as metering-only pipelines. The Zod schema fills in default processing config without requiring config file migration.
result: pass

### 11. TypeScript compilation clean
expected: Running `npx tsc --noEmit` in the sidecar directory completes with zero errors.
result: pass

### 12. RTP ports not exposed in update API
expected: The `channel:processing:update` WebSocket message does NOT allow setting RTP ports or SSRC manually. These fields are auto-allocated and read-only. Attempting to include rtpOutput.port in the update payload has no effect on port allocation.
result: pass

## Summary

total: 12
passed: 8
issues: 0
pending: 0
skipped: 4

## Gaps

[none yet]
