# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-05)

**Core value:** Enable multilingual church members and hearing-impaired listeners to hear sermons in their language through their own phones, using the church's existing audio infrastructure -- with near-zero latency and zero friction.
**Current focus:** Phase 6 in progress -- listener counts, server status, QR code complete

## Current Position

Phase: 6 of 10 (Admin Dashboard)
Plan: 3 of 4 in current phase (06-01, 06-02, 06-04 complete; 06-03 parallel)
Status: In progress
Last activity: 2026-02-10 -- Completed 06-02-PLAN.md (channel configuration UI)

Progress: [██████████████████████████████████████░░] 95% (38/40 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 37
- Average duration: 7 minutes
- Total execution time: 4.50 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 8/8 | 67 min | 8 min |
| 02 | 9/9 | 56 min | 6 min |
| 03 | 3/3 | 17 min | 6 min |
| 04 | 9/9 | 61 min | 7 min |
| 05 | 5/5 | 34 min | 7 min |
| 06 | 2/4 | 12 min | 6 min |

**Recent Trend:**
- Last 5 plans: 05-04 (4m), 05-merge, 05-05 (5m), 06-01 (7m), 06-04 (5m)
- Trend: Phase 6 wave 2 in progress. Listener counts + server status + QR code complete.

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Tauri 2.x + Node.js sidecar (not Electron) -- mediasoup, Express, WebSocket run in sidecar process
- [Roadmap]: Both Dante/AES67 AND local audio device capture supported from v1
- [Roadmap]: GStreamer child processes per channel for fault isolation
- [Roadmap]: Research recommended Electron but project chose Tauri for lower resource usage
- [01-01]: Use GNU Rust toolchain (x86_64-pc-windows-gnu) -- no VS Build Tools available
- [01-01]: Compile sidecar TypeScript to CommonJS for pkg compatibility (ESM in dev, CJS in build)
- [01-01]: No Tauri IPC for admin operations -- admin GUI is just another WebSocket client
- [01-02]: Zod 4.x factory defaults for nested schemas (.default(() => SubSchema.parse({})))
- [01-02]: Default host binds to first non-loopback IPv4 interface, not 0.0.0.0
- [01-02]: selfsigned v5 uses notBeforeDate/notAfterDate instead of days option
- [01-02]: __dirname with candidate paths for CJS/ESM dual-mode static directory resolution
- [01-04]: Separate listenHost (0.0.0.0 bind) from host (advertised LAN IP for mDNS/cert)
- [01-04]: Firewall rule uses profile=private,domain (not public) for church WiFi
- [01-05]: Errors from Tauri event API import surfaced via console.warn, not silently swallowed
- [01-07]: Use `net session` for elevation detection; early return with actionable netsh command when not admin
- [01-08]: aborted flag pattern for async useEffect StrictMode safety; Rust LogBuffer with drain semantics for one-shot early log replay
- [01-06]: HTTP loopback port = HTTPS port + 1; Tauri uses ws:// (no TLS cert issues), phone browsers use wss://
- [01-03]: Fixed ADMIN_LOOPBACK_PORT (7778) replaces port+1 offset -- admin GUI never breaks when HTTPS port changes
- [01-03]: Tauri admin connects via ws://127.0.0.1:7778 (fixed); browser clients connect via wss://{host}:{port} (dynamic)
- [quick-001]: Default domain changed to church.audio (from churchaudio.local); hostsFile.enabled defaults to true
- [quick-001]: execSync for elevation commands (intentional: elevation dialogs are blocking by nature)
- [quick-001]: Cert regeneration on domain change now handled by quick-002 (issuer + domain validation)
- [quick-002]: 20-year Root CA validity (local-only, avoids repeat UAC); 825-day server cert (Apple max)
- [quick-002]: VBS+UAC elevation pattern duplicated per SRP (trustedCa.ts and hosts.ts evolve independently)
- [quick-002]: certutil CN search + SHA1 fingerprint cross-check for store detection
- [quick-002]: Domain changes auto-regenerate server cert only (no UAC); issuer mismatch triggers regen of old self-signed certs
- [02-05]: Composite device ID format ${api}:${deviceId} ensures same physical device appears separately per audio API
- [02-05]: Polling errors log and continue (don't stop timer) for transient GStreamer failure resilience
- [02-01]: PipelineConfig uses discriminated union with never-typed exclusions (exactly one config block per source type)
- [02-01]: Readonly properties on discovery data, mutable only on status and lastSeenAt fields
- [02-04]: Use originAddress:originSessionId as unique stream key (SAP hash is only 16-bit, not unique across origins)
- [02-04]: Parse channel labels from raw SDP (sdp-transform treats a=label: as scalar, loses multi-value)
- [02-04]: Strip TTL suffix from multicast connection address (sdp-transform preserves /TTL from c= line)
- [02-02]: Dispatch table (Record<AudioApi, builderFn>) for local pipeline builders -- extensible without switch/case
- [02-02]: Separate channel selection for AES67 (knows total channels from SDP) vs local devices (may not know total)
- [02-02]: -60 dB silence floor in dbToNormalized to prevent display artifacts from near-zero floating point noise
- [02-06]: SAP deletion reverse map (sapHash+originAddress->sourceId) because deletion packets lack originSessionId
- [02-06]: mDNS RAVENNA discovery is log-only; sources not created without SDP from SAP
- [02-06]: Preserve discoveredAt on AES67 source updates by reading existing value from registry
- [02-03]: shell:true on spawn for Windows gst-launch-1.0 compatibility (pipeline strings contain !, =, quotes)
- [02-03]: First level data triggers state transition to streaming (no separate handshake needed)
- [02-03]: Pipeline IDs are UUIDs not channel IDs -- 1:N channel-to-pipeline mapping deferred to Plan 08
- [02-03]: Restart counter resets on streaming state to allow recovery cycles after stable operation
- [02-07]: 5-second pidusage polling interval (wmic on Windows is slow)
- [02-07]: JSONL format for event logs (append-only, crash-safe, line-by-line parsing)
- [02-07]: 1000-event in-memory cache per channel with oldest-first eviction
- [02-07]: Momentary clipping: true for one frame then auto-cleared
- [02-08]: PipelineManager does not expose PIDs; ResourceMonitor PID tracking limited to cleanup until PipelineManager extension
- [02-08]: Partial<AppConfig> cast needed for configStore.update() with nested partial objects (deepMerge handles at runtime)
- [02-08]: Source assignment index as string key in pipeline mapping; rekeyPipelineMappings shifts on splice
- [02-09]: 100ms level broadcast throttle interval (balances real-time VU meters with bandwidth)
- [02-09]: Audio message handler extracted as separate function (SRP: main switch routes, audio handler processes)
- [02-09]: AudioSubsystem persists across server restarts (created once in main, not per-restart)
- [02-09]: Audio subsystem starts after server is ready; stops before servers on graceful shutdown
- [03-01]: FNV-1a 32-bit hash for deterministic SSRC generation from channel UUID
- [03-01]: frameSize stored as string enum in Zod for JSON serialization (convert to number at pipeline build time)
- [03-01]: ProcessingConfig optional on PipelineConfig (Phase 2 pipelines unchanged)
- [03-01]: Zod factory defaults fill processing config for existing channels without processing field
- [03-02]: Source-head/tail separation pattern: source builders return head only, buildPipelineString appends tail
- [03-02]: 4-case processing matrix handles all AGC x Opus enable/disable combinations
- [03-02]: Gain reduction estimated as (avgRmsDb - targetLufs) approximation
- [03-03]: ProcessingConfigUpdate type for partial nested updates (avoids requiring full sub-config objects)
- [03-03]: 1.5s debounce delay for processing config change restarts (within 1-2s spec)
- [03-03]: RTP ports not exposed in WebSocket update payload (auto-allocated, prevents admin errors)
- [03-03]: frameSize converted from string to number at WebSocket boundary
- [03-03]: Processing config separate from ChannelUpdatableFields (dedicated method with debounce, per SRP)
- [04-01]: pipeline-manager.ts exponential backoff is not a debounce pattern -- left as-is during debounce extraction
- [04-01]: source-registry single timer converted to Map<string, Timeout> for consistency with shared scheduleDebounced utility
- [04-01]: toErrorMessage applied to all 11 files with the pattern (broader than plan's 5 targets, for complete DRY)
- [04-01]: buildChannelSelectionString with optional totalSourceChannels handles both AES67 and local device cases
- [04-02]: OPUS_PAYLOAD_TYPE=101 as shared const (matches rtpopuspay pt=101 in pipeline-builder)
- [04-02]: protoo-server ambient declarations (.d.ts) since library ships no TypeScript types
- [04-02]: Re-export protoo types from streaming-types.ts for single import point
- [04-02]: buildOpusRtpParameters(ssrc) helper encapsulates Opus RTP parameter construction (DRY)
- [04-03]: Private WorkerMemoryMonitor helper class per SRP (Phase 8 rotation can extract without changing WorkerManager API)
- [04-03]: Deterministic channel-to-worker mapping via hash modulo (not random assignment)
- [04-03]: ChannelRouterEntry stores port/SSRC info for crash recovery recreation
- [04-03]: ChannelMetadataResolver callback avoids RouterManager depending on ChannelManager
- [04-03]: PlainTransportStats aligned to actual mediasoup BaseTransportStats fields (not hypothetical fields)
- [04-04]: Channel switch recreates WebRtcTransport on target channel's router (consumers must be on same router as producer)
- [04-04]: SlidingWindowRateLimiter as private helper per SRP (encapsulates per-IP sliding window logic)
- [04-04]: PeerHeartbeatTracker as private helper per SRP (2x heartbeat interval = zombie threshold)
- [04-04]: Consumer always created paused; client sends resumeConsumer after MediaStreamTrack setup
- [04-04]: Channel switch fallback chain: try target -> fall back to previous -> notify with active channels
- [04-04]: Peer counter + timestamp for unique protoo peer IDs (avoids UUID overhead per listener)
- [04-05]: Admin WS uses noServer mode with manual upgrade routing (coexists with protoo WebSocket-Node on same server)
- [04-05]: StreamingSubsystem created before createServer so admin WS can wire streaming event broadcasts
- [04-05]: Streaming started after server, before audio (audio events need streaming listeners registered first)
- [04-05]: streaming:restart-workers deferred to Phase 8 (worker rotation adds coordination complexity)
- [04-05]: MetadataResolver callback reused from RouterManager (avoids circular dependency with ChannelManager)
- [04-06]: ChannelStreamingConfigResolver callback decouples SignalingHandler from config store (latencyMode, lossRecovery, defaultChannel)
- [04-06]: PLC mode strips NACK and transport-cc from consumer rtpCapabilities (mediasoup skips retransmission)
- [04-06]: ListenerChannelInfo extended with latencyMode and lossRecovery for Phase 5 client config
- [04-06]: disconnectListenersFromChannel: hard-cut + notify with remaining channels (replaces simple consumerClosed)
- [04-06]: defaultChannelId pushed on initial connect for first-time listener auto-connect
- [04-06]: 30s latency monitoring loop with 200ms threshold emits latency-warning event
- [04-06]: streaming:listeners displayMode (all/flagged/off) filters per admin preference
- [04-06]: buildMetadataResolver() extracted for DRY -- used by 3 call sites in StreamingSubsystem
- [04-07]: Unified regex \([^)]+\) matches any GStreamer type annotation (double, GValueArray) instead of separate patterns
- [04-07]: Level parser reads stdout (gst-launch-1.0 -m bus messages); stderr reads errors only
- [04-07]: Defense-in-depth: error pattern checked on both stdout and stderr streams
- [04-08]: Dummy http.Server (never listened) isolates protoo's WebSocket-Node upgrade handler from httpsServer
- [04-08]: handler.ts is the sole upgrade listener; /ws/listener -> forwardUpgrade(), all else -> admin ws
- [04-08]: setListenerHandler closure callback resolves chicken-and-egg timing (server created before streaming)
- [04-08]: HTTP loopback server does NOT get listener handler (protoo only on HTTPS for phone browsers)
- [04-09]: shutdown() is separate from stopAll() per SRP: prepare signal vs actual teardown
- [04-09]: Three defense-in-depth guards on isShuttingDown (handleCrashedPipeline, scheduleRestart, setTimeout callback)
- [04-09]: removeAudioSubsystemListeners called as step 0 of streaming stop() before notification/drain
- [04-09]: prepareShutdown() is synchronous, called before async streaming teardown to close race window
- [05-01]: buildEnrichedChannelList() only computes listenerCount when displayToggles.showListenerCount is true (server optimization)
- [05-01]: Listener count broadcast reuses heartbeat interval (30s) wired in ListenerWebSocketHandler
- [05-01]: resolveFullChannelConfig() extracted per SRP (Phase 5 display fields vs Phase 4 streaming fields)
- [05-01]: sidecar/public/ is build output from listener/ project (added to .gitignore)
- [05-01]: vite-plugin-pwa generateSW with autoUpdate (silent SW updates per locked decision)
- [05-01]: NetworkOnly for /api/ and /ws/ in service worker runtimeCaching
- [05-02]: protoo-client ambient declarations (.d.ts) for browser build (same pattern as server-side protoo-server)
- [05-02]: mediasoup Device cached as module-level singleton; resetDevice() clears on WiFi reconnection
- [05-02]: Audio engine visibilitychange listener resumes suspended AudioContext on mobile
- [05-02]: useSignaling isReconnect flag distinguishes initial connect from WiFi recovery reconnect
- [05-02]: useChannelList replaces full channel list on notifications (not merge, avoids stale state after idle)
- [05-02]: PlayerView consumerClosed notification handling shows Channel offline state
- [05-02]: Internal React state for navigation (not pushState -- only two views)
- [05-02]: ListenerChannelInfo local type in listener/src/lib/types.ts mirrors server-side interface
- [05-04]: useMediaSession hook created standalone (not integrated into PlayerView) because 05-03 owns PlayerView in this wave
- [05-04]: Visit count incremented once per mount via useRef guard (StrictMode-safe)
- [05-04]: PWA install canInstall gates on both beforeinstallprompt event AND visitCount >= 2
- [05-04]: ShareButton uses navigator.share first, falls through to QR modal on AbortError or unavailability
- [05-04]: OfflineScreen uses z-index 500 to overlay all other content including reconnecting banner
- [05-04]: Scroll position saved in useRef (not localStorage) since it is transient within a session
- [05-04]: ChannelListView no longer manages its own localStorage read for lastChannelId (moved to App-level usePreferences)
- [05-03]: VolumeSlider uses native <input type=range> with CSS custom property --volume-fill for accent-colored fill
- [05-03]: PulsingRing is CSS-only with two concentric rings using transform: scale() for GPU acceleration
- [05-03]: Connection quality thresholds: Good (RTT<50ms, loss<1%), Fair (RTT<150ms, loss<5%), Poor (anything worse)
- [05-03]: PlayerView volume/mute/getConsumer props optional for backward compatibility with current App.tsx
- [05-03]: Player accent color changed from #6c63ff to #4a90d9 via --accent-color CSS custom property
- [05-merge]: useMediaSession wired into PlayerView with useMemo config (null when not playing/reconnecting)
- [05-merge]: App.tsx passes all audio hooks (setVolume, mute, unmute, isMuted, getConsumer) to PlayerView
- [05-merge]: useMediasoup exposes getConsumer() getter for connection quality polling
- [05-05]: buildFullChannelList() in StreamingSubsystem merges all configured channels with active router status
- [05-05]: channelListProvider callback decouples SignalingHandler from RouterManager-only list (optional, defaults to active-only)
- [05-05]: 30s RECONNECT_TIMEOUT_MS stops protoo infinite retry loop and transitions to disconnected
- [05-05]: OfflineScreen accepts connectionState prop; shows on server unreachable, not just WiFi down
- [05-05]: Try Again reloads page (fresh protoo peer needed after timeout closes old one)
- [05-05]: Safety-net error handler + setImmediate in removePipeline prevents ERR_UNHANDLED_ERROR during shutdown
- [06-01]: State-driven navigation via useState<DashboardSection> (no react-router needed for 4-section admin dashboard)
- [06-01]: CSS grid dashboard layout: 220px sidebar + 1fr content, sticky header spanning full width
- [06-01]: Responsive mobile layout converts sidebar to horizontal scrollable tab bar at <640px
- [06-01]: sortOrder defaults to channels.size on creation; reorderChannels() sets new indices from provided array
- [06-01]: getPipelineToChannelMap() built on each level flush (100ms interval, low overhead)
- [06-04]: Listener counts pushed via streaming:listener-count (no polling needed)
- [06-04]: Server status polled every 10s (request-response, not push)
- [06-04]: QR code URL uses config.network.domain || config.server.host (never loopback)
- [06-04]: cpuPercent/memoryMb null until Phase 9 adds server-level resource tracking
- [06-04]: Worker memory from streaming:status workers array (peakMemoryKb)

### Pending Todos

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 001 | Local domain (church.audio) + hosts file auto-update + cert SAN | 2026-02-06 | 8f27c89 | [001-local-domain-hosts-cert](./quick/001-local-domain-hosts-cert/) |
| 002 | Trusted Root CA for HTTPS (browser trust, no security warnings) | 2026-02-07 | f057dfc | [002-trusted-root-ca-for-https](./quick/002-trusted-root-ca-for-https/) |

### Blockers/Concerns

- [Research Gap]: PTP clock synchronization on Windows has sparse documentation -- needs validation in Phase 2
- [Research Gap]: GStreamer Windows minimal bundling approach unclear -- impacts Phase 10
- [Environment]: Rust builds require PATH to include /c/Users/rolan/.cargo/bin and /c/mingw64/bin
- [Build Note]: Compiled sidecar binary (69 MB) does not bundle public/ directory -- needs to be shipped alongside or Tauri resources config

## Session Continuity

Last session: 2026-02-10
Stopped at: Completed 06-04-PLAN.md (listener counts, server status, QR code)
Resume file: None
User feedback: HTTP->HTTPS redirect and standard ports (80/443) requested as future enhancement.
