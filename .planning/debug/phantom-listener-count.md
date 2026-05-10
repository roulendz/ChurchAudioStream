---
status: resolved
trigger: "Admin panel shows 1 listener on English_Test channel even though nobody pressed 'Sakt klausities' (Start Listening). Listener count should only increment when user actually starts consuming audio, not on WebSocket/page connection."
created: 2026-05-09
updated: 2026-05-09
---

# Debug: Phantom Listener Count

## Symptoms
- expected: Listener count per channel = 0 when no one is actively listening
- actual: Admin shows 1 listener badge on channel card immediately (likely on WS connect or page load)
- error_messages: none
- timeline: unclear, likely since listener count was implemented
- reproduction: Open listener PWA, don't press Start Listening, check admin panel — shows 1

## Current Focus
- hypothesis: CONFIRMED -- getListenerCount() counted all connected protoo peers regardless of whether they had started consuming audio
- test: Read signaling-handler.ts getListenerCount() method
- expecting: Found the exact bug
- next_action: fix applied

## Evidence
- timestamp: 2026-05-09 investigation
  - signaling-handler.ts getListenerCount() (line 297-308) counted ALL peers in this.peers map that were not closed and not admin, with NO filter for currentChannelId
  - handlePeer() (line 204) adds peer to this.peers immediately on protoo WS connect, before any channel selection
  - currentChannelId is initialized to null (line 214) and only set to a channelId during handleCreateWebRtcTransport (line 568)
  - listener PWA flow: WS connects -> peer counted immediately (BUG) -> user sees channel list -> taps channel -> PlayerView mounts -> connectToChannel() sends createWebRtcTransport -> currentChannelId set
  - streaming-subsystem.ts wireSignalingHandlerEvents() emits listener-count-changed on "listener-connected" event, which fires before any channel is selected

## Eliminated
- Admin WS handler (handler.ts) -- countConnectionsByRole counts admin WS clients only, not protoo listeners. Separate path.
- Listener PWA signaling -- useSignaling.ts only manages protoo peer lifecycle, no premature "join" messages sent

## Resolution
- root_cause: SignalingHandler.getListenerCount() counted all connected protoo peers, including those that had only opened the WebSocket (browsing channel list) but had not yet selected a channel to listen to. The method lacked a filter for currentChannelId !== null.
- fix: Three changes in sidecar/src/streaming/:
  1. signaling-handler.ts getListenerCount(): Added `if (data.currentChannelId === null) continue;` to skip peers not actively consuming audio
  2. signaling-handler.ts handleCreateWebRtcTransport(): Added new "listener-channel-joined" event emission when a peer transitions from browsing to active (currentChannelId set)
  3. streaming-subsystem.ts wireSignalingHandlerEvents(): Added handler for "listener-channel-joined" to emit listener-count-changed at the correct moment (when user selects a channel, not on WS connect)
- verified: TypeScript compilation passes (npx tsc --noEmit clean)
