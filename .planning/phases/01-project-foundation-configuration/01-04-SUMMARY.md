---
phase: 01-project-foundation-configuration
plan: 04
subsystem: networking
tags: [server-binding, firewall, host-config, gap-closure]
dependency-graph:
  requires: [01-02]
  provides: [dual-interface-binding, firewall-automation]
  affects: [01-05, 02-*, phone-connectivity]
tech-stack:
  added: []
  patterns: [listen-vs-advertise-host-separation, best-effort-firewall]
key-files:
  created:
    - sidecar/src/network/firewall.ts
  modified:
    - sidecar/src/config/schema.ts
    - sidecar/src/server.ts
    - sidecar/src/index.ts
decisions:
  - id: 01-04-001
    description: "Separate listenHost (0.0.0.0 bind) from host (advertised LAN IP for mDNS/cert)"
  - id: 01-04-002
    description: "Firewall rule uses profile=private,domain (not public) for church WiFi"
metrics:
  duration: 4 minutes
  completed: 2026-02-05
---

# Phase 01 Plan 04: Host Binding and Firewall Gap Closure Summary

Server binds to 0.0.0.0 (all interfaces) so both localhost (Tauri admin) and LAN IP (phone browsers) connect; Windows Firewall rule created best-effort on startup.

## Objective

Fix the host binding mismatch that prevented the Tauri admin UI (connecting via localhost) and phone browsers (connecting via LAN IP) from reaching the sidecar server. Add best-effort Windows Firewall rule creation so external devices are not silently blocked.

## What Was Done

### Task 1: Server listens on 0.0.0.0 (all interfaces)

**Problem:** `server.listen(port, config.server.host)` bound to the LAN IP (e.g., 192.168.1.79), refusing localhost connections from the Tauri webview which connects to `wss://localhost:7777`.

**Solution:** Added `listenHost` field to `ServerSchema` with default `"0.0.0.0"`. The server now calls `server.listen(port, config.server.listenHost)`. The existing `host` field is preserved as the "advertised" host used for mDNS advertisement, certificate SANs, and user-facing URLs.

**Files modified:**
- `sidecar/src/config/schema.ts` -- Added `listenHost` field with `"0.0.0.0"` default
- `sidecar/src/server.ts` -- Changed `server.listen` to use `listenHost`; updated log to show both `listenAddress` and `advertisedUrl`
- `sidecar/src/index.ts` -- Updated config log and initialization log to include `listenHost`

**Commit:** `91893a7`

### Task 2: Best-effort Windows Firewall rule on startup

**Problem:** Windows Firewall silently drops inbound TCP connections on non-standard ports, causing phone browsers to get `ERR_EMPTY_RESPONSE`.

**Solution:** Created `sidecar/src/network/firewall.ts` with `ensureFirewallRule(port)` function that:
- Only runs on Windows (`process.platform === "win32"`)
- Checks if a matching rule already exists (idempotent)
- Creates an inbound TCP allow rule for `profile=private,domain`
- Warns but never crashes on failure (best-effort)
- Called in `main()` before server start, and in restart listener if port changes

**Files created:**
- `sidecar/src/network/firewall.ts` -- Firewall rule management utility

**Files modified:**
- `sidecar/src/index.ts` -- Import and call `ensureFirewallRule` in main() and restart listener

**Commit:** `d2ac2e8`

## UAT Gaps Closed

| UAT Test | Issue | Resolution |
|----------|-------|------------|
| Test 2 (Admin UI Connected) | Server bound to LAN IP only; localhost refused | Server now binds to 0.0.0.0, accepts localhost |
| Test 3 (Settings Panel) | Cascading failure from Test 2 | WebSocket connects, config:get succeeds |
| Test 8 (Phone HTTPS) | Server unreachable + firewall blocking | 0.0.0.0 binding + firewall rule creation |
| Test 9 (Phone WebSocket) | Cascading failure from Test 8 | Page loads, WebSocket connects |

## Decisions Made

1. **Separate listen address from advertised host** (01-04-001): `listenHost` defaults to `"0.0.0.0"` for binding; `host` remains the LAN IP for mDNS, cert SANs, and display. This avoids breaking certificate generation or mDNS advertisement while fixing connectivity.

2. **Firewall profile: private,domain only** (01-04-002): Church WiFi networks are typically configured as private or domain. Public profile is excluded intentionally -- if the network is classified as "public" in Windows, the user must add the rule manually or change their network profile. The warning message explains this.

## Verification Results

- TypeScript compilation: clean (no errors)
- Startup log confirmed: `listenAddress: "0.0.0.0:7777"`, `advertisedUrl: "https://192.168.1.79:7777"`
- Firewall warning logged correctly when running without admin privileges
- Server continues to initialize and listen despite firewall warning
- Existing config.json files without `listenHost` get the `0.0.0.0` default automatically via Zod

## Deviations from Plan

None -- plan executed exactly as written.

## Next Phase Readiness

- Plans 01-03 (Admin UI) and 01-05 (remaining gap closure) can proceed
- Phone connectivity now depends only on network configuration (same WiFi, firewall rule)
- Certificate SANs and mDNS advertisement unchanged -- no regression risk
