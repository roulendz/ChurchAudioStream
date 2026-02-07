---
phase: 02-audio-capture-pipeline
plan: 06
subsystem: audio-discovery
tags: [event-emitter, source-registry, sap, mdns, bonjour, device-enumeration, persistence]

# Dependency graph
requires:
  - phase: 02-01
    provides: "DiscoveredSource, AES67Source, LocalDeviceSource, SourceStatus types"
  - phase: 02-04
    provides: "SapListener with stream-discovered/updated/removed events, Aes67SdpInfo"
  - phase: 02-05
    provides: "DeviceEnumerator with device-added/removed/enumeration-complete events"
provides:
  - "SourceRegistry: unified in-memory store for all discovered audio sources with persistence"
  - "DiscoveryManager: coordinator for SAP, mDNS, and device enumeration discovery"
affects:
  - "02-08 (channel assignment needs SourceRegistry to list available sources)"
  - "02-09 (integration plan wires DiscoveryManager into app startup)"
  - "Phase 4 (admin UI displays sources from SourceRegistry events)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Debounced JSON persistence for in-memory store (2s debounce via setTimeout)"
    - "Reverse lookup map for SAP hash+origin to source ID (deletion packets lack session ID)"
    - "Coordinator pattern: DiscoveryManager orchestrates three independent discovery mechanisms"
    - "Reconciliation pattern: full enumeration marks missing sources unavailable"

key-files:
  created:
    - "sidecar/src/audio/sources/source-registry.ts"
    - "sidecar/src/audio/discovery/discovery-manager.ts"
  modified: []

key-decisions:
  - "SAP deletion reverse map: DiscoveryManager tracks sapHash+originAddress->sourceId because deletion packets lack the originSessionId needed to build source IDs"
  - "mDNS RAVENNA discovery is log-only: sources not created without SDP (SAP provides SDP for pipeline construction)"
  - "Preserve discoveredAt on AES67 source updates by reading existing value from registry"

patterns-established:
  - "Registry pattern: SourceRegistry as single source of truth with EventEmitter notifications"
  - "Coordinator pattern: DiscoveryManager wires multiple event sources into one registry"
  - "Reconciliation on full enumeration: mark absent local sources unavailable"

# Metrics
duration: 4min
completed: 2026-02-07
---

# Phase 2 Plan 6: Source Registry and Discovery Manager Summary

**Unified SourceRegistry with JSON persistence and DiscoveryManager coordinating SAP, mDNS, and device enumeration into a single source-of-truth store**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-07T14:08:45Z
- **Completed:** 2026-02-07T14:12:31Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments
- SourceRegistry provides typed in-memory store with EventEmitter events for UI refresh
- JSON cache persistence with debounced writes survives restarts; cached sources re-verified on load
- DiscoveryManager coordinates SAP listener (AES67), mDNS browser (RAVENNA), and device enumerator (local audio)
- Deterministic source IDs ensure same physical source maps to same ID across restarts

## Task Commits

Each task was committed atomically:

1. **Task 1: Create SourceRegistry with persistence** - `abd1a4d` (feat)
2. **Task 2: Create DiscoveryManager coordinator** - `404bab3` (feat)

## Files Created/Modified
- `sidecar/src/audio/sources/source-registry.ts` - Unified source store with add/update/remove/query API and debounced JSON persistence
- `sidecar/src/audio/discovery/discovery-manager.ts` - Coordinator wiring SAP, mDNS, and device events into SourceRegistry

## Decisions Made
- **SAP deletion reverse map:** DiscoveryManager maintains a `Map<string, string>` mapping `${sapHash}:${originAddress}` to source ID, because SAP deletion packets only carry hash + origin (not the originSessionId needed for source IDs). This avoids iterating the entire registry on each deletion.
- **mDNS log-only:** RAVENNA devices found via mDNS are logged but do not create source entries. Full SDP info (sample rate, channels, multicast address) is only available from SAP announcements, which are required to build GStreamer pipelines.
- **Preserve discoveredAt:** When updating an existing AES67 source, the `discoveredAt` timestamp is preserved from the existing registry entry rather than overwritten with the current time.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- SourceRegistry and DiscoveryManager ready for integration into app startup (02-09)
- Channel assignment (02-08) can query SourceRegistry for available sources
- Admin UI (Phase 4) can subscribe to SourceRegistry events for live source list updates

---
*Phase: 02-audio-capture-pipeline*
*Completed: 2026-02-07*
