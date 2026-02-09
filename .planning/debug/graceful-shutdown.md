---
status: resolved
trigger: "Graceful shutdown needs 3x Ctrl+C"
created: 2026-02-09T00:00:00Z
updated: 2026-02-09T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED -- see Resolution
test: N/A
expecting: N/A
next_action: Apply fix

## Symptoms

expected: Single Ctrl+C triggers clean shutdown: streaming -> audio -> servers -> exit
actual: First Ctrl+C initiates shutdown but pipeline crashes mid-shutdown trigger restart scheduler, spawning new GStreamer processes; requires 2-3 Ctrl+C to fully exit
errors: Pipeline crash events during shutdown, restart scheduler fires during teardown
reproduction: Start sidecar with at least one active channel streaming, press Ctrl+C once
started: Inherent design gap -- never had a "shutting down" guard

## Eliminated

- hypothesis: PipelineManager.stopAll() fails to clear timers
  evidence: stopAll() calls clearAllRestartTimers() at line 144 -- timer clearing logic is correct
  timestamp: 2026-02-09

- hypothesis: channelManager.stopAll() doesn't properly stop pipelines
  evidence: stopAll() calls stopChannel() per channel which calls removePipeline() which clears timers AND removes listeners -- correct
  timestamp: 2026-02-09

## Evidence

- timestamp: 2026-02-09
  checked: Shutdown order in index.ts setupGracefulShutdown (line 39-55)
  found: Order is `await streamingSubsystem.stop()` THEN `await audioSubsystem.stop()`
  implication: Streaming shuts down first while GStreamer pipelines are still running and sending RTP

- timestamp: 2026-02-09
  checked: StreamingSubsystem.stop() sequence (line 197-250)
  found: Step 5 closes RouterManager (line 235-238) which calls closeAll() -> router.close() for each channel. This cascades to PlainTransport closure (UDP ports that GStreamer sends RTP to are closed)
  implication: When PlainTransport closes, the UDP port GStreamer is sending to disappears. GStreamer pipeline does NOT crash from this alone (UDP is fire-and-forget), but the streaming-subsystem's event wiring is the real problem.

- timestamp: 2026-02-09
  checked: StreamingSubsystem.wireAudioSubsystemEvents() (line 470-503)
  found: StreamingSubsystem subscribes to audioSubsystem "channel-state-changed" events. When channel goes to "stopped"/"error"/"crashed", it calls disconnectListenersFromChannel() and removeChannelRouter(). These listeners are NEVER removed during stop().
  implication: Event listeners from streaming subsystem remain attached to audioSubsystem even after streaming subsystem has been torn down (nulled references). When audioSubsystem.stop() later changes channel states, those listeners fire on nulled objects.

- timestamp: 2026-02-09
  checked: StreamingSubsystem.stop() for listener cleanup
  found: stop() nulls out `this.routerManager`, `this.signalingHandler`, etc. BUT the event handlers wired in wireAudioSubsystemEvents() still reference `this.routerManager` and `this.signalingHandler` via closure on `this`. The null checks at lines 509 (`if (!this.routerManager || !this.signalingHandler) return;`) DO guard against null access, so no crash here -- they silently bail out.
  implication: The streaming-side event listeners are "safe" (null-guarded) but still fire unnecessarily. This is NOT the primary bug.

- timestamp: 2026-02-09
  checked: PRIMARY BUG PATH -- audioSubsystem.stop() calls channelManager.stopAll()
  found: channelManager.stopAll() (line 580-588) calls stopChannel() for each channel. stopChannel() (line 511-547) calls pipelineManager.removePipeline() for each pipeline. removePipeline() (line 101-114) calls pipeline.stop() which transitions state to "stopping". BUT CRITICALLY -- the actual channel shutdown path goes through stopChannel() -> pipelineManager.removePipeline() which calls pipeline.stop(). The GStreamerProcess.stop() sends shutdown signal and WAITS for exit. On exit, the exit handler (line 300-316) checks `this.stopRequested` -- if true, transitions to "stopped". This is correct for DIRECT stops.
  implication: The direct stop path is clean. The bug is in the RACE between streaming teardown and audio teardown.

- timestamp: 2026-02-09
  checked: THE ACTUAL RACE CONDITION -- Full shutdown sequence traced
  found: |
    1. SIGINT received -> setupGracefulShutdown fires
    2. `await streamingSubsystem.stop()` begins:
       - Notifies listeners, drains (5s default!), closes WS, closes WebRTC transports
       - Step 5: routerManager.closeAll() -> router.close() for each channel
       - router.close() triggers PlainTransport "routerclose" event
       - PlainTransport closes -> UDP listen ports freed
       - Step 6: workerManager.stop() -> workers close
       - Sets all internal refs to null
       - streamingSubsystem.stop() resolves
    3. `await audioSubsystem.stop()` begins:
       - channelManager.stopAll() -> stopChannel() per channel
       - stopChannel() -> pipelineManager.removePipeline() per pipeline
       - removePipeline() -> pipeline.stop() -> sends SIGINT/stdin close to GStreamer
       - GStreamer exits -> exit handler fires -> state = "stopped" (stopRequested=true)
       - This is the CLEAN path

    BUT HERE IS THE BUG: The `shutdownDrainMs` default is 5000ms (line 88).
    During those 5 seconds of drain, GStreamer pipelines are STILL RUNNING.
    GStreamer is sending RTP packets to localhost UDP port that just got freed.
    On its own, UDP send to a closed port does not crash GStreamer.

    HOWEVER -- the REAL trigger is:
    The streamingSubsystem.stop() at step 5 calls routerManager.closeAll().
    routerManager.closeAll() closes routers.
    When a router closes, PlainTransport closes, and the UDP port is freed.

    Now: If any GStreamer pipeline crashes for ANY reason during this window
    (could be unrelated error, could be resource cleanup), the crash triggers:

    a. GStreamerProcess exit handler -> state = "crashed" (stopRequested is false,
       because nobody called pipeline.stop() yet -- audioSubsystem.stop() hasn't started)
    b. Pipeline emits "exit" event with state "crashed"
    c. PipelineManager.wireEventForwarding() line 215-219: on "exit", if state === "crashed",
       calls handleCrashedPipeline()
    d. handleCrashedPipeline() -> scheduleRestart() with 2000ms delay
    e. 2s later, the restart timer fires and spawns a NEW GStreamer process
    f. This new process is now orphaned -- audioSubsystem.stop() already finished
    g. User must Ctrl+C again to kill it

    Even in the happy path where GStreamer doesn't crash independently:
    The issue is that between streamingSubsystem.stop() completing and
    audioSubsystem.stop() calling removePipeline(), GStreamer is still running
    in the ORIGINAL state (stopRequested = false). If it exits non-zero for any
    reason during this gap, restart fires.

    The 5-second drain in streamingSubsystem.stop() creates a 5-second window
    where pipelines have no "shutting down" guard and will restart on crash.
  implication: The core issue is there is no "shutting down" flag that prevents restart scheduling. The PipelineManager and GStreamerProcess have no awareness that the system is shutting down.

- timestamp: 2026-02-09
  checked: PipelineManager for any shutdown/stopping flag
  found: No such flag exists. The only guards against restart are: (1) autoRestart config, (2) maxRestartAttempts exceeded, (3) clearRestartTimer/clearAllRestartTimers called during removePipeline/stopAll/destroyAll
  implication: If a pipeline crashes BEFORE audioSubsystem.stop() calls pipelineManager methods, restart is scheduled with no guard to prevent it

- timestamp: 2026-02-09
  checked: StreamingSubsystem handleChannelStateChange for "crashed" status (line 538-554)
  found: When a channel goes to "crashed", streaming subsystem calls disconnectListenersFromChannel() and removeChannelRouter(). After streaming.stop() nulled routerManager, the null guard at line 509 prevents execution. But the channel-state-changed event from the crash ALSO propagates through audio subsystem, potentially causing cascading issues.
  implication: Confirms the streaming subsystem's null guards work, but the fundamental race remains in PipelineManager restart scheduling.

## Resolution

root_cause: |
  No "shutting down" flag exists in PipelineManager to prevent restart scheduling during graceful shutdown.

  The shutdown sequence is: streamingSubsystem.stop() (takes ~5s due to drain) -> audioSubsystem.stop().
  During the 5-second streaming drain period, GStreamer pipelines are still running with stopRequested=false
  and autoRestart=true. If any pipeline exits non-zero during this window (or any time before
  audioSubsystem.stop() calls removePipeline()), PipelineManager.handleCrashedPipeline() schedules a
  restart with 2000ms backoff. This spawns a new GStreamer process DURING or AFTER shutdown, requiring
  additional Ctrl+C presses to kill.

  Secondary issue: streamingSubsystem.stop() does not remove its event listeners from audioSubsystem.
  While null-guarded, these dangling listeners are wasteful and conceptually incorrect.

fix: (not applied -- diagnosis only)
verification: (not applied)
files_changed: []
