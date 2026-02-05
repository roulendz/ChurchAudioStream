# Roadmap: ChurchAudioStream

## Overview

ChurchAudioStream delivers a Tauri 2.x desktop application with a Node.js sidecar that captures Dante/AES67 and local audio, processes it through GStreamer, and distributes it via WebRTC (mediasoup SFU) to congregation members' phones. The roadmap follows the audio signal path: foundation and configuration first, then capture, processing, streaming, listener UI, admin dashboard, advanced features, reliability hardening, monitoring polish, and finally packaging for distribution. Each phase delivers a coherent, verifiable capability that builds on the previous one.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Project Foundation & Configuration** - Tauri 2.x app shell with Node.js sidecar, Express web server, and JSON config persistence
- [ ] **Phase 2: Audio Capture Pipeline** - GStreamer-based capture from AES67 multicast and local audio devices with stream discovery
- [ ] **Phase 3: Audio Processing** - Per-channel normalization, Speech/Music mode, and Opus encoding via GStreamer
- [ ] **Phase 4: WebRTC Streaming Core** - mediasoup SFU distributing Opus audio to browser listeners with sub-100ms latency
- [ ] **Phase 5: Listener Web UI** - Mobile-first PWA with channel selection, volume control, and QR code access
- [ ] **Phase 6: Admin Dashboard** - Channel configuration, real-time VU meters, listener counts, and server status monitoring
- [ ] **Phase 7: Listener Advanced Features** - Mix balance slider, processing toggles, localization, and light/dark theme
- [ ] **Phase 8: Reliability & Self-Healing** - Auto-reconnection, pipeline crash recovery, worker rotation, and network diagnostics
- [ ] **Phase 9: Monitoring & Admin Polish** - Stream health graphs, engagement statistics, admin theming, and settings import/export
- [ ] **Phase 10: Distribution & Deployment** - Cross-platform installers, portable builds, auto-start, and update notifications

## Phase Details

### Phase 1: Project Foundation & Configuration
**Goal**: A running Tauri 2.x application with Node.js sidecar, Express web server, WebSocket signaling endpoint, and persistent JSON configuration -- the skeleton that all subsequent phases build on
**Depends on**: Nothing (first phase)
**Requirements**: PLAT-01, CONF-01, CONF-02, CONF-04
**Success Criteria** (what must be TRUE):
  1. Tauri desktop window launches on Windows, Mac, and Linux with the Node.js sidecar process running alongside it
  2. Express web server serves a placeholder page at the configured IP:port, accessible from a phone browser on the same network
  3. WebSocket signaling endpoint accepts connections from browser clients
  4. Changing a setting in the app persists after restart (JSON config file written to disk and reloaded on launch)
  5. Admin can change the web server IP and port in settings, and the server restarts on the new address
**Plans**: 5 plans

Plans:
- [ ] 01-01-PLAN.md -- Tauri 2.x project scaffolding with Node.js sidecar lifecycle (spawn, auto-restart, clean shutdown)
- [ ] 01-02-PLAN.md -- Config store (Zod), self-signed certs, Express HTTPS server, WebSocket signaling, mDNS
- [ ] 01-03-PLAN.md -- Config wire-up with server restart, React admin UI shell (settings, status, logs)
- [ ] 01-04-PLAN.md -- [GAP FIX] Server 0.0.0.0 binding + Windows Firewall rule (UAT Tests 2, 3, 8, 9)
- [ ] 01-05-PLAN.md -- [GAP FIX] LogViewer error visibility + sidecar binary rebuild (UAT Test 11)

### Phase 2: Audio Capture Pipeline
**Goal**: The app can receive audio from both AES67 multicast streams (Dante network) and local system audio devices, with each channel running as an independent GStreamer process for fault isolation
**Depends on**: Phase 1
**Requirements**: CAPT-01, CAPT-02, CAPT-03, CAPT-04, CAPT-05, PROC-04
**Success Criteria** (what must be TRUE):
  1. Admin can see a list of discovered AES67 streams on the network and select one as input for a channel
  2. Admin can see a list of local audio input devices (USB interfaces, microphones, line-in) and select one as input for a channel
  3. Each configured channel spawns its own GStreamer child process, and killing one process does not affect others
  4. Audio level data (peak/RMS) is parsed from each GStreamer pipeline and available to the sidecar for monitoring
  5. Admin can configure a channel to use either a Dante/AES67 network source or a local audio device, and switch between them
**Plans**: TBD

Plans:
- [ ] 02-01: GStreamer pipeline builder and process manager
- [ ] 02-02: AES67 multicast RTP reception and stream discovery
- [ ] 02-03: Local audio device enumeration and capture
- [ ] 02-04: Channel source configuration and audio level parsing

### Phase 3: Audio Processing
**Goal**: Captured audio is processed with normalization/AGC and Speech/Music mode awareness before being encoded to Opus, so listeners hear clean, consistent audio
**Depends on**: Phase 2
**Requirements**: PROC-01, PROC-02, PROC-03
**Success Criteria** (what must be TRUE):
  1. A quiet audio source and a loud audio source on different channels produce similar perceived volume for the listener (normalization/AGC working)
  2. Admin can toggle Speech/Music mode per channel, and music content (choir, instruments) passes through without warbling artifacts when in Music mode
  3. GStreamer outputs Opus-encoded RTP at the configured bitrate (default ~120kbps) to a localhost UDP port ready for mediasoup ingestion
**Plans**: TBD

Plans:
- [ ] 03-01: GStreamer normalization and AGC pipeline elements
- [ ] 03-02: Speech/Music mode toggle and Opus encoding output

### Phase 4: WebRTC Streaming Core
**Goal**: Opus audio from GStreamer pipelines flows through mediasoup SFU to browser listeners over WebRTC, achieving sub-100ms end-to-end latency
**Depends on**: Phase 3
**Requirements**: STRM-01, STRM-05
**Success Criteria** (what must be TRUE):
  1. Multiple browser tabs (or phones) can simultaneously receive audio from the same channel without the server re-encoding per listener
  2. A second channel can stream independently to its own set of listeners at the same time
  3. End-to-end latency from audio input to listener playback is under 100ms on a local WiFi network (measured, not estimated)
  4. Opening a browser, connecting via WebSocket, and receiving audio completes within 3 seconds on a typical phone
**Plans**: TBD

Plans:
- [ ] 04-01: mediasoup worker, router, and PlainTransport setup
- [ ] 04-02: WebRTC transport negotiation and consumer management
- [ ] 04-03: Latency measurement and optimization pipeline

### Phase 5: Listener Web UI
**Goal**: Congregation members can open a URL on their phone, see available channels, pick one, and hear audio -- the core user-facing experience
**Depends on**: Phase 4
**Requirements**: LWEB-01, LWEB-02, LWEB-03, LWEB-04, LWEB-05
**Success Criteria** (what must be TRUE):
  1. A listener opens the URL on their phone and sees a welcome screen with large, easy-to-tap channel buttons
  2. Listener can adjust volume with a slider without audio cutting out or glitching
  3. Listener can switch to a different channel without navigating back to the home screen
  4. After adding the PWA to their home screen, the app loads from cache and remembers their last-used channel and volume
  5. Admin can display a QR code that, when scanned by a phone, opens the listener Web UI directly
**Plans**: TBD

Plans:
- [ ] 05-01: PWA shell with service worker and manifest
- [ ] 05-02: Channel selection and mediasoup-client WebRTC playback
- [ ] 05-03: Volume control, channel switching, and preference persistence
- [ ] 05-04: QR code generation for listener access

### Phase 6: Admin Dashboard
**Goal**: Sound technicians can configure channels, see real-time audio levels, monitor listener counts, and check server health from the desktop GUI
**Depends on**: Phase 5
**Requirements**: AGUI-01, AGUI-02, AGUI-03, AGUI-04, AGUI-05, AGUI-06, AGUI-09, AGUI-10
**Success Criteria** (what must be TRUE):
  1. Admin sees a dashboard with sidebar navigation that organizes channels, monitoring, and settings into clear sections
  2. Admin can create, rename, reorder, show/hide, and configure input source for each channel without restarting the app
  3. Admin can adjust normalization level and Speech/Music mode per channel from the dashboard, and changes apply to the live audio stream immediately
  4. VU meters display real-time audio levels for each active channel, updating smoothly (no visible stutter)
  5. Admin can see how many listeners are connected to each channel and the total listener count
  6. Admin can see server resource usage (CPU, memory) and the status of active connections
**Plans**: TBD

Plans:
- [ ] 06-01: Dashboard layout with sidebar navigation
- [ ] 06-02: Channel configuration UI (CRUD, source selection, ordering)
- [ ] 06-03: Real-time VU meters and audio processing controls
- [ ] 06-04: Listener counts, server status, and QR code display

### Phase 7: Listener Advanced Features
**Goal**: Listeners can blend two channels, toggle audio processing, use the UI in their own language, and choose light or dark theme
**Depends on**: Phase 5
**Requirements**: STRM-03, STRM-04, LWEB-06, LWEB-07
**Success Criteria** (what must be TRUE):
  1. Listener can use a mix balance slider to blend the original language channel with a translation channel, hearing both at an adjustable ratio
  2. Listener can toggle server-side audio processing (normalization) on or off from their phone, and the change is audible immediately
  3. Listener can switch the Web UI language (e.g., English, Spanish) and all interface text updates without reloading
  4. Web UI adapts to the phone's system light/dark preference automatically, and listener can manually override the theme
**Plans**: TBD

Plans:
- [ ] 07-01: Dual-channel mix balance with Web Audio API
- [ ] 07-02: Listener-side processing toggle
- [ ] 07-03: Web UI localization framework and language switching
- [ ] 07-04: Light/dark theme with system detection and manual override

### Phase 8: Reliability & Self-Healing
**Goal**: The system recovers automatically from WiFi drops, pipeline crashes, worker memory leaks, and network issues -- a Sunday service runs unattended without intervention
**Depends on**: Phase 4, Phase 6
**Requirements**: STRM-02, RELY-01, RELY-02, RELY-03, RELY-04, RELY-05
**Success Criteria** (what must be TRUE):
  1. When a listener's WiFi drops and reconnects, audio resumes automatically within 5 seconds without manual intervention
  2. When a GStreamer pipeline crashes, it restarts automatically and the channel resumes streaming without affecting other channels
  3. mediasoup workers that exceed a memory threshold are rotated gracefully without dropping active listener connections
  4. Admin can run a network diagnostic that checks IGMP snooping, PTP clock status, and multicast health, and sees clear pass/fail results
  5. Both admin GUI and listener Web UI show connection health indicators (connected, reconnecting, degraded) that reflect actual stream state
**Plans**: TBD

Plans:
- [ ] 08-01: Listener auto-reconnection with exponential backoff and ICE restart
- [ ] 08-02: GStreamer pipeline crash recovery and graceful degradation
- [ ] 08-03: mediasoup worker health monitoring and auto-rotation
- [ ] 08-04: Network diagnostic tool (IGMP, PTP, multicast)
- [ ] 08-05: Connection health indicators in admin and listener UIs

### Phase 9: Monitoring & Admin Polish
**Goal**: Admin has deep visibility into stream health over time, can export/import settings across installations, and the admin GUI supports light/dark theming
**Depends on**: Phase 6
**Requirements**: AGUI-07, AGUI-08, AGUI-11, CONF-03
**Success Criteria** (what must be TRUE):
  1. Admin can view per-channel stream health metrics (latency, packet loss, buffer status) in real time
  2. Admin can view historical engagement graphs showing listener trends and peak usage over a service session
  3. Admin GUI supports light/dark theme with system-adaptive auto-detection and manual override
  4. Admin can export all settings to a JSON file and import them on another installation, restoring the full configuration
**Plans**: TBD

Plans:
- [ ] 09-01: Stream health monitoring dashboard (latency, packet loss, buffer)
- [ ] 09-02: Engagement statistics and historical graphs
- [ ] 09-03: Admin theme system and settings import/export

### Phase 10: Distribution & Deployment
**Goal**: The app is packaged for easy installation on Windows, Mac, and Linux, with optional auto-start and update notifications so churches can deploy and maintain it without technical expertise
**Depends on**: All prior phases
**Requirements**: PLAT-02, PLAT-03, PLAT-04, PLAT-05
**Success Criteria** (what must be TRUE):
  1. A church admin can download and install the app using platform-native installers (.exe for Windows, .dmg for Mac, .deb for Linux)
  2. A portable version runs without installation (e.g., from a USB drive) on each platform
  3. When enabled in settings, the app starts automatically when the computer boots, ready for Sunday service without manual launch
  4. The app checks for new versions and notifies the admin, who chooses when to install the update
**Plans**: TBD

Plans:
- [ ] 10-01: Cross-platform installer packaging (Tauri bundler)
- [ ] 10-02: Portable app builds
- [ ] 10-03: Auto-start on boot and update notification system

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10
(Phase 7 and 8 can execute in parallel after their dependencies are met)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Project Foundation & Configuration | 0/5 | In progress (UAT gap closure) | - |
| 2. Audio Capture Pipeline | 0/4 | Not started | - |
| 3. Audio Processing | 0/2 | Not started | - |
| 4. WebRTC Streaming Core | 0/3 | Not started | - |
| 5. Listener Web UI | 0/4 | Not started | - |
| 6. Admin Dashboard | 0/4 | Not started | - |
| 7. Listener Advanced Features | 0/4 | Not started | - |
| 8. Reliability & Self-Healing | 0/5 | Not started | - |
| 9. Monitoring & Admin Polish | 0/3 | Not started | - |
| 10. Distribution & Deployment | 0/3 | Not started | - |
