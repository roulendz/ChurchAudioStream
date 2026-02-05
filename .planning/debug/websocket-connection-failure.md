---
status: diagnosed
trigger: "React admin UI stuck on Connecting/Reconnecting, WebSocket never establishes, HTTPS unreachable from phone, no config.json on first run, logs not forwarded, settings stuck loading"
created: 2026-02-05T00:00:00Z
updated: 2026-02-05T00:00:00Z
---

## Current Focus

hypothesis: Multiple independent root causes across 5 reported issues
test: Code review and trace of full data flow
expecting: Identify each root cause with specific file/line
next_action: Return diagnosis

## Symptoms

expected: WebSocket connects, HTTPS reachable from phone, config.json created on first run, logs forwarded to UI, settings load
actual: All five fail - WebSocket stuck connecting, HTTPS ERR_EMPTY_RESPONSE, no config.json, 0 log entries, settings "Loading..."
errors: ERR_EMPTY_RESPONSE at 192.168.1.79:7777
reproduction: Launch app in dev mode (cargo tauri dev)
started: Since initial implementation

## Eliminated

(none - first pass diagnosis)

## Evidence

- timestamp: 2026-02-05
  checked: sidecar/src/config/schema.ts line 11
  found: Default host resolves via getDefaultInterface() which returns first non-internal IPv4 address (e.g. 192.168.1.79), NOT "0.0.0.0"
  implication: Server binds to specific LAN IP, not all interfaces. Frontend connects to wss://localhost:7777 which is a DIFFERENT address.

- timestamp: 2026-02-05
  checked: src/hooks/useServerStatus.ts lines 57-71
  found: In Tauri mode, resolveWebSocketUrl() returns "wss://localhost:7777" hardcoded
  implication: Frontend tries localhost, but server listens on LAN IP. Connection refused.

- timestamp: 2026-02-05
  checked: sidecar/src/server.ts line 70
  found: server.listen(config.server.port, config.server.host, ...) binds to config.server.host which is the LAN IP
  implication: Confirms server does NOT listen on localhost/127.0.0.1

- timestamp: 2026-02-05
  checked: src-tauri/src/lib.rs line 31
  found: sidecar_command.args(["--config-path", "."]) passes "." as config path
  implication: Config path resolves relative to CWD, which varies depending on how process is launched

- timestamp: 2026-02-05
  checked: sidecar/src/index.ts lines 7-13
  found: resolveBasePath uses --config-path arg or falls back to path.dirname(process.execPath)
  implication: With "--config-path .", basePath = path.resolve(".") = CWD of the sidecar process

- timestamp: 2026-02-05
  checked: LogViewer.tsx lines 76-81, 95-97
  found: isTauriRef.current is set in useEffect (runs AFTER first render). The Tauri listener setup in lines 95-97 checks isTauriRef.current which is still false on first effect run.
  implication: Race condition - Tauri event listeners may never be set up because isTauriRef.current is false when the second useEffect runs

- timestamp: 2026-02-05
  checked: tauri.conf.json line 29
  found: CSP connect-src only allows wss://localhost:* and wss://127.0.0.1:*
  implication: If the frontend ever tries to connect to a non-localhost address (e.g., after config:response updates the URL to the LAN IP), CSP will block it

- timestamp: 2026-02-05
  checked: src-tauri/capabilities/default.json
  found: Only shell:allow-spawn and shell:allow-kill permissions. Missing event permissions.
  implication: Tauri event system (app_handle.emit / listen) may require "core:default" to cover events, but need to verify if core:default includes event:default

## Resolution

root_cause: See detailed diagnosis below - 5 interconnected issues
fix: (diagnosis only)
verification: (not applicable)
files_changed: []
