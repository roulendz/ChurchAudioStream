---
status: complete
phase: 01-project-foundation-configuration
source: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md, 01-04-SUMMARY.md, 01-05-SUMMARY.md, 01-06-SUMMARY.md, 01-07-SUMMARY.md, 01-08-SUMMARY.md]
started: 2026-02-07T12:00:00Z
updated: 2026-02-07T12:30:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Tauri App Launches with Sidecar
expected: Running `npm run tauri dev` opens a Tauri desktop window. The terminal shows sidecar startup logs including server addresses (listenAddress: 0.0.0.0:7777, advertisedUrl: https://{your-IP}:7777). No crash errors.
result: pass

### 2. Admin UI Shows Connected Status
expected: The admin UI in the Tauri window shows a green "Connected" indicator within a few seconds of launch. This means the React frontend successfully connected via ws://localhost:7778 to the sidecar's HTTP loopback server.
result: pass

### 3. Settings Panel Loads Configuration
expected: The Settings panel shows the current port (default 7777), your network interface, and a domain field (default "church.audio"). The form is interactive — not stuck on "Loading configuration..."
result: pass

### 4. Change Port and Server Restarts
expected: Change the port to 8888 in Settings and click Save. The server restarts — the UI briefly shows "Reconnecting" then reconnects automatically. The admin stays connected (fixed loopback port 7778 doesn't change).
result: pass

### 5. Config Persists After Restart
expected: Close the app completely (Ctrl+C in terminal or close window), then run `npm run tauri dev` again. The port should still be 8888 (or whatever you changed it to), proving config was saved to disk and reloaded. Change it back to 7777 afterward.
result: pass

### 6. Sidecar Auto-Restart on Crash
expected: In Task Manager, find and kill the sidecar server process. Within ~2 seconds, the sidecar respawns and the admin UI reconnects automatically.
result: pass

### 7. Clean Shutdown (No Orphan Processes)
expected: Close the Tauri window. Check Task Manager — no orphaned sidecar server processes remain running.
result: pass

### 8. Phone Browser Loads Page
expected: On a phone on the same WiFi, navigate to https://{your-computer-IP}:7777. Accept the self-signed cert warning. A placeholder page loads with "Church Audio Stream" text and dark theme.
result: pass
note: "User feedback: HTTP should redirect to HTTPS, and standard ports 80/443 should be supported so URLs work without port numbers. Logged as future enhancement."

### 9. Phone WebSocket Connection
expected: The placeholder page on the phone shows a "Connected" status indicator, confirming WebSocket connection from the phone browser to the sidecar via wss://.
result: pass

### 10. Log Viewer Shows Activity
expected: The LogViewer panel in the admin UI shows sidecar log entries — at minimum server startup messages. Logs should NOT show duplicates (each message appears once). If you restart the app, early startup logs should appear (buffered replay).
result: pass

### 11. Corrupt Config Recovery
expected: Stop the app. Find config.json in the src-tauri/ directory and replace its contents with just the word "broken". Start the app — it starts with default settings (port 7777) and shows a warning in logs about corrupt config.
result: pass

### 12. Firewall Warning Message
expected: If not running as administrator, the terminal/logs show an actionable warning about Windows Firewall with the exact netsh command to run manually. The server still starts and runs despite the firewall warning.
result: pass

## Summary

total: 12
passed: 12
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]
