---
phase: 01-project-foundation-configuration
plan: 02
subsystem: server-infrastructure
tags: [express, websocket, zod, selfsigned, mdns, config, https, tls]
requires:
  - 01-01 (Tauri + React + Sidecar scaffold, entry point, build pipeline)
provides:
  - Zod-validated JSON config store with corruption recovery
  - Self-signed TLS certificate generation with SAN support
  - Express 5.x HTTPS server on port 7777
  - WebSocket message router with role-based authorization
  - mDNS service publication for local network discovery
  - Network interface enumeration for admin interface selection
  - Placeholder page served to phone browsers
affects:
  - 01-03 (Config wire-up with server restart, React admin shell)
  - 02-xx (Audio capture pipelines will register via WebSocket)
  - 04-xx (mediasoup integration connects to this server)
  - 05-xx (Listener PWA serves from this Express server)
  - 06-xx (Admin dashboard uses WebSocket config/status messages)
tech-stack:
  added:
    - selfsigned@5.5.0
    - bonjour-service@1.3.0
  patterns:
    - Zod 4.x schema with factory defaults for nested objects
    - ConfigStore class with deep merge and safeParse validation
    - Express + ws on shared HTTPS server (single port 7777)
    - WebSocket message format { type, payload?, requestId? }
    - Role-based WebSocket authorization (admin vs listener)
    - EventEmitter for decoupled server restart signaling
    - Heartbeat (30s ping, 10s pong timeout) + identify timeout (10s)
key-files:
  created:
    - sidecar/src/config/schema.ts
    - sidecar/src/config/defaults.ts
    - sidecar/src/config/store.ts
    - sidecar/src/network/interfaces.ts
    - sidecar/src/network/certificate.ts
    - sidecar/src/network/mdns.ts
    - sidecar/src/server.ts
    - sidecar/src/ws/types.ts
    - sidecar/src/ws/handler.ts
    - sidecar/public/index.html
  modified:
    - sidecar/src/index.ts
key-decisions:
  - id: zod-factory-defaults
    decision: "Use factory functions for nested Zod .default() values"
    reason: "Zod 4.x does not accept empty objects as defaults for nested schemas with sub-defaults; factory functions resolve this at parse time"
    impact: "Schema code uses .default(() => SubSchema.parse({})) pattern"
  - id: dynamic-host-default
    decision: "Default host resolves to first non-loopback IPv4 address at parse time"
    reason: "Plan explicitly requires binding to specific interface, not 0.0.0.0"
    impact: "Config default varies per machine; getDefaultInterface() runs at schema parse"
  - id: selfsigned-v5-api
    decision: "Use notBeforeDate/notAfterDate instead of deprecated days option"
    reason: "selfsigned v5 removed the 'days' and 'algorithm' options"
    impact: "Certificate validity calculated as Date arithmetic"
  - id: dirname-dual-resolution
    decision: "Try __dirname (CJS/tsx) then candidate paths for static directory resolution"
    reason: "import.meta.url not available in CJS builds; __dirname shimmed by tsx in dev"
    impact: "Robust static file serving in both dev (tsx) and production (pkg) modes"
duration: "15 minutes"
completed: "2026-02-05"
---

# Phase 01 Plan 02: Config Store, HTTPS Server, and WebSocket Signaling Summary

**One-liner:** Zod-validated config store with corruption recovery, self-signed TLS certificate generation, Express 5.x HTTPS + WebSocket server on port 7777 with role-based message routing, mDNS advertisement, and network interface enumeration.

## Performance

| Metric | Value |
|--------|-------|
| Duration | 15 minutes |
| Start | 2026-02-05T14:43:41Z |
| End | 2026-02-05T14:59:02Z |
| Tasks | 2/2 |
| Files created | 10 |
| Files modified | 1 |

## Accomplishments

1. **Zod-validated config schema with ConfigStore** -- Complete config schema defining server (port, host, interface), network (mDNS, hosts file), and certificate sections. ConfigStore class loads from disk, validates with Zod safeParse, deep-merges partial updates, and gracefully resets to defaults on missing or corrupt config files. Default port 7777, default host from first non-loopback IPv4 interface.

2. **Self-signed TLS certificate with SAN support** -- Generates 2048-bit RSA certificate valid for 10 years using selfsigned v5 async API. SANs include the mDNS domain, localhost, 127.0.0.1, and all non-loopback IPv4 addresses. Certificate cached to disk and reused on subsequent runs.

3. **Express HTTPS + WebSocket server** -- Single-port HTTPS server serving both REST API (/api/status) and WebSocket upgrade on port 7777. Placeholder HTML page with dark theme and WebSocket connection status indicator. mDNS publishes _http._tcp service for local network discovery.

4. **WebSocket message router with authorization** -- Structured message handling with { type, payload?, requestId? } format. Supports identify (admin/listener roles), ping/pong, config:get (admin-only), config:update (admin-only with broadcast), and server:status. Heartbeat at 30s intervals with 10s pong timeout. Identify timeout closes unidentified clients after 10s.

5. **Decoupled restart signaling** -- EventEmitter created in index.ts and threaded through to WebSocket handler. Config changes to port/host/interface emit "restart-needed" event after 1s delay (so response reaches client first). SRP: handler emits events, index.ts owns lifecycle.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Zod config schema, ConfigStore, and defaults | ff17ae3 | schema.ts, store.ts, defaults.ts, interfaces.ts |
| 2 | Express HTTPS server, WebSocket endpoint, network utilities | 9a875ff | server.ts, handler.ts, types.ts, certificate.ts, mdns.ts, index.html, index.ts |

## Decisions Made

### 1. Zod 4.x factory defaults for nested objects

Zod 4.x `.default({})` does not work on object schemas with sub-defaults because the type system requires the full resolved object. Using `.default(() => SubSchema.parse({}))` factory functions resolves this -- each sub-schema parses its own defaults at evaluation time.

### 2. Dynamic host default from network interfaces

The default `server.host` is resolved at schema parse time by calling `getDefaultInterface()`, which returns the first non-loopback IPv4 address. This means the default varies per machine (e.g., 192.168.1.79 on this dev machine). The plan explicitly forbids binding to 0.0.0.0.

### 3. selfsigned v5 API changes

selfsigned v5 removed `days` and `algorithm` options. Certificate validity is now specified via `notBeforeDate` and `notAfterDate` (Date objects). The async-only `generate()` returns `{ private, public, cert, fingerprint }`.

### 4. Static directory resolution for CJS/ESM dual mode

The `resolveStaticDirectory()` function tries `__dirname` (available in CJS pkg builds and shimmed by tsx in dev), then falls back to `basePath/public` and `basePath/sidecar/public`. This avoids `import.meta.url` which fails in CJS compiled output.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zod 4.x .default({}) type error on nested schemas**
- **Found during:** Task 1
- **Issue:** TypeScript error: `{}` is not assignable to the full resolved type of nested schemas
- **Fix:** Used factory functions `.default(() => SubSchema.parse({}))` for all nested defaults
- **Files modified:** sidecar/src/config/schema.ts
- **Commit:** ff17ae3

**2. [Rule 3 - Blocking] selfsigned v5 removed `days` and `algorithm` options**
- **Found during:** Task 2
- **Issue:** TypeScript error: `days` does not exist in type `SelfsignedOptions`
- **Fix:** Used `notBeforeDate` and `notAfterDate` (Date objects) instead
- **Files modified:** sidecar/src/network/certificate.ts
- **Commit:** 9a875ff

**3. [Rule 3 - Blocking] WebSocket import pattern for ws type namespace**
- **Found during:** Task 2
- **Issue:** `{ WebSocket }` named import doesn't expose `WebSocket.OPEN` or `WebSocket.RawData` namespace
- **Fix:** Used `import WebSocket, { WebSocketServer } from "ws"` (default import brings namespace)
- **Files modified:** sidecar/src/ws/handler.ts
- **Commit:** 9a875ff

**4. [Rule 3 - Blocking] import.meta.url fails in CJS build output**
- **Found during:** Task 2
- **Issue:** `import.meta.url` is ESM-only; `tsc --project tsconfig.build.json` (CJS target) rejects it
- **Fix:** Used `__dirname` with try/catch and multiple candidate paths for static directory resolution
- **Files modified:** sidecar/src/server.ts
- **Commit:** 9a875ff

## Issues

None blocking. All issues were resolved during execution.

## Next Phase Readiness

### For Plan 01-03 (Config Wire-up + React Admin Shell)
- ConfigStore is fully operational with update() and get() methods
- WebSocket handler already supports config:get, config:update, and server:status messages
- EventEmitter "restart-needed" event is emitted but not yet handled (01-03 will implement server restart)
- index.ts has basePath, configStore, serverEvents, and stopServer all wired up

### Architecture Notes
- WebSocket handler is the central control plane -- all admin operations flow through it
- No Tauri IPC commands needed -- React admin connects via WebSocket like any browser client
- Config changes to port/host/interface signal restart-needed but don't restart automatically yet
- The compiled binary (69.0 MB) includes all dependencies but not the public/ directory (needs to be shipped alongside or bundled)
