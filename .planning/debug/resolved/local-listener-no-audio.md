---
slug: local-listener-no-audio
status: resolved
trigger: "I need you to debug, why https://church.audio:7777, if on this current/local machine I visit https://church.audio:7777 and connect to any of channesl I do not hear sound, pleae debug and fix, on my mobile all works"
created: 2026-04-30
updated: 2026-04-30
round: 4
---

## Round 4 — RESOLVED

User confirmed audio plays on the same-host browser after the listener PWA fix. Two root causes were stacked behind the single symptom:

**Root cause 1 (network):** `transport-manager.ts` advertised exactly one ICE candidate (UDP / LAN IP), enableTcp:false. Same-host Chromium did not have a working UDP path back to the SFU and had no TCP fallback, so ICE never paired and bytesReceived stayed 0 forever.

**Round-1 fix:** rewrote buildListenInfos() to emit 4 listenInfos (UDP+LAN, UDP+127.0.0.1, TCP+LAN, TCP+127.0.0.1), enableTcp:true, preferUdp:true. Round-2 chrome://webrtc-internals confirmed ICE+DTLS reached connected over TCP/192.168.1.79 — fix worked. But UAT still reported no audio — different bug behind the same symptom.

**Root cause 2 (client):** `audio-engine.ts` routed the WebRTC consumer track through `MediaStreamSourceNode -> GainNode -> destination` only. Chromium desktop has a long-standing quirk (Chromium bug #121673) where a MediaStream sourced from an RTCPeerConnection delivers SILENT samples to the Web Audio graph unless the same MediaStream is also attached to an HTMLMediaElement that is in playing state. Mobile Chrome and iOS Safari decode the stream without that anchor; desktop Chromium does not. The codebase had explicitly opted out of HTMLAudioElement to dodge iOS Safari's read-only `.volume` property, which then exposed this Chromium silence behavior.

**Round-2 fix (final):** parallel hidden, MUTED `<audio>` element pinned to the same MediaStream inside playTrack(). The element keeps the WebRTC decoder pipeline active so MediaStreamSourceNode receives real samples; element.muted=true means no audio output flows from the element itself, and all audible output continues through the GainNode (iOS Safari volume control intact). UAT confirmed audio now plays on Chromium desktop on the same host as the sidecar.

**Sub-bug B1 (listenerCount=0) — NOT A BUG.** Both channels have `displayToggles.showListenerCount: false`. Counter logic itself works. Cosmetic; toggle on if visibility wanted.



## Round 2 — UAT Failed (post-loopback+TCP fix)

**User UAT report (2026-04-30, post-Round-1-fix):** Same-host browser still silent. `bytesReceived` still 0. Listener ICE+DTLS reach connected over **TCP/192.168.1.79:49310** (NOT loopback). All 5 protoo signaling steps return ok. listenerCount stays at 0 for both channels.

### Round 2 evidence (verbatim from chrome://webrtc-internals + DevTools)

<!-- DATA_START -->
ICE connection state: new => "checking" => "connected"
Connection state: new => "connecting" => "connected"
Signaling state: new => "have-remote-offer" => "stable"
ICE Candidate pair: 192.168.1.79:17887 <=> 192.168.1.79:49310

Stats:
- candidate-pair (state=succeeded, id=CP8ym8n4g1_PIZiLep/)
- candidate-pair (state=waiting, id=CPn7hRJSTJ_D4f47OTv)
- local-candidate (candidateType=prflx, tcpType=active, id=I8ym8n4g1)
- remote-candidate (candidateType=host, tcpType=passive, id=ID4f47OTv) — 192.168.1.79:49310
- remote-candidate (candidateType=host, tcpType=passive, id=IPIZiLep/)
- local-candidate (candidateType=host, tcpType=active, id=In7hRJSTJ)
- local-candidate (candidateType=host, tcpType=active, id=Ina01k2PZ)
- transport (iceState=connected, dtlsState=connected, id=T01)
- inbound-rtp (kind=audio, mid=0, ssrc=169472346, codec=opus 101, bytesReceived=0)
- remote-outbound-rtp (kind=audio, ssrc=169472346)

NO UDP local-candidates in browser. NO UDP candidate-pairs.
Server offered both UDP and TCP iceCandidates, browser only used TCP.
<!-- DATA_END -->

# Debug Session: local-listener-no-audio

## Symptoms

<!-- DATA_START -->
- expected: When admin opens https://church.audio:7777 in a real browser on the SAME Windows machine that runs the sidecar, the listener PWA loads, connects to a channel, and audio plays.
- actual: PWA loads, connects, ring pulses. bytesReceived=0 forever. Mobile clients work.
- repro: Open Chrome on same Windows host as sidecar -> https://church.audio:7777 -> tap channel -> ring pulses, no audio.
<!-- DATA_END -->

## Round 3 Investigation

### Sub-bug B1 (counter) — RESOLVED / NOT A BUG

- timestamp: 2026-04-30T13:00:00Z
  checked: src-tauri/config.json -> audio.channels[*].displayToggles.showListenerCount
  found: BOTH channels have `showListenerCount: false`. signaling-handler.ts buildEnrichedChannelList() at line 173 returns 0 unconditionally when toggle is off.
  conclusion: listenerCount=0 broadcast is intentional toggle suppression. Counter logic itself works (handleCreateWebRtcTransport sets currentChannelId, getListenerCount counts non-admin peers with matching channel). The 0 in the user's evidence is NOT proof of a counter or registration bug.

### Sub-bug A (no audio) — INVESTIGATION DEEP DIVE

#### Process state (snapshot at 13:00)

- timestamp: 2026-04-30T13:00:00Z
  checked: powershell process + port enumeration
  found:
    - sidecar `server` PID 53740, StartTime 11:43:29 (post-Round-1-fix build)
    - mediasoup-worker PID 8916, StartTime 11:43:31 (path `src-tauri\target\debug\binaries\mediasoup-worker.exe`)
    - 2 gst-launch processes feeding RTP to 127.0.0.1:50702 (Latvian) and 127.0.0.1:50704 (English)
    - mediasoup-worker UDP listening on 50702-50705 (PlainTransport ports) plus dynamic 47932 + 45964 in rtcRange
    - mediasoup-worker TCP listening on dynamic 47131 + 40797 in rtcRange (no live listener transports right now -- user's session ended)
  implication: server-side production chain is healthy. PlainTransport ports bound. GStreamer feeding RTP. Mediasoup-worker is the binary at the firewall-rule path.

#### Firewall rules (current)

- timestamp: 2026-04-30T13:00:30Z
  checked: Get-NetFirewallRule mediasoup-worker, ChurchAudioStream
  found:
    - mediasoup-worker: 6 rules (3 paths x TCP/UDP), all Inbound Allow Public, LocalPort=Any. Path matches the running binary.
    - ChurchAudioStream: 1 rule, Inbound Allow Domain+Private, Port 7777 TCP, App=Any.
  implication: mediasoup TCP+UDP allowed inbound on Public profile globally. Mobile traffic (non-loopback) confirms the rules work for external clients. Self-loopback traffic from the local browser does not cross the same firewall path.

#### mediasoup version + TCP support

- timestamp: 2026-04-30T13:00:45Z
  checked: sidecar/package.json + node_modules/mediasoup/package.json
  found: mediasoup 3.19.17. Tests in node_modules confirm enableTcp:true is exercised (test-WebRtcTransport.js line 97, 191). Library supports RFC 4571 framed RTP-over-TCP for media.
  implication: TCP-media is a supported code path. No obvious version-pinned bug.

#### Listener client flow (mediasoup-client + Web Audio)

- timestamp: 2026-04-30T13:01:00Z
  checked: listener/src/hooks/useMediasoup.ts, lib/mediasoup-device.ts, hooks/useAudioPlayback.ts, lib/audio-engine.ts
  found: standard mediasoup-client recvTransport + transport.consume + peer.request("resumeConsumer"). Track is wired through MediaStreamSourceNode -> GainNode -> destination. Same code path mobile uses successfully.
  implication: client-side appears correct. Bytes never arrive at the inbound-rtp counter, which is upstream of the audio engine, so audio engine is not the failure surface.

### Round 3 Root-Cause Conclusion

The Round 1 fix DID change behavior — the user is now reaching ICE/DTLS connected, where previously the transport may have been in checking state forever. But the new failure mode is: **TCP candidate-pair selected, ICE state connected, DTLS state connected, NO SRTP bytes reach the browser.**

**Cannot definitively pinpoint the failure surface without one of:**
1. Packet capture on the selected TCP socket (pktmon -p TCP -e on the dynamic mediasoup TCP port during a live repro)
2. mediasoup-worker debug log output (currently set to `warn` in src-tauri/config.json -> mediasoup.logLevel; needs `debug` to see ICE/DTLS/SRTP internals)
3. Live consumer.getStats() snapshot from the server side during the failing session (currently no admin endpoint exposes per-listener consumer stats)

**Three remaining candidate root causes (need direct evidence to discriminate):**

- **A1.** Windows TCP-loopback path drops outbound SRTP frames from mediasoup-worker. ICE consent + DTLS use small packets (sub-MTU) that traverse fine; SRTP frames after resume() are larger and may hit a kernel-level filter, MTU mismatch, or AFD-driver issue specific to LAN-IP-to-self traffic. Mobile works because non-loopback path is conventional.
- **A2.** mediasoup TCP-write codepath has a deferred-flush bug that doesn't trigger consumer.resume() to actually start writing on the TCP socket on this OS/version. (Less likely — would affect every TCP user.)
- **A3.** Chromium webrtc engine treats this prflx-TCP-active local + same-IP remote as a special path and silently discards inbound bytes. (Edge case, unlikely.)

## Eliminated

- hypothesis: stale sidecar binary
  evidence: process StartTime 11:43:29 > binary mtime 11:42:07; running code = source code.

- hypothesis: blanket Windows Firewall block of UDP 40000-49999
  evidence: mobile playback works through same UDP range.

- hypothesis: ICE failure / no candidate path (Round 1 hypothesis)
  evidence: Round 2 webrtc-internals shows ICE+DTLS connected via TCP/192.168.1.79:49310. NOT an ICE problem.

- hypothesis: B1 listener-count tracker hooked to wrong event
  evidence: src-tauri/config.json sets displayToggles.showListenerCount=false on both channels; signaling-handler.ts:173 returns 0 unconditionally when toggle off. Intended behavior, not a bug. listenerCount=0 in user's evidence is the toggle, not a missed registration.

- hypothesis: client-side audio engine misroutes track
  evidence: bytesReceived=0 is upstream of the audio engine. inbound-rtp counter sits before MediaStreamSourceNode. No bytes ever reach the engine to be misrouted.

## Current Focus

```yaml
hypothesis: "Same-host TCP path between mediasoup-worker and Chromium delivers ICE/DTLS handshake but not SRTP frames after consumer.resume(). Cannot pinpoint without packet capture or mediasoup debug log."
test: |
  Either:
  (a) live pktmon TCP capture on the active mediasoup TCP listener port during a fresh same-host browser repro, OR
  (b) flip mediasoup logLevel to "debug" in src-tauri/config.json + restart, then capture stdout during a fresh repro.
expecting: Direct evidence of either (i) mediasoup-worker writing SRTP and the kernel dropping it, or (ii) mediasoup-worker NOT writing SRTP after resume(), or (iii) browser receiving SRTP but discarding it.
next_action: Ask user which diagnostic path to take. Do NOT keep applying speculative fixes -- Round 1 fix already changed the failure mode without resolving it.
reasoning_checkpoint: null
tdd_checkpoint: null
```

## Resolution

```yaml
root_cause: NOT YET ROOT-CAUSED. Three candidates remain (Windows TCP-loopback drop, mediasoup TCP-write defer, Chromium prflx-TCP discard). Discrimination requires packet-level or mediasoup-debug-level evidence from a fresh repro.
fix: Round 1 fix (added loopback + TCP candidates, enabled enableTcp) IS deployed and DID change behavior (browser now reaches ICE-connected via TCP), but did NOT restore audio. No further speculative fix applied this round.
verification: Next user UAT must capture either (a) pktmon TCP packets on active port or (b) mediasoup debug log lines around consumer.resume() to discriminate the three remaining candidates.
files_changed: []
```
