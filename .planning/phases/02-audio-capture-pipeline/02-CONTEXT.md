# Phase 2: Audio Capture Pipeline - Context

**Gathered:** 2026-02-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Capture audio from AES67 multicast streams (Dante network) and local audio devices, with each channel running as an independent GStreamer process for fault isolation. Admin creates app channels, assigns one or more source inputs (AES67 channels, local devices), and sources are captured independently. Multi-source mixing and audio processing happen in Phase 3. Admin UI for configuration is Phase 6 — Phase 2 builds the backend API and pipeline infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Stream Discovery Behavior
- Discovery method: SAP (Session Announcement Protocol) + mDNS/Bonjour for finding AES67/Dante streams
- Discovery approach: Claude's discretion (auto-scan vs on-demand)
- No manual multicast address entry — discovery only
- Stream info display: detailed (stream name, multicast address, sample rate, channels, codec, source device name)
- Offline streams: show as unavailable (grayed out), not removed from list
- Persistence: remember discovered streams between restarts, re-verify on launch
- Multi-channel streams (64-channel Dante): admin can select individual mono channels or stereo pairs from the multi-channel stream
- Channel labels: Claude's discretion (show metadata names if available from SAP/SDP, fall back to channel numbers)
- Custom device naming: no renaming at source level — naming happens at app channel level (Phase 6)
- Guided setup: if no AES67 streams found, show helpful message with steps to enable AES67 mode in Dante Controller
- Source preview: live level meter on any source (AES67 or local) before/during assignment — level meter only, no waveform
- Stereo pair preview meters: Claude's discretion (dual L/R vs single combined)
- Multicast join policy: join on demand only (when an app channel uses the source), not all discovered groups
- Pipeline auto-start: all configured channels auto-start on app launch using saved config

### Local Audio Device Handling
- Windows audio APIs supported: WASAPI, DirectSound, and ASIO (all three)
- API priority: ASIO > WASAPI > DirectSound (auto-select best available per device)
- ASIO exclusive access warning: show clear warning when selecting ASIO device
- Mac/Linux audio capture: deferred (Windows first)
- WASAPI loopback capture: supported (system audio output / "what you hear")
- Hot-plug detection: real-time device list updates when devices are added/removed
- Hot-unplug recovery: auto-reconnect pipeline when device is plugged back in
- Per-channel selection on multi-channel interfaces: yes, admin picks specific channels (mono or stereo pair) from multi-channel devices
- Device info display: show name + sample rate + bit depth + channel count
- Show all devices: physical, virtual (VB-Cable, VoiceMeeter), and per-API entries (same device appears as ASIO and WASAPI separately)
- Bluetooth devices: excluded from source list
- Sample rate: capture at device native rate, GStreamer handles resampling internally
- Buffer size: Claude's discretion (auto-detect optimal with optional override)
- Stale device handling: prompt admin to reassign or disconnect channel when configured device is not found
- Config persistence: set-it-and-forget-it philosophy — all settings stored in config
- Config backup: auto-snapshot on every app launch, old configs never overwritten
- Audio monitor: admin can route any source (AES67 or local) to a selectable output device for listening verification
- Mix monitoring: admin can also monitor the final mixed output of an app channel, not just individual sources

### Channel-to-Source Mapping
- Multiple sources per app channel: yes, admin assigns one or more sources that will be mixed (mixing implementation in Phase 3)
- Source sharing: any source can be assigned to multiple app channels
- Per-source gain: each source feeding into an app channel has individual volume control
- Per-source mute: each source has a mute toggle (stays in config, doesn't contribute audio when muted)
- Per-source delay: adjustable delay offset in ms for time-aligning sources (manual only, no auto-detect)
- No solo mode — mute/unmute is sufficient
- Source order: visual only, does not affect mix
- No panning: volume control only, no L/R pan
- No channel limit: unlimited app channels and unlimited sources per channel (practical limit by hardware)
- Source switching on live channel: Claude's discretion (instant cut vs brief crossfade)
- No presets: one persistent configuration, no named presets
- Output format: configurable per app channel — mono or stereo
- Stereo-to-mono conversion: standard sum L+R when stereo pair feeds mono channel

### Pipeline Lifecycle & Feedback
- Startup status: detailed stages (Initializing → Connecting to source → Buffering → Streaming)
- Error display: user-friendly message by default, with expandable technical details (full GStreamer error)
- Per-channel event log: each channel has its own timestamped event history (start, stop, errors, source changes)
- Log persistence: pipeline events written to disk, survives restarts
- Log retention: auto-cleanup, keep last 30 days
- No log export UI — files are on disk, admin accesses directly if needed
- Manual control: channels auto-start on launch, but admin can manually stop/start individual channels
- Crash recovery: auto-restart pipeline with attempt limit, then stop and show error
- Level update rate: configurable via dropdown (suggested options: ~10/sec at 100ms, ~30/sec at 33ms)
- Clip indicator: momentary red flash on clipping (no hold)
- Pipeline uptime: display uptime counter per channel
- Per-pipeline resource stats: show CPU% and memory per GStreamer pipeline process
- No global health indicator — individual channel statuses only
- Failure notification: visual status in app + OS system notification with channel name and error type
- Graceful shutdown: brief drain period to flush buffers before stopping pipelines
- Resource feedback: display clear warnings when detecting drops, pops, network congestion, or hardware limits reached

### Claude's Discretion
- Stream discovery approach (auto-scan vs on-demand)
- Channel labels from AES67 metadata
- Stereo pair preview meters (dual vs single)
- Buffer size configuration
- Source switch behavior (instant cut vs crossfade)

</decisions>

<specifics>
## Specific Ideas

- "Dante sends 64 channels, and I want to be able to select specific channel and in future combine multiple, with processing" — multi-source mixing per app channel is the core model
- "Admin creates app channel, selects one or multiple channels that will mix down into one app mix with effects" — the mental model is: app channel = mix bus with multiple source inputs
- "Set it and forget it — all stored in config, backed up periodically, with option to restore previous run" — config philosophy
- "When we notice drops or pops or network congestion, display suggestion: hardware limits reached, processor too busy, network too crowded" — proactive resource monitoring with actionable feedback
- "Allow fine-tuning of level update rate so we support wide range of hardware — dropdown with suggested options" — configurable performance vs visual quality tradeoff
- "Show all device entries per API — 'Focusrite (ASIO)', 'Focusrite (WASAPI)' — admin picks which API" — full transparency on audio API per device

</specifics>

<deferred>
## Deferred Ideas

- Multi-source mixing (combining sources into one output) — Phase 3 (Audio Processing)
- Audio effects/processing per channel — Phase 3
- ASIO support may need deeper research for GStreamer compatibility — Phase 2 research will investigate
- Mac CoreAudio + Linux PulseAudio/ALSA capture — future platform expansion
- Channel presets / named configurations — if needed, future phase
- Config import/export UI — Phase 9 (Settings import/export)
- Log export UI — Phase 9 if needed

</deferred>

---

*Phase: 02-audio-capture-pipeline*
*Context gathered: 2026-02-07*
