# Phase 4: Pre-Phase 04 Audit Findings

**Audited:** 2026-02-07
**Scope:** Comprehensive codebase audit across 4 parallel agents before Phase 04 planning.

The following findings should be incorporated into Phase 04 plans where relevant.

## Blockers Fixed (implemented before Phase 04)

These were fixed in the codebase before Phase 04 planning began:

1. **Windows GStreamer shutdown** — `child.kill('SIGTERM')` on Windows calls `TerminateProcess()` (instant kill, no EOS). Fixed: Unix uses SIGINT for EOS; Windows closes stdin as best-effort, falls back to force-kill.
2. **Pipeline crash exponential backoff** — Fixed restart delay from fixed to `baseDelay * 2^(attempt-1)`, capped at `maxRestartDelayMs` (default 30s). Added `maxRestartDelayMs` to `RecoveryConfig` and `PipelineRecoverySchema`.
3. **Shutdown timeout** — `audioSubsystem.stop()` now uses `Promise.race` with 30s timeout to prevent hung GStreamer processes from blocking shutdown.
4. **Level monitor memory leak** — `ChannelManager` now cleans up `LevelMonitor` and `ResourceMonitor` state when `MAX_RESTARTS_EXCEEDED` fires for abandoned pipelines.

## DRY/SRP Fixes (implement during Phase 04)

| # | Violation | Files | Recommended Fix | Plan |
|---|-----------|-------|-----------------|------|
| 1 | Debounce pattern duplicated 4x | `channel-manager.ts`, `event-logger.ts`, `pipeline-manager.ts`, `source-registry.ts` | Extract `scheduleDebounced<T>()` utility to `utils/` | 04-01 |
| 2 | Channel data mapping duplicated | `channel-manager.ts` (load vs persist identical object mapping) | Extract `normalizeSourceAssignment()` and `normalizeProcessingConfig()` helpers | 04-01 |
| 3 | Channel selection logic duplicated | `pipeline-builder.ts` (`buildChannelSelection` and `buildChannelSelectionForLocal` identical for mono/stereo) | Consolidate into single `buildChannelSelectionString()` | 04-01 |
| 4 | Timer clearing not extracted | `event-logger.ts` (clearChannel + scheduleDebouncedFlush) | Extract `clearFlushTimer()` helper | 04-01 |
| 5 | Error narrowing repeated ~5 files | `err instanceof Error ? err.message : String(err)` | Extract `toErrorMessage(err: unknown)` to `utils/` | 04-01 |

## Architecture Improvements (implement during Phase 04)

| # | Issue | Risk | Recommendation | Plan |
|---|-------|------|----------------|------|
| 1 | No source existence validation | Assigning removed source -> cryptic GStreamer error | Already fixed in addSource() (line 313) -- verify preserved | 04-05 |
| 2 | Race conditions on concurrent channel updates | Two WebSocket clients -> lost writes | Queue/serialize updates per channelId | 04-05 |
| 3 | mediasoup PlainTransport should persist across GStreamer restarts | Config change restarts transport (expensive) | Keep PlainTransport alive, only restart GStreamer process | 04-03 |
| 4 | No pipeline stall detection | GStreamer deadlock without crash | Heartbeat: if no `levels` event for 10s, consider stalled and restart | 04-05 |
| 5 | EventLogger disk-full handling | `appendFileSync` throws -> events silently lost | Try-catch with in-memory buffer fallback | 04-01 |
| 6 | ChannelManager SRP at limit (~1220 lines) | Adding Phase 4 features will push it over | Consider splitting into `ChannelRegistry`, `ChannelPipelineOrchestrator`, `ChannelProcessingManager` | Phase 8+ |

## mediasoup Best Practices (critical for Phase 04)

1. **Worker rotation** — mediasoup C++ workers can retain ~600MB after sessions end (GitHub #769). Monitor via `worker.getResourceUsage()`. Phase 4 should add basic monitoring; Phase 8 adds auto-rotation.
2. **Garbage collection** — Every mediasoup resource must be explicitly cleaned up via event listeners:
   - `worker.on("died")` -> restart worker, recreate routers
   - `router.on("workerclose")` -> clean up references
   - `transport.on("routerclose")` -> clean up references
   - `producer.on("transportclose")` -> clean up references
   - `consumer.on("transportclose")` and `consumer.on("producerclose")` -> clean up references
3. **PlainTransport for GStreamer** — Create with `rtcpMux: false` (matching Phase 3's separate RTP/RTCP ports). Transport creation is expensive (IPC with C++ worker), so persist transports across GStreamer process restarts.
4. **Worker-per-core** — One worker handles 500+ audio consumers. Default 1 worker is sufficient for church WiFi (100-200 devices).
5. **Proper shutdown order** — Notify listeners -> drain 5-10s -> close mediasoup workers -> close GStreamer pipelines.

## GStreamer Integration Best Practices

1. **EOS-based shutdown** — On Unix, SIGINT (not SIGTERM) triggers EOS when `-e` flag is active. Already fixed in pre-Phase 04 blocker.
2. **Pipeline health heartbeat** — If no `levels` events arrive for 10s, pipeline is stalled (GStreamer deadlock). LevelMonitor could detect this and trigger restart.
3. **Processing in GStreamer, not Node.js** — Current architecture is correct. Audio processing must stay in GStreamer process for zero-copy data flow and sub-millisecond scheduling. Never cross the process boundary for audio data.
4. **webrtcdsp element** — Consider for Speech mode as complement to `audioloudnorm` (provides WebRTC-grade AGC, VAD, high-pass filtering). Lower priority, v2 consideration.
5. **GStreamer plugin validation at startup** — Run `gst-inspect-1.0 audioloudnorm` and `gst-inspect-1.0 opusenc` at startup to catch missing plugins early.

## Configuration Management

1. **Config versioning** — Add `version` field to config schema with migration functions for breaking changes. Prevents user config being silently reset to defaults on upgrade.
2. **Separate infrastructure vs user preferences** — Server port, cert paths, RTP ports have different lifecycle from channel names, AGC settings. Consider splitting.
3. **Config change events** — ConfigStore should emit change events so components can react without restart (e.g., DiscoveryManager's `devicePollIntervalMs`).

---

*Audit date: 2026-02-07*
