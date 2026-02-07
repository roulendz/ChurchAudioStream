---
phase: "03"
plan: "02"
title: "Pipeline Builder Processing Chain & Gain Reduction"
status: "complete"
subsystem: "audio-pipeline"
tags: ["gstreamer", "audioloudnorm", "opusenc", "rtpopuspay", "agc", "gain-reduction", "pipeline-builder"]

dependency-graph:
  requires: ["03-01"]
  provides: ["buildProcessingAndOutputTail", "buildAgcChain", "buildOpusRtpChain", "gainReductionDb"]
  affects: ["03-03", "04-xx", "05-xx"]

tech-stack:
  added: []
  patterns: ["source-head/tail separation", "4-case processing matrix (AGC x Opus)", "gain reduction estimation"]

key-files:
  created: []
  modified:
    - "sidecar/src/audio/pipeline/pipeline-builder.ts"
    - "sidecar/src/audio/monitor/level-monitor.ts"

decisions:
  - id: "03-02-01"
    description: "Source-head/tail separation pattern: source builders return head only, buildPipelineString appends tail"
    rationale: "Eliminates duplication of processing chain logic across 4 source builders (AES67, WASAPI, ASIO, DirectSound)"
  - id: "03-02-02"
    description: "4-case processing matrix handles all AGC x Opus enable/disable combinations"
    rationale: "Each combination produces structurally different GStreamer pipeline (tee presence, caps enforcement, etc.)"
  - id: "03-02-03"
    description: "Gain reduction estimated as (avgRmsDb - targetLufs) approximation"
    rationale: "Simple heuristic suitable for admin dashboard indicator; not a precise measurement but indicates AGC activity"

metrics:
  duration: "4 minutes"
  completed: "2026-02-07"
  tasks: 2
  commits: 2
---

# Phase 03 Plan 02: Pipeline Builder Processing Chain & Gain Reduction Summary

**One-liner:** Refactored pipeline builder with audioloudnorm AGC (192kHz audioresample wrappers), Opus/RTP encoding output, 4-case processing matrix, and gain reduction tracking in level monitor.

## What Was Done

### Task 1: Pipeline Builder Processing Chain and Opus/RTP Output
**Commit:** `cd6972a`

Refactored `pipeline-builder.ts` from monolithic source-specific builders (each inlining metering tail) into a clean source-head/tail separation pattern:

- **buildSourceHead()** dispatches to source-specific builders that return only the source element + channel selection
- **buildProcessingAndOutputTail()** handles all 4 processing combinations:
  - Case A (AGC + Opus): AGC chain -> tee -> [metering, Opus/RTP]
  - Case B (AGC only): AGC chain -> metering (no tee)
  - Case C (Opus only): caps enforcement -> tee -> [metering, Opus/RTP]
  - Case D (both off): Phase 2 metering tail (identical output)
- **buildAgcChain()**: `audioconvert ! audioresample ! audio/x-raw,rate=192000 ! audioloudnorm ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1`
- **buildOpusRtpChain()**: `opusenc ! rtpopuspay ! rtpbin ! udpsink` (RTP) + `rtpbin.send_rtcp_src_0 ! udpsink` (RTCP)
- Per-SSRC unique rtpbin naming prevents GStreamer element name collisions
- Phase 2 backward compatibility: no processing config = identical metering-only pipeline

### Task 2: Gain Reduction Tracking in Level Monitor
**Commit:** `e7eeecc`

Extended `level-monitor.ts` with gain reduction estimation:

- Added `gainReductionDb` field to `NormalizedLevels` interface
- Added `processingTargets` map for per-pipeline AGC target LUFS storage
- `setProcessingTarget(pipelineId, targetLufs)` / `clearProcessingTarget(pipelineId)` methods
- Gain reduction = average RMS dB - target LUFS (silence returns 0, no target returns 0)
- `clearPipeline()` now also clears the processing target

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Pipeline builder processing chain and Opus/RTP output | cd6972a | pipeline-builder.ts |
| 2 | Gain reduction tracking in level monitor | e7eeecc | level-monitor.ts |

## Verification Results

1. `npx tsc --noEmit` passes with zero errors
2. Pipeline builder produces correct strings for all 4 processing combinations (tested via node runtime)
3. Phase 2 backward compatibility confirmed: identical output without processing config
4. NormalizedLevels includes gainReductionDb field
5. Pipeline strings contain audioloudnorm wrapped in audioresample (48kHz <-> 192kHz)
6. Pipeline strings contain opusenc with correct audio-type naming (voice for speech, generic for music)
7. Pipeline strings contain rtpopuspay + udpsink targeting localhost with per-channel ports and SSRC

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 03-02-01 | Source-head/tail separation: source builders return head only | Eliminates duplication of processing chain across 4 source builders |
| 03-02-02 | 4-case processing matrix (AGC x Opus enable/disable) | Each combination produces structurally different GStreamer pipeline |
| 03-02-03 | Gain reduction = (avgRmsDb - targetLufs) approximation | Simple heuristic for admin dashboard indicator |

## Deviations from Plan

None -- plan executed exactly as written.

## Next Phase Readiness

### For Plan 03-03 (Integration and Pipeline Manager Updates)
- Pipeline builder now accepts `ProcessingConfig` and produces complete processing pipelines
- Level monitor tracks gain reduction when processing targets are set
- Pipeline manager will need to call `setProcessingTarget()` when starting processing pipelines
- All 4 bypass combinations are handled, so pipeline manager can freely toggle AGC/Opus per channel

## Self-Check: PASSED
