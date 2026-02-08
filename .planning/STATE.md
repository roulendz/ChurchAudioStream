# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-05)

**Core value:** Enable multilingual church members and hearing-impaired listeners to hear sermons in their language through their own phones, using the church's existing audio infrastructure -- with near-zero latency and zero friction.
**Current focus:** Phase 4 in progress -- WebRTC Streaming Core

## Current Position

Phase: 4 of 10 (WebRTC Streaming Core)
Plan: 2 of 6 in current phase (04-02 complete)
Status: In progress
Last activity: 2026-02-08 -- Completed 04-02-PLAN.md (dependencies, config schema, streaming types)

Progress: [======================] 63% (22/35 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 22
- Average duration: 7 minutes
- Total execution time: 2.7 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 8/8 | 67 min | 8 min |
| 02 | 9/9 | 56 min | 6 min |
| 03 | 3/3 | 17 min | 6 min |
| 04 | 2/6 | 15 min | 8 min |

**Recent Trend:**
- Last 5 plans: 03-02 (4m), 03-03 (8m), 04-01 (9m), 04-02 (6m)
- Trend: Consistent execution, 04-02 faster due to focused scope (types + config only)

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

Last session: 2026-02-08
Stopped at: Completed 04-02-PLAN.md (dependencies, config schema, streaming types)
Resume file: None
User feedback: HTTP->HTTPS redirect and standard ports (80/443) requested as future enhancement.
