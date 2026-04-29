---
slug: pwa-stale-after-source-readd
status: resolved
trigger: "Admin UI I remove sources - silence in Listener PWA, in Admin UI i add back new source - in Listener PWA no audio comes through, even though Admin UI says STREAMING, then in PWA i need to click < and again click on latvian to hear new Input."
created: 2026-04-29
updated: 2026-04-29
---

# Debug session: PWA listener silent after source remove + re-add

## Symptoms

- **Expected:** After admin removes all sources from a channel and then re-adds a source, the listener PWA on the phone should auto-resume audio with no manual action.
- **Actual:** Admin UI status shows `STREAMING` after re-add, but the PWA stays silent. UI on PWA appears unchanged (still on PlayerView for the channel). Audio is gone.
- **Workaround:** In the PWA tap `<` (back to ChannelListView), then re-tap the channel ("Latvian") — audio resumes immediately.
- **Trigger steps:**
  1. Channel "Latvian" is streaming, phone connected, audio playing.
  2. Admin UI: remove all source(s) from the channel.
     - Channel goes to `stopped` status (sources.length === 0 → `channel-manager.stopChannel`).
  3. Phone: audio goes silent.
  4. Admin UI: re-add a source to the same channel.
     - Channel transitions: stopped → starting → streaming.
  5. Admin UI: shows STREAMING. Pipeline running, gst-launch alive.
  6. Phone: still silent. UI unchanged. No re-subscribe.
  7. Phone: tap `<` to go back, then tap "Latvian" again — audio plays.
- **First seen:** Today (2026-04-29) after committing 8-commit batch including `27364fc fix(streaming): preserve listeners across pipeline restarts` and `5b6edfc feat(audio): file-loop test audio sources`.

## Suspected code paths (orchestrator hypothesis — confirmed)

The "preserve listeners across pipeline restarts" change in `sidecar/src/streaming/streaming-subsystem.ts` `handleChannelStateChange()` short-circuits the second pass through `starting`/`streaming` because the Router still exists from the first lifecycle. Result:

- `notifyAllListeners("channelStateChanged", { state: "active" })` is NEVER re-fired.
- `pushActiveChannelList` is NEVER re-pushed.
- The Producer / PlainTransport / consumer chain set up before the stop is reused — but its server-side handle is now bound to a Producer whose RTP pipeline (gst-launch) was killed, restarted, and reconnected via comedia tuple lock. In the user-initiated "stopped" cycle, the PlainTransport itself was supposed to be torn down (consumer closed) — instead it lingers, the listener's old consumer keeps pulling from a Producer that never received fresh comedia binding, and audio stays silent.

## Reproduction steps

```
1. App live (verified): Vite 1420, sidecar 7777/7778, mediasoup-worker alive, FRESH binary.
2. Phone connected to https://192.168.1.79:7777/, on PlayerView for "Latvian", audio playing.
3. Open Admin UI -> Channels -> "Latvian" -> Sources panel.
4. Click trash on the only source (file:worship-test). Channel sources empty.
5. Phone: confirm audio went silent.
6. Click "Add Source" with file:worship-test or any other source. Save.
7. Phone: observe audio does NOT resume. PWA still shows the channel as playing.
8. Phone: tap "<" then tap "Latvian" again. Audio resumes.
```

## Evidence

- timestamp: 2026-04-29 15:00 — `sidecar/src/streaming/streaming-subsystem.ts handleChannelStateChange` (commit 27364fc) lines 575-619 confirm both the early-return on `routerManager.hasChannel(channelId)` and the explicit "do nothing on stopped/error/crashed" comment. Second pass through `starting`/`streaming` cannot reach the `notifyAllListeners` / `pushActiveChannelList` block.
- timestamp: 2026-04-29 15:00 — `sidecar/src/audio/channels/channel-manager.ts:322-346` `removeSource()`: when `channel.sources.length === 0` it calls `this.stopChannel(channelId)` which calls `pipelineManager.removePipeline(pipelineId)` and `setChannelStatus(channelId, "stopped")`. So a "stopped" status is emitted on the user-initiated path.
- timestamp: 2026-04-29 15:00 — `sidecar/src/audio/channels/channel-manager.ts:599-608` `applyPipelineForChannelChange()` on the next `addSource()`: `channel.status === "stopped"` + `autoStart` + `sources.length > 0` → `startChannel()` → `setChannelStatus(channelId, "starting")` then "streaming" once the pipeline reaches the streaming state.
- timestamp: 2026-04-29 15:00 — `sidecar/src/audio/channels/channel-manager.ts:747-754` `setChannelStatus()` only emits `channel-state-changed` when the status value actually changes. So on a normal stop/start cycle the streaming subsystem sees three events: `stopped`, `starting`, `streaming`.
- timestamp: 2026-04-29 15:00 — `sidecar/src/streaming/router-manager.ts:256-258` `hasChannel()` returns true as long as the entry stays in the map. With commit 27364fc, that entry is only removed by `removeChannelRouter()` which is now only called from `handleChannelRemoved` (channel deletion), never from a "stopped" status transition. So the second `starting` and `streaming` events both trip the early-return.
- timestamp: 2026-04-29 15:00 — `listener/src/views/PlayerView.tsx:188-212` (pre-fix) only handles `consumerClosed` and `listenerCounts` notifications. There is no `channelStateChanged` handler. Even if the server were to re-emit the notification, the PWA would ignore it. Combined with the silent server short-circuit, the listener has no path to recover except a fresh mount of `PlayerView` (the back+retap workaround).
- timestamp: 2026-04-29 15:00 — `sidecar/src/streaming/signaling-handler.ts:378-409` `disconnectListenersFromChannel()` already does the right server-side teardown (close consumer, close transport, send `channelStopped` with remaining channels). It is not called on a user-initiated stop because the new `handleChannelStateChange` no-ops on "stopped".
- timestamp: 2026-04-29 15:00 — `src-tauri/logs/channels/e0fec414-f0f5-4996-ba43-60cac7d9beb8.jsonl` lines 196-200 capture the exact reproduction sequence: `start (2 sources) → source removed → stop "Channel stopped" → start (1 source) → source added`. The "stop" event is the one that should drive listener disconnect.
- timestamp: 2026-04-29 15:00 — `sidecar/src/audio/pipeline/gstreamer-process.ts:200-209` documents the comedia tuple lock and the 400ms `WINDOWS_SOCKET_RELEASE_DELAY_MS` after process exit. Combined with `sidecar/src/audio/pipeline/pipeline-builder.ts:106-119` where `bind-port = rtpPort + 1000` is deterministic, the new gst-launch *would* re-bind the same source tuple on a fast restart — but that path only matters for the crash/auto-restart case, not for the user-initiated stop where the PlainTransport itself needs to be torn down.

## Eliminated

- **mediasoup Producer score / pause semantics:** No Producer score handlers anywhere in the streaming subsystem; consumers are never auto-paused due to producer score changes. Not the cause.
- **SSRC / port mismatch across restarts:** `port-allocator.ts:51` `generateSsrc(channelId)` is a deterministic FNV-1a hash; the new `udpsink bind-port = rtpPort + 1000` in `pipeline-builder.ts` pins the sender source port. Both stay constant across restarts — comedia tuple lock would still match if the PlainTransport were preserved correctly, but the user-initiated stop is the wrong place to preserve it.
- **Browser MediaStreamTrack auto-mute on RTP gap:** Even if the browser handled an RTP gap gracefully, the PWA would still need a notification to re-render its state. The root cause is the missing server-side notification + missing listener-side handler, not browser behaviour.

## Resolution

### Root cause

Commit `27364fc fix(streaming): preserve listeners across pipeline restarts` made `handleChannelStateChange` short-circuit on the second `starting`/`streaming` cycle (because `routerManager.hasChannel(channelId)` is true), and made it a no-op on `stopped`/`error`/`crashed`. That is correct for transient pipeline crashes (gst-launch crashes and auto-restarts on the same RTP port within seconds — preserving the listener consumer is exactly right). It is wrong for *user-initiated* stops: when admin removes all sources or otherwise drives the channel back to `stopped`, the gst-launch is killed, the PlainTransport's comedia binding is to a now-dead source, and the listener's consumer is left bound to a Producer that will never receive fresh RTP until both sides start a new lifecycle. The listener has no signaling path to discover this and never re-consumes.

### Fix

Two coordinated changes:

1. **Server (`sidecar/src/streaming/streaming-subsystem.ts`)** — split the previously-merged `stopped`/`error`/`crashed` branch:
   - On `stopped`: actively tear down by calling `disconnectListenersFromChannel` (closes consumers + transports, sends `channelStopped` to listeners), then `removeChannelRouter` and `pushActiveChannelList`. This is parallel to `handleChannelRemoved` but for user-initiated stops where the channel itself still exists. The next `starting`/`streaming` cycle naturally falls through `routerManager.hasChannel(channelId) === false` and creates a fresh Router + Producer, then re-emits `channelStateChanged: active` and `pushActiveChannelList` like the first lifecycle.
   - On `error`/`crashed`: keep the no-op preserve-listeners behaviour from commit 27364fc. Pipeline-manager auto-restarts on the same RTP port; comedia tuple stays valid; existing consumers keep flowing.

2. **Listener (`listener/src/views/PlayerView.tsx`)** — handle the auto-resume flow:
   - On `channelStopped` notification matching `channel.id`: clear timers, drop cached track, `disconnectMediasoup()`, set state to `reconnecting`.
   - On `activeChannels` / `listenerCounts` notification while `playerState === "reconnecting"`: if our channel re-appears with `hasActiveProducer === true`, run `connectToChannel` again and `startPlayback` on the new track. The AudioContext was already unlocked by the user's original "Start Listening" gesture so playback resumes without further interaction.
   - Bonus fix (drive-by): the existing `listenerCounts` handler read `notification.data` as `Record<string, number>` which never matched the actual `{ channels: [...] }` payload shape. The new handler reads the listener count from the matching channel entry, so the count actually updates.

### Verification

- `cd sidecar && npx tsc --noEmit` → exit 0.
- `cd listener && npx tsc --noEmit` → exit 0.
- `cd listener && npm run build` → success, PWA emitted to `sidecar/public/`.
- `cd sidecar && npm run build` (with cargo on PATH) → 91.4 MB binary at `src-tauri/binaries/server-x86_64-pc-windows-msvc.exe`, mediasoup-worker.exe copied alongside.
- Full restart sequence per CLAUDE.md: kill all processes, wipe cached `target/debug/binaries/*`, relaunch `npm run tauri dev`.
- Freshness gate: process `server.exe` PID 17744 StartTime 2026-04-29 15:22:38, binary LastWriteTime 2026-04-29 15:21:56 → **FRESH**.
- Ports 1420 / 7777 / 7778 listening; mediasoup-worker, gst-launch-1.0, churchaudiostream all alive.
- Manual UAT against the running app — pending user confirmation: remove last source from "Latvian" while phone is on PlayerView, observe PWA flips to "Reconnecting…", re-add source, observe PWA auto-resumes audio without back+retap.

### Files touched

- `sidecar/src/streaming/streaming-subsystem.ts` — split `handleChannelStateChange` branches.
- `listener/src/views/PlayerView.tsx` — add `channelStopped` + auto-resume handlers; fix listener-count payload shape.
