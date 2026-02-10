# Phase 5: Listener Web UI - Research

**Researched:** 2026-02-10
**Domain:** Mobile-first PWA, WebRTC audio consumption, mediasoup-client
**Confidence:** HIGH (core stack verified via official docs; iOS volume pitfall verified via Apple docs)

## Summary

Phase 5 delivers the congregation-facing PWA: a mobile-first web app served from the sidecar's Express static directory (`sidecar/public/`). Listeners open a URL on their phone browser, see available channels, tap one, and hear live audio via WebRTC through mediasoup-client + protoo-client signaling. The app includes PWA install support, Media Session API for lock-screen controls, and a QR code for sharing.

The standard approach is a **separate Vite + React build** that compiles into `sidecar/public/` (replacing the current placeholder `index.html`). This build uses `vite-plugin-pwa` for service worker generation and manifest, `mediasoup-client` for WebRTC transport/consumer management, `protoo-client` for signaling, and Web Audio API `GainNode` for volume control (because iOS Safari ignores `HTMLAudioElement.volume`).

**Primary recommendation:** Build as a separate Vite+React project (`listener/`) with its own `package.json`, outputting to `sidecar/public/`. Use Web Audio API GainNode (not HTMLAudioElement.volume) for volume control on all platforms to ensure iOS Safari compatibility. Use protoo-client for signaling to match the server-side protoo-server already in place.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Welcome & Channel Selection
- Brief welcome message above the channel list (generic default: "Select a channel to listen", admin can override with custom text)
- Total listener count shown in welcome area (e.g., "12 people listening") -- updates every 30s
- No branding in v1 -- clean, neutral design
- Channel cards show: name, description, language (flag + text label), listener count, live/offline badge
- **Minimal defaults:** Only name + language shown by default; admin toggles on listener count, description, live badge per preference
- **Server optimization:** Hidden card fields are not tracked/calculated server-side (admin toggle controls both display AND server computation)
- Cards with details layout -- not simple buttons or a list
- Auto-update channel list via WebSocket with visual animation cue when channels go live/offline
- Live channels sort to top, offline channels sort to bottom (within each group, admin-defined order)
- Offline channels shown as dimmed/non-tappable (not hidden)
- Returning listeners see their last-listened channel highlighted (stored in localStorage)
- "No channels available" empty state with friendly description: "Please be patient while we connect translators" (or similar admin-configurable message)
- Tapping a channel card immediately starts connecting (no expand/confirm step)

#### Audio Playback Experience
- Tapping a channel card transitions to a **full-screen player view** with "Connecting..." indicator
- **"Start Listening" tap required** on player screen for autoplay policy compliance -- every channel connect and every channel switch requires this tap
- **Exception:** Auto-reconnect after WiFi disconnect does NOT require tap (session already had user gesture)
- Player shows: channel name, description, language (flag + text, matching card style), listener count, elapsed listening time, connection quality icon (good/fair/poor), pulsing dot/ring visualization
- Pulsing ring uses a fixed app accent color (not per-channel)
- Pulsing ring **stops when muted** -- visual feedback that audio is paused
- Separate mute button (not tap-on-ring to mute)
- Volume does NOT persist across sessions -- always starts at 70% default
- Media Session API: lock screen shows play/pause + channel name + description
- **Disconnect UX:** Auto-reconnect with "Reconnecting..." indicator -- no manual action needed
- **Channel stopped by admin:** Stay on player screen showing "Channel offline" -- auto-reconnect if channel comes back
- **Server unreachable:** Friendly error "Can't reach the audio server. Make sure you're on the church WiFi." with retry button
- Listener count on player screen updates every 30s (same interval as channel list)

#### Channel Switching Flow
- Switching happens via **back navigation to channel list** -- no inline picker, no swipe gestures
- Audio **stops immediately** when leaving the player screen (clean break)
- Previously listened channel shows a **"Last listened" badge** on its card in the channel list
- Tapping a dimmed (offline) channel shows a **toast message**: "This channel is not live right now"
- Simple fade transition between player screens when switching channels

#### PWA & Offline Behavior
- PWA install prompt shown on **second visit** (not first-timers)
- Offline screen: Descriptive message explaining they need church WiFi to listen -- "Connect to the church WiFi to listen to live translations" (not just "no connection")
- Last-used channel saved in localStorage -- highlighted with "Continue listening" on return visits
- **Listener share feature:** Web Share API (native share sheet) with QR code as fallback; links to general listener URL (not specific channel)
- Service worker updates **silently** -- new version loads on next visit, no prompt
- PWA icon: App name abbreviation (e.g., "CAS")
- **Portrait orientation only** -- designed for one-handed phone use

### Claude's Discretion
- Volume slider orientation and style (vertical vs horizontal)
- Scroll position behavior when returning to channel list
- Browser history management (history.pushState vs internal state)
- WebRTC transport teardown vs keep-warm on channel exit
- PWA cache strategy (app shell only vs app shell + last channel list)
- Player screen layout and spacing
- Exact pulsing ring animation parameters
- Connection quality thresholds (good/fair/poor)
- Back navigation design (arrow placement, stop button inclusion)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.2.0 | UI framework | Already in project, component model fits channel list + player views |
| Vite | ^7.2.4 | Build tool | Already in project, fast dev + optimized builds |
| vite-plugin-pwa | ^1.2.0 | PWA service worker + manifest | Zero-config, generateSW strategy, Workbox under the hood |
| mediasoup-client | ^3.18.6 | WebRTC transport + consumer | Matches server-side mediasoup ^3.19.17, official client library |
| protoo-client | ^4.0.7 | WebSocket signaling | Matches server-side protoo-server ^4.0.7, request/response + notifications |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| qrcode | ^1.5.x | QR code generation | Admin generates QR code for listener URL |
| react-qr-code | ^2.0.x | React QR component | Alternative to qrcode if React integration preferred |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| React | Vanilla JS/HTML | Simpler, smaller bundle, but harder to maintain channel list + player state + animations; React is already in the project |
| vite-plugin-pwa | Manual SW | Full control but must hand-roll precaching, manifest, update logic |
| protoo-client | Raw WebSocket | Would work but loses request/response semantics, retry logic, and notification dispatch that protoo provides out of the box |

**Installation (listener project):**
```bash
npm install react react-dom mediasoup-client protoo-client qrcode
npm install -D vite @vitejs/plugin-react vite-plugin-pwa typescript
```

## Architecture Patterns

### Recommended Project Structure

The listener UI is a **separate Vite project** that builds to `sidecar/public/`. The admin Tauri UI at `src/` remains untouched.

```
listener/                      # NEW: Listener PWA Vite project
├── index.html                 # Entry point
├── package.json               # Separate deps (mediasoup-client, protoo-client, etc.)
├── vite.config.ts             # Vite + PWA plugin config, outputs to ../sidecar/public
├── tsconfig.json              # TypeScript config
├── public/
│   ├── icons/                 # PWA icons (192x192, 512x512)
│   └── offline.html           # Offline fallback (church WiFi message)
└── src/
    ├── main.tsx               # React entry
    ├── App.tsx                # Root: manages view state (channel-list vs player)
    ├── views/
    │   ├── ChannelListView.tsx    # Welcome + channel cards
    │   └── PlayerView.tsx         # Full-screen audio player
    ├── components/
    │   ├── ChannelCard.tsx        # Individual channel card
    │   ├── VolumeSlider.tsx       # GainNode-backed volume control
    │   ├── PulsingRing.tsx        # Audio visualization
    │   ├── ConnectionQuality.tsx  # Good/fair/poor icon
    │   ├── Toast.tsx              # Toast notification component
    │   └── OfflineScreen.tsx      # PWA offline message
    ├── hooks/
    │   ├── useSignaling.ts        # protoo-client peer lifecycle
    │   ├── useMediasoup.ts        # Device, transport, consumer management
    │   ├── useAudioPlayback.ts    # Web Audio API, GainNode, Media Session
    │   ├── useChannelList.ts      # Channel list state from signaling
    │   └── usePreferences.ts      # localStorage: last channel, visit count
    ├── lib/
    │   ├── signaling-client.ts    # protoo-client wrapper (connect, request, notify)
    │   ├── mediasoup-device.ts    # mediasoup Device singleton + transport factory
    │   ├── audio-engine.ts        # Web Audio API: AudioContext, GainNode, MediaStream
    │   └── connection-quality.ts  # RTT/packet-loss thresholds -> good/fair/poor
    └── styles/
        └── index.css              # Mobile-first CSS
```

### Pattern 1: Signaling Flow (protoo-client + mediasoup-client)

**What:** The listener connects via protoo-client WebSocket to `/ws/listener`, receives channel list notification, then follows the mediasoup signaling handshake to consume audio.

**When to use:** Every listener connection.

**Flow:**
```
1. protoo-client connects to wss://{host}:{port}/ws/listener
2. Server pushes "activeChannels" notification with channel list + defaultChannelId
3. User taps channel card -> "Start Listening" button
4. Client: peer.request("getRouterRtpCapabilities") -> load mediasoup Device
5. Client: peer.request("createWebRtcTransport", { rtpCapabilities, channelId })
6. Client: device.createRecvTransport(serverParams)
7. Transport "connect" event -> peer.request("connectWebRtcTransport", { dtlsParameters })
8. Client: transport.consume({ id, producerId, kind, rtpParameters })
   -> creates Consumer with audio track
9. Set up audio playback (Web Audio API)
10. Client: peer.request("resumeConsumer") -> audio starts flowing
```

**Example:**
```typescript
// Source: mediasoup.org/documentation/v3/mediasoup-client/api/
import * as mediasoupClient from "mediasoup-client";
import * as protooClient from "protoo-client";

// 1. Connect signaling
const wsTransport = new protooClient.WebSocketTransport(wsUrl);
const peer = new protooClient.Peer(wsTransport);

// 2. On open, get RTP capabilities
peer.on("open", async () => {
  const { rtpCapabilities } = await peer.request("getRouterRtpCapabilities");

  // 3. Load mediasoup Device
  const device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });

  // 4. Create receive transport
  const transportInfo = await peer.request("createWebRtcTransport", {
    rtpCapabilities: device.rtpCapabilities,
    channelId: selectedChannelId,
  });

  const recvTransport = device.createRecvTransport({
    id: transportInfo.id,
    iceParameters: transportInfo.iceParameters,
    iceCandidates: transportInfo.iceCandidates,
    dtlsParameters: transportInfo.dtlsParameters,
  });

  // 5. Handle transport connect
  recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
    try {
      await peer.request("connectWebRtcTransport", { dtlsParameters });
      callback();
    } catch (error) {
      errback(error);
    }
  });

  // 6. Consume audio
  const { consumerId, producerId, kind, rtpParameters } =
    await peer.request("consume", { channelId: selectedChannelId });

  const consumer = await recvTransport.consume({
    id: consumerId,
    producerId,
    kind,
    rtpParameters,
  });

  // 7. Play via Web Audio API (see Pattern 2)
  playAudioTrack(consumer.track);

  // 8. Resume consumer (server starts sending RTP)
  await peer.request("resumeConsumer");
});
```

### Pattern 2: Web Audio API Volume Control (iOS Safari Compatible)

**What:** Route WebRTC audio through Web Audio API GainNode instead of setting HTMLAudioElement.volume. This is MANDATORY for iOS Safari where volume is read-only.

**When to use:** Always. Even on platforms where HTMLAudioElement.volume works, using GainNode provides consistent behavior.

**Example:**
```typescript
// Source: MDN Web Audio API documentation
function createAudioEngine() {
  const audioContext = new AudioContext();
  const gainNode = audioContext.createGain();
  gainNode.gain.value = 0.7; // 70% default volume
  gainNode.connect(audioContext.destination);

  return {
    playTrack(track: MediaStreamTrack): void {
      const stream = new MediaStream([track]);
      const sourceNode = audioContext.createMediaStreamSource(stream);
      sourceNode.connect(gainNode);
    },
    setVolume(value: number): void {
      // value: 0.0 to 1.0
      gainNode.gain.setValueAtTime(value, audioContext.currentTime);
    },
    mute(): void {
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    },
    unmute(volume: number): void {
      gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
    },
    resume(): Promise<void> {
      // MUST be called from user gesture (autoplay policy)
      return audioContext.resume();
    },
    close(): void {
      audioContext.close();
    },
  };
}
```

### Pattern 3: PWA with vite-plugin-pwa

**What:** generateSW strategy with app-shell caching and offline fallback.

**Example vite.config.ts:**
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "generateSW",
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\/api\//,
            handler: "NetworkOnly", // API calls always need server
          },
        ],
      },
      manifest: {
        name: "Church Audio Stream",
        short_name: "CAS",
        description: "Listen to live audio translations",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  build: {
    outDir: "../sidecar/public",
    emptyOutDir: true,
  },
});
```

### Anti-Patterns to Avoid
- **Setting HTMLAudioElement.volume on iOS:** Always 1, completely ignored. Use Web Audio API GainNode for all platforms.
- **Auto-playing audio without user gesture:** iOS Safari and Chrome both block autoplay. Always gate on explicit "Start Listening" tap. The AudioContext.resume() call MUST happen inside a click/tap handler.
- **Creating new Audio elements while tab is backgrounded (Safari):** Safari blocks creation of new `<audio>` tags when the tab is in the background. Create the audio element upfront during the user gesture.
- **Not handling protoo reconnection:** protoo-client has built-in retry (10 attempts, exponential backoff), but the app must handle the "disconnected" and "open" events to re-establish mediasoup state.
- **Forgetting to resume AudioContext after page visibility change:** Mobile browsers may suspend AudioContext when the page goes to background. Listen for `visibilitychange` and call `audioContext.resume()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebRTC transport management | Custom RTCPeerConnection handling | mediasoup-client Device + Transport | Handles DTLS, ICE, codec negotiation, consumer lifecycle |
| WebSocket signaling with request/response | Raw WebSocket + message correlation | protoo-client Peer | Built-in request/response, notifications, reconnection with backoff |
| Service worker + precaching | Manual SW registration + cache API | vite-plugin-pwa (Workbox) | Precache manifest generation, update strategies, offline fallback |
| QR code rendering | Canvas drawing | qrcode npm package | Error correction, encoding modes, SVG/canvas output |
| Web manifest generation | Manual JSON file | vite-plugin-pwa manifest option | Auto-generates with correct hashes, links to SW |

**Key insight:** The mediasoup + protoo ecosystem provides a complete signaling + WebRTC pipeline. The client-side consumer flow mirrors the server-side exactly (protoo-server on server, protoo-client on client; mediasoup on server, mediasoup-client on client). Using these libraries together eliminates the need for any custom signaling protocol.

## Common Pitfalls

### Pitfall 1: iOS Safari Volume Control (CRITICAL)
**What goes wrong:** Developer uses `audioElement.volume = 0.7` which silently fails on iOS. Users on iPhones cannot control volume in the app.
**Why it happens:** Apple deliberately makes HTMLMediaElement.volume read-only on iOS -- volume is controlled exclusively by hardware buttons.
**How to avoid:** Route ALL audio through Web Audio API: MediaStreamSource -> GainNode -> AudioContext.destination. The GainNode.gain property controls volume on ALL platforms including iOS Safari. Note: some older iOS versions may also ignore GainNode -- test on target devices.
**Warning signs:** Volume slider has no effect on iOS during testing.

### Pitfall 2: Autoplay Policy Blocks Audio
**What goes wrong:** Audio doesn't play when user taps a channel. AudioContext is in "suspended" state.
**Why it happens:** Browsers require a user gesture to start audio playback. Creating an AudioContext without a user gesture leaves it suspended.
**How to avoid:** Create AudioContext OR call audioContext.resume() inside the "Start Listening" click handler. The locked decision already requires this tap, which is the correct approach.
**Warning signs:** `audioContext.state === "suspended"` after attempting to play.

### Pitfall 3: Safari Background Tab Audio Element Creation
**What goes wrong:** When a new channel comes online while the listener's tab is backgrounded, creating a new `<audio>` element fails silently in Safari.
**Why it happens:** Safari blocks DOM audio element creation in background tabs as a power-saving measure.
**How to avoid:** Pre-create the audio infrastructure (AudioContext, GainNode) during the initial user gesture. Only swap the MediaStreamSource when switching channels -- never create new Audio elements.
**Warning signs:** Channel switch fails when app is in background on Safari.

### Pitfall 4: Self-Signed Certificate Warning on First Visit
**What goes wrong:** Phone browser shows a scary "Not Secure" / certificate warning when accessing the HTTPS URL.
**Why it happens:** The sidecar generates a self-signed certificate (from Phase 1). Phone browsers don't trust it.
**How to avoid:** The CA certificate trust workflow was established in Phase 1. The QR code should link to the HTTPS URL. Clear instructions should guide users to accept the certificate. Consider if the PWA install experience handles this gracefully.
**Warning signs:** Users unable to connect, see browser warning.

### Pitfall 5: WebSocket Reconnection State Mismatch
**What goes wrong:** After WiFi drops and reconnects, the protoo peer reconnects but mediasoup state (Device, Transport, Consumer) is stale.
**Why it happens:** protoo-client auto-reconnects the WebSocket, but mediasoup transports/consumers on the old connection are dead.
**How to avoid:** On protoo "open" event after reconnection (not first connect), re-run the full signaling handshake: getRouterRtpCapabilities, createWebRtcTransport, consume, resumeConsumer. Track whether this is a fresh connect or a reconnect.
**Warning signs:** WebSocket shows connected but audio doesn't play after WiFi recovery.

### Pitfall 6: Media Session API Requires Active Audio
**What goes wrong:** Lock screen controls don't appear or stop responding.
**Why it happens:** Media Session API only works when there's an active audio context playing through the system audio. If AudioContext is suspended or the tab is in the background without active audio, controls disappear.
**How to avoid:** Keep the audio pipeline active while the user is "listening" even if the consumer temporarily drops. Use Media Session action handlers to respond to play/pause.
**Warning signs:** Lock screen controls appear briefly then vanish, or never appear on iOS.

### Pitfall 7: Stale Channel List After Long Idle
**What goes wrong:** User puts phone to sleep, wakes it 30 minutes later, channel list is outdated.
**Why it happens:** WebSocket may have disconnected during sleep. On reconnect, the server pushes a fresh channel list via "activeChannels" notification, but the UI must handle this update.
**How to avoid:** Always replace the full channel list on "activeChannels" notification, don't try to merge. The server pushes the complete list on every reconnect.
**Warning signs:** Channels show as live when they're offline, or vice versa.

## Code Examples

### Channel Switch via Back Navigation (using server's switchChannel)
```typescript
// Source: sidecar/src/streaming/signaling-handler.ts switchChannel handler
// The server's switchChannel recreates the WebRtcTransport on the target
// channel's router, returning new transport params + consumer params.

async function switchToChannel(
  peer: protooClient.Peer,
  device: mediasoupClient.Device,
  targetChannelId: string,
  currentTransport: mediasoupClient.types.Transport | null,
): Promise<{ transport: mediasoupClient.types.Transport; consumer: mediasoupClient.types.Consumer }> {
  // Close current transport (audio stops immediately per locked decision)
  if (currentTransport) {
    currentTransport.close();
  }

  // Server handles: close old consumer + transport, create new on target router
  const response = await peer.request("switchChannel", {
    channelId: targetChannelId,
  });

  // Create new receive transport from server response
  const newTransport = device.createRecvTransport({
    id: response.transportInfo.id,
    iceParameters: response.transportInfo.iceParameters,
    iceCandidates: response.transportInfo.iceCandidates,
    dtlsParameters: response.transportInfo.dtlsParameters,
  });

  // Wire connect handler
  newTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
    try {
      await peer.request("connectWebRtcTransport", { dtlsParameters });
      callback();
    } catch (error) {
      errback(error);
    }
  });

  // Create consumer
  const consumer = await newTransport.consume({
    id: response.consumerId,
    producerId: response.producerId,
    kind: response.kind,
    rtpParameters: response.rtpParameters,
  });

  return { transport: newTransport, consumer };
}
```

### Media Session API Integration
```typescript
// Source: web.dev/articles/media-session
function setupMediaSession(channelName: string, description: string): void {
  if (!("mediaSession" in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: channelName,
    artist: description,
    album: "Church Audio Stream",
  });

  navigator.mediaSession.setActionHandler("play", () => {
    // Resume audio playback
    audioEngine.resume();
  });

  navigator.mediaSession.setActionHandler("pause", () => {
    // Pause audio
    audioEngine.mute();
  });
}
```

### Connection Quality from WebRTC Stats
```typescript
// Source: mediasoup-client consumer.getStats()
interface ConnectionQualityLevel {
  level: "good" | "fair" | "poor";
  rtt: number;
  packetLoss: number;
}

async function assessConnectionQuality(
  consumer: mediasoupClient.types.Consumer,
): Promise<ConnectionQualityLevel> {
  const stats = await consumer.getStats();

  let rtt = 0;
  let packetsLost = 0;
  let packetsReceived = 0;

  for (const report of stats.values()) {
    if (report.type === "inbound-rtp") {
      packetsLost = report.packetsLost ?? 0;
      packetsReceived = report.packetsReceived ?? 0;
    }
    if (report.type === "candidate-pair" && report.currentRoundTripTime) {
      rtt = report.currentRoundTripTime * 1000; // seconds to ms
    }
  }

  const lossRate = packetsReceived > 0
    ? (packetsLost / (packetsLost + packetsReceived)) * 100
    : 0;

  let level: "good" | "fair" | "poor";
  if (rtt < 50 && lossRate < 1) {
    level = "good";
  } else if (rtt < 150 && lossRate < 5) {
    level = "fair";
  } else {
    level = "poor";
  }

  return { level, rtt, packetLoss: lossRate };
}
```

## Discretion Recommendations

### Volume Slider: Horizontal
**Recommendation:** Use a **horizontal slider** positioned in the lower third of the player screen.
**Rationale:** Portrait-only + one-handed use means the thumb naturally sweeps horizontally in the lower area. iOS and Android are converging on horizontal sliders. A horizontal range input is natively supported in all mobile browsers without custom touch handling. Vertical sliders require custom implementation and are harder to use in portrait mode on phones.

### Scroll Position: Restore on Return
**Recommendation:** Save `scrollTop` in component state when navigating to player. Restore on return.
**Rationale:** Users switching between channels will return to the channel list frequently. Jumping back to the top is disorienting when there are many channels.

### Browser History: Internal State (Not pushState)
**Recommendation:** Use React state to manage view transitions (channel-list vs player). Do NOT use `history.pushState`.
**Rationale:** The app has only two views. Using browser history adds complexity (back button edge cases, forward navigation, PWA standalone mode quirks). React state is simpler and more predictable. The "back" button in the player is an in-app element, not the browser back button.

### WebRTC Transport: Teardown on Channel Exit
**Recommendation:** Close the mediasoup transport when navigating back to channel list.
**Rationale:** Per the locked decision, "audio stops immediately when leaving the player screen (clean break)." Keep-warm adds complexity for marginal latency savings (DTLS handshake is ~100-200ms). The server already handles transport cleanup. Clean teardown prevents resource leaks on phones with limited memory. The "Start Listening" tap on re-entry already accounts for the reconnection time.

### PWA Cache Strategy: App Shell + Offline Fallback
**Recommendation:** Precache the app shell (HTML, CSS, JS bundles) + provide a custom offline fallback page.
**Rationale:** The channel list data always comes from the WebSocket (live data, can't cache meaningfully). Caching the app shell ensures instant load on repeat visits. The offline fallback page shows the "Connect to church WiFi" message when the server is unreachable. Runtime caching of the channel list would be misleading (stale channels shown as "live").

### Pulsing Ring Animation
**Recommendation:** CSS `@keyframes` with `transform: scale()` oscillating 1.0 -> 1.08 -> 1.0, duration 2s, `ease-in-out`. Use `opacity` 0.6 -> 1.0 -> 0.6 on a second ring for depth.
**Rationale:** Subtle, not distracting during a sermon. Pure CSS (no JS animation overhead). Scale transform is GPU-accelerated.

### Connection Quality Thresholds
**Recommendation:**
- **Good:** RTT < 50ms AND packet loss < 1%
- **Fair:** RTT < 150ms AND packet loss < 5%
- **Poor:** Anything worse
**Rationale:** On local WiFi, RTT should be <10ms normally. Fair threshold catches edge-of-range phones. Poor threshold flags unusable connections.

### Back Navigation Design
**Recommendation:** Left-aligned back arrow (chevron) in the player header. No separate stop button -- back arrow is the stop action.
**Rationale:** Standard mobile pattern (iOS back, Android up). Single action: "go back" = "stop listening." Separate stop button creates confusion ("stop" vs "back" -- what's different?).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HTMLAudioElement.volume | Web Audio API GainNode | Always (iOS never supported volume) | Volume control works on iOS |
| Manual SW registration | vite-plugin-pwa generateSW | Vite era (2022+) | Zero-config, Workbox precaching |
| Raw WebSocket signaling | protoo-client | mediasoup v3 ecosystem | Request/response semantics, retry |
| navigator.getUserMedia | getUserMedia not needed (receive-only) | N/A | Listener app never captures, only consumes |

**Deprecated/outdated:**
- `webkitAudioContext`: Use standard `AudioContext` (webkit prefix no longer needed in modern Safari)
- Create React App (CRA) for PWA: Deprecated, use Vite + vite-plugin-pwa instead

## Open Questions

1. **iOS Safari GainNode reliability on latest iOS**
   - What we know: Apple docs confirm HTMLMediaElement.volume is read-only on iOS. Web Audio API GainNode is the documented alternative.
   - What's unclear: Some older reports suggest GainNode is also ignored on certain iOS versions. Need device testing to confirm current behavior on iOS 17+.
   - Recommendation: Implement GainNode approach. If testing reveals issues on specific iOS versions, fall back to displaying a "Use hardware volume buttons" hint on iOS.

2. **Self-signed cert acceptance on mobile PWA install**
   - What we know: Phase 1 handles cert generation. The CA trust workflow exists.
   - What's unclear: Whether PWA install (Add to Home Screen) works after manually trusting a self-signed cert on iOS/Android.
   - Recommendation: Test during implementation. The QR code can link to instructions page first, then redirect.

3. **ListenerChannelInfo needs extension for Phase 5 card fields**
   - What we know: Current `ListenerChannelInfo` has: id, name, outputFormat, defaultChannel, hasActiveProducer, latencyMode, lossRecovery.
   - What's missing: description, language (flag + text), listener count per channel, admin display toggles. The CONTEXT.md specifies these card fields.
   - Recommendation: Extend `ListenerChannelInfo` on the server side in a Phase 5 plan. Add optional fields: `description`, `language`, `listenerCount`, and admin-controlled visibility flags.

4. **Listener count broadcast mechanism**
   - What we know: SignalingHandler has `getListenerCount(channelId?)` method. Welcome area shows total count, cards show per-channel count. Updates every 30s.
   - What's missing: No current mechanism to push listener counts to listeners (only to admin clients via `streaming:listener-count`).
   - Recommendation: Add a periodic notification from the server to all listeners with updated counts, or piggyback on heartbeat interval.

## Sources

### Primary (HIGH confidence)
- mediasoup-client v3 API: https://mediasoup.org/documentation/v3/mediasoup-client/api/
- mediasoup communication patterns: https://mediasoup.org/documentation/v3/communication-between-client-and-server/
- protoo-client API: https://protoo.versatica.com/
- Apple iOS audio docs: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/Using_HTML5_Audio_Video/Device-SpecificConsiderations/Device-SpecificConsiderations.html
- vite-plugin-pwa guide: https://vite-pwa-org.netlify.app/guide/
- Media Session API: https://web.dev/articles/media-session
- MDN Web Audio API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- MDN Web Share API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API

### Secondary (MEDIUM confidence)
- Safari WebRTC autoplay guide: https://webrtchacks.com/guide-to-safari-webrtc/
- Safari autoplay restrictions: https://webrtchacks.com/autoplay-restrictions-and-webrtc/
- vite-plugin-pwa cache strategies: https://vite-pwa-org.netlify.app/guide/service-worker-strategies-and-behaviors

### Tertiary (LOW confidence)
- iOS GainNode behavior reports (community, needs device validation)
- Volume slider UX trends (Android Authority editorials, not authoritative)

### Codebase (HIGH confidence)
- Existing signaling API: `sidecar/src/streaming/signaling-handler.ts` -- full request handlers for getRouterRtpCapabilities, createWebRtcTransport, connectWebRtcTransport, consume, resumeConsumer, switchChannel
- Streaming types: `sidecar/src/streaming/streaming-types.ts` -- ListenerChannelInfo, ListenerPeerData, LatencyMode, LossRecoveryMode
- Listener WS handler: `sidecar/src/ws/listener-handler.ts` -- protoo WebSocket upgrade on /ws/listener path
- Transport manager: `sidecar/src/streaming/transport-manager.ts` -- WebRtcTransport lifecycle, UDP-only, announced IP
- Server static dir: `sidecar/src/server.ts` -- Express static directory at `sidecar/public/`, resolveStaticDirectory() with candidate paths
- Config schema: `sidecar/src/config/schema.ts` -- ChannelSchema with latencyMode, lossRecovery, defaultChannel
- Admin WS handler: `sidecar/src/ws/handler.ts` -- upgrade dispatcher routes /ws/listener to protoo, all else to admin WS

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - mediasoup-client + protoo-client are the official ecosystem. Verified versions on npm.
- Architecture: HIGH - Based on existing codebase patterns and official mediasoup demo structure.
- Pitfalls: HIGH for iOS volume (Apple docs confirm), MEDIUM for GainNode workaround (community reports vary).
- Discretion items: MEDIUM - Based on UX research and practical analysis, not user-tested.

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (stable ecosystem, 30-day validity)
