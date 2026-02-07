---
status: diagnosed
trigger: "AudioSubsystem from Phase 2 Plan 02-09 is not initializing when the sidecar starts"
created: 2026-02-07T16:00:00Z
updated: 2026-02-07T16:00:00Z
---

## Current Focus

hypothesis: The compiled dist/ output and pkg binary are stale -- they were built from the Phase 1 source code BEFORE the Phase 2 audio subsystem changes were added. The sidecar runs as a pkg-compiled binary, so source changes have no effect until rebuilt.
test: Compare dist/index.js and dist/ws/handler.js against src/index.ts and src/ws/handler.ts
expecting: dist/ files will be missing all AudioSubsystem references
next_action: Return diagnosis -- root cause confirmed

## Symptoms

expected: Sidecar starts with AudioSubsystem initialization logs, WebSocket handles sources:list, channel:create, etc.
actual: No audio subsystem log messages. sources:list returns "Invalid JSON". channel:create returns "Unknown message type: channel:create".
errors: "Invalid JSON" on sources:list; "Unknown message type: channel:create" on channel:create
reproduction: Start sidecar, connect via WebSocket, send audio message types
started: After Phase 2 Plan 02-09 source code was written

## Eliminated

(none needed -- root cause found on first hypothesis)

## Evidence

- timestamp: 2026-02-07T16:00:00Z
  checked: sidecar/src/index.ts (source)
  found: Line 5 imports AudioSubsystem, line 176 creates it, line 207 calls audioSubsystem.start(), line 185 passes it to createServer. All Phase 2 code present.
  implication: Source code is correct.

- timestamp: 2026-02-07T16:00:00Z
  checked: sidecar/src/ws/handler.ts (source)
  found: Lines 446-457 define AUDIO_MESSAGE_PREFIXES and isAudioMessageType(). Lines 186-189 route audio messages to handleAudioMessage(). Lines 465-716 implement full audio message handling. All Phase 2 code present.
  implication: Source code is correct.

- timestamp: 2026-02-07T16:00:00Z
  checked: sidecar/dist/index.js (compiled)
  found: NO import of AudioSubsystem. NO creation of AudioSubsystem. NO audioSubsystem.start() call. Line 129: createServer called with only 4 args (no audioSubsystem). Line 131: setupGracefulShutdown called with only 1 arg (no audioSubsystem). Line 132-134: setupRestartListener called with only 5 args (no audioSubsystem). Line 135: Sidecar ready log has no audio channel count. This is the PHASE 1 compiled output.
  implication: dist/ was last built from Phase 1 source code.

- timestamp: 2026-02-07T16:00:00Z
  checked: sidecar/dist/ws/handler.js (compiled)
  found: NO isAudioMessageType function. NO handleAudioMessage function. NO handleAudioMessageAsync function. NO wireAudioBroadcasts function. NO AUDIO_MESSAGE_PREFIXES constant. NO LEVEL_BROADCAST_INTERVAL_MS constant. setupWebSocket function signature takes 3 params (server, configStore, serverEvents) -- NO audioSubsystem parameter. handleIncomingMessage takes 6 params -- NO audioSubsystem parameter. Switch statement goes directly to default for unknown types. This is the PHASE 1 compiled output.
  implication: dist/ was last built from Phase 1 source code.

- timestamp: 2026-02-07T16:00:00Z
  checked: sidecar/dist/server.js (compiled)
  found: createServer function signature takes 4 params (config, basePath, configStore, serverEvents) -- NO audioSubsystem parameter. setupWebSocket called with 3 args (no audioSubsystem). This is the PHASE 1 compiled output.
  implication: dist/ was last built from Phase 1 source code.

- timestamp: 2026-02-07T16:00:00Z
  checked: sidecar/dist/ directory structure
  found: Contains config/, network/, utils/, ws/ subdirectories and index.js, server.js. NO audio/ directory exists.
  implication: The audio subsystem module was never compiled into dist/.

- timestamp: 2026-02-07T16:00:00Z
  checked: src-tauri/binaries/ directory
  found: server-x86_64-pc-windows-msvc.exe (72MB, dated Feb 7 02:54) and server-x86_64-pc-windows-gnu.exe (72MB, dated Feb 5 16:57). These are pkg-compiled binaries that embed the dist/ JS code.
  implication: The running binary was built from the stale dist/ output and contains no Phase 2 code.

- timestamp: 2026-02-07T16:00:00Z
  checked: sidecar/build.ts build pipeline
  found: Step 1 cleans dist/. Step 2 compiles TypeScript via tsconfig.build.json. Step 4 runs pkg to create standalone binary from dist/index.js. Step 6 copies binary to src-tauri/binaries/. The dist/ timestamps (Feb 7 02:54) match the msvc binary timestamp, confirming they were built together -- but from Phase 1 source.
  implication: Build was run BEFORE Phase 2 source changes were committed. Source was modified AFTER the last build.

## Resolution

root_cause: The sidecar runs as a pkg-compiled standalone binary (src-tauri/binaries/server-x86_64-pc-windows-msvc.exe). This binary was built from the Phase 1 source code and has NOT been rebuilt since the Phase 2 audio subsystem code was added to the TypeScript source files. The compiled dist/ directory is missing the entire audio/ subdirectory and all three key compiled files (dist/index.js, dist/server.js, dist/ws/handler.js) contain the Phase 1 code without any AudioSubsystem references, audio message routing, or level broadcasting.
fix: Run `npm run build` in sidecar/ to recompile TypeScript and regenerate the pkg binary with Phase 2 code included.
verification: After rebuild, start sidecar and verify: (1) "Audio subsystem started" appears in logs, (2) sources:list returns a sources array, (3) channel:create creates a channel successfully.
files_changed: []
