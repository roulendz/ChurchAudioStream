# Feature Research

**Domain:** Church Audio Streaming / Dante-to-WebRTC Restreaming
**Researched:** 2026-02-05
**Confidence:** HIGH (based on competitor product analysis, official documentation, and cross-referenced community sources)

## Feature Landscape

### Table Stakes (Users Expect These)

These are features that existing solutions (Listen EVERYWHERE, LiveVoice, spf.io, Williams Sound) already provide. Missing any of these makes the product feel incomplete or inferior to commercial alternatives.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Multi-channel audio selection** | Every competitor (Listen EVERYWHERE: 2-16 channels, LiveVoice: unlimited) lets listeners pick a channel. This is the core use case -- language selection. | Medium | Listen EVERYWHERE offers 2/4/8/12/16 channel servers. For a church with 3-5 languages, 8 channels is typical ceiling. |
| **Low-latency streaming (<100ms)** | Lip-sync threshold is ~100ms for in-room listeners. Listen EVERYWHERE achieves 40-120ms avg ~60ms. LiveVoice claims 200ms avg. Noticeable delay destroys the in-room experience. | High | This is the hardest table stake. WebRTC with Opus can achieve this but requires careful pipeline tuning. GStreamer->mediasoup path must be optimized. |
| **Phone-based listening (BYOD)** | All modern competitors use smartphone+headphones model. Eliminates lost/unreturned receivers, capacity limits, and hygiene concerns. Listen EVERYWHERE, LiveVoice, spf.io all use this model. | Medium | PWA or web app approach. No native app installation barrier. |
| **QR code access** | Standard onboarding in all competitors. Congregation scans QR, opens browser, selects channel. spf.io and LiveVoice both use QR prominently. PWA familiarity is at 98% post-pandemic. | Low | Generate QR code in admin UI pointing to the web server URL. Print-ready export is a nice touch. |
| **Volume control per listener** | Every audio app has this. Listeners need independent volume beyond phone hardware volume. | Low | Web Audio API GainNode. Trivial implementation. |
| **Works over existing WiFi** | Listen EVERYWHERE and LiveVoice both use existing church WiFi infrastructure. No special hardware beyond the server. | Low | This is architecturally inherent to the WebRTC approach -- no extra hardware needed. |
| **Automatic reconnection** | WiFi drops in crowded venues are common. Listeners should not have to manually reconnect. Every production-quality streaming app handles this. | Medium | WebRTC ICE restart + exponential backoff reconnect logic. Critical for user trust. |
| **Basic audio processing (normalization/AGC)** | Translation interpreters have wildly varying mic technique and volume. AGC/normalization is expected to make all channels sound consistent. Commercial systems handle this server-side. | Medium | GStreamer has `audioamplify`, `audiodynamic`, and `rglimiter` elements. Server-side processing before encoding. |
| **Admin channel configuration** | Sound techs need to name channels ("English", "Spanish", "Korean"), set input sources, toggle visibility. Listen EVERYWHERE has cloud-based admin. | Medium | Map Dante/AES67 multicast streams to named channels. CRUD for channel config. |
| **Persistent settings** | Configure once, run every week. Churches cannot re-setup the system every Sunday morning. Settings must survive restarts. | Low | JSON config file. Already in PROJECT.md requirements. |
| **Cross-platform desktop support** | Church tech rooms run Windows (majority), Mac, or Linux. Supporting only one OS excludes too many churches. | High | Complexity is in the GUI framework choice, not the feature itself. Electron/Tauri decision. |
| **Church branding on listener UI** | Listen EVERYWHERE offers fully customizable app branding (colors, logos, messages). LiveVoice shows event branding. Churches want their identity on the listener experience. | Low | Configurable logo, name, colors in admin settings. Served to web UI. |

### Differentiators (Competitive Advantage)

These features are not standard across all competitors but would provide meaningful competitive advantage, especially given that ChurchAudioStream is open-source and self-hosted.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Native Dante/AES67 capture (no extra hardware)** | Listen EVERYWHERE requires a separate server box ($967+ for 2-channel). LiveVoice requires manual audio input. ChurchAudioStream captures directly from the Dante network -- zero additional hardware if church already has Dante. This is the primary differentiator. | High | AES67 multicast RTP capture via GStreamer. Dante SDK (proprietary) or AES67 interop mode (open). See STACK.md for details. |
| **Self-hosted / local-first (no cloud dependency)** | Listen EVERYWHERE, spf.io, LiveVoice all require internet connectivity and cloud servers. ChurchAudioStream runs entirely on-premises. No subscription fees, no data leaving the building, no internet dependency. | Medium | This is architecturally inherent. Major selling point for privacy-conscious churches and rural churches with poor internet. |
| **Open source with dual license** | No commercial competitor is open source. Churches can inspect, modify, and contribute. Smaller churches get it free. Larger churches can pay for support. | Low | Licensing decision, not technical complexity. Community engagement is the ongoing effort. |
| **Server-side noise cancellation (AI/ML)** | Listen EVERYWHERE does no audio processing. Most competitors pass through raw audio. RNNoise or DTLN-based noise suppression on the server removes background noise from interpreter booths, HVAC hum, and congregation noise before it reaches listeners. | High | RNNoise (C, WASM-compilable) or DTLN models. Must process in real-time within latency budget. GStreamer plugin integration. |
| **Mix balance slider (original + translation)** | Unique UX: listener can blend original language audio with translation audio. E.g., 70% Spanish translation + 30% original English for context. No competitor offers this granular control. | Medium | Requires two WebRTC streams mixed client-side via Web Audio API. Needs careful UX to avoid confusion. |
| **Real-time VU meters and stream health monitoring** | Commercial systems offer basic admin views. A rich dashboard with per-channel VU meters, listener counts, stream health, latency stats, and connection quality gives sound techs confidence the system is working. | Medium | Server-side audio level analysis + WebSocket push to admin UI. Professional-grade monitoring without professional-grade pricing. |
| **Per-channel EQ and audio processing** | Different interpreter channels may need different processing (e.g., remove low-frequency rumble from one booth, boost clarity on another). Admin-configurable per-channel EQ goes beyond what competitors offer. | Medium | GStreamer equalizer elements in per-channel pipeline. Admin UI for 3-5 band EQ per channel. |
| **PWA with offline capability** | While competitors require their native app (Listen EVERYWHERE, LiveVoice) or a web page (spf.io), a PWA with Add to Home Screen + cached assets + remembered preferences combines the best of both. | Medium | Service worker for asset caching. localStorage for preferences. manifest.json for installability. |
| **Listener-side audio processing toggles** | Let listeners enable/disable noise suppression or adjust audio characteristics from their phone. Hearing-impaired listeners may want different processing than multi-language listeners. | Low | Client-side Web Audio API nodes toggled via UI. Server sends raw + processed, or client applies lightweight filters. |
| **Auto-start on boot** | Sound techs arrive, turn on the computer, system is already running. No manual launch needed. Zero-touch Sunday morning operation. | Low | OS-specific startup registration. Electron/Tauri both support this. |
| **Import/export settings** | Multi-campus churches or churches helping other churches set up can share configurations. | Low | JSON export/import of config file. Already in PROJECT.md. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Captive portal (auto-redirect to app)** | "Listeners should automatically see the app when they connect to WiFi" | Captive portals are fragile across devices, break HTTPS, cause DNS issues, frustrate users, and require router-level configuration that varies wildly. Android and iOS handle captive portals differently and unpredictably. | QR codes prominently displayed + short memorable URL announced from pulpit. Much more reliable. Churches handle their own router config. |
| **Native mobile apps (iOS/Android)** | "We need a real app in the app store" | App store approval process, ongoing maintenance for two platforms, update deployment delays, installation friction (users must download before service). 90% of value achievable with PWA. | PWA with Add to Home Screen. Instant access via QR code. No app store gatekeeping. Automatic updates. |
| **AI-powered automatic translation** | "Can it translate the sermon automatically?" | AI translation quality for religious content is still unreliable (biblical terminology, theological nuance, cultural context). Latency of AI translation (2-5 seconds) breaks lip-sync. Requires internet/cloud. Competes with dedicated products (OneAccord, Breeze Translate, Stenomatic) that do this specifically. | Human interpreters with dedicated Dante channels. The app streams their output. AI translation is a fundamentally different product category. |
| **Video streaming** | "Can we add video too?" | Completely different technical domain (bandwidth, encoding, CDN). Video over local WiFi to 100+ phones would saturate most church networks. Scope creep from audio-focused product into generic streaming platform. | Stay audio-only. Video streaming is a solved problem (YouTube Live, Resi, etc.). Audio-only is the unique value. |
| **Sermon recording/archiving** | "Can we record services for later?" | Adds storage management, playback UI, file format decisions, legal considerations for recorded content. Distracts from real-time streaming core mission. | Mark as v2 feature. For v1, churches can record via their existing DAW/recorder. Could add simple file recording later as an add-on. |
| **Chat/messaging during service** | "People want to interact during the stream" | Moderation burden, distraction from worship, privacy concerns, scope creep into social platform territory. | Out of scope. Churches have other tools for community interaction. |
| **Listener authentication/accounts** | "We want to know who's listening" | Friction kills adoption. Every authentication step loses listeners. Churches are welcoming -- making people create accounts to hear a sermon is antithetical to the mission. | Anonymous listener counts for the admin dashboard. No individual tracking. |
| **Remote/internet streaming** | "Can people listen from home?" | Different architecture (TURN servers, bandwidth costs, CDN), security considerations, internet dependency. Changes the product from a local tool to a hosted service. | v2 feature with optional TURN server configuration. v1 is local network only, which serves 95% of the use case (people in the building). |
| **Bluetooth Auracast output** | "New hearing aids support Auracast, can we broadcast to them?" | Auracast is emerging (standard expected 2027), requires specific transmitter hardware, limited device adoption currently. Adding Bluetooth transmission to a software product crosses into hardware territory. | Monitor Auracast adoption. For v2+, consider optional Auracast transmitter integration if market demands it. The WiFi/WebRTC approach already works with Bluetooth hearing aids via phone pairing. |
| **Hearing loop (T-coil) integration** | "Our church has a hearing loop system" | Hearing loops are purely hardware (electromagnetic induction). Software cannot generate a hearing loop signal. T-coil users can still benefit by using phone+headphones or phone+Bluetooth hearing aid streaming. | Document compatibility: T-coil users can pair their hearing aids to their phone via Bluetooth, then use ChurchAudioStream through the phone. Or use the phone speaker near T-coil hearing aids. |

## Feature Dependencies

```
Dante/AES67 Capture ─────────────────────────────────────────┐
       │                                                      │
       v                                                      │
GStreamer Audio Pipeline                                      │
       │                                                      │
       ├──> Per-channel Audio Processing                      │
       │         │ (noise cancellation, normalization, EQ)    │
       │         │                                            │
       │         v                                            │
       ├──> Opus Encoding                                     │
       │         │                                            │
       │         v                                            │
       └──> mediasoup SFU ──────────────────────────────────┐ │
                 │                                           │ │
                 v                                           │ │
            WebRTC Streaming ──> Listener Web UI             │ │
                 │                    │                       │ │
                 │                    ├──> Channel Selection  │ │
                 │                    ├──> Volume Control     │ │
                 │                    ├──> Mix Balance        │ │
                 │                    ├──> Audio Toggles      │ │
                 │                    └──> PWA Shell          │ │
                 │                                           │ │
                 v                                           │ │
            Admin Dashboard                                  │ │
                 ├──> Channel Config ────────────────────────┘ │
                 ├──> VU Meters / Monitoring ─────────────────┘
                 ├──> Listener Stats
                 ├──> Settings Management
                 └──> QR Code Generation

DEPENDENCY CHAIN (critical path):
  1. Dante/AES67 Capture (must work first -- no audio, no product)
  2. GStreamer Pipeline + Encoding (audio must flow)
  3. mediasoup SFU (audio must reach browsers)
  4. Listener Web UI (users must hear it)
  5. Admin Dashboard (techs must control it)
  6. Audio Processing (quality improvements)
  7. PWA features (polish)
  8. Advanced monitoring (operational excellence)
```

## MVP Definition

### Launch With (v1.0)

These features constitute the minimum viable product. Without any one of these, the product does not solve its core problem.

1. **Dante/AES67 audio capture** -- Receive multicast RTP streams from church Dante network via AES67 interop mode
2. **Multi-channel selection** -- At least 8 configurable channels mapped to audio sources
3. **GStreamer->Opus encoding pipeline** -- Encode captured audio to Opus at ~120kbps
4. **mediasoup WebRTC SFU** -- Distribute streams to multiple simultaneous listeners
5. **Listener Web UI** -- Mobile-first responsive page: welcome screen, channel picker, volume control
6. **QR code generation** -- Admin can generate/display QR code pointing to listener URL
7. **Basic admin dashboard** -- Channel configuration (name, source, visibility), server status, listener count
8. **Basic audio normalization** -- AGC/loudness normalization per channel (server-side)
9. **Auto-reconnection** -- WebRTC ICE restart on disconnect, exponential backoff
10. **Persistent JSON config** -- Settings survive restart
11. **Cross-platform packaging** -- Electron or Tauri builds for Windows, Mac, Linux
12. **Church branding** -- Configurable church name and logo on listener UI

**Rationale:** This gets audio from Dante to phones with channel selection. It works, it is useful, it replaces a $967+ Listen EVERYWHERE server for churches that already have Dante.

### Add After Validation (v1.x)

These features improve quality of life and operational confidence. Add them based on real user feedback after v1.0 is in use at pilot churches.

1. **Server-side noise cancellation** (RNNoise/DTLN) -- Per-channel AI noise suppression
2. **Per-channel EQ** -- 3-5 band equalizer in admin per channel
3. **VU meters and stream health monitoring** -- Real-time audio levels, bitrate, packet loss, latency graphs
4. **Mix balance slider** -- Blend two channels (original + translation) on listener side
5. **PWA enhancements** -- Service worker caching, Add to Home Screen prompt, remembered preferences
6. **Web UI localization** -- Listener interface in multiple languages (matching the channels served)
7. **Light/dark theme** -- System-adaptive with manual override
8. **Accessibility features** -- Large tap targets, screen reader support, high contrast mode
9. **Settings import/export** -- JSON file sharing between installations
10. **Auto-start on boot** -- OS-level startup registration
11. **Update notifications** -- Check for new versions, notify admin (no auto-update)
12. **Listener-side audio processing toggles** -- Enable/disable noise suppression from phone

**Rationale:** These are quality-of-life features. They make the difference between "it works" and "it's great." But launching without them is acceptable -- churches will use it if the core audio works.

### Future Consideration (v2+)

Features that expand scope beyond the local audio restreaming mission. Only pursue after v1.x is stable and adopted.

1. **Sermon recording/archiving** -- Record channels to file for later distribution
2. **Remote/internet streaming** -- Optional TURN server config for off-premises listeners
3. **Multi-site/campus support** -- Synchronized streaming across locations
4. **Auracast Bluetooth output** -- If Auracast adoption reaches critical mass (watch for 2027 standard)
5. **Admin GUI localization** -- Admin interface in languages beyond English
6. **Plugin/extension system** -- Allow community to add audio processors or UI components
7. **Dante SDK native integration** -- If Audinate licensing permits, direct Dante (not just AES67) capture
8. **Analytics dashboard** -- Historical listener trends, usage patterns over time

## Feature Prioritization Matrix

| Feature | User Impact | Technical Risk | Effort | Priority |
|---------|-------------|----------------|--------|----------|
| Dante/AES67 capture | Critical | High (protocol complexity) | High | P0 -- must work |
| GStreamer pipeline + Opus encoding | Critical | Medium (mature tech) | Medium | P0 -- must work |
| mediasoup WebRTC SFU | Critical | Medium (well-documented) | Medium | P0 -- must work |
| Listener Web UI (channel select + volume) | Critical | Low | Medium | P0 -- must work |
| Admin channel configuration | Critical | Low | Medium | P0 -- must work |
| Auto-reconnection | High | Low | Low | P0 -- must work |
| QR code generation | High | Low | Low | P0 -- low effort, high value |
| Basic normalization/AGC | High | Low | Low | P0 -- GStreamer built-in |
| Persistent config | High | Low | Low | P0 -- trivial |
| Church branding | Medium | Low | Low | P0 -- low effort |
| Cross-platform packaging | High | Medium | High | P0 -- must ship |
| Server-side noise cancellation | High | High (latency budget) | High | P1 -- post-launch |
| Per-channel EQ | Medium | Low | Medium | P1 -- post-launch |
| VU meters + monitoring | Medium | Medium | Medium | P1 -- post-launch |
| Mix balance slider | Medium | Medium | Medium | P1 -- differentiator |
| PWA enhancements | Medium | Low | Medium | P1 -- polish |
| Web UI localization | Medium | Low | Medium | P1 -- audience need |
| Accessibility features | Medium | Low | Medium | P1 -- important |
| Light/dark theme | Low | Low | Low | P1 -- polish |
| Settings import/export | Low | Low | Low | P1 -- quick win |
| Auto-start on boot | Medium | Low | Low | P1 -- quick win |
| Listener audio toggles | Low | Low | Low | P1 -- nice to have |
| Recording/archiving | Medium | Medium | High | P2 -- v2 scope |
| Remote streaming | Medium | High | High | P2 -- v2 scope |
| Multi-site support | Low | High | High | P2 -- v2 scope |

## Competitor Feature Analysis

### Hardware-Based Solutions

| Feature | Listen EVERYWHERE | Williams Sound FM+ | Traditional Hearing Loop |
|---------|------------------|--------------------|--------------------------|
| **Delivery method** | WiFi to phone app | FM radio + WiFi to phone | Electromagnetic induction to T-coil |
| **Channels** | 2-16 (server models) | 17 FM frequencies | 1 (single loop) |
| **Latency** | 40-120ms (avg 60ms) | Near-zero (FM) | Near-zero (electromagnetic) |
| **Max listeners** | ~1000 (WiFi dependent) | Unlimited (FM broadcast) | Unlimited (in loop area) |
| **Requires hardware** | Yes ($967+ server) | Yes ($1500+ system) | Yes ($3000+ installation) |
| **Phone required** | Yes (app install) | Optional (FM receivers available) | No (hearing aid only) |
| **Multi-language** | Yes (separate channels) | Limited (FM frequencies) | No |
| **Internet required** | Yes (cloud admin) | No | No |
| **Audio processing** | None | None | None |
| **Branding** | Yes (custom app) | No | N/A |
| **ADA compliance** | Yes | Yes | Yes |

### Software/Cloud Solutions

| Feature | LiveVoice | spf.io | OneAccord (AI) | Breeze Translate (AI) |
|---------|-----------|--------|----------------|----------------------|
| **Delivery method** | App (iOS/Android) | Browser | Browser | Browser |
| **Primary purpose** | Audio streaming + interpretation | Interpretation + captioning | AI translation | AI translation |
| **Latency** | ~200ms | Not specified | 2-5s (AI processing) | 2-5s (AI processing) |
| **Channels** | Unlimited | Multiple | Per-language | Per-language |
| **Requires hardware** | No (cloud) | No (cloud) | No (cloud) | No (cloud) |
| **Internet required** | Yes | Yes | Yes | Yes |
| **Self-hosted option** | No | No | No | No |
| **Audio processing** | Audio delay control | Keyword boosting | N/A | N/A |
| **Cost model** | Subscription | Per-minute usage | Subscription | Subscription |
| **Open source** | No | No | No | No |

### ChurchAudioStream Positioning

| Feature | ChurchAudioStream (v1) | vs. Competitors |
|---------|----------------------|-----------------|
| **Delivery method** | PWA in browser | Same as spf.io, better than requiring app install |
| **Audio source** | Direct Dante/AES67 capture | UNIQUE -- no competitor does this |
| **Latency target** | <100ms | Better than LiveVoice (200ms), competitive with Listen EVERYWHERE (60ms) |
| **Internet required** | No (local-first) | UNIQUE -- all cloud competitors require internet |
| **Cost** | Free (open source) | UNIQUE -- competitors are $967+ hardware or subscription |
| **Audio processing** | Noise cancellation + normalization + EQ | UNIQUE -- no competitor processes audio |
| **Self-hosted** | Yes | UNIQUE -- no competitor offers self-hosting |
| **Mix balance** | Original + translation blend | UNIQUE -- no competitor offers this |
| **Monitoring** | VU meters, health, stats | Better than any competitor admin panel |
| **Trade-off** | Requires Dante-equipped church | Limits addressable market to Dante churches |
| **Trade-off** | Requires local technical setup | Cloud competitors are easier initial setup |

### Key Competitive Insights

1. **The gap ChurchAudioStream fills:** No product captures Dante audio and streams it to phones via WebRTC. Churches currently need Listen EVERYWHERE ($967+) or build custom solutions with multiple tools.

2. **Latency is the battleground:** For in-room listening (hearing assistance, translation while watching the speaker), sub-100ms is critical. Cloud solutions (LiveVoice at 200ms, AI translation at 2-5s) are noticeably delayed. Only Listen EVERYWHERE and ChurchAudioStream target this latency range.

3. **Local-first is a genuine differentiator:** Rural churches with poor internet, privacy-conscious congregations, and churches in countries with restricted internet all benefit from a system that works without cloud connectivity.

4. **Audio processing is an unserved need:** No competitor processes audio (noise cancellation, normalization, EQ). Interpreter booths are noisy, mic technique varies, and translation channels often sound worse than the main mix. Server-side processing is a real quality improvement.

5. **Open source fills a trust gap:** Churches are non-profits. Subscription fatigue is real. An open-source tool that churches can run themselves, with optional paid support, aligns with church budgeting and values.

## Sources

### Competitor Products (HIGH confidence)
- [Listen EVERYWHERE - Listen Technologies](https://www.listentech.com/listen-everywhere/) -- Official product page
- [Listen EVERYWHERE Review - Church Production Magazine](https://www.churchproduction.com/gear/review-listen-everywhere-assisted-listening-system/) -- Independent review with latency measurements
- [Williams AV Assistive Listening Solutions](https://williamsav.com/assistive-listening/) -- Official product page
- [LiveVoice for Churches](https://livevoice.io/en/churches) -- Official product page
- [spf.io Church Translation Solutions](https://www.spf.io/solutions/religious/) -- Official product page
- [OneAccord AI Church Translation](https://www.oneaccord.ai/) -- Official product page
- [Breeze Translate](https://breezetranslate.com/) -- Official product page

### Audio Technology (HIGH confidence)
- [Dante 101 - ChurchFront](https://churchfront.com/2025/05/20/dante-101-transform-your-churchs-audio-network/) -- Dante in church context
- [Dante vs AES67 - Sennheiser](https://help.sennheiser.com/hc/en-us/articles/39094263480857-Dante-AES67-What-s-the-difference) -- Protocol comparison
- [AES67 Linux Daemon](https://github.com/bondagit/aes67-linux-daemon) -- Open source AES67 capture
- [Inferno - Unofficial Dante Implementation](https://github.com/teodly/inferno) -- Open source Dante receiver
- [AES67 Web Monitor](https://aes67.app/) -- AES67 monitoring tools

### WebRTC and Audio Processing (HIGH confidence)
- [Noise Reduction in WebRTC - Gcore](https://gcore.com/blog/noise-reduction-webrtc) -- RNNoise integration
- [Client-side Noise Suppression - Datadog](https://www.datadoghq.com/blog/engineering/noise-suppression-library/) -- DTLN implementation
- [WebRTC SFU Architecture](https://www.metered.ca/blog/webrtc-sfu-the-complete-guide/) -- SFU patterns
- [mediasoup Overview](https://mediasoup.org/documentation/overview/) -- SFU library documentation

### Accessibility and Standards (MEDIUM confidence)
- [ADA Compliance and Assistive Listening - Listen Technologies](https://www.listentech.com/top-questions-about-ada-compliance-and-assistive-listening-answered/) -- ADA requirements
- [Acceptable Audio Latency - AV Latency.com](https://avlatency.com/recommendations/acceptable-audio-latency-lip-sync-error/) -- Latency thresholds
- [Bluetooth Auracast for Assistive Listening](https://www.bluetooth.com/auracast/assistive-listening/) -- Emerging standard
- [Auracast Market Impact 2026](https://www.bluetooth.com/blog/how-auracast-broadcast-audio-is-expanding-audio-streaming-and-a-look-at-the-market-impact-it-could-have-in-2026-and-beyond/) -- Auracast adoption timeline

### Church Production Context (MEDIUM confidence)
- [Church Livestreaming Issues - Resi](https://resi.io/blog/how-to-prepare-for-combat-common-church-livestreaming-issues/) -- Common problems
- [Church Audio Streaming Best Practices - ChurchTechToday](https://churchtechtoday.com/ready-your-church-audio-for-live-streaming/) -- Audio quality guidance
- [Church PWAs - Kingdom One](https://www.kingdomone.co/church-progressive-web-apps-the-third-option/) -- PWA in church context

---
*Feature research for: Church Audio Streaming / Dante-to-WebRTC Restreaming*
*Researched: 2026-02-05*
