# Phase 4: WebRTC Streaming Core - Research

**Researched:** 2026-02-08
**Domain:** mediasoup SFU + protoo signaling + WebRTC audio streaming
**Confidence:** HIGH

## Summary

Phase 4 connects GStreamer Opus/RTP output (Phase 3) to browser listeners via mediasoup SFU with protoo signaling over WebSocket. The architecture is: GStreamer outputs Opus/RTP to localhost UDP ports -> mediasoup PlainTransport ingests RTP -> Router distributes to WebRtcTransport consumers -> browsers receive audio via WebRTC.

The stack is well-established: mediasoup v3.19.x (server-side SFU), mediasoup-client v3.18.x (browser-side WebRTC), protoo-server v4.0.x (WebSocket signaling server), and protoo-client v4.0.x (WebSocket signaling client). This is the same stack used by the official mediasoup-demo and most production deployments.

Key architectural insight: mediasoup is audio-only in this use case, which means a single worker can handle 500+ consumers. PlainTransport must persist across GStreamer restarts (transport creation is expensive IPC with C++ worker). The signaling flow uses protoo request/response for transport negotiation and protoo notifications for state pushes.

**Primary recommendation:** Use one Router per channel (maps cleanly to channel isolation), persist PlainTransports across GStreamer process restarts, keep protoo WebSocket open for the session lifetime (needed for notifications), and use `comedia: true` with explicit SSRC on PlainTransport for simplified RTP ingestion.

---

<user_constraints>
## User Constraints

See [04-CONTEXT.md](./04-CONTEXT.md) for all locked decisions, discretion areas, and deferred ideas.
See [04-AUDIT.md](./04-AUDIT.md) for pre-Phase 04 audit findings (DRY/SRP violations, architecture improvements, best practices).
</user_constraints>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| mediasoup | 3.19.x | WebRTC SFU (C++ worker + Node.js API) | Only production-grade Node.js SFU; audio-only capable; supports PlainTransport for external RTP input |
| mediasoup-client | 3.18.x | Browser-side WebRTC device/transport/consumer | Official client library; handles browser-specific WebRTC quirks (Chrome, Firefox, Safari handlers) |
| protoo-server | 4.0.x | WebSocket signaling server with rooms/peers | Built by mediasoup author; request/response/notification protocol; peer lifecycle management |
| protoo-client | 4.0.x | Browser-side WebSocket signaling | Pairs with protoo-server; auto-reconnect built-in; typed request/response/notification |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ws | 8.19.x (already installed) | WebSocket server (protoo-server dependency) | Already in the project; protoo-server wraps it |

### Not Needed

| Library | Why Not |
|---------|---------|
| socket.io | protoo provides the signaling layer; socket.io adds unnecessary abstraction |
| simple-peer | mediasoup-client handles all WebRTC negotiation |
| coturn / TURN server | Local WiFi only; direct UDP connectivity expected (locked decision) |

**Installation:**
```bash
npm install mediasoup@^3.19 protoo-server@^4.0
```

Browser-side (for Phase 5 listener UI, but types needed in Phase 4 for API design):
```bash
npm install mediasoup-client@^3.18 protoo-client@^4.0
```

**Build note:** mediasoup compiles a C++ worker binary via `node-gyp` at install time. Requires Python 3 and a C++ compiler (MSVC on Windows, included with Node.js build tools). The `@yao-pkg/pkg` bundler (already in devDependencies) needs mediasoup's worker binary copied alongside the executable.

---

## Architecture Patterns

### Recommended Project Structure

```
sidecar/src/
  streaming/                         # NEW: Phase 4 WebRTC streaming
    worker-manager.ts                # mediasoup Worker lifecycle (create, monitor, crash recovery)
    router-manager.ts                # Router-per-channel management, producer lifecycle
    transport-manager.ts             # WebRtcTransport creation/cleanup for listeners
    plain-transport-manager.ts       # PlainTransport creation for GStreamer RTP ingestion
    signaling-handler.ts             # protoo request/notification handlers (listener signaling)
    streaming-types.ts               # Type definitions for streaming domain
    streaming-subsystem.ts           # Facade (like AudioSubsystem) wiring all streaming components
  ws/
    handler.ts                       # Existing admin WebSocket handler (keep as-is)
    listener-handler.ts              # NEW: protoo WebSocket path for /ws/listener
  utils/
    debounce.ts                      # NEW: extracted scheduleDebounced utility (audit fix)
    error-message.ts                 # NEW: extracted toErrorMessage utility (audit fix)
  audio/
    channels/
      channel-registry.ts            # NEW: split from ChannelManager (audit fix - SRP)
      channel-pipeline-orchestrator.ts # NEW: split from ChannelManager (audit fix - SRP)
```

### Pattern 1: One Router Per Channel

**What:** Create a separate mediasoup Router for each audio channel. Each Router has its own PlainTransport (GStreamer ingest) and Producer.

**When to use:** Always -- this maps cleanly to channel isolation.

**Why:**
- Channel independence: stopping/restarting one channel's Router does not affect others
- Clean resource cleanup: closing a Router cascades to all its transports, producers, consumers
- `router.canConsume()` checks codec compatibility per-channel
- Future Phase 7 (dual-channel mixing) can use `router.pipeToRouter()` for cross-channel routing

**Discretion decision:** Use one Router per channel (not one router for all channels).

```typescript
// Source: mediasoup official API documentation
const router = await worker.createRouter({
  mediaCodecs: [
    {
      kind: "audio",
      mimeType: "audio/opus",
      clockRate: 48000,
      channels: 2,
    },
  ],
});
```

### Pattern 2: PlainTransport with comedia Mode for GStreamer Ingestion

**What:** Create PlainTransport with `comedia: true` so mediasoup auto-detects the remote address from incoming RTP packets. Specify explicit SSRC in the Producer to match the GStreamer pipeline output.

**When to use:** Always for GStreamer-to-mediasoup RTP ingestion.

**Discretion decision:** Use `comedia: true` with explicit SSRC (from Phase 3's `generateSsrc()`). This avoids the need for `transport.connect()` with IP/port, since mediasoup learns the source from the first RTP packet.

```typescript
// Source: mediasoup API + mediasoup-demo broadcasters/gstreamer.sh
const plainTransport = await router.createPlainTransport({
  listenInfo: {
    protocol: "udp",
    ip: "127.0.0.1",
    port: channel.processing.rtpOutput.rtpPort,
  },
  rtcpListenInfo: {
    protocol: "udp",
    ip: "127.0.0.1",
    port: channel.processing.rtpOutput.rtcpPort,
  },
  rtcpMux: false,       // Separate RTP/RTCP ports (matches Phase 3 pipeline builder)
  comedia: true,         // Auto-detect GStreamer source address from first packet
});

const audioProducer = await plainTransport.produce({
  kind: "audio",
  rtpParameters: {
    codecs: [
      {
        mimeType: "audio/opus",
        clockRate: 48000,
        payloadType: 101,      // Matches rtpopuspay pt=101 in pipeline-builder.ts
        channels: 2,
        parameters: { "sprop-stereo": 1 },
      },
    ],
    encodings: [
      { ssrc: channel.processing.rtpOutput.ssrc },  // From generateSsrc(channelId)
    ],
  },
});
```

### Pattern 3: WebRtcTransport for Listeners (On-Demand)

**What:** Create a WebRtcTransport per listener when they connect, listen on the server's LAN IP for direct UDP connectivity.

**Discretion decision:** ICE candidates should include LAN IP only for phone listeners; add loopback (127.0.0.1) for admin preview connections originating from localhost.

```typescript
// Source: mediasoup API documentation
const webRtcTransport = await router.createWebRtcTransport({
  listenInfos: [
    {
      protocol: "udp",
      ip: "0.0.0.0",
      announcedAddress: serverLanIpAddress,  // From config.server.host
    },
  ],
  enableUdp: true,
  enableTcp: false,       // UDP-only for lowest latency on local WiFi
  preferUdp: true,
  initialAvailableOutgoingBitrate: 128_000,  // Audio-only: ~128 kbps Opus is plenty
});
```

### Pattern 4: protoo Signaling Flow for Audio-Only SFU

**What:** Use protoo request/response for WebRTC negotiation and protoo notifications for state pushes.

**Discretion decision:** Keep WebSocket open for session lifetime. Needed for: channel switch signaling, active channel notifications, connection quality stats, shutdown notifications.

**Server-side signaling requests handled:**

| Method | Direction | Purpose |
|--------|-----------|---------|
| `getRouterRtpCapabilities` | Client -> Server | Load device with Opus codec capabilities |
| `createWebRtcTransport` | Client -> Server | Create receive transport for listener |
| `connectWebRtcTransport` | Client -> Server | Complete DTLS handshake |
| `consume` | Client -> Server | Subscribe to a channel's audio producer |
| `resumeConsumer` | Client -> Server | Start receiving audio (consumer created paused) |
| `switchChannel` | Client -> Server | Close current consumer, create new one on different channel |

**Server-side notifications pushed:**

| Method | Direction | Purpose |
|--------|-----------|---------|
| `activeChannels` | Server -> Client | Push channel list on connect and when channels change |
| `channelStateChanged` | Server -> Client | Channel started/stopped/error |
| `consumerClosed` | Server -> Client | Producer closed (channel stopped) |
| `serverShuttingDown` | Server -> Client | Graceful shutdown notification |

### Pattern 5: Listener WebSocket Path Separation

**What:** Mount protoo WebSocketServer on `/ws/listener` path, keep existing admin WebSocket on its current path.

**Why:** Listener signaling uses protoo's request/response protocol (different from the admin's JSON message protocol). Separating paths avoids protocol confusion and enables different rate limiting.

```typescript
// Server setup pseudocode
const protooWebSocketServer = new protooServer.WebSocketServer(httpsServer, {
  // Options for protoo's internal ws server
});

protooWebSocketServer.on("connectionrequest", (info, accept, reject) => {
  // Validate URL path is /ws/listener
  // Rate limit by IP
  // Accept connection, create peer in room
  const transport = accept();
  handleNewListenerPeer(transport);
});
```

### Pattern 6: Consumer Swap for Channel Switching

**What:** When a listener switches channels, close the current Consumer and create a new one on the target channel's Producer. Reuse the same WebRtcTransport.

**Why:** Transport creation involves ICE/DTLS negotiation (~1-2 seconds). Consumer creation is server-side only (~100ms). This makes channel switching near-instant.

```typescript
// Pseudocode for channel switch
async function handleChannelSwitch(
  listenerPeer: protoo.Peer,
  newChannelId: string,
): Promise<void> {
  // 1. Close existing consumer (if any)
  if (listenerPeer.data.currentConsumer) {
    listenerPeer.data.currentConsumer.close();
    listenerPeer.notify("consumerClosed", { consumerId: listenerPeer.data.currentConsumer.id });
  }

  // 2. Get the new channel's router and producer
  const channelRouter = routerManager.getRouterForChannel(newChannelId);
  const channelProducer = routerManager.getProducerForChannel(newChannelId);

  // 3. Verify codec compatibility
  if (!channelRouter.canConsume({
    producerId: channelProducer.id,
    rtpCapabilities: listenerPeer.data.rtpCapabilities,
  })) {
    throw new Error("Cannot consume: incompatible RTP capabilities");
  }

  // 4. Create new consumer on existing transport
  const consumer = await listenerPeer.data.webRtcTransport.consume({
    producerId: channelProducer.id,
    rtpCapabilities: listenerPeer.data.rtpCapabilities,
    paused: true,
  });

  // 5. Notify client with consumer parameters
  await listenerPeer.request("newConsumer", {
    consumerId: consumer.id,
    producerId: consumer.producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  });

  // 6. Resume consumer
  await consumer.resume();
  listenerPeer.data.currentConsumer = consumer;
}
```

### Pattern 7: Worker Lifecycle Management

**What:** Create configurable number of workers, monitor with `getResourceUsage()`, auto-restart on crash via `worker.on("died")`.

```typescript
// Source: mediasoup API documentation
const worker = await mediasoup.createWorker({
  logLevel: "warn",
  logTags: ["info", "ice", "dtls", "rtp", "rtcp"],
  rtcMinPort: 40000,    // Configurable via admin settings
  rtcMaxPort: 49999,
});

worker.on("died", (error) => {
  logger.error("mediasoup Worker died, restarting", { error: error.message });
  // Recreate worker, routers, PlainTransports, producers
  // Listeners will reconnect via auto-reconnect
});

// Basic memory monitoring (Phase 4 only tracks, Phase 8 adds rotation)
const resourceUsage = await worker.getResourceUsage();
// resourceUsage.ru_maxrss = peak memory in kilobytes
```

### Anti-Patterns to Avoid

- **Creating transport per channel switch:** Transport creation involves ICE/DTLS (~1-2s). Always reuse transport, swap consumers.
- **Not persisting PlainTransport across GStreamer restarts:** PlainTransport creation is expensive IPC with C++ worker. When GStreamer process restarts (config change, crash recovery), keep the PlainTransport alive. GStreamer will resume sending to the same UDP port.
- **Closing consumers without notifying clients:** Always send `consumerClosed` notification before or after closing a consumer server-side, so the client can clean up its MediaStreamTrack.
- **Not creating consumers paused:** Always create consumers with `paused: true`, then resume after the client confirms it received the consumer parameters. This prevents RTP packets from being sent before the client is ready.
- **Skipping `router.canConsume()` check:** Always verify codec compatibility before creating a consumer. If the client doesn't support Opus (unlikely but possible), fail gracefully.
- **Using `rtcpMux: true` with separate RTCP ports in GStreamer:** The pipeline-builder.ts sends RTP and RTCP on separate ports. PlainTransport must use `rtcpMux: false` to match.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebRTC negotiation | Custom SDP manipulation | mediasoup-client Device/Transport | Handles browser-specific quirks (Chrome111, Firefox120, Safari12 handlers), ICE, DTLS |
| WebSocket signaling | Custom JSON message protocol for listeners | protoo request/response/notification | Typed, auto-retry, request-id matching, built-in reconnect |
| RTP forwarding | Node.js UDP relay | mediasoup PlainTransport + WebRtcTransport | Zero-copy C++ worker, kernel-level UDP handling |
| Codec negotiation | Manual SDP codec matching | `router.canConsume()` + `router.rtpCapabilities` | Handles payload type remapping, codec parameter matching |
| DTLS encryption | OpenSSL bindings | mediasoup default DTLS | C++ worker handles DTLS; auto-generates certificates |
| ICE connectivity | Custom STUN | mediasoup ICE Lite | mediasoup is ICE Lite (responds to binding requests from browser) |
| Debounce utility | Inline setTimeout patterns (4x duplication) | Extract `scheduleDebounced<T>()` to `utils/debounce.ts` | Audit finding: identical pattern in 4 files |
| Error message extraction | Inline ternary (~5 files) | Extract `toErrorMessage()` to `utils/error-message.ts` | Audit finding: `err instanceof Error ? err.message : String(err)` repeated |

**Key insight:** mediasoup's C++ worker does all the heavy lifting (RTP routing, DTLS, ICE, NACK retransmission). Node.js is the control plane only. Never touch raw RTP packets in Node.js.

---

## Common Pitfalls

### Pitfall 1: PlainTransport Recreated on Every GStreamer Restart

**What goes wrong:** GStreamer pipeline restarts (config change, crash recovery) destroy and recreate the PlainTransport, causing all consumers to lose audio for 1-2 seconds while transport and producer are recreated.

**Why it happens:** Treating PlainTransport lifecycle as coupled to GStreamer process lifecycle.

**How to avoid:** Keep PlainTransport + Producer alive as long as the channel exists. GStreamer will resume sending RTP to the same port. With `comedia: true`, the transport auto-detects the new source from the first packet.

**Warning signs:** Audio gap during pipeline restarts; log messages showing transport creation during GStreamer restart.

### Pitfall 2: mediasoup Worker Memory Growth

**What goes wrong:** C++ worker retains memory (~600MB reported in issue #769) after sessions end, eventually causing OOM or degraded performance.

**Why it happens:** Internal memory fragmentation in the C++ worker. Not a true leak -- the memory is freed internally but not returned to the OS.

**How to avoid:** Phase 4: monitor via `worker.getResourceUsage().ru_maxrss`, log warnings at threshold (e.g., 500MB). Phase 8: implement worker rotation (create new worker, migrate routers, close old worker).

**Warning signs:** `ru_maxrss` steadily increasing over days/weeks without proportional increase in active consumers.

### Pitfall 3: Missing Resource Cleanup Event Handlers

**What goes wrong:** Stale references accumulate in Maps/Sets when mediasoup objects close, causing memory leaks in Node.js.

**Why it happens:** Every mediasoup object emits close events that must be handled:
- `worker.on("died")` -- restart worker, recreate routers
- `router.on("workerclose")` -- clean up router references
- `transport.on("routerclose")` -- clean up transport references
- `producer.on("transportclose")` -- clean up producer references
- `consumer.on("transportclose")` and `consumer.on("producerclose")` -- clean up consumer references, notify client

**How to avoid:** For every mediasoup object created, immediately register close event handlers that clean up references from tracking Maps.

**Warning signs:** Node.js heap growing over time; Map.size not decreasing when expected.

### Pitfall 4: Consumer Created Without Pausing First

**What goes wrong:** RTP packets flow to browser before client-side Consumer is ready, causing initial audio glitches or wasted bandwidth.

**Why it happens:** Creating consumer with `paused: false` (default) immediately starts forwarding RTP.

**How to avoid:** Always create consumers with `paused: true`. After the client confirms it received the consumer parameters and set up the MediaStreamTrack, have the client send `resumeConsumer` request. Server then calls `consumer.resume()`.

**Warning signs:** Brief audio artifacts at start of playback; Chrome WebRTC internals showing received packets before audio element is attached.

### Pitfall 5: Payload Type Mismatch Between GStreamer and mediasoup

**What goes wrong:** mediasoup receives RTP packets but cannot decode them; producer shows no score or empty stats.

**Why it happens:** GStreamer `rtpopuspay pt=101` must match the `payloadType: 101` in the producer's `rtpParameters.codecs`.

**How to avoid:** Use a constant for payload type shared between `pipeline-builder.ts` and the PlainTransport producer creation. The current codebase uses `pt=101` in `buildOpusRtpChain()`.

**Warning signs:** `producer.score` is empty array; `plainTransport.getStats()` shows 0 bytes received.

### Pitfall 6: Race Condition: Consumer Created Before Producer Exists

**What goes wrong:** Listener connects and requests audio for a channel whose GStreamer pipeline hasn't started yet -- no producer exists to consume from.

**Why it happens:** Channel exists in config but pipeline hasn't started (autoStart=false, or starting state).

**How to avoid:** When no producer exists for a channel, the listener connects but hears silence (locked decision). Server notifies listener when producer becomes available via `channelStateChanged` notification. Listener then sends `consume` request.

**Warning signs:** "Cannot consume: no producer" errors in logs when listeners connect to inactive channels.

### Pitfall 7: Concurrent Channel Updates Causing Lost Writes

**What goes wrong:** Two admin WebSocket clients update the same channel simultaneously, one update overwrites the other.

**Why it happens:** No serialization of updates per channel (audit finding).

**How to avoid:** Queue/serialize updates per channelId using an async mutex or sequential promise chain per channel.

**Warning signs:** Config changes silently lost; admin UI shows stale state after concurrent edits.

---

## Code Examples

### Complete PlainTransport Setup for GStreamer Ingestion

```typescript
// Source: mediasoup API + official demo gstreamer.sh pattern
import type { types as mediasoupTypes } from "mediasoup";

interface ChannelStreamingState {
  router: mediasoupTypes.Router;
  plainTransport: mediasoupTypes.PlainTransport;
  audioProducer: mediasoupTypes.Producer;
}

async function createChannelPlainTransport(
  worker: mediasoupTypes.Worker,
  channelId: string,
  rtpPort: number,
  rtcpPort: number,
  ssrc: number,
): Promise<ChannelStreamingState> {
  // 1. Create Router with Opus codec
  const router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
      },
    ],
  });

  // 2. Create PlainTransport listening on the channel's dedicated ports
  const plainTransport = await router.createPlainTransport({
    listenInfo: {
      protocol: "udp",
      ip: "127.0.0.1",
      port: rtpPort,
    },
    rtcpListenInfo: {
      protocol: "udp",
      ip: "127.0.0.1",
      port: rtcpPort,
    },
    rtcpMux: false,
    comedia: true,
  });

  // 3. Create Producer with matching codec params
  const audioProducer = await plainTransport.produce({
    kind: "audio",
    rtpParameters: {
      codecs: [
        {
          mimeType: "audio/opus",
          clockRate: 48000,
          payloadType: 101,
          channels: 2,
          parameters: { "sprop-stereo": 1 },
        },
      ],
      encodings: [{ ssrc }],
    },
  });

  // 4. Wire cleanup events
  router.on("workerclose", () => {
    // Worker died -- router and all child objects are automatically closed
    // Clean up references from tracking maps
  });

  plainTransport.on("routerclose", () => {
    // Router closed -- transport is automatically closed
  });

  audioProducer.on("transportclose", () => {
    // Transport closed -- producer is automatically closed
  });

  return { router, plainTransport, audioProducer };
}
```

### WebRtcTransport Creation for Listener

```typescript
// Source: mediasoup API documentation
async function createListenerTransport(
  router: mediasoupTypes.Router,
  announcedIpAddress: string,
  rtcMinPort: number,
  rtcMaxPort: number,
): Promise<mediasoupTypes.WebRtcTransport> {
  const webRtcTransport = await router.createWebRtcTransport({
    listenInfos: [
      {
        protocol: "udp",
        ip: "0.0.0.0",
        announcedAddress: announcedIpAddress,
      },
    ],
    enableUdp: true,
    enableTcp: false,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 128_000,
    iceConsentTimeout: 30,
  });

  webRtcTransport.on("icestatechange", (iceState) => {
    if (iceState === "disconnected" || iceState === "closed") {
      // Log for monitoring; transport may recover from "disconnected"
    }
  });

  webRtcTransport.on("dtlsstatechange", (dtlsState) => {
    if (dtlsState === "failed" || dtlsState === "closed") {
      // DTLS failed -- transport is dead, clean up
      webRtcTransport.close();
    }
  });

  return webRtcTransport;
}
```

### protoo Signaling Handler (Server-Side)

```typescript
// Source: protoo documentation + mediasoup communication guide
import * as protooServer from "protoo-server";

function handleListenerPeer(
  protoPeer: protooServer.Peer,
  routerManager: RouterManager,
  transportManager: TransportManager,
): void {
  // Store listener state on peer.data
  protoPeer.data.rtpCapabilities = null;
  protoPeer.data.webRtcTransport = null;
  protoPeer.data.currentConsumer = null;

  // Push active channels immediately on connect
  const activeChannels = routerManager.getActiveChannelList();
  protoPeer.notify("activeChannels", { channels: activeChannels });

  protoPeer.on("request", async (request, accept, reject) => {
    switch (request.method) {
      case "getRouterRtpCapabilities": {
        // Return capabilities of the default channel's router (all routers share same codecs)
        const capabilities = routerManager.getDefaultRtpCapabilities();
        accept({ rtpCapabilities: capabilities });
        break;
      }

      case "createWebRtcTransport": {
        const transport = await transportManager.createForListener(
          routerManager.getDefaultRouter(),
        );
        protoPeer.data.webRtcTransport = transport;

        accept({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
        break;
      }

      case "connectWebRtcTransport": {
        const { dtlsParameters } = request.data;
        await protoPeer.data.webRtcTransport.connect({ dtlsParameters });
        accept();
        break;
      }

      case "consume": {
        const { channelId } = request.data;
        const router = routerManager.getRouterForChannel(channelId);
        const producer = routerManager.getProducerForChannel(channelId);

        if (!router || !producer) {
          reject(404, "Channel not active");
          return;
        }

        if (!router.canConsume({
          producerId: producer.id,
          rtpCapabilities: protoPeer.data.rtpCapabilities,
        })) {
          reject(400, "Cannot consume: incompatible codecs");
          return;
        }

        // Close existing consumer if switching channels
        if (protoPeer.data.currentConsumer) {
          protoPeer.data.currentConsumer.close();
        }

        const consumer = await protoPeer.data.webRtcTransport.consume({
          producerId: producer.id,
          rtpCapabilities: protoPeer.data.rtpCapabilities,
          paused: true,
        });

        consumer.on("producerclose", () => {
          protoPeer.notify("consumerClosed", { consumerId: consumer.id });
          protoPeer.data.currentConsumer = null;
        });

        consumer.on("transportclose", () => {
          protoPeer.data.currentConsumer = null;
        });

        protoPeer.data.currentConsumer = consumer;

        accept({
          consumerId: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
        break;
      }

      case "resumeConsumer": {
        if (protoPeer.data.currentConsumer) {
          await protoPeer.data.currentConsumer.resume();
        }
        accept();
        break;
      }

      default:
        reject(400, `Unknown request method: ${request.method}`);
    }
  });

  protoPeer.on("close", () => {
    // Clean up transport and consumer
    if (protoPeer.data.webRtcTransport) {
      protoPeer.data.webRtcTransport.close();
    }
  });
}
```

### protoo Client-Side Signaling (Browser)

```typescript
// Source: mediasoup-client API + protoo-client documentation
import * as mediasoupClient from "mediasoup-client";
import * as protooClient from "protoo-client";

async function connectToServer(serverUrl: string): Promise<void> {
  const protooTransport = new protooClient.WebSocketTransport(serverUrl);
  const peer = new protooClient.Peer(protooTransport);

  peer.on("open", async () => {
    // 1. Load device with server's codec capabilities
    const device = new mediasoupClient.Device();
    const { rtpCapabilities } = await peer.request("getRouterRtpCapabilities");
    await device.load({ routerRtpCapabilities: rtpCapabilities });

    // 2. Create receive transport
    const transportInfo = await peer.request("createWebRtcTransport");
    const recvTransport = device.createRecvTransport(transportInfo);

    recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      try {
        await peer.request("connectWebRtcTransport", { dtlsParameters });
        callback();
      } catch (error) {
        errback(error as Error);
      }
    });

    // 3. Subscribe to a channel
    const consumerInfo = await peer.request("consume", { channelId: "some-channel-id" });
    const consumer = await recvTransport.consume(consumerInfo);

    // 4. Attach track to audio element
    const audioElement = document.getElementById("audio") as HTMLAudioElement;
    audioElement.srcObject = new MediaStream([consumer.track]);
    await audioElement.play();

    // 5. Tell server we're ready for audio
    await peer.request("resumeConsumer");
  });

  // Handle server notifications
  peer.on("notification", (notification) => {
    switch (notification.method) {
      case "activeChannels":
        // Update channel list UI
        break;
      case "consumerClosed":
        // Producer stopped, show "channel inactive" UI
        break;
      case "serverShuttingDown":
        // Show "server restarting" message
        break;
    }
  });
}
```

### Worker Monitoring

```typescript
// Source: mediasoup API - worker.getResourceUsage()
const WORKER_MEMORY_WARNING_THRESHOLD_KB = 512_000; // 500MB
const WORKER_MEMORY_CHECK_INTERVAL_MS = 60_000;     // Check every minute

async function monitorWorkerMemory(
  worker: mediasoupTypes.Worker,
  workerIndex: number,
): Promise<NodeJS.Timeout> {
  const intervalId = setInterval(async () => {
    try {
      const usage = await worker.getResourceUsage();
      const memoryKb = usage.ru_maxrss;

      if (memoryKb > WORKER_MEMORY_WARNING_THRESHOLD_KB) {
        logger.warn("mediasoup worker memory exceeds threshold", {
          workerIndex,
          memoryMb: Math.round(memoryKb / 1024),
          thresholdMb: Math.round(WORKER_MEMORY_WARNING_THRESHOLD_KB / 1024),
        });
        // Emit event for admin dashboard alert
      }
    } catch {
      // Worker may have died between check scheduling and execution
    }
  }, WORKER_MEMORY_CHECK_INTERVAL_MS);

  return intervalId;
}
```

---

## Claude's Discretion Recommendations

Based on research findings, here are recommendations for the discretion areas:

### Audio Start Behavior
**Recommendation:** Instant start. Create consumer paused, client receives parameters, attaches track to audio element, then sends `resumeConsumer`. Audio starts as soon as server resumes the consumer. No artificial "connecting" state -- the DTLS/ICE handshake IS the connecting state, and it's sub-second on LAN.

### WebSocket Signaling Lifecycle
**Recommendation:** Keep WebSocket open for session lifetime. Protoo's connection is needed for: channel switch signaling, active channel notifications, connection quality stats, server shutdown notification, and consumer close notifications. Disconnecting after WebRTC setup would lose all of these.

### ICE Candidate Strategy
**Recommendation:** LAN IP only (from `config.server.host`). Admin preview connections from localhost also work because mediasoup's `announcedAddress` is the LAN IP, but the actual listen IP is `0.0.0.0` which includes loopback.

### Router Strategy
**Recommendation:** One Router per channel. This provides clean isolation, independent lifecycle management, and prepares for Phase 7's `router.pipeToRouter()`. Each router shares the same worker.

### SSRC Matching on PlainTransport
**Recommendation:** Explicit SSRC from `generateSsrc(channelId)` in the producer's rtpParameters. This matches the SSRC set in `rtpopuspay ssrc=...` in the GStreamer pipeline. With `comedia: true`, the transport auto-detects the source address from the first matching packet.

### Adaptive Quality on WiFi Degradation
**Recommendation:** Rely on WebRTC's built-in congestion control. mediasoup is an SFU (no transcoding), so it cannot reduce bitrate -- it forwards the same Opus packets. The browser's jitter buffer handles packet loss/reorder. The "Live / Stable" mode toggle (locked decision) is the admin-level control for this.

### Worker Configuration Exposure
**Recommendation:** Expose in config schema: `mediasoup.workerCount` (default 1), `mediasoup.rtcMinPort` (default 40000), `mediasoup.rtcMaxPort` (default 49999), `mediasoup.logLevel` (default "warn"). Keep it minimal.

### RTC Port Range
**Recommendation:** Default 40000-49999 (mediasoup defaults: 10000-59999 is too wide). Configurable via admin settings. Each WebRTC transport uses 1 UDP port from this range. With 200 listeners max, 10,000 ports is more than sufficient.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `createPlainRtpTransport()` | `createPlainTransport()` | mediasoup 3.9+ | Method renamed; old name deprecated |
| `listenIp` (string) | `listenInfo` (object with protocol, ip, port) | mediasoup 3.12+ | Structured listen configuration |
| Separate RTCP via `rtcpMux: false` only | `rtcpListenInfo` for explicit RTCP port | mediasoup 3.12+ | Can specify exact RTCP port instead of relying on allocation |
| `webRtcServer` not available | `WebRtcServer` for shared listen port | mediasoup 3.11+ | Optional: multiple transports share one port. Not needed here (plenty of ports on LAN) |

**Deprecated/outdated:**
- `createPlainRtpTransport()`: Use `createPlainTransport()` instead
- `listenIp` string parameter: Use `listenInfo` object with `{ protocol, ip, port }` structure
- `listenIps` array on WebRtcTransport: Use `listenInfos` array instead

---

## NACK vs PLC Implementation

Per locked decision, this is a per-channel admin setting. Implementation:

- **NACK enabled:** Consumer created with default rtcpFeedback (mediasoup automatically handles NACK retransmission in C++ worker). Requires slightly more bandwidth but recovers lost packets.
- **NACK disabled (Opus PLC):** Create consumer without transport-cc and NACK in rtcpFeedback. Browser relies on Opus's built-in Packet Loss Concealment to fill gaps. Lower latency (no retransmission wait) but potentially lower quality on lossy networks.

The "Live" mode maps to: smaller jitter buffer preference + NACK disabled (PLC only).
The "Stable" mode maps to: default jitter buffer + NACK enabled.

---

## Open Questions

1. **protoo WebSocketServer path mounting:**
   - What we know: protoo-server creates its own WebSocket upgrade handler. The existing codebase uses `ws` WebSocketServer attached to HTTP servers.
   - What's unclear: Whether protoo-server can coexist on the same HTTP server with different paths, or needs a separate HTTP server.
   - Recommendation: Test with URL-based routing in the `connectionrequest` handler -- check `info.request.url` to distinguish paths. If protoo cannot filter by path, use the existing HTTP server but filter in the upgrade handler.

2. **mediasoup binary bundling with @yao-pkg/pkg:**
   - What we know: mediasoup compiles a C++ worker binary (`mediasoup-worker`) during `npm install`. The existing build uses `@yao-pkg/pkg` for packaging.
   - What's unclear: Whether `pkg` can bundle the mediasoup-worker binary, or if it needs to be copied manually alongside the executable.
   - Recommendation: Test during implementation. The worker binary path can be set via `MEDIASOUP_WORKER_BIN` environment variable if the default path doesn't work in packaged mode.

3. **WebRtcTransport on a different Router than the Producer's Router:**
   - What we know: With one-router-per-channel, a listener's transport is created on router A, but they might switch to router B's producer.
   - What's unclear: Whether `transport.consume()` can consume a producer from a different router on the same worker.
   - Recommendation: Based on mediasoup docs, consumers must be on the same router as the producer. When switching channels, either: (a) create a new transport on the target router, or (b) use `router.pipeToRouter()` to bridge. Option (a) is simpler for Phase 4; option (b) is needed for Phase 7's dual-channel mixing. For Phase 4, create the WebRtcTransport on the channel's router. On channel switch, close the old transport and create a new one on the target channel's router. This is ~1s slower than consumer-swap but avoids complexity. Alternatively, use a single "global" router with all producers piped in -- simpler but loses channel isolation.

   **REVISED recommendation after deeper analysis:** Use `router.pipeToRouter()` to pipe each channel's producer into a shared "listener router." This way all listeners' WebRtcTransports live on the same router and channel switching is just a consumer swap. The per-channel routers still own the PlainTransports and producers for isolation. This is the pattern used in production mediasoup deployments with multiple rooms.

---

## Sources

### Primary (HIGH confidence)
- [mediasoup API documentation](https://mediasoup.org/documentation/v3/mediasoup/api/) -- Worker, Router, Transport, Producer, Consumer APIs
- [mediasoup client-server communication guide](https://mediasoup.org/documentation/v3/communication-between-client-and-server/) -- Signaling flow, parameter exchange
- [mediasoup-client API documentation](https://mediasoup.org/documentation/v3/mediasoup-client/api/) -- Device, Transport, Consumer browser-side APIs
- [protoo documentation](https://protoo.versatica.com/) -- Room, Peer, WebSocketServer, request/response/notification protocol
- [mediasoup-demo GStreamer broadcaster](https://github.com/versatica/mediasoup-demo/blob/v3/broadcasters/gstreamer.sh) -- PlainTransport + GStreamer Opus/RTP integration pattern

### Secondary (MEDIUM confidence)
- [mediasoup discourse: GStreamer PlainTransport Opus](https://mediasoup.discourse.group/t/gstreamer-plaintransport-send-opus/2394) -- Working comedia + rtcpMux configuration
- [GitHub Gist: Injecting audio/video into mediasoup](https://gist.github.com/mkhahani/59b9eca043569a9ec3cbec67e4d05811) -- PlainTransport producer RTP parameters
- [mediasoup GitHub issue #769](https://github.com/versatica/mediasoup/issues/769) -- Worker memory retention documentation
- [npm mediasoup](https://www.npmjs.com/package/mediasoup) -- Version 3.19.16 confirmed
- [npm mediasoup-client](https://www.npmjs.com/package/mediasoup-client) -- Version 3.18.6 confirmed
- [npm protoo-server](https://www.npmjs.com/package/protoo-server) -- Version 4.0.7 confirmed
- [npm protoo-client](https://www.npmjs.com/package/protoo-client) -- Version 4.0.6 confirmed

### Tertiary (LOW confidence)
- WebSearch results for latency benchmarks (85ms p95 at 500 streams) -- unverified single source
- WebSearch results for DTLS tuning requirements -- mentioned in passing without details

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- mediasoup/protoo versions verified on npm, APIs verified against official docs
- Architecture: HIGH -- patterns derived from official documentation and demo codebase
- PlainTransport config: HIGH -- verified against official demo GStreamer script and discourse posts
- Pitfalls: HIGH -- sourced from GitHub issues, official docs event documentation, and audit findings
- NACK vs PLC: MEDIUM -- mediasoup supports it but exact consumer rtcpFeedback override not verified in docs
- protoo path mounting: MEDIUM -- protoo docs show basic usage but path-based routing not explicitly documented
- Worker binary bundling: LOW -- pkg + native binary interaction not tested

**Research date:** 2026-02-08
**Valid until:** 2026-03-08 (mediasoup v3 API is stable; minor version updates unlikely to break patterns)
