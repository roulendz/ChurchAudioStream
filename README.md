# ChurchAudioStream

Cross-platform desktop app (Tauri 2.x + Node.js sidecar) that captures Dante/AES67 + local audio devices via GStreamer and streams them via WebRTC (mediasoup SFU) to phones over local WiFi. Multilingual sermon translation + hearing-aid assistance for churches.

---

## Architecture (high level)

| Component | Path | Output | Role |
|---|---|---|---|
| Admin UI (React) | `src/` | `dist/` | Tauri webview admin GUI |
| Listener PWA (React) | `listener/` | `sidecar/public/` | Phones load from sidecar HTTPS |
| Sidecar (Node + mediasoup) | `sidecar/src/` | `src-tauri/binaries/server-<triple>.exe` | pkg binary; HTTPS + WS + mediasoup |
| Tauri shell (Rust) | `src-tauri/` | `src-tauri/target/release/` | Spawns sidecar, hosts admin UI |

### Ports
- **1420** — Vite dev (admin UI, dev only)
- **7777** — Sidecar HTTPS (phones → PWA + `/api` + `/ws`)
- **7778** — Admin loopback HTTP (Tauri admin → sidecar internal)
- **mDNS** — phone discovery via `bonjour-service`

---

## Prerequisites (build host AND deployment target)

| Dependency | Version | Notes |
|---|---|---|
| Node.js | 22.x | matches pkg target `node22-win-x64` |
| npm | 10.x | bundled with Node |
| Rust toolchain | stable, MSVC | `rustup default stable-x86_64-pc-windows-msvc` |
| Visual Studio Build Tools | 2022 | C++ workload + Windows SDK |
| WebView2 Runtime | latest | preinstalled on Win10 22H2+ |
| **GStreamer 1.26 runtime** | MSVC 64-bit | **runtime** installer, "Complete" install |

### GStreamer install (mandatory — NOT bundled in MSI)

1. Download: https://gstreamer.freedesktop.org/download/ → MSVC 64-bit **runtime**
2. Run installer → choose **Complete** install (need `level`, `audioconvert`, `opusenc`, `rtpopuspay`, ASIO/WASAPI plugins)
3. Add `C:\gstreamer\1.0\msvc_x86_64\bin` to system PATH
4. Reboot
5. Verify: `gst-launch-1.0.exe --version`

### Windows PATH gotcha (build host)

`cargo`/`rustc` not on default PATH for non-login bash sessions. Prefix all Rust/Tauri commands with:
```bash
export PATH="$USERPROFILE/.cargo/bin:$PATH"
```

---

## Build (one-shot, all artifacts)

From repo root on Windows (bash shell):

```bash
# 1. Install dependencies (first time only)
npm install
cd listener && npm install && cd ..
cd sidecar && npm install && cd ..

# 2. Make cargo visible
export PATH="$USERPROFILE/.cargo/bin:$PATH"

# 3. Build production installers
npm run tauri build
```

Step 3 auto-runs `beforeBuildCommand: npm run build:bundle-deps` which chains:
- `npm run build:listener` → listener PWA → `sidecar/public/`
- `npm run build:sidecar` → pkg binary → `src-tauri/binaries/server-<triple>.exe` + copies `mediasoup-worker.exe`
- `npm run build` → admin UI → `dist/`

Then Tauri compiles the Rust shell (release profile) and produces installers.

### Outputs

```
src-tauri/target/release/bundle/
├── msi/ChurchAudioStream_0.1.0_x64_en-US.msi      (~34 MB)
└── nsis/ChurchAudioStream_0.1.0_x64-setup.exe     (~23 MB)
```

Either installer works. NSIS is smaller and more flexible; MSI is preferred for AD-managed deployments.

### Per-step build (for debugging / partial rebuilds)

| Need to rebuild | Command | Triggers |
|---|---|---|
| Listener PWA only | `npm run build:listener` | `listener/src/**`, `listener/vite.config.ts` |
| Sidecar only | `npm run build:sidecar` | `sidecar/src/**`, `sidecar/build.ts` |
| Admin UI only | `npm run build` | `src/**`, root `vite.config.ts` |
| All bundle deps | `npm run build:bundle-deps` | before `tauri build` |
| Full installer | `npm run tauri build` | release MSI + NSIS |

---

## Deploy on target Windows 10/11 PC

1. **Install GStreamer 1.26 runtime** on target (see Prerequisites). Reboot.
2. Copy `ChurchAudioStream_0.1.0_x64_en-US.msi` (or `-setup.exe`) to target.
3. Double-click installer → defaults install to `C:\Program Files\ChurchAudioStream\`.
4. First launch:
   - Generates Root CA + server TLS cert in `%APPDATA%\com.churchaudiostream.app\`
   - Windows Firewall prompt → allow **Private network** (port 7777, mDNS)
5. Phones on same WiFi: open `https://<host-ip>:7777` in mobile browser. Self-signed warning → accept once. PWA installs.

### What the installer ships (next to `churchaudiostream.exe`)

```
churchaudiostream.exe              ← Tauri host (admin UI)
server.exe                         ← sidecar (renamed from server-<triple>.exe)
binaries/mediasoup-worker.exe      ← native WebRTC SFU worker
public/                            ← listener PWA static files
  ├── index.html
  ├── assets/
  ├── manifest.webmanifest
  ├── sw.js
  └── workbox-*.js
icons/, resources/, etc.
```

### Pre-launch checklist on target

1. GStreamer on PATH: `gst-launch-1.0.exe --version` succeeds
2. Audio I/O configured: Dante Virtual Soundcard (license) OR USB mic / line-in
3. Firewall allows app on private network
4. Same WiFi subnet as listener phones

---

## Verify the app is live (after install or after `tauri dev`)

7 signals — all must be green:

1. Vite ready (dev only): `Local: http://localhost:1420/`
2. Rust compiled: `Finished dev [unoptimized + debuginfo] target(s)`
3. Sidecar HTTPS listening: `Server listening on https://0.0.0.0:7777`
4. Admin loopback: `Admin loopback listening on http://127.0.0.1:7778`
5. `server-x86_64-pc-windows-msvc.exe` (or `server.exe` in install) process running
6. `mediasoup-worker.exe` child process running
7. Tauri window: `churchaudiostream.exe` parent + `msedgewebview2.exe` child

### Process check (PowerShell)

```powershell
Get-Process server-x86_64-pc-windows-msvc,server,mediasoup-worker,gst-launch-1.0,churchaudiostream,msedgewebview2 -ErrorAction SilentlyContinue | Select Name,Id,StartTime
```

### Port check (PowerShell)

```powershell
Get-NetTCPConnection -LocalPort 1420,7777,7778 -State Listen -ErrorAction SilentlyContinue | Select LocalPort,OwningProcess
```

---

## Development workflow

```bash
# Terminal 1 — listener PWA hot rebuild (only if editing listener/src/**)
cd listener && npm run build  # rerun after each change; sidecar serves static

# Terminal 2 — full app dev
export PATH="$USERPROFILE/.cargo/bin:$PATH"
npm run tauri dev
```

`tauri dev`:
- Auto-runs `npm run dev` (Vite admin UI on :1420)
- Spawns sidecar from `src-tauri/binaries/server-<triple>.exe`
- Compiles + watches Rust shell

### Rebuild matrix

| Change in… | Command | Restart `tauri dev`? |
|---|---|---|
| `src/**` (admin) | nothing — Vite HMR | no |
| `listener/src/**` | `cd listener && npm run build` | no — hard-refresh phone |
| `sidecar/src/**` | `cd sidecar && npm run build` + full restart | **yes** |
| `src-tauri/src/**` (Rust) | nothing — auto-recompile | no |
| `tauri.conf.json` / `Cargo.toml` / root `vite.config.ts` | — | **yes** |

### Stale sidecar trap

`tauri dev` does **not** respawn the sidecar when its source rebuilds. After `cd sidecar && npm run build`, kill the whole tree and relaunch:

```powershell
Get-Process churchaudiostream,server-x86_64-pc-windows-msvc,server-x86_64-pc-windows-gnu,mediasoup-worker,gst-launch-1.0,msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force
```

```bash
rm -f src-tauri/target/debug/server-x86_64-pc-windows-msvc.exe \
      src-tauri/target/debug/binaries/server-x86_64-pc-windows-msvc.exe \
      src-tauri/target/debug/binaries/mediasoup-worker.exe
cd sidecar && npm run build && cd ..
export PATH="$USERPROFILE/.cargo/bin:$PATH"
npm run tauri dev
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `error: cargo: command not found` (exit 127) | PATH not exported | `export PATH="$USERPROFILE/.cargo/bin:$PATH"` |
| `mediasoup-worker.exe ENOENT` on launch | sidecar not built | `cd sidecar && npm run build` |
| Phone gets 404 / blank PWA | listener not built | `cd listener && npm run build` |
| `Couldn't find a .ico icon` at bundle time | `bundle.icon` empty | already fixed: `"icon": ["icons/icon.ico"]` |
| Sidecar logs show old strings after rebuild | stale sidecar trap | full kill + cache wipe + relaunch (above) |
| GStreamer plugin missing on target | partial GStreamer install | reinstall with **Complete** option |
| Phones can't reach :7777 | firewall blocked | allow `churchaudiostream.exe` on Private network |

---

## Key configuration files

- `src-tauri/tauri.conf.json` — bundle resources, externalBin, CSP, before-build chain
- `src-tauri/Cargo.toml` — Rust dependencies for shell
- `package.json` — root scripts (`build:listener`, `build:sidecar`, `build:bundle-deps`, `tauri`)
- `sidecar/build.ts` — pkg binary build + mediasoup-worker copy
- `listener/vite.config.ts` — PWA build, `outDir: ../sidecar/public`

---

## License / decisions

- Tauri 2.x + Node sidecar over Electron: 150–250 MB RAM vs 400–600 MB. mediasoup requires Node, so sidecar is needed regardless.
- Both Dante/AES67 and local audio device input (broadens audience beyond Dante-only churches).
- v1: no RNNoise/EQ; Speech/Music mode + AGC only. No church branding. No listener auth (open access).
