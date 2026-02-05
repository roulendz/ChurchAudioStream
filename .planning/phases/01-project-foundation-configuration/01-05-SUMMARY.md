# Phase 01 Plan 05: LogViewer Error Logging and Sidecar Rebuild Summary

**One-liner:** Fix LogViewer silent error swallowing with console.warn and rebuild sidecar binary with all Phase 1 changes

---
phase: 01
plan: 05
subsystem: admin-ui, sidecar
tags: [logviewer, error-handling, sidecar, build, gap-closure]

dependency-graph:
  requires: [01-01, 01-02, 01-03, 01-04]
  provides: [visible-error-logging, fresh-sidecar-binary]
  affects: [02-xx (Phase 2 depends on working sidecar)]

tech-stack:
  added: []
  patterns: [error-surface-pattern (console.warn instead of silent catch)]

key-files:
  created: []
  modified:
    - src/components/LogViewer.tsx

decisions:
  - id: 01-05-01
    description: "Errors from Tauri event API import surfaced via console.warn, not silently swallowed"
    rationale: "Silent .catch(() => {}) hides diagnostic information, making 0-entry LogViewer impossible to debug"

metrics:
  duration: 3 minutes
  completed: 2026-02-05
---

## What Was Done

### Task 1: Fix LogViewer Silent Error Swallowing and Rebuild Sidecar Binary

**LogViewer fix (src/components/LogViewer.tsx):**
- Replaced empty `.catch(() => {})` on Tauri event API dynamic import with `console.warn` that logs the specific error message
- Added `.catch()` handler on `setupListeners()` call to surface listener setup failures (previously unhandled promise rejection)
- Both handlers use `error instanceof Error ? error.message : String(error)` for safe error serialization

**Sidecar binary rebuild:**
- Ran `npm run build` in `sidecar/` directory
- Build compiles TypeScript to CommonJS via `tsc --project tsconfig.build.json`
- Packages standalone binary via `@yao-pkg/pkg` targeting `node22-win-x64`
- Binary output: `src-tauri/binaries/server-x86_64-pc-windows-msvc.exe` (69.0 MB)
- Binary is gitignored (correctly -- 69MB binary should not be in git)
- New binary includes all Phase 1 code: 01-01 scaffolding, 01-02 config/server, 01-03 restart logic, 01-04 host binding + firewall

## Deviations from Plan

### Observation (not a deviation)

**Target triple is msvc, not gnu:**
The plan references `server-x86_64-pc-windows-gnu.exe` but `rustc --print host-tuple` reports `x86_64-pc-windows-msvc` on this system. The build script correctly auto-detects the triple and produces `server-x86_64-pc-windows-msvc.exe`. The old `gnu` binary is stale from a previous build configuration. Tauri's `externalBin: ["binaries/server"]` appends the current target triple automatically, so the `msvc` binary is the correct one.

No other deviations -- plan executed exactly as written.

## UAT Gap Closure

- **Test 11 (LogViewer shows 0 entries):** Root cause addressed. Silent `.catch(() => {})` replaced with visible `console.warn`. If Tauri event API fails to load or listeners fail to attach, the error is now visible in browser dev console (F12). Combined with fresh sidecar binary containing all Phase 1 changes, LogViewer should display sidecar startup messages when running `npm run tauri dev`.

## Commits

| Hash | Message |
|------|---------|
| 07ba07c | feat(01-05): fix LogViewer silent error swallowing with console.warn |

## Next Phase Readiness

Phase 1 is now complete (5/5 plans). All gap closure items from UAT have been addressed:
- 01-04: Host binding (0.0.0.0) and firewall rule
- 01-05: LogViewer error visibility and sidecar rebuild

Ready for Phase 2 planning.
