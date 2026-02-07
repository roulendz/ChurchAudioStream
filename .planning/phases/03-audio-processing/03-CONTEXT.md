# Phase 3: Audio Processing - Context

**Gathered:** 2026-02-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Per-channel audio normalization/AGC and Speech/Music mode processing, followed by Opus encoding to RTP output for mediasoup ingestion. This phase transforms raw captured audio (from Phase 2) into clean, consistent, encoded streams. It does NOT include WebRTC distribution (Phase 4), listener UI (Phase 5), or admin dashboard rendering (Phase 6) — but it exposes the data and controls those phases will consume.

</domain>

<decisions>
## Implementation Decisions

### Normalization/AGC behavior
- Target loudness: -16 LUFS (broadcast standard)
- Per-channel adjustable target level via slider
- Target range: -20 to -14 LUFS (tight range, prevents accidental extremes)
- AGC speed: Medium (3-5 second settle time) — natural feel for sermon dynamics
- No hard limiter — trust AGC to handle peaks
- Admin can bypass AGC per channel (toggle) — for pre-mixed board feeds
- Live target adjustments use smooth ~1 second transition (no audible jump)
- Gain reduction indicator exposed for admin dashboard (shows when/how much AGC is compressing)
- Per-channel "reset to defaults" action restores all processing settings

### Speech vs Music mode
- Manual toggle only (Speech or Music) — no auto-detection
- Default mode for new channels: Speech
- Mode switch on live channel uses brief crossfade (~500ms) for smooth transition
- Opus application type hint linked to mode: Speech → VOIP, Music → Audio

### Opus encoding config
- Per-channel adjustable bitrate
- Bitrate range: 48-192 kbps
- Default bitrate: 128 kbps
- Mono only in v1 (stereo deferred)
- Sample rate: 48kHz (Opus native, no resampling)
- CBR/VBR: admin toggle per channel (dropdown)
- Frame size: configurable per channel (10ms / 20ms / 40ms options)
- FEC (Forward Error Correction): admin toggle, off by default
- No DTX (always send packets, no silence suppression)
- Opus application type: linked to Speech/Music mode toggle

### RTP output
- Fixed port range starting at 77702
- Each channel uses 2 ports: RTP + RTCP (77702/77703, 77704/77705, 77706/77707...)
- Localhost only (127.0.0.1) — mediasoup consumes on same machine

### Processing chain
- Fixed order: Input → Normalization/AGC → Opus Encoding → RTP Output
- Each stage can be independently bypassed (toggle per stage per channel)
- No separate "passthrough" mode — admin uses per-stage toggles
- Pipeline restart on config changes (bypass toggle, mode switch, bitrate change)
- Brief silence (~100-500ms) during restart is acceptable
- Config changes debounced (~1-2s) — rapid tweaks batch into single restart
- All processing config changes persist immediately to config store (no explicit save)
- Visual chain diagram in admin dashboard: Input → [AGC ✓] → [Opus ✓] → RTP (bypassed stages shown dimmed)

### Bandwidth monitoring
- Bandwidth per connected listener displayed in admin dashboard
- Display format: Claude's discretion (simple number vs sparkline — fits Phase 6/9 scope)

### Claude's Discretion
- What parameters change between Speech and Music mode (AGC behavior, Opus settings, or both)
- Exact GStreamer elements for normalization/AGC implementation
- Default frame size (20ms likely, but Claude can optimize)
- Default CBR vs VBR setting
- Bandwidth display format (simple number or mini graph)
- Gain reduction indicator visual design

</decisions>

<specifics>
## Specific Ideas

- RTP base port 77702 chosen for distinctiveness — easy to identify as ChurchAudioStream traffic in network tools
- Port spacing of +2 per channel (77702, 77704, 77706...) for RTP/RTCP pairs
- "I think we have toggle, or dropdown, to test" — admin wants to experiment with CBR vs VBR to see what works best for their setup
- Bandwidth per listener display helps admin understand the real cost of their encoding settings

</specifics>

<deferred>
## Deferred Ideas

- Stereo encoding support — deferred past v1
- Audio preview/dry-run mode (admin listening to processed output before going live) — future enhancement
- Auto-detection of Speech vs Music content — not in v1

</deferred>

---

*Phase: 03-audio-processing*
*Context gathered: 2026-02-07*
