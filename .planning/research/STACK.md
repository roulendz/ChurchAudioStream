# Stack Research

**Domain:** Church Audio Streaming / Dante-to-WebRTC Restreaming
**Researched:** 2026-02-05
**Overall Confidence:** MEDIUM-HIGH

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| **Node.js** | 22.22.x LTS ("Jod") | Backend runtime | LTS until 2027-04. Excellent ecosystem for WebRTC (mediasoup is Node-native). Async I/O fits audio streaming. Avoids Rust complexity for a church volunteer maintainer base. | HIGH |
| **Tauri** | 2.10.x | Desktop GUI shell | 30-40 MB RAM vs Electron's 200-300 MB. Sub-10 MB installer vs Electron's 100+ MB. Native WebView = no bundled Chromium. Sidecar support lets us run Node.js backend as a managed child process. Rust security model is a bonus. | HIGH |
| **mediasoup** | 3.19.x | WebRTC SFU | Purpose-built SFU with C++ media workers. 2x performance over LiveKit OSS per benchmarks. Audio-only config is well-documented. Active maintenance (updated daily on npm). Node.js native API. | HIGH |
| **GStreamer** | 1.26.x (stable) | Audio pipeline (capture, process, encode) | Industry-standard multimedia framework. Native AES67/RTP support. Built-in Opus encoder (opusenc), WebRTC audio processing DSP plugin, and hundreds of audio filters. Cross-platform. 1.26.x is current stable with Opus multichannel improvements. | HIGH |
| **React** | 19.x | Web UI (PWA + Tauri frontend) | Largest ecosystem, most maintainable for open-source contributors. Shared codebase between Tauri frontend and PWA listener app. | HIGH |
| **Vite** | 7.x | Build tooling | Fast HMR for development. vite-plugin-pwa for PWA generation. Official Tauri integration. | HIGH |
| **TypeScript** | 5.7.x | Language | Type safety across frontend and backend. Essential for maintaining audio pipeline configuration types. | HIGH |

### Audio Pipeline Stack

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| **GStreamer webrtcdsp** | (bundled with GStreamer 1.26.x) | Noise suppression, echo cancellation, AGC | Built-in GStreamer plugin wrapping WebRTC Audio Processing Module. No separate build needed. Runs in the GStreamer pipeline natively. Includes NS, AEC, and AGC. | HIGH |
| **RNNoise** | 0.2 | Deep-learning noise suppression (optional enhancement) | Lightweight ML-based noise reduction. Runs on Raspberry Pi. AVX2/SSE4.1 optimized. Use as secondary layer after webrtcdsp for church-specific background noise (HVAC, congregation murmur). Can be loaded as a GStreamer plugin via custom element or ladspa bridge. | MEDIUM |
| **libopus** | 1.6 | Opus encoding | Latest release (Dec 2025) adds bandwidth extension and deep-learning packet loss concealment. GStreamer's opusenc wraps this. 32-64 kbps for speech, 64-128 kbps for music. Algorithmic delay as low as 5 ms. | HIGH |
| **GStreamer RTP stack** | (bundled) | AES67 multicast receive | AES67 is standard RTP with L24/L16 PCM payload. GStreamer's `udpsrc` + `rtpjitterbuffer` + `rtpL24depay` handles this natively. No special library needed. | HIGH |

### AES67/Dante Integration

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| **GStreamer udpsrc** | (bundled) | Multicast RTP receiver | Join multicast group, receive AES67 RTP packets. Standard GStreamer element. | HIGH |
| **linuxptp / ptpd** | OS-level | PTP clock synchronization | AES67 requires IEEE 1588 PTPv2 sync. On Linux, `linuxptp` is the standard. On Windows, Dante Virtual Soundcard handles PTP. On Mac, use `ptpd`. This runs as an OS service, not in-app. | MEDIUM |
| **Dante Controller** | (Audinate proprietary) | Dante device discovery + AES67 enable | Required to enable AES67 mode on Dante devices (firmware 4+). Not part of our stack but a prerequisite. Free download from Audinate. | HIGH |
| **philhartung/aes67-monitor** | latest | Reference implementation / code patterns | Node.js AES67 receiver reference. Uses audify for audio output. Good source for SDP parsing patterns and multicast join logic. Not a dependency, but a pattern reference. | MEDIUM |

### Backend & Signaling

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| **Express** or **Fastify** | Express 4.x / Fastify 5.x | HTTP API server | Signaling server for mediasoup. Serves PWA static files. REST API for dashboard stats. Fastify preferred for performance but Express acceptable for simplicity. | HIGH |
| **Socket.IO** | 4.8.x | WebSocket signaling | Real-time signaling for mediasoup (room join, transport creation, producer/consumer negotiation). Also pushes VU meter data and stats to dashboard. | HIGH |
| **mediasoup-client** | 3.7.x | Browser-side WebRTC client | Official mediasoup client library. Handles transport creation, codec negotiation, and consumer management in the browser. | HIGH |
| **better-sqlite3** | 11.x | Local configuration store | Lightweight, synchronous SQLite for storing channel configs, presets, and session logs. No external DB server needed for a "configure-once" appliance. | MEDIUM |

### Frontend (Shared: Tauri Desktop + PWA)

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| **React** | 19.x | UI framework | Component model fits dashboard (VU meters, channel strips, routing matrix). | HIGH |
| **Tailwind CSS** | 4.x | Styling | Utility-first CSS. Fast to build responsive layouts for both desktop dashboard and mobile PWA. | HIGH |
| **vite-plugin-pwa** | 1.2.x | PWA generation | Zero-config service worker generation. Handles manifest, caching strategies, install prompts. | HIGH |
| **Zustand** | 5.x | State management | Lightweight, no boilerplate. Perfect for real-time audio state (levels, connection status, channel selection). | MEDIUM |
| **Web Audio API** | (browser-native) | Client-side audio rendering | Browser-native. Used with mediasoup-client to play received audio streams. Enables client-side volume control. | HIGH |

### Development Tools

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| **Tauri CLI** | 2.x | Desktop build tooling | `cargo install tauri-cli` or `npm install @tauri-apps/cli` |
| **GStreamer dev libs** | 1.26.x | Build dependency | Required on dev machines. Windows: MSVC installer. Mac: homebrew. Linux: apt/dnf. |
| **Rust toolchain** | 1.84.x+ | Tauri build requirement | `rustup` manages this. Tauri 2.x requires recent Rust. |
| **ESLint** | 9.x | Linting | Flat config format. TypeScript-aware. |
| **Vitest** | 3.x | Testing | Vite-native test runner. Fast, TypeScript-first. |
| **Playwright** | 1.50.x | E2E testing | Cross-browser testing for PWA. |

---

## Architecture Decision: How GStreamer Integrates with Node.js

**Decision: Spawn GStreamer as a child process managed by Node.js.**

This is the critical architecture choice. Three options exist:

### Option A: Node.js native addon (gst-kit / gstreamer-superficial)
- **Pros:** Direct API access, in-process pipeline control
- **Cons:** `gstreamer-superficial` is abandoned (last updated 4+ years ago). `gst-kit` is new and unproven. Native addons are fragile across Node versions and platforms. Crashes in GStreamer crash the whole app.
- **Verdict:** Too risky for cross-platform production use.

### Option B: Spawn `gst-launch-1.0` as child process (RECOMMENDED)
- **Pros:** Battle-tested GStreamer CLI. Pipeline defined as a string. Process isolation (GStreamer crash does not kill Node). Logs and errors via stderr. Can be restarted independently. Works identically on all platforms.
- **Cons:** IPC is via stdin/stdout/named pipes. Less granular runtime control.
- **Verdict:** Best balance of reliability and simplicity. Use named pipes or TCP for audio data passing to mediasoup.

### Option C: Custom Rust binary with GStreamer Rust bindings
- **Pros:** Type-safe, performant, GStreamer's official Rust bindings are well-maintained.
- **Cons:** Doubles the language complexity (Rust + TypeScript). Harder for community contributors. Over-engineered for this use case.
- **Verdict:** Reserve for future optimization if child process approach hits limits.

**Recommended pattern:**
```
Node.js backend
  |-- spawns --> gst-launch-1.0 (AES67 receive + audio processing + Opus encode)
  |-- manages --> mediasoup workers (WebRTC SFU)
  |-- connects --> GStreamer output (via RTP localhost) --> mediasoup plainRtpTransport
```

The GStreamer pipeline outputs Opus-encoded RTP to localhost, which mediasoup ingests via `plainRtpTransport`. This is a well-documented mediasoup pattern for ingesting external media sources.

---

## Architecture Decision: Tauri + Node.js Sidecar

**Decision: Tauri desktop shell with Node.js backend as a sidecar process.**

Tauri 2.x supports sidecar binaries with managed lifecycle. The Node.js backend (bundled via `pkg` or `sea` into a single executable) runs as a Tauri sidecar. Communication via localhost HTTP/WebSocket (same as the PWA uses).

**Why this works:**
- Desktop UI is the same React app as the PWA, just with extra admin panels
- Node.js sidecar handles all audio pipeline management, mediasoup, and signaling
- Tauri shell is thin: just a WebView pointing at `localhost:PORT`
- If Tauri has issues on a platform, the backend still works headless (fallback to browser-only admin)

**Node.js single-executable packaging:**
- Use Node.js 22's built-in Single Executable Application (SEA) feature to package the backend
- Alternative: `pkg` by Vercel (more mature but third-party)

---

## GStreamer Pipeline Design

**Receive AES67 multicast and output Opus RTP:**

```
udpsrc multicast-group=239.x.x.x port=5004 caps="application/x-rtp,media=audio,clock-rate=48000,encoding-name=L24,channels=2"
  ! rtpjitterbuffer latency=20
  ! rtpL24depay
  ! audioconvert
  ! webrtcdsp echo-cancel=false noise-suppression-level=high gain-control=true
  ! audioresample
  ! audio/x-raw,rate=48000,channels=2
  ! opusenc bitrate=64000 frame-size=20 inband-fec=true
  ! rtpopuspay pt=111
  ! udpsink host=127.0.0.1 port=5100
```

This pipeline:
1. Receives AES67 multicast RTP (uncompressed L24 PCM)
2. Dejitters with 20ms buffer (keeps latency low)
3. Applies noise suppression and AGC via webrtcdsp
4. Encodes to Opus at 64kbps with forward error correction
5. Outputs RTP to localhost for mediasoup to consume via plainRtpTransport

**Estimated pipeline latency:** ~25-40ms (jitterbuffer 20ms + Opus frame 20ms + processing overhead)

---

## Latency Budget

Target: <100ms end-to-end (AES67 source to listener phone speaker)

| Stage | Estimated Latency | Notes |
|-------|-------------------|-------|
| AES67 network capture | ~1-2 ms | Local network, multicast |
| GStreamer jitter buffer | 20 ms | Configurable, 20ms is aggressive but feasible on LAN |
| Audio processing (NS, AGC) | ~5 ms | webrtcdsp operates on frames |
| Opus encoding | ~20 ms | 20ms frame size (configurable down to 2.5ms at quality cost) |
| mediasoup SFU forwarding | ~1-2 ms | SFU just forwards, no transcoding |
| WebRTC transport (local WiFi) | ~5-20 ms | Depends on WiFi congestion |
| Browser decode + playout | ~20-40 ms | Opus decode + audio context buffer |
| **Total** | **~72-104 ms** | Achievable on good WiFi |

**To hit <100ms consistently:** Use Opus 10ms frame size (increases bitrate slightly), tune jitter buffer to 10ms on LAN, ensure WiFi is 5GHz with QoS.

---

## Alternatives Considered

| Category | Recommended | Alternative | When to Use Alternative |
|----------|-------------|-------------|-------------------------|
| Desktop framework | **Tauri 2.x** | Electron 33.x | If you need mature plugin ecosystem, Chrome DevTools integration, or team only knows JS. Accept 200+ MB RAM and 100+ MB installer. |
| Desktop framework | **Tauri 2.x** | Qt 6.x (C++) | If you need native VU meters at >60fps or deep OS audio integration. Massive complexity increase. |
| SFU | **mediasoup 3.19.x** | Janus Gateway | If you need SIP interop (phone dial-in) or RTMP ingest. Janus is more modular but less performant. |
| SFU | **mediasoup 3.19.x** | LiveKit | If you want a managed cloud SFU. LiveKit OSS is Go-based, less efficient than mediasoup for self-hosted. |
| Audio pipeline | **GStreamer** | FFmpeg | If pipelines are simple (just transcode). FFmpeg lacks GStreamer's plugin architecture and real-time pipeline control. |
| Audio pipeline | **GStreamer** | PipeWire | Linux-only. Not cross-platform. |
| Noise suppression | **GStreamer webrtcdsp** | Standalone RNNoise | If webrtcdsp quality is insufficient. RNNoise is ML-based and better for non-stationary noise. Requires custom GStreamer element or separate process. |
| State management | **Zustand** | Redux Toolkit | If team prefers Redux patterns. Zustand is simpler for real-time audio state. |
| Database | **better-sqlite3** | PostgreSQL | If multi-instance deployment needed. Overkill for single-appliance use. |
| Node.js packaging | **Node.js SEA** | pkg (Vercel) | SEA is built-in to Node 22 but newer. pkg is more mature. Try SEA first, fall back to pkg. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Electron** | 200+ MB RAM, 100+ MB installer, bundles Chromium. For a "set-and-forget" appliance running on a church PC, resource efficiency matters. | Tauri 2.x (30-40 MB RAM, <10 MB installer) |
| **Python backend** | GIL limits real-time audio processing. Packaging for cross-platform desktop is painful (PyInstaller bundles are huge). Async story weaker than Node.js for WebRTC signaling. | Node.js 22 LTS |
| **Rust-only backend** | Over-engineering for this use case. Contributor barrier too high for church tech volunteers. mediasoup has no Rust API (only Node.js and Rust worker, but API is Node). | Node.js with GStreamer child process |
| **WebRTC peer-to-peer (no SFU)** | P2P means source device must encode N streams for N listeners. CPU melts at 20+ listeners. No server-side monitoring. | mediasoup SFU (source sends 1 stream, SFU forwards to all) |
| **RTMP/HLS streaming** | HLS has 3-10 second latency. RTMP is deprecated in browsers. Neither meets <100ms target. | WebRTC via mediasoup |
| **Dante Virtual Soundcard (DVS)** | Proprietary, per-seat license ($30-50), Windows/Mac only. Creates unnecessary dependency on Audinate licensing for an open-source project. | AES67 multicast (free, open standard, supported by Dante firmware 4+) |
| **Web Audio API for processing** | Client-side processing means every phone does noise suppression. Battery drain. Inconsistent quality. | Server-side GStreamer processing (process once, stream clean audio) |
| **gstreamer-superficial (npm)** | Abandoned. Last update 4+ years ago. Native addon fragility. | Spawn `gst-launch-1.0` as child process |
| **Socket.IO alternatives (raw WS)** | Socket.IO provides reconnection, rooms, namespaces, and fallback transport out of the box. Rolling your own is unnecessary. | Socket.IO 4.x |
| **Next.js / Remix** | SSR frameworks add complexity for what is fundamentally a SPA dashboard + PWA listener. No SEO needed. | Vite + React (SPA) |

---

## Stack Patterns by Variant

### Variant A: Full Desktop Appliance (Primary Target)
```
Tauri 2.x shell
  --> React 19 dashboard (admin UI, VU meters, channel config)
  --> Node.js 22 sidecar (packaged as SEA binary)
       --> GStreamer 1.26 child process (audio pipeline)
       --> mediasoup 3.19 (WebRTC SFU)
       --> Express/Fastify + Socket.IO (signaling + API)
  --> Serves PWA at https://[local-ip]:PORT/listen
```

### Variant B: Headless Server (Fallback / Advanced)
```
Node.js 22 backend (no Tauri, no desktop GUI)
  --> GStreamer 1.26 child process
  --> mediasoup 3.19
  --> Express/Fastify + Socket.IO
  --> React admin dashboard at /admin
  --> React PWA listener at /listen
```

### Variant C: Cloud Relay (Future Extension)
```
Same as Variant B, deployed on cloud VM
  --> Receives forwarded stream from on-premise Variant A
  --> Serves remote listeners outside church WiFi
```

---

## Version Compatibility Matrix

| Component | Minimum Version | Tested Version | Notes |
|-----------|----------------|----------------|-------|
| Node.js | 22.0.0 | 22.22.x | LTS required. mediasoup needs Node-API. |
| GStreamer | 1.24.0 | 1.26.10 | 1.24+ for webrtcdsp improvements. 1.26.x preferred. |
| Tauri | 2.0.0 | 2.10.2 | 2.0+ for sidecar + ACL. |
| Rust | 1.77.0 | 1.84.x | Tauri 2.x minimum. |
| mediasoup | 3.13.0 | 3.19.16 | 3.13+ for plainRtpTransport improvements. |
| React | 18.0.0 | 19.x | 18+ works; 19 preferred for concurrent features. |
| Vite | 6.0.0 | 7.x | 6+ for Tauri plugin compatibility. |
| libopus | 1.4 | 1.6 | 1.6 for BWE and ML-PLC. Bundled with GStreamer. |

---

## Installation

### Development Environment Setup

```bash
# 1. Install Node.js 22 LTS
# Download from https://nodejs.org or use nvm/fnm

# 2. Install Rust toolchain (for Tauri)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# On Windows: download rustup-init.exe from https://rustup.rs

# 3. Install GStreamer development libraries
# Windows: Download MSVC installer from https://gstreamer.freedesktop.org/download/
# Mac: brew install gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly
# Linux (Debian/Ubuntu):
#   sudo apt install libgstreamer1.0-dev gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
#     gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly

# 4. Install Tauri CLI
npm install -g @tauri-apps/cli

# 5. Create project and install dependencies
npm init -y

# Core backend
npm install mediasoup mediasoup-client socket.io express better-sqlite3

# Frontend
npm install react react-dom zustand

# Dev dependencies
npm install -D typescript @types/node @types/react @types/react-dom \
  vite @vitejs/plugin-react vite-plugin-pwa tailwindcss \
  @tauri-apps/api @tauri-apps/cli \
  eslint vitest playwright

# Types for backend
npm install -D @types/express @types/better-sqlite3
```

### GStreamer Verification

```bash
# Verify GStreamer installation and required plugins
gst-inspect-1.0 opusenc       # Opus encoder
gst-inspect-1.0 webrtcdsp     # WebRTC audio processing
gst-inspect-1.0 rtpjitterbuffer  # RTP jitter buffer
gst-inspect-1.0 udpsrc        # UDP multicast source
gst-inspect-1.0 rtpL24depay   # AES67 L24 PCM depayloader

# Test AES67 receive (replace multicast address with your Dante device's)
gst-launch-1.0 udpsrc multicast-group=239.69.x.x port=5004 \
  caps="application/x-rtp,media=audio,clock-rate=48000,encoding-name=L24" \
  ! rtpjitterbuffer ! rtpL24depay ! audioconvert ! autoaudiosink
```

---

## Open Questions for Phase-Specific Research

1. **PTP synchronization on Windows:** Windows does not natively support PTPv2. Need to research whether Dante Controller's PTP master is sufficient, or if a separate PTP daemon (e.g., ptpd compiled for Windows) is needed. LOW confidence.

2. **Node.js SEA maturity:** Node.js Single Executable Applications is relatively new. Need to verify it works with native addons (mediasoup has C++ workers). May need to fall back to `pkg`. MEDIUM confidence.

3. **GStreamer Windows bundle size:** Full GStreamer Windows installer is ~200 MB. Need to research minimal plugin subset bundling for distribution. May need to use `gst-build` with meson to create a stripped runtime. MEDIUM confidence.

4. **mediasoup plainRtpTransport + Opus:** The pattern of GStreamer outputting Opus RTP to mediasoup via plainRtpTransport is documented but needs validation with specific codec parameters (payload type, SSRC, etc.). MEDIUM confidence.

5. **Tauri + localhost sidecar latency:** Need to verify that Tauri WebView connecting to localhost sidecar does not add perceptible UI latency for VU meter updates (target: 30fps = 33ms update cycle). MEDIUM confidence.

---

## Sources

### High Confidence (Official / Authoritative)
- [Node.js 22 LTS releases](https://nodejs.org/en/about/previous-releases)
- [Tauri 2.0 documentation and sidecar guide](https://v2.tauri.app/develop/sidecar/)
- [Tauri 2.10.2 (latest)](https://docs.rs/crate/tauri/latest)
- [mediasoup official documentation v3](https://mediasoup.org/documentation/v3/)
- [mediasoup npm (3.19.16)](https://www.npmjs.com/package/mediasoup)
- [GStreamer 1.26.10 release](https://9to5linux.com/gstreamer-1-26-10-released-with-support-for-flac-audio-in-dash-manifests)
- [GStreamer webrtcdsp plugin docs](https://gstreamer.freedesktop.org/documentation/webrtcdsp/webrtcdsp.html)
- [Opus codec specification / Wikipedia](https://en.wikipedia.org/wiki/Opus_(audio_format))
- [libopus 1.6 release info](https://www.phoronix.com/news/RNNoise-0.2-Released)
- [RNNoise 0.2 with AVX2](https://www.phoronix.com/news/RNNoise-0.2-Released)
- [Collabora: Receiving AES67 with GStreamer](https://www.collabora.com/news-and-blog/blog/2017/04/25/receiving-an-aes67-stream-with-gstreamer/)
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/)

### Medium Confidence (Community / Verified)
- [philhartung AES67 monitor](https://github.com/philhartung/aes67-monitor) - Reference Node.js AES67 implementation
- [philhartung AES67 resources](https://hartung.io/2020/07/aes67-resources/)
- [gst-kit: Modern GStreamer Node.js binding](https://github.com/repugraf/gst-kit)
- [Janus vs mediasoup vs LiveKit comparison](https://trembit.com/blog/choosing-the-right-sfu-janus-vs-mediasoup-vs-livekit-for-telemedicine-platforms/)
- [Tauri vs Electron comparison (DoltHub)](https://www.dolthub.com/blog/2025-11-13-electron-vs-tauri/)
- [WebRTC low latency guide (VideoSDK)](https://www.videosdk.live/developer-hub/webrtc/webrtc-low-latency)
- [Best audio codec for streaming (AntMedia)](https://antmedia.io/best-audio-codec/)

### Low Confidence (Needs Validation)
- GStreamer Windows minimal bundling approach (no authoritative source found)
- Node.js SEA with native addon compatibility (limited documentation)
- PTP daemon options for Windows (community forums only)

---

*Stack research for: ChurchAudioStream*
*Researched: 2026-02-05*
*Researcher note: This stack prioritizes reliability and maintainability for church tech volunteers over raw performance. The Node.js + GStreamer child process pattern trades some elegance for operational simplicity.*
