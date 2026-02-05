# Project Research Summary

**Project:** ChurchAudioStream
**Domain:** Audio Streaming / Dante-to-WebRTC Restreaming / Church Technology
**Researched:** 2026-02-05
**Confidence:** MEDIUM-HIGH

## Executive Summary

ChurchAudioStream aims to capture Dante/AES67 professional audio network streams and restream them to congregant smartphones via WebRTC with ultra-low latency (sub-100ms). This product category occupies a unique niche: existing solutions either require expensive proprietary hardware (Listen EVERYWHERE at $967+) or cloud-based services (LiveVoice, spf.io) with internet dependencies and latency issues. The recommended approach is an Electron desktop application running Node.js with mediasoup SFU for WebRTC distribution, GStreamer child processes for audio capture and processing, and a Progressive Web App for listeners.

The technical foundation is solid and well-documented. Dante's AES67 interoperability mode enables open-standard multicast RTP reception without proprietary licensing. GStreamer's mature audio pipeline handles AES67 capture, real-time processing (noise cancellation, normalization), and Opus encoding. mediasoup provides production-grade WebRTC SFU capability that scales to hundreds of listeners. The primary architectural decision is running GStreamer as isolated child processes rather than in-process bindings, which provides crash isolation and operational simplicity at the cost of some API elegance.

The critical risks center on network infrastructure and operational complexity. IGMP snooping misconfiguration can flood church WiFi networks or prevent multicast reception entirely. iOS Safari's background audio suspension remains an unsolved platform limitation that will affect user experience. WiFi capacity planning is essential—100+ concurrent WebRTC connections can saturate consumer-grade access points. The mitigation strategy is threefold: comprehensive network health diagnostics, aggressive auto-reconnection logic, and self-healing architecture with automated recovery from pipeline crashes and worker failures.

## Key Findings

### Recommended Stack

The research converges on a Node.js-centric architecture that leverages the mature WebRTC SFU ecosystem while maintaining process isolation for the complex GStreamer audio pipeline. **Electron was chosen over Tauri** because mediasoup is a Node.js native library—running it in Tauri would require a Node.js sidecar compiled binary with IPC overhead, negating Tauri's bundle size advantage. Since this is a dedicated church appliance running on a semi-dedicated machine, Electron's 200-300 MB memory footprint and 100+ MB installer are acceptable trade-offs for architectural simplicity.

**Core technologies:**
- **Node.js 22.x LTS** — Backend runtime with LTS until 2027-04. Native home for mediasoup and excellent async I/O for WebRTC signaling. Avoids Rust complexity for church volunteer maintainers.
- **Electron** — Desktop framework. Provides Node.js main process for mediasoup, Express server, and GStreamer child process management. Renderer process hosts React admin dashboard.
- **GStreamer 1.26.x** — Audio capture and processing. Industry-standard multimedia framework with native AES67 RTP support, built-in noise suppression (webrtcdsp), and Opus encoding. Spawned as child processes for crash isolation.
- **mediasoup 3.19.x** — WebRTC SFU. Purpose-built Selective Forwarding Unit with C++ media workers. Handles WebRTC transport negotiation and packet forwarding. PlainTransport ingests Opus RTP from GStreamer.
- **React 19.x + Vite** — Shared UI framework for both Electron admin dashboard and listener PWA. Component model fits real-time VU meters and channel management. vite-plugin-pwa generates PWA with service worker.
- **Opus codec (libopus 1.6)** — Low-latency audio encoding at 48-128 kbps. 10-20ms frame sizes achieve sub-100ms latency. FEC (forward error correction) handles WiFi packet loss.

**Critical integration pattern:** GStreamer child processes output Opus-encoded RTP to localhost UDP ports (one per channel). mediasoup PlainTransport listens on these ports and ingests the audio. This pattern is documented in mediasoup's official demo broadcaster scripts and provides clean process isolation.

### Expected Features

Research identified 13 table stakes features, 10 competitive differentiators, and 9 anti-features to avoid. The competitive analysis covered 5 major competitors (Listen EVERYWHERE, LiveVoice, spf.io, Williams Sound, OneAccord AI).

**Must have (table stakes):**
- **Multi-channel audio selection** — Users expect language/channel picker. Listen EVERYWHERE offers 2-16 channels; 8 channels covers typical church needs (English, Spanish, ASL interpretation, overflow audio, etc.).
- **Low-latency streaming (sub-100ms)** — Lip-sync requirement for in-room listeners. Listen EVERYWHERE achieves 60ms average. Above 100ms, the delay becomes distracting when watching the speaker.
- **Phone-based listening (BYOD)** — PWA model eliminates app installation friction. All modern competitors use smartphone + headphones approach.
- **QR code access** — Standard onboarding pattern. Print QR codes on bulletins or display on screens. Instant access without typing URLs.
- **Volume control per listener** — Basic expectation. Web Audio API GainNode implementation.
- **Automatic reconnection** — WiFi drops are common. WebRTC ICE restart with exponential backoff required for production reliability.
- **Basic audio processing (AGC/normalization)** — Interpreter booth mic technique varies wildly. Server-side normalization ensures consistent volume across channels.

**Should have (competitive advantages):**
- **Native Dante/AES67 capture** — Primary differentiator. No additional hardware needed beyond existing Dante network. Competitors require dedicated server boxes ($967+) or manual audio input routing.
- **Self-hosted / local-first** — Runs entirely on-premises. No cloud dependency, no subscription fees, no internet requirement. Critical for rural churches and privacy-conscious congregations.
- **Open source dual license** — No commercial competitor is open source. Churches can inspect, modify, and contribute. Smaller churches get it free; larger churches can pay for support.
- **Server-side noise cancellation** — RNNoise ML-based noise suppression removes HVAC hum and booth noise before encoding. Competitors pass through raw audio.
- **Real-time VU meters and health monitoring** — Professional-grade admin dashboard with per-channel audio levels, listener counts, stream health, and latency statistics. Gives sound techs operational confidence.

**Defer to v2+:**
- **Sermon recording/archiving** — Scope creep into storage management. Churches have existing DAW/recording tools.
- **Remote/internet streaming** — Different architecture (TURN servers, bandwidth costs, CDN). v1 focuses on local network (people in the building).
- **AI-powered automatic translation** — Competes with dedicated products (OneAccord, Breeze). AI latency (2-5s) breaks lip-sync. Quality insufficient for theological content.

**Anti-features (commonly requested but problematic):**
- **Captive portal auto-redirect** — Fragile across devices, breaks HTTPS, frustrates users. QR codes are more reliable.
- **Native mobile apps** — App store gatekeeping, installation friction, update delays. PWA achieves 90% of value instantly.
- **Video streaming** — Different domain entirely. Bandwidth explosion. Audio-only is the unique value proposition.
- **Listener authentication/accounts** — Friction kills adoption. Churches are welcoming; anonymous listening aligns with mission.

### Architecture Approach

The architecture follows a **process-isolated pipeline** pattern rather than a monolithic application. Each audio channel runs as an independent GStreamer child process managed by the Node.js main process. mediasoup runs in-process as a Node.js library, managing its own C++ worker processes. This design provides crash isolation (one channel failure doesn't take down the system), operational visibility (each pipeline can be monitored independently), and clean separation of concerns.

**Major components:**
1. **Electron Main Process (Node.js)** — Application lifecycle, config management, IPC coordination, and home for all in-process services (mediasoup, Express web server, WebSocket signaling, pipeline manager).
2. **GStreamer Pipelines (child processes)** — One per audio channel. Handles AES67 multicast RTP reception, dejittering, format conversion, audio processing (webrtcdsp for noise suppression + AGC, optional RNNoise), Opus encoding, and RTP output to localhost.
3. **mediasoup SFU (in-process library)** — WebRTC room management. PlainTransport ingests audio from GStreamer (localhost UDP). WebRtcTransport serves listeners. One Router per channel for isolation. C++ workers handle packet forwarding without transcoding.
4. **Web Server (Express in-process)** — Serves PWA static files, provides REST API for admin operations, and hosts WebSocket signaling endpoint for WebRTC negotiation.
5. **Admin Dashboard (Electron Renderer)** — React-based UI for channel configuration, VU meters, listener statistics, and system health monitoring. Communicates with main process via Electron IPC.
6. **Listener PWA (browser)** — Mobile-first Progressive Web App. Channel selection, audio playback via Web Audio API, volume control, and optional mix balance (blend original + translation). mediasoup-client handles WebRTC.

**Critical data flows:**
- **Audio pipeline:** Dante mixer → AES67 multicast (L24 PCM) → GStreamer child process → noise suppression + normalization → Opus encode → localhost UDP RTP → mediasoup PlainTransport → mediasoup Router/Producer → WebRTC transport → Listener phone browser → Web Audio API playback.
- **Signaling:** Listener browser → WebSocket connection → Express server → mediasoup API calls (createTransport, consume) → WebRTC SDP exchange → DTLS/SRTP media connection established.
- **Monitoring:** GStreamer stderr (level element) → pipeline manager parses peak/RMS → emit event → Electron IPC → Renderer VU meter components update at 30 fps.

**Latency budget (target <100ms end-to-end):**
- AES67 network + jitter buffer: 5-20ms
- Audio processing (noise suppression, AGC): ~10ms
- Opus encoding (10-20ms frame size): 10-20ms
- mediasoup forwarding: <1ms
- WebRTC transport (local WiFi): 20-50ms
- Browser decode + playout buffer: 20-40ms
- **Total: 65-141ms** — achievable on good WiFi, requires tuning for sub-100ms consistently

### Critical Pitfalls

Six critical pitfalls were identified that cause complete system failure or require architectural rewrites. These must be addressed in Phase 1 (network/infrastructure) and Phase 2 (core pipeline).

1. **IGMP snooping misconfiguration causes multicast flooding or silence** — AES67 multicast either floods all switch ports (killing WiFi) or never reaches the capture host. Church networks often use consumer-grade switches with IGMP disabled or no querier configured. **Prevention:** Require managed switch with IGMPv2 snooping + IGMP querier. Isolate Dante on dedicated VLAN. Ship network health-check diagnostic tool. **Phase 1 blocker.**

2. **PTP clock domain mismatch between Dante and AES67** — Audio has clicks, pops, pitch drift, or periodic dropouts. Dante uses PTPv1 by default; AES67 uses PTPv2 domain 0. Ultimo-based Dante devices cannot bridge. **Prevention:** Use Dante Controller to enable AES67 mode and verify PTP domain alignment. Provide PTP monitoring dashboard. Alternatively, receive native Dante multicast (requires Dante SDK licensing). **Phase 1 validation required.**

3. **iOS Safari kills background audio in PWA/browser** — Users lock their screen or switch apps and audio stops. No workaround exists (WebKit Bug 198277, acknowledged but unfixed). **Prevention:** Design UX around this constraint. Aggressive reconnection when tab regains focus. Clear UI state: "Audio paused - tap to resume." Consider Keep Awake toggle (Wake Lock API). Do NOT promise background audio on iOS. **Phase 3 UX decision.**

4. **mediasoup worker memory leak in long-running sessions** — C++ workers accumulate memory that is not released even after consumers disconnect. Workers crash after 1-3 hour sessions (typical Sunday service). Known issue in mediasoup 3.16.x. **Prevention:** Implement worker health monitoring (track RSS memory). Auto-restart workers exceeding 200MB. Create fresh routers per streaming session. Graceful worker rotation during services. **Phase 2 self-healing requirement.**

5. **Church WiFi cannot handle N concurrent WebRTC connections** — Works with 5 test users, fails with 50-200 phones on Sunday. Consumer-grade APs saturate. ICE connectivity fails, audio stutters. **Prevention:** Use SFU (already planned—encodes once, forwards to all). Optimize codec: mono, 24-48 kbps for speech. Recommend enterprise APs, 5GHz band, proper channel planning. Provide bandwidth calculator tool. **Phase 2-3 codec optimization and Phase 3 WiFi guidance.**

6. **AES67/Dante stream discovery fails silently** — App starts but never finds audio streams. AES67 has no single discovery protocol. Dante uses proprietary discovery; AES67 devices may use SAP, mDNS, or manual SDP. **Prevention:** Support multiple discovery methods (SAP, mDNS, manual SDP import). Provide network scanner for multicast traffic on 239.69.0.0/16. Clear diagnostic UI: "Scanning for streams..." with troubleshooting links. **Phase 1 discovery robustness.**

**Additional high-priority pitfalls:**
- **Noise cancellation destroys music/singing** — RNNoise is speech-trained. Choir and organ sound terrible (warbling, artifacts). Must provide Speech/Music/Auto mode toggle. Default OFF for music.
- **No audio with no diagnostics** — Most common UX failure. Implement audio level meters at every stage: capture input, post-processing, server receive, client playback. Show connection state machine visually.
- **100ms latency budget tighter than it looks** — Every stage adds latency. Measure at every stage from day one, not at the end. Use smaller Opus frame sizes (10ms instead of 20ms). Profile with GStreamer latency tracer.

## Implications for Roadmap

Based on research findings, the project should follow a strict **foundation-first** build order that respects component dependencies and addresses critical pitfalls early. The architecture dictates that audio capture must work before streaming, streaming must work before listeners can connect, and listeners must work before the admin dashboard is useful.

### Phase 1: Network Infrastructure & AES67 Capture
**Rationale:** The entire system depends on receiving AES67 multicast audio reliably. Network misconfiguration (IGMP snooping, PTP clock sync) causes silent failures that are maddening to debug. Pitfalls #1 (IGMP flooding), #2 (PTP clock mismatch), and #6 (stream discovery) are Phase 1 blockers. Attempting Phase 2 (streaming) without validating Phase 1 leads to "why isn't audio working" mysteries.

**Delivers:**
- Network health diagnostic tool (IGMP querier detection, multicast group join validation, PTP clock monitoring)
- GStreamer pipeline builder (construct CLI arguments from config)
- Pipeline manager (spawn, monitor, restart child processes)
- AES67 multicast RTP reception (verify on real Dante network hardware)
- Audio stream discovery (SAP, mDNS, manual SDP import)
- Audio level parsing from GStreamer stderr (for VU meters in later phase)

**Addresses features:** Native Dante/AES67 capture (primary differentiator), basic audio processing foundation.

**Avoids pitfalls:** #1 (IGMP), #2 (PTP), #6 (discovery).

**Needs research:** No. AES67 reception is well-documented (Collabora, RAVENNA guides, aes67-linux-daemon reference). GStreamer pipeline patterns are standard.

---

### Phase 2: WebRTC Streaming Core (mediasoup SFU)
**Rationale:** Once audio capture is validated, the next dependency is WebRTC distribution. mediasoup SFU setup, PlainTransport integration with GStreamer, and WebRtcTransport for listeners must work before any user-facing features. Pitfall #4 (worker memory leak) requires self-healing architecture from day one—cannot bolt on recovery logic later.

**Delivers:**
- Electron app shell (window management, IPC bridge, system tray)
- Config store (JSON persistence, validation, defaults)
- mediasoup worker/router setup (one router per channel)
- PlainTransport (ingest Opus RTP from GStreamer localhost output)
- WebRtcTransport (serve to listeners)
- Producer/Consumer management
- Worker health monitoring (RSS memory tracking, auto-restart on threshold)
- Express web server (serve static PWA files, REST API for stats)
- WebSocket signaling (transport negotiation, consumer creation)

**Uses stack:** Node.js 22.x, Electron, mediasoup 3.19.x, Express/Socket.IO, GStreamer Opus encoding.

**Implements architecture:** Process-isolated GStreamer pipelines → localhost UDP → mediasoup PlainTransport → WebRtcTransport.

**Addresses features:** Multi-channel streaming foundation, server infrastructure for PWA hosting.

**Avoids pitfalls:** #4 (worker memory leak recovery), #5 (codec optimization for WiFi capacity).

**Needs research:** No. mediasoup PlainTransport + GStreamer integration is documented in official demo. Worker lifecycle management follows standard Node.js patterns.

---

### Phase 3: Listener Web UI (PWA)
**Rationale:** Listeners are the end users. The PWA is where the product delivers value. Pitfall #3 (iOS Safari background audio) shapes the entire UX—must design around this constraint from the start, not discover it after launch. Auto-reconnection logic (pitfall #5 WiFi drops) is critical for production use.

**Delivers:**
- Progressive Web App (manifest.json, service worker, Add to Home Screen)
- mediasoup-client integration (WebRTC transport handling)
- Channel selection UI (language picker)
- Audio playback (Web Audio API, GainNode for volume)
- Auto-reconnection (ICE restart, exponential backoff, three-tier recovery)
- Connection state UI ("Connecting...", "Reconnecting...", "Audio paused")
- iOS Safari background audio handling (clear messaging, tap-to-resume UX)
- QR code generation (in admin dashboard pointing to PWA URL)

**Addresses features:** Phone-based listening, QR code access, volume control, automatic reconnection, church branding.

**Avoids pitfalls:** #3 (iOS Safari background audio UX), #5 (WiFi capacity via codec tuning), reconnection robustness.

**Needs research:** Minimal. PWA patterns are standard. mediasoup-client is well-documented. iOS Safari constraints are known and unfixable.

---

### Phase 4: Admin Dashboard
**Rationale:** Sound techs need visibility into system health and the ability to configure channels. The admin dashboard depends on all prior phases working (no point in VU meters if audio capture is broken). This is a quality-of-life phase, not a blocker for launch.

**Delivers:**
- React admin dashboard in Electron renderer process
- Real-time VU meters (per-channel audio levels from GStreamer)
- Channel management UI (name, source, visibility, enable/disable)
- Listener statistics (count per channel, connection quality)
- System health indicators (worker status, pipeline status, network health)
- Settings panels (global config, per-channel audio processing)
- Config import/export

**Addresses features:** Admin channel configuration, VU meters and monitoring.

**Avoids pitfalls:** Diagnostics for "no audio" failures (UX pitfall).

**Needs research:** No. Standard React + Electron IPC patterns. VU meter components well-documented.

---

### Phase 5: Audio Processing & Quality
**Rationale:** The system works without advanced audio processing (Phase 1-4 deliver a functional MVP). Phase 5 improves audio quality—server-side noise cancellation, normalization, and EQ. This is additive; failure here doesn't break core functionality. Pitfall: noise cancellation destroys music, so Speech/Music/Auto mode is mandatory.

**Delivers:**
- Server-side noise cancellation (RNNoise integration via GStreamer plugin or custom element)
- Per-channel loudness normalization (GStreamer audiodynamic/rglimiter)
- Per-channel EQ (3-5 band equalizer, admin-configurable)
- Processing mode toggle (Speech/Music/Auto)
- Voice activity detection (for Auto mode)

**Addresses features:** Server-side noise cancellation (differentiator), per-channel EQ (differentiator), basic normalization (table stakes).

**Avoids pitfalls:** Noise cancellation artifact pitfall (Speech/Music mode separation), latency budget (RNNoise adds fixed 10ms—budgeted).

**Needs research:** Moderate. RNNoise integration patterns available (Gcore blog, Datadog article). GStreamer audiornnoise element documented. Needs latency profiling to stay within budget.

---

### Phase 6: PWA Polish & Robustness
**Rationale:** After core functionality is validated in production (pilot churches testing Phase 1-5), polish based on real user feedback. These features improve user experience but are not blockers for initial adoption.

**Delivers:**
- Service worker caching (offline capability for PWA assets)
- Remembered preferences (localStorage for last channel, volume)
- Mix balance slider (blend original + translation, client-side Web Audio mixing)
- Web UI localization (listener interface in multiple languages)
- Light/dark theme (system-adaptive with manual override)
- Accessibility features (large tap targets, screen reader support, high contrast mode)
- Listener-side audio processing toggles (enable/disable client-side filters)

**Addresses features:** Mix balance slider (differentiator), PWA enhancements, accessibility.

**Needs research:** No. Standard PWA patterns. Web Audio API for mix balance is straightforward.

---

### Phase 7: Desktop App Polish & Distribution
**Rationale:** Production deployment concerns. Code signing prevents OS security warnings. Auto-start eliminates manual launch on Sunday mornings. Update notifications keep installations current.

**Delivers:**
- Code signing (Windows Authenticode, macOS Developer + notarization)
- Auto-start on boot (OS-level startup registration)
- Auto-update notifications (electron-updater, check for new releases)
- Settings import/export UI (JSON file sharing between installations)
- Installer packaging (NSIS for Windows, DMG for macOS, AppImage/deb for Linux)
- Documentation (deployment guide, network requirements, troubleshooting)

**Addresses features:** Auto-start on boot, settings import/export.

**Avoids pitfalls:** Unsigned app warnings (security pitfall).

**Needs research:** No. Electron code signing is well-documented. Platform-specific packaging uses electron-builder.

---

### Phase Ordering Rationale

The research reveals a strict dependency chain that must be respected:

1. **Network → Audio Capture → Streaming → Listeners → Admin → Processing → Polish** is the only viable order.
2. **Cannot build streaming (Phase 2) until capture (Phase 1) is validated.** Attempting to mock AES67 audio leads to false confidence—real Dante networks expose IGMP, PTP, and discovery issues that TCP localhost streams never reveal.
3. **Cannot build listeners (Phase 3) until streaming (Phase 2) works.** WebRTC transport negotiation and media flow must be validated before building client UX.
4. **Admin dashboard (Phase 4) depends on all prior phases.** VU meters need audio capture. Channel management needs streaming. Listener stats need clients.
5. **Audio processing (Phase 5) is additive.** The system streams audio without RNNoise. Processing improves quality but is not a functional blocker.
6. **Polish (Phases 6-7) comes last because it depends on everything being stable.** No point in building mix balance slider if basic audio doesn't work.

**Pitfall-driven ordering:**
- Phase 1 must address pitfalls #1, #2, #6 (network/discovery) before any audio work.
- Phase 2 must address pitfall #4 (worker memory leak recovery) from day one, not as a retrofit.
- Phase 3 must address pitfall #3 (iOS Safari background audio UX) from the start, not discover it post-launch.
- Phase 5 must address noise cancellation music artifacts—Speech/Music mode is not optional.

**Architecture-driven grouping:**
- Phases 1-2 build the server-side pipeline (capture → process → stream).
- Phase 3 builds the client-side consumer (listen → reconnect).
- Phases 4-7 are operational concerns (monitor, control, deploy, maintain).

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 5 (Audio Processing):** RNNoise latency profiling. Integration as GStreamer plugin vs separate process. Voice activity detection algorithms for Auto mode. Limited real-world church audio testing data available.

**Phases with standard patterns (skip research-phase):**
- **Phase 1:** AES67 reception via GStreamer udpsrc is well-documented (Collabora, RAVENNA, aes67-linux-daemon).
- **Phase 2:** mediasoup PlainTransport + GStreamer Opus RTP is documented in official demo.
- **Phase 3:** PWA + mediasoup-client patterns are standard. iOS Safari limitations are known and unfixable.
- **Phase 4:** React + Electron IPC for dashboards is well-documented.
- **Phase 6:** PWA service worker, Web Audio API, and accessibility patterns are standard.
- **Phase 7:** Electron code signing and packaging with electron-builder is well-documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Node.js + Electron + mediasoup + GStreamer are mature, production-proven technologies with extensive documentation. The GStreamer → mediasoup PlainTransport integration pattern is documented in official demos. No experimental or bleeding-edge dependencies. |
| Features | HIGH | Competitive analysis covered 5 major competitors with official product pages, independent reviews, and pricing data. Table stakes features are validated by market consensus. Differentiators (native AES67, self-hosted, open source) are unique and verified. |
| Architecture | MEDIUM-HIGH | Process isolation pattern (GStreamer child processes + in-process mediasoup) is battle-tested. The Electron vs Tauri decision is well-justified by mediasoup's Node.js requirement. One medium-confidence area: PTP clock synchronization on Windows (limited tooling). |
| Pitfalls | MEDIUM-HIGH | Critical pitfalls (#1-6) are verified across authoritative sources (Barix network guides, Audinate Dante docs, mediasoup GitHub issues, WebKit bug tracker). Some areas rely on community reports (worker memory leak details, church WiFi capacity estimates). |

**Overall confidence:** MEDIUM-HIGH

The core technical stack and architectural approach are well-validated. The primary uncertainties are deployment environment variability (church network configurations, WiFi capacity, Windows PTP tooling) rather than fundamental technology choices. These unknowns are addressable through comprehensive diagnostics (Phase 1 network health tool) and graceful degradation (self-healing recovery, adaptive bitrate).

### Gaps to Address

**Gap 1: PTP clock synchronization on Windows**
- **Issue:** Windows lacks native PTPv2 support. Unclear if Dante Controller's PTP master is sufficient or if a separate PTP daemon (ptpd compiled for Windows) is needed.
- **How to handle:** Phase 1 validation on real Windows + Dante hardware. Document findings. May need to ship ptpd.exe as bundled dependency. Alternatively, prioritize AES67 mode where PTP domain is standardized.
- **Confidence:** LOW (sparse Windows-specific AES67 documentation).

**Gap 2: Node.js Single Executable Application maturity**
- **Issue:** Node.js 22 SEA is relatively new. Unknown if it works with native addons (mediasoup has C++ workers) or if fallback to `pkg` is required.
- **How to handle:** Phase 7 packaging. Test SEA first; if issues arise, fall back to `pkg` (more mature but third-party).
- **Confidence:** MEDIUM (built-in feature but limited production reports).

**Gap 3: GStreamer Windows minimal bundling**
- **Issue:** Full GStreamer Windows installer is ~200 MB. Unclear how to create a minimal runtime bundle with only required plugins (opusenc, webrtcdsp, rtpjitterbuffer, udpsrc, rtpL24depay).
- **How to handle:** Phase 7 distribution. Research `gst-build` with meson for stripped runtime. Alternatively, accept full installer dependency and document in deployment guide.
- **Confidence:** MEDIUM (community approaches exist but no authoritative guide).

**Gap 4: Real church WiFi capacity under load**
- **Issue:** Bandwidth calculations are theoretical (N listeners × 128 kbps). Real-world performance with 50-200 phones on church consumer-grade APs is unknown. WiFi contention, AP client limits, and ICE burst traffic during negotiation are variables.
- **How to handle:** Phase 3 pilot testing at churches with varying WiFi quality. Provide bandwidth calculator tool and WiFi recommendations in deployment guide. Implement adaptive bitrate if issues arise.
- **Confidence:** MEDIUM (WebRTC bandwidth is known, but church network variability is high).

**Gap 5: RNNoise latency and quality in church acoustic environment**
- **Issue:** RNNoise latency is documented (~10ms), but quality in church-specific conditions (reverberant spaces, organ, HVAC noise, interpreter booths) is unknown. May need DTLN models or hybrid approaches.
- **How to handle:** Phase 5 testing with real church audio recordings. Provide Speech/Music mode from day one to avoid music artifacts. May defer AI noise cancellation to v2 if quality is insufficient.
- **Confidence:** MEDIUM (RNNoise behavior on speech is well-documented; music/church acoustics less so).

## Sources

### Primary Sources (HIGH confidence)

**Stack & Architecture:**
- Node.js 22 LTS releases — https://nodejs.org/en/about/previous-releases
- Tauri 2.0 documentation and sidecar guide — https://v2.tauri.app/develop/sidecar/
- mediasoup official documentation v3 — https://mediasoup.org/documentation/v3/
- mediasoup npm (3.19.16) — https://www.npmjs.com/package/mediasoup
- GStreamer 1.26.10 release — https://9to5linux.com/gstreamer-1-26-10-released-with-support-for-flac-audio-in-dash-manifests
- GStreamer webrtcdsp plugin docs — https://gstreamer.freedesktop.org/documentation/webrtcdsp/webrtcdsp.html
- Collabora: Receiving AES67 with GStreamer — https://www.collabora.com/news-and-blog/blog/2017/04/25/receiving-an-aes67-stream-with-gstreamer/
- mediasoup Demo GStreamer Broadcaster Script — https://github.com/versatica/mediasoup-demo/blob/v3/broadcasters/gstreamer.sh

**Features & Competitive Analysis:**
- Listen EVERYWHERE product page — https://www.listentech.com/listen-everywhere/
- Listen EVERYWHERE review with latency measurements — https://www.churchproduction.com/gear/review-listen-everywhere-assisted-listening-system/
- LiveVoice for Churches — https://livevoice.io/en/churches
- spf.io Church Translation Solutions — https://www.spf.io/solutions/religious/
- Dante 101 in church context — https://churchfront.com/2025/05/20/dante-101-transform-your-churchs-audio-network/
- Dante vs AES67 comparison — https://help.sennheiser.com/hc/en-us/articles/39094263480857-Dante-AES67-What-s-the-difference

**Pitfalls & Network:**
- Barix: Network Switch Setup for AES67 & Dante — https://help.barix.com/exstreamer4xx/network-switch-setup-for-aes67-dante
- Audinate: AES67 and SMPTE Domains — https://dev.audinate.com/GA/ddm/userguide/1.1/webhelp/content/appendix/aes67_and_smpte_domains.htm
- Shure: Dante and AES67 Clocking In Depth — https://service.shure.com/Service/s/article/dante-and-aes-clocking-in-depth?language=en_US
- RAVENNA: Practical Guide to AES67 Part 2 — https://www.ravenna-network.com/your-practical-guide-to-aes67-part-2-2/
- RAVENNA: AES67 Practical Switch Configuration (PDF) — https://ravenna-network.com/wp-content/uploads/2021/02/AES67-Practical-Switch-configuration.pdf
- mediasoup GitHub: Memory Leak Issue #769 — https://github.com/versatica/mediasoup/issues/769
- WebKit Bug 198277: Audio stops in background — https://bugs.webkit.org/show_bug.cgi?id=198277
- Prototyp Digital: PWAs and Audio Playback — https://prototyp.digital/blog/what-we-learned-about-pwas-and-audio-playback

### Secondary Sources (MEDIUM confidence)

**Community Implementations:**
- philhartung/aes67-monitor (Node.js reference) — https://github.com/philhartung/aes67-monitor
- philhartung AES67 resources — https://hartung.io/2020/07/aes67-resources/
- AES67 Linux Daemon — https://github.com/bondagit/aes67-linux-daemon
- voc/aes67-recorder — https://github.com/voc/aes67-recorder
- Injecting audio into mediasoup using GStreamer (GitHub Gist) — https://gist.github.com/mkhahani/59b9eca043569a9ec3cbec67e4d05811

**Comparisons & Guides:**
- Janus vs mediasoup vs LiveKit comparison — https://trembit.com/blog/choosing-the-right-sfu-janus-vs-mediasoup-vs-livekit-for-telemedicine-platforms/
- Electron vs Tauri (DoltHub) — https://www.dolthub.com/blog/2025-11-13-electron-vs-tauri/
- WebRTC low latency guide — https://www.videosdk.live/developer-hub/webrtc/webrtc-low-latency
- Best audio codec for streaming — https://antmedia.io/best-audio-codec/
- RNNoise demo and learning — https://jmvalin.ca/demo/rnnoise/
- Gcore: Noise Reduction in WebRTC — https://gcore.com/blog/noise-reduction-webrtc
- Datadog: Client-Side Noise Suppression Library — https://www.datadoghq.com/blog/engineering/noise-suppression-library/

**WebRTC & Troubleshooting:**
- WebRTC.ventures: Troubleshooting WebRTC — https://webrtc.ventures/2025/01/troubleshooting-webrtc-applications/
- LiveSwitch: Diagnosing Network Problems — https://www.liveswitch.io/blog/diagnosing-network-problems-with-webrtc-applications
- MDN: WebRTC Connectivity — https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity
- Opus Recommended Settings — https://wiki.xiph.org/Opus_Recommended_Settings

### Tertiary Sources (LOW confidence, needs validation)

- GStreamer Windows minimal bundling approach — No authoritative source found; community forums suggest `gst-build` with meson.
- Node.js SEA with native addon compatibility — Limited documentation; Node.js 22 feature documentation exists but production reports are sparse.
- PTP daemon options for Windows — Community forums mention `ptpd` compiled for Windows, but official Windows PTP support is unclear.

---

*Research completed: 2026-02-05*
*Ready for roadmap: yes*
