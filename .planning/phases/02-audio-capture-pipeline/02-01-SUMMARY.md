---
phase: 02-audio-capture-pipeline
plan: 01
subsystem: audio-types
tags: [typescript, zod, types, audio, aes67, wasapi, asio, pipeline]
requires:
  - phase-01 (config store, Zod schemas)
provides:
  - Audio source type system (AES67Source, LocalDeviceSource, DiscoveredSource)
  - Channel types (AppChannel, SourceAssignment, ChannelOutputFormat)
  - Pipeline types (PipelineState, PipelineConfig, AudioLevels, PipelineError, PipelineStats)
  - Zod audio config schemas (AudioSchema, ChannelSchema, SourceAssignmentSchema)
  - npm dependencies (sdp-transform, pidusage, @types/sdp-transform)
affects:
  - 02-02 (pipeline builder uses PipelineConfig, AudioLevels)
  - 02-03 (process wrapper uses PipelineState, PipelineError, PipelineStats)
  - 02-04 (SAP listener populates AES67Source using sdp-transform)
  - 02-05 (device enumerator populates LocalDeviceSource)
  - 02-06 (source registry stores DiscoveredSource)
  - 02-07 (level monitor uses AudioLevels, resource monitor uses PipelineStats)
  - 02-08 (channel manager uses AppChannel, SourceAssignment)
  - 02-09 (WebSocket API exposes all types)
tech-stack:
  added:
    - sdp-transform@3.0.0 (SDP parsing for AES67 stream discovery)
    - pidusage@4.0.1 (cross-platform process CPU/memory monitoring)
    - "@types/sdp-transform@2.15.0" (TypeScript definitions)
  patterns:
    - Discriminated union types (DiscoveredSource = AES67Source | LocalDeviceSource)
    - Discriminated union for PipelineConfig (sourceType discriminator with never-typed exclusions)
    - Zod factory defaults for nested schemas (.default(() => SubSchema.parse({})))
key-files:
  created:
    - sidecar/src/audio/sources/source-types.ts
    - sidecar/src/audio/channels/channel-types.ts
    - sidecar/src/audio/pipeline/pipeline-types.ts
  modified:
    - sidecar/src/config/schema.ts
    - sidecar/package.json
    - sidecar/package-lock.json
key-decisions:
  - "PipelineConfig uses discriminated union with never-typed exclusions instead of optional fields -- ensures exactly one config block is populated per source type"
  - "AES67Source and LocalDeviceSource use readonly properties for immutable discovery data, mutable only for status and lastSeenAt"
  - "Aes67PipelineConfig and LocalPipelineConfig extracted as named interfaces for clarity (SRP) rather than inline object types"
duration: 11m
completed: 2026-02-07
---

# Phase 2 Plan 1: Audio Type System and Config Schemas Summary

Discriminated union type system for AES67 and local audio sources, with Zod config schemas for channel/pipeline configuration, plus sdp-transform and pidusage npm dependencies for Phase 2.

## Performance

- Execution time: 11 minutes
- Zero type errors throughout
- Zero regressions in existing config store

## Accomplishments

1. **Installed npm dependencies** -- sdp-transform (SDP parsing for AES67 discovery), pidusage (process resource monitoring), and @types/sdp-transform (TypeScript definitions)

2. **Created source-types.ts** -- Complete type system for audio source discovery:
   - `AES67Source`: 14 fields covering multicast address, SDP metadata, channel labels, sample rate/bit depth
   - `LocalDeviceSource`: 12 fields covering Windows audio APIs (WASAPI, ASIO, DirectSound), loopback capture
   - `DiscoveredSource` discriminated union with `type` field as discriminator
   - `AudioApi` and `SourceStatus` string literal types

3. **Created channel-types.ts** -- App channel and source assignment types:
   - `AppChannel`: mix bus with multiple source assignments, output format, auto-start, lifecycle status
   - `SourceAssignment`: per-source gain (0-2x), mute toggle, delay offset (0-5000ms), channel selection
   - `ChannelOutputFormat` and `ChannelStatus` string literal types

4. **Created pipeline-types.ts** -- GStreamer pipeline process management types:
   - `PipelineState`: 7-state lifecycle (initializing through crashed)
   - `AudioLevels`: peak/rms/decay per channel with clipping detection
   - `PipelineStats`: CPU%, memory, uptime, PID from pidusage
   - `PipelineError`: user-friendly message + full GStreamer technical details
   - `PipelineConfig`: discriminated union ensuring exactly one of aes67Config or localConfig

5. **Extended Zod config schemas** -- Six new schemas added to schema.ts:
   - `LevelMeteringSchema`: interval 10-1000ms, default 100ms
   - `SourceAssignmentSchema`: gain 0-2, delay 0-5000ms, min 1 selected channel
   - `ChannelSchema`: UUID id, name 1-100 chars, output format, auto-start
   - `PipelineRecoverySchema`: auto-restart with 5 attempts, 2s delay, 500ms drain
   - `DiscoveryCacheSchema`: enabled by default, 5s device poll interval
   - `AudioSchema`: groups channels + metering + recovery + discovery
   - `ConfigSchema` extended with `audio` section using factory default pattern

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Install dependencies and create audio type definitions | 3e23527 | source-types.ts, channel-types.ts, pipeline-types.ts, package.json |
| 2 | Extend Zod config schemas for audio channels and sources | 37471b7 | schema.ts |

## Files Created

| File | Purpose |
|------|---------|
| sidecar/src/audio/sources/source-types.ts | AES67Source, LocalDeviceSource, DiscoveredSource, AudioApi, SourceStatus |
| sidecar/src/audio/channels/channel-types.ts | AppChannel, SourceAssignment, ChannelOutputFormat, ChannelStatus |
| sidecar/src/audio/pipeline/pipeline-types.ts | PipelineState, PipelineConfig, AudioLevels, PipelineError, PipelineStats |

## Files Modified

| File | Change |
|------|--------|
| sidecar/src/config/schema.ts | Added 6 audio schemas, extended ConfigSchema with audio section |
| sidecar/package.json | Added sdp-transform, pidusage deps; @types/sdp-transform devDep |
| sidecar/package-lock.json | Lockfile updated with new dependencies |

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| PipelineConfig as discriminated union with never-typed exclusions | Type-safe: exactly one of aes67Config or localConfig is populated; prevents accidentally setting both |
| Readonly properties on discovery data, mutable on status fields | Discovery metadata is immutable once parsed from SAP/device monitor; only status and timestamps change |
| Extracted Aes67PipelineConfig and LocalPipelineConfig as named interfaces | SRP: each config block is a focused interface; easier to reference individually in pipeline builder |

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

**Ready for 02-02 (GStreamer pipeline string builder)**
- PipelineConfig provides all fields needed to construct GStreamer pipeline strings
- AudioLevels type ready for metering parser output
- AudioApi type available for API-specific pipeline element selection

**Ready for 02-04 (SAP listener)**
- AES67Source type defines all fields to populate from SDP parsing
- sdp-transform dependency installed and available

**Ready for 02-05 (Device enumerator)**
- LocalDeviceSource type defines all fields to populate from gst-device-monitor JSON
- AudioApi type covers all three Windows audio APIs

**No blockers for any subsequent Phase 2 plan.**
