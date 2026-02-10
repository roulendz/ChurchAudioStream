---
status: resolved
trigger: "mediasoup-worker-enoent-pkg: pkg-compiled sidecar can't find mediasoup-worker.exe"
created: 2026-02-10T15:00:00.000Z
updated: 2026-02-10T16:48:00.000Z
---

## Current Focus

hypothesis: CONFIRMED AND FIXED
test: Ran sidecar binary from Tauri debug directory - mediasoup worker found and started successfully
expecting: N/A - verified
next_action: Archive session

## Symptoms

expected: Sidecar starts mediasoup workers successfully and runs the streaming server
actual: Fatal crash loop with "spawn C:\snapshot\sidecar\node_modules\mediasoup\worker\out\Release\mediasoup-worker ENOENT"
errors: {"level":"fatal","msg":"Fatal startup error: spawn C:\\snapshot\\sidecar\\node_modules\\mediasoup\\worker\\out\\Release\\mediasoup-worker ENOENT"}
reproduction: Run `npm run tauri dev` from project root
started: Known issue deferred from Phase 4, recent fix attempt not working

## Eliminated

- hypothesis: Sidecar binary was not rebuilt with new resolveWorkerBin() code
  evidence: Binary (16:51) built AFTER worker-manager.ts (16:49) and dist/worker-manager.js (16:50). Grep of dist confirms resolveWorkerBin exists.
  timestamp: 2026-02-10T15:05:00.000Z

## Evidence

- timestamp: 2026-02-10T15:03:00.000Z
  checked: File locations in src-tauri/target/debug/
  found: server.exe at target/debug/server.exe, mediasoup-worker.exe at target/debug/binaries/mediasoup-worker.exe
  implication: process.execPath dirname is target/debug/, but worker is in binaries/ subdir

- timestamp: 2026-02-10T15:04:00.000Z
  checked: resolveWorkerBin() code path
  found: Only checks path.join(exeDir, workerName) -- i.e., directly next to exe. Does NOT check binaries/ subdirectory.
  implication: Candidate path "target/debug/mediasoup-worker.exe" does not exist, function returns undefined, mediasoup falls back to C:\snapshot\... path

- timestamp: 2026-02-10T15:05:00.000Z
  checked: Tauri resources config vs actual placement
  found: tauri.conf.json has resources: ["binaries/mediasoup-worker*"]. Tauri preserves relative path structure, so file lands in target/debug/binaries/
  implication: The "binaries/" prefix in the resources glob causes the subdirectory to be preserved

- timestamp: 2026-02-10T15:06:00.000Z
  checked: Build timestamps - worker-manager.ts (16:49), dist/worker-manager.js (16:50), server binary (16:51)
  found: All timestamps confirm code was compiled and included in the binary
  implication: The resolveWorkerBin() code IS running but returning undefined because its candidate path check fails

- timestamp: 2026-02-10T16:47:00.000Z
  checked: Ran fixed sidecar from src-tauri/target/debug/
  found: Log output shows "Using mediasoup worker found at: ...binaries\mediasoup-worker.exe", then "mediasoup worker started", "All mediasoup workers started", "Sidecar ready"
  implication: Fix works - sidecar finds worker in binaries/ subdir and starts successfully

## Resolution

root_cause: resolveWorkerBin() in worker-manager.ts only looked for mediasoup-worker.exe directly next to process.execPath (the pkg binary at target/debug/server.exe). But Tauri's resources config "binaries/mediasoup-worker*" preserves the directory structure, placing the file at target/debug/binaries/mediasoup-worker.exe -- one level deeper. The function returned undefined, causing mediasoup to fall back to its default C:\snapshot\... virtual path which doesn't exist on disk.

fix: Extracted a buildWorkerBinCandidateDirs() function that returns multiple search directories: (1) next to process.execPath, (2) binaries/ subdirectory of exe dir, (3) cwd, (4) binaries/ subdirectory of cwd. The resolveWorkerBin() function now iterates all candidates and returns the first match. This handles both Tauri dev mode (binaries/ subdir) and potential production layouts.

verification: Rebuilt sidecar with `npx tsx build.ts`, rebuilt Tauri with `npx tauri build --debug`, ran sidecar binary directly from src-tauri/target/debug/. Output confirms: worker found at binaries/mediasoup-worker.exe, mediasoup workers started successfully (count: 1), sidecar reached "Sidecar ready" state. Zero ENOENT errors.

files_changed:
- sidecar/src/streaming/worker-manager.ts
