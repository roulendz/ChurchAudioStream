# Phase 3: Audio Processing - Research

**Researched:** 2026-02-07
**Domain:** GStreamer audio processing pipeline (normalization/AGC, Opus encoding, RTP output)
**Confidence:** HIGH

## Summary

Phase 3 transforms raw captured audio (from Phase 2's capture pipelines) into clean, normalized, Opus-encoded RTP streams ready for mediasoup ingestion. The research focused on three core areas: (1) GStreamer elements for loudness normalization/AGC, (2) Opus encoding configuration via `opusenc`, and (3) RTP output via `rtpopuspay` + `rtpbin` + `udpsink` to mediasoup's PlainTransport.

The key architectural finding is that the existing Phase 2 pipeline builder and GStreamerProcess wrapper remain the foundation -- Phase 3 extends the pipeline string by inserting processing elements before the sink and replacing `fakesink` with the Opus encoding + RTP output chain. The `audioloudnorm` element from `gst-plugins-rs` (included in GStreamer 1.26 binary releases) provides EBU R128 loudness normalization with a 3-second lookahead, but requires 192kHz internal processing (handled transparently via `audioresample` wrappers). A `tee` element splits the processed audio to both the level metering branch (existing) and the encoding/RTP branch (new).

**Primary recommendation:** Use `audioloudnorm` for normalization/AGC with `audioresample` wrappers for the 192kHz requirement. Use `tee` to split processed audio to both metering (`level ! fakesink`) and encoding (`opusenc ! rtpopuspay ! rtpbin ! udpsink`). Extend `PipelineConfig` with processing parameters and build a new pipeline string builder function. Since `gst-launch-1.0` does not support runtime property changes, config changes require pipeline restart (already accepted in CONTEXT.md).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Target loudness: -16 LUFS (broadcast standard)
- Per-channel adjustable target level via slider
- Target range: -20 to -14 LUFS (tight range, prevents accidental extremes)
- AGC speed: Medium (3-5 second settle time) -- natural feel for sermon dynamics
- No hard limiter -- trust AGC to handle peaks
- Admin can bypass AGC per channel (toggle) -- for pre-mixed board feeds
- Live target adjustments use smooth ~1 second transition (no audible jump)
- Gain reduction indicator exposed for admin dashboard (shows when/how much AGC is compressing)
- Per-channel "reset to defaults" action restores all processing settings
- Manual toggle only (Speech or Music) -- no auto-detection
- Default mode for new channels: Speech
- Mode switch on live channel uses brief crossfade (~500ms) for smooth transition
- Opus application type hint linked to mode: Speech -> VOIP, Music -> Audio
- Per-channel adjustable bitrate, range: 48-192 kbps, default: 128 kbps
- Mono only in v1 (stereo deferred)
- Sample rate: 48kHz (Opus native, no resampling)
- CBR/VBR: admin toggle per channel (dropdown)
- Frame size: configurable per channel (10ms / 20ms / 40ms options)
- FEC (Forward Error Correction): admin toggle, off by default
- No DTX (always send packets, no silence suppression)
- Opus application type: linked to Speech/Music mode toggle
- Fixed port range starting at 77702
- Each channel uses 2 ports: RTP + RTCP (77702/77703, 77704/77705, 77706/77707...)
- Localhost only (127.0.0.1) -- mediasoup consumes on same machine
- Fixed order: Input -> Normalization/AGC -> Opus Encoding -> RTP Output
- Each stage can be independently bypassed (toggle per stage per channel)
- Pipeline restart on config changes (bypass toggle, mode switch, bitrate change)
- Brief silence (~100-500ms) during restart is acceptable
- Config changes debounced (~1-2s) -- rapid tweaks batch into single restart
- All processing config changes persist immediately to config store (no explicit save)

### Claude's Discretion
- What parameters change between Speech and Music mode (AGC behavior, Opus settings, or both)
- Exact GStreamer elements for normalization/AGC implementation
- Default frame size (20ms likely, but Claude can optimize)
- Default CBR vs VBR setting
- Bandwidth display format (simple number or mini graph)
- Gain reduction indicator visual design

### Deferred Ideas (OUT OF SCOPE)
- Stereo encoding support -- deferred past v1
- Audio preview/dry-run mode -- future enhancement
- Auto-detection of Speech vs Music content -- not in v1
</user_constraints>

## Standard Stack

The established GStreamer elements and patterns for this domain:

### Core Elements
| Element | Plugin | Purpose | Why Standard |
|---------|--------|---------|--------------|
| `audioloudnorm` | rsaudiofx (gst-plugins-rs) | EBU R128 loudness normalization | Only GStreamer element with LUFS-target loudness normalization; based on FFmpeg af_loudnorm |
| `audioresample` | audioresample (gst-plugins-base) | Sample rate conversion (48kHz <-> 192kHz) | Required wrapper for audioloudnorm's 192kHz requirement |
| `audioconvert` | audioconvert (gst-plugins-base) | Audio format conversion | Required for format negotiation between elements (F64LE for audioloudnorm) |
| `opusenc` | opus (gst-plugins-base) | Opus audio encoding | Standard GStreamer Opus encoder, configurable bitrate/frame-size/application |
| `rtpopuspay` | rtp (gst-plugins-good) | RTP packetization of Opus | RFC 7587 compliant, standard payloader |
| `rtpbin` | rtpmanager (gst-plugins-good) | RTP session management | Handles RTP/RTCP separation, SSRC management |
| `udpsink` | udp (gst-plugins-good) | UDP packet output | Standard network output element |
| `tee` | coreelements | Stream splitting | Splits processed audio to metering + encoding branches |
| `queue` | coreelements | Thread decoupling | Required after tee for each branch |
| `level` | level (gst-plugins-good) | Audio metering | Already used in Phase 2; continues in metering branch |
| `volume` | volume (gst-plugins-base) | Gain adjustment | Runtime-adjustable volume; for potential gain reduction indicator |

### Supporting Elements
| Element | Purpose | When to Use |
|---------|---------|-------------|
| `capsfilter` / inline caps | Format forcing | Between elements to enforce specific sample rates/formats |
| `fakesink` | Null output | Metering branch terminus (already used in Phase 2) |

### Availability (Confidence: HIGH)
GStreamer 1.26 release notes confirm: "All gst-plugins-rs elements are now shipped in the binary releases for all platforms." This includes `audioloudnorm` from rsaudiofx. The project already targets GStreamer 1.26. Verify at runtime with `gst-inspect-1.0 audioloudnorm`.

## Architecture Patterns

### Pipeline String Evolution

Phase 2 pipelines end with:
```
... audioconvert ! audioresample ! level interval=N post-messages=true ! fakesink sync=false
```

Phase 3 transforms this to (full processing enabled):
```
[source] ! audioconvert ! audioresample ! audio/x-raw,rate=192000 !
audioloudnorm loudness-target=-16 !
audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 !
tee name=t
  t. ! queue ! level interval=N post-messages=true ! fakesink sync=false
  t. ! queue ! opusenc bitrate=128000 frame-size=20 audio-type=voice !
       rtpopuspay pt=101 ssrc=SSRC !
       rtpbin name=r r.send_rtp_src_0 ! udpsink host=127.0.0.1 port=PORT sync=false
       r.send_rtcp_src_0 ! udpsink host=127.0.0.1 port=PORT+1 sync=false async=false
```

### Pipeline String Builder Architecture

```
src/audio/pipeline/
  pipeline-builder.ts          # Phase 2 capture pipeline strings (EXISTING)
  processing-builder.ts        # Phase 3 processing pipeline strings (NEW)
  pipeline-types.ts            # Extended with ProcessingConfig (MODIFIED)
```

**Key pattern:** The processing builder composes the full pipeline by calling the existing capture source builder for the head, then appending the processing chain. The builder is a pure function -- no side effects, no I/O.

### Recommended Processing Config Type Extension

```typescript
/** Speech vs Music mode for a channel's audio processing. */
type AudioMode = "speech" | "music";

/** Per-channel audio processing configuration. */
interface ProcessingConfig {
  // AGC / Normalization
  readonly agcEnabled: boolean;
  readonly loudnessTargetLufs: number;     // -20 to -14, default -16
  readonly audioMode: AudioMode;           // "speech" or "music"

  // Opus encoding
  readonly opusEnabled: boolean;
  readonly bitrate: number;                // 48000-192000 bps
  readonly frameSize: number;              // 10, 20, or 40 ms
  readonly bitrateType: "cbr" | "vbr";
  readonly fecEnabled: boolean;

  // RTP output
  readonly rtpPort: number;                // Even port (RTP)
  readonly rtcpPort: number;               // Odd port (RTCP) = rtpPort + 1
  readonly ssrc: number;                   // Unique per channel
  readonly payloadType: number;            // e.g. 101
}
```

### Stage Bypass Pattern

When a stage is bypassed, the builder simply omits those elements from the pipeline string:

```typescript
function buildProcessingPipeline(config: ProcessingConfig): string {
  const segments: string[] = [];

  // AGC stage (omit if bypassed)
  if (config.agcEnabled) {
    segments.push(buildAgcSegment(config));
  }

  // Always need format conversion to 48kHz mono before encoding
  segments.push("audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1");

  // Tee for metering + encoding
  segments.push("tee name=t");

  // Metering branch (always present)
  segments.push(buildMeteringBranch(config));

  // Encoding branch (omit if bypassed)
  if (config.opusEnabled) {
    segments.push(buildEncodingBranch(config));
  }

  return segments.join(" ");
}
```

### Port Allocation Pattern

```typescript
const RTP_BASE_PORT = 77702;

function getPortsForChannel(channelIndex: number): { rtp: number; rtcp: number } {
  const rtp = RTP_BASE_PORT + (channelIndex * 2);
  return { rtp, rtcp: rtp + 1 };
}
// Channel 0: 77702/77703
// Channel 1: 77704/77705
// Channel 2: 77706/77707
```

### Config Change Debounce Pattern

```typescript
// In ChannelManager or a new ProcessingController
private restartTimers = new Map<string, NodeJS.Timeout>();

handleConfigChange(channelId: string, newConfig: ProcessingConfig): void {
  // Clear any pending restart
  const existing = this.restartTimers.get(channelId);
  if (existing) clearTimeout(existing);

  // Persist immediately
  this.persistProcessingConfig(channelId, newConfig);

  // Debounce restart
  const timer = setTimeout(() => {
    this.restartTimers.delete(channelId);
    this.restartPipeline(channelId);
  }, 1500); // 1.5s debounce

  this.restartTimers.set(channelId, timer);
}
```

### Anti-Patterns to Avoid
- **Runtime property modification on gst-launch-1.0:** `gst-launch-1.0` does not expose property setters at runtime. Do not attempt to change element properties without full pipeline restart.
- **Omitting audioresample around audioloudnorm:** The element ONLY accepts 192kHz input. Omitting the upsample/downsample wrappers will cause pipeline negotiation failure.
- **Using rtpMux with mediasoup PlainTransport for GStreamer:** The mediasoup demo and community consistently use `rtcpMux: false` and separate RTP/RTCP ports when integrating with GStreamer via `rtpbin`. Using `rtcpMux: true` can cause mediasoup to not receive producer stats.
- **Hardcoding SSRC across channels:** Each channel's producer needs a unique SSRC. Generate deterministically from channel index or use random values.

## Claude's Discretion Recommendations

### Speech vs Music Mode Parameters

**Recommendation:** Both AGC behavior AND Opus settings should change between modes.

| Parameter | Speech Mode | Music Mode | Rationale |
|-----------|-------------|------------|-----------|
| `opusenc audio-type` | `voice` | `generic` | VOIP mode applies high-pass filtering + formant emphasis (destroys music). Generic mode preserves full spectrum. |
| `audioloudnorm loudness-target` | Use channel's target (default -16 LUFS) | Use channel's target (default -16 LUFS) | Same target in both modes -- AGC settle time handles the difference |
| `audioloudnorm max-true-peak` | -2 dBTP | -1 dBTP | Music needs slightly more headroom for dynamics |
| `opusenc bandwidth` | `wideband` | `fullband` | Voice doesn't need frequencies above 8kHz; music needs full 20kHz range |

**Note on opusenc audio-type values:** The GStreamer opusenc element maps Opus application modes as follows:
- `OPUS_APPLICATION_AUDIO` -> `generic` (NOT "audio")
- `OPUS_APPLICATION_VOIP` -> `voice` (NOT "voip")
- `OPUS_APPLICATION_RESTRICTED_LOWDELAY` -> `restricted-lowdelay`

The CONTEXT.md states "Speech -> VOIP, Music -> Audio" which maps to GStreamer's `audio-type=voice` and `audio-type=generic` respectively.

### Default Frame Size

**Recommendation:** 20ms (default)

- 20ms is the Opus default and provides the best balance of latency vs compression efficiency
- 10ms adds latency sensitivity without meaningful quality gain at 128kbps
- 40ms adds 20ms extra latency for marginal bitrate savings
- 20ms = one Opus frame per 20ms, clean alignment with RTP packetization
- Confidence: HIGH (Opus specification recommends 20ms for most use cases)

### Default CBR vs VBR

**Recommendation:** VBR (constrained)

- GStreamer's `opusenc` default `bitrate-type` is `constrained-vbr`, which is the best default
- Constrained VBR provides better quality than CBR at the same average bitrate while preventing bitrate spikes
- CBR is useful only for specific network constraints (strict bandwidth caps)
- Map the user-facing "VBR" toggle to `constrained-vbr` and "CBR" to `cbr`
- Confidence: HIGH (Opus FAQ recommends VBR for quality, CBR only for strict bandwidth)

### Gain Reduction Indicator

**Recommendation:** Expose as a numeric value (dB of gain applied) via the level metering data path.

The `audioloudnorm` element does not directly expose a "gain reduction" property. However, since the pipeline uses `tee` with a `level` element on the processed output, the Node.js sidecar can compute gain reduction by comparing:
- Input levels (from the Phase 2 level metering, before AGC)
- Output levels (from the Phase 3 level element, after AGC)

The difference approximates the gain change applied by AGC. This value is sent to the admin dashboard via WebSocket alongside existing level data. The visual design (meter, number, color) is Phase 6 scope.

**Implementation:** Add a `gainReductionDb` field to the levels data emitted per pipeline. Compute as `outputRms - inputRms` (both in dB). Negative values mean compression is active.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Loudness normalization | Custom gain algorithm reading level data | `audioloudnorm` element | EBU R128 compliance with 3s lookahead, true peak limiter, proven algorithm ported from FFmpeg |
| RTP packetization | Manual UDP packet construction | `rtpopuspay` + `rtpbin` | RFC 7587 compliance, proper RTCP handling, sequence numbering, timestamps |
| Sample rate conversion | Manual interpolation | `audioresample` | Optimized sinc resampler, handles all rate conversions cleanly |
| Pipeline string composition | String concatenation inline | Pure builder functions (existing pattern) | Testable, composable, consistent with Phase 2 dispatch table pattern |
| Config change debouncing | Inline setTimeout management | Shared debounce utility | Reusable across all config change handlers |
| Port allocation | Manual port tracking | Deterministic calculation from channel index + base port | Formula-based, no state to manage, no collisions |

**Key insight:** The GStreamer pipeline string approach (gst-launch-1.0 child processes) means all audio processing happens in the GStreamer process -- the Node.js sidecar only builds strings, manages lifecycle, and parses output. Do not attempt to do audio processing in Node.js.

## Common Pitfalls

### Pitfall 1: audioloudnorm 192kHz Requirement
**What goes wrong:** Pipeline fails to negotiate caps, crashes silently or with obscure error.
**Why it happens:** `audioloudnorm` from rsaudiofx accepts ONLY 192kHz F64LE input (hardcoded in pad templates). This is a simplification for true peak detection.
**How to avoid:** Always wrap with `audioresample`:
```
audioconvert ! audioresample ! audio/x-raw,rate=192000 ! audioloudnorm ... ! audioconvert ! audioresample ! audio/x-raw,rate=48000
```
**Warning signs:** "not-negotiated" error in GStreamer stderr output.

### Pitfall 2: audioloudnorm 3-Second Latency
**What goes wrong:** 3 seconds of silence at pipeline start before audio appears.
**Why it happens:** `audioloudnorm` has a 3-second lookahead window for loudness measurement. It buffers 3 seconds before outputting any audio.
**How to avoid:** This is inherent to the algorithm and cannot be eliminated. Document for admin that AGC adds ~3s startup latency. The ongoing latency after startup is negligible. Users report that this is acceptable for live streaming where a few seconds of initial delay is normal.
**Warning signs:** Admin reports "no audio for first few seconds" -- this is expected behavior, not a bug.

### Pitfall 3: opusenc audio-type Naming Mismatch
**What goes wrong:** Using `audio-type=voip` or `audio-type=audio` causes pipeline error.
**Why it happens:** GStreamer's opusenc uses different names than the Opus API constants. OPUS_APPLICATION_VOIP maps to `voice`, OPUS_APPLICATION_AUDIO maps to `generic`.
**How to avoid:** Always use the GStreamer enum values: `voice`, `generic`, `restricted-lowdelay`.
**Warning signs:** Pipeline crashes immediately on start with property error.

### Pitfall 4: RTCP Port Handling with mediasoup
**What goes wrong:** mediasoup PlainTransport shows empty producer stats, audio doesn't flow to WebRTC consumers.
**Why it happens:** mediasoup needs RTCP for sender reports. Without proper RTCP, it can't confirm the producer is active.
**How to avoid:** Use `rtpbin` with separate `udpsink` elements for RTP and RTCP. Configure mediasoup PlainTransport with `rtcpMux: false` and `comedia: true`. Two ports per channel: even for RTP, odd for RTCP.
**Warning signs:** `transport.produce()` succeeds but `producer.getStats()` returns empty array.

### Pitfall 5: FEC Adds 120ms Latency
**What goes wrong:** Enabling FEC pushes total pipeline latency beyond the 100ms budget.
**Why it happens:** Opus inband FEC requires encoding the current frame's data redundantly in the next frame, adding a full frame duration of latency.
**How to avoid:** Default FEC to OFF (already decided in CONTEXT.md). Only enable when packet loss is actually observed and the latency tradeoff is acceptable. Admin should be warned in the UI.
**Warning signs:** Listeners report noticeable delay after FEC is enabled.

### Pitfall 6: Pipeline Restart Race Conditions
**What goes wrong:** Rapid config changes cause multiple simultaneous pipeline restarts, orphaning child processes.
**Why it happens:** Without debouncing, each config change triggers stop + start. If a second change arrives before the first restart completes, the old process may not be killed.
**How to avoid:** Debounce config changes (1.5-2s). Use the existing PipelineManager's stop/start lifecycle which handles process cleanup. Clear pending restart timers before starting a new restart cycle.
**Warning signs:** Multiple gst-launch-1.0 processes for the same channel in Task Manager.

### Pitfall 7: Port Conflicts on Channel Reordering
**What goes wrong:** Channels 0 and 1 swap positions, both try to bind the same ports.
**Why it happens:** If port allocation is based on array index and channels can be reordered, two channels might claim the same port range.
**How to avoid:** Allocate ports based on a persistent channel property (creation order counter or UUID hash), not the runtime channel list index. Or assign ports at channel creation time and persist them in config.
**Warning signs:** "Address already in use" errors when starting channels.

## Code Examples

### Complete Processing Pipeline String (Speech Mode, All Enabled)

```
# Source: Verified against GStreamer 1.26 element documentation
# AES67 source example:
udpsrc address=239.69.1.1 port=5004 caps="application/x-rtp, clock-rate=48000, channels=8, payload=96" buffer-size=65536 !
rtpjitterbuffer latency=5 !
rtpL24depay !
deinterleave name=d d.src_0 ! queue !
audioconvert ! audioresample ! audio/x-raw,rate=192000 !
audioloudnorm loudness-target=-16 max-true-peak=-2 !
audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 !
tee name=t
t. ! queue ! level interval=100000000 post-messages=true ! fakesink sync=false
t. ! queue ! opusenc bitrate=128000 frame-size=20 audio-type=voice bitrate-type=constrained-vbr inband-fec=false dtx=false bandwidth=wideband !
rtpopuspay pt=101 ssrc=11111 !
rtpbin name=r r.send_rtp_src_0 ! udpsink host=127.0.0.1 port=77702 sync=false
r.send_rtcp_src_0 ! udpsink host=127.0.0.1 port=77703 sync=false async=false
```

### Complete Processing Pipeline String (Music Mode)

```
# Same source head as above, then:
audioconvert ! audioresample ! audio/x-raw,rate=192000 !
audioloudnorm loudness-target=-16 max-true-peak=-1 !
audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 !
tee name=t
t. ! queue ! level interval=100000000 post-messages=true ! fakesink sync=false
t. ! queue ! opusenc bitrate=128000 frame-size=20 audio-type=generic bitrate-type=constrained-vbr inband-fec=false dtx=false bandwidth=fullband !
rtpopuspay pt=101 ssrc=11111 !
rtpbin name=r r.send_rtp_src_0 ! udpsink host=127.0.0.1 port=77702 sync=false
r.send_rtcp_src_0 ! udpsink host=127.0.0.1 port=77703 sync=false async=false
```

### AGC Bypassed Pipeline String

```
# Source -> format conversion -> tee (no audioloudnorm)
audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 !
tee name=t
t. ! queue ! level interval=100000000 post-messages=true ! fakesink sync=false
t. ! queue ! opusenc bitrate=128000 frame-size=20 audio-type=voice !
rtpopuspay pt=101 ssrc=11111 !
rtpbin name=r r.send_rtp_src_0 ! udpsink host=127.0.0.1 port=77702 sync=false
r.send_rtcp_src_0 ! udpsink host=127.0.0.1 port=77703 sync=false async=false
```

### Opus Bypassed Pipeline String (Metering Only, No RTP Output)

```
# Same as Phase 2 pipeline -- no encoding, no RTP
audioconvert ! audioresample !
level interval=100000000 post-messages=true ! fakesink sync=false
```

### mediasoup PlainTransport Configuration (Node.js)

```typescript
// Source: mediasoup documentation + community-verified pattern
const transport = await router.createPlainTransport({
  listenIp: '127.0.0.1',
  rtcpMux: false,     // Separate RTP and RTCP ports
  comedia: true,       // Let GStreamer's first packet set the remote address
});

// Transport provides local ports for GStreamer to send to
const { localPort: rtpPort } = transport.tuple;
const { localPort: rtcpPort } = transport.rtcpTuple!;

const producer = await transport.produce({
  kind: 'audio',
  rtpParameters: {
    codecs: [{
      mimeType: 'audio/opus',
      clockRate: 48000,
      payloadType: 101,
      channels: 1, // Mono
      parameters: {},
      rtcpFeedback: [{ type: 'transport-cc' }],
    }],
    encodings: [{ ssrc: channelSsrc }],
  },
});
```

**Note on port allocation:** The CONTEXT.md specifies fixed ports starting at 77702 for the GStreamer side. The mediasoup PlainTransport will allocate its own ports. The GStreamer pipeline sends RTP to the mediasoup-allocated ports, NOT the fixed 77702+ range. The 77702+ range is for GStreamer's `udpsink` to bind its local sending port. Alternatively, if using `comedia: true`, mediasoup auto-detects the sender -- so GStreamer can send from any port. The fixed port approach (77702+) is primarily for the GStreamer `udpsink` destination when connecting to mediasoup.

**Clarification:** With `comedia: true`, the flow is:
1. Create mediasoup PlainTransport -> gets its own port (e.g., 40000)
2. GStreamer `udpsink host=127.0.0.1 port=40000` sends RTP to mediasoup's port
3. mediasoup auto-detects GStreamer's source port from the first packet

The fixed 77702+ ports from CONTEXT.md should be the mediasoup PlainTransport `listenIp` ports OR the GStreamer udpsink destination ports. Given `comedia: true`, the simplest approach: mediasoup listens on its own allocated ports, GStreamer sends to those ports. The 77702+ convention becomes the mediasoup-side port allocation.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual gain adjustment via `volume` element | `audioloudnorm` with EBU R128 | GStreamer 1.18+ (2020) | Automatic LUFS-targeted loudness normalization instead of manual dB adjustment |
| Separate RTP payloader + raw UDP | `rtpbin` with RTCP handling | GStreamer 1.x (stable) | Proper RTCP sender reports, required for mediasoup producer stats |
| `opusenc audio` property | `opusenc audio-type` property | GStreamer ~1.8 (2016) | Property was renamed; old name no longer works |
| gst-plugins-rs compiled separately | Included in GStreamer 1.26 binary releases | March 2025 | No need to build Rust plugins separately; `audioloudnorm` ships out of the box |

**Deprecated/outdated:**
- `opusenc audio=` property: Renamed to `audio-type=` in GStreamer 1.8+
- Building gst-plugins-rs from source for Windows: No longer needed with GStreamer 1.26+ binary releases

## Open Questions

1. **audioloudnorm gain reporting**
   - What we know: The element does not expose a "current gain" property readable at runtime. It internally applies gain based on the 3s lookahead.
   - What's unclear: Whether the element emits any GStreamer bus messages indicating current gain adjustment. The source code would need inspection.
   - Recommendation: Implement gain reduction estimation by comparing pre-AGC levels (from a `level` element before audioloudnorm) with post-AGC levels (from the `level` element after). This requires a second `level` element in the pipeline, or accept the approximation from comparing current Phase 2 input levels with Phase 3 output levels.

2. **audioloudnorm settle time alignment with user expectation**
   - What we know: The element uses a 3-second lookahead window (hard-coded). The CONTEXT.md specifies "3-5 second settle time."
   - What's unclear: Whether the 3s lookahead perfectly aligns with the user's expectation of "3-5 second AGC speed." The lookahead is for measurement; the gain adjustment smoothing may be different.
   - Recommendation: Accept the 3s lookahead as meeting the "medium" AGC speed requirement. Test with real sermon audio to validate the feel.

3. **Live target adjustment smooth transition**
   - What we know: CONTEXT.md requires ~1 second smooth transition when admin changes target LUFS. Since gst-launch-1.0 requires pipeline restart, this creates a gap not a smooth transition.
   - What's unclear: Whether the ~100-500ms restart gap is perceived as smoother than a gain jump.
   - Recommendation: Accept the restart gap as the "transition." The audioloudnorm element's 3s lookahead means the new target takes effect gradually after restart anyway. Document that "smooth transition" is achieved via the element's natural settling behavior after restart.

4. **Mode switch crossfade**
   - What we know: CONTEXT.md requests ~500ms crossfade on Speech/Music mode switch. Pipeline restart creates silence, not crossfade.
   - What's unclear: Whether the pipeline restart gap (100-500ms) is an acceptable substitute for true crossfade.
   - Recommendation: Accept restart gap as the mode switch behavior. True crossfade would require running two pipelines simultaneously and mixing in Node.js, which is not practical with gst-launch-1.0 architecture. The brief silence is less noticeable than a sudden parameter jump.

## Sources

### Primary (HIGH confidence)
- [GStreamer audioloudnorm documentation](https://gstreamer.freedesktop.org/documentation/rsaudiofx/audioloudnorm.html) - Element properties, format requirements
- [GStreamer opusenc documentation](https://gstreamer.freedesktop.org/documentation/opus/opusenc.html) - All encoder properties and enum values
- [GStreamer opusenc source code](https://github.com/GStreamer/gst-plugins-base/blob/master/ext/opus/gstopusenc.c) - Verified audio-type enum: voice, generic, restricted-lowdelay
- [audioloudnorm source code (imp.rs)](https://gitlab.freedesktop.org/gstreamer/gst-plugins-rs/-/blob/main/audio/audiofx/src/audioloudnorm/imp.rs) - Confirmed 192kHz hardcoded rate, 3s lookahead
- [GStreamer rtpopuspay documentation](https://gstreamer.freedesktop.org/documentation/rtp/rtpopuspay.html) - RTP packetization properties
- [GStreamer 1.26 release notes](https://gstreamer.freedesktop.org/releases/1.26/) - Confirmed gst-plugins-rs shipped in binary releases
- [Opus API documentation](https://www.opus-codec.org/docs/opus_api-1.2/group__opus__encoder.html) - VOIP vs Audio application mode differences
- [mediasoup demo GStreamer script](https://github.com/versatica/mediasoup-demo/blob/v3/broadcasters/gstreamer.sh) - Reference pipeline for GStreamer -> mediasoup

### Secondary (MEDIUM confidence)
- [Sebastian Droge blog: audioloudnorm](https://coaxion.net/blog/2020/07/live-loudness-normalization-in-gstreamer-experiences-with-porting-a-c-audio-filter-to-rust/) - 3s lookahead, 10ms limiter, 192kHz rationale
- [mediasoup GStreamer PlainTransport discussion](https://mediasoup.discourse.group/t/gstreamer-plaintransport-send-opus/2394) - rtcpMux: false + comedia: true pattern
- [mediasoup GStreamer integration gist](https://gist.github.com/mkhahani/59b9eca043569a9ec3cbec67e4d05811) - Complete Node.js + GStreamer integration code
- [GStreamer audiodynamic documentation](https://gstreamer.freedesktop.org/documentation/audiofx/audiodynamic.html) - Compressor/expander alternative

### Tertiary (LOW confidence)
- [Opus FEC latency claim (120ms)](https://github.com/EricssonResearch/openwebrtc/issues/444) - Single source, but aligns with Opus specification FEC behavior

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All elements verified against official GStreamer documentation and source code
- Architecture: HIGH - Pipeline patterns verified from mediasoup demo and community examples; existing codebase patterns well-understood
- Pitfalls: HIGH - 192kHz limitation confirmed from source code; RTCP pattern confirmed from multiple community sources; audio-type naming confirmed from C source
- Opus configuration: HIGH - Properties and enum values verified from GStreamer source code
- Gain reduction indicator: MEDIUM - Approximation approach (level comparison) is sound but not directly from audioloudnorm
- Port allocation with mediasoup: MEDIUM - comedia pattern well-documented but exact port assignment strategy needs validation

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (GStreamer elements are stable; pipeline patterns unlikely to change)
