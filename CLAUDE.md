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