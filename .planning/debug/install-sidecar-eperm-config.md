---
slug: install-sidecar-eperm-config
status: fix_applied_pending_rebuild
trigger: "Installed Tauri app on fresh Win10 PC: sidecar fatal startup loop — Fatal startup error: EPERM: operation not permitted, open 'C:\\Program Files\\ChurchAudioStream\\config.json'"
created: 2026-04-30
updated: 2026-04-30
---

# Debug: installed sidecar EPERM on config.json (Program Files write blocked)

## Symptoms

<!-- DATA_START -->
- target host: LIVESTREAM-PC, Win10 Pro 19045, pwsh 7.5.5, ChurchAudioStream installed at C:\Program Files\ChurchAudioStream
- triage shows churchaudiostream.exe + msedgewebview2 children running but ports 1420/7777/7778 NOT listening — sidecar dies before HTTP listen
- log loop every ~3s:
  - info: Using mediasoup worker found at: C:\Program Files\ChurchAudioStream\binaries\mediasoup-worker.exe
  - info: ChurchAudioStream sidecar starting
  - warn: Cannot read config file, using defaults
  - fatal: Fatal startup error: EPERM: operation not permitted, open 'C:\Program Files\ChurchAudioStream\config.json'
  - error: Failed to start sidecar
- triage-confirmed working pieces: GStreamer 1.28.2 + critical plugins OK, WebView2 147.x present, firewall rule allow inbound, mediasoup-worker.exe present, audio devices visible
<!-- DATA_END -->

## Current Focus

- hypothesis: Tauri Rust shell at src-tauri/src/lib.rs:77 spawns sidecar with `--config-path "."`. In installed mode, child process inherits CWD = install dir (`C:\Program Files\ChurchAudioStream`). Sidecar resolves base path via `path.resolve(".")` -> Program Files dir. UAC blocks non-admin write -> first `save(defaultConfig)` (called from `load()` catch path when config.json absent) hits EPERM -> caught by global startup error handler -> "Failed to start sidecar" -> Tauri restart loop.
- test: confirmed by source inspection — `sidecar/src/index.ts:12-18` `resolveBasePath()` returns `path.resolve(argv "--config-path")` else `path.dirname(process.execPath)`. Tauri passes "." so first branch wins. Resolves relative to CWD which for installed Windows app = exe dir = Program Files.
- expecting: with `--config-path` rewritten to Tauri `app_data_dir()` (e.g. `C:\Users\lives\AppData\Local\com.churchaudiostream.app\`), sidecar can read+write config.json, reach HTTPS listen, ports 7777+7778 open.
- next_action: locked. Apply fix to src-tauri/src/lib.rs to pass `app.path().app_data_dir()` as --config-path; rebuild release MSI; verify on target via triage re-run.

## Evidence

- timestamp: 2026-04-30
  - confirmed: `src-tauri/src/lib.rs:76-77` — `// Pass --config-path pointing to the resource directory next to the executable` + `args(["--config-path", "."])`. The intent comment ("next to the executable") matches dev-mode reality but breaks installer reality (next-to-exe = Program Files = unwritable).
  - confirmed: `sidecar/src/index.ts:12-18` `resolveBasePath()` — when `--config-path` arg present, uses it via `path.resolve()`. With "." passed, resolves to CWD.
  - confirmed: `sidecar/src/config/store.ts:46` joins basePath + "config.json" -> `C:\Program Files\ChurchAudioStream\config.json`.
  - confirmed: `sidecar/src/config/store.ts:50-78` `load()` catches read failure, logs warn "Cannot read config file, using defaults", then calls `this.save(defaultConfig)` (line 76). save() at line 109-119 does `fs.writeFileSync(configFilePath, ...)` -> EPERM in Program Files.
  - confirmed: this.save called *unconditionally* on any load failure (missing file, parse error, schema invalid). Fresh install = no config.json = always hits this path.
  - confirmed (cascade): `audio-subsystem.ts:56` SourceRegistry rooted at basePath -> discovered-sources.json same dir. `audio-subsystem.ts:67` EventLogger -> basePath/logs/channels/. `network/certificate.ts:36-37` cert+key paths joined to basePath. ALL would EPERM if config didn't crash first.
  - signature: classic Windows install-dir-as-user-data anti-pattern. Standard Windows app guideline (since Vista) = Program Files is read-only for non-admin; user-writable data goes in %APPDATA% or %LOCALAPPDATA%. Tauri provides `app_data_dir()` / `app_local_data_dir()` for this.

## Eliminated

- not GStreamer issue — gst-launch-1.0 1.28.2 reachable, plugins OK, devices enumerated.
- not WebView2 issue — 147.0.3912.86 present, churchaudiostream.exe + msedgewebview2 spawn fine.
- not firewall — rule present, but irrelevant since sidecar never opens port to be blocked.
- not mediasoup-worker.exe ENOENT — log shows `Using mediasoup worker found at: ...binaries\mediasoup-worker.exe`, that branch passes.
- not config.json schema invalid — file does not exist (fresh install). Path is `Cannot read config file` (ENOENT-type, caught) -> save default -> EPERM on save.
- not "wrong basePath argv parsing" — argv["--config-path", "."] correctly received; resolution behaves as documented; the value passed is the bug.
- not user permission anomaly — user has standard Win10 perms; Program Files is universally non-writable for non-admin since Vista.

## Resolution

- root_cause: Tauri shell passes `--config-path "."` to sidecar. In installed mode, CWD inherits to the exe's install directory `C:\Program Files\ChurchAudioStream\`. UAC blocks non-admin write to Program Files. Sidecar's first-run path tries to materialize `config.json` (defaults) and EPERMs. Caught by global startup handler -> sidecar exits -> Tauri restart loop. Five other on-disk artifacts (discovered-sources.json, logs/channels/, cert+key, CA cert+key, test-media/) sit on the same broken basePath.
- fix: rewrite the Rust spawn to pass the Tauri-provided per-user data directory.
  - File: `src-tauri/src/lib.rs`, function `spawn_sidecar`, at the args injection (around L77).
  - Replace `args(["--config-path", "."])` with logic that resolves `app_handle.path().app_data_dir()` and converts it to a string path. On Windows that gives `C:\Users\<user>\AppData\Roaming\com.churchaudiostream.app\` (writable by current user, persistent, OS-blessed). Create the directory if absent before spawn (`std::fs::create_dir_all`).
  - Sidecar code in `sidecar/src/index.ts` already accepts `--config-path` correctly; no change needed there.
  - The cascade (sources, logs, cert, test-media) auto-fixes because they're all rooted at the same basePath.
- verification (post-fix):
  1. Cargo build release; rebuild installer MSI/EXE.
  2. Install on a fresh-state Windows account.
  3. Run `triage.ps1`; expect ports 7777 + 7778 LISTENING.
  4. Inspect `%APPDATA%\com.churchaudiostream.app\config.json` — created with defaults.
  5. App opens, no "Failed to start sidecar" error, audio devices populate.
- files_changed: src-tauri/src/lib.rs (only). No sidecar TS change needed.
