# Roadmap: ChurchAudioStream

## Overview

ChurchAudioStream delivers a Tauri 2.x desktop application with a Node.js sidecar that captures Dante/AES67 and local audio, processes it through GStreamer, and distributes it via WebRTC (mediasoup SFU) to congregation members' phones. The roadmap follows the audio signal path: foundation and configuration first, then capture, processing, streaming, listener UI, admin dashboard, advanced features, reliability hardening, monitoring polish, and finally packaging for distribution. Each phase delivers a coherent, verifiable capability that builds on the previous one.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Project Foundation & Configuration** - Tauri 2.x app shell with Node.js sidecar, Express web server, and JSON config persistence
- [x] **Phase 2: Audio Capture Pipeline** - GStreamer-based capture from AES67 multicast and local audio devices with stream discovery
- [x] **Phase 3: Audio Processing** - Per-channel normalization, Speech/Music mode, and Opus encoding via GStreamer
- [x] **Phase 4: WebRTC Streaming Core** - mediasoup SFU distributing Opus audio to browser listeners with sub-100ms latency
- [x] **Phase 5: Listener Web UI** - Mobile-first PWA with channel selection, volume control, and QR code access
- [x] **Phase 6: Admin Dashboard** - Channel configuration, real-time VU meters, listener counts, and server status monitoring
- [x] **Phase 7: Listener UX & Audio Latency** - i18n (en/es/lv), light/dark theme, audio latency fix (4s → <150ms)
- [ ] **Phase 8: Reliability & Self-Healing** - Auto-reconnection (latency-aware), pipeline crash recovery, worker rotation, health indicators
- [ ] **Phase 9: Monitoring & Admin Polish** - Latency dashboard, stream health, engagement graphs, admin theming, settings export/import
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
**Plans**: 8 plans

Plans:
- [ ] 01-01-PLAN.md -- Tauri 2.x project scaffolding with Node.js sidecar lifecycle (spawn, auto-restart, clean shutdown)
- [ ] 01-02-PLAN.md -- Config store (Zod), self-signed certs, Express HTTPS server, WebSocket signaling, mDNS
- [ ] 01-03-PLAN.md -- Config wire-up with server restart, React admin UI shell (settings, status, logs)
- [ ] 01-04-PLAN.md -- [GAP FIX] Server 0.0.0.0 binding + Windows Firewall rule (UAT Tests 2, 3, 8, 9)
- [ ] 01-05-PLAN.md -- [GAP FIX] LogViewer error visibility + sidecar binary rebuild (UAT Test 11)
- [ ] 01-06-PLAN.md -- [GAP FIX v2] Dual HTTP/HTTPS server + plain ws:// for Tauri admin (UAT-v2 Gap 1)
- [ ] 01-07-PLAN.md -- [GAP FIX v2] Firewall elevation detection + actionable manual instructions (UAT-v2 Gap 2)
- [ ] 01-08-PLAN.md -- [GAP FIX v2] LogViewer deduplication + early log buffering in Rust (UAT-v2 Gap 3)

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
**Plans**: 9 plans

Plans:
- [ ] 02-01-PLAN.md -- Audio type system (source, channel, pipeline types) and Zod config schemas
- [ ] 02-02-PLAN.md -- GStreamer pipeline string builder and level metering parser
- [ ] 02-03-PLAN.md -- GStreamer child process wrapper and pipeline manager with crash recovery
- [ ] 02-04-PLAN.md -- SAP multicast listener and SDP parser for AES67 stream discovery
- [ ] 02-05-PLAN.md -- Local audio device enumeration via gst-device-monitor-1.0
- [ ] 02-06-PLAN.md -- Source registry and discovery manager (SAP + mDNS + device polling)
- [ ] 02-07-PLAN.md -- Level monitor, resource monitor (pidusage), and event logger
- [ ] 02-08-PLAN.md -- Channel manager with source assignment and pipeline orchestration
- [ ] 02-09-PLAN.md -- WebSocket API integration and audio subsystem facade

### Phase 3: Audio Processing
**Goal**: Captured audio is processed with normalization/AGC and Speech/Music mode awareness before being encoded to Opus, so listeners hear clean, consistent audio
**Depends on**: Phase 2
**Requirements**: PROC-01, PROC-02, PROC-03
**Success Criteria** (what must be TRUE):
  1. A quiet audio source and a loud audio source on different channels produce similar perceived volume for the listener (normalization/AGC working)
  2. Admin can toggle Speech/Music mode per channel, and music content (choir, instruments) passes through without warbling artifacts when in Music mode
  3. GStreamer outputs Opus-encoded RTP at the configured bitrate (default ~120kbps) to a localhost UDP port ready for mediasoup ingestion
**Plans**: 3 plans

Plans:
- [ ] 03-01-PLAN.md -- Processing config types, Zod schemas, port allocator, and PipelineConfig extension
- [ ] 03-02-PLAN.md -- Pipeline builder processing chain (audioloudnorm + Opus/RTP output) and gain reduction tracking
- [ ] 03-03-PLAN.md -- Channel manager integration, debounced pipeline restart, and WebSocket processing API

### Phase 4: WebRTC Streaming Core
**Goal**: Opus audio from GStreamer pipelines flows through mediasoup SFU to browser listeners over WebRTC, achieving sub-100ms end-to-end latency
**Depends on**: Phase 3
**Requirements**: STRM-01, STRM-05
**Success Criteria** (what must be TRUE):
  1. Multiple browser tabs (or phones) can simultaneously receive audio from the same channel without the server re-encoding per listener
  2. A second channel can stream independently to its own set of listeners at the same time
  3. End-to-end latency from audio input to listener playback is under 100ms on a local WiFi network (measured, not estimated)
  4. Opening a browser, connecting via WebSocket, and receiving audio completes within 3 seconds on a typical phone
**Plans**: 9 plans

Plans:
- [ ] 04-01-PLAN.md -- DRY/SRP audit fixes: extract debounce, error-message utilities; consolidate channel selection builder
- [ ] 04-02-PLAN.md -- Streaming types, mediasoup config schema, install mediasoup + protoo-server
- [ ] 04-03-PLAN.md -- WorkerManager, RouterManager, PlainTransportManager (mediasoup server infrastructure)
- [ ] 04-04-PLAN.md -- TransportManager, SignalingHandler, protoo listener WebSocket (/ws/listener)
- [ ] 04-05-PLAN.md -- StreamingSubsystem facade, server integration, graceful shutdown
- [ ] 04-06-PLAN.md -- Channel switching, latency estimation, Live/Stable mode, admin streaming API
- [ ] 04-07-PLAN.md -- [GAP FIX] Fix GStreamer level parser: stdout wiring + GValueArray regex (UAT Tests 6-9, 12, 14)
- [ ] 04-08-PLAN.md -- [GAP FIX v2] Fix WSS admin upgrade interference: single upgrade dispatcher with protoo isolation (UAT-v2 Test 1)
- [ ] 04-09-PLAN.md -- [GAP FIX v2] Fix graceful shutdown: PipelineManager shutdown guard + streaming listener cleanup (UAT-v2 Test 6)

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
**Plans**: 5 plans

Plans:
- [ ] 05-01-PLAN.md -- Server-side channel metadata extension + Listener Vite+React+PWA project scaffold
- [ ] 05-02-PLAN.md -- Signaling client, mediasoup WebRTC playback, channel list view, and basic player
- [ ] 05-03-PLAN.md -- Player UI: volume slider, mute, pulsing ring, connection quality, elapsed time
- [ ] 05-04-PLAN.md -- Preferences persistence, PWA install prompt, Media Session, share/QR, offline screen
- [ ] 05-05-PLAN.md -- [GAP FIX] Stopped channels visible + offline screen on server disconnect + shutdown crash fix (UAT Tests 8, 10)

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
**Plans**: 4 plans

Plans:
- [ ] 06-01-PLAN.md -- Server-side API gaps (reorder, visibility, level channelId) + dashboard shell with sidebar navigation
- [ ] 06-02-PLAN.md -- Channel configuration UI (CRUD, source selection, reorder, visibility)
- [ ] 06-03-PLAN.md -- Real-time Canvas VU meters and per-channel audio processing controls
- [ ] 06-04-PLAN.md -- Listener counts, server status monitoring, and QR code display

### Phase 7: Listener UX & Audio Latency
**Goal**: Listeners get i18n, theming, and sub-150ms audio latency (down from 4 seconds) via bounded GStreamer queues and jitter buffer control
**Depends on**: Phase 5
**Requirements**: LWEB-06, LWEB-07
**Success Criteria** (what must be TRUE):
  1. Listener can switch the Web UI language (en/es/lv) and all interface text updates without reloading
  2. Web UI adapts to the phone's system light/dark preference automatically, and listener can manually override the theme
  3. Audio latency from GStreamer to listener is under 150ms on LAN (measured via jitter buffer stats panel)
  4. GStreamer tee queues are bounded (50ms, leaky=downstream) preventing accumulation drift
  5. Browser jitter buffer target is set to 50ms preventing adaptive growth to seconds
**Plans**: 5 plans

Plans:
- [x] 07-01-PLAN.md -- Vitest setup + CSS custom property refactoring + themes.css + useTheme hook + FOUC prevention
- [x] 07-02-PLAN.md -- i18n framework (i18next) + 3 locale files (en/es/lv) + wrap all existing components with t()
- [x] 07-03-PLAN.md -- Audio latency fixes: bounded tee queues, jitterBufferTarget, udpsink sync removal
- [x] 07-04-PLAN.md -- Jitter buffer metrics in connection-stats + StatsPanel display
- [x] 07-05-PLAN.md -- SettingsPanel with ThemeToggle + LanguagePicker (cleanup: removed mix/processing)

### Phase 8: Reliability & Self-Healing
**Goal**: The system recovers automatically from WiFi drops, pipeline crashes, and network issues while preserving low latency -- a Sunday service runs unattended without intervention
**Depends on**: Phase 4, Phase 6, Phase 7
**Requirements**: STRM-02, RELY-01, RELY-02, RELY-03, RELY-04, RELY-05
**Success Criteria** (what must be TRUE):
  1. When a listener's WiFi drops and reconnects, audio resumes automatically within 5 seconds with latency staying under 150ms (no jitter buffer bloat after reconnect)
  2. When a GStreamer pipeline crashes, it restarts automatically and the channel resumes streaming without affecting other channels or accumulating latency
  3. mediasoup workers that exceed a memory threshold are rotated gracefully without dropping active listener connections
  4. After any recovery event (reconnect, pipeline restart, worker rotation), measured jitter buffer delay returns to <100ms within 3 seconds
  5. Both admin GUI and listener Web UI show connection health indicators (connected, reconnecting, degraded) that reflect actual stream state and latency
**Plans**: TBD

Plans:
- [ ] 08-01: Listener auto-reconnection with exponential backoff, ICE restart, and jitter buffer reset
- [ ] 08-02: GStreamer pipeline crash recovery with bounded-queue preservation
- [ ] 08-03: mediasoup worker health monitoring and auto-rotation
- [ ] 08-04: Latency regression guard (alert if jitter buffer > 200ms sustained)
- [ ] 08-05: Connection health indicators in admin and listener UIs (includes latency badge)

### Phase 9: Monitoring & Admin Polish
**Goal**: Admin has deep visibility into stream health (especially latency) over time, can export/import settings, and the admin GUI supports light/dark theming
**Depends on**: Phase 6, Phase 7
**Requirements**: AGUI-07, AGUI-08, AGUI-11, CONF-03
**Success Criteria** (what must be TRUE):
  1. Admin can view per-channel end-to-end latency (GStreamer queue + network + jitter buffer) in real time, with alert when >150ms
  2. Admin can view per-channel stream health metrics (packet loss, buffer status, bitrate) alongside latency
  3. Admin can view historical engagement graphs showing listener trends and peak usage over a service session
  4. Admin GUI supports light/dark theme with system-adaptive auto-detection and manual override
  5. Admin can export all settings to a JSON file and import them on another installation, restoring the full configuration
**Plans**: TBD

Plans:
- [ ] 09-01: End-to-end latency dashboard (per-listener jitter buffer via consumer stats + GStreamer queue depth)
- [ ] 09-02: Stream health panel (packet loss, bitrate, buffer) + engagement graphs
- [ ] 09-03: Admin theme system and settings import/export
- [ ] 09-04: Admin-only processing toggle (AGC on/off per channel, controlled from admin not listener)

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

## Backlog (deferred from active phases)

- **STRM-03**: Mix balance slider (blend two channels) — removed from Phase 7, not needed for MVP. Revisit after latency is validated in production.
- **STRM-04**: Processing toggle in listener — removed. If needed, belongs in admin panel only (Phase 9, plan 09-04). One listener toggling AGC affects all listeners on that channel.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10
(Phase 7 and 8 can execute in parallel after their dependencies are met)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Project Foundation & Configuration | 8/8 | Verified (UAT v3: 12/12) | 2026-02-07 |
| 2. Audio Capture Pipeline | 9/9 | Verified (5/5 must-haves) | 2026-02-07 |
| 3. Audio Processing | 3/3 | Verified (12/12 must-haves) | 2026-02-07 |
| 4. WebRTC Streaming Core | 9/9 | Verified (UAT v3: 6/6) | 2026-02-10 |
| 5. Listener Web UI | 5/5 | Verified (7/7 must-haves, gaps closed) | 2026-02-10 |
| 6. Admin Dashboard | 4/4 | Verified (26/26 must-haves) | 2026-02-10 |
| 7. Listener UX & Audio Latency | 5/5 | Complete (latency fix applied) | 2026-05-05 |
| 8. Reliability & Self-Healing | 0/5 | Not started | - |
| 9. Monitoring & Admin Polish | 0/4 | Not started | - |
| 10. Distribution & Deployment | 0/3 | Not started | - |
