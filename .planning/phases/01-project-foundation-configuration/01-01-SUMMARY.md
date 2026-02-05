---
phase: 01-project-foundation-configuration
plan: 01
subsystem: core-scaffold
tags: [tauri, react, sidecar, pkg, lifecycle, typescript]
requires: []
provides:
  - Tauri 2.x desktop shell with React 19 frontend
  - Node.js sidecar binary compiled via pkg with target triple naming
  - Sidecar lifecycle management (spawn, restart, clean shutdown)
  - Structured JSON logging from sidecar to Tauri events
  - Build pipeline (TypeScript -> CJS -> pkg -> target-triple binary)
affects:
  - 01-02 (Express + WebSocket server builds on sidecar entry point)
  - 01-03 (Config store loads from config path established here)
  - All future phases (build on this Tauri + sidecar foundation)
tech-stack:
  added:
    - tauri@2.10.2
    - tauri-plugin-shell@2.3.5
    - react@19.2.0
    - vite@7.3.1
    - typescript@5.9.3
    - express@5.2.1 (sidecar dependency, used in Plan 02)
    - ws@8.19.0 (sidecar dependency, used in Plan 02)
    - zod@4.3.6 (sidecar dependency, used in Plan 02)
    - "@yao-pkg/pkg@6.12.0"
    - tsx@4.19.4
  patterns:
    - Sidecar lifecycle via Arc<AtomicBool> + async spawn loop
    - Structured JSON stdout logging for Tauri event forwarding
    - CJS compilation for pkg compatibility (ESM source, CJS build output)
    - Target triple detection via rustc --print host-tuple
    - Stdin-close orphan prevention on Windows
key-files:
  created:
    - package.json
    - tsconfig.json
    - tsconfig.app.json
    - tsconfig.node.json
    - vite.config.ts
    - index.html
    - src/main.tsx
    - src/App.tsx
    - src/App.css
    - src/vite-env.d.ts
    - src-tauri/Cargo.toml
    - src-tauri/Cargo.lock
    - src-tauri/build.rs
    - src-tauri/tauri.conf.json
    - src-tauri/capabilities/default.json
    - src-tauri/src/lib.rs
    - src-tauri/src/main.rs
    - src-tauri/icons/icon.ico
    - sidecar/package.json
    - sidecar/tsconfig.json
    - sidecar/tsconfig.build.json
    - sidecar/build.ts
    - sidecar/src/index.ts
    - sidecar/src/utils/logger.ts
    - .gitignore
  modified: []
key-decisions:
  - id: use-gnu-toolchain
    decision: "Use x86_64-pc-windows-gnu Rust target instead of MSVC"
    reason: "No Visual Studio Build Tools installed; GNU toolchain with MinGW-w64 provides full compilation without requiring VS"
    impact: "Sidecar binary named server-x86_64-pc-windows-gnu.exe instead of server-x86_64-pc-windows-msvc.exe"
  - id: cjs-for-pkg
    decision: "Compile TypeScript to CommonJS for pkg, not ESM"
    reason: "pkg (yao-pkg) does not support ESM modules in snapshot filesystem; CJS works reliably"
    impact: "Separate tsconfig.build.json for CJS output; dev mode (tsx) still uses ESM"
  - id: no-tauri-ipc
    decision: "No Tauri IPC commands for admin operations"
    reason: "Admin GUI connects via WebSocket as a regular client per architecture decision"
    impact: "Tauri Rust side only manages sidecar lifecycle, no #[tauri::command] handlers"
duration: "23 minutes"
completed: "2026-02-05"
---

# Phase 01 Plan 01: Tauri + React + Sidecar Scaffold Summary

**One-liner:** Tauri 2.x desktop shell with React 19 frontend and Node.js sidecar compiled via pkg, with auto-restart lifecycle management and structured JSON log forwarding.

## Performance

| Metric | Value |
|--------|-------|
| Duration | 23 minutes |
| Start | 2026-02-05T14:15:50Z |
| End | 2026-02-05T14:38:47Z |
| Tasks | 3/3 |
| Files created | 26 |
| Files modified | 0 |

## Accomplishments

1. **Tauri 2.x + React 19 project scaffold** -- Full project structure with Vite 7, TypeScript 5.9, shell plugin for sidecar management, CSP configured for WSS connections to localhost.

2. **Node.js sidecar with pkg build pipeline** -- TypeScript sidecar project compiles to standalone binary (54.8 MB) with correct target triple naming for Tauri. Structured JSON logging to stdout. Stdin-close orphan prevention. Graceful SIGTERM/SIGINT shutdown.

3. **Sidecar lifecycle management in Rust** -- Tauri spawns sidecar on launch, forwards stdout/stderr as events, auto-restarts on crash after 2s delay, cleanly stops on window close via AtomicBool flag.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Scaffold Tauri 2.x + React 19 | 45b279c | package.json, src-tauri/tauri.conf.json, src-tauri/capabilities/default.json, src/App.tsx |
| 2 | Create Node.js sidecar with build pipeline | 8f6cd41 | sidecar/src/index.ts, sidecar/src/utils/logger.ts, sidecar/build.ts, sidecar/tsconfig.build.json |
| 3 | Implement Tauri Rust sidecar lifecycle | 380b78d | src-tauri/src/lib.rs |

## Decisions Made

### 1. GNU Rust toolchain over MSVC

The development environment lacks Visual Studio Build Tools. Rather than requiring a multi-GB install, the project uses `x86_64-pc-windows-gnu` with MinGW-w64 (installed from niXman builds). The sidecar binary is named `server-x86_64-pc-windows-gnu.exe`. For production distribution, MSVC target may be preferred -- this can be changed by installing VS Build Tools and switching `rustup default`.

### 2. CommonJS compilation for pkg

The `@yao-pkg/pkg` tool does not support ESM modules in its snapshot filesystem. The sidecar source remains ESM-compatible TypeScript, but the build pipeline compiles to CommonJS via `tsconfig.build.json` (module: "CommonJS"). Development mode via `tsx` runs ESM natively.

### 3. No Tauri IPC for admin operations

Following the architecture principle "admin GUI is just another client," the Tauri Rust side contains zero `#[tauri::command]` handlers. All admin operations will flow through the WebSocket connection (Plan 02). Tauri's sole responsibility is sidecar lifecycle.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rust toolchain not installed**
- **Found during:** Task 1
- **Issue:** Neither Rust nor cargo were installed on the system
- **Fix:** Installed Rust via rustup-init.exe with stable toolchain
- **Impact:** None, prerequisite was missing

**2. [Rule 3 - Blocking] MSVC linker not available (no Visual Studio Build Tools)**
- **Found during:** Task 1
- **Issue:** Cargo check failed because `link.exe` in PATH was MSYS2 hardlink utility, not MSVC linker
- **Fix:** Installed GNU Rust toolchain (stable-x86_64-pc-windows-gnu) and MinGW-w64 (GCC 14.2.0) as the linker. Changed default target from MSVC to GNU.
- **Impact:** Binary target triple is `x86_64-pc-windows-gnu` instead of `x86_64-pc-windows-msvc`. Functionally equivalent.

**3. [Rule 1 - Bug] pkg ESM snapshot error (UNEXPECTED-20)**
- **Found during:** Task 2
- **Issue:** Compiled binary crashed with `Error: UNEXPECTED-20` because pkg cannot handle ESM modules in its snapshot filesystem
- **Fix:** Created `tsconfig.build.json` targeting CommonJS for pkg builds. Removed `.js` extensions from TypeScript imports for CJS compatibility.
- **Impact:** Build pipeline compiles to CJS; dev mode (tsx) still uses ESM natively

**4. [Rule 2 - Missing Critical] Placeholder icon for Tauri build**
- **Found during:** Task 1
- **Issue:** Tauri build requires icon.ico file; none existed
- **Fix:** Generated minimal 16x16 ICO file programmatically
- **Impact:** Placeholder icon; real icons are a Phase 10 concern

## Issues

None blocking. All issues were resolved during execution.

## Next Phase Readiness

### For Plan 01-02 (Express + WebSocket Server)
- Sidecar entry point (`sidecar/src/index.ts`) is ready for server creation code
- Config path resolution is implemented and verified
- Logger utility is available for structured logging
- Dependencies (express, ws, zod, selfsigned) are installed

### For Plan 01-03 (Config Store)
- Zod is installed as a dependency
- Config path resolution defaults to executable directory
- Build pipeline produces working standalone binary

### Environment Notes
- Rust GNU toolchain: `stable-x86_64-pc-windows-gnu` (Rust 1.93.0)
- MinGW-w64: GCC 14.2.0 at `/c/mingw64/bin/`
- PATH must include both `/c/Users/rolan/.cargo/bin` and `/c/mingw64/bin` for Rust compilation
- First `cargo build` takes several minutes (382 crates); subsequent builds are cached (~1-2s)
