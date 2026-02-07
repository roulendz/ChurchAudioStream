---
phase: 02-audio-capture-pipeline
plan: 04
subsystem: audio-discovery
tags: [sap, sdp, aes67, multicast, discovery, dgram, sdp-transform]
requires:
  - "01: logger utility (sidecar/src/utils/logger.ts)"
  - "02-01: sdp-transform dependency installed"
provides:
  - "SapListener class for AES67 stream discovery via SAP multicast"
  - "parseAes67Sdp function for SDP metadata extraction"
  - "Aes67SdpInfo type for AES67 stream representation"
  - "SapStreamEntry type for stream registry entries"
affects:
  - "02-06: source registry consumes SapListener events"
  - "02-08: channel manager uses discovered streams for source assignment"
  - "02-09: WebSocket API exposes discovered streams to admin UI"
tech-stack:
  added: []
  patterns:
    - "EventEmitter for stream lifecycle events"
    - "Binary protocol parsing (SAP header) from Buffer"
    - "Multicast UDP listener via dgram"
    - "Raw SDP fallback parsing for multi-value attributes (sdp-transform limitation)"
key-files:
  created:
    - sidecar/src/audio/discovery/sdp-parser.ts
    - sidecar/src/audio/discovery/sap-listener.ts
  modified: []
key-decisions:
  - id: "02-04-01"
    decision: "Use originAddress:originSessionId as unique stream key (not SAP hash)"
    reason: "SAP hash is only 16-bit and not guaranteed unique across different origins"
  - id: "02-04-02"
    decision: "Parse channel labels from raw SDP instead of sdp-transform output"
    reason: "sdp-transform treats a=label: as scalar, keeping only the last value; AES67 has one per channel"
  - id: "02-04-03"
    decision: "Strip TTL suffix from multicast connection address"
    reason: "sdp-transform preserves /TTL from c= line (e.g., 239.69.0.121/32); downstream code needs bare IP"
duration: "12 minutes"
completed: "2026-02-07"
---

# Phase 2 Plan 4: SAP Listener and SDP Parser Summary

AES67 stream discovery via SAP multicast (224.2.127.254:9875) with sdp-transform-based SDP parsing, supporting L16/L24 codecs, multichannel streams, and cached stream persistence for instant startup.

## Performance

- Execution time: 12 minutes (2 tasks)
- TypeScript compilation: clean (0 errors)
- All verification tests passed: SDP parsing (L16/L24, mono/stereo/4ch, labels, non-audio rejection), SAP packet handling (discovery, duplicate suppression, update detection, deletion, cache loading)

## Accomplishments

### Task 1: SDP Parser for AES67 Streams
Created `sdp-parser.ts` that wraps the sdp-transform library for AES67-specific SDP extraction.

**Key capabilities:**
- Parses all AES67 SDP fields: session name, multicast address, port, sample rate, channel count, bit depth, payload type, origin address/session ID
- Supports both L16 (16-bit) and L24 (24-bit) PCM codecs
- Handles mono (implicit channel count) and multichannel (explicit) streams
- Extracts per-channel labels from raw SDP (workaround for sdp-transform scalar limitation)
- Strips TTL suffix from multicast connection addresses
- Returns null for non-audio or malformed SDP (defensive parsing)

### Task 2: SAP Multicast Listener
Created `sap-listener.ts` implementing the SapListener class for receiving SAP multicast announcements.

**Key capabilities:**
- Joins SAP multicast group 224.2.127.254:9875 via Node.js dgram
- Parses SAP binary header: version, message type, hash, origin IPv4
- Handles announcement packets (discover/update) and deletion packets (remove)
- Emits typed events: stream-discovered, stream-updated, stream-removed, error
- Maintains known streams registry with lastSeen timestamps
- Supports cached stream loading for instant startup (SAP has up to 300s intervals)
- Detects SDP field changes to distinguish updates from silent re-announcements
- Handles edge cases: MIME-type-less packets, authentication data skip, IPv6 rejection

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | Create SDP parser for AES67 streams | c5dc234 | feat |
| 2 | Create SAP multicast listener | 33623c1 | feat |

## Files Created

| File | Purpose |
|------|---------|
| sidecar/src/audio/discovery/sdp-parser.ts | AES67 SDP parser using sdp-transform |
| sidecar/src/audio/discovery/sap-listener.ts | SAP multicast listener for stream discovery |

## Files Modified

None -- both files are new.

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 02-04-01 | Use originAddress:originSessionId as unique stream key | SAP hash is 16-bit and not guaranteed unique across origins. RFC 2974 recommends using origin info for identification. |
| 02-04-02 | Parse channel labels from raw SDP, not sdp-transform output | sdp-transform treats `a=label:` as a scalar attribute and only keeps the last value. AES67 devices may send one label per channel, requiring manual multi-value extraction. |
| 02-04-03 | Strip TTL suffix from multicast connection address | sdp-transform preserves the `/TTL` suffix from `c=` lines (e.g., `239.69.0.121/32`). Downstream GStreamer pipeline and display code needs the bare IP address. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed multicast address including TTL suffix**
- **Found during:** Task 1 verification
- **Issue:** sdp-transform returns connection IP as "239.69.0.121/32" including TTL
- **Fix:** Added `stripMulticastTtl()` helper to extract bare IP address
- **Files modified:** sidecar/src/audio/discovery/sdp-parser.ts
- **Commit:** c5dc234

**2. [Rule 1 - Bug] Fixed channel labels not extracted (sdp-transform scalar handling)**
- **Found during:** Task 1 verification
- **Issue:** sdp-transform treats `a=label:` as scalar, keeping only last value; multi-channel labels lost
- **Fix:** Added `extractChannelLabelsFromRawSdp()` that parses labels directly from SDP text within the audio media block
- **Files modified:** sidecar/src/audio/discovery/sdp-parser.ts
- **Commit:** c5dc234

**3. [Rule 3 - Blocking] Installed sdp-transform dependency**
- **Found during:** Pre-task setup
- **Issue:** sdp-transform was not yet installed (parallel execution, 02-01 may not have completed)
- **Fix:** Ran `npm install sdp-transform` and `npm install -D @types/sdp-transform`
- **Files modified:** sidecar/package.json, sidecar/package-lock.json (already committed by parallel plan 02-01)
- **Commit:** N/A (dependency already tracked in 02-01 commit)

## Issues Encountered

None -- all issues were resolved during execution (see Deviations).

## Next Phase Readiness

**Immediate consumers (Plan 02-06: Source Registry):**
- SapListener exports are ready: `SapListener` class, `SapStreamEntry` interface
- Events (stream-discovered, stream-updated, stream-removed) provide the lifecycle hooks needed
- `getKnownStreams()` and `loadCachedStreams()` enable persistence

**Integration points verified:**
- `parseAes67Sdp` is imported by `sap-listener.ts` and works correctly
- Logger integration with existing `sidecar/src/utils/logger.ts` confirmed
- TypeScript compilation passes with full project (no cross-file issues)

**No blockers for downstream plans.**
