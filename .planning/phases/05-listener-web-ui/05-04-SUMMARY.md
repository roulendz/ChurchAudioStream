---
phase: "05"
plan: "04"
subsystem: "listener-web-ui"
tags: [pwa, localStorage, media-session-api, web-share-api, qrcode, offline-detection, install-prompt]
requires:
  - "05-02 (channel list view, player view, signaling hooks)"
provides:
  - "usePreferences hook with localStorage persistence (last channel, visit count)"
  - "usePwaInstall hook capturing beforeinstallprompt with second-visit gate"
  - "useMediaSession hook for lock-screen play/pause controls (ready, not yet wired to PlayerView)"
  - "OfflineScreen component with church WiFi message"
  - "ShareButton with Web Share API + QR code modal fallback"
  - "PWA install banner in channel list (dismissable)"
  - "Scroll position save/restore between views"
affects:
  - "05-03 merge integration (PlayerView should call useMediaSession after both plans merge)"
  - "08 (preferences infrastructure ready for reconnection UX preferences)"
tech-stack:
  added: ["qrcode ^1.5.x"]
  patterns: ["localStorage preference persistence", "beforeinstallprompt deferred prompt", "Media Session API metadata + action handlers", "Web Share API with QR fallback", "navigator.onLine + online/offline events"]
key-files:
  created:
    - "listener/src/hooks/usePreferences.ts"
    - "listener/src/hooks/usePwaInstall.ts"
    - "listener/src/hooks/useMediaSession.ts"
    - "listener/src/components/OfflineScreen.tsx"
    - "listener/src/components/ShareButton.tsx"
  modified:
    - "listener/src/views/ChannelListView.tsx"
    - "listener/src/App.tsx"
    - "listener/src/App.css"
    - "listener/package.json"
    - "listener/package-lock.json"
key-decisions:
  - "05-04: useMediaSession hook created standalone (not integrated into PlayerView) because 05-03 owns PlayerView in this wave"
  - "05-04: Visit count incremented once per mount via useRef guard (StrictMode-safe)"
  - "05-04: PWA install canInstall gates on both beforeinstallprompt event AND visitCount >= 2"
  - "05-04: ShareButton uses navigator.share first, falls through to QR modal on AbortError or unavailability"
  - "05-04: OfflineScreen uses z-index 500 to overlay all other content including reconnecting banner"
  - "05-04: Scroll position saved in useRef (not localStorage) since it is transient within a session"
  - "05-04: ChannelListView no longer manages its own localStorage read for lastChannelId (moved to App-level usePreferences)"
duration: "4 minutes"
completed: "2026-02-10"
---

# Phase 5 Plan 04: PWA Experience -- Preferences, Sharing, Offline, Install Prompt Summary

localStorage preferences + PWA install prompt on second visit + Media Session lock-screen hook + Web Share API with QR fallback + offline detection overlay completing the native-feel PWA experience.

## Performance

| Metric | Value |
|--------|-------|
| Duration | 4 minutes |
| Started | 2026-02-10T06:13:08Z |
| Completed | 2026-02-10T06:16:50Z |
| Tasks | 2/2 |
| Files created | 5 |
| Files modified | 5 |

## Accomplishments

### Task 1: Preferences, PWA install prompt, and Media Session hooks
- Created usePreferences hook with localStorage-backed last channel (cas_last_channel) and visit count (cas_visit_count) persistence
- Visit count auto-increments once on mount with useRef guard for StrictMode safety
- isReturningListener computed as visitCount >= 2 for PWA install gating
- Created usePwaInstall hook that captures beforeinstallprompt event, defers it, exposes canInstall (event + returning listener) and promptInstall()
- On iOS (no beforeinstallprompt), canInstall stays false -- no fallback needed
- Created useMediaSession hook with MediaMetadata (title=channelName, artist=description, album="Church Audio Stream") and play/pause action handlers
- useMediaSession guards with isMediaSessionSupported() -- no-op on unsupported browsers
- Cleanup removes action handlers and metadata on unmount

### Task 2: Offline screen, share button, and integration into views
- Created OfflineScreen component using navigator.onLine + online/offline events with WiFi icon SVG, "Connect to the church WiFi" message, and Try Again button
- Created ShareButton component: navigator.share() for native share sheet, QR code modal fallback via qrcode.toDataURL() with Escape key and backdrop click to close
- Updated ChannelListView: added lastChannelId, listenerUrl, canInstall, promptInstall props; header row with share button; dismissable install banner
- Moved localStorage last-channel management from ChannelListView to App-level usePreferences (channel ID saved in handleSelectChannel)
- Updated App.tsx: integrated usePreferences and usePwaInstall hooks, OfflineScreen overlay on all states, scroll position save/restore via useRef
- Added CSS for offline screen (z-500 overlay), share button, QR modal, install banner, header row layout
- Build verified: 471KB JS (118KB gzip), 8.59KB CSS

## Task Commits

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Preferences, PWA install prompt, and Media Session hooks | 9fa9294 | 3 hooks: usePreferences.ts, usePwaInstall.ts, useMediaSession.ts |
| 2 | Offline screen, share button, and integration | e576926 | 2 components, 3 modified views/app files, CSS, package.json |

## Decisions Made

1. **useMediaSession standalone (not in PlayerView)**: 05-03 owns PlayerView in this wave. The hook is created and ready but not wired into PlayerView. Integration should happen after both plans merge -- PlayerView calls useMediaSession with channel info and play/pause callbacks.

2. **Visit count increment with useRef guard**: The incrementVisitCount function uses a hasIncrementedRef to ensure it only runs once per mount, even in StrictMode's double-render development mode. Called automatically in useEffect on mount.

3. **PWA install double gate**: canInstall requires BOTH the beforeinstallprompt event to have been captured AND visitCount >= 2. This satisfies the locked decision of "PWA install prompt shown on second visit (not first-timers)."

4. **ShareButton fallback chain**: Tries navigator.share() first. On AbortError (user cancel), returns silently. On any other failure or lack of Web Share API support, falls through to QR code modal generated via qrcode.toDataURL().

5. **OfflineScreen z-index 500**: Higher than all other overlays (toast=200, share modal=300, reconnecting banner=100) to ensure offline state blocks all interaction.

6. **Scroll position in useRef**: Saved in handleSelectChannel before navigating to player, restored in useEffect when currentView becomes "channels". Uses useRef (not localStorage) since scroll position is session-transient.

7. **lastChannelId management centralized in App**: ChannelListView previously read localStorage directly for lastChannelId. Now it receives the value as a prop from App, which manages preferences at the top level. setLastChannel is called in handleSelectChannel.

## Deviations from Plan

None -- plan executed exactly as written.

## Integration Note

**PlayerView + useMediaSession**: After 05-03 and 05-04 merge, PlayerView should be updated to call useMediaSession with:
- `channelName`: from the channel prop
- `description`: from the channel prop
- `onPlay`: resume audio via audio engine
- `onPause`: mute audio via audio engine

The updatePlaybackState function should be called when player state transitions to "playing" or when mute/unmute occurs.

## Issues Found

None.

## Next Phase Readiness

- **Phase 5 complete**: All 4 plans delivered -- PWA scaffold, channel list + player, player polish, PWA experience
- **Build verified**: Production build succeeds with full feature set
- **Integration needed**: useMediaSession hook needs to be wired into PlayerView after 05-03 merge

## Self-Check: PASSED
