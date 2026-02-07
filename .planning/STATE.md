# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-05)

**Core value:** Enable multilingual church members and hearing-impaired listeners to hear sermons in their language through their own phones, using the church's existing audio infrastructure -- with near-zero latency and zero friction.
**Current focus:** Phase 1 - Project Foundation & Configuration

## Current Position

Phase: 1 of 10 (Project Foundation & Configuration)
Plan: 7 of 8 in current phase (01-03 pending, gap closure 06-08 done)
Status: Human verification needed (4/5 must-haves verified, awaiting UAT v3)
Last activity: 2026-02-07 -- Completed quick task 002 (trusted Root CA for HTTPS)

Progress: [=====.....] 20% (7/35 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 7
- Average duration: 9 minutes
- Total execution time: 1.1 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 7/8 | 64 min | 9 min |

**Recent Trend:**
- Last 5 plans: 01-04 (4m), 01-05 (3m), 01-07 (5m), 01-08 (4m), 01-06 (7m)
- Trend: accelerating (gap closure plans are surgical fixes)

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
- [quick-001]: Default domain changed to church.audio (from churchaudio.local); hostsFile.enabled defaults to true
- [quick-001]: execSync for elevation commands (intentional: elevation dialogs are blocking by nature)
- [quick-001]: Cert regeneration on domain change now handled by quick-002 (issuer + domain validation)
- [quick-002]: 20-year Root CA validity (local-only, avoids repeat UAC); 825-day server cert (Apple max)
- [quick-002]: VBS+UAC elevation pattern duplicated per SRP (trustedCa.ts and hosts.ts evolve independently)
- [quick-002]: certutil CN search + SHA1 fingerprint cross-check for store detection
- [quick-002]: Domain changes auto-regenerate server cert only (no UAC); issuer mismatch triggers regen of old self-signed certs

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
- [Research Flag]: Phase 3 audio processing (RNNoise latency) may need deeper research during planning
- [Environment]: Rust builds require PATH to include /c/Users/rolan/.cargo/bin and /c/mingw64/bin
- [Build Note]: Compiled sidecar binary (69 MB) does not bundle public/ directory -- needs to be shipped alongside or Tauri resources config

## Session Continuity

Last session: 2026-02-07
Stopped at: Completed quick task 002 (trusted Root CA for HTTPS). 01-03 still pending.
Resume file: None
