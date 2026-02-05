# Architecture Research

**Domain:** Church Audio Streaming / Dante-to-WebRTC Restreaming
**Researched:** 2026-02-05
**Confidence:** MEDIUM-HIGH

## Standard Architecture

### System Overview

```
+------------------------------------------------------------------+
|  DESKTOP APPLICATION (Electron)                                  |
|                                                                  |
|  +---------------------------+   +----------------------------+  |
|  | RENDERER PROCESS          |   | MAIN PROCESS (Node.js)     |  |
|  | (Admin Dashboard UI)      |   |                            |  |
|  |                           |<->| - App lifecycle            |  |
|  | - VU meters               |   | - Config management        |  |
|  | - Channel management      |   | - Process orchestration    |  |
|  | - Listener stats          |   | - System tray              |  |
|  | - Settings panels         |   |                            |  |
|  +---------------------------+   +---+----+---+---------------+  |
|                                      |    |   |                  |
|         IPC (Electron IPC)    +------+    |   +------+           |
|                               |           |          |           |
|  +----------------------------v--+  +-----v-----+ +-v--------+  |
|  | MEDIASOUP SFU                 |  | WEB SERVER | | GSTREAMER|  |
|  | (in-process Node.js)          |  | (Express)  | | PIPELINES|  |
|  |                               |  |            | | (child   |  |
|  | - Router per channel          |  | - PWA UI   | |  procs)  |  |
|  | - PlainTransport (GStr input) |  | - Signaling| |          |  |
|  | - WebRtcTransport (listeners) |  | - REST API | | - AES67  |  |
|  | - Producer per channel        |  | - WebSocket| |   capture |  |
|  | - Consumer per listener       |  |            | | - RNNoise|  |
|  +---+---------------------------+  +-----+------+ | - Opus   |  |
|      |                                    |         |   encode |  |
|      |        RTP (localhost UDP)          |         +----+-----+  |
|      +<-----------------------------------+--------------+        |
+------------------------------------------------------------------+
         |  WebRTC (UDP)              | HTTP/WS
         v                            v
+------------------+     +----------------------+
| LISTENER PHONES  |     | LISTENER BROWSERS    |
| (WebRTC audio)   |     | (PWA Web UI)         |
+------------------+     +----------------------+

NETWORK INPUT:
+-------------------+
| DANTE / AES67     |    Multicast RTP (L24 PCM)
| Audio Network     +--->  224.x.x.x:port
| (Church mixer)    |      per channel/language
+-------------------+
```

### Component Responsibilities

| Component | Responsibility | Runtime | Talks To |
|-----------|---------------|---------|----------|
| **Main Process** | App lifecycle, config, process orchestration, system tray | Node.js (Electron main) | All components |
| **Renderer Process** | Admin dashboard UI, VU meters, stats display | Chromium (Electron renderer) | Main Process via IPC |
| **GStreamer Pipelines** | AES67 capture, audio processing, Opus encoding, RTP output | Child processes (gst-launch-1.0) | Network (AES67 input), mediasoup (RTP output) |
| **mediasoup SFU** | WebRTC room management, RTP routing, transport management | In-process Node.js library | GStreamer (RTP input), Listeners (WebRTC output), Web Server (signaling) |
| **Web Server** | Serve PWA, WebSocket signaling, REST API for admin | Express.js (in main process) | Renderer (API), mediasoup (signaling bridge), Browsers (HTTP/WS) |
| **Config Manager** | Settings persistence, validation, import/export | Node.js module | Main Process, all components read config |

## Recommended Project Structure

```
ChurchAudioStream/
  src/
    main/                          # Electron main process
      index.ts                     # App entry, lifecycle
      ipc-handlers.ts              # IPC bridge to renderer
      tray.ts                      # System tray management
      auto-updater.ts              # Update notifications

    renderer/                      # Admin dashboard (React/Svelte)
      App.tsx
      pages/
        Dashboard.tsx              # VU meters, status overview
        Channels.tsx               # Channel config, per-channel settings
        Settings.tsx               # Global settings, network config
        Statistics.tsx             # Listener graphs, history
      components/
        VuMeter.tsx                # Real-time audio level display
        ChannelCard.tsx            # Per-channel controls
        ListenerCount.tsx          # Live listener badge
      hooks/
        useIpc.ts                  # Electron IPC abstraction
        useAudioLevels.ts          # VU meter data subscription

    server/                        # Web server + signaling
      index.ts                     # Express app setup
      routes/
        api.ts                     # REST API for admin
        signaling.ts               # WebSocket signaling for WebRTC
      middleware/
        cors.ts
        error-handler.ts

    sfu/                           # mediasoup integration
      index.ts                     # Worker/Router lifecycle
      room-manager.ts              # Channel-to-Room mapping
      plain-transport.ts           # GStreamer RTP ingestion
      webrtc-transport.ts          # Listener connections
      producer-manager.ts          # Audio producers (one per channel)
      consumer-manager.ts          # Audio consumers (one per listener)

    audio/                         # GStreamer pipeline management
      pipeline-manager.ts          # Spawn/monitor GStreamer child procs
      pipeline-builder.ts          # Construct gst-launch arguments
      aes67-source.ts              # AES67 multicast RTP source config
      processing-chain.ts          # RNNoise, normalization, EQ params
      opus-encoder.ts              # Opus encoding params
      level-monitor.ts             # Audio level extraction for VU meters

    config/                        # Configuration management
      store.ts                     # Read/write JSON config
      schema.ts                    # Config validation (Zod/JSON Schema)
      defaults.ts                  # Default configuration values
      migration.ts                 # Config version migration

    shared/                        # Shared types and utilities
      types.ts                     # TypeScript interfaces
      constants.ts                 # Shared constants
      events.ts                    # Event name definitions

  web-ui/                          # Listener PWA (separate build)
    src/
      App.tsx
      pages/
        Welcome.tsx                # Church branding, enter
        ChannelSelect.tsx          # Language/channel picker
        Player.tsx                 # Audio player, volume, mix
      lib/
        webrtc-client.ts           # mediasoup-client integration
        signaling.ts               # WebSocket signaling client
        audio-context.ts           # Web Audio API for mix/volume
        pwa.ts                     # Service worker, offline support
      service-worker.ts
      manifest.json

  resources/                       # App resources
    icons/
    default-config.json

  scripts/                         # Build and dev scripts
    build-web-ui.ts
    package-gstreamer.ts           # Bundle GStreamer for distribution
```

## Architectural Patterns

### Pattern 1: Child Process Pipeline Management

**What:** Each AES67 channel runs as an independent GStreamer child process. The Node.js main process spawns, monitors, and restarts these pipelines.

**Why:** Process isolation means one crashing pipeline does not take down the app or other channels. GStreamer pipelines are CPU-intensive; separate processes allow OS-level scheduling across cores.

**How it works:**

```
Main Process
  |
  +-- spawn("gst-launch-1.0", [...args])  -->  Channel 1 Pipeline (PID 1234)
  +-- spawn("gst-launch-1.0", [...args])  -->  Channel 2 Pipeline (PID 1235)
  +-- spawn("gst-launch-1.0", [...args])  -->  Channel 3 Pipeline (PID 1236)
  |
  +-- Monitor: restart on crash, log stderr, track health
```

Each pipeline outputs Opus-encoded RTP to a localhost UDP port that a mediasoup PlainTransport listens on.

**Example pipeline (one channel):**

```bash
gst-launch-1.0 \
  udpsrc address=239.x.x.x port=5004 \
    caps="application/x-rtp,media=audio,clock-rate=48000,encoding-name=L24,channels=2" \
  ! rtpjitterbuffer latency=5 \
  ! rtpL24depay \
  ! audioconvert \
  ! audioresample \
  ! audio/x-raw,rate=48000,channels=2,format=F32LE \
  ! audiornnoise \
  ! audiodynamic \
  ! volume volume=1.0 \
  ! level interval=100000000 \
  ! opusenc bitrate=128000 frame-size=10 \
  ! rtpopuspay pt=101 ssrc=11111 \
  ! udpsink host=127.0.0.1 port=20001
```

### Pattern 2: mediasoup In-Process with PlainTransport Ingestion

**What:** mediasoup runs as a Node.js library in the Electron main process. It receives audio from GStreamer via PlainTransport (localhost UDP) and serves it to listeners via WebRtcTransport.

**Why:** mediasoup is designed as a Node.js module. Running it in-process avoids an extra IPC layer. The C++ media workers are already separate processes managed by mediasoup internally. PlainTransport is the official way to ingest external RTP into mediasoup.

**How it works:**

```typescript
// Per channel setup (simplified)
const router = await worker.createRouter({ mediaCodecs });
const plainTransport = await router.createPlainTransport({
  listenInfo: { protocol: 'udp', ip: '127.0.0.1', port: 20001 },
  rtcpMux: false,
  comedia: true,
});
const producer = await plainTransport.produce({
  kind: 'audio',
  rtpParameters: {
    codecs: [{ mimeType: 'audio/opus', clockRate: 48000, channels: 2, payloadType: 101 }],
    encodings: [{ ssrc: 11111 }],
  },
});
```

### Pattern 3: Event-Driven Architecture with Typed Events

**What:** Components communicate through a typed event bus. Pipeline status, audio levels, listener counts, and config changes all flow as events.

**Why:** Decouples components. The VU meter does not need to know about GStreamer; it subscribes to `audio:level` events. The dashboard does not poll; it reacts to `listener:join` / `listener:leave` events.

**Key event flows:**

```
GStreamer stderr  -->  parse level messages  -->  emit("audio:level", { channel, dB })
mediasoup         -->  consumer created      -->  emit("listener:join", { channel, id })
Config change     -->  emit("config:changed", { key, value })
Pipeline crash    -->  emit("pipeline:error", { channel, error })
                  -->  auto-restart logic    -->  emit("pipeline:restarted", { channel })
```

### Pattern 4: Electron for Desktop GUI (Not Tauri)

**What:** Use Electron as the desktop framework rather than Tauri.

**Why this is the right call for this project:**

1. **mediasoup is a Node.js library.** It needs a Node.js runtime. Electron provides this natively. Tauri would require running a Node.js sidecar as a compiled binary, adding complexity and potential failure points.
2. **GStreamer child process management** is straightforward in Node.js via `child_process.spawn()`. Electron's main process handles this naturally.
3. **The app is a server, not just a GUI.** It runs an Express web server, WebSocket signaling, mediasoup workers, and GStreamer pipelines. Electron's Node.js main process is the natural home for all of this.
4. **Bundle size is acceptable.** This is a dedicated church machine, not a consumer app. The ~100MB installer is fine.
5. **Memory overhead is acceptable.** The app runs one instance on a dedicated or semi-dedicated machine. 200-300MB baseline is fine when the machine's primary job is audio streaming.

**When Tauri would be better:** If this were a lightweight client app with no Node.js backend requirements. It is not.

### Pattern 5: One mediasoup Worker, One Router per Channel

**What:** Use a single mediasoup Worker (or one per CPU core for larger deployments), with one Router per audio channel. Each Router has one PlainTransport (input from GStreamer) and N WebRtcTransports (one per listener on that channel).

**Why:** Routers are the isolation boundary in mediasoup. One Router per channel means channels are independent: a listener on Channel A does not affect Channel B. The Worker is the C++ process that does the actual packet forwarding.

```
Worker (C++ process)
  |
  +-- Router "English"
  |     +-- PlainTransport (from GStreamer, port 20001)
  |     |     +-- Producer (Opus audio)
  |     +-- WebRtcTransport (Listener 1)
  |     |     +-- Consumer (forwarded Opus)
  |     +-- WebRtcTransport (Listener 2)
  |           +-- Consumer (forwarded Opus)
  |
  +-- Router "Spanish"
  |     +-- PlainTransport (from GStreamer, port 20002)
  |     |     +-- Producer (Opus audio)
  |     +-- WebRtcTransport (Listener 3)
  |           +-- Consumer (forwarded Opus)
  |
  +-- Router "Main Mix"
        +-- PlainTransport (from GStreamer, port 20003)
              +-- Producer (Opus audio)
              (no listeners yet)
```

## Data Flow

### Audio Pipeline Flow (end-to-end)

```
Dante Mixer                    Desktop App                         Phone
+--------+    AES67/RTP     +--------------+   WebRTC/Opus     +--------+
|        | -- multicast --> | GStreamer     | -- UDP/DTLS ----> | Browser|
| Ch: EN |    L24 PCM       | Pipeline #1  |   via mediasoup   | WebAudio|
|        |    48kHz/24bit   |              |                   |        |
+--------+    239.x.x.x    | 1. Receive   |   mediasoup       | Decode |
              port 5004     | 2. Dejitter  |   PlainTransport  | Volume |
                            | 3. Depay     |   --> Producer    | Mix    |
                            | 4. RNNoise   |   --> Consumer    | Output |
                            | 5. Normalize |   --> WebRTC      |        |
                            | 6. Opus enc  |      Transport    +--------+
                            | 7. RTP pay   |
                            | 8. UDP send  |
                            |  -> 127.0.0.1|
                            +--------------+

Latency budget (target <100ms total):
  AES67 jitter buffer:     5ms
  Audio processing:       10ms
  Opus encoding (10ms):   10ms
  Local UDP transfer:     <1ms
  mediasoup forwarding:   <1ms
  WebRTC transport:      20-50ms (network dependent)
  Browser decode:         10ms
  Audio output buffer:    10ms
  --------------------------------
  TOTAL:                 ~65-95ms  (achievable on local WiFi)
```

### WebRTC Signaling Flow

```
Phone Browser                 Web Server              mediasoup SFU
     |                            |                        |
     |-- HTTP GET / ------------->|                        |
     |<-- PWA index.html --------|                        |
     |                            |                        |
     |-- WS connect ------------->|                        |
     |                            |                        |
     |-- "join" { channel } ----->|                        |
     |                            |-- createWebRtcTransport ->|
     |                            |<-- transport params ------|
     |<-- "transport-created" ----|                        |
     |                            |                        |
     |-- "connect-transport" ---->|                        |
     |   { dtlsParameters }      |-- transport.connect() --->|
     |                            |                        |
     |-- "consume" { channel } -->|                        |
     |                            |-- transport.consume() --->|
     |                            |<-- consumer params -------|
     |<-- "new-consumer" --------|                        |
     |   { rtpParameters }       |                        |
     |                            |                        |
     |== WebRTC audio flows =================================>|
     |                            |                        |
     |-- "switch-channel" ------->|                        |
     |   { newChannel }          |-- close old consumer ---->|
     |                            |-- new consume() -------->|
     |<-- "new-consumer" --------|                        |
```

### Configuration Flow

```
config.json (on disk)
     |
     +-- Read on startup --> Config Store (in memory)
     |                            |
     |                            +-- Validate (Zod schema)
     |                            +-- Apply defaults for missing keys
     |                            |
     |                            +-- Feed to: GStreamer pipeline args
     |                            +-- Feed to: mediasoup worker options
     |                            +-- Feed to: Web server bind address
     |                            +-- Feed to: Renderer (display settings)
     |                            |
     +-- Write on change <--------+-- Config change event
     |                            |
     +-- Export: JSON file download from Admin UI
     +-- Import: JSON file upload, validate, apply, restart affected components
```

**Config structure (key sections):**

```json
{
  "server": {
    "listenIp": "0.0.0.0",
    "port": 3000,
    "announcedIp": "192.168.1.100"
  },
  "channels": [
    {
      "id": "english",
      "name": "English",
      "aes67": {
        "multicastAddress": "239.69.1.1",
        "port": 5004,
        "sampleRate": 48000,
        "bitDepth": 24,
        "channelCount": 2
      },
      "processing": {
        "noiseCancellation": true,
        "normalization": { "enabled": true, "targetLufs": -16 },
        "eq": { "enabled": false, "preset": "voice" }
      },
      "opus": {
        "bitrate": 128000,
        "frameSize": 10
      },
      "visible": true,
      "order": 0
    }
  ],
  "webUi": {
    "churchName": "First Community Church",
    "welcomeMessage": "Welcome! Select your language.",
    "theme": "auto",
    "logoPath": null
  },
  "advanced": {
    "mediasoupWorkers": 1,
    "rtcMinPort": 40000,
    "rtcMaxPort": 49999,
    "jitterBuffer": 5,
    "autoStart": false
  }
}
```

## Scaling Considerations

| Concern | Small Church (50 listeners) | Medium Church (200 listeners) | Large Church (500+ listeners) |
|---------|----------------------------|------------------------------|-------------------------------|
| **mediasoup Workers** | 1 worker (single core) | 1-2 workers | 2-4 workers (one per core) |
| **UDP Port Range** | 100 ports sufficient | 500 ports | 2000+ ports |
| **Memory** | ~300MB total | ~500MB total | ~800MB-1GB total |
| **CPU** | Any modern dual-core | Quad-core recommended | Quad-core minimum, 8-core for headroom |
| **Network** | 100Mbps sufficient | Gigabit recommended | Gigabit required |
| **Bandwidth per listener** | ~130kbps (Opus 128k + overhead) | Same per listener | Same per listener |
| **Total bandwidth (3 ch, 200 listeners)** | N/A | ~78 Mbps outbound | ~195 Mbps for 500 |

**Key insight:** mediasoup is an SFU, not an MCU. It forwards packets without transcoding. CPU scales with number of listeners, not with audio complexity. The bottleneck for large churches is network bandwidth, not CPU.

## Anti-Patterns

### Anti-Pattern 1: Running mediasoup as a Separate Microservice

**What:** Splitting mediasoup into its own process/container, communicating with the main app over HTTP/gRPC.

**Why bad:** Adds latency, complexity, and a failure mode. mediasoup is designed to be an in-process library. Its C++ workers are already separate processes. Adding another layer of IPC on top creates unnecessary overhead for a single-machine deployment.

**Instead:** Run mediasoup as a library in the Electron main process. It manages its own worker processes internally.

### Anti-Pattern 2: Using GStreamer Node.js Bindings

**What:** Using `gstreamer-superficial` or similar bindings to run GStreamer in-process with Node.js.

**Why bad:** These bindings are unofficial, poorly maintained, and tie GStreamer's lifecycle to Node.js. A GStreamer crash would take down the entire app. The bindings also lag behind GStreamer releases.

**Instead:** Spawn GStreamer as child processes via `gst-launch-1.0`. Parse stdout/stderr for level data. Communicate audio via localhost UDP (which you need anyway for mediasoup PlainTransport).

### Anti-Pattern 3: WebRTC Peer-to-Peer (No SFU)

**What:** Having each listener connect directly to the audio source via peer-to-peer WebRTC.

**Why bad:** Each peer connection requires encoding and sending a separate stream. With 100 listeners, you need 100 outbound streams from the source. CPU and bandwidth explode linearly.

**Instead:** mediasoup SFU encodes once, forwards to all listeners. One inbound stream, N outbound forwards.

### Anti-Pattern 4: Polling for Audio Levels / Stats

**What:** Having the renderer poll the main process every 100ms for VU meter data.

**Why bad:** Polling introduces jitter, wastes IPC bandwidth, and couples the update rate to the poll interval.

**Instead:** Push audio levels from main process to renderer via Electron IPC events. GStreamer's `level` element emits messages on stderr at configurable intervals. Parse these, push to renderer.

### Anti-Pattern 5: Single GStreamer Pipeline for All Channels

**What:** Running all channels through one GStreamer pipeline with tee/deinterleave.

**Why bad:** One channel's issue (bad multicast, format mismatch) crashes the entire pipeline. Cannot restart individual channels. Cannot add/remove channels without restarting everything.

**Instead:** One GStreamer child process per channel. Independent lifecycle, independent failure domain.

### Anti-Pattern 6: Using Tauri with Node.js Sidecar

**What:** Choosing Tauri for smaller bundle size but then needing a Node.js sidecar for mediasoup.

**Why bad:** You end up with: Tauri (Rust) + Node.js sidecar (compiled binary) + IPC between them + mediasoup (needs Node.js) + GStreamer (child processes). The Tauri bundle size advantage disappears when you bundle a Node.js binary. The IPC between Tauri's Rust core and the Node.js sidecar adds latency and complexity. You are fighting the framework instead of using it.

**Instead:** Use Electron. mediasoup runs natively in Node.js. Web server runs natively in Node.js. GStreamer child processes spawn from Node.js. Everything is in its natural home.

## Integration Points

### Critical Integration: GStreamer to mediasoup (PlainTransport)

This is the most important integration point in the system. GStreamer outputs Opus-encoded RTP to a localhost UDP port. mediasoup's PlainTransport listens on that port.

**Must match exactly:**
- Opus codec parameters (48kHz, 2 channels)
- RTP payload type (must match what mediasoup Router's codec config expects)
- SSRC (must match what the Producer is configured with)
- Port numbers (GStreamer udpsink port = PlainTransport listen port)

**Verified approach** (from mediasoup demo's GStreamer broadcaster script):

```bash
# GStreamer side
opusenc bitrate=128000 ! rtpopuspay pt=101 ssrc=11111 ! udpsink host=127.0.0.1 port=20001
```

```typescript
// mediasoup side
const producer = await plainTransport.produce({
  kind: 'audio',
  rtpParameters: {
    codecs: [{
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2,
      payloadType: 101,
      parameters: { 'sprop-stereo': 1, useinbandfec: 1 }
    }],
    encodings: [{ ssrc: 11111 }]
  }
});
```

**Confidence:** HIGH -- this integration pattern is documented in the official mediasoup demo repository.

### Critical Integration: AES67 Multicast Reception

The machine must join the correct multicast groups to receive Dante/AES67 audio.

**Requirements:**
- Machine must be on the same VLAN as Dante devices (or have multicast routing)
- IGMP snooping must be configured on network switches
- PTP clock sync is handled by Dante Controller / network -- GStreamer uses `rtpjitterbuffer` to smooth timing
- SDP files or manual multicast address configuration needed per channel

**GStreamer receive pipeline:**

```bash
udpsrc address=239.69.1.1 port=5004 \
  caps="application/x-rtp,media=audio,clock-rate=48000,encoding-name=L24,channels=2" \
! rtpjitterbuffer latency=5 \
! rtpL24depay
```

**Confidence:** HIGH -- standard AES67 reception, documented by Collabora and multiple community implementations.

### Integration: Electron IPC (Main to Renderer)

**For real-time data (VU meters, listener counts):**
Use `ipcMain`/`ipcRenderer` with event push from main to renderer. Do not poll.

```typescript
// Main process: push audio levels
ipcMain.on('subscribe:audio-levels', (event) => {
  audioLevelEmitter.on('level', (data) => {
    event.sender.send('audio:level', data);
  });
});
```

**For config/commands (settings changes, start/stop):**
Use invoke/handle pattern for request-response.

```typescript
// Main process
ipcMain.handle('config:get', () => configStore.getAll());
ipcMain.handle('config:set', (_, key, value) => configStore.set(key, value));
```

### Integration: Web Server to mediasoup (Signaling)

The Express web server handles WebSocket connections from listener browsers. It translates signaling messages into mediasoup API calls.

**Pattern:** Thin signaling layer. The WebSocket handler is a bridge, not business logic.

```typescript
// WebSocket message -> mediasoup API call -> response back to client
ws.on('message', async (msg) => {
  const { action, data } = JSON.parse(msg);
  switch (action) {
    case 'createTransport':
      const transport = await router.createWebRtcTransport(transportOptions);
      ws.send(JSON.stringify({ action: 'transportCreated', data: transport.params }));
      break;
    case 'consume':
      const consumer = await transport.consume({ producerId, rtpCapabilities });
      ws.send(JSON.stringify({ action: 'newConsumer', data: consumer.params }));
      break;
  }
});
```

### Integration: GStreamer Audio Level to VU Meters

GStreamer's `level` element outputs peak and RMS levels on stderr/bus messages. The pipeline manager parses these and emits them as events.

```bash
# In pipeline: ... ! level interval=100000000 ! ...
# Outputs to stderr every 100ms:
# "level, peak=(double){ -12.5, -13.1 }, rms=(double){ -18.2, -19.0 }"
```

```typescript
// Pipeline manager parses stderr
gstreamerProcess.stderr.on('data', (data) => {
  const levelMatch = data.toString().match(/peak=\(double\)\{([^}]+)\}/);
  if (levelMatch) {
    const peaks = levelMatch[1].split(',').map(Number);
    emitter.emit('audio:level', { channel: channelId, peakL: peaks[0], peakR: peaks[1] });
  }
});
```

## Build Order (Dependencies)

The following order respects component dependencies:

```
Phase 1: Foundation
  - Config store (everything needs config)
  - Electron shell (app lifecycle, window management)
  - Basic IPC bridge

Phase 2: Audio Capture
  - GStreamer pipeline builder (construct CLI args from config)
  - Pipeline manager (spawn, monitor, restart child processes)
  - AES67 multicast reception (verify on real Dante network)
  - Audio level parsing (for VU meters later)

Phase 3: SFU + Streaming
  - mediasoup worker/router setup
  - PlainTransport (receive from GStreamer)
  - WebRtcTransport (serve to listeners)
  - Producer/Consumer management

Phase 4: Web Server + Signaling
  - Express server (serve static PWA files)
  - WebSocket signaling (transport negotiation)
  - REST API (admin endpoints for stats, config)

Phase 5: Listener Web UI (PWA)
  - mediasoup-client integration
  - Channel selection
  - Audio playback (Web Audio API)
  - Volume / mix controls
  - PWA manifest + service worker

Phase 6: Admin Dashboard
  - VU meters (real-time level display)
  - Channel management UI
  - Listener stats display
  - Settings panels

Phase 7: Audio Processing
  - RNNoise noise cancellation
  - Loudness normalization
  - EQ presets
  - Per-channel processing config

Phase 8: Polish + Robustness
  - Auto-reconnect (listeners)
  - Pipeline self-healing (auto-restart crashed GStreamer)
  - Config import/export
  - Auto-start on boot
  - Update notifications
  - Accessibility
  - Theming (light/dark/auto)
```

**Rationale for this order:**
- Config and Electron shell are prerequisites for everything.
- Audio capture must work before you can stream anything.
- SFU must work before listeners can connect.
- Web server must exist before the PWA can be served.
- PWA is needed to validate the end-to-end flow.
- Admin dashboard is quality-of-life, not blocking.
- Audio processing is additive (system works without it; it improves quality).
- Polish comes last because it depends on everything else being stable.

## Process Architecture Summary

```
[Electron Main Process]  (Node.js)
  |
  |-- mediasoup library (manages its own C++ worker processes)
  |     |-- mediasoup-worker (C++ child process, one per CPU core used)
  |
  |-- Express web server (in-process)
  |-- WebSocket server (in-process)
  |-- Config manager (in-process)
  |-- Pipeline manager (spawns/monitors):
  |     |-- gst-launch-1.0 (child process, Channel 1)
  |     |-- gst-launch-1.0 (child process, Channel 2)
  |     |-- gst-launch-1.0 (child process, Channel N)
  |
  |-- Electron Renderer Process (Chromium, Admin Dashboard)

Total processes for 3-channel setup:
  1 Electron main
  1 Electron renderer
  1-4 mediasoup workers
  3 GStreamer pipelines
  = 6-9 OS processes
```

This is a manageable process count. Each GStreamer pipeline uses one core efficiently. mediasoup workers are lightweight forwarding engines. The Electron processes are standard overhead.

## Sources

- [Collabora: Receiving an AES67 stream with GStreamer](https://www.collabora.com/news-and-blog/blog/2017/04/25/receiving-an-aes67-stream-with-gstreamer/)
- [AES67 Audio using GStreamer (StrongRandom)](https://strongrandom.com/post/aes67-gstreamer/)
- [mediasoup Official Documentation](https://mediasoup.org/documentation/overview/)
- [mediasoup Demo - GStreamer Broadcaster Script](https://github.com/versatica/mediasoup-demo/blob/v3/broadcasters/gstreamer.sh)
- [mediasoup Discourse: GStreamer PlainTransport](https://mediasoup.discourse.group/t/gstreamer-send-rtp-plaintransport/2338)
- [mediasoup Discourse: PlainTransport + GStreamer Opus](https://mediasoup.discourse.group/t/gstreamer-plaintransport-send-opus/2394)
- [GStreamer audiornnoise Element](https://gstreamer.freedesktop.org/documentation/rsaudiofx/audiornnoise.html)
- [GStreamer rtpopuspay Element](https://gstreamer.freedesktop.org/documentation/rtp/rtpopuspay.html)
- [GStreamer Latency Design](https://gstreamer.freedesktop.org/documentation/additional/design/latency.html)
- [Tauri v2: Node.js as a Sidecar](https://v2.tauri.app/learn/sidecar-nodejs/)
- [Tauri v2: Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)
- [voc/aes67-recorder (GitHub)](https://github.com/voc/aes67-recorder)
- [AES67 GStreamer Simple Implementation (Phil Hartung)](https://gist.github.com/philhartung/6f2905ea566bf5dbf5b0b3298008d1d3)
- [Injecting audio/video into mediasoup using GStreamer (GitHub Gist)](https://gist.github.com/mkhahani/59b9eca043569a9ec3cbec67e4d05811)
- [Electron vs. Tauri (DoltHub, 2025)](https://www.dolthub.com/blog/2025-11-13-electron-vs-tauri/)
- [GstWebRTC H264-Opus Examples (RidgeRun)](https://developer.ridgerun.com/wiki/index.php?title=GstWebRTC_-_H264-Opus_Examples)
- [Shure: Dante and AES67 Clocking In Depth](https://service.shure.com/Service/s/article/dante-and-aes-clocking-in-depth?language=en_US)

---
*Architecture research for: Church Audio Streaming*
*Researched: 2026-02-05*
