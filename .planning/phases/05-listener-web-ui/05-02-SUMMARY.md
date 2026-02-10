---
phase: "05"
plan: "02"
subsystem: "listener-web-ui"
tags: [react, protoo-client, mediasoup-client, web-audio-api, gainnode, webrtc, channel-list, player-view]
requires:
  - "04 (WebRTC streaming core -- SignalingHandler, RouterManager, TransportManager)"
  - "05-01 (ListenerChannelInfo with metadata, PWA scaffold, listener project)"
provides:
  - "protoo-client signaling wrapper with auto-reconnection detection"
  - "mediasoup-client Device singleton + receive transport factory"
  - "Web Audio API GainNode audio engine (iOS Safari volume compatible)"
  - "Channel list view with live/offline sorting and real-time updates"
  - "Player view with Start Listening -> WebRTC audio playback flow"
  - "React hooks: useSignaling, useChannelList, useMediasoup, useAudioPlayback"
affects:
  - "05-03 (player polish: pulsing ring, volume slider, mute, elapsed time, connection quality, Media Session)"
  - "05-04 (QR sharing, PWA install prompt)"
  - "08 (auto-reconnection with exponential backoff builds on reconnection detection)"
tech-stack:
  added: []
  patterns: ["protoo-client Peer lifecycle (open/disconnected/close events)", "mediasoup-client Device singleton with reset on reconnect", "Web Audio API GainNode volume pipeline", "protoo notification-driven channel list updates"]
key-files:
  created:
    - "listener/src/lib/protoo-client.d.ts"
    - "listener/src/lib/signaling-client.ts"
    - "listener/src/lib/mediasoup-device.ts"
    - "listener/src/lib/audio-engine.ts"
    - "listener/src/lib/types.ts"
    - "listener/src/hooks/useSignaling.ts"
    - "listener/src/hooks/useChannelList.ts"
    - "listener/src/hooks/useMediasoup.ts"
    - "listener/src/hooks/useAudioPlayback.ts"
    - "listener/src/components/ChannelCard.tsx"
    - "listener/src/components/Toast.tsx"
    - "listener/src/views/ChannelListView.tsx"
    - "listener/src/views/PlayerView.tsx"
  modified:
    - "listener/src/App.tsx"
    - "listener/src/App.css"
key-decisions:
  - "05-02: protoo-client ambient declarations (.d.ts) for browser build (library ships no TypeScript types, same pattern as server-side protoo-server)"
  - "05-02: mediasoup Device cached as module-level singleton, resetDevice() clears on WiFi reconnection"
  - "05-02: Audio engine uses visibilitychange listener to resume suspended AudioContext on mobile (research pitfall 5)"
  - "05-02: useSignaling tracks hasConnectedOnce to distinguish initial connect from reconnection (isReconnect flag)"
  - "05-02: useChannelList replaces full channel list on activeChannels/listenerCounts notifications (not merge, per research pitfall 7)"
  - "05-02: PlayerView listens for consumerClosed notification to show 'Channel offline' when producer stops"
  - "05-02: App uses internal React state for navigation (not pushState per discretion recommendation)"
  - "05-02: ListenerChannelInfo defined locally in listener/src/lib/types.ts (mirrors server type, avoids cross-project imports)"
duration: "10 minutes"
completed: "2026-02-10"
---

# Phase 5 Plan 02: Channel List + Player + WebRTC Audio Playback Summary

protoo-client signaling + mediasoup-client Device + Web Audio API GainNode pipeline delivering channel list -> player flow with live WebRTC audio through iOS-compatible volume control.

## Performance

| Metric | Value |
|--------|-------|
| Duration | 10 minutes |
| Started | 2026-02-10T05:57:31Z |
| Completed | 2026-02-10T06:07:02Z |
| Tasks | 2/2 |
| Files created | 13 |
| Files modified | 2 |

## Accomplishments

### Task 1: Signaling client, mediasoup device, and audio engine libraries
- Created protoo-client ambient type declarations for browser build (Peer, WebSocketTransport, ProtooNotification)
- Built signaling-client.ts with buildWsUrl() (auto-detects ws/wss from page protocol) and createSignalingPeer() wrapper
- Built mediasoup-device.ts with cached Device singleton, loadDevice(), createRecvTransport() factory, and resetDevice() for WiFi recovery
- Built audio-engine.ts with complete Web Audio API GainNode pipeline: playTrack, setVolume, mute/unmute, resume, close
- Added visibilitychange handler to resume suspended AudioContext on mobile (research pitfall 5)
- Verified zero HTMLAudioElement usage anywhere in codebase

### Task 2: React hooks, channel list view, and basic player view with WebRTC playback
- useSignaling: manages protoo Peer lifecycle with connection state tracking (connecting/connected/disconnected/reconnecting) and reconnection detection via hasConnectedOnce flag
- useChannelList: processes protoo notifications (activeChannels, listenerCounts, channelStopped) with live-first sorting
- useMediasoup: full signaling handshake in connectToChannel() -- getRouterRtpCapabilities -> loadDevice -> createWebRtcTransport -> createRecvTransport -> consume -> resumeConsumer
- useAudioPlayback: wraps audio engine with startPlayback (resume + playTrack), stopPlayback, volume/mute control
- ChannelCard: displays name, language (flag + label), conditional description/listeners/badge per admin displayToggles; offline cards dimmed with pointer-events: none
- Toast: auto-dismiss after 3s, positioned bottom-center, used for "This channel is not live right now"
- ChannelListView: welcome header with total listener count, channel cards sorted live-first, empty state message
- PlayerView: connection state machine (connecting -> ready -> playing -> error), Start Listening button gates AudioContext.resume(), back navigation tears down transport, consumerClosed notification handling, retry button
- App.tsx: root navigation with fade transitions, signaling and channel list hooks at top level, reconnection state reset

## Task Commits

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Signaling client, mediasoup device, and audio engine libraries | 96646db | 4 lib files: protoo-client.d.ts, signaling-client.ts, mediasoup-device.ts, audio-engine.ts |
| 2 | React hooks, channel list view, and basic player view with WebRTC playback | 0bf8c83 | 12 files: 4 hooks, 2 components, 2 views, types.ts, App.tsx, App.css, protoo-client.d.ts fix |

## Decisions Made

1. **protoo-client ambient declarations**: Created .d.ts file for browser build since protoo-client ships no TypeScript types. Same pattern used for protoo-server on the sidecar side (Phase 4). Used `any[]` for `off()` parameter to match runtime flexibility of the underlying EventEmitter.

2. **mediasoup Device cached as module-level singleton**: The Device only needs to be loaded once per session with router RTP capabilities. resetDevice() clears the cache for WiFi reconnection scenarios where router state is stale.

3. **visibilitychange listener in audio engine**: Mobile browsers suspend AudioContext when the page goes to background. The engine listens for visibilitychange and calls audioContext.resume() when the page becomes visible again (research pitfall 5).

4. **isReconnect flag in useSignaling**: Tracks whether the peer has connected at least once. On subsequent "open" events (after disconnection), sets isReconnect=true so the mediasoup hook knows to call resetDevice() and re-run the full handshake. The flag is cleared by the consumer.

5. **Full channel list replacement on notifications**: useChannelList replaces the entire channel list on "activeChannels" and "listenerCounts" notifications rather than merging. This avoids stale channel state after long idle (research pitfall 7 -- phone sleep/wake).

6. **PlayerView consumerClosed handling**: Listens for the "consumerClosed" notification from the server (emitted when a channel's producer closes). Shows "Channel offline" error state with retry button.

7. **Internal React state for navigation**: Uses useState for view switching (channels/player) per discretion recommendation. No pushState -- the app has only two views and the in-app back button is explicit.

8. **ListenerChannelInfo local type**: Defined in listener/src/lib/types.ts mirroring the server-side interface. Avoids cross-project imports and keeps the listener project self-contained.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] protoo-client off() type signature too narrow**
- **Found during:** Task 2
- **Issue:** The ambient declaration for `Peer.off()` used `(...args: unknown[]) => void` which is contravariant -- TypeScript rejected passing typed notification handlers. Two files failed type check.
- **Fix:** Changed to `(...args: any[]) => void` to match the runtime flexibility of protoo's underlying EventEmitter.
- **Files modified:** listener/src/lib/protoo-client.d.ts
- **Commit:** 0bf8c83

**2. [Rule 2 - Missing Critical] ListenerChannelInfo local type definition**
- **Found during:** Task 2
- **Issue:** Plan referenced ListenerChannelInfo type from server-side streaming-types.ts, but the listener project cannot import from the sidecar project. Needed a local mirror type.
- **Fix:** Created listener/src/lib/types.ts with the ListenerChannelInfo interface matching the server-side definition exactly.
- **Files created:** listener/src/lib/types.ts
- **Commit:** 0bf8c83

## Issues Found

None.

## Next Phase Readiness

- **Ready for 05-03**: Player view skeleton in place. Plan 03 adds pulsing ring, volume slider, mute button, elapsed time, connection quality icon, Media Session API integration.
- **Ready for 05-04**: Channel list and signaling infrastructure complete. Plan 04 adds QR code sharing and PWA install prompt.
- **Hooks are composable**: All four hooks (useSignaling, useChannelList, useMediasoup, useAudioPlayback) are independent and can be extended without modifying each other.
- **Build verified**: `npm run build` produces 440KB JS bundle (gzipped: 107KB) including mediasoup-client and protoo-client.

## Self-Check: PASSED
