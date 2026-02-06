# Phase 01 Plan 06: Dual HTTP/HTTPS Listener for Tauri WebSocket Connectivity Summary

**One-liner:** Split server into dual listeners -- plain HTTP on 127.0.0.1:PORT+1 for Tauri ws:// (no TLS cert rejection) and HTTPS on 0.0.0.0:PORT for phone wss://

---
phase: 01
plan: 06
subsystem: sidecar-server, admin-ui
tags: [websocket, dual-listener, tls, tauri, loopback, gap-closure]

dependency-graph:
  requires: [01-01, 01-02, 01-04]
  provides: [tauri-websocket-connectivity, dual-listener-server]
  affects: [02-xx (all phases depend on admin UI being functional)]

tech-stack:
  added: []
  patterns: [dual-listener (HTTP loopback + HTTPS external), protocol-aware reconnect]

key-files:
  created: []
  modified:
    - sidecar/src/server.ts
    - sidecar/src/ws/handler.ts
    - sidecar/src/index.ts
    - src/hooks/useServerStatus.ts
    - src/hooks/useWebSocket.ts

decisions:
  - id: 01-06-01
    description: "HTTP loopback port = HTTPS port + 1 (e.g., 7778 when HTTPS is 7777)"
    rationale: "Windows cannot bind two servers to the same port even on different interfaces when one uses 0.0.0.0. Fixed +1 offset is simple, predictable, and avoids port conflict."
  - id: 01-06-02
    description: "Tauri admin UI uses ws:// (plain WebSocket) while phone browsers use wss:// (secure WebSocket)"
    rationale: "Tauri WebView2 rejects self-signed TLS certificates during wss:// handshake with no way to accept. Plain ws:// on loopback is safe (traffic never leaves the machine) and eliminates the cert issue entirely."

metrics:
  duration: 7 minutes
  completed: 2026-02-06
---

## What Was Done

### Task 1: Dual HTTP/HTTPS Server Architecture (sidecar)

**Note:** The sidecar-side changes (server.ts, ws/handler.ts, index.ts) were already implemented in commit `e6132b7` (plan 01-07, executed before this plan). This plan verified those changes and focused on the frontend side.

**Sidecar changes (already in HEAD):**
- `sidecar/src/server.ts`: Renamed `server` to `httpsServer` in `ServerComponents`, added `httpServer` (plain HTTP via `http.createServer`), added `httpWsSetup` alongside `httpsWsSetup`
- HTTP server binds to `127.0.0.1:PORT+1` (loopback only), HTTPS server binds to `0.0.0.0:PORT` (all interfaces)
- `broadcastAndCloseAll` iterates both WSS instances to notify all clients on restart
- Both servers close in parallel via `Promise.all` during shutdown
- `sidecar/src/ws/handler.ts`: Updated `setupWebSocket` parameter type from `https.Server` to `HttpServer | HttpsServer` union type
- `sidecar/src/index.ts`: Restart logging includes both HTTPS and HTTP loopback addresses

### Task 2: Frontend ws:// for Tauri, wss:// for Browser

**src/hooks/useServerStatus.ts:**
- Extracted `DEFAULT_HTTPS_PORT` (7777) and `LOOPBACK_PORT_OFFSET` (1) constants
- Extracted `isTauriEnvironment()` helper (DRY -- used in 3 places)
- `resolveWebSocketUrl()`: Tauri branch returns `ws://localhost:7778`, browser branch returns `wss://host:port`
- `updateWsUrlFromConfig()`: Dynamically computes loopback port as `config.server.port + LOOPBACK_PORT_OFFSET`

**src/hooks/useWebSocket.ts (Bug fix -- deviation Rule 1):**
- Fixed `server:restarting` handler: when payload contains new port, Tauri mode now applies `port + 1` offset so reconnect targets the correct loopback port
- Uses `currentUrl.protocol === "ws:"` to detect Tauri mode (no dependency on Tauri globals from this hook)
- In Tauri mode, does not update hostname from restart payload (always stays on localhost)

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Dual HTTP/HTTPS server | e6132b7 (prior) | sidecar/src/server.ts, ws/handler.ts, index.ts |
| 2 | Frontend ws:// for Tauri | 654248b | src/hooks/useServerStatus.ts, useWebSocket.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed server:restarting reconnect URL for Tauri mode**
- **Found during:** Task 2 implementation
- **Issue:** The `useWebSocket.ts` `server:restarting` handler updated `urlRef.current` with the raw HTTPS port from the payload, but Tauri needs the loopback port (HTTPS port + 1). This would cause the first reconnect attempt after a server restart to target the wrong port, failing until `updateWsUrlFromConfig` corrected it on the next render cycle.
- **Fix:** Added protocol-aware port calculation in the restart handler -- `ws:` protocol adds +1 offset, `wss:` uses the port directly. Also skips hostname update for Tauri (always localhost).
- **Files modified:** src/hooks/useWebSocket.ts
- **Commit:** 654248b (included in Task 2 commit)

**2. [Observation] Task 1 sidecar changes already committed**
- Plans 07 and 08 were executed before plan 06 (out of order). The sidecar-side dual-listener changes were already in HEAD from commit `e6132b7`. No re-commit was needed for Task 1 -- only verification that the implementation matches plan requirements.

## Verification

- [x] `sidecar/npx tsc --noEmit` -- zero errors
- [x] `frontend/npx tsc --noEmit` -- zero errors
- [x] `sidecar/npm run build` -- binary built successfully (69.0 MB)
- [x] `http.createServer` present in server.ts
- [x] `127.0.0.1` loopback binding confirmed in server.ts
- [x] `ws://localhost` URLs confirmed in useServerStatus.ts (Tauri branch)
- [x] `wss://` URLs confirmed in useServerStatus.ts (browser branch)
- [x] `setupWebSocket` called on both HTTP and HTTPS servers

## Next Phase Readiness

- All Phase 1 gap closure plans (06, 07, 08) are now complete
- The Tauri admin UI should now connect via `ws://localhost:7778` and show "Connected" status
- Phone browsers still connect via `wss://IP:7777` with self-signed cert acceptance
- Full end-to-end verification requires `npm run tauri dev` (UAT v3)
