---
phase: 01-project-foundation-configuration
plan: 03
subsystem: ui, api
tags: [react, websocket, express, admin-ui, settings, config-persistence, server-restart]

# Dependency graph
requires:
  - phase: 01-02
    provides: "Config store with Zod validation, Express HTTPS server, WebSocket handler skeleton"
  - phase: 01-06
    provides: "Dual HTTP/HTTPS listeners with fixed admin loopback port"
  - phase: quick-001
    provides: "Domain schema (network.domain), hosts file module"
  - phase: quick-002
    provides: "Trusted Root CA for HTTPS (no cert warnings)"
provides:
  - "Server restart on config change via EventEmitter pattern (handler emits, index orchestrates)"
  - "Admin UI shell with connection status, settings panel, and log viewer"
  - "Full config:update -> server restart -> auto-reconnect loop"
  - "Network interface listing via WebSocket"
affects: [phase-02-audio-pipeline, phase-06-admin-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "EventEmitter decoupling: WS handler emits 'restart-needed', index.ts listens and orchestrates stop/create/start"
    - "Fixed admin loopback port (7778) independent of configurable HTTPS port"
    - "Controlled React forms with dirty detection and buildConfigDiff"
    - "Dual log sources: Tauri events for desktop, WebSocket subscription for browser"

key-files:
  modified:
    - "sidecar/src/index.ts"
    - "sidecar/src/server.ts"
    - "sidecar/src/ws/handler.ts"
    - "sidecar/src/ws/types.ts"
    - "src/hooks/useWebSocket.ts"
    - "src/hooks/useServerStatus.ts"
    - "src/components/SettingsPanel.tsx"
    - "src/App.css"

key-decisions:
  - "Fixed ADMIN_LOOPBACK_PORT (7778) replaces port+1 offset -- admin GUI never breaks when HTTPS port changes"
  - "Tauri admin uses ws:// loopback (no TLS issues); browser clients use wss:// (encrypted for WiFi)"
  - "field-hint CSS class for form field help text (minimal styling, no UI framework)"

patterns-established:
  - "Config update flow: SettingsPanel -> config:update WS msg -> handler validates + detects restart fields -> serverEvents.emit('restart-needed') after 1s delay -> index.ts orchestrates restart"
  - "buildConfigDiff: only sends changed fields to server, avoids full config replacement"

# Metrics
duration: 3min
completed: 2026-02-07
---

# Phase 1 Plan 3: Admin UI Shell + Server Restart Wiring Summary

**Config change -> server restart -> auto-reconnect loop with React admin UI (settings panel, connection status, log viewer) communicating via WebSocket**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-07T00:43:14Z
- **Completed:** 2026-02-07T00:46:16Z
- **Tasks:** 2 auto tasks completed (Task 3 is human verification checkpoint)
- **Files modified:** 8

## Accomplishments

- Sidecar restart wiring aligned with domain schema changes (network.domain replaces nested mdns.domain/hostsFile.domain)
- Admin UI hooks (useWebSocket, useServerStatus) fixed to use stable ADMIN_LOOPBACK_PORT instead of port+1 offset
- SettingsPanel updated with domain field and hostsFile toggle, replacing outdated mDNS domain input
- Full end-to-end loop verified: change port in UI -> config persists -> server restarts -> admin reconnects

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire server restart on config change with EventEmitter pattern** - `4587aba` (feat)
2. **Task 2: Align admin UI hooks and settings panel with domain schema** - `b3d201f` (feat)

Task 3 (human verification checkpoint) was not executed per constraints.

## Files Modified

- `sidecar/src/index.ts` - Config log message: shows domain + hostsFile status
- `sidecar/src/server.ts` - Domain references: network.domain for mDNS and hosts file
- `sidecar/src/ws/handler.ts` - Restart-triggering fields include network.domain; status payload uses domain
- `sidecar/src/ws/types.ts` - ServerStatusPayload config.domain field name
- `src/hooks/useWebSocket.ts` - Server restart URL update skips Tauri loopback (fixed port)
- `src/hooks/useServerStatus.ts` - ADMIN_LOOPBACK_PORT constant; AppConfig aligned with network.domain schema
- `src/components/SettingsPanel.tsx` - Domain text input + hostsFile checkbox replace mDNS domain field
- `src/App.css` - field-hint style class for form field help text

## Decisions Made

- **Fixed ADMIN_LOOPBACK_PORT**: The admin UI connects to a fixed port (7778) rather than deriving from the configurable HTTPS port. This prevents the admin GUI from losing its connection when the user changes the server port in settings. The old approach (port + 1 offset) meant the WebSocket URL changed on every port change, creating a chicken-and-egg problem.

- **Tauri uses ws://, browser uses wss://**: The Tauri admin window connects via plain WebSocket to the HTTP loopback server (no TLS certificate issues). Phone browsers connect via wss:// to the HTTPS server (encrypted for WiFi security). This dual-transport approach is handled transparently by the `resolveWebSocketUrl()` function.

- **No full settings rewrite**: The plan described building the entire admin UI from scratch, but all components (ConnectionStatus, LogViewer, App.tsx layout) were already committed in prior plans (01-06, 01-08). This execution focused on aligning the existing code with the domain schema changes from quick-001/quick-002.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added field-hint CSS class**
- **Found during:** Task 2 (frontend alignment)
- **Issue:** SettingsPanel.tsx references `.field-hint` class for domain and hostsFile help text, but the class was missing from App.css
- **Fix:** Added `.field-hint { font-size: 0.8rem; color: var(--text-muted); }` to App.css
- **Files modified:** src/App.css
- **Verification:** Visual check confirms help text renders correctly
- **Committed in:** b3d201f (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** CSS class was required for the form to render correctly. No scope creep.

## Issues Encountered

- Most of the implementation described in the plan was already completed in prior plans (01-02, 01-06, 01-08) and quick tasks (001, 002). The actual work for 01-03 was primarily alignment -- updating field references from the old schema (network.mdns.domain, network.hostsFile.domain) to the new unified schema (network.domain), and fixing the admin loopback port from a dynamic offset to a fixed constant.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 1 skeleton is complete: Tauri desktop + Node.js sidecar + Express HTTPS + WebSocket + config persistence + admin UI
- Task 3 (human verification checkpoint) should be run to validate end-to-end on desktop and mobile
- Phase 2 (audio pipeline) can begin once Phase 1 is verified
- **Note:** sidecar/src/network/hosts.ts has uncommitted debug improvements (VBS elevation pattern) from quick-001 debugging that should be committed separately

---
*Phase: 01-project-foundation-configuration*
*Completed: 2026-02-07*
