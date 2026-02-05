# ChurchAudioStream

## What This Is

A cross-platform desktop application (Windows, Mac, Linux) that captures Dante/AES67 audio channels from a church sound system, processes them with noise cancellation and normalization, and serves them via a local WebRTC-based web server. Congregation members connect with their phones over WiFi to a Web UI where they choose which language stream to listen to — for multilingual sermon translations and hearing aid assistance.

## Core Value

Enable multilingual church members and hearing-impaired listeners to hear sermons in their language through their own phones, using the church's existing Dante audio infrastructure — with near-zero latency and zero friction.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Capture Dante/AES67 audio channels on the local network
- [ ] Encode audio to Opus via GStreamer pipeline
- [ ] Stream audio to listeners via WebRTC (mediasoup SFU) with <100ms latency
- [ ] Cross-platform desktop GUI (Windows, Mac, Linux) with dashboard + sidebar layout
- [ ] Channel configuration: display name, audio processing settings, visibility, ordering
- [ ] Per-channel audio processing: noise cancellation, normalization, EQ (server-side)
- [ ] Real-time monitoring: VU meters, listener counts, server status, stream health, statistics/graphs
- [ ] Persistent settings with import/export capability
- [ ] Web server on configurable IP:port serving the listener Web UI
- [ ] Web UI: welcome screen with church branding, then language/channel selection
- [ ] Listener controls: volume, channel switch, mix balance (original + translation), audio processing toggles
- [ ] PWA support (Add to Home Screen, remembers last settings)
- [ ] Web UI localization (multilingual interface)
- [ ] Light/dark theme with system-adaptive auto-detection and manual override
- [ ] Accessibility: large tap targets, minimal UX, screen reader support, accessibility toggle
- [ ] Self-healing: auto-reconnect, robust error handling for all connections
- [ ] Settings stored in config file (JSON or platform-appropriate format)
- [ ] Optional auto-start on boot (configurable in settings)
- [ ] Update notifications (notify-only, admin chooses when to install)
- [ ] Local network by default, optional internet exposure configuration

### Out of Scope

- Recording/archiving sermons — v2 feature
- Remote streaming (beyond local network) — v2 feature
- Multi-site/campus support — future consideration
- Admin GUI localization — English-only for v1
- Captive portal implementation — churches handle router config themselves
- Mobile native apps — PWA covers mobile experience
- User authentication for listeners — open access, church is welcoming
- Real-time chat or messaging — not core to audio streaming mission

## Context

- **Dante/AES67:** Church already has separate Dante channels per language (e.g., English, Spanish, main mix). The app runs on a machine connected to the Dante network and receives AES67 multicast streams directly.
- **Audio pipeline:** GStreamer captures and encodes to Opus (~120kbps). mediasoup SFU distributes WebRTC streams to multiple listeners efficiently.
- **Network:** Web server runs on the machine's IP + configurable port. Churches with a network admin can set up a local domain on their router. No captive portal — churches use QR codes or announce the URL.
- **Target users:** Church sound technicians (admin GUI), congregation members of all ages and tech levels (Web UI).
- **Listener experience:** Connect to church WiFi → open URL/scan QR → welcome screen → pick language → listen. Minimal steps. Can listen to translation only, original only, or mixed with adjustable balance.
- **Audio quality:** Server-side noise cancellation and normalization (like Discord-style cleanup). Admin configures per channel, listeners can override/disable filters from Web UI.
- **Open source:** Dual-license model to be researched — open source for community use, with option for churches to purchase/donate for support.

## Constraints

- **Cross-platform:** Must run on Windows, Mac, and Linux — use a cross-platform GUI framework (research best option)
- **Latency:** Under 100ms end-to-end for lip-sync when listening in the same room as the speaker
- **Local-first:** Must work entirely on local network without internet dependency
- **Open source:** Architecture and dependencies must be compatible with open-source licensing
- **Dante licensing:** Explore Dante SDK licensing for native integration; AES67 as open-source fallback
- **Scalability:** Must handle variable number of simultaneous listeners (small to large churches)
- **Simplicity:** Configure once, run every service — non-technical church staff must be able to operate it

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| WebRTC via mediasoup SFU | Low latency, handles many listeners, browser-native | — Pending |
| GStreamer for audio capture/encoding | Open source, mature, handles Dante/AES67 + Opus encoding | — Pending |
| Opus codec | Low latency, good quality at low bitrates, WebRTC-native | — Pending |
| Dashboard + sidebar admin layout | Rich monitoring needs (VU meters, stats, graphs) with clear navigation | — Pending |
| PWA for mobile experience | No app store needed, works on all phones, remembers settings | — Pending |
| JSON config files | Cross-platform, human-readable, easy import/export | — Pending |
| No listener authentication | Church is welcoming, minimal friction to start listening | — Pending |
| Tauri 2.x + Node.js sidecar | Lower RAM (150-250MB vs 400-600MB Electron), native feel, Node.js sidecar runs mediasoup/Express/WebSocket. Admin GUI connects to server via same API as Web UI. | — Pending |
| Dante/AES67 + local audio device support | Both input methods: AES67 multicast for Dante churches, system audio devices for non-Dante churches. Broadens audience. | — Pending |

---
*Last updated: 2026-02-05 after framework decision and requirements scoping*
