# Phase 4: WebRTC Streaming Core - Context

**Gathered:** 2026-02-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Opus audio from GStreamer pipelines flows through mediasoup SFU to browser listeners over WebRTC, achieving low-latency end-to-end audio delivery. This phase establishes the PlainTransport ingestion from GStreamer, WebRTC transport negotiation for listeners, consumer management, and the signaling protocol. Listener UI (Phase 5), admin dashboard (Phase 6), and full reliability/self-healing (Phase 8) are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Connection Behavior
- Listeners connect via protoo (mediasoup's signaling library) on a separate WebSocket path (`/ws/listener`) from admin (`/ws/admin`)
- No hard cap on simultaneous listeners — let mediasoup handle as many as the server supports
- Gentle auto-reconnect: wait a few seconds on disconnect, then retry with exponential backoff; show "tap to reconnect" button if auto-reconnect fails after 15-30 seconds
- Each listener gets an anonymous random session ID (not tied to person) — enables admin to see connection duration without personal info
- When a channel has no active pipeline, listeners connect but hear silence; UI shows "Channel not active" status; audio starts automatically when pipeline comes online
- Periodic heartbeat for zombie connection detection — relaxed interval (30-60 seconds)
- Basic rate limiting on connection attempts (e.g., 5 per 10 seconds per IP) to prevent accidental DoS from rapid refreshing
- Graceful shutdown notification: send "server shutting down" message via WebSocket before closing connections
- HTTPS everywhere for WebRTC signaling (consistent with Phase 1); no plain HTTP exception for listeners
- mediasoup default DTLS handling (no custom certs)
- Local WiFi only — no TURN server; direct UDP connectivity expected on church network
- Server pushes active channel list on initial WebSocket connect (no request-response round-trip)

### Channel Switching
- Hard cut when switching channels — old audio stops instantly, new channel starts when consumer is ready
- Reuse existing WebRTC transport on channel switch — just swap the mediasoup consumer; faster switch (~100ms)
- One channel at a time in Phase 4 — Phase 7 will add dual-channel mixing; single consumer for now
- Only track current listener count per channel — no switch history
- Listener list shows only channels with active audio pipelines (not inactive/configured channels)
- On-demand channel list refresh (listener gets fresh list on connect and switch), BUT push a one-time "new channel available" notification when a new channel becomes active
- Full channel metadata sent to listeners: name, language, description, icon/color, custom fields
- Admin sets a default channel — first-time listeners auto-connect to it; returning listeners get saved preference
- Always show channel selection screen, even with only one channel
- Listener channel list does NOT show listener counts (admin-only metric)
- Alphabetical channel ordering in listener list
- If a channel switch fails, fall back to previous channel; show brief error "Couldn't switch to [channel]"
- If fallback also fails, show channel selection screen with remaining active channels
- When admin hides/stops a channel, listeners on it get disconnected and notified with remaining active channels
- Admin can listen to channels through the admin dashboard via same WebRTC consumer path (Phase 6 UI adds "listen" button)
- Admin preview connections excluded from listener counts

### Latency Targets
- Best-effort sub-100ms target — optimize for low latency but don't block on a specific number; as long as it feels live, it's fine
- Detailed latency metrics in admin dashboard: per-channel breakdown of GStreamer pipeline latency, mediasoup processing, WebRTC jitter buffer
- Component-based latency estimation (sum GStreamer buffer + Opus encode + mediasoup + WebRTC jitter buffer) — no active measurement/test tones
- Alert admin on latency degradation when estimated latency exceeds threshold (e.g., 200ms) — visual warning in dashboard
- Adaptive jitter buffer — let browser's WebRTC stack auto-adjust based on network conditions (mediasoup-client default)
- "Live / Stable" mode toggle per channel: "Live" = minimal buffering for lowest latency; "Stable" = more buffering for stable audio on poor networks
- Both NACK retransmission and Opus PLC available — admin setting per channel to choose between them
- Per-listener connection stats available in admin: packet loss, jitter per listener session
- Admin setting for listener stats display: "All listeners listed", "Only flagged (degraded)", or "Off"
- Latency metrics are real-time only — no historical logging (Phase 9 adds that)
- 3-second time-to-audio is a design guideline, not actively measured
- Optional debug info for listeners: hidden by default, accessible via long-press or settings, shows connection stats

### RTP Transport
- Dedicated UDP port per channel for GStreamer-to-mediasoup PlainTransport (consistent with Phase 3's port allocator)

### Worker/Scaling Strategy
- Configurable worker count — admin sets number of mediasoup workers; default to 1
- Basic worker memory monitoring in Phase 4 — track usage, log warnings; auto-rotation deferred to Phase 8
- Basic auto-restart on worker crash — respawn worker, recreate routers/transports; listeners reconnect via auto-reconnect
- WebRTC transports created on-demand per listener (no pre-created pool)
- Separate monitoring for mediasoup workers — not integrated into Phase 2's ResourceMonitor
- Soft CPU cap with admin warning when CPU exceeds threshold (e.g., 80%)
- Worker status visible in admin dashboard: running state, CPU%, memory usage
- Admin "restart workers" button with confirmation dialog ("This will briefly disconnect all listeners")
- Worker crash triggers persistent dashboard alert with details: crash reason (if available), affected listener count, timestamp
- Graceful shutdown: send notification to listeners, brief drain period (5-10 seconds), then close workers
- Shutdown order: mediasoup first (disconnect listeners), then GStreamer pipelines (stop audio input)

### Claude's Discretion
- Audio start behavior on initial connect (instant vs brief connecting state)
- WebSocket signaling lifecycle (keep open vs disconnect after WebRTC setup)
- ICE candidate strategy (LAN IP only vs LAN + loopback for admin)
- Router strategy (one router for all channels vs one per channel)
- SSRC matching on PlainTransport (explicit Phase 3 SSRC vs auto-detect)
- Adaptive quality on WiFi degradation (reduce bitrate vs rely on WebRTC congestion control)
- Worker configuration exposure (log level, RTC port range — balance simplicity vs flexibility)
- RTC port range configurability

</decisions>

<specifics>
## Specific Ideas

- "Live / Stable" naming for latency mode (not "Low Latency / Smooth") — less technical, more intuitive for sound technicians
- Per-listener stats display has three modes behind settings: all listed, only flagged, or off
- Loss recovery (NACK vs PLC) is per-channel setting — main sermon might use NACK for quality, translation might use PLC for latency
- Admin listens via same WebRTC path but doesn't count toward listener total
- Shutdown order specifically: notify listeners → drain 5-10s → close mediasoup → close GStreamer (listeners see message before hearing audio cut)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

<audit-findings>
## Pre-Phase 04 Audit Findings (2026-02-07)

A comprehensive audit of the codebase was conducted across 4 parallel agents before Phase 04 planning. The following findings should be incorporated into Phase 04 plans where relevant.

### Blockers Fixed (implemented before Phase 04)

These were fixed in the codebase before Phase 04 planning began:

1. **Windows GStreamer shutdown** — `child.kill('SIGTERM')` on Windows calls `TerminateProcess()` (instant kill, no EOS). Fixed: Unix uses SIGINT for EOS; Windows closes stdin as best-effort, falls back to force-kill.
2. **Pipeline crash exponential backoff** — Fixed restart delay from fixed to `baseDelay * 2^(attempt-1)`, capped at `maxRestartDelayMs` (default 30s). Added `maxRestartDelayMs` to `RecoveryConfig` and `PipelineRecoverySchema`.
3. **Shutdown timeout** — `audioSubsystem.stop()` now uses `Promise.race` with 30s timeout to prevent hung GStreamer processes from blocking shutdown.
4. **Level monitor memory leak** — `ChannelManager` now cleans up `LevelMonitor` and `ResourceMonitor` state when `MAX_RESTARTS_EXCEEDED` fires for abandoned pipelines.

### DRY/SRP Fixes (implement during Phase 04)

| # | Violation | Files | Recommended Fix |
|---|-----------|-------|-----------------|
| 1 | Debounce pattern duplicated 4x | `channel-manager.ts`, `event-logger.ts`, `pipeline-manager.ts`, `source-registry.ts` | Extract `scheduleDebounced<T>()` utility to `utils/` |
| 2 | Channel data mapping duplicated | `channel-manager.ts` (load vs persist identical object mapping) | Extract `normalizeSourceAssignment()` and `normalizeProcessingConfig()` helpers |
| 3 | Channel selection logic duplicated | `pipeline-builder.ts` (`buildChannelSelection` and `buildChannelSelectionForLocal` identical for mono/stereo) | Consolidate into single `buildChannelSelectionString()` |
| 4 | Timer clearing not extracted | `event-logger.ts` (clearChannel + scheduleDebouncedFlush) | Extract `clearFlushTimer()` helper |
| 5 | Error narrowing repeated ~5 files | `err instanceof Error ? err.message : String(err)` | Extract `toErrorMessage(err: unknown)` to `utils/` |

### Architecture Improvements (implement during Phase 04)

| # | Issue | Risk | Recommendation |
|---|-------|------|----------------|
| 1 | No source existence validation | Assigning removed source → cryptic GStreamer error | Already fixed in addSource() (line 313) — verify preserved |
| 2 | Race conditions on concurrent channel updates | Two WebSocket clients → lost writes | Queue/serialize updates per channelId |
| 3 | mediasoup PlainTransport should persist across GStreamer restarts | Config change restarts transport (expensive) | Keep PlainTransport alive, only restart GStreamer process |
| 4 | No pipeline stall detection | GStreamer deadlock without crash | Heartbeat: if no `levels` event for 10s, consider stalled and restart |
| 5 | EventLogger disk-full handling | `appendFileSync` throws → events silently lost | Try-catch with in-memory buffer fallback |
| 6 | ChannelManager SRP at limit (~1220 lines) | Adding Phase 4 features will push it over | Consider splitting into `ChannelRegistry`, `ChannelPipelineOrchestrator`, `ChannelProcessingManager` |

### mediasoup Best Practices (critical for Phase 04)

1. **Worker rotation** — mediasoup C++ workers can retain ~600MB after sessions end (GitHub #769). Monitor via `worker.getResourceUsage()`. Phase 4 should add basic monitoring; Phase 8 adds auto-rotation.
2. **Garbage collection** — Every mediasoup resource must be explicitly cleaned up via event listeners:
   - `worker.on("died")` → restart worker, recreate routers
   - `router.on("workerclose")` → clean up references
   - `transport.on("routerclose")` → clean up references
   - `producer.on("transportclose")` → clean up references
   - `consumer.on("transportclose")` and `consumer.on("producerclose")` → clean up references
3. **PlainTransport for GStreamer** — Create with `rtcpMux: false` (matching Phase 3's separate RTP/RTCP ports). Transport creation is expensive (IPC with C++ worker), so persist transports across GStreamer process restarts.
4. **Worker-per-core** — One worker handles 500+ audio consumers. Default 1 worker is sufficient for church WiFi (100-200 devices).
5. **Proper shutdown order** — Notify listeners → drain 5-10s → close mediasoup workers → close GStreamer pipelines.

### GStreamer Integration Best Practices

1. **EOS-based shutdown** — On Unix, SIGINT (not SIGTERM) triggers EOS when `-e` flag is active. Already fixed in pre-Phase 04 blocker.
2. **Pipeline health heartbeat** — If no `levels` events arrive for 10s, pipeline is stalled (GStreamer deadlock). LevelMonitor could detect this and trigger restart.
3. **Processing in GStreamer, not Node.js** — Current architecture is correct. Audio processing must stay in GStreamer process for zero-copy data flow and sub-millisecond scheduling. Never cross the process boundary for audio data.
4. **webrtcdsp element** — Consider for Speech mode as complement to `audioloudnorm` (provides WebRTC-grade AGC, VAD, high-pass filtering). Lower priority, v2 consideration.
5. **GStreamer plugin validation at startup** — Run `gst-inspect-1.0 audioloudnorm` and `gst-inspect-1.0 opusenc` at startup to catch missing plugins early.

### Configuration Management

1. **Config versioning** — Add `version` field to config schema with migration functions for breaking changes. Prevents user config being silently reset to defaults on upgrade.
2. **Separate infrastructure vs user preferences** — Server port, cert paths, RTP ports have different lifecycle from channel names, AGC settings. Consider splitting.
3. **Config change events** — ConfigStore should emit change events so components can react without restart (e.g., DiscoveryManager's `devicePollIntervalMs`).

</audit-findings>

---

*Phase: 04-webrtc-streaming-core*
*Context gathered: 2026-02-07*
*Audit findings added: 2026-02-07*
