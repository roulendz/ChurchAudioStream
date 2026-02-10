---
status: complete
phase: 05-listener-web-ui
source: [05-01-SUMMARY.md, 05-02-SUMMARY.md, 05-03-SUMMARY.md, 05-04-SUMMARY.md]
started: 2026-02-10T07:30:00Z
updated: 2026-02-10T10:10:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Sidecar serves listener UI at HTTPS port
expected: Opening https://localhost:7777 (or your LAN IP) in a browser shows the React listener app (dark background, "Connecting..." or channel list) instead of the old Phase 1 placeholder.
result: pass

### 2. Channel list shows cards with metadata
expected: After connecting, you see a welcome area and channel cards. Each card shows: channel name, language flag + label. If admin toggles are on: description, listener count, live badge.
result: pass

### 3. Tapping a channel card opens the player
expected: Tapping a live (not dimmed) channel card transitions to a full-screen player view showing "Connecting..." spinner, then "Start Listening" button.
result: pass

### 4. Start Listening plays audio
expected: Tapping "Start Listening" plays the channel's audio through the phone/browser speaker. The player shows pulsing ring animation, elapsed time counter "Listening for 00:XX", and connection quality icon in the header.
result: pass

### 5. Volume slider adjusts audio level
expected: Dragging the volume slider changes the audio volume smoothly (no clicks/pops). The speaker icon shows wave lines matching the volume level (muted=X, low=1, med=2, high=3).
result: pass

### 6. Mute toggle works
expected: Tapping the speaker icon mutes the audio (volume slider goes to 0, pulsing ring stops). Tapping again unmutes and restores previous volume.
result: pass
note: Dragging volume to 0 manually does not dim the pulsing ring — only the mute button does. Minor cosmetic inconsistency.

### 7. Back navigation returns to channel list
expected: Tapping the back chevron (<) stops audio and returns to the channel list. Scroll position is preserved.
result: pass

### 8. Offline channel shows toast
expected: Tapping a dimmed (offline) channel card shows a toast message "This channel is not live right now" that auto-dismisses.
result: issue
reported: "Stopped channels disappear from channel list entirely instead of showing as dimmed offline cards. Empty state shows 'Please be patient while we connect translators' instead."
severity: major

### 9. Share button works
expected: Tapping the share icon in the channel list header either opens the native share sheet (mobile) or shows a QR code modal with the listener URL (desktop). QR code should be scannable.
result: pass
note: Share button only visible on channel list view, not in the player view.

### 10. Offline screen appears when disconnected
expected: Disconnecting from WiFi (or the server going down) shows a full-screen overlay with WiFi icon and "Connect to the church WiFi to listen to live translations" message with a "Try Again" button.
result: issue
reported: "When sidecar is stopped (Ctrl+C), listener shows 'Reconnecting...' banner + empty channel list instead of the full-screen WiFi overlay with Try Again button. Also: uncaught exception on shutdown (EOS error not handled during graceful shutdown)."
severity: major

### 11. Last channel persisted and highlighted
expected: After listening to a channel and reopening the app, the channel list highlights the previously listened channel with a "Continue listening" badge.
result: pass

### 12. PWA manifest and service worker
expected: Browser DevTools > Application tab shows: manifest.webmanifest with "Church Audio Stream" name, service worker registered and active, offline.html in precache.
result: pass

## Summary

total: 12
passed: 10
issues: 2
pending: 0
skipped: 0

## Gaps

- truth: "Stopped channels show as dimmed offline cards with toast on tap"
  status: failed
  reason: "User reported: Stopped channels disappear from channel list entirely instead of showing as dimmed offline cards. Empty state shows 'Please be patient while we connect translators' instead."
  severity: major
  test: 8
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- truth: "Server disconnect shows full-screen WiFi overlay with Try Again button"
  status: failed
  reason: "User reported: When sidecar is stopped, listener shows 'Reconnecting...' banner + empty channel list instead of the full-screen WiFi overlay. Also uncaught exception on shutdown from unhandled EOS error."
  severity: major
  test: 10
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

## Additional Observations (not Phase 5 bugs)

- **DTLS closure loop (Phase 4):** WebRTC transport DTLS closes after 3-6 seconds repeatedly, preventing stable audio playback. Root cause needs investigation.
- **Specific WASAPI device IDs crash (Phase 2):** Only the default capture GUID works; long device paths fail with "Could not open resource for reading".
- **Dropped samples warning (Phase 3):** 192kHz resampling for audioloudnorm causes "Can't record audio fast enough" warnings.
- **Uncaught exception on shutdown (Phase 4):** EOS error in GStreamerProcess not handled during graceful shutdown, causes fatal crash.
