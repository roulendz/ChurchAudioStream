---
status: complete
phase: 01-project-foundation-configuration
source: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-04-SUMMARY.md, 01-05-SUMMARY.md]
started: 2026-02-06T12:00:00Z
updated: 2026-02-06T12:50:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Tauri App Launches with Sidecar
expected: Running `npm run tauri dev` opens a Tauri desktop window. The terminal shows sidecar startup logs including "Server listening" with listenAddress 0.0.0.0:7777 and an advertised URL showing your LAN IP.
result: issue
reported: "nop configuration not loading. Console shows sidecar logs (Server listening, mDNS published, Sidecar fully initialized) but every log line appears TWICE. Admin UI stuck on Connecting/Reconnecting and Loading configuration."
severity: blocker

### 2. Admin UI Shows Connected Status
expected: The admin UI in the Tauri window shows a green "Connected" indicator within a few seconds of launching. The Settings panel loads with the current port (7777) and network interface dropdown — not stuck on "Loading configuration..."
result: issue
reported: "i only see Connecting... or Reconnecting (attempt 1)..."
severity: blocker

### 3. Change Port and Server Restarts
expected: In the Settings panel, change the port to 8888 and click Save. The UI briefly shows "Reconnecting" then reconnects on the new port. The title bar or status area reflects the new port.
result: skipped
reason: Blocked by WebSocket connection failure (Test 2)

### 4. Config Persists After Restart
expected: Close the app completely, reopen it with `npm run tauri dev`. The port should still be 8888 (or whatever you changed it to), proving config was saved to disk and reloaded on launch.
result: skipped
reason: Blocked by WebSocket connection failure (Test 2)

### 5. Sidecar Auto-Restart on Crash
expected: Open Task Manager, find the process named "server-x86_64-pc-windows-msvc.exe" (NOT node.exe). Kill it. Within ~2 seconds, Tauri respawns it and the admin UI reconnects automatically.
result: pass
note: "In dev mode, sidecar runs as server.exe (PID 30608), not the full target-triple name. Confirmed: killing server.exe triggers auto-restart."

### 6. Clean Shutdown (No Orphan Processes)
expected: Close the Tauri window. Check Task Manager — no orphaned "server-x86_64-pc-windows-msvc.exe" or sidecar processes remain running.
result: pass

### 7. Phone Browser Loads Placeholder Page
expected: On a phone connected to the same WiFi, navigate to https://{your-computer-IP}:7777. Accept the self-signed cert warning. A placeholder page loads with "Church Audio Stream" branding and dark theme.
result: issue
reported: "fail, also i do not think https works on IP https works only on domain"
severity: blocker

### 8. Phone WebSocket Connection
expected: The placeholder page on the phone shows a "Connected" status indicator, confirming the WebSocket connection from the phone browser to the sidecar is working.
result: skipped
reason: Blocked by phone page load failure (Test 7)

### 9. Log Viewer Shows Activity
expected: The LogViewer panel in the admin UI shows real-time log entries — at minimum showing server startup messages and connection events. If it shows 0 entries, open browser DevTools (F12) and check for console.warn messages about Tauri event API failures.
result: issue
reported: "logs show but every entry is duplicated, and early startup logs (Config loaded) are missing after sidecar restart — only firewall warning onwards appears"
severity: minor

## Summary

total: 9
passed: 3
issues: 4
pending: 0
skipped: 2

## Gaps

- truth: "Admin UI connects to sidecar via WebSocket and shows Connected status"
  status: failed
  reason: "User reported: Connecting... or Reconnecting (attempt 1)... Config never loads."
  severity: blocker
  test: 1, 2
  root_cause: "Server is HTTPS-only (https.createServer). Tauri WebView2 connects to wss://localhost:7777 but rejects the self-signed TLS certificate during handshake. No opportunity to accept the cert warning like in a browser. WebSocket connection never establishes."
  artifacts:
    - path: "sidecar/src/server.ts"
      issue: "Line 52: HTTPS-only server, no plain HTTP/WS fallback for localhost"
    - path: "src/hooks/useServerStatus.ts"
      issue: "Line 63: hardcodes wss://localhost:7777 — requires TLS which fails with self-signed cert in WebView2"
  missing:
    - "Add plain HTTP/WS listener on 127.0.0.1 for Tauri admin connections (no TLS needed for localhost)"
    - "Keep HTTPS/WSS on 0.0.0.0 for external phone connections"
    - "Frontend in Tauri mode connects via ws://localhost:PORT (no TLS)"

- truth: "Phone browser loads placeholder page at https://IP:7777"
  status: failed
  reason: "User reported: fail, https doesn't work on IP"
  severity: blocker
  test: 7
  root_cause: "Two issues: (1) Windows Firewall rule creation failed (needs admin elevation) — logs show warning. (2) Self-signed cert on IP address may not show accept prompt on mobile browsers."
  artifacts:
    - path: "sidecar/src/network/firewall.ts"
      issue: "Firewall rule creation fails without elevation, only warns"
    - path: "sidecar/src/network/certificate.ts"
      issue: "Self-signed cert with IP SAN may not be accepted by mobile browsers"
  missing:
    - "Firewall rule must succeed — prompt for elevation or provide manual instructions"
    - "Test whether mobile browsers accept self-signed cert with IP SAN after user accepts warning"

- truth: "LogViewer shows complete, non-duplicated real-time sidecar logs"
  status: failed
  reason: "User reported: duplicate entries, missing early startup logs after restart"
  severity: minor
  test: 9
  root_cause: "Two issues: (1) React StrictMode double-mounts useEffect, registering two Tauri event listeners — every log line appears twice. (2) Sidecar emits early logs before React component mounts and registers listeners — race condition causes missed startup entries."
  artifacts:
    - path: "src/components/LogViewer.tsx"
      issue: "Lines 95-137: useEffect registers listeners without StrictMode-safe cleanup/dedup"
    - path: "src/main.tsx"
      issue: "Line 6: StrictMode wraps App — causes double effect execution in dev"
  missing:
    - "Make LogViewer event listener setup idempotent (track registration, deduplicate)"
    - "Buffer sidecar logs in Rust side and replay on listener registration, or queue early logs"
