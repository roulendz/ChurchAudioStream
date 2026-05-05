# Audio Latency: Measurement & Reduction Research

**Researched:** 2026-05-04
**Domain:** WebRTC audio latency (GStreamer -> mediasoup -> Browser)
**Confidence:** HIGH (verified against codebase + W3C specs + GStreamer docs)

## Summary

The 4-second latency gap (vs 43ms theoretical) almost certainly comes from **two main culprits**: unbounded `queue` elements in GStreamer tee branches, and the browser's adaptive jitter buffer growing unchecked. The codebase has bare `queue` elements (default: 200 buffers / 10MB / 1 second -- whichever first) in the tee branches feeding opusenc/udpsink. Combined with `sync=true` on udpsink + `clocksync sync=true` on file sources, the pipeline clock can drift and queues accumulate. On browser side, no `jitterBufferTarget` is set, so Chrome's NetEQ adapts freely (can grow to seconds under any perceived jitter).

**Primary recommendation:** Add bounded queues + set `jitterBufferTarget` on receiver + build getStats()-based measurement to validate fixes quantitatively.

---

## 1. Measurement Approaches (ranked by reliability/effort)

### Approach A: WebRTC getStats() Jitter Buffer Metrics (BEST FIRST STEP)

**Effort:** Low (30 min). **Reliability:** HIGH for browser-side delay.

The listener already calls `consumer.getStats()` in `connection-stats.ts` but does NOT extract jitter buffer metrics. Add these fields from `inbound-rtp` report:

```typescript
// In captureConnectionStats(), inside the inbound-rtp block:
if (report.type === "inbound-rtp" && report.kind === "audio") {
  // ... existing code ...

  // NEW: Jitter buffer metrics
  const jbDelay = report.jitterBufferDelay ?? 0;        // cumulative seconds
  const jbEmitted = report.jitterBufferEmittedCount ?? 0; // cumulative samples
  const jbTarget = report.jitterBufferTargetDelay ?? 0;  // cumulative seconds

  // Current average jitter buffer delay:
  const currentJbDelayMs = jbEmitted > 0
    ? (jbDelay / jbEmitted) * 1000
    : 0;

  // Current target:
  const currentJbTargetMs = jbEmitted > 0
    ? (jbTarget / jbEmitted) * 1000
    : 0;
}
```

**Formula** [VERIFIED: W3C webrtc-stats spec]: `avgJitterBufferDelay = jitterBufferDelay / jitterBufferEmittedCount`

If this shows 2-4 seconds, the problem is browser-side buffering. If it shows <100ms, the problem is upstream (GStreamer queues).

### Approach B: Test Tone Injection + Detection (GOLD STANDARD)

**Effort:** Medium (2-4 hours). **Reliability:** TRUE end-to-end.

1. Inject a short 1kHz tone burst into GStreamer pipeline at known timestamp
2. On listener, use AnalyserNode (already wired!) to detect the tone
3. Compute delta = detection_time - injection_time

```typescript
// Listener side (already has AnalyserNode connected):
function detectTone(analyser: AnalyserNode, targetFreqHz: number): boolean {
  const data = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(data);
  const binWidth = (48000 / 2) / analyser.frequencyBinCount; // Nyquist / bins
  const targetBin = Math.round(targetFreqHz / binWidth);
  // Tone present if target bin is 20dB above average
  const avg = data.reduce((s, v) => s + v, 0) / data.length;
  return data[targetBin] - avg > 20;
}
```

**Clock sync problem:** Sender and listener are different machines. Solutions:
- Use WebSocket round-trip to estimate clock offset (precision ~5-20ms on LAN)
- Or: inject tone triggered by WS message, measure from WS receipt to audio detection

### Approach C: NTP-Synced Timestamp in RTP Header Extension

**Effort:** High (8+ hours). **Reliability:** High but complex.

mediasoup supports `http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time`. Could embed sender timestamp in RTP extension, read on browser via `RTCRtpReceiver.getSynchronizationSources()`. Complex setup, overkill for debugging.

### Approach D: Loopback Physical Test

**Effort:** Low. **Reliability:** Human-perceptible but imprecise.

Play a click through the system, hold phone next to speaker, count delay by ear. Good for "is it still 4s?" sanity check. Not for precise measurement.

---

## 2. Likely Root Causes for 4-Second Latency

### Cause 1: UNBOUNDED TEE QUEUES (HIGH probability) [VERIFIED: codebase]

```typescript
// pipeline-builder.ts lines 153-154:
`t. ! queue ! ${meteringElements} `
`t. ! queue ! ${opusRtpChain}`
```

These bare `queue` elements use GStreamer defaults: **max 200 buffers OR 10MB OR 1 second**. BUT -- the `queue` feeding opusenc/udpsink is downstream of the tee. If opusenc or udpsink stalls briefly (CPU spike, network hiccup), the queue fills to its 1-second cap. After the stall clears, old buffered data streams out first, creating a permanent latency offset that never recovers.

**Worse with file sources:** `clocksync sync=true` paces the file to real-time, but `decodebin` can pre-decode faster than real-time, and the bare queue between tee and encoder accumulates this burst.

**Fix:**
```
t. ! queue max-size-time=50000000 max-size-bytes=0 max-size-buffers=0 leaky=downstream ! ${opusRtpChain}
```
This caps queue at 50ms and drops old data if it overflows. Exactly what `LIVE_CAPTURE_QUEUE_SEGMENT` already does for capture sources -- just not applied to tee branches.

### Cause 2: BROWSER JITTER BUFFER GROWTH (HIGH probability)

Chrome's NetEQ jitter buffer starts at ~20ms but GROWS adaptively if it detects:
- Packet jitter (variance in inter-arrival times)
- Brief packet loss followed by retransmission bursts
- Clock drift between sender and receiver

With no `jitterBufferTarget` set, it can grow to **seconds**. On mobile (WiFi + screen off + background app), this is especially aggressive.

**Evidence:** The listener code sets NO constraints on the receiver. No `playoutDelayHint`, no `jitterBufferTarget`.

**Fix:**
```typescript
// After consuming:
const consumer = await transport.consume({...});
const receiver = consumer.rtpReceiver;
if (receiver && 'jitterBufferTarget' in receiver) {
  // @ts-expect-error -- not in TS types yet
  receiver.jitterBufferTarget = 50; // 50ms target
}
// Chrome legacy API:
if (receiver && 'playoutDelayHint' in receiver) {
  // @ts-expect-error
  receiver.playoutDelayHint = 0.05; // 50ms in seconds
}
```

### Cause 3: `sync=true` ON UDPSINK WITH FILE SOURCES (MEDIUM probability)

`udpsink sync=true` means: "wait until buffer's running-time matches pipeline clock before sending". For live sources (WASAPI), this is correct -- it prevents burst-sending.

For FILE sources, the pipeline uses `clocksync sync=true` to pace playback to real-time. This is CORRECT design. However, the combo means:
1. `clocksync` paces buffers into the pipeline at real-time rate
2. They pass through tee + unbounded queue
3. `opusenc` processes them (adds frame-size latency)
4. `udpsink sync=true` waits AGAIN for the clock

This double-sync is redundant and can cause the udpsink to hold buffers waiting for their timestamp to arrive. If any upstream processing adds latency to the buffer timestamps, udpsink delays sending proportionally.

**Fix:** Change udpsink to `sync=false` for file sources (clocksync already handles pacing), OR remove clocksync and keep udpsink sync=true. Don't have BOTH gating output.

### Cause 4: HTMLAudioElement INTERNAL BUFFERING (LOW-MEDIUM probability)

HTMLAudioElement has its own internal buffer for MediaStream sources. On mobile Chrome/Safari, this can add 100-500ms. However, 4 seconds is unlikely from this alone.

**Already mitigated somewhat:** The code uses `autoplay=true` and starts playing immediately.

### Cause 5: CONSUMER RESUME DELAY (LOW probability)

mediasoup consumer starts paused. After `resumeConsumer`, server starts forwarding RTP. If there's a delay between `transport.consume()` and the resume request, packets queue server-side. The codebase does resume immediately after consume, so this is probably <100ms.

---

## 3. Fixes to Try (ordered by impact/effort)

| Priority | Fix | Expected Impact | Effort |
|----------|-----|-----------------|--------|
| 1 | **Bound tee queues** (50ms, leaky=downstream) | Eliminate queue accumulation, prevent >50ms of GStreamer-side buffering | 15 min |
| 2 | **Set jitterBufferTarget** on receiver (50ms) | Prevent browser jitter buffer from growing unbounded | 20 min |
| 3 | **Remove `sync=true` from udpsink** (for file sources) | Eliminate double-pacing; clocksync alone handles timing | 10 min |
| 4 | **Add getStats() latency dashboard** | Measure actual jitter buffer size to validate fixes | 1 hour |
| 5 | **Remove `sync=true` from udpsink** (for ALL sources) | Live sources already produce real-time; udpsink sync is redundant with live clock | 10 min (test carefully) |
| 6 | **Add `leaky=downstream` to ALL queues in pipeline** | Belt-and-suspenders: no queue anywhere can accumulate | 10 min |

### Fix 1 Detail: Bounded Tee Queues

```typescript
// Replace in buildProcessingAndOutputTail():
// OLD:
`t. ! queue ! ${opusRtpChain}`
// NEW:
`t. ! queue max-size-time=50000000 max-size-bytes=0 max-size-buffers=0 leaky=downstream ! ${opusRtpChain}`

// Also the metering branch (less critical but consistent):
`t. ! queue max-size-time=50000000 max-size-bytes=0 max-size-buffers=0 leaky=downstream ! ${meteringElements}`
```

### Fix 2 Detail: jitterBufferTarget

```typescript
// In useMediasoup.ts, after transport.consume():
const consumer = await transport.consume({
  id: consumeResponse.consumerId,
  producerId: consumeResponse.producerId,
  kind: consumeResponse.kind,
  rtpParameters: consumeResponse.rtpParameters,
});

// Set low-latency jitter buffer target
const receiver = consumer.rtpReceiver;
if (receiver) {
  // Standard API (Chrome 111+, Firefox planned)
  if ('jitterBufferTarget' in receiver) {
    (receiver as any).jitterBufferTarget = 50; // ms
  }
  // Legacy Chrome API (Chrome 107-110)
  if ('playoutDelayHint' in receiver) {
    (receiver as any).playoutDelayHint = 0.05; // seconds
  }
}
```

### Fix 3 Detail: udpsink sync=false

For file sources, `clocksync sync=true` already paces output. The udpsink doesn't need to re-gate. Change:

```typescript
// In buildOpusRtpChain():
`udpsink host=${rtp.host} port=${rtp.rtpPort} bind-port=${senderBindPort} sync=false async=false`
```

**Caution for live sources:** WASAPI sources produce real-time data. Without `sync=true` on udpsink, buffers send immediately (which is fine -- they arrive at real-time rate anyway). The main risk: if CPU stalls cause a burst of queued buffers, they'll all send at once. The bounded queue (Fix 1) prevents this scenario.

---

## 4. Implementation Plan: Latency Measurement System

### Phase 1: getStats() Dashboard (1 hour)

1. Extend `ConnectionStatsSnapshot` with jitter buffer fields
2. Extract `jitterBufferDelay`, `jitterBufferEmittedCount`, `jitterBufferTargetDelay` from inbound-rtp
3. Compute rolling average, display in StatsPanel
4. **This tells you exactly how much delay Chrome's jitter buffer is adding**

### Phase 2: Latency Reduction (30 min)

1. Apply Fix 1 (bounded queues)
2. Apply Fix 2 (jitterBufferTarget)
3. Apply Fix 3 (remove udpsink sync for file sources)
4. Re-measure with getStats() dashboard

### Phase 3: Automated Tone Test (optional, 3-4 hours)

1. Add `/api/inject-tone` endpoint on sidecar
2. When called: inject 100ms 1kHz tone into GStreamer via `audiotestsrc wave=sine freq=1000` mixed briefly
3. Listener polls AnalyserNode, detects tone onset
4. WebSocket message carries injection timestamp; listener computes delta
5. Display on admin panel: "Measured latency: Xms"

**Clock sync approach:** Use NTP-style offset estimation via WebSocket ping/pong:
```typescript
// Listener -> Server: { type: "ping", t1: Date.now() }
// Server -> Listener: { type: "pong", t1, t2: Date.now(), t3: Date.now() }
// Listener: offset = ((t2 - t1) + (t3 - t4)) / 2  where t4 = Date.now()
```

---

## Key Insight

The 4-second gap is NOT from any single component being slow. It's from **accumulation without drain**:
- Queues fill during micro-stalls and never flush (no leaky policy)
- Browser jitter buffer grows to absorb perceived jitter and never shrinks back
- These two effects compound: GStreamer queue adds 1-2s, browser adds 1-2s, total = 4s

The fix is NOT "make each component faster" -- it's **prevent accumulation**: bounded queues with leak policy + explicit jitter buffer target.

---

## Sources

### PRIMARY (HIGH confidence)
- [W3C WebRTC Stats - jitterBufferDelay](https://developer.mozilla.org/en-US/docs/Web/API/RTCInboundRtpStreamStats/jitterBufferDelay) - formula for average delay
- [MDN RTCRtpReceiver.jitterBufferTarget](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/jitterBufferTarget) - API for controlling buffer
- [GStreamer queue element docs](https://gstreamer.freedesktop.org/documentation/coreelements/queue.html) - default sizes, leaky behavior
- [GStreamer clocksync docs](https://gstreamer.freedesktop.org/documentation/coreelements/clocksync.html) - sync behavior
- Codebase: `pipeline-builder.ts`, `audio-engine.ts`, `connection-stats.ts` - verified current implementation

### SECONDARY (MEDIUM confidence)
- [GStreamer Latency Design](https://gstreamer.freedesktop.org/documentation/additional/design/latency.html) - live vs non-live pipeline behavior
- [webrtcHacks NetEQ article](https://webrtchacks.com/how-webrtcs-neteq-jitter-buffer-provides-smooth-audio/) - jitter buffer growth behavior
- [mediasoup RTC Statistics](https://mediasoup.org/documentation/v3/mediasoup/rtc-statistics/) - consumer stats structure
