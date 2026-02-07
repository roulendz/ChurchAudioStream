---
phase: 03-audio-processing
plan: 01
subsystem: audio-processing
tags: [types, zod, config, rtp, opus, agc, port-allocation]
depends_on:
  requires: [02-01, 02-08]
  provides: [ProcessingConfig types, Zod processing schemas, port allocator, PipelineConfig extension]
  affects: [03-02, 03-03, 04-01]
tech-stack:
  added: []
  patterns: [mode-derivation pure function, deterministic SSRC via FNV-1a, Zod factory defaults for nested schemas]
key-files:
  created:
    - sidecar/src/audio/processing/processing-types.ts
    - sidecar/src/audio/processing/port-allocator.ts
  modified:
    - sidecar/src/config/schema.ts
    - sidecar/src/audio/pipeline/pipeline-types.ts
key-decisions:
  - "FNV-1a 32-bit hash for deterministic SSRC generation from channel UUID"
  - "frameSize stored as string enum in Zod for JSON serialization (convert to number at pipeline build time)"
  - "ProcessingConfig optional on PipelineConfig (Phase 2 pipelines unchanged)"
  - "Zod factory defaults fill processing config for existing channels without processing field"
duration: 5 minutes
completed: 2026-02-07
---

# Phase 3 Plan 1: Processing Type Definitions and Config Schemas Summary

Processing type system and config persistence for AGC/normalization, Speech/Music mode, Opus encoding, and RTP output port allocation -- the foundation all subsequent Phase 3 plans build upon.

## Performance

- **Start:** 2026-02-07T17:06:15Z
- **End:** 2026-02-07T17:10:49Z
- **Duration:** 5 minutes
- **Tasks:** 2/2

## Accomplishments

1. **Processing type definitions** -- `ProcessingConfig`, `AgcConfig`, `OpusEncodingConfig`, `RtpOutputConfig` interfaces with readonly properties and `AudioModeType` literal union
2. **Mode derivation** -- `deriveSettingsFromMode` pure function toggles `audioType` (voice/generic) and `maxTruePeakDbtp` (-2/-1) based on Speech/Music mode while preserving all other settings
3. **Port allocator** -- Deterministic RTP/RTCP port pairs starting at 77702 (+2 per channel index), FNV-1a SSRC generation from channel UUID (guaranteed non-zero)
4. **Zod schemas** -- `AgcSchema`, `OpusEncodingSchema`, `RtpOutputSchema`, `ProcessingSchema` with validated ranges (LUFS -20 to -14, bitrate 48-192, peak -6 to 0) and factory defaults
5. **ChannelSchema extension** -- Processing config persisted per channel; existing channels without processing field get defaults via Zod
6. **PipelineConfig extension** -- Optional `processing` field; Phase 2 metering-only pipelines continue working without changes

## Task Commits

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Processing type definitions and port allocator | 2d02f64 | processing-types.ts, port-allocator.ts |
| 2 | Zod schemas and PipelineConfig extension | 16313e0 | schema.ts, pipeline-types.ts |

## Files Created

- `sidecar/src/audio/processing/processing-types.ts` -- ProcessingConfig, AgcConfig, OpusEncodingConfig, RtpOutputConfig, ProcessingDefaults, deriveSettingsFromMode
- `sidecar/src/audio/processing/port-allocator.ts` -- RTP_BASE_PORT, getPortsForChannel, generateSsrc (FNV-1a)

## Files Modified

- `sidecar/src/config/schema.ts` -- Added AgcSchema, OpusEncodingSchema, RtpOutputSchema, ProcessingSchema; extended ChannelSchema with processing field
- `sidecar/src/audio/pipeline/pipeline-types.ts` -- Added optional ProcessingConfig import and field to PipelineConfig

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| FNV-1a 32-bit hash for SSRC generation | Deterministic, fast, non-cryptographic hash with good distribution; guarantees unique non-zero SSRCs from channel UUIDs without random collisions |
| frameSize as string enum in Zod | JSON serialization stores string values; numeric conversion happens at pipeline build time where type safety is enforced by ProcessingConfig interface |
| ProcessingConfig optional on PipelineConfig | Phase 2 capture-only pipelines (no processing) continue to work without any code changes; Phase 3 pipelines include processing when the field is present |
| Zod factory defaults for processing sub-schemas | Existing config.json files with channels that lack a processing key get full default processing config via Zod parse -- no migration needed |

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

**Ready for 03-02 (Processing Pipeline Builder):**
- ProcessingConfig type system complete and exported
- Port allocator ready for use in pipeline string construction
- PipelineConfig extended with optional processing field
- Zod schemas provide validated defaults for config persistence

**No blockers.** All types and schemas needed by the pipeline builder (03-02) and channel manager integration (03-03) are in place.

## Self-Check: PASSED
