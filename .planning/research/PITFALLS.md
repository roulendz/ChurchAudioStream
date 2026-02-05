# Pitfalls Research

**Domain:** Church Audio Streaming / Dante-to-WebRTC Restreaming
**Researched:** 2026-02-05
**Confidence:** MEDIUM-HIGH (verified across multiple authoritative sources; some areas rely on community reports)

---

## Critical Pitfalls

These cause complete system failure or require architectural rewrites.

### Pitfall 1: IGMP Snooping Misconfiguration Causes Multicast Flooding or Silence

**What goes wrong:** AES67/Dante multicast audio either floods all switch ports (killing WiFi performance for phone listeners) or never reaches the capture host at all. The church WiFi network grinds to a halt because every multicast packet hits every device.

**Why it happens:** IGMP snooping is enabled on the managed switch but no IGMP querier is configured. Or IGMP snooping is disabled entirely, causing multicast to broadcast to all ports. Church networks frequently use consumer-grade or misconfigured switches.

**How to avoid:**
- REQUIRE a managed switch with IGMPv2 snooping AND an IGMP querier enabled on exactly one switch
- Disable forwarding of unregistered multicast traffic
- Isolate AES67/Dante traffic on a dedicated VLAN separate from the WiFi VLAN
- Document switch configuration requirements in deployment guide; provide a network health-check script that validates IGMP querier presence

**Warning signs:**
- WiFi performance degrades when Dante streams are active
- Audio capture works intermittently or not at all
- `tcpdump` on the capture host shows zero multicast packets, or shows packets on all interfaces
- Phones on WiFi experience lag even when no one is listening to the stream

**Phase to address:** Phase 1 (Network/Infrastructure). This must be validated before any audio capture code is written. Ship a network diagnostic tool first.

---

### Pitfall 2: PTP Clock Domain Mismatch Between Dante and AES67

**What goes wrong:** Audio arrives but with clicks, pops, drifting pitch, or periodic dropouts. The captured audio sounds "almost right" but has subtle artifacts that are maddening to debug.

**Why it happens:** Dante uses PTPv1 by default while AES67 uses PTPv2 with domain 0. If you enable AES67 mode on Dante devices, the PTP domains may conflict. Ultimo-based Dante devices cannot act as PTP boundary clocks. The capture host may not be synchronized to the same PTP grandmaster.

**How to avoid:**
- Use Dante Controller to enable AES67 mode on the sending device and verify PTP domain alignment
- Ensure the capture host either syncs to the PTP grandmaster (using `linuxptp` or similar) or accepts that timestamps will need rewriting
- For the simplest path: receive native Dante multicast (not AES67) if Dante Via or Dante Virtual Soundcard is available, avoiding PTP bridging entirely
- If using AES67: verify all devices see the same PTP grandmaster via monitoring tools

**Warning signs:**
- Audio has periodic clicks at regular intervals (clock drift)
- Waveform visualization shows micro-gaps or overlaps at packet boundaries
- PTP monitoring shows different grandmaster IDs on sender vs receiver
- Audio pitch slowly drifts over hours

**Phase to address:** Phase 1 (Audio Capture). Must be resolved during initial Dante/AES67 integration.

---

### Pitfall 3: iOS Safari Kills Background Audio in PWA/Browser

**What goes wrong:** Church members open the stream on their iPhones, lock their screen or switch apps, and audio stops. This is the single most complained-about issue for browser-based audio streaming on iOS.

**Why it happens:** iOS Safari suspends all audio playback when a PWA or browser tab loses foreground focus. There is no reliable workaround. Apple's WebKit team has acknowledged this as a bug (WebKit Bug 198277) but it remains unresolved. Safari also blocks autoplay without user gesture.

**How to avoid:**
- Accept this limitation and design for it: prominent "Tap to Listen" button (never autoplay)
- Implement aggressive reconnection: when the tab regains focus, immediately re-establish the WebRTC connection and resume audio within 1-2 seconds
- Show clear UI state: "Audio paused - tap to resume" when returning from background
- Consider recommending users keep the phone screen on (provide a "keep awake" toggle using Wake Lock API where supported)
- Long-term: evaluate whether a thin native wrapper (Capacitor/React Native) is needed for iOS background audio
- Do NOT promise background audio playback on iOS in any user-facing documentation

**Warning signs:**
- User complaints about audio stopping when they check messages
- Analytics showing very short session durations on iOS
- Testing only on desktop/Android misses this entirely

**Phase to address:** Phase 3 (Client/Listener App). Design the UX around this constraint from day one. Do not defer.

---

### Pitfall 4: mediasoup Worker Memory Leak and Crash in Long-Running Sessions

**What goes wrong:** After hours of streaming (typical Sunday service: 1-3 hours), the mediasoup C++ worker process accumulates memory that is not released even after consumers disconnect. Eventually the worker crashes or the server runs out of memory. Reported with workers consuming 600MB+ for 30-40 participants that persists after all leave.

**Why it happens:** Known memory management issues in mediasoup's C++ worker, particularly around router lifecycle and consumer/producer cleanup. PayloadChannel usage can cause memory corruption. OpenSSL assertion failures have been reported in production.

**How to avoid:**
- Implement worker health monitoring: track RSS memory per worker, restart workers that exceed a threshold (e.g., 200MB for audio-only)
- Create fresh routers for each streaming session (each Sunday service) rather than reusing long-lived routers
- Implement graceful worker rotation: spin up new worker, migrate consumers, shut down old worker
- Pin mediasoup to a known-stable version and test with multi-hour sessions before deploying
- Enable core dumps in production for post-mortem analysis of crashes
- Implement the self-healing requirement: auto-detect worker death and restart within seconds

**Warning signs:**
- Worker RSS memory grows monotonically over time without corresponding consumer count
- Occasional "worker died unexpectedly" errors in logs
- Audio cuts out for all listeners simultaneously (worker crash)
- Server swap usage increases during long services

**Phase to address:** Phase 2 (Streaming Server). Build worker health monitoring and auto-restart from the very first server implementation.

---

### Pitfall 5: Church WiFi Cannot Handle N Concurrent WebRTC Connections

**What goes wrong:** The audio stream works fine with 5 test users. On Sunday morning with 50-200 phones connected, the WiFi access points become saturated. WebRTC ICE connectivity fails, audio stutters, or connections drop entirely.

**Why it happens:** Each WebRTC peer connection generates UDP traffic. Church WiFi is often underpowered consumer-grade equipment. WiFi contention with 50+ devices on a single AP is brutal. Additionally, WebRTC's ICE negotiation phase generates burst traffic that compounds the problem.

**How to avoid:**
- Use mediasoup as SFU so the server sends one stream per listener (not mesh) -- this is already the plan
- Optimize Opus codec settings: use mono, 24kbps-48kbps for speech (not music defaults of 128kbps stereo)
- Implement adaptive bitrate: detect packet loss and reduce quality before connection drops
- On the server side: since all traffic is on LAN, host candidates should work without TURN -- but validate this assumption
- Recommend proper WiFi infrastructure in deployment guide (enterprise APs, 5GHz band, proper channel planning)
- Consider providing a bandwidth calculator tool: N listeners * bitrate = required WiFi throughput

**Warning signs:**
- ICE connection state flaps between "connected" and "disconnected"
- Audio quality degrades as more listeners join
- WebRTC stats show increasing packet loss and jitter
- Some listeners can connect but others cannot (AP capacity reached)

**Phase to address:** Phase 2-3 (Server + Client). Codec optimization in Phase 2, adaptive bitrate and WiFi guidance in Phase 3.

---

### Pitfall 6: AES67/Dante Stream Discovery Fails Silently

**What goes wrong:** The capture application starts but never finds any audio streams. No error is shown. The user assumes the system is broken when actually it is a discovery protocol mismatch.

**Why it happens:** AES67 does not define a single discovery mechanism. Dante uses its own proprietary discovery. AES67 devices may use SAP (Session Announcement Protocol), mDNS/RTSP, or manual SDP configuration. If the capture app expects SAP but the Dante device only advertises via Dante's proprietary protocol, nothing is discovered.

**How to avoid:**
- Support multiple discovery methods: SAP, mDNS, and manual SDP file import
- For Dante specifically: use Dante Controller to enable AES67 mode which enables SAP announcements
- Provide a "manual stream configuration" UI where users can paste an SDP or enter multicast address + port directly
- Implement a network scanner that listens for multicast traffic on common AES67 address ranges (239.69.0.0/16) as a fallback discovery method
- Show clear diagnostic status: "Scanning for streams...", "No streams found - check configuration", with troubleshooting links

**Warning signs:**
- Stream list is empty despite Dante streams being active
- Works with some Dante devices but not others (firmware/configuration differences)
- Users report "it used to work" after firmware updates

**Phase to address:** Phase 1 (Audio Capture). Discovery must be robust from the start; manual fallback is essential.

---

## Technical Debt Patterns

### TD-1: Hardcoded Audio Parameters

**What goes wrong:** Sample rate, bit depth, channel count, and buffer sizes are hardcoded throughout the pipeline. When a church has a 96kHz Dante setup instead of 48kHz, nothing works.

**Prevention:** Define audio format as a configuration object passed through the entire pipeline. AES67 mandates 48kHz/24-bit as baseline but Dante supports 44.1kHz, 48kHz, 88.2kHz, 96kHz. Design for at least 48kHz and 96kHz from the start.

### TD-2: Synchronous Audio Processing Blocking the Pipeline

**What goes wrong:** Noise cancellation or normalization runs synchronously in the audio callback, causing buffer underruns when processing takes longer than the buffer duration.

**Prevention:** Audio capture, processing, and encoding must run in separate threads/workers with lock-free ring buffers between them. Never do heavy processing in the audio device callback. GStreamer handles this with its pipeline threading model, but custom processing elements must respect this.

### TD-3: Monolithic Server Combining Signaling and Media

**What goes wrong:** The signaling server (WebSocket) and media server (mediasoup) are tightly coupled. Cannot scale, update, or restart one without the other.

**Prevention:** Separate signaling (Node.js WebSocket server) from media (mediasoup workers) from the start. They communicate via internal API. This enables restarting crashed media workers without dropping signaling connections.

---

## Integration Gotchas

### IG-1: GStreamer + Node.js Integration Is Fragile

**What goes wrong:** Using GStreamer from a Node.js/Electron process via native bindings (node-gstreamer, gstreamer-superficial) leads to crashes, memory leaks, and difficult debugging. GStreamer's C-based lifecycle does not mesh well with Node.js garbage collection.

**Prevention:** Run GStreamer as a separate process, communicating via pipes, shared memory, or network (RTP). This also enables restarting the GStreamer pipeline without restarting the Electron app. Use GStreamer's `appsrc`/`appsink` or RTP output to feed into the mediasoup pipeline.

### IG-2: Dante Virtual Soundcard Licensing on the Capture Machine

**What goes wrong:** Teams assume they can use Dante Virtual Soundcard (DVS) to capture Dante audio on the streaming PC, but DVS requires a paid license per machine. For an open-source project, this is a non-starter as a required dependency.

**Prevention:** Use AES67 reception (which is an open standard) instead of Dante's proprietary protocol. The `aes67-linux-daemon` project provides open-source AES67 reception. On Windows, tools like the AES67 Monitor or raw multicast reception via GStreamer's `udpsrc` element with SAP/SDP discovery can work. Document clearly that Dante hardware must have AES67 mode enabled.

### IG-3: WebRTC Codec Negotiation Surprises

**What goes wrong:** The server offers Opus but some older mobile browsers negotiate a different codec or fail negotiation entirely. Or the server is configured for stereo Opus but phones request mono, causing audio to play at half speed or with artifacts.

**Prevention:** Configure mediasoup router with explicit Opus codec parameters: mono (channels: 1), 48000 clock rate, and enforce `useinbandfec=1` for forward error correction on lossy WiFi. Test codec negotiation with actual target devices (iPhone Safari, Android Chrome, Android WebView).

### IG-4: Electron/Tauri Native Audio Device Access

**What goes wrong:** The desktop app cannot access the audio capture device (virtual Dante/AES67 soundcard) because of platform-specific audio API differences. WASAPI exclusive mode conflicts with other apps on Windows. ALSA requires the user to be in the `audio` group on Linux. macOS CoreAudio requires specific entitlements.

**Prevention:** Abstract audio device access behind a platform-detection layer. Test on all three platforms early. For Tauri (Rust), use the `cpal` library which handles WASAPI/CoreAudio/ALSA abstraction. For Electron, use Web Audio API or native Node.js addon. Document platform-specific setup requirements.

---

## Performance Traps

### PT-1: The 100ms Latency Budget Is Tighter Than It Looks

**What goes wrong:** Each stage adds latency that was not accounted for. Teams hit 300-500ms and cannot figure out where the time went.

**Typical latency budget breakdown:**
| Stage | Typical Latency | Minimum Achievable |
|-------|----------------|-------------------|
| AES67 network jitter buffer | 5-20ms | 1ms (risky) |
| Audio capture buffer | 5-20ms | ~5ms |
| Noise cancellation (RNNoise) | ~10ms | ~10ms (algorithmic) |
| Opus encoding (20ms frame) | 20ms | 2.5ms (frame size) |
| Network/jitter buffer | 20-50ms | ~10ms on LAN |
| WebRTC decode + playout | 20-40ms | ~15ms |
| **Total** | **80-170ms** | **~43ms** |

**Prevention:**
- Measure latency at EVERY stage from day one. Use timestamps, not guesswork
- Use smaller Opus frame sizes (10ms instead of 20ms) for lower latency at the cost of slightly higher bitrate
- On LAN, reduce jitter buffer aggressively (the network is reliable)
- RNNoise adds a fixed 10ms; budget for this explicitly
- Avoid `decodebin` or auto-plugging GStreamer elements; construct pipeline explicitly
- Profile with GStreamer's latency tracer before optimizing

### PT-2: Noise Cancellation Destroys Music/Singing Audio

**What goes wrong:** RNNoise is trained on speech. When the church choir sings or instruments play, the noise cancellation treats music as noise and aggressively filters it, creating warbling, metallic artifacts, and volume pumping.

**Prevention:**
- Make noise cancellation optional and OFF by default for music-heavy content
- Implement a "Speech" / "Music" / "Auto" mode toggle
- In "Auto" mode, use voice activity detection to enable/disable noise cancellation dynamically
- Consider using RNNoise only during spoken portions (sermons) and bypassing it during music
- Test with actual church audio recordings (speech + music + ambient reverb) not just clean speech samples

### PT-3: Buffer Size Whiplash Between Stability and Latency

**What goes wrong:** Small buffers (128-256 samples) achieve low latency but cause underruns on slower machines. Large buffers (2048+) are stable but add 40ms+ of latency. Developers oscillate between the two.

**Prevention:**
- Start with conservative buffer sizes (512 samples / ~10ms at 48kHz) and measure
- Implement adaptive buffer sizing: start larger, reduce if no underruns detected
- Use separate buffer sizes for capture (can be small) vs processing (can be larger) vs playback (adaptive)
- Monitor underrun count and auto-adjust; expose buffer size in advanced settings
- GStreamer pipeline: set `latency` property on the pipeline and let GStreamer negotiate buffer sizes

---

## Security Mistakes

### SM-1: No Authentication on the Streaming Server

**What goes wrong:** Anyone who discovers the WebSocket signaling URL can connect and listen. In a church context, this may be fine, but it also means anyone can potentially produce streams (if the API is not locked down), or exhaust server resources with fake connections.

**Prevention:**
- Implement simple token-based authentication (even a shared room code is sufficient)
- Separate producer (capture app) authentication from consumer (listener) authentication
- Rate-limit new connections
- Consider whether the stream should be "open to church WiFi only" (check source IP range)

### SM-2: Unsigned Desktop App Triggers OS Security Warnings

**What goes wrong:** Users on Windows see "Windows protected your PC" SmartScreen warning. macOS users cannot open the app at all without right-click > Open workaround. Church IT volunteers give up on installation.

**Prevention:**
- Budget for code signing certificates from the start: Apple Developer ($99/year), Windows Authenticode certificate (~$200-400/year)
- Implement auto-update (electron-updater or Tauri's built-in updater) so users only suffer the install friction once
- For open-source projects: consider using free signing via SignPath.io for open-source Windows apps
- macOS requires notarization in addition to signing
- Document the install process with screenshots for non-technical church volunteers

---

## UX Pitfalls

### UX-1: "No Audio" With No Diagnostic Information

**What goes wrong:** The most common user experience failure. The app shows "Connected" but no audio plays. Could be: wrong audio device selected, stream not discovered, processing pipeline crashed, browser autoplay blocked, or WebRTC connection failed. The user has no way to know which.

**Prevention:**
- Implement audio level meters at every stage: capture input, post-processing, server receive, client playback
- Show connection state machine visually: Discovering > Connecting > Receiving > Playing
- On the listener side: show "Waiting for audio..." vs "Audio active but muted (tap to unmute)" vs "Connection lost, reconnecting..."
- Provide a "Test Audio" button that plays a tone through the pipeline
- Log diagnostics locally for troubleshooting

### UX-2: The Operator Is Not a Sound Engineer

**What goes wrong:** The desktop capture app exposes GStreamer pipeline parameters, codec bitrates, PTP domain settings, and buffer sizes. The church volunteer who runs it on Sunday morning has no idea what any of these mean.

**Prevention:**
- Provide a "Simple" mode that is the default: one button to start streaming, auto-discovers audio source
- Hide all technical settings behind an "Advanced" toggle
- Use presets: "Sermon" (mono, speech optimization, noise cancellation on), "Worship" (stereo, music mode, noise cancellation off), "Full Service" (auto-switching)
- Show system health as a single green/yellow/red indicator, not raw metrics

### UX-3: Listener Must Open Specific URL and Tap Play

**What goes wrong:** Getting 100 church members to type a URL, wait for the page to load, and tap Play is a logistical challenge. Some will misspell it. Some will not tap Play. Some will have their phone on silent.

**Prevention:**
- Generate a QR code displayed on church screens
- Use a short memorable URL (e.g., `listen.ourchurch.org`)
- The landing page should be ONE button: "Listen Now"
- After first visit, offer "Add to Home Screen" as a PWA
- Consider mDNS/Bonjour so `churchaudio.local` works on LAN without DNS setup

---

## "Looks Done But Isn't" Checklist

These items appear to work in development/testing but fail in production church environments:

| Item | Why It Seems Done | Why It Isn't |
|------|-------------------|--------------|
| Audio capture | Works with test tone | Fails with real Dante hardware at 96kHz or with different packet sizes |
| WebRTC streaming | Works with 3 test devices | Fails with 50 phones on congested WiFi |
| Noise cancellation | Clean speech sounds great | Choir/organ sounds terrible; feedback howl when phone is near speaker |
| Reconnection | Works when you pull ethernet cable | Does not handle WiFi roaming between APs, or iOS background/foreground transitions |
| "Low latency" | 80ms in the lab | 400ms on real church WiFi with 50 listeners and a consumer router |
| Cross-platform | Works on dev machine | Fails on church Windows 7 PC with ancient audio drivers |
| Auto-discovery | Works on flat network | Fails when Dante is on VLAN 10 and capture host is on VLAN 20 |
| Volume normalization | Works on constant-level input | Pumps wildly when pastor alternates between whispering and shouting |

---

## Recovery Strategies

For when things go wrong during a live service (self-healing requirements):

### RS-1: mediasoup Worker Crash Recovery
**Detection:** Worker process exit event
**Recovery:** Spawn new worker within 2 seconds, create new router, have listeners auto-reconnect
**User impact:** 2-5 second audio gap, listeners see "Reconnecting..."
**Implementation:** Worker pool with hot standby; client-side auto-reconnect with exponential backoff (but fast first retry)

### RS-2: Audio Capture Pipeline Failure
**Detection:** No audio samples received for >1 second, or GStreamer pipeline state change to ERROR
**Recovery:** Restart GStreamer pipeline, re-discover audio source
**User impact:** 3-10 second gap while pipeline reinitializes
**Implementation:** Watchdog timer on audio sample flow; pipeline restart logic; send silence to server during recovery to keep connections alive

### RS-3: Network Partition Between Capture and Server
**Detection:** WebSocket heartbeat failure to signaling server
**Recovery:** Exponential backoff reconnection; buffer last N seconds of audio for replay on reconnect
**User impact:** Audio stops, resumes when network recovers
**Implementation:** Separate network health monitoring from audio pipeline; reconnect signaling first, then re-establish media transport

### RS-4: WiFi Listener Disconnection
**Detection:** ICE connection state = "failed" or "disconnected"
**Recovery:** Automatic ICE restart, then full reconnection if ICE restart fails
**User impact:** 1-3 second gap for ICE restart, 3-5 seconds for full reconnect
**Implementation:** Monitor `iceconnectionstatechange`; implement three-tier recovery (ICE restart > transport recreation > full page reload)

---

## Pitfall-to-Phase Mapping

| Phase | Pitfalls to Address | Priority |
|-------|-------------------|----------|
| **Phase 1: Network + Capture** | IGMP config (#1), PTP sync (#2), Stream discovery (#6), Dante licensing (IG-2), Audio params (TD-1) | CRITICAL |
| **Phase 2: Processing + Server** | Worker memory (#4), Latency budget (PT-1), Pipeline threading (TD-2), Signaling/media separation (TD-3), GStreamer integration (IG-1) | CRITICAL |
| **Phase 3: Client/Listener** | iOS Safari (#3), WiFi capacity (#5), Codec negotiation (IG-3), Autoplay (SM-1), Background audio, Reconnection (RS-4) | CRITICAL |
| **Phase 4: Desktop App** | Platform audio (IG-4), Code signing (SM-2), Auto-update, Operator UX (UX-2) | HIGH |
| **Phase 5: Polish** | Noise cancellation artifacts (PT-2), Buffer tuning (PT-3), Diagnostics (UX-1), QR/URL (UX-3), Music mode | MEDIUM |
| **All Phases** | Self-healing (RS-1 through RS-4), Latency measurement, Testing with real hardware | ONGOING |

---

## Sources

### AES67/Dante/Network
- [Barix: Network Switch Setup for AES67 & Dante](https://help.barix.com/exstreamer4xx/network-switch-setup-for-aes67-dante)
- [Audinate: AES67 and SMPTE Domains](https://dev.audinate.com/GA/ddm/userguide/1.1/webhelp/content/appendix/aes67_and_smpte_domains.htm)
- [Shure: Dante and AES67 Clocking In Depth](https://service.shure.com/Service/s/article/dante-and-aes-clocking-in-depth?language=en_US)
- [RAVENNA: Practical Guide to AES67 Part 2](https://www.ravenna-network.com/your-practical-guide-to-aes67-part-2-2/)
- [RAVENNA: AES67 Practical Switch Configuration](https://ravenna-network.com/wp-content/uploads/2021/02/AES67-Practical-Switch-configuration.pdf)
- [Crestron: Audio-over-IP Network Design](https://docs.crestron.com/en-us/9045/Content/Topics/AoIP-Network-Design.htm)
- [AES67 Linux Daemon](https://github.com/bondagit/aes67-linux-daemon)
- [Phil Hartung: Relay Dante multicast to AES67](https://gist.github.com/philhartung/87d336a3c432e2ce5452befcad1b945f)

### GStreamer/Audio Processing
- [GStreamer: Latency Design](https://gstreamer.freedesktop.org/documentation/additional/design/latency.html)
- [BytePlus: GStreamer Latency Measurement 2025](https://www.byteplus.com/en/topic/179639)
- [RNNoise: Learning Noise Suppression](https://jmvalin.ca/demo/rnnoise/)
- [Gcore: Noise Reduction in WebRTC](https://gcore.com/blog/noise-reduction-webrtc)
- [Datadog: Client-Side Noise Suppression Library](https://www.datadoghq.com/blog/engineering/noise-suppression-library/)

### mediasoup/WebRTC
- [mediasoup GitHub: Memory Leak Issue #769](https://github.com/versatica/mediasoup/issues/769)
- [mediasoup Forum: Worker Died in v3.16.1](https://mediasoup.discourse.group/t/mediasoup-worker-unexpectedly-died-in-v3-16-1/6741)
- [mediasoup Forum: Audio-Only Applications](https://mediasoup.discourse.group/t/only-audio-applications/3680)
- [WebRTC.ventures: Troubleshooting WebRTC Applications](https://webrtc.ventures/2025/01/troubleshooting-webrtc-applications/)
- [LiveSwitch: Diagnosing Network Problems with WebRTC](https://www.liveswitch.io/blog/diagnosing-network-problems-with-webrtc-applications)
- [MDN: WebRTC Connectivity](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity)
- [Opus Recommended Settings](https://wiki.xiph.org/Opus_Recommended_Settings)

### iOS/PWA/Browser
- [Prototyp Digital: What We Learned About PWAs and Audio Playback](https://prototyp.digital/blog/what-we-learned-about-pwas-and-audio-playback)
- [WebKit Bug 198277: Audio stops in background](https://bugs.webkit.org/show_bug.cgi?id=198277)
- [MagicBell: PWA iOS Limitations](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [Brainhub: PWA on iOS 2025](https://brainhub.eu/library/pwa-on-ios)

### Desktop App/Cross-Platform
- [Electron: Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [CPAL: Cross-Platform Audio Library](https://github.com/RustAudio/cpal)
- [StronglyTyped: Recording System Audio in Electron on macOS](https://stronglytyped.uk/articles/recording-system-audio-electron-macos-approaches)
- [Doyensec: Electron-Updater Signature Bypass](https://blog.doyensec.com/2020/02/24/electron-updater-update-signature-bypass.html)

---
*Pitfalls research for: Church Audio Streaming*
*Researched: 2026-02-05*
