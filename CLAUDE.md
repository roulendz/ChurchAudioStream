# ChurchAudioStream - Project Rules

## Coding Standards

1. **DRY** (Don't Repeat Yourself) — Extract shared logic into reusable functions/modules
2. **SRP** (Single Responsibility Principle) — Each function/module/class does one thing
3. **Self-explanatory naming** — Variables, functions, classes, and files must have descriptive names that convey intent without needing comments
   - Bad: `d`, `tmp`, `data`, `handleIt`, `processStuff`
   - Good: `heartbeatIntervalMs`, `configFilePath`, `broadcastToAdminClients`, `parseLogLevel`
4. Each functions tested so we know where bugs can come in
5. We use Tiger-Style or TigerBeatle style we fail fast and fail hard! 
6. no spageti code, no nested if in ifs in if. Clean redable understandable code flow!

## How to Run Commands (Windows + bash shell)

**PATH gotcha**: cargo/rustc not on default PATH. Prefix Tauri/Rust commands with:
```bash
export PATH="$USERPROFILE/.cargo/bin:$PATH"
```

**Frontend (root `package.json`)**
- `npm run dev` — Vite dev server (port from `vite.config.ts`)
- `npm run build` — `tsc -b && vite build` (typecheck + bundle)
- `npm run preview` — preview built bundle
- `npm run build:sidecar` — proxies to `sidecar/npm run build`

**Sidecar (`sidecar/package.json`)** — run from `sidecar/`
- `npm run dev` — `tsx src/index.ts` (hot reload via tsx)
- `npm run build` — `tsx build.ts` (produces pkg binary for Tauri to spawn)

**Tauri (Rust shell)** — needs cargo on PATH (see prefix above)
- `npm run tauri dev` — full app: Vite + sidecar + Tauri window
- `npm run tauri build` — release bundle (.exe/.msi)
- Background long runs with `run_in_background: true` (Tauri dev never exits)

**Common pitfalls**
- Forget PATH export → `error: cargo: command not found` (exit 127)
- Run `tauri dev` without sidecar built first → mediasoup-worker.exe ENOENT
- `child.kill('SIGTERM')` on Windows = instant TerminateProcess (no GStreamer EOS) — use stdin close + force-kill

## Talking to Agents

**Always pass caveman mode instruction in agent prompts** to save tokens. Example:
> "Use caveman mode (full intensity) for all output. Drop articles, filler, hedging. Fragments OK. Code blocks unchanged."

Applies to: `Agent` tool spawns, `Task` skill calls, all GSD subagents (researcher, planner, executor, verifier, etc.). Code/file paths/identifiers stay exact — only prose compresses.

## Manual Test — Build & Verify App is Live

### Three frontend apps + one sidecar

| App | Path | Output | Purpose |
|---|---|---|---|
| Admin UI | `src/` (root) | `dist/` | Tauri webview admin GUI |
| Listener PWA | `listener/` | `sidecar/public/` (cross-project!) | Phones load this from sidecar HTTPS |
| Sidecar | `sidecar/src/` | `src-tauri/binaries/server-<triple>.exe` | Node pkg bundle, mediasoup + Express + WS |
| Tauri shell | `src-tauri/` | `src-tauri/target/` | Rust host process, spawns sidecar |

### Ports

- **1420** — Vite dev (admin UI, Tauri `devUrl`)
- **7777** — Sidecar HTTPS (phones connect here, serves listener PWA + `/api` + `/ws`)
- **7778** — Admin loopback HTTP (`ADMIN_LOOPBACK_PORT`, internal admin → sidecar)
- **mDNS** — phone discovery via `bonjour-service`

### Build order (cold start)

```bash
cd listener && npm install && npm run build        # 1. PWA → sidecar/public/
cd ../sidecar && npm install && npm run build      # 2. pkg → src-tauri/binaries/
cd .. && npm install                               # 3. root deps
export PATH="$USERPROFILE/.cargo/bin:$PATH"
npm run tauri dev                                  # 4. Vite + sidecar spawn + Tauri window
```

`npm run tauri dev` triggers `beforeDevCommand: npm run dev` (root Vite) automatically. Rust auto-compiles `src-tauri/src/**` on save.

### Files that trigger a rebuild

| Change in… | Rebuild | Restart Tauri dev? |
|---|---|---|
| `src/**` (admin React) | Vite HMR auto-refresh | No |
| `listener/src/**` (PWA) | `cd listener && npm run build` | No (sidecar serves static) — hard refresh phone |
| `listener/vite.config.ts` (PWA build) | `cd listener && npm run build` | No |
| `sidecar/src/**` | `cd sidecar && npm run build` | **Yes** |
| `sidecar/build.ts` | `cd sidecar && npm run build` | **Yes** |
| `src-tauri/src/**` (Rust) | Auto via `tauri dev` | No |
| `src-tauri/tauri.conf.json` | — | **Yes** |
| `src-tauri/Cargo.toml` | — | **Yes** |
| `vite.config.ts` (root) | — | **Yes** |
| `package.json` / `sidecar/package.json` deps | `npm install` + relevant build | **Yes** |
| `listener/package.json` deps | `cd listener && npm install && npm run build` | No |

### Verify app is live — 7 signals

1. Vite ready: `Local: http://localhost:1420/`
2. Rust compiled: `Finished dev [unoptimized + debuginfo] target(s) in 17.38s, 391/391`
3. Sidecar HTTPS listening: `Server listening on https://0.0.0.0:7777`
4. Admin loopback: `Admin loopback listening on http://127.0.0.1:7778`
5. Sidecar `server-x86_64-pc-windows-msvc.exe` (or `-gnu.exe`) process — PID example 47912
6. `mediasoup-worker.exe` child process — PID example 42476
7. Tauri window: `churchaudiostream.exe` parent + `msedgewebview2.exe` child — PID example 49480
8. Bonus: `gst-launch-1.0.exe` running per active channel from saved config

### Process check (PowerShell)

```powershell
Get-Process server-x86_64-pc-windows-msvc,server-x86_64-pc-windows-gnu,mediasoup-worker,gst-launch-1.0,churchaudiostream,msedgewebview2,node -ErrorAction SilentlyContinue | Select Name,Id,StartTime
```

### Port check (PowerShell)

```powershell
Get-NetTCPConnection -LocalPort 1420,7777,7778 -State Listen -ErrorAction SilentlyContinue | Select LocalPort,OwningProcess
```

### AGENT RULE — Never make the user run commands

**Agent runs every command itself via Bash/PowerShell tool.** Do not paste commands and tell user to run them. Do not say "run X then test". Do not delegate kill/build/launch/cleanup steps to the user. The user's job is: describe what to test, then click in the running app. The agent's job is: get the app into a tested-ready state without asking.

If user must do something only they can do (open a phone browser, plug in a hardware mic, click a button in the GUI) — say so explicitly and only that. Everything else: just do it.

Violations to avoid:
- "Now run `Stop-Process …` then `npm run tauri dev`" → WRONG. Run them yourself.
- "If logs show X, run `rm -f …`" → WRONG. Check logs yourself, run cleanup yourself.
- "Sorry for wasted time, you should have run mtime check" → WRONG. Agent should have run the mtime check before claiming "live".

### CRITICAL: Stale sidecar binary trap

**Tauri dev does NOT respawn the sidecar when its source is rebuilt.** It copies `src-tauri/binaries/server-<triple>.exe` to `src-tauri/target/debug/binaries/` ONCE at startup and keeps that process alive across all Vite/Rust HMR reloads.

**Consequence**: after `cd sidecar && npm run build`, the running `server-*.exe` is the OLD binary. Logs/behavior come from deleted code. Test will lie. Trusting "the rebuild took effect" without verification = wasted UAT cycle.

**Symptom-recognition cheat-sheet** (any one = STALE binary, agent runs full restart immediately, does not blame fix):

- Log line contains a string the agent JUST removed from `sidecar/src` in the current commit chain. Quick check: grep the log message against current source — zero matches → stale.
- Real examples from this project: `Killed orphan process X bound to sender port` (function deleted), `startPipelineForSource: existing pipeline found` (method removed), `File source reached EOS, scheduling loop restart` (logic relocated).
- User reports identical UAT failure to one the agent JUST claimed fixed in a committed + built change.
- User reports "I have no sources but I hear audio" — running gst-launch from a previous lifecycle the new code wouldn't produce.

**Mandatory freshness gate before reporting "app is live"** — agent runs both checks:

```powershell
Get-Process server-x86_64-pc-windows-msvc,server-x86_64-pc-windows-gnu -ErrorAction SilentlyContinue | Select Name,Id,StartTime
Get-Item src-tauri\binaries\server-x86_64-pc-windows-msvc.exe,src-tauri\target\debug\binaries\server-x86_64-pc-windows-msvc.exe -ErrorAction SilentlyContinue | Select FullName,LastWriteTime
```

If process `StartTime < binary LastWriteTime` → STALE. Agent must do the full restart sequence below before claiming "ready to test".

### Full restart sequence (agent runs all of this — do not paste to user)

```powershell
# 1. Kill the whole tree (Tauri parent + both sidecar triples + mediasoup-worker + orphan gst-launch + WebView2)
Get-Process churchaudiostream,server-x86_64-pc-windows-msvc,server-x86_64-pc-windows-gnu,mediasoup-worker,gst-launch-1.0,msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Confirm all gone (output must be empty)
Get-Process churchaudiostream,server-x86_64-pc-windows-msvc,server-x86_64-pc-windows-gnu,mediasoup-worker,gst-launch-1.0 -ErrorAction SilentlyContinue
```

```bash
# 3. Invalidate Tauri's cached sidecar copy (Tauri sometimes won't re-copy if mtime confused)
rm -f src-tauri/target/debug/server-x86_64-pc-windows-msvc.exe \
      src-tauri/target/debug/server-x86_64-pc-windows-gnu.exe \
      src-tauri/target/debug/binaries/server-x86_64-pc-windows-msvc.exe \
      src-tauri/target/debug/binaries/server-x86_64-pc-windows-gnu.exe \
      src-tauri/target/debug/binaries/mediasoup-worker.exe

# 4. Rebuild sidecar (only if sidecar/src or listener changed — skip otherwise)
cd sidecar && npm run build && cd ..

# 5. Relaunch — Tauri dev runs in background, never exits
export PATH="$USERPROFILE/.cargo/bin:$PATH"
# Use Bash tool with run_in_background: true
npm run tauri dev
```

### Restart decision matrix

| Change | Agent action |
|---|---|
| Admin UI `src/**` | Nothing — Vite HMR auto-refreshes |
| Listener `listener/src/**` | `cd listener && npm run build` (no Tauri restart) — tell user to hard-refresh phone |
| `sidecar/src/**` | **Full kill + cache wipe + rebuild + relaunch** (steps 1-5 above) |
| Rust `src-tauri/src/**` | Nothing — `tauri dev` auto-recompiles |
| `tauri.conf.json` / `Cargo.toml` / root `vite.config.ts` | Full kill + relaunch (skip rebuild step 4) |

### Don't relaunch if not needed

Pure admin-UI or Rust change: agent skips restart. Vite HMR + Rust hot-recompile handle them. Restart cycle = 15-20s Rust recompile + 5-10s Vite + sidecar spawn, and breaks active phone WebRTC sessions.

### Pre-UAT checklist (agent runs before saying "ready to test")

1. Sidecar binary mtime > sidecar process StartTime (freshness gate)
2. Ports 1420 + 7777 + 7778 listening
3. Tauri window process alive (`churchaudiostream.exe` + child `msedgewebview2.exe`)
4. mediasoup-worker.exe alive
5. Most recent sidecar log shows current startup banner with current timestamp
6. No orphan processes from previous run

If any item fails → agent fixes it (kill/rebuild/relaunch) and rechecks. Only then say "ready, please test X".

### Common pitfalls

- Forget PATH export → `error: cargo: command not found` (exit 127)
- Run `tauri dev` without sidecar built first → mediasoup-worker.exe ENOENT
- Run `tauri dev` without listener built → phones get 404 / blank PWA
- **Test sidecar change without killing Tauri → testing OLD binary, results are lies** (see Stale sidecar binary trap)
- **Tell user "run X then test" instead of doing X yourself → violates Agent Rule**
- `child.kill('SIGTERM')` on Windows = instant TerminateProcess (no GStreamer EOS) — use stdin close + force-kill
- Two server binaries in `src-tauri/binaries/` (`-msvc` + `-gnu`) — Tauri picks per host triple, both must exist if switching toolchains
- Orphan `gst-launch-1.0.exe` survives Tauri kill → include in Stop-Process tree
- `target/debug/` cached sidecar copies may not refresh from `binaries/` — wipe them when in doubt