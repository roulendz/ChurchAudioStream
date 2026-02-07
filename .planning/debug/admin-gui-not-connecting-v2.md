---
status: verifying
trigger: "Admin GUI STILL shows Loading configuration... after previous fix. Sidecar starts fine but WebSocket never connects."
created: 2026-02-06T00:00:00Z
updated: 2026-02-06T00:02:00Z
---

## Current Focus

hypothesis: CONFIRMED and FIXED - Port mismatch caused by config drift + fragile loopback port derivation
test: TypeScript compiles clean. Need user to run `npm run tauri dev` and verify Connected status.
expecting: Admin GUI should connect to ws://127.0.0.1:7778 (fixed loopback) and show Connected
next_action: User verification needed

## Symptoms

expected: Admin GUI should show "Connected" status and load Server Settings panel with config values
actual: Admin GUI stays stuck on "Loading configuration..." forever. Sidecar logs show successful startup but WebSocket never establishes.
errors: No explicit errors in sidecar logs. Need to check browser devtools for WebSocket errors.
reproduction: Run `npm run tauri dev`. Sidecar starts, shows all log messages, but settings panel never loads.
started: Persists after previous fix (commit f8b4a0a). Was working at some earlier point.

## Eliminated

## Evidence

- timestamp: 2026-02-06T00:00:30Z
  checked: netstat -ano for server.exe (PID 60096)
  found: HTTPS on 0.0.0.0:7778, HTTP loopback on 127.0.0.1:7779
  implication: Config port is 7778, so loopback = 7779. Admin GUI connects to 7778 (wrong port).

- timestamp: 2026-02-06T00:00:35Z
  checked: src-tauri/config.json
  found: port is 7778, not 7777
  implication: At some point the config was changed (probably by the admin GUI's config:update), now mismatched with hardcoded DEFAULT_HTTPS_PORT=7777

- timestamp: 2026-02-06T00:00:40Z
  checked: sidecar/config.json
  found: port is 7777 (correct default)
  implication: The sidecar's own config.json has the right port, but the Tauri process loads from src-tauri/config.json (CWD is src-tauri)

- timestamp: 2026-02-06T00:00:45Z
  checked: curl -s -k https://127.0.0.1:7778/api/status
  found: Returns {"status":"running"} -- confirms HTTPS server on 7778
  implication: Port 7778 is HTTPS, ws:// (plain) to 7778 fails because TLS handshake required

- timestamp: 2026-02-06T00:00:50Z
  checked: curl -s http://127.0.0.1:7779/api/status
  found: Returns {"status":"running"} -- confirms HTTP loopback on 7779
  implication: The correct loopback port is 7779, but admin GUI sends ws:// to 7778

- timestamp: 2026-02-06T00:00:55Z
  checked: curl -s http://127.0.0.1:7778/api/status
  found: Exit code 52 (empty reply from server) -- plain HTTP rejected by HTTPS server
  implication: Admin GUI's ws://127.0.0.1:7778 hits HTTPS server with plain HTTP, silently fails

- timestamp: 2026-02-06T00:01:30Z
  checked: TypeScript compilation (both sidecar and frontend)
  found: Both compile cleanly with zero errors
  implication: Fix is syntactically and type-correct

## Resolution

root_cause: TWO issues working together:
  1. src-tauri/config.json had port 7778 (modified by a previous config:update), but admin GUI hardcoded DEFAULT_HTTPS_PORT=7777 for initial connection. Admin GUI computed ws://127.0.0.1:7778 (7777+1), but the actual HTTP loopback was on 7779 (7778+1). The ws:// connection hit the HTTPS server on 7778 instead and failed silently (TLS handshake mismatch).
  2. Design fragility: the loopback port was derived from config.server.port (port+1), meaning any change to the HTTPS port would shift the loopback port. Since the admin GUI must know the loopback port at startup (before connecting), it relied on a hardcoded default that could drift out of sync.

fix: Made the admin loopback port a fixed constant (7778) independent of config.server.port:
  1. sidecar/src/server.ts: Added ADMIN_LOOPBACK_PORT=7778 constant, HTTP loopback always binds here
  2. sidecar/src/index.ts: Replaced all `config.server.port + 1` with ADMIN_LOOPBACK_PORT
  3. src/hooks/useServerStatus.ts: Replaced LOOPBACK_PORT_OFFSET derivation with fixed ADMIN_LOOPBACK_PORT=7778
  4. src/hooks/useWebSocket.ts: Tauri clients no longer change URL on server:restarting (port is fixed)
  5. sidecar/src/config/schema.ts: Added validation to reject port 7778 (reserved for admin loopback)
  6. src-tauri/config.json: Reset port from 7778 back to 7777

verification: TypeScript compiles cleanly. Awaiting user runtime verification.
files_changed:
  - sidecar/src/server.ts
  - sidecar/src/index.ts
  - sidecar/src/config/schema.ts
  - src/hooks/useServerStatus.ts
  - src/hooks/useWebSocket.ts
  - src-tauri/config.json
