# Latency Optimization & Dante Input Detection

**Created:** 2026-05-10
**Priority:** High
**Status:** TODO

---

## Problem Statement

Current end-to-end latency is ~200ms. Target is <150ms (ideally 40-60ms).
Dante inputs show as "ASIO LinkPro" instead of individual "Dante RX 1/2" channels.

**Hardware:** i7 8700k, 32GB RAM, MikroTik AP + Router

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

### A. MikroTik AP Tuning (biggest single win, ~50-150ms saved)

- [ ] Set DTIM interval = 1 (default 2-3 causes 200-300ms sleep cycles for phones)
- [ ] Disable power save buffering on AP
- [ ] Enable WMM (`wmm-support=enabled`) for QoS
- [ ] Set `multicast-helper=full` to reduce multicast buffering
- [ ] Minimize packet queue / disable simple queues
- [ ] Check frame aggregation settings (`hw-fragmentation-threshold`)

### B. App Config Changes (~20-40ms saved)

- [ ] Switch `lossRecovery` from `"nack"` to `"plc"` (saves 20-40ms)
  - File: channel config → `lossRecovery: "plc"`
  - Tradeoff: slightly worse audio on packet loss, but no retransmission delay
- [ ] Set `frameSize` from `"20"` to `"10"` (saves ~20ms)
  - File: channel config → `processing.opus.frameSize: "10"`
  - Tradeoff: slightly higher CPU, more packets/sec
- [ ] Ensure `agc.enabled: false` (AGC adds 3000ms due to EBU R128 lookahead)

### C. Listener App Changes (Code)

- [ ] Add `playoutDelayHint = 0.01` on received MediaStreamTrack (Chrome 94+)
  - Hints Chrome to use minimum 10ms playout buffer
  - File: `listener/src/` wherever track is received from consumer
- [ ] Disable Chrome audio processing on receiver:
  - `googHighpassFilter: false`
  - `googAutoGainControl: false`
- [ ] Disable DTX (discontinuous transmission) — ensures constant packet flow

---

## 3. Dante Input Detection

### Current Behavior
- App shows "ASIO LinkPro" (the ASIO driver name)
- Audacity shows "Dante RX 1", "Dante RX 2" (WDM/WASAPI interface names)

### Root Cause
Two separate discovery paths:
1. `device-enumerator.ts` → `gst-device-monitor-1.0 Audio/Source` → finds ASIO/WASAPI/DirectSound
2. `sap-listener.ts` → multicast 224.2.127.254:9875 → AES67/Dante network streams

Dante driver exposes both ASIO (single multi-channel device) and WDM/WASAPI (individual channel pairs). GStreamer sees the ASIO device but names it by driver, not by channel pair.

### Solution Options
- [ ] Use ASIO source + `selectedChannels` config to pick specific Dante channels (already supported)
- [ ] Investigate if GStreamer also enumerates the Dante WASAPI devices (may need driver config in Dante Controller)
- [ ] Consider adding friendly naming/aliasing in admin UI for ASIO channels

---

## 4. Industry Context / Best Practices

| Solution | Latency | Notes |
|---|---|---|
| WebRTC (our approach) | 40-100ms achievable | Correct choice for phones |
| Custom UDP multicast | 20-40ms | Requires native app, not browser |
| Icecast + Opus | 500ms-2s | Not suitable for live |
| AES67 direct | N/A on phones | No mobile AES67 stack |

**What pro church/conference AV uses:**
- Allen & Heath MixPad app: proprietary UDP, ~30ms
- Listen Technologies / Williams Sound: WebRTC-based
- Shure/Sennheiser: hardware, <10ms but not phone-based

**Realistic target with all optimizations: 40-60ms on clean LAN WiFi.**

---

## 5. Protocol Notes

- UDP is already used (WebRTC/DTLS/SRTP wraps UDP)
- TCP would be worse (head-of-line blocking, retransmission delays)
- No better protocol exists for browser-to-phone — WebRTC is the standard
- The gains are in reducing buffering at every stage, not changing protocol
