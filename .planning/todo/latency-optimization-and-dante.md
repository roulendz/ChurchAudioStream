# Latency Optimization & Dante Input Detection

**Created:** 2026-05-10
**Updated:** 2026-05-14
**Priority:** High
**Status:** TODO

---

## Problem Statement

Current end-to-end latency ~200ms. Target <150ms (ideally 40-60ms).
Dante inputs show as "ASIO LinkPro" instead of individual "Dante RX 1/2" channels.

**Hardware:** i7 8700k, 32GB RAM, MikroTik AP + Router

---

## Platform Matrix

| Platform | Browser Engine | Tauri WebView | Audio Output Path |
|---|---|---|---|
| Windows x86_64 | Chromium (WebView2) | Edge WebView2 | Web Audio API (`AudioContext`) |
| macOS ARM (Apple Silicon) | WebKit | WKWebView | Web Audio API (non-iOS path) |
| macOS Intel | WebKit | WKWebView | Web Audio API (non-iOS path) |
| Linux x86_64 | WebKitGTK | WebKitGTK | Web Audio API (non-iOS path) |
| iOS (listener PWA) | WebKit | N/A (Safari) | `<audio>` element (forced) |
| Android (listener PWA) | Chromium | N/A (Chrome) | Web Audio API |

**Key insight:** Tauri on macOS/Linux = WebKit. Only Windows = Chromium.
All latency-reduction items must work on WebKit or degrade safely.

---

## 1. Latency Breakdown (Current Defaults)

| Component | Current Default | Achievable Min |
|---|---|---|
| Opus frame size | 20ms | 10ms |
| Opus encoding | ~20ms | ~10ms |
| mediasoup forwarding | 1ms | 1ms |
| WebRTC jitter buffer (live mode) | 20ms | 20ms |
| WiFi network | 1ms | 1ms |
| **Total (no AGC)** | **~62ms** | **~43ms** |

Gap between theoretical 62ms and observed 200ms = WiFi buffering + NACK retransmission.

---

## 2. Action Items (Priority Order)

### A. MikroTik AP Tuning (biggest win, ~50-150ms saved)

**Platform scope:** Universal (network layer, affects all clients)

- [ ] Set DTIM interval = 1 (default 2-3 = 200-300ms phone sleep cycles)
- [ ] Disable power save buffering on AP
- [ ] Enable WMM (`wmm-support=enabled`) for QoS
- [ ] Set `multicast-helper=full` to reduce multicast buffering
- [ ] Minimize packet queue / disable simple queues
- [ ] Check frame aggregation settings (`hw-fragmentation-threshold`)

### B. Server-Side Config Changes (~20-40ms saved)

**Platform scope:** Universal (GStreamer + mediasoup, browser-agnostic)

- [ ] Switch `lossRecovery` from `"nack"` to `"plc"` (saves 20-40ms)
  - mediasoup strips NACK from RTP caps before consumer creation
  - Browser never sees NACK capability = no retransmission overhead
  - Tradeoff: slightly worse audio on packet loss, no retransmission delay
- [ ] Set `frameSize` from `"20"` to `"10"` (saves ~20ms)
  - GStreamer `opusenc` setting, all browsers decode any Opus frame size
  - Tradeoff: higher CPU, more packets/sec
- [ ] Ensure `agc.enabled: false` (AGC adds 3000ms — EBU R128 lookahead)
- [ ] Disable DTX in Opus encoder — ensures constant packet flow, no re-ramp

### C. Listener Client Changes (Code) — Cross-Platform

**Files:** `listener/src/hooks/useMediasoup.ts`, `listener/src/lib/audio-engine.ts`

#### C1. Jitter Buffer Hints (Chromium-only, WebKit safe)

Already implemented with feature-detection guards. No changes needed.

| API | Chromium (Windows Tauri, Android) | WebKit (macOS Tauri, Linux Tauri, iOS Safari) |
|---|---|---|
| `playoutDelayHint` | Active (Chrome 84+) | No-op (`"in"` guard) |
| `jitterBufferTarget` | Active (Chrome 124+) | No-op (`"in"` guard) |

Guard pattern (already in `useMediasoup.ts:57-64`):
```ts
if ("playoutDelayHint" in receiver) { rec.playoutDelayHint = hintSeconds; }
if ("jitterBufferTarget" in receiver) { rec.jitterBufferTarget = hintSeconds * 1000; }
```

**No WebKit equivalent exists.** WebKit jitter buffer = uncontrollable.
On clean LAN stays reasonable (~40-80ms). Not a blocker.

#### C2. AudioContext Latency Hint (Universal)

Already implemented in `audio-engine.ts:61-64`:
```ts
new AudioContext({ latencyHint: "interactive", sampleRate: 48000 })
```

| Platform | Effect |
|---|---|
| Chromium | Selects lowest-latency audio output path |
| WebKit (macOS/Linux) | Respected — selects interactive latency class |
| WebKit (iOS) | Respected but `<audio>` element path dominates |

#### C3. iOS `<audio>` Element Latency (Platform Limitation)

iOS WebKit forces `<audio>` element as primary output (volume read-only on iOS).
Internal buffer = 1-3 seconds, **not controllable**.

Current code (`audio-engine.ts`) already handles this:
- iOS detected via `detectIosWebKit()` → routes audio through `<audio>` element
- Non-iOS → `AudioContext.destination` (low-latency bypass)

**No fix possible for iOS `<audio>` buffer.** Apple platform constraint.

#### C4. Chrome-Only Audio Constraints (Skip)

| Constraint | Status | Reason to skip |
|---|---|---|
| `googHighpassFilter: false` | Not implemented | Chrome-only, goog-prefixed, deprecated path |
| `googAutoGainControl: false` | Not implemented | Same — receiver-side, minimal impact |

These are legacy Chrome constraints applied via `RTCPeerConnection` SDP munging.
WebKit ignores them. Mediasoup-client doesn't use SDP offer/answer.
**Not worth implementing** — complexity for single-engine marginal gain.

---

## 3. Cross-Platform Failsafe Checklist

Before shipping any latency change, verify on each platform:

| Check | Windows (Chromium) | macOS ARM (WebKit) | macOS Intel (WebKit) | Linux (WebKitGTK) | iOS Safari | Android Chrome |
|---|---|---|---|---|---|---|
| Audio plays | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| No double-play | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Volume control works | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Visualizer active | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Lock-screen controls | N/A (desktop) | N/A (desktop) | N/A (desktop) | N/A (desktop) | [ ] | [ ] |
| Background playback | N/A (desktop) | N/A (desktop) | N/A (desktop) | N/A (desktop) | [ ] | [ ] |
| Latency <150ms | [ ] | [ ] | [ ] | [ ] | Best effort | [ ] |

### Feature-Detection Pattern (SRP: one guard per API)

All Chromium-only APIs must use property-existence guard:
```ts
if ("apiName" in targetObject) { /* use it */ }
```

Never: `navigator.userAgent` sniffing, `window.chrome` checks, or try/catch around missing APIs.

---

## 4. Dante Input Detection

### Current Behavior
- App shows "ASIO LinkPro" (ASIO driver name)
- Audacity shows "Dante RX 1", "Dante RX 2" (WDM/WASAPI interface names)

### Root Cause
Two discovery paths:
1. `device-enumerator.ts` → `gst-device-monitor-1.0 Audio/Source` → ASIO/WASAPI/DirectSound
2. `sap-listener.ts` → multicast 224.2.127.254:9875 → AES67/Dante network streams

Dante driver exposes ASIO (single multi-channel) + WDM/WASAPI (individual channel pairs).
GStreamer sees ASIO device, names by driver not channel pair.

### Platform Scope
- Windows only (Dante hardware + ASIO driver)
- macOS: Dante Via uses CoreAudio, would appear as regular audio device
- Linux: Dante not supported natively (AES67 multicast only)

### Solution Options
- [ ] Use ASIO source + `selectedChannels` to pick specific Dante channels (already supported)
- [ ] Investigate GStreamer WASAPI enumeration of Dante devices (driver config in Dante Controller)
- [ ] Add friendly naming/aliasing in admin UI for ASIO channels

---

## 5. Industry Context / Best Practices

| Solution | Latency | Notes |
|---|---|---|
| WebRTC (our approach) | 40-100ms achievable | Correct choice for phones on LAN |
| Custom UDP multicast | 20-40ms | Requires native app, not browser |
| Icecast + Opus | 500ms-2s | Not suitable for live |
| AES67 direct | N/A on phones | No mobile AES67 stack |

**Pro church/conference AV:**
- Allen & Heath MixPad: proprietary UDP, ~30ms
- Listen Technologies / Williams Sound: WebRTC-based
- Shure/Sennheiser: hardware <10ms, not phone-based

**Realistic target with all optimizations: 40-60ms on clean LAN WiFi.**

---

## 6. Protocol Notes

- UDP already used (WebRTC/DTLS/SRTP wraps UDP)
- TCP worse (head-of-line blocking, retransmission delays)
- No better protocol for browser-to-phone — WebRTC = standard
- Gains = reducing buffering at every stage, not changing protocol

---

## 7. Expected Latency Per Platform (Post-Optimization)

| Platform | Expected E2E | Bottleneck |
|---|---|---|
| Windows (Chromium WebView2) | 40-60ms | WiFi jitter (controllable via AP tuning) |
| macOS ARM/Intel (WebKit) | 50-80ms | No jitter buffer hint API |
| Linux (WebKitGTK) | 50-80ms | Same WebKit limitation |
| Android Chrome (listener) | 40-60ms | Same as Windows Chromium |
| iOS Safari (listener) | 150-500ms | `<audio>` element internal buffer (Apple limitation) |
