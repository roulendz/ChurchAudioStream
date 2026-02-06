---
phase: quick-001
plan: 01
subsystem: network
tags: [hosts-file, tls-certificate, san, cross-platform, elevation, uac]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "Config schema, certificate generation, server lifecycle, WebSocket handler"
provides:
  - "Cross-platform hosts file management with OS-native elevation (ensureHostsEntry, removeHostsEntry)"
  - "church.audio as default domain for both mDNS and hostsFile"
  - "Hosts file domain included as TLS certificate SAN"
  - "Hosts file changes trigger server restart via config change detection"
affects: [phase-02, admin-ui, mobile-pwa]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "OS-native elevation pattern: UAC (Windows), osascript (macOS), pkexec (Linux)"
    - "Non-fatal infrastructure: hosts file failure does not crash server"
    - "Tagged hosts file entries (# ChurchAudioStream) for safe grep/removal"

key-files:
  created:
    - "sidecar/src/network/hosts.ts"
  modified:
    - "sidecar/src/config/schema.ts"
    - "sidecar/src/network/certificate.ts"
    - "sidecar/src/server.ts"
    - "sidecar/src/index.ts"
    - "sidecar/src/ws/handler.ts"

key-decisions:
  - "church.audio as default domain (not churchaudio.local) for both mDNS and hosts file"
  - "hostsFile.enabled defaults to true (feature on by default)"
  - "execSync for elevation commands (blocking by design, elevation dialogs are inherently synchronous)"
  - "Cert regeneration on domain change deferred (TODO comment, user deletes cert files to force regen)"

patterns-established:
  - "Tagged hosts file entries: all managed lines end with '# ChurchAudioStream' for safe identification"
  - "Non-fatal elevation: hosts file operations wrapped in try/catch, server continues on failure"

# Metrics
duration: 3min
completed: 2026-02-06
---

# Quick Task 001: Local Domain + Hosts File + Certificate SAN Summary

**Cross-platform hosts file auto-management (church.audio) with OS-native elevation and TLS certificate SAN inclusion**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-06T21:05:03Z
- **Completed:** 2026-02-06T21:08:29Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- New `hosts.ts` module with cross-platform hosts file management (Windows UAC, macOS osascript, Linux pkexec)
- Default domain changed from `churchaudio.local` to `church.audio` for both mDNS and hosts file schemas
- TLS certificate now includes hosts file domain as additional SAN when it differs from mDNS domain
- Hosts entry created on startup, cleaned up on shutdown, and refreshed on config change via restart trigger

## Task Commits

Each task was committed atomically:

1. **Task 1: Update default domain and create hosts file module** - `aee3c83` (feat)
2. **Task 2: Add hostsFile domain as certificate SAN** - `837e6f8` (feat)
3. **Task 3: Integrate hosts file into server lifecycle and config change detection** - `73b2db4` (feat)

## Files Created/Modified
- `sidecar/src/network/hosts.ts` - Cross-platform hosts file management with elevated write (ensureHostsEntry, removeHostsEntry)
- `sidecar/src/config/schema.ts` - Updated MdnsSchema and HostsFileSchema domain defaults to "church.audio", enabled hostsFile by default
- `sidecar/src/network/certificate.ts` - Added hostsFile domain as DNS SAN (type 2) when different from mDNS domain; TODO for cert regen
- `sidecar/src/server.ts` - Call ensureHostsEntry during startServer (non-fatal on failure)
- `sidecar/src/index.ts` - Call removeHostsEntry during graceful shutdown (best-effort)
- `sidecar/src/ws/handler.ts` - Added network.hostsFile.domain and network.hostsFile.enabled to RESTART_TRIGGERING_FIELDS

## Decisions Made
- Used `church.audio` as the default domain (shorter, memorable, works with hosts file -- `.local` is reserved for mDNS)
- `hostsFile.enabled` defaults to `true` since the feature is now fully implemented
- Used `execSync` intentionally for elevation commands -- elevation dialogs are blocking by nature
- Deferred cert regeneration on domain change to a future TODO (v1: user deletes cert files to force regen)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phones can connect via `https://church.audio:7777` once the hosts file entry is in place
- Future improvement: auto-detect SAN mismatch and regenerate cert when domain config changes
- Admin UI can expose hostsFile.domain and hostsFile.enabled as config fields

---
*Quick Task: 001-local-domain-hosts-cert*
*Completed: 2026-02-06*
