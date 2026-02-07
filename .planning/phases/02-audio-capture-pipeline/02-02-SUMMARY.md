---
phase: 02-audio-capture-pipeline
plan: 02
subsystem: audio-pipeline
tags: [gstreamer, pipeline, metering, aes67, wasapi, asio, directsound, audio-levels]
requires:
  - 02-01 (PipelineConfig, AudioLevels, AudioApi types)
provides:
  - buildPipelineString function for all 5 source types (AES67, WASAPI, ASIO, DirectSound, WASAPI Loopback)
  - parseMeteringLine, dbToNormalized, createStderrLineParser for GStreamer level metering
affects:
  - 02-03 (process wrapper calls buildPipelineString, uses createStderrLineParser for stderr)
  - 02-07 (level monitor consumes AudioLevels from metering parser)
  - 02-08 (channel manager uses pipeline builder via process manager)
tech-stack:
  added: []
  patterns:
    - Dispatch table for API-specific pipeline builders (LOCAL_PIPELINE_BUILDERS record)
    - Streaming line parser with partial-line accumulation (prevents stderr buffer overflow)
    - GStreamer deinterleave/interleave for channel selection from multichannel streams
key-files:
  created:
    - sidecar/src/audio/pipeline/pipeline-builder.ts
    - sidecar/src/audio/pipeline/metering-parser.ts
  modified: []
key-decisions:
  - "Dispatch table (Record<AudioApi, builderFn>) instead of switch statement for local pipeline builders -- extensible without modifying control flow"
  - "Channel selection helper shared between AES67 and local device builders (DRY) with separate local variant for devices without known total channel count"
  - "dbToNormalized treats anything <= -60 dB as 0 (silence floor) to avoid near-zero display noise"
  - "createStderrLineParser accumulates partial lines across chunk boundaries to handle Buffer splits mid-line"
duration: 14m
completed: 2026-02-07
---

# Phase 2 Plan 2: GStreamer Pipeline String Builder and Level Metering Parser Summary

Pipeline builder generates valid gst-launch-1.0 CLI strings for AES67 (L16/L24), WASAPI, ASIO, DirectSound, and WASAPI Loopback with channel selection via deinterleave; metering parser extracts peak/rms/decay dB arrays from level element stderr with clipping detection.

## Performance

- Execution time: 14 minutes
- Zero type errors throughout
- 43/43 inline assertions passed for metering parser
- 7/7 pipeline string variants verified correct

## Accomplishments

1. **Created pipeline-builder.ts** -- Single entry point `buildPipelineString(config: PipelineConfig): string` that delegates to API-specific internal builders:
   - `buildAes67Pipeline`: udpsrc multicast RTP with rtpjitterbuffer, rtpL16depay/rtpL24depay selection based on bitDepth, deinterleave for mono/stereo channel extraction from multichannel streams
   - `buildWasapiPipeline`: wasapi2src with low-latency mode or loopback mode, device ID quoting for Windows paths
   - `buildAsioPipeline`: asiosrc with CLSID device identification, native input-channels selection, configurable buffer-size
   - `buildDirectSoundPipeline`: directsoundsrc as legacy fallback with channel selection
   - All pipelines end with `audioconvert ! audioresample ! level interval={ns} post-messages=true ! fakesink sync=false`

2. **Created metering-parser.ts** -- Three exported functions:
   - `parseMeteringLine(line)`: Regex-based extraction of peak, rms, decay dB arrays from GStreamer level element messages; handles single-channel (no braces) and multi-channel (with braces) formats; handles `-inf` for silence; detects clipping at -0.1 dB threshold
   - `dbToNormalized(db)`: Converts dB to 0.0-1.0 display range via `10^(dB/20)`, with -60 dB silence floor
   - `createStderrLineParser(onLevels, onError)`: Streaming line-by-line parser that handles Buffer chunk splits across line boundaries; forwards level data to onLevels callback and GStreamer errors/warnings to onError callback; prevents stderr buffer overflow (Pitfall 5 from research)

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create GStreamer pipeline string builder | fbd8e3c | pipeline-builder.ts |
| 2 | Create GStreamer level metering stderr parser | 460c9b4 | metering-parser.ts |

## Files Created

| File | Purpose |
|------|---------|
| sidecar/src/audio/pipeline/pipeline-builder.ts | buildPipelineString -- constructs GStreamer CLI pipeline strings for all 5 source types |
| sidecar/src/audio/pipeline/metering-parser.ts | parseMeteringLine, dbToNormalized, createStderrLineParser -- parses level element stderr output |

## Files Modified

None -- both files are new creations. Type dependencies (pipeline-types.ts, source-types.ts) already existed from 02-01.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Dispatch table for local API builders | Record<AudioApi, builderFn> is extensible without switch/case modification; adding a new API means adding one table entry |
| Separate channel selection for AES67 vs local | AES67 knows total channel count from SDP; local devices may not, so channel selection logic differs slightly (SRP) |
| -60 dB silence floor in dbToNormalized | Values below -60 dB are imperceptible; treating them as 0 prevents display artifacts from near-zero floating point noise |
| Partial-line accumulation in stderr parser | GStreamer stderr chunks can split mid-line at Buffer boundaries; accumulating prevents garbled level data |

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

**Ready for 02-03 (GStreamer process wrapper)**
- `buildPipelineString` provides the pipeline string that the process wrapper passes to `gst-launch-1.0`
- `createStderrLineParser` provides the stderr processing callback for the child process

**Ready for 02-07 (Level monitor)**
- `parseMeteringLine` returns `AudioLevels` objects that the level monitor aggregates and broadcasts via WebSocket
- `dbToNormalized` converts dB values for VU meter display in the admin dashboard

**No blockers for any subsequent Phase 2 plan.**
