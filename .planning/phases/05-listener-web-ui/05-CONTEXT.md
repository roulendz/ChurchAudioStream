# Phase 5: Listener Web UI - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Mobile-first PWA where congregation members open a URL on their phone, see available channels, pick one, and hear live audio via WebRTC. Includes channel selection, volume control, PWA offline shell, QR code sharing, and Media Session API for background/lock-screen audio.

**Out of scope:** Mix balance slider (Phase 7), processing toggles (Phase 7), localization (Phase 7), light/dark theme (Phase 7), auto-reconnection with exponential backoff (Phase 8), connection health indicators (Phase 8).

</domain>

<decisions>
## Implementation Decisions

### Welcome & Channel Selection
- Brief welcome message above the channel list (generic default: "Select a channel to listen", admin can override with custom text)
- Total listener count shown in welcome area (e.g., "12 people listening") — updates every 30s
- No branding in v1 — clean, neutral design
- Channel cards show: name, description, language (flag + text label), listener count, live/offline badge
- **Minimal defaults:** Only name + language shown by default; admin toggles on listener count, description, live badge per preference
- **Server optimization:** Hidden card fields are not tracked/calculated server-side (admin toggle controls both display AND server computation)
- Cards with details layout — not simple buttons or a list
- Auto-update channel list via WebSocket with visual animation cue when channels go live/offline
- Live channels sort to top, offline channels sort to bottom (within each group, admin-defined order)
- Offline channels shown as dimmed/non-tappable (not hidden)
- Returning listeners see their last-listened channel highlighted (stored in localStorage)
- "No channels available" empty state with friendly description: "Please be patient while we connect translators" (or similar admin-configurable message)
- Tapping a channel card immediately starts connecting (no expand/confirm step)

### Audio Playback Experience
- Tapping a channel card transitions to a **full-screen player view** with "Connecting..." indicator
- **"Start Listening" tap required** on player screen for autoplay policy compliance — every channel connect and every channel switch requires this tap
- **Exception:** Auto-reconnect after WiFi disconnect does NOT require tap (session already had user gesture)
- Player shows: channel name, description, language (flag + text, matching card style), listener count, elapsed listening time, connection quality icon (good/fair/poor), pulsing dot/ring visualization
- Pulsing ring uses a fixed app accent color (not per-channel)
- Pulsing ring **stops when muted** — visual feedback that audio is paused
- Separate mute button (not tap-on-ring to mute)
- Volume slider style: Claude's discretion (best mobile UX practice)
- Volume does NOT persist across sessions — always starts at 70% default
- Media Session API: lock screen shows play/pause + channel name + description
- **Disconnect UX:** Auto-reconnect with "Reconnecting..." indicator — no manual action needed
- **Channel stopped by admin:** Stay on player screen showing "Channel offline" — auto-reconnect if channel comes back
- **Server unreachable:** Friendly error "Can't reach the audio server. Make sure you're on the church WiFi." with retry button
- Listener count on player screen updates every 30s (same interval as channel list)

### Channel Switching Flow
- Switching happens via **back navigation to channel list** — no inline picker, no swipe gestures
- Audio **stops immediately** when leaving the player screen (clean break)
- Previously listened channel shows a **"Last listened" badge** on its card in the channel list
- Tapping a dimmed (offline) channel shows a **toast message**: "This channel is not live right now"
- Simple fade transition between player screens when switching channels
- Scroll position memory and navigation model (browser history vs app-internal): Claude's discretion
- WebRTC transport lifecycle on back navigation: Claude's discretion (teardown vs keep-warm)

### PWA & Offline Behavior
- PWA install prompt shown on **second visit** (not first-timers)
- Offline screen: Descriptive message explaining they need church WiFi to listen — "Connect to the church WiFi to listen to live translations" (not just "no connection")
- Cache strategy: Claude's discretion
- Last-used channel saved in localStorage — highlighted with "Continue listening" on return visits
- **Listener share feature:** Web Share API (native share sheet) with QR code as fallback; links to general listener URL (not specific channel)
- Service worker updates **silently** — new version loads on next visit, no prompt
- PWA icon: App name abbreviation (e.g., "CAS")
- **Portrait orientation only** — designed for one-handed phone use

### Claude's Discretion
- Volume slider orientation and style (vertical vs horizontal)
- Scroll position behavior when returning to channel list
- Browser history management (history.pushState vs internal state)
- WebRTC transport teardown vs keep-warm on channel exit
- PWA cache strategy (app shell only vs app shell + last channel list)
- Player screen layout and spacing
- Exact pulsing ring animation parameters
- Connection quality thresholds (good/fair/poor)
- Back navigation design (arrow placement, stop button inclusion)

</decisions>

<specifics>
## Specific Ideas

- Channel cards should feel informational — flag + language name makes it obvious what each channel is for (multilingual audience)
- Admin controls what the listener sees: toggleable card fields mean smaller churches don't show listener counts if they don't want to, and the server doesn't waste resources computing hidden values
- "Start Listening" button on every channel connect ensures autoplay works on all browsers (iOS Safari, Chrome, etc.)
- Pulsing ring should be subtle — a gentle visual that says "audio is flowing" without being distracting during a sermon
- Empty state message should be welcoming, not technical — this is a church, not an error page
- Elapsed time gives listeners a sense of how long the service has been going

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-listener-web-ui*
*Context gathered: 2026-02-10*
