---
phase: 06-admin-dashboard
plan: 04
subsystem: admin-ui
tags: [listener-counts, server-status, qr-code, overview, monitoring, real-time]
requires:
  - 06-01 (dashboard shell, sendMessage/subscribe from useServerStatus)
provides:
  - Real-time listener count display (per-channel and total)
  - Server status monitoring panel (uptime, connections, workers)
  - QR code display with LAN URL for phone listeners
  - Populated overview section with at-a-glance server health
affects:
  - Phase 09 (server-level CPU/memory tracking can fill null stats)
tech-stack:
  added:
    - "qrcode (QR code generation)"
    - "@types/qrcode (devDependency)"
  patterns:
    - Push-based listener counts via WebSocket subscription (no polling)
    - Poll-based server status (10s interval for uptime updates)
    - Config-derived LAN URL construction (never window.location)
key-files:
  created:
    - src/hooks/useListenerCounts.ts
    - src/hooks/useResourceStats.ts
    - src/components/monitoring/ListenerCountBadge.tsx
    - src/components/monitoring/ServerStatus.tsx
    - src/components/settings/QrCodeDisplay.tsx
  modified:
    - src/App.tsx
    - src/App.css
    - package.json
    - package-lock.json
key-decisions:
  - "Listener counts pushed via streaming:listener-count (no polling needed)"
  - "Server status polled every 10s (request-response, not push)"
  - "QR code URL uses config.network.domain || config.server.host (never loopback)"
  - "cpuPercent/memoryMb null until Phase 9 adds server-level resource tracking"
  - "Worker memory from streaming:status workers array (peakMemoryKb)"
duration: 5 minutes
completed: 2026-02-10
---

# Phase 06 Plan 04: Listener Counts, Server Status, and QR Code Summary

**One-liner:** Real-time listener badges + server status grid + QR code display using push-based counts and config-derived LAN URLs

## Performance

- Duration: 5 minutes
- Start: 2026-02-10T12:03:18Z
- End: 2026-02-10T12:08:33Z
- Tasks: 2/2
- Files created: 5
- Files modified: 4

## Accomplishments

### Task 1: Listener Count and Resource Stats Hooks
Created two hooks for real-time data:
1. **useListenerCounts**: Subscribes to `streaming:status` (initial snapshot) and `streaming:listener-count` (incremental push). Exposes totalListeners, channelCounts Map, and getChannelListenerCount(channelId) helper.
2. **useResourceStats**: Polls `server:status` every 10s for uptime and connection counts. Subscribes to `streaming:status` for mediasoup worker memory info. CPU/memory set to null (server-level tracking deferred to Phase 9).

### Task 2: Components and Overview Wiring
Built three components and wired the overview section:
1. **ListenerCountBadge**: Pill-shaped badge with SVG person icon, muted when count=0.
2. **ServerStatus**: Grid of stat cards showing total listeners (large), uptime, server address, connections (with admin/listener breakdown), and worker health (green/red dot + memory/router info).
3. **QrCodeDisplay**: Generates QR code from `config.network.domain || config.server.host` + port. Dark theme colors (light QR on dark background). Copy URL button with 2s "Copied!" feedback. Connection hint text.
4. **Overview section**: Replaced placeholder with ServerStatus + QrCodeDisplay + per-channel listener badges.
5. **Settings section**: Added QrCodeDisplay below SettingsPanel for convenience access.

## Task Commits

| # | Hash | Type | Description |
|---|------|------|-------------|
| 1 | 0958170 | feat | create listener count and resource stats hooks |
| 2 | 63f55e7 | feat | build listener badges, server status panel, QR display, and wire overview |

## Files Created

| File | Purpose |
|------|---------|
| src/hooks/useListenerCounts.ts | Per-channel and total listener count state from WebSocket push |
| src/hooks/useResourceStats.ts | Server uptime, connections, config, and worker memory from polling |
| src/components/monitoring/ListenerCountBadge.tsx | Pill-shaped listener count badge with SVG icon |
| src/components/monitoring/ServerStatus.tsx | Grid of stat cards for server health overview |
| src/components/settings/QrCodeDisplay.tsx | QR code from LAN URL with copy button |

## Files Modified

| File | Changes |
|------|---------|
| src/App.tsx | Added useListenerCounts and useResourceStats hooks; wired overview section with ServerStatus, QrCodeDisplay, and channel badges; added QrCodeDisplay to settings section |
| src/App.css | Appended listener badge, server status, worker list, QR display, and overview section styles |
| package.json | Added qrcode dependency and @types/qrcode devDependency |
| package-lock.json | Lock file updated for qrcode packages |

## Decisions Made

1. **Push-based listener counts**: Listener counts are pushed via `streaming:listener-count` broadcasts -- no polling needed. React useState is appropriate since count changes are infrequent (join/leave events, not 10x/sec).
2. **10s server status polling**: `server:status` is request-response (not push), so polling at 10s interval keeps uptime display current without excessive load.
3. **LAN URL from config**: QR code URL built from `config.network.domain || config.server.host` -- never `window.location` or `127.0.0.1`. Phones on LAN cannot reach loopback addresses.
4. **Null CPU/memory**: Server-level CPU and memory tracking is not yet implemented in the sidecar. Set to null and display "N/A" -- Phase 9 can fill these in.
5. **Worker memory from streaming:status**: mediasoup worker peakMemoryKb is available from the streaming:status response workers array, reused for the status panel.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues

None.

## Next Phase Readiness

Plan 06-04 completes the admin dashboard overview section:
- Overview shows server health at a glance (uptime, connections, listeners, workers, QR code)
- Settings provides QR code for quick sharing
- Listener counts update in real-time as listeners join/leave
- Phase 9 can extend useResourceStats to include CPU/memory when server-level tracking is added

## Self-Check: PASSED
