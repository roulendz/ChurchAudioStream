---
phase: "05"
plan: "01"
subsystem: "listener-web-ui"
tags: [react, pwa, vite, mediasoup-client, protoo-client, service-worker, channel-metadata]
requires:
  - "04 (WebRTC streaming core -- ListenerChannelInfo, SignalingHandler, RouterManager)"
provides:
  - "Extended ListenerChannelInfo with description, language, listenerCount, displayToggles"
  - "ChannelSchema config with description, language, displayToggles fields"
  - "30s listener count broadcast mechanism"
  - "Listener Vite+React+PWA project scaffold"
  - "PWA manifest, service worker, offline fallback"
affects:
  - "05-02 (channel list + player views build on this scaffold)"
  - "05-03 (WebRTC connection hooks use mediasoup-client from this project)"
  - "07 (admin toggles description/listenerCount/liveBadge added here)"
tech-stack:
  added: ["react@19", "react-dom@19", "mediasoup-client", "protoo-client", "vite", "@vitejs/plugin-react", "vite-plugin-pwa"]
  patterns: ["vite-plugin-pwa generateSW", "buildEnrichedChannelList server optimization", "resolveFullChannelConfig metadata resolver"]
key-files:
  created:
    - "listener/package.json"
    - "listener/tsconfig.json"
    - "listener/vite.config.ts"
    - "listener/index.html"
    - "listener/public/offline.html"
    - "listener/public/icons/icon-192.png"
    - "listener/public/icons/icon-512.png"
    - "listener/src/main.tsx"
    - "listener/src/App.tsx"
    - "listener/src/App.css"
    - "listener/src/styles/index.css"
    - "listener/src/vite-env.d.ts"
  modified:
    - "sidecar/src/config/schema.ts"
    - "sidecar/src/streaming/streaming-types.ts"
    - "sidecar/src/streaming/router-manager.ts"
    - "sidecar/src/streaming/signaling-handler.ts"
    - "sidecar/src/streaming/streaming-subsystem.ts"
    - "sidecar/src/ws/listener-handler.ts"
    - ".gitignore"
key-decisions:
  - "05-01: buildEnrichedChannelList() only computes listenerCount when displayToggles.showListenerCount is true (server optimization per locked decision)"
  - "05-01: Listener count broadcast reuses heartbeat interval (30s) wired in ListenerWebSocketHandler"
  - "05-01: resolveFullChannelConfig() extracted as separate method per SRP (Phase 5 display fields vs Phase 4 streaming fields)"
  - "05-01: Inline metadataResolver in start() replaced with buildMetadataResolver() call (DRY -- was duplicated)"
  - "05-01: sidecar/public/ added to .gitignore (now build output from listener/, replaces Phase 1 placeholder)"
  - "05-01: vite-plugin-pwa generateSW with autoUpdate (silent updates per locked decision)"
  - "05-01: NetworkOnly for /api/ and /ws/ in service worker runtimeCaching (never cache API/WebSocket)"
duration: "9 minutes"
completed: "2026-02-10"
---

# Phase 5 Plan 01: Server Metadata Extension + Listener PWA Scaffold Summary

Extended server-side channel metadata with description/language/listenerCount/displayToggles and scaffolded Vite+React+PWA listener project outputting to sidecar/public/ with service worker, manifest, and offline fallback.

## Performance

| Metric | Value |
|--------|-------|
| Duration | 9 minutes |
| Started | 2026-02-10T05:43:23Z |
| Completed | 2026-02-10T05:52:09Z |
| Tasks | 2/2 |
| Files created | 13 |
| Files modified | 7 |

## Accomplishments

### Task 1: Extend server-side channel metadata and listener count broadcast
- Added `description`, `language` (code/label/flag), and `displayToggles` (showDescription/showListenerCount/showLiveBadge) to ChannelSchema config
- Extended ListenerChannelInfo interface with matching fields plus `listenerCount`
- Extended ChannelMetadataResolver type to carry the new fields through
- Added `buildEnrichedChannelList()` in SignalingHandler -- injects listener counts only when admin toggles showListenerCount on (server-side optimization per locked decision)
- Added `broadcastListenerCounts()` public method in SignalingHandler for periodic push
- Wired 30s listener count broadcast interval in ListenerWebSocketHandler alongside existing heartbeat
- Extracted `resolveFullChannelConfig()` in StreamingSubsystem for Phase 5 display metadata (SRP: separate from Phase 4 streaming config)
- DRY improvement: replaced inline metadataResolver in `start()` with `buildMetadataResolver()` call

### Task 2: Scaffold Listener Vite+React+PWA project
- Created `listener/` project with React 19, mediasoup-client, protoo-client
- Configured Vite with react plugin and vite-plugin-pwa (generateSW strategy, autoUpdate)
- PWA manifest: "Church Audio Stream", short name "CAS", portrait orientation, standalone display, dark theme
- Service worker: app-shell precaching with navigateFallback, NetworkOnly for /api/ and /ws/ paths
- Build outputs to `../sidecar/public/` (emptyOutDir: true, replaces Phase 1 placeholder)
- Dev server proxy: /api and /ws proxied to localhost:7777 with secure:false for self-signed certs
- Mobile-first base CSS: dark theme (#1a1a2e), font smoothing, tap highlight suppression
- Offline fallback page: church WiFi connection message with retry button and WiFi SVG icon
- Placeholder PWA icons (to be replaced with real CAS-branded icons)
- Added `sidecar/public/` to .gitignore and removed old Phase 1 placeholder from tracking

## Task Commits

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Extend server-side channel metadata and listener count broadcast | 8694cce | 6 server files: schema, types, router-manager, signaling, subsystem, listener-handler |
| 2 | Scaffold Listener Vite+React+PWA project | 49cc658 | 13 new files in listener/, .gitignore update, removed old placeholder |

## Decisions Made

1. **buildEnrichedChannelList() server optimization**: Only computes listener counts when admin has toggled showListenerCount on. Zero CPU cost when hidden (per locked decision from 05-CONTEXT.md: "Hidden card fields are not tracked/calculated server-side").

2. **Listener count broadcast interval**: Reuses the existing heartbeatIntervalMs config (30s default) since both zombie detection and listener count updates share the same timing requirement. Wired as a separate setInterval in ListenerWebSocketHandler for independent cleanup.

3. **resolveFullChannelConfig() separated from resolveChannelConfig()**: Phase 4's resolveChannelConfig returns streaming fields (latencyMode, lossRecovery, defaultChannel). Phase 5 display fields (description, language, displayToggles) go in a separate method per SRP -- they serve different consumers and will evolve independently.

4. **DRY: Inline metadataResolver replaced**: The `start()` method had an inline metadataResolver that duplicated `buildMetadataResolver()`. Replaced with a single call.

5. **sidecar/public/ is now build output**: Added to .gitignore. The listener project builds into this directory, replacing the Phase 1 static placeholder.

6. **vite-plugin-pwa with generateSW + autoUpdate**: Silent service worker updates per locked decision ("new version loads on next visit, no prompt"). NavigateFallback for SPA routing. NetworkOnly for API/WebSocket paths to never interfere with real-time communication.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] sidecar/public/ not gitignored**
- **Found during:** Task 2
- **Issue:** The old Phase 1 placeholder `sidecar/public/index.html` was tracked by git. After the listener build now outputs there with `emptyOutDir: true`, build artifacts would be committed.
- **Fix:** Added `sidecar/public/` to .gitignore, ran `git rm --cached` on the old placeholder.
- **Files modified:** .gitignore
- **Commit:** 49cc658

**2. [Rule 2 - Missing Critical] vite-env.d.ts for Vite client types**
- **Found during:** Task 2
- **Issue:** TypeScript compilation would fail without Vite client type references (import.meta.env, CSS modules, etc.)
- **Fix:** Created `listener/src/vite-env.d.ts` with `/// <reference types="vite/client" />`
- **Files created:** listener/src/vite-env.d.ts
- **Commit:** 49cc658

## Issues Found

None.

## Next Phase Readiness

- **Ready for 05-02**: Listener project scaffold complete. Channel list and player view components can be built on top of `App.tsx`.
- **Ready for 05-03**: mediasoup-client and protoo-client installed. WebRTC connection hooks can use these libraries.
- **Server types complete**: All Phase 5 ListenerChannelInfo fields in place. No further server-side type changes needed for Plans 02-06.
- **Build pipeline verified**: `npm run build` produces PWA output in sidecar/public/ with manifest, service worker, and offline fallback.

## Self-Check: PASSED
