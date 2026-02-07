# Phase 2: Audio Capture Pipeline - Research

**Researched:** 2026-02-07
**Domain:** GStreamer audio capture, AES67/Dante multicast, Windows audio APIs, stream discovery, pipeline lifecycle management
**Confidence:** MEDIUM (GStreamer core: HIGH, ASIO: MEDIUM, Windows multicast quirks: MEDIUM, SAP discovery: MEDIUM)

## Summary

Phase 2 builds the audio capture infrastructure: GStreamer-based pipelines that receive AES67 multicast RTP streams and capture local Windows audio devices, managed as independent child processes from the Node.js sidecar. The phase also includes SAP-based stream discovery, local device enumeration, and pipeline lifecycle management with metering.

GStreamer 1.26 (current stable, released March 2025) is the target runtime. It ships ASIO plugin support without requiring an external SDK, supports wasapi2 for modern Windows audio, and has mature AES67/RTP reception elements. The critical architectural choice is spawning `gst-launch-1.0` as child processes (one per capture source) managed by the Node.js sidecar, with the `level` element providing audio metering data via the GStreamer message bus, parsed from stderr output using the `-m` flag.

SAP (Session Announcement Protocol) stream discovery must be implemented directly in Node.js using `dgram` multicast listeners on 224.2.127.254:9875, parsing the SDP payloads with the `sdp-transform` library. Local device enumeration uses `gst-device-monitor-1.0` with JSON output. A known Windows limitation where `multicast-iface` is ignored on `udpsrc` requires a documented workaround.

**Primary recommendation:** Use GStreamer 1.26 official Windows installer (MSVC), spawn `gst-launch-1.0` as child processes per source, implement SAP discovery natively in Node.js with dgram + sdp-transform, enumerate devices via `gst-device-monitor-1.0 -f json`, and use the `level` element with `-m` flag for audio metering.

## Standard Stack

### Core

| Library/Tool | Version | Purpose | Why Standard |
|-------------|---------|---------|--------------|
| GStreamer | 1.26.x | Audio pipeline runtime | Current stable, ships ASIO, wasapi2, RTP/UDP plugins |
| gst-launch-1.0 | (GStreamer) | Pipeline execution CLI | Runs as child process per capture source |
| gst-device-monitor-1.0 | (GStreamer) | Audio device enumeration | Built-in JSON output with `-f json`, lists wasapi2/ASIO/DirectSound devices |
| sdp-transform | 3.x | SDP parsing | MIT licensed, 302+ dependents, RFC4566 compliant, parses AES67 SDP |
| pidusage | 3.x | Process resource monitoring | Cross-platform CPU% + memory by PID, no native deps, Windows uses wmic |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| bonjour-service | 1.3.x | mDNS/DNS-SD discovery | Already in project deps (Phase 1); used for RAVENNA device discovery |
| node:dgram | (built-in) | UDP multicast | SAP listener on 224.2.127.254:9875 |
| node:child_process | (built-in) | Process spawning | One gst-launch-1.0 per capture source |
| zod | 4.x | Schema validation | Already in project; validate channel/source config schemas |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| gst-launch-1.0 child processes | gstreamer-superficial (native binding) | Binding is incomplete, unmaintained, requires native compilation; child processes give fault isolation per the architecture |
| sdp-transform | sdp-parsing | sdp-parsing is simpler but less complete; sdp-transform has broader RFC coverage |
| pidusage | manual wmic calls | pidusage abstracts platform differences, no reinventing |
| Official GStreamer installer | MSYS2 packages | MSYS2 better for dev, but official installer simpler for deployment; GStreamer 1.26 MSVC includes ASIO out of the box |

**Installation:**
```bash
# Node.js dependencies
npm install sdp-transform pidusage
npm install -D @types/sdp-transform

# GStreamer 1.26 - install via official Windows MSI installer
# Runtime: gstreamer-1.0-msvc-x86_64-1.26.x.msi
# Dev (optional): gstreamer-1.0-devel-msvc-x86_64-1.26.x.msi
# After install, add %GSTREAMER_ROOT_X86_64%\bin to PATH
```

## Architecture Patterns

### Recommended Project Structure
```
sidecar/src/
  audio/
    pipeline/
      gstreamer-process.ts    # Spawns and manages one gst-launch-1.0 child process
      pipeline-builder.ts     # Constructs GStreamer pipeline strings for different source types
      pipeline-manager.ts     # Registry of all active pipelines, start/stop/restart coordination
      metering-parser.ts      # Parses level element messages from gst-launch-1.0 stderr
    discovery/
      sap-listener.ts         # SAP multicast listener (dgram on 224.2.127.254:9875)
      sdp-parser.ts           # Wraps sdp-transform for AES67-specific SDP extraction
      device-enumerator.ts    # Runs gst-device-monitor-1.0, parses JSON output
      discovery-manager.ts    # Coordinates SAP + mDNS + device enumeration, maintains registry
    sources/
      source-registry.ts      # In-memory registry of discovered AES67 streams + local devices
      source-types.ts         # TypeScript types for AES67Source, LocalDeviceSource, etc.
    channels/
      channel-manager.ts      # App channel lifecycle (create, configure, start, stop)
      channel-types.ts        # TypeScript types for AppChannel, SourceAssignment, etc.
    monitor/
      level-monitor.ts        # Aggregates level data from all pipelines, broadcasts via WebSocket
      resource-monitor.ts     # Polls pidusage for CPU/memory per pipeline process
      event-logger.ts         # Per-channel event log with disk persistence + 30-day retention
  config/
    schema.ts                 # Extended with audio/channels/sources schemas
    store.ts                  # Existing config store (unchanged)
```

### Pattern 1: GStreamer Child Process per Source
**What:** Each audio source (AES67 stream channel or local device channel) runs as a separate `gst-launch-1.0` process. The Node.js sidecar spawns, monitors, and manages each process independently.
**When to use:** Always -- this is the locked architectural decision for fault isolation.
**Example:**
```typescript
// Source: GStreamer docs + Node.js child_process docs
import { spawn, ChildProcess } from 'node:child_process';

interface GStreamerProcessOptions {
  pipelineString: string;
  processLabel: string;
  onLevelMessage: (levels: AudioLevels) => void;
  onError: (error: PipelineError) => void;
  onStateChange: (state: PipelineState) => void;
}

function spawnGStreamerPipeline(options: GStreamerProcessOptions): ChildProcess {
  const gstProcess = spawn('gst-launch-1.0', ['-m', '-e', options.pipelineString], {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // -m flag causes level element messages to appear on stderr
  gstProcess.stderr.on('data', (data: Buffer) => {
    const text = data.toString();
    // Parse level messages vs debug/error output
    parseLevelMessages(text, options.onLevelMessage);
    parseErrorMessages(text, options.onError);
  });

  gstProcess.on('exit', (code, signal) => {
    options.onStateChange(code === 0 ? 'stopped' : 'crashed');
  });

  return gstProcess;
}
```

### Pattern 2: Pipeline String Construction
**What:** Build GStreamer pipeline strings dynamically based on source type and channel configuration.
**When to use:** When starting any capture pipeline.
**Example:**
```typescript
// AES67 multicast receive pipeline
function buildAes67Pipeline(
  multicastAddress: string,
  port: number,
  sampleRate: number,
  channels: number,
  selectedChannel: number,  // 0-based index for channel selection
  payloadType: number,
): string {
  // Base receive pipeline
  let pipeline = `udpsrc address=${multicastAddress} port=${port} ` +
    `caps="application/x-rtp, clock-rate=${sampleRate}, channels=${channels}, payload=${payloadType}" ` +
    `buffer-size=65536 ! ` +
    `rtpjitterbuffer latency=5 ! `;

  // Depayloader depends on bit depth (L24 is standard AES67)
  pipeline += `rtpL24depay ! `;

  // Channel selection from multichannel stream
  if (channels > 1) {
    pipeline += `deinterleave name=d ` +
      `d.src_${selectedChannel} ! queue ! `;
  }

  // Resampling + level metering
  pipeline += `audioconvert ! audioresample ! ` +
    `level interval=100000000 post-messages=true ! ` +
    `fakesink sync=false`;

  return pipeline;
}

// WASAPI capture pipeline
function buildWasapiPipeline(
  deviceId: string,
  lowLatency: boolean,
): string {
  return `wasapi2src device="${deviceId}" low-latency=${lowLatency} ! ` +
    `audioconvert ! audioresample ! ` +
    `level interval=100000000 post-messages=true ! ` +
    `fakesink sync=false`;
}

// ASIO capture pipeline
function buildAsioPipeline(
  deviceClsid: string,
  inputChannels: string,  // e.g., "0,1" for channels 0 and 1
  bufferSize: number,
): string {
  return `asiosrc device-clsid="${deviceClsid}" ` +
    `input-channels="${inputChannels}" ` +
    `buffer-size=${bufferSize} ! ` +
    `audioconvert ! audioresample ! ` +
    `level interval=100000000 post-messages=true ! ` +
    `fakesink sync=false`;
}

// DirectSound capture pipeline (fallback)
function buildDirectSoundPipeline(deviceName: string): string {
  return `directsoundsrc device-name="${deviceName}" ! ` +
    `audioconvert ! audioresample ! ` +
    `level interval=100000000 post-messages=true ! ` +
    `fakesink sync=false`;
}
```

### Pattern 3: SAP Discovery Listener
**What:** UDP multicast listener on 224.2.127.254:9875 that receives SAP packets, extracts SDP content, and maintains a registry of discovered AES67 streams.
**When to use:** On application startup (auto-scan), running continuously.
**Example:**
```typescript
// Source: RFC 2974 (SAP), sdp-transform docs
import dgram from 'node:dgram';
import { parse as parseSdp } from 'sdp-transform';

const SAP_MULTICAST_ADDRESS = '224.2.127.254';
const SAP_PORT = 9875;
const SAP_HEADER_MIN_LENGTH = 8;

interface SapPacket {
  version: number;
  isAnnouncement: boolean;  // true = announcement, false = deletion
  hash: number;
  originAddress: string;
  sdpContent: string;
}

function parseSapPacket(buffer: Buffer): SapPacket | null {
  if (buffer.length < SAP_HEADER_MIN_LENGTH) return null;

  const firstByte = buffer[0];
  const version = (firstByte >> 5) & 0x07;
  const isAnnouncement = ((firstByte >> 2) & 0x01) === 0;  // T bit: 0=announcement, 1=deletion
  const hash = buffer.readUInt16BE(2);
  const originAddress = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`;

  // Find SDP content after "application/sdp\0" or just after header
  const headerEnd = buffer.indexOf('\0', SAP_HEADER_MIN_LENGTH);
  const sdpStart = headerEnd >= 0 ? headerEnd + 1 : SAP_HEADER_MIN_LENGTH;
  const sdpContent = buffer.subarray(sdpStart).toString('utf-8');

  return { version, isAnnouncement, hash, originAddress, sdpContent };
}

function startSapListener(networkInterface: string): dgram.Socket {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.bind(SAP_PORT, () => {
    socket.addMembership(SAP_MULTICAST_ADDRESS, networkInterface);
  });

  socket.on('message', (buffer, rinfo) => {
    const sapPacket = parseSapPacket(buffer);
    if (!sapPacket) return;

    const sdp = parseSdp(sapPacket.sdpContent);
    // Extract AES67 stream info: name, multicast address, port, sample rate, channels, codec
    // Update source registry
  });

  return socket;
}
```

### Pattern 4: Device Enumeration via gst-device-monitor-1.0
**What:** Run `gst-device-monitor-1.0 Audio/Source -f json` as a child process, parse JSON output, filter Bluetooth devices, categorize by API.
**When to use:** On startup and periodically for hot-plug detection.
**Example:**
```typescript
import { execFile } from 'node:child_process';

interface GstDevice {
  name: string;
  deviceClass: string;
  api: string;          // 'wasapi2', 'asio', 'directsound'
  deviceId: string;     // device path / CLSID
  sampleRate: number;
  bitDepth: number;
  channelCount: number;
  isLoopback: boolean;
}

function enumerateAudioDevices(): Promise<GstDevice[]> {
  return new Promise((resolve, reject) => {
    execFile('gst-device-monitor-1.0', ['Audio/Source', '-f', 'json'], (error, stdout) => {
      if (error) return reject(error);
      const devices = parseGstDeviceOutput(stdout);
      // Filter out Bluetooth devices
      const filtered = devices.filter(d => !isBluetoothDevice(d));
      resolve(filtered);
    });
  });
}
```

### Pattern 5: Level Metering from GStreamer Bus Messages
**What:** Parse audio level data from gst-launch-1.0 stderr when using `-m` flag with the `level` element.
**When to use:** Every pipeline -- level element is always in the pipeline chain.
**Example:**
```typescript
// Level messages from gst-launch-1.0 -m look like:
// level, endtime=(guint64)100000000, timestamp=(guint64)0, ...
//   peak=(double){ -12.5, -14.2 }, rms=(double){ -18.3, -20.1 }, decay=(double){ -13.0, -15.0 }
// Format varies; the key fields are peak and rms arrays per channel

interface AudioLevels {
  peak: number[];     // dB per channel
  rms: number[];      // dB per channel
  decay: number[];    // dB per channel
  timestamp: number;
}

// Regex patterns for parsing level messages from stderr
const LEVEL_MESSAGE_REGEX = /level,.*?peak=\(double\)\{?\s*([-\d.e+]+(?:,\s*[-\d.e+]+)*)\s*\}?.*?rms=\(double\)\{?\s*([-\d.e+]+(?:,\s*[-\d.e+]+)*)\s*\}?/;

function parseLevelMessage(line: string): AudioLevels | null {
  const match = line.match(LEVEL_MESSAGE_REGEX);
  if (!match) return null;

  const peak = match[1].split(',').map(s => parseFloat(s.trim()));
  const rms = match[2].split(',').map(s => parseFloat(s.trim()));

  return { peak, rms, decay: [], timestamp: Date.now() };
}

// Convert dB to normalized 0.0-1.0 range for display
function dbToNormalized(db: number): number {
  // -60 dB = silence, 0 dB = max
  return Math.max(0, Math.min(1, Math.pow(10, db / 20)));
}
```

### Anti-Patterns to Avoid

- **Single GStreamer process for all channels:** Violates fault isolation requirement. One crash takes down everything.
- **Using gstreamer-superficial native binding:** Incomplete, unmaintained, requires native compilation, and binds GStreamer into the Node.js process (no fault isolation).
- **Parsing device list from text output:** Use `-f json` flag on gst-device-monitor-1.0 for reliable parsing.
- **Joining all discovered multicast groups:** CONTEXT.md explicitly says "join on demand only." Never join until a source is actually used by an app channel.
- **Blocking the Node.js event loop with synchronous process operations:** Always use async spawn/execFile.
- **Hard-coding pipeline strings:** Build them dynamically from source configuration -- different APIs (wasapi2, asio, directsoundsrc) need different elements and properties.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SDP parsing | Custom SDP parser | `sdp-transform` (npm) | RFC4566 grammar built-in, handles edge cases, MIT licensed, 302+ dependents |
| Process CPU/memory monitoring | Manual wmic/procfs calls | `pidusage` (npm) | Cross-platform, handles Windows wmic + Linux procfs, no native deps |
| Audio resampling | Manual sample rate conversion | GStreamer `audioresample` element | Sinc-table interpolation, handles all rate conversions, CPU-optimized |
| Channel deinterleaving | Manual PCM buffer splitting | GStreamer `deinterleave` element | Handles all formats, integrates with pipeline, no buffer management |
| Multicast group management | Manual socket creation | GStreamer `udpsrc` auto-multicast | Handles IGMP join/leave automatically |
| mDNS/Bonjour discovery | Custom mDNS implementation | `bonjour-service` (already in deps) | Already working in Phase 1, handles mDNS/DNS-SD browsing |
| SAP packet format | Custom binary parser | Manual parse of 8-byte header | SAP is simple enough (8-byte header + SDP text) that a library is overkill, but SDP inside MUST use sdp-transform |
| Audio level normalization | Custom dB math | GStreamer `level` element | Handles peak, RMS, decay with configurable interval, per-channel |

**Key insight:** The GStreamer pipeline chain handles all audio DSP. Node.js is only the orchestrator -- it spawns processes, parses their output, manages lifecycle, and broadcasts state via WebSocket. Never do audio processing in Node.js.

## Common Pitfalls

### Pitfall 1: Windows multicast-iface Ignored
**What goes wrong:** On Windows, the `multicast-iface` property on `udpsrc` is silently ignored. GStreamer uses the default network interface, which may not be the Dante/AES67 network.
**Why it happens:** Known GStreamer bug (Issue #472 on gst-plugins-good), Windows socket API handles multicast group joins differently.
**How to avoid:** Ensure the Dante/AES67 network interface has the lowest route metric (highest priority) on the system, OR use the Windows `route` command to add a specific multicast route for 239.0.0.0/8 pointing at the correct interface. Document this as a deployment requirement. Alternatively, pass a pre-configured socket via the `socket` property on `udpsrc`.
**Warning signs:** AES67 streams discovered by SAP but no audio data received; pipeline starts but level meters show silence.
**Confidence:** HIGH (confirmed in GStreamer issue tracker)

### Pitfall 2: ASIO Exclusive Access Conflicts
**What goes wrong:** ASIO devices can only be opened by one application at a time. If Dante Controller or another app has the device open, GStreamer ASIO pipeline fails to start.
**Why it happens:** ASIO API design is inherently exclusive-access.
**How to avoid:** Show clear warning when admin selects ASIO source. Detect pipeline start failure with ASIO-specific error message and surface "Device in use by another application" to the admin. Offer WASAPI as automatic fallback.
**Warning signs:** Pipeline fails immediately on start with device-busy errors.
**Confidence:** HIGH

### Pitfall 3: GStreamer Pipeline State Corruption on Restart
**What goes wrong:** Setting a GStreamer pipeline to NULL state and back to PLAYING doesn't always fully reset internal element state, leading to silent failures.
**Why it happens:** Some elements don't properly reset their internal state during state changes.
**How to avoid:** ALWAYS kill the child process and spawn a new one for restarts. Never try to reuse a gst-launch-1.0 process by sending state change signals. The process-per-source architecture naturally avoids this.
**Warning signs:** Pipeline reports PLAYING state but no audio flows (level meters silent).
**Confidence:** HIGH (widely documented in GStreamer forums)

### Pitfall 4: SAP Announcement Interval Can Be Up to 300 Seconds
**What goes wrong:** After startup, it can take up to 5 minutes to discover all AES67 streams via SAP because the protocol limits announcement bandwidth to 4000 bps across all announcers.
**Why it happens:** RFC 2974 requires cooperative bandwidth sharing. With many streams, announcement intervals increase.
**How to avoid:** Persist discovered streams between restarts (already decided in CONTEXT.md). On startup, load cached streams and mark as "verifying", then update status as SAP announcements arrive. Also implement IGMP query to actively probe for streams faster.
**Warning signs:** Admin sees "No streams found" for minutes after launch.
**Confidence:** HIGH (RFC 2974 specification)

### Pitfall 5: stderr Buffer Overflow Kills Level Metering
**What goes wrong:** If Node.js doesn't read from the child process stderr fast enough, the 24KB buffer fills up, and the process either blocks or the `close` event never fires.
**Why it happens:** GStreamer with `-m` flag produces continuous level messages on stderr. High-frequency metering (33ms interval) generates a lot of data.
**How to avoid:** Always attach `data` event listener on stderr immediately. Use streaming line-by-line parsing (not accumulate-and-split). Consider throttling level message processing on the Node.js side.
**Warning signs:** Pipeline process hangs; no exit event despite sending SIGTERM.
**Confidence:** HIGH (documented Node.js behavior)

### Pitfall 6: WASAPI Loopback Captures from Muted Devices
**What goes wrong:** When using wasapi2src with `loopback=true`, audio is captured even when the system device is muted, leading to confusing behavior.
**Why it happens:** WASAPI loopback API captures the raw audio stream before the mute is applied.
**How to avoid:** Document this behavior clearly. The admin needs to understand that WASAPI loopback captures the raw output regardless of system volume/mute state.
**Warning signs:** Admin mutes system volume but loopback source still shows audio levels.
**Confidence:** HIGH (confirmed in GStreamer issue tracker #1306)

### Pitfall 7: PTP Clock on Windows Has Limited Support
**What goes wrong:** GStreamer's PTP clock support (`gst-ptp-helper`) requires elevated privileges and may not work reliably on Windows without additional configuration.
**Why it happens:** PTP uses privileged ports (319, 320) and Windows doesn't have native PTP stack like Linux.
**How to avoid:** For Phase 2, use `rtpjitterbuffer` with appropriate latency settings instead of PTP clock synchronization. PTP sync is mainly needed for multi-device sync which is a Phase 3+ concern. The jitter buffer handles single-stream reception adequately.
**Warning signs:** Pipeline fails to start with PTP-related errors.
**Confidence:** MEDIUM (sparse documentation, flagged as research gap in STATE.md)

### Pitfall 8: DirectSound 200ms Minimum Latency
**What goes wrong:** DirectSound source has at minimum 200ms latency on modern Windows because it's an emulation layer on top of WASAPI since Vista.
**Why it happens:** DirectSound was deprecated in Windows Vista, replaced by WASAPI. The DirectSound API now uses a compatibility layer.
**How to avoid:** Use DirectSound only as a last-resort fallback. Priority order: ASIO > wasapi2 > directsoundsrc. The CONTEXT.md already specifies this priority order.
**Warning signs:** Audio from DirectSound sources has noticeable delay compared to WASAPI/ASIO sources.
**Confidence:** HIGH (documented by GStreamer developers)

## Code Examples

### Complete AES67 Receive Pipeline
```bash
# Source: Collabora blog + GStreamer docs
# Receive AES67 48kHz 24-bit stereo stream
gst-launch-1.0 -m \
  udpsrc address=239.69.0.121 port=5004 \
    caps="application/x-rtp, clock-rate=48000, channels=2, payload=98" \
    buffer-size=65536 ! \
  rtpjitterbuffer latency=5 ! \
  rtpL24depay ! \
  audioconvert ! \
  level interval=100000000 post-messages=true ! \
  fakesink sync=false
```

### WASAPI Capture with Level Metering
```bash
# Source: GStreamer wasapi2src docs
# Capture from specific WASAPI device with low latency
gst-launch-1.0 -m \
  wasapi2src device="\\?\SWD#MMDEVAPI#{...}" low-latency=true ! \
  audioconvert ! audioresample ! \
  level interval=100000000 post-messages=true ! \
  fakesink sync=false
```

### WASAPI Loopback Capture
```bash
# Source: GStreamer wasapi2src docs
# Capture system audio output ("what you hear")
gst-launch-1.0 -m \
  wasapi2src loopback=true ! \
  audioconvert ! audioresample ! \
  level interval=100000000 post-messages=true ! \
  fakesink sync=false
```

### ASIO Capture with Channel Selection
```bash
# Source: GStreamer asiosrc docs
# Capture channels 0,1 from ASIO device
gst-launch-1.0 -m \
  asiosrc device-clsid="{...guid...}" input-channels="0,1" buffer-size=256 ! \
  audioconvert ! audioresample ! \
  level interval=100000000 post-messages=true ! \
  fakesink sync=false
```

### Channel Selection from Multi-Channel AES67 Stream
```bash
# Source: GStreamer deinterleave docs
# Receive 64-channel Dante stream, extract channel 3 (0-indexed)
gst-launch-1.0 -m \
  udpsrc address=239.69.0.121 port=5004 \
    caps="application/x-rtp, clock-rate=48000, channels=64, payload=98" ! \
  rtpjitterbuffer latency=5 ! \
  rtpL24depay ! \
  deinterleave name=d \
  d.src_3 ! queue ! \
  audioconvert ! audioresample ! \
  level interval=100000000 post-messages=true ! \
  fakesink sync=false
```

### Stereo Pair Selection from Multi-Channel Stream
```bash
# Select channels 4,5 as a stereo pair from a 64-channel stream
gst-launch-1.0 -m \
  udpsrc address=239.69.0.121 port=5004 \
    caps="application/x-rtp, clock-rate=48000, channels=64, payload=98" ! \
  rtpjitterbuffer latency=5 ! \
  rtpL24depay ! \
  deinterleave name=d \
  d.src_4 ! queue ! interleave name=i \
  d.src_5 ! queue ! i. \
  i. ! audioconvert ! audioresample ! \
  level interval=100000000 post-messages=true ! \
  fakesink sync=false
```

### Audio Monitor Output (Route to Specific Output Device)
```bash
# Source: GStreamer wasapi2sink docs
# Tee the audio to both fakesink (for metering) and a real output device
gst-launch-1.0 -m \
  wasapi2src device="..." low-latency=true ! \
  audioconvert ! audioresample ! \
  tee name=t \
  t. ! queue ! level interval=100000000 post-messages=true ! fakesink sync=false \
  t. ! queue ! wasapi2sink device="..." low-latency=true
```

### Device Enumeration
```bash
# List all audio source devices as JSON
gst-device-monitor-1.0 Audio/Source -f json

# List all audio sink devices as JSON (for monitor output selection)
gst-device-monitor-1.0 Audio/Sink -f json
```

## Claude's Discretion Recommendations

### Stream Discovery: Auto-Scan (Recommended)
**Recommendation:** Use continuous auto-scan. Start SAP listener on application startup. Persist discovered streams and re-verify on launch.
**Rationale:** SAP announcements can take up to 5 minutes due to RFC 2974 bandwidth limits. Starting early ensures streams are available when the admin needs them. On-demand scanning would cause frustrating delays. Auto-scan with persistence gives the best UX -- streams appear instantly from cache, with live verification happening in the background.

### Channel Labels from AES67 Metadata
**Recommendation:** Display SDP session name (`s=` field) as the stream name, and SDP information (`i=` field) as description if available. For individual channels within a multi-channel stream, show "Channel N" with metadata labels from the `a=label:` attribute if present in the SDP. Fall back to "Ch 1", "Ch 2", etc.
**Rationale:** Dante Controller populates the SDP session name field with meaningful names. The label attribute is part of RFC 4574 and some devices use it. Using both gives the best labeling with graceful fallback.

### Stereo Pair Preview Meters: Dual L/R
**Recommendation:** Show dual L/R meters for stereo pair previews. Two thin vertical bars side by side, labeled L and R.
**Rationale:** Stereo pair monitoring requires seeing channel balance. A single combined meter hides phase issues and L/R imbalances which are common problems in church audio setups.

### Buffer Size Configuration
**Recommendation:** Default to 0 (let GStreamer/driver auto-select optimal buffer size). Provide an advanced setting override in the source configuration with common presets: 64, 128, 256, 512, 1024 samples. Only expose this for ASIO devices where buffer size significantly impacts latency.
**Rationale:** Auto-detect works well for WASAPI (which handles buffering internally). ASIO is where buffer size matters most -- too small causes glitches, too large adds latency. The presets cover the practical range. DirectSound buffer size is not configurable (fixed by the emulation layer).

### Source Switch Behavior: Instant Cut
**Recommendation:** Use instant cut (no crossfade) when switching sources on a live channel.
**Rationale:** Crossfade adds complexity (requires two simultaneous pipelines during transition) and can create confusing audio artifacts when switching between very different sources (e.g., switching from a Dante stream to a local mic). Instant cut is clean, predictable, and matches what hardware audio mixers do. Crossfade can be reconsidered in a future phase if users request it.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| wasapisrc (WASAPI v1) | wasapi2src (WASAPI v2) | GStreamer 1.18 | wasapi2 is default for Win 8+, has loopback, device provider, continue-on-error |
| External ASIO SDK required | ASIO plugin ships without SDK | GStreamer 1.26 (March 2025) | ASIO now included in official Windows binaries, no build-from-source needed |
| GCC 8.2 for MinGW builds | GCC 14.2 for MinGW builds | GStreamer 1.26 | More plugins available in MinGW builds, including ASIO |
| directsoundsrc default | wasapi2src preferred | GStreamer 1.18+ | DirectSound is deprecated since Vista, 200ms min latency, WASAPI is 10ms |
| Manual PTP setup | rtpjitterbuffer handles timing | Current | PTP sync optional for single-stream reception; jitter buffer sufficient for Phase 2 |

**Deprecated/outdated:**
- **directsoundsrc:** Still works but 200ms minimum latency. Use only as last-resort fallback.
- **wasapisrc (v1):** Superseded by wasapi2src. Use wasapi2src for all new development.
- **gstreamer-superficial npm binding:** Last meaningful update years ago, incomplete API, requires native compilation.

## Open Questions

1. **GStreamer Device Monitor hot-plug on Windows**
   - What we know: wasapi2 plugin mentions "DeviceWatcher interface" for runtime add/remove, but GStreamer DeviceMonitor may not reliably emit device-added/device-removed events on Windows.
   - What's unclear: Whether gst-device-monitor-1.0 supports `--follow` mode reliably on Windows with wasapi2 devices.
   - Recommendation: Implement polling-based device enumeration (run gst-device-monitor-1.0 every 3-5 seconds) rather than relying on real-time notifications. Compare results to detect added/removed devices. This is more reliable cross-platform.

2. **ASIO Device CLSID Discovery**
   - What we know: asiosrc requires a `device-clsid` (GUID string). gst-device-monitor-1.0 should list ASIO devices when the plugin is available.
   - What's unclear: Exact property name in gst-device-monitor JSON output for ASIO device CLSIDs.
   - Recommendation: Test with actual hardware. The CLSID should appear in device properties. If not, Windows registry at `HKEY_LOCAL_MACHINE\SOFTWARE\ASIO` contains ASIO device CLSIDs as a fallback discovery mechanism.

3. **gst-launch-1.0 -m output format consistency across platforms**
   - What we know: Level messages contain peak, rms, decay as double values. The exact text format may vary between GStreamer versions.
   - What's unclear: Whether the format is stable/documented or could change between minor versions.
   - Recommendation: Write robust regex parsing with fallback patterns. Test with GStreamer 1.26 on Windows specifically. Consider using GST_DEBUG environment variable to control verbosity and reduce noise in stderr output.

4. **Multicast route configuration automation on Windows**
   - What we know: multicast-iface is broken on Windows for udpsrc. Manual route configuration works.
   - What's unclear: Whether we can programmatically add a multicast route via `route add` from the sidecar, and whether this requires admin privileges.
   - Recommendation: Research in early Phase 2 tasks. If admin elevation is needed, use the same VBS+UAC pattern from Phase 1 (trusted CA installation). Document as deployment step if automation fails.

5. **L16 vs L24 depayloader selection**
   - What we know: AES67 standard supports both L16 (16-bit) and L24 (24-bit). Dante typically uses L24. The SDP `a=rtpmap:` line specifies which.
   - What's unclear: Whether GStreamer can auto-negotiate between rtpL16depay and rtpL24depay based on caps.
   - Recommendation: Parse the SDP rtpmap attribute to determine codec, then construct the appropriate pipeline string with the correct depayloader. Do not rely on auto-negotiation.

## Sources

### Primary (HIGH confidence)
- [GStreamer wasapi2src docs](https://gstreamer.freedesktop.org/documentation/wasapi2/wasapi2src.html) - Element properties, loopback, device selection
- [GStreamer asiosrc docs](https://gstreamer.freedesktop.org/documentation/asio/asiosrc.html) - ASIO element properties, CLSID, channels
- [GStreamer level element docs](https://gstreamer.freedesktop.org/documentation/level/index.html) - Metering properties, message format
- [GStreamer udpsrc docs](https://gstreamer.freedesktop.org/documentation/udp/udpsrc.html) - Multicast reception properties
- [GStreamer 1.26 release notes](https://gstreamer.freedesktop.org/releases/1.26/) - ASIO SDK dropped, MinGW upgrades
- [GStreamer gst-launch-1.0 docs](https://gstreamer.freedesktop.org/documentation/tools/gst-launch.html) - CLI flags including -m for bus messages
- [RFC 2974 - Session Announcement Protocol](https://datatracker.ietf.org/doc/html/rfc2974) - SAP specification: 224.2.127.254:9875, packet format
- [Node.js child_process docs](https://nodejs.org/api/child_process.html) - spawn, stdio handling, process management
- [Node.js dgram docs](https://nodejs.org/api/dgram.html) - UDP multicast socket, addMembership

### Secondary (MEDIUM confidence)
- [Collabora: Receiving AES67 with GStreamer](https://www.collabora.com/news-and-blog/blog/2017/04/25/receiving-an-aes67-stream-with-gstreamer/) - AES67 pipeline patterns, verified with official docs
- [AES67 GStreamer examples by philhartung](https://gist.github.com/philhartung/6f2905ea566bf5dbf5b0b3298008d1d3) - Real-world AES67 pipelines, verified patterns
- [philhartung/aes67-monitor](https://github.com/philhartung/aes67-monitor) - SAP discovery reference implementation
- [sdp-transform npm](https://www.npmjs.com/package/sdp-transform) - SDP parser, v3.0.0, MIT license
- [pidusage npm](https://www.npmjs.com/package/pidusage) - Cross-platform process monitoring
- [GStreamer multicast-iface Windows bug #472](https://gitlab.freedesktop.org/gstreamer/gst-plugins-good/-/issues/472) - Confirmed Windows limitation
- [parse-gst-device-monitor](https://github.com/transitiverobotics/parse-gst-device-monitor) - Reference for JSON output parsing
- [GStreamer directsoundsrc docs](https://gstreamer.freedesktop.org/documentation/directsoundsrc/index.html) - DirectSound element, 200ms latency note

### Tertiary (LOW confidence)
- [GStreamer Discourse: ASIO plugins availability](https://discourse.gstreamer.org/t/where-are-asio-plugins/2208) - Community discussion, some info may be outdated
- [GStreamer Discourse: Device Monitor bug](https://discourse.gstreamer.org/t/gstreamer-device-monitor-bug/4811) - Hot-plug notification issues, unconfirmed resolution
- [coaxion.net: RTP/PTP in GStreamer](https://coaxion.net/blog/2017/04/rtp-for-broadcasting-over-ip-use-cases-in-gstreamer-ptp-rfc7273-for-ravenna-aes67-smpte-2022-smpte-2110/) - PTP patterns, older but still relevant architecture

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - GStreamer 1.26 is well-documented, all elements verified in official docs
- Architecture (child process per source): HIGH - Already decided, well-established Node.js pattern
- SAP discovery: MEDIUM - RFC is clear, Node.js dgram is solid, but real-world AES67 SAP packet variations need testing
- ASIO support: MEDIUM - GStreamer 1.26 ships it, but no hands-on validation yet with actual ASIO hardware
- Windows multicast quirk: HIGH - Confirmed bug, workarounds documented
- Device enumeration: MEDIUM - gst-device-monitor JSON output verified to exist, but hot-plug reliability uncertain
- Level metering parsing: MEDIUM - Element is well-documented, but exact stderr format from gst-launch-1.0 -m needs validation
- Pitfalls: HIGH - Multiple sources confirm each pitfall

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (GStreamer 1.26 stable, patterns unlikely to change)
