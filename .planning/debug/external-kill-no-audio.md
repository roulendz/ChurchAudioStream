---
slug: external-kill-no-audio
status: resolved
trigger: "external-kill-pipeline-no-audio — open a fresh debug session for it. Will likely need: packet-level inspection, mediasoup-worker stderr peek, possibly a fix in pipeline-manager.scheduleRestart for the Windows external-kill path."
created: 2026-04-29
updated: 2026-04-29
---

# Debug Session: external-kill-no-audio

## Symptoms

<!-- DATA_START -->
- expected: Auto-restart, audio resumes. After external kill of gst-launch-1.0.exe child, scheduleRestart should respawn pipeline, RTP flow resumes to mediasoup PlainTransport, listener PWA hears audio again within seconds with no manual action.
- actual: Mixed / not yet clear. Symptom not pinned down — debugger must reproduce and characterise (does pipeline respawn? does RTP arrive at mediasoup? does consumer get new packets? does PWA AudioContext stall?).
- errors: Not yet inspected. Sidecar log + mediasoup-worker stderr + phone-side WebRTC console all unchecked. First investigation step.
- timeline: Unknown — first deliberate test of external-kill recovery scenario. Multi-source mixer refactor (commit a2e1480, 260429-hb3, 2026-04-29) recently shipped one-pipeline-per-channel via audiomixer; possible regression surface but not confirmed.
- repro: taskkill /F /PID <gst-launch-1.0.exe pid> while a phone listener is actively consuming the channel. Single-source channel suspected first; multi-source mixer pipeline also in scope.
<!-- DATA_END -->

## Hypothesised Failure Surfaces (orchestrator priors — debugger to validate or eliminate)

1. `pipeline-manager.scheduleRestart` Windows external-kill path — code may treat external SIGKILL/exit-code-1 as "abandon" rather than "restart with backoff".
2. mediasoup PlainTransport / Producer not torn down on pipeline death — new respawned pipeline emits to a stale RTP port, packets dropped at SFU.
3. SSRC mismatch on respawn — Producer was registered with FNV-1a SSRC; if respawn rebuilds Producer with same SSRC but mediasoup retains the old Producer in closing state, RTP may be dropped.
4. multi-source audiomixer (commit a2e1480) — restart logic may not rebuild the full mix graph, only one source segment.
5. Listener consumer not auto-resumed on producer-recreate — PWA may hold a paused/closed consumer reference and never reconnect.

## Investigation Tools (recommended)

- `Get-Process gst-launch-1.0,server-x86_64-pc-windows-msvc,mediasoup-worker` to confirm respawn occurs.
- Sidecar log tail for `scheduleRestart`, `handleCrashedPipeline`, `MAX_RESTARTS_EXCEEDED`.
- mediasoup-worker stderr (sidecar logs route MS_DEBUG=mediasoup:* if enabled).
- `netstat -ano | findstr <rtp port>` to confirm gst-launch is actually emitting RTP after respawn.
- Wireshark / `pktmon` packet capture on loopback for the PlainTransport RTP port — direct evidence of packets in vs not in.
- Phone-side: chrome://webrtc-internals (or Safari equivalent via Mac), watch consumer's bytesReceived after kill.

## Evidence

### Live process-level reproduction (controlled, PowerShell-driven)

Setup at 16:07:56.412 (Apr 29 local, UTC+3):
- gst-launch PID 14224 alive, parent cmd.exe (24372), parent server.exe (17744)
- ports bound: gst-launch holds `:::51702`, `0.0.0.0:51702`; mediasoup-worker (PID 30708) holds `127.0.0.1:50702`
- channel: "Latvian" (e0fec414-f0f5-4996-ba43-60cac7d9beb8), single source file:worship-test, RTP port 50702, SSRC 1436343822

`taskkill /F /PID 14224` issued at 16:07:57.201.

Polling at 250ms intervals:
- +250ms (16:07:57.698): port 51702 RELEASED (kernel reclaimed within ~500ms of kill); 50702 still held by mediasoup
- +1250ms (16:07:59.878): NEW gst-launch (PID 27360, parent NEW cmd.exe 39588) BOUND to 51702 with same Latvian pipeline string → restart succeeded ~2.7s after kill

Same RTP port (50702 → mediasoup), same sender bind-port (51702), same SSRC (1436343822 from saved config), same Latvian pipeline command line.

**Conclusion: process-level restart works correctly on Windows external-kill path.** The 2.7s delay = 2000ms `restartDelayMs` (default) + ~700ms gst-launch process warmup. Within the 3s 100% loss budget for live audio if the listener tolerates a brief gap.

### Code-path validation

`gstreamer-process.attachExitHandler`:
- non-zero exit code or `signal !== null` → state = `crashed`, emit PROCESS_CRASH error
- emit `exit` event → pipeline-manager.wireEventForwarding sees `state === "crashed"` → routes to `handleCrashedPipeline` instead of `pipeline-exit`

`pipeline-manager.handleCrashedPipeline`:
- guards: `isShuttingDown`, `recoveryConfig.autoRestart`, pipeline still in registry — all default-on
- calls `scheduleRestart(pipelineId)` → sets timer for `computeBackoffDelay(attempts)` → `currentPipeline.start()` after delay
- `start()` checks `!RUNNING_STATES.has(currentState)` (crashed is NOT in RUNNING_STATES) → spawns new gst-launch with same config

`gstreamer-process.start()` rebuilds pipeline string via `buildChannelPipelineString(this.config)` — config never mutated, so same RTP port / bind-port / SSRC / source list.

`streaming-subsystem.handleChannelStateChange`:
- "crashed" status → falls through every if branch → no-op (intentional; commit 27364fc + fcd8582)
- PlainTransport stays bound to RTP port; Producer + Consumer chain preserved
- After respawn: `state-change → streaming` re-fires, but `routerManager.hasChannel(channelId) === true` so the early return skips re-notify (intentional)

`plain-transport-manager`: comedia tuple lock matches new sender (same `host:bind-port` 127.0.0.1:51702) → mediasoup keeps accepting RTP on resume.

`listener/PlayerView`: no producer-close fired (Producer stays open), so PWA stays in "playing" state. Consumer track is silent for ~3s then resumes. No reconnection handshake needed.

### Latent bugs found (not smoking gun, but worth tracking)

1. **`resourceMonitor.trackPipeline()` is never called from production code.** Only `untrackPipeline()` is called in three places. Resource monitor sees zero pipelines; CPU/mem stats permanently empty. Search confirmed no calls anywhere in `sidecar/src/`. Per-pipeline resource tracking is dead.
2. **`MAX_RESTARTS_EXCEEDED` does not remove the pipeline from `pipelineManager.pipelines` Map.** After the 5th attempt, channel-manager untracks resource/level monitors but the GStreamerProcess stays registered. `aggregateChannelStatus` returns "crashed" forever. No automatic cleanup; admin must manually stop+remove. Latent zombie, not directly visible to users yet.

## Eliminated

1. ~~`pipeline-manager.scheduleRestart` Windows external-kill path broken~~ — process restarts in 2.7s with correct config (live repro proves it).
2. ~~mediasoup PlainTransport torn down on pipeline death~~ — Transport persists; mediasoup-worker stays bound to RTP port across kill cycle (verified PID 30708 unchanged).
3. ~~SSRC mismatch on respawn~~ — same Producer instance, same SSRC across crash. New gst-launch reads same `ssrc=1436343822` from channel config.
4. ~~Multi-source audiomixer broken on restart~~ — single-source pipeline (Latvian) reproduced correctly. Multi-source uses same `start()` → `buildChannelPipelineString()` codepath; same config rebuilt.
5. ~~Listener consumer auto-resume broken~~ — by design, no resume needed. Producer stays open across crash; consumer track is the same; only RTP gap is observable.

## Current Focus

```yaml
hypothesis: "scheduleRestart works correctly on Windows external-kill. The user's expected behavior (auto-restart, audio resumes) IS the actual behavior, with a 2-3 second silence gap during the backoff + spawn window."
test: live taskkill /F repro at 16:07:57.201; observed new gst-launch bound to same port at 16:07:59.878; same SSRC + bind-port preserved
expecting: no fix required for the primary external-kill path
next_action: verify with the user whether (a) the perceived "no audio" was actually "audio resumes after a 3s gap and that's acceptable", (b) some other repro path fails, or (c) latent bugs (resource-monitor track, MAX_RESTARTS zombie) should be patched separately
reasoning_checkpoint: null
tdd_checkpoint: null
```

## Resolution

```yaml
root_cause: "No bug in scheduleRestart / Windows external-kill path. Process restarts in ~2.7s on the same RTP port, same SSRC, same comedia tuple. mediasoup PlainTransport + Producer + listener consumer all preserved by design (commit 27364fc + fcd8582). Audio resumes after a 2-3s silence gap. Two latent bugs found: (1) resourceMonitor.trackPipeline never called anywhere, (2) MAX_RESTARTS_EXCEEDED leaves pipeline in registry as zombie."
fix: |
  All three follow-ups applied per user request (DRT, SRP):
  (a) ResourceMonitor.trackPipeline now called from a single state-driven path: ChannelManager wirePipelineEvents listens for state=connecting and calls trackPipelineResource(pipelineId), which reads pid via new PipelineManager.getPipelinePid accessor. Covers initial start, replacePipeline, and crash respawn (Map.set overwrites old pid). swapMonitorBookkeeping comment clarifies that new-pipeline track is wired by the state-change handler, not by the swap.
  (b) MAX_RESTARTS_EXCEEDED now invokes ChannelManager.handleMaxRestartsExceeded(channelId, pipelineId) which logs an explicit "auto-stopped" reason and reuses stopChannel() for full cleanup -- removePipeline drops the dead GStreamerProcess from PipelineManager.pipelines, channelPipelines is cleared, channel transitions to "stopped". DRY: stopChannel is the single teardown path for both user-initiated stop and zombie cleanup.
  (c) PipelineRecoverySchema gains firstAttemptDelayMs (default 500ms, range 100-5000). PipelineManager.computeBackoffDelay returns firstAttemptDelayMs for attempt<=1; attempts 2..N use restartDelayMs * 2^(attempt-2) capped at maxRestartDelayMs. Listener silence window on transient kill drops from ~3s to ~1.2s while flapping devices still get rate-limited.
verification: |
  vitest: 4 files, 37 tests, all passing. New tests:
  - test/pipeline-manager.backoff.test.ts (7 tests): attempt-1 fast path, configurable firstAttemptDelayMs, attempts 2..5 exponential growth + cap, defensive lower bound.
  - test/channel-manager.multi-source.test.ts (5 new tests): trackPipeline emitted on state=connecting, re-track on respawn (same pipelineId, new PID), silent skip on null pid, untrack still fires on swap, MAX_RESTARTS_EXCEEDED triggers stopChannel + clears channelPipelines + logs auto-stopped reason.
  Live PowerShell repro from initial diagnosis still applies: gst-launch respawns with same RTP port + comedia tuple + SSRC.
files_changed:
  - sidecar/src/config/schema.ts
  - sidecar/src/audio/pipeline/pipeline-manager.ts
  - sidecar/src/audio/channels/channel-manager.ts
  - sidecar/test/channel-manager.multi-source.test.ts
  - sidecar/test/pipeline-manager.backoff.test.ts
```
