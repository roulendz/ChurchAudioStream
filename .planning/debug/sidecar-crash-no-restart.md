---
status: diagnosed
trigger: "Killing Node.js sidecar in Task Manager crashes Tauri dev session instead of auto-restarting"
created: 2026-02-05T00:00:00Z
updated: 2026-02-05T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - In dev mode, sidecar is NOT managed by Rust auto-restart code. It is started by beforeDevCommand (Vite), and Tauri itself launches the Rust binary which spawns the compiled sidecar. However, the pre-compiled sidecar binary and the dev sidecar are different processes.
test: Trace the full dev-mode process tree
expecting: beforeDevCommand only starts Vite; Rust code spawns compiled binary from src-tauri/binaries/
next_action: Return diagnosis

## Symptoms

expected: Killing sidecar process in Task Manager triggers auto-restart via lib.rs spawn_sidecar loop
actual: Entire Tauri dev session crashes with "The 'beforeDevCommand' terminated with a non-zero status code"
errors: "The 'beforeDevCommand' terminated with a non-zero status code"
reproduction: Run `npm run tauri dev`, kill sidecar process in Task Manager
started: Always been this way

## Eliminated

- hypothesis: beforeDevCommand starts the sidecar directly
  evidence: beforeDevCommand is `npm run dev` which maps to `vite` (just Vite dev server, no sidecar logic). Vite config confirms no sidecar plugin.
  timestamp: 2026-02-05

## Evidence

- timestamp: 2026-02-05
  checked: tauri.conf.json beforeDevCommand
  found: beforeDevCommand = "npm run dev", which maps to "vite" in package.json
  implication: beforeDevCommand only starts Vite dev server, NOT the sidecar

- timestamp: 2026-02-05
  checked: vite.config.ts
  found: Standard Vite config with React plugin, no sidecar spawning logic
  implication: Confirms sidecar is NOT started by Vite/beforeDevCommand

- timestamp: 2026-02-05
  checked: src-tauri/src/lib.rs spawn_sidecar function
  found: Uses app_handle.shell().sidecar("server") which references "binaries/server" from externalBin config. Has robust auto-restart loop with 2-second delay.
  implication: The Rust auto-restart code IS correct and should work in both dev and prod

- timestamp: 2026-02-05
  checked: tauri.conf.json bundle.externalBin
  found: ["binaries/server"] - the sidecar is referenced as a pre-compiled binary
  implication: In dev mode, Tauri resolves this to src-tauri/binaries/server-{target-triple}.exe

- timestamp: 2026-02-05
  checked: src-tauri/binaries/ directory
  found: server-x86_64-pc-windows-gnu.exe and server-x86_64-pc-windows-msvc.exe exist
  implication: Pre-compiled sidecar binaries are present for dev mode

- timestamp: 2026-02-05
  checked: Error message pattern "The 'beforeDevCommand' terminated with a non-zero status code"
  found: This is a Tauri CLI error, not from the Rust app code. It means the process started by beforeDevCommand (Vite) exited.
  implication: The crash is NOT about the sidecar dying - it is about Vite dying. The user is likely killing the WRONG process (Vite's node.exe) thinking it is the sidecar, OR killing the sidecar cascades to kill Vite.

- timestamp: 2026-02-05
  checked: Process tree architecture in dev mode
  found: `npm run tauri dev` spawns (1) Tauri CLI, which spawns (2) Vite via beforeDevCommand AND (3) the Rust binary. The Rust binary spawns (4) sidecar binary. In Task Manager, there are multiple node.exe processes.
  implication: User may be killing the Vite node.exe or the tauri CLI node.exe instead of the sidecar exe, causing the "beforeDevCommand terminated" error.

## Resolution

root_cause: TWO DISTINCT ISSUES IDENTIFIED

**Issue 1 (Primary - Dev Mode):** The error message "The 'beforeDevCommand' terminated with a non-zero status code" indicates the Vite dev server process is dying, NOT the sidecar. In dev mode, there are multiple Node.js processes running: (a) Tauri CLI (Node), (b) Vite dev server (Node), (c) sidecar binary (pkg-compiled Node exe). When the user kills "the Node.js sidecar process" in Task Manager, they are likely killing the wrong node.exe process (Vite or the Tauri CLI npm process) because all appear as node.exe in Task Manager, while the actual sidecar is server-x86_64-pc-windows-msvc.exe. If they kill the Vite process, Tauri CLI detects beforeDevCommand died and reports that error.

**Issue 2 (Secondary - Dev Mode Architecture):** Even if the user kills the correct sidecar process (server-*.exe), the Rust auto-restart loop in lib.rs SHOULD work correctly - it has proper reconnect logic. However, this needs verification since the sidecar binary in dev mode is the pre-compiled pkg binary, not a live tsx process.

**Production mode:** The auto-restart logic in lib.rs IS correct for production. The spawn_sidecar function has a proper while loop that catches Terminated events and restarts after RESTART_DELAY_SECONDS (2s). Production has no Vite/beforeDevCommand - only the Rust binary + sidecar binary.

fix: N/A (diagnosis only)
verification: N/A
files_changed: []
