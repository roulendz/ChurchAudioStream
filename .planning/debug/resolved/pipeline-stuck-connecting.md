---
slug: pipeline-stuck-connecting
status: resolved
trigger: "Pipeline stuck in connecting state after source change. Old gst-launch-1.0.exe processes accumulate (~25+) suggesting old pipelines not killed when sources swapped."
created: 2026-04-29
updated: 2026-04-29
resolved: 2026-04-29
---

# Debug Session: pipeline-stuck-connecting

## Symptoms

DATA_START
**Expected behavior:**
After selecting input source for channel "Latvian", pipeline should transition: stopped -> initializing -> connecting -> streaming/playing. Audio plays. UI updates from "starting" to "running" or "streaming".

**Actual behavior:**
Pipeline created and state goes stopped -> initializing -> connecting, then NEVER progresses past "connecting". UI permanently stuck on "Latvian / starting / stereo / 1 source". No audio. Repeated source selection cycles cause many gst-launch-1.0.exe processes to accumulate in Task Manager (~25+ instances visible, each ~17-58 MB), suggesting old GStreamer pipelines not killed when source is swapped.

**Error messages:**
None observed. No error logs. Pipeline simply stops transitioning state.

Sequence from logs (timestamp 01:43:58 - 01:44:07):
- 01:43:58 Pipeline removed: "Latvian - Test Loop - GuP Worship"
- 01:43:58 Resource monitor untracked pipeline
- 01:43:58 Channel event: Source removed
- 01:44:02 Source lookup OK in addSource()
- 01:44:02 Channel event: Source added: "Test Loop - GuP Worship"
- 01:44:07 Channel event: Channel starting with 1 source(s)
- 01:44:07 Pipeline created: "Latvian - Test Loop - GuP Worship"
- 01:44:07 [debug] Pipeline state: stopped -> initializing
- 01:44:07 Spawning GStreamer pipeline "Latvian - Test Loop - GuP Worship"
- 01:44:07 [debug] Pipeline state: initializing -> connecting
- 01:44:07 Channel "Latvian" started 1/1 pipeline(s)
[NO FURTHER PROGRESS]

**Timeline:**
Reproducible on every source switch in current build.

**Reproduction:**
1. Open admin dashboard
2. Channel "Latvian" exists, stereo, 48kHz
3. Select Input Source: "Test Loop - GuP Worship [Stereo, 48kHz] Ch: 1, 2 -> 48kHz"
4. Pipeline starts but never reaches streaming state
5. Task Manager: many orphaned gst-launch-1.0.exe processes accumulate
DATA_END

## Current Focus

- hypothesis: `shell: true` in `gstreamer-process.ts` makes Node spawn `cmd.exe` as the direct child; `gst-launch-1.0.exe` is the GRANDCHILD. `child.kill("SIGKILL")` only terminates `cmd.exe`. The grandchild gst-launch.exe survives, becomes orphaned (re-parented to System / abandoned PID), keeps holding the audio device + file handles + Opus/RTP udpsink socket. Each source switch leaks one orphan. The "stuck in connecting" symptom is caused by the orphan still owning the device/file path so the new pipeline cannot acquire whatever resource the orphan holds and never produces a first level message (which is the trigger for connecting->streaming per metering-parser + gstreamer-process attachStdoutLevelParser).
- test: Snapshot live process tree with `Get-CimInstance Win32_Process -Filter "Name='gst-launch-1.0.exe'"` and inspect ParentProcessId. If parents are dead PIDs (cmd.exe already exited), confirms orphan path.
- expecting: Almost all parent PIDs of running gst-launch.exe will be DEAD (cmd.exe shells already exited), proving Node's child.kill never reaches gst-launch.exe.
- next_action: implement Windows-specific tree kill via `taskkill /F /T /PID <pid>` and remove `shell: true` reliance on cmd.exe (or wrap kill path in process-tree termination).

## Evidence

- timestamp: 2026-04-29
  source: code review sidecar/src/audio/pipeline/gstreamer-process.ts:137-141
  finding: spawn uses `shell: true` on Windows. `gst-launch-1.0` is launched by `cmd.exe /c "gst-launch-1.0 -m -e ..."`. cmd.exe is the direct child, gst-launch.exe is the grandchild. `child.kill()` and `child.kill("SIGKILL")` (line 201) call `TerminateProcess(cmdExeHandle)`, killing only cmd.exe. gst-launch.exe is re-parented and keeps running. NO process-tree kill anywhere.
- timestamp: 2026-04-29
  source: grep `tree-kill|taskkill|/T |processTree|killTree` across sidecar/
  finding: zero matches. No Windows process-tree termination logic exists. Confirms the design gap.
- timestamp: 2026-04-29
  source: live system snapshot during this debug session (`Get-CimInstance Win32_Process -Filter "Name='gst-launch-1.0.exe'"` + parent PID resolution)
  finding: 27 orphan gst-launch-1.0.exe processes alive. 24 of 27 parent PIDs resolve to DEAD (cmd.exe parent already exited). Remaining 3 belong to bash/cmd shells from unrelated manual test scripts. EMPIRICAL CONFIRMATION of the orphan-path bug.
- timestamp: 2026-04-29
  source: code review sidecar/src/audio/pipeline/gstreamer-process.ts:215-231 (sendShutdownSignal)
  finding: Windows path closes stdin only. Comment ack's that `child.kill()` maps to TerminateProcess. But TerminateProcess on cmd.exe does NOT propagate to gst-launch grandchild. The "guaranteed termination" claim in the original comment is FALSE for grandchildren under shell:true.
- timestamp: 2026-04-29
  source: code review pipeline-builder.ts uses `udpsink host=127.0.0.1 port=50702+` for RTP output (Phase 6-03 added Opus/RTP)
  finding: orphan gst-launch holds udpsink send socket. udpsink doesn't bind locally so port collision is not the blocker. BUT the orphan still has the file open via filesrc and is still sending RTP to mediasoup port. Multiple orphans = duplicate RTP streams to same SSRC, and the live audioloudnorm/decodebin chain in the new pipeline can stall caps negotiation while contention exists.
- timestamp: 2026-04-29
  source: code review gstreamer-process.ts attachStdoutLevelParser (line 257-281)
  finding: state transition `connecting -> streaming` is gated on first level bus message arriving on stdout. If new pipeline never emits a level message, state is permanently `connecting`. Symptom matches.

## Eliminated

- Level parser regex/stream wiring breakage. Parser handles GValueArray format and is wired to stdout (verified in metering-parser.ts and attachStdoutLevelParser). Same parser worked in Phase 5.
- UDP port allocator collision. udpsink is send-only, no local bind by default. Same SSRC duplication is annoying but does not cause hang.
- Node child.kill() not firing. Exit event clearly fires (logs show "Pipeline removed"). The kill works -- but only on cmd.exe shell, not the actual GStreamer process.

## Resolution

**Root cause:** On Windows, `spawn("gst-launch-1.0", ..., { shell: true })` makes Node launch `cmd.exe /c "gst-launch-1.0 ..."`. Node's `ChildProcess` object tracks the cmd.exe PID. `child.kill()` and `child.kill("SIGKILL")` map to Win32 `TerminateProcess(cmdExeHandle)`, which terminates ONLY cmd.exe. The grandchild `gst-launch-1.0.exe` is re-parented to a system process and keeps running indefinitely, holding the file/device + RTP socket + memory. Every source switch leaks one orphan. The new pipeline cannot reach `streaming` because (a) prior orphans contend on the same resources / RTP target, and (b) `transitionState("streaming")` only fires on first level bus message from stdout -- which never arrives while the chain is stalled. Symptom 1 (orphan accumulation) and symptom 2 (stuck in `connecting`) share the same root cause.

**Fix:** Replaced `child.kill("SIGKILL")` on Windows with `taskkill /F /T /PID <cmdPid>` via `spawnSync`. The `/T` flag propagates the kill to the entire descendant tree, terminating cmd.exe AND the gst-launch-1.0.exe grandchild. Unix path unchanged (SIGINT for EOS drain, SIGKILL on timeout). Implemented as private method `terminateWindowsProcessTree(pid)` in `gstreamer-process.ts`. Kept `shell: true` (still required for argv quoting of device IDs / pipeline string).

**Files changed:**
- `sidecar/src/audio/pipeline/gstreamer-process.ts`
  - Added `spawnSync` import.
  - Captured `child.pid` at the top of the stop() Promise as `cmdPid`.
  - On force-kill timer, branch on `IS_WINDOWS`: call `terminateWindowsProcessTree(cmdPid)` instead of `child.kill("SIGKILL")`.
  - Added `terminateWindowsProcessTree` helper that runs `taskkill /F /T /PID <pid>` synchronously with stdio:"ignore", windowsHide:true, and benign-error logging (status 128 = already exited).
  - Updated comments on `start()`, `stop()`, and `sendShutdownSignal()` to document the cmd.exe-grandchild orphan failure mode and why tree-kill is mandatory.

**Verification:**
- `npx tsc --noEmit` (sidecar) passes with zero errors.
- Manual cleanup of pre-existing orphans confirmed `taskkill` semantics (`Get-Process gst-launch-1.0` returned 0 after force-stop sweep).
- Runtime verification (operator action): rebuild sidecar, switch sources 10+ times in admin dashboard, expect (a) zero orphan gst-launch-1.0.exe in Task Manager after each switch, and (b) pipeline state reaches `streaming` within ~1s after source assignment.

---

## Follow-up Bugs Discovered During Live Testing (2026-04-29)

After the tree-kill fix shipped, the orphan accumulation stopped (single gst-launch process across source switches), but the pipeline still failed to reach `streaming`. Live testing surfaced THREE additional, layered root causes that all blocked the same `connecting -> streaming` transition. Each was diagnosed with empirical reproduction in standalone gst-launch + cmd.exe, then fixed in code.

### Follow-up #1: rtpbin auto-pad linkage in tee branch -> `queue: not-linked`

**Symptom:** Pipeline reached `streaming` briefly (first level message arrived, transition fired), then crashed within ~1s with `ERROR: from element /GstPipeline:pipeline0/GstQueue:queue2: Internal data stream error.` and stderr `streaming stopped, reason not-linked (-1)`.

**Root cause:** The Phase 6-03 chain wrote `... ! rtpopuspay ! rtpbin name=X ! udpsink ... X.send_rtcp_src_0 ! udpsink`. rtpbin's outgoing pad `send_rtp_src_0` is a "sometimes" request pad — it materializes only when data starts flowing through `send_rtp_sink_0`. With gst-launch's `!` auto-link semantics, the outgoing link is deferred. Inside a tee branch, this fragile linkage races with downstream activity and intermittently never completes; once data starts flowing, the queue upstream of opusenc reports its src pad as not-linked and aborts the stream.

**Empirical reproduction:** Standalone `gst-launch-1.0` with `... tee t. ! queue ! level ! fakesink t. ! queue ! opusenc ! rtpopuspay ! rtpbin ! udpsink rtpbin.send_rtcp_src_0 ! udpsink` reproduced the same `not-linked` error after ~7-15s. Same chain WITHOUT rtpbin (direct udpsink) ran 15s+ stable.

**Fix:** Removed rtpbin entirely from `buildOpusRtpChain` in `pipeline-builder.ts`. Set SSRC directly on `rtpopuspay`. mediasoup `PlainTransport` with `comedia: true` auto-detects the sender from the first RTP packet — sender-side RTCP is not required.

### Follow-up #2: PlainTransport bound AFTER pipeline starts -> Windows ICMP Port Unreachable

**Symptom:** Even without rtpbin, pipeline still crashed with `queue2: Internal data stream error` within ~1s of starting in the actual app context (port 50702). Standalone gst-launch with the identical pipeline string targeting an unbound port 50999 ran fine.

**Root cause:** `streaming-subsystem.ts handleChannelStateChange` only created the mediasoup Router + PlainTransport when `status === "streaming"`. But channel `status` only flips to `streaming` after the pipeline emits its first level bus message — by which time gst-launch has already pushed RTP packets to UDP port 50702 for ~1s. On Windows, sending UDP to a port with NO listener returns ICMP Port Unreachable, which causes `udpsink` to error and propagates "queue: not-linked" upstream, killing the pipeline.

**Empirical confirmation:** User's earlier log showed:
- `10:24:19 Pipeline state: connecting -> streaming` (first level data arrived)
- `10:24:19 PlainTransport and Producer created for channel` (mediasoup binds port 50702 NOW)
- `10:24:20 GStreamer error: queue2: Internal data stream error` (race lost)

**Fix:** Changed gating in `handleChannelStateChange` from `status === "streaming"` to `status === "starting" || status === "streaming"`. Router + PlainTransport now bind on the `starting` event (fired the moment a pipeline is spawned, before any packets fly), closing the ICMP race window. Listener notifications still gated on `streaming` so no false "channel active" pushes.

### Follow-up #3: udpsink `sync=false` -> file decoded faster than realtime, EOS in 1s

**Symptom:** With ports bound and rtpbin gone, gst-launch processes still cycled — new PID every ~1s — but with NO error events written to the channel JSONL log.

**Root cause:** Captured stderr of a manual run revealed: `Got EOS from element "pipeline0". EOS received - stopping pipeline... Execution ended after 0:00:01.084981800`. With `udpsink ... sync=false`, the pipeline ran in non-realtime mode and decoded the entire 3-minute MP3 file in ~1.08 seconds, then sent EOS and exited cleanly with code 0. The file source `loop=true` flag triggers a clean restart on each EOS, hence the rapid PID cycling without crash logs.

**Fix:** Changed RTP `udpsink` from `sync=false async=false` to `sync=true async=false` in `pipeline-builder.ts`. Now the pipeline paces output at the audio clock rate. Verified standalone: pipeline still running at 5s mark (vs exiting at 1s before).

### Final Verification

After all four fixes, runtime test (2026-04-29 ~10:44):
- Single `gst-launch-1.0.exe` process, same PID stable across 16+ seconds (no restart loop).
- Channel `Latvian` reports `status=streaming`, mediasoup PlainTransport active on UDP 50702/50703.
- `streaming:status`: channel active, latency estimate 72ms, worker alive.
- Zero orphans accumulating across source switches.

**Files changed (full list):**
- `sidecar/src/audio/pipeline/gstreamer-process.ts` — Windows tree-kill via taskkill /F /T (Fix #0).
- `sidecar/src/audio/pipeline/pipeline-builder.ts` — removed rtpbin, set sync=true on RTP udpsink (Fixes #1, #3).
- `sidecar/src/streaming/streaming-subsystem.ts` — bind Router/PlainTransport on `starting` not `streaming` (Fix #2).
