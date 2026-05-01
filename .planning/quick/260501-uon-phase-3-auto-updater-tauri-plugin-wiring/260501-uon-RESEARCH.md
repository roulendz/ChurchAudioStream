# Phase 3 Auto-Updater Tauri Plugin Wiring - Research

**Researched:** 2026-05-01
**Domain:** Tauri 2.x updater plugin runtime wiring (Rust + IPC + bg task)
**Confidence:** HIGH (Rust API verified against docs.rs, npm + crates.io versions verified live, capability set verified against plugins-workspace permissions/default.toml)

## Summary

Phase 3 wires Phase 1+2 pure-logic surface into Tauri 2.x runtime. All decisions in CONTEXT.md hold up against current upstream docs. Plugin versions confirmed live: `tauri-plugin-updater = "2.10.1"`, `tauri-plugin-process = "2.3.1"`, `@tauri-apps/plugin-updater@2.10.1`, `@tauri-apps/plugin-process@2.3.1` — caret `^2` in CONTEXT decision is correct.

Critical findings:
- Plugin handles signature + HTTPS validation internally [VERIFIED: docs.rs Error variants `InsecureTransportProtocol`, `Minisign`]. Phase 2 `evaluate_update` retains exclusive ownership of skip + dismiss-cooldown logic.
- `Update.download_and_install` callback signatures locked: `C: FnMut(usize, Option<u64>)` + `D: FnOnce()` — NOT `(downloaded, total)`; first arg is per-chunk delta, second is total.
- `tauri.conf.json` install-mode key for Windows is `windows.installMode` with values `"passive"` / `"basicUi"` / `"quiet"`. Default `"passive"` (progress bar visible). Document for Phase 5.
- Plugin does NOT auto-restart. Must call `app.restart()` (core Tauri AppHandle method) OR `relaunch()` from `@tauri-apps/plugin-process` JS. CONTEXT decision (post-install plugin handles restart) is WRONG — must explicitly call.
- Capability `"updater:default"` required in `capabilities/default.json`, else IPC commands fail. `"process:default"` likewise required to call `relaunch()` from JS.

**Primary recommendation:** Implement per CONTEXT decisions with three corrections: (1) add explicit `app_handle.restart()` after `download_and_install`, (2) add `updater:default` + `process:default` permissions to `capabilities/default.json`, (3) use `log` crate (already pulled in by Tauri) for bg task warnings — NOT `eprintln!`, NOT new dep.

## User Constraints (from CONTEXT.md)

### Locked Decisions
- `#[tauri::command]` returns `Result<T, String>` — internal `UpdateError` typed, converted at boundary via `.map_err(|e| e.to_string())`.
- `UpdateStateGuard { state_path: PathBuf, state: Arc<Mutex<UpdateState>> }` — `std::sync::Mutex` (NOT tokio).
- `lifecycle::start(&AppHandle) -> Result<(), UpdateError>` resolves app_data_dir, creates dir, loads state, calls `manage()`, then `tokio::spawn`s the loop.
- Bg task: 6-hour cooldown with `CAS_UPDATER_FORCE_CHECK=1` env override, no retry on fetch error, fail-soft.
- `update_install` re-fetches via `updater()?.check().await?` instead of caching the `Update` struct.
- `update_dismiss` / `update_skip_version` / `update_get_state` are stateless on the wire.
- New module `errors.rs` with `UpdateError` enum covering Parse/Manifest/Storage/UpdaterPlugin/Json/Io/AppDataPath/MissingPlatform variants. Hand-rolled `Display` + `From<...>`.
- `[features] integration = []` in Cargo.toml — empty flag.
- Integration tests in `src-tauri/src/update/tests_integration.rs` gated by `#[cfg(feature = "integration")]`.
- Versions: `tauri-plugin-updater = "2"` + `tauri-plugin-process = "2"` (caret `^2`).
- NO `thiserror` / `anyhow` / `chrono` / `time` / `tokio::sync::Mutex` deps added.

### Claude's Discretion
- `current_platform_key()` uses `cfg!` macros (compile-time).
- `update_install` waits for `download_and_install` to complete before returning `Ok(())`.
- Worktree compile may need stub binaries (Phase 1+2 trick).

### Deferred Ideas (OUT OF SCOPE)
- React UI (Phase 4).
- GitHub Actions `latest.json` workflow (Phase 5).
- Generating actual signing keypair (user-driven).
- `npm run tauri build` verification (blocked on real pubkey).
- Modifying Phase 1/2 modules.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| P3-DEPS | Add tauri-plugin-updater + tauri-plugin-process Rust + JS deps | Section 1, 2, 10 — versions verified |
| P3-CONF | tauri.conf.json plugins.updater block | Section 3 — schema verified |
| P3-CMD | 5 #[tauri::command] async fns | Section 4, 5 — State + Result<T,String> patterns |
| P3-LIFE | Bg task lifecycle::start | Section 6 — spawn_sidecar mirror confirmed |
| P3-CAP | capabilities/default.json updater + process permissions | Section 11 — plugins-workspace permissions verified |
| P3-ERR | UpdateError enum module | Section 1 — tauri_plugin_updater::Error 29 variants documented |
| P3-INT | [features] integration block + 4 integration tests | Section 8 — cfg pattern verified |

## 1. tauri-plugin-updater 2.x API surface

`[VERIFIED: docs.rs/tauri-plugin-updater/2.10.1]`

### Plugin builder + registration

```rust
use tauri_plugin_updater::UpdaterExt;

tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
```

`Builder::new()` reads config from `tauri.conf.json` `plugins.updater`. No required setters when config is in conf.json. `build()` returns `TauriPlugin<...>`.

### `UpdaterExt` trait — extends AppHandle

```rust
use tauri_plugin_updater::UpdaterExt;
let updater = app_handle.updater()?;          // returns Result<Updater>
let maybe_update = updater.check().await?;    // returns Result<Option<Update>>
```

`updater()` returns `Result<Updater, tauri_plugin_updater::Error>`. Method exists on `App`, `AppHandle`, `WebviewWindow`, `Webview`, `Window`.

### `Update` struct fields (exact)

```rust
pub struct Update {
    pub body: Option<String>,           // release notes (was Option per docs.rs)
    pub current_version: String,
    pub version: String,                // SemVer
    pub date: Option<OffsetDateTime>,   // RFC 3339
    pub target: String,                 // platform key e.g. "windows-x86_64"
    pub download_url: Url,
    pub signature: String,
    pub raw_json: Value,
    pub timeout: Option<Duration>,
    pub proxy: Option<Url>,
    pub no_proxy: bool,
    pub headers: HeaderMap,
}
```

Note: `body: Option<String>` — frontend `UpdateAvailablePayload.notes: String` (Phase 2 dispatcher) requires `.unwrap_or_default()` at the wire boundary.

### `Update::download_and_install` (CRITICAL signature)

```rust
pub async fn download_and_install<C: FnMut(usize, Option<u64>), D: FnOnce()>(
    &self,
    on_chunk: C,
    on_download_finish: D,
) -> Result<()>
```

`on_chunk(chunk_length: usize, content_length: Option<u64>)`:
- `chunk_length` = bytes in THIS chunk (delta), NOT cumulative.
- `content_length` = total file size if known via `Content-Length` header.
- Caller MUST track running sum themselves.

`on_download_finish()` = no args. Fires when download completes, BEFORE install starts.

Implementation hint for `update_install`:
```rust
let mut downloaded: u64 = 0;
update.download_and_install(
    |chunk_len, total_len| {
        downloaded += chunk_len as u64;
        let _ = app_handle.emit("update:download:progress", &UpdateDownloadProgressPayload {
            downloaded_bytes: downloaded,
            total_bytes: total_len.unwrap_or(0),
        });
    },
    || { /* download finished */ },
).await?;
let _ = app_handle.emit("update:installed", &UpdateInstalledPayload { version: update.version.clone() });
```

### Plugin internal validation behavior

`[VERIFIED: docs.rs Error variants]` — plugin handles all of:
- HTTPS enforcement via `Error::InsecureTransportProtocol` (override only via `dangerousInsecureTransportProtocol: true` in conf — NOT for production).
- Signature verification via `Error::Minisign` (mandatory, "cannot be disabled" per Tauri docs).
- Manifest version parsing via `Error::Semver`.
- Platform asset lookup via `Error::TargetNotFound(String)` / `Error::TargetsNotFound(Vec<String>)`.

**Implication for our `manifest::validate()`:** plugin's `check()` already does the same checks. Our `evaluate_update` still runs because it owns: skip-list, dismiss-cooldown, our `is_newer` semantics. Manifest is built FROM the `Update` struct — we never deserialize raw `latest.json` ourselves in Phase 3.

### `tauri_plugin_updater::Error` variants (29 total)

Variants we plausibly hit at runtime in bg task or `update_install`:
- `EmptyEndpoints` — config error, panic-equivalent
- `Io(std::io::Error)`
- `Semver(semver::Error)`
- `Serialization(serde_json::Error)`
- `ReleaseNotFound`
- `UnsupportedArch` / `UnsupportedOs`
- `UrlParse(url::ParseError)`
- `Reqwest(reqwest::Error)` — most common transient
- `TargetNotFound(String)` / `TargetsNotFound(Vec<String>)`
- `Network(String)` — download failure
- `Minisign(minisign_verify::Error)` — signature mismatch
- `InsecureTransportProtocol`
- `Tauri(tauri::Error)`

`UpdateError::UpdaterPlugin(tauri_plugin_updater::Error)` wraps the whole enum via single `From` impl. No variant-by-variant wrapping needed.

## 2. tauri-plugin-process 2.x + restart flow

`[VERIFIED: v2.tauri.app/plugin/process + plugins-workspace permissions/default.toml]`

### Registration

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_process::init())
```

### CRITICAL: Plugin does NOT auto-restart after install

Tauri docs explicit: *"The plugin does **not** automatically restart. You must call `app.restart()`"*.

**`app.restart()` is a CORE Tauri AppHandle method, NOT from plugin-process.**

```rust
// Rust side (preferred — direct, no plugin needed for the call itself):
app_handle.restart();    // never returns; replaces process

// JS side (used by frontend Restart button — needs plugin-process registered):
import { relaunch } from '@tauri-apps/plugin-process';
await relaunch();
```

Per upstream `[CITED: github.com/tauri-apps/tauri-plugin-process/CHANGELOG]` — plugin-process now delegates to `AppHandle::request_restart`. Plugin's role in our stack: provides the JS-side `relaunch()` for the React Restart button (Phase 4).

### CONTEXT correction

CONTEXT line 81: *"Plugin then handles app restart"* — WRONG. Correction:
- `update_install` calls `update.download_and_install(...).await?` THEN emits `update:installed` event THEN frontend shows "Restart now" button THEN frontend calls `relaunch()` from `@tauri-apps/plugin-process`.
- Alternative: `update_install` itself calls `app_handle.restart()` after install — but that gives no UI feedback before restart. Defer to frontend.

### Tauri 2.x known bug

`[CITED: github.com/tauri-apps/tauri/issues/12310]` — `AppHandle::restart` may exit before `RunEvent::Exit` fires. For our app this means the sidecar `on_window_event` cleanup may not run on restart. Mitigation: explicit sidecar kill before calling restart. Out of scope for Phase 3 (tracker for Phase 4 frontend or follow-up hardening).

## 3. tauri.conf.json plugins.updater schema

`[VERIFIED: v2.tauri.app/plugin/updater + plugins-workspace examples]`

### Full schema with all keys

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/roulendz/ChurchAudioStream/releases/latest/download/latest.json"
      ],
      "pubkey": "<base64 minisign public key contents, NOT a path>",
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

Field types:
- `endpoints: string[]` — at least one HTTPS URL. Supports `{{current_version}}`, `{{target}}`, `{{arch}}` template variables (we don't need them for GitHub `latest/download/latest.json`).
- `pubkey: string` — public key CONTENT (raw base64), NOT a file path. Generated by `npx tauri signer generate`.
- `windows.installMode: "passive" | "basicUi" | "quiet"` — Windows-only; controls NSIS installer UX. `"passive"` = progress bar shown, no user interaction (default). `"basicUi"` = full installer wizard. `"quiet"` = silent (admin perms required, NOT recommended for non-admin installs). **For our use case, `"passive"` is the right default**.
- `dialog: boolean` — REMOVED in v2 per CONTEXT decision check. The Tauri 2.x plugin `check()` does NOT show a dialog at all; UI is always app-driven. The CONTEXT-snippeted `"dialog": false` is a NO-OP / legacy v1 artifact and SHOULD be omitted (silently ignored if present, but cleaner to omit).
- `dangerousInsecureTransportProtocol: boolean` — DEV ONLY. Bypasses HTTPS enforcement. Never set in production.

### CRITICAL: `bundle.createUpdaterArtifacts: true`

`[VERIFIED: v2.tauri.app updater guide]` — this key tells `tauri build` to generate the `.sig` minisign signature file alongside the `.exe`/`.msi`. Without it, the GitHub Actions workflow in Phase 5 has nothing to upload to `latest.json`.

**Phase 3 SHOULD set this even though we don't run `tauri build` yet** — sets the bundle correctly for Phase 5 without re-touching conf.

### Recommended Phase 3 conf.json patch

```json
"bundle": {
  "active": true,
  "targets": "all",
  "createUpdaterArtifacts": true,
  ...rest unchanged...
},
"plugins": {
  "shell": {
    "open": false
  },
  "updater": {
    "endpoints": [
      "https://github.com/roulendz/ChurchAudioStream/releases/latest/download/latest.json"
    ],
    "pubkey": "REPLACE_WITH_USER_GENERATED_PUBKEY",
    "windows": {
      "installMode": "passive"
    }
  }
}
```

CONTEXT-suggested `"dialog": false` should be DROPPED (v1 legacy).

## 4. tauri::State managed-state pattern

`[VERIFIED: v2.tauri.app develop/state-management]`

### Registration in `setup`

```rust
tauri::Builder::default()
    .setup(|app| {
        let guard = UpdateStateGuard::new(/* state_path, loaded_state */);
        app.manage(guard);
        Ok(())
    })
```

`Manager::manage<T: Send + Sync + 'static>(&self, state: T)`. Our `UpdateStateGuard { state_path: PathBuf, state: Arc<Mutex<UpdateState>> }` is `Send + Sync` because:
- `PathBuf: Send + Sync` ✓
- `Arc<Mutex<T>>: Send + Sync` when `T: Send` ✓ (`UpdateState` derives `Default + Debug + Clone + Serialize + Deserialize + PartialEq` — all `Send`)

### Retrieve in command

```rust
#[tauri::command]
async fn update_dismiss(
    state: tauri::State<'_, UpdateStateGuard>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // ...
}
```

`tauri::State<'_, T>` is the parameter type. Lifetime `'_` is required for `async fn` (Tauri inserts `Inlet<'r, T>` internals). Multi-state retrieve: just multiple `State<'_, ...>` params.

### Retrieve from `AppHandle` (e.g. inside bg task)

```rust
let state: tauri::State<'_, UpdateStateGuard> = app_handle.state::<UpdateStateGuard>();
let guard = state.inner();    // &UpdateStateGuard
let mut s = guard.state.lock().map_err(|_| UpdateError::AppDataPath("state poisoned".into()))?;
```

CRITICAL: Retrieving non-existent state type → **runtime panic**, not compile error. `lifecycle::start` MUST run `manage()` BEFORE any `state::<UpdateStateGuard>()` call. Bg task spawn happens AFTER manage in `setup`, so ordering is fine.

## 5. Result<T, String> at IPC boundary

`[VERIFIED: v2.tauri.app develop/calling-rust]`

### Convention

```rust
#[tauri::command]
fn my_custom_command() -> Result<(), String> {
  std::fs::File::open("path/to/file").map_err(|err| err.to_string())?;
  Ok(())
}
```

`E: Serialize` is required for ALL command return errors. `String` satisfies `Serialize`. Our `UpdateError` wraps `tauri_plugin_updater::Error` (no `Serialize`) + `std::io::Error` (no `Serialize`) — adding manual `Serialize` to `UpdateError` is impractical.

### JS-side behavior

```typescript
import { invoke } from '@tauri-apps/api/core';
try {
  await invoke('update_dismiss');
} catch (errorMessage: string) {
  // errorMessage is the Display string from UpdateError
}
```

Errors deserialize as plain strings → caught by the `try/catch` block as the rejection reason.

### Pattern for our 5 commands

All five wrap internal typed `Result<T, UpdateError>` with `.map_err(|e| e.to_string())?` at the function boundary:

```rust
#[tauri::command]
pub async fn update_check_now(
    state: tauri::State<'_, UpdateStateGuard>,
    app_handle: tauri::AppHandle,
) -> Result<UpdateState, String> {
    check_now_impl(&state, &app_handle).await.map_err(|e| e.to_string())
}

async fn check_now_impl(
    state: &UpdateStateGuard,
    app_handle: &tauri::AppHandle,
) -> Result<UpdateState, UpdateError> {
    // typed-error path; only the wrapper sees String
}
```

Single line of `String` exposure per command keeps CLAUDE.md "no String error" rule on internal logic.

## 6. Bg task spawn pattern (mirror spawn_sidecar)

`[VERIFIED: src-tauri/src/lib.rs:60-177]`

### Existing pattern in `spawn_sidecar`

Key elements to copy verbatim:
- `tauri::async_runtime::spawn(async move { ... })` — Tauri's wrapper around `tokio::spawn`. Use this NOT raw `tokio::spawn` (consistency).
- `app_handle: tauri::AppHandle` cloned into the closure via `move`.
- Loop with `tokio::time::sleep(Duration::from_secs(...))`.
- `app_handle.emit("event-name", &payload)` for IPC events.
- `app_handle.path().app_data_dir()` returns `Result<PathBuf>`.
- `std::fs::create_dir_all(&dir)` for first-run dir creation.

### Phase 3 lifecycle::start sketch

```rust
// src-tauri/src/update/lifecycle.rs
use crate::update::{
    checker::{evaluate_update, should_check_now, UpdateDecision},
    errors::UpdateError,
    storage::{load, save, with_check_completed, UpdateState},
    UpdateAvailablePayload,
    UpdateStateGuard,    // re-exported via mod.rs
};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

const CHECK_INTERVAL_SECONDS: u64 = 6 * 3600;
const DISMISS_COOLDOWN_SECONDS: i64 = 24 * 3600;
const FORCE_CHECK_ENV: &str = "CAS_UPDATER_FORCE_CHECK";

pub fn start(app_handle: &AppHandle) -> Result<(), UpdateError> {
    // Sync prelude — runs before tokio::spawn.
    let dir = app_handle.path().app_data_dir()
        .map_err(|e| UpdateError::AppDataPath(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    let state_path = dir.join("update-state.json");
    let initial_state = load(&state_path)?;
    let guard = UpdateStateGuard {
        state_path: state_path.clone(),
        state: Arc::new(Mutex::new(initial_state)),
    };
    app_handle.manage(guard);

    // Async loop.
    let handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        run_loop(handle).await;
    });
    Ok(())
}

async fn run_loop(app_handle: AppHandle) {
    loop {
        if let Err(e) = run_one_cycle(&app_handle).await {
            log::warn!("[update] cycle failed: {e}");    // see Section 9
        }
        tokio::time::sleep(Duration::from_secs(CHECK_INTERVAL_SECONDS)).await;
    }
}

async fn run_one_cycle(app_handle: &AppHandle) -> Result<(), UpdateError> {
    // Flat early-return chain — no nested if-in-if.
    let force = std::env::var(FORCE_CHECK_ENV).is_ok();
    let now = current_unix();
    let last_check = read_last_check(app_handle)?;
    if !force && !should_check_now(last_check, now, CHECK_INTERVAL_SECONDS as i64) {
        return Ok(());
    }
    let maybe_update = app_handle.updater()
        .map_err(UpdateError::UpdaterPlugin)?
        .check()
        .await
        .map_err(UpdateError::UpdaterPlugin)?;
    persist_check_completed(app_handle, now)?;
    let Some(update) = maybe_update else { return Ok(()); };
    handle_update_decision(app_handle, update, now)?;
    Ok(())
}

fn current_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn current_platform_key() -> &'static str {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) { "windows-x86_64" }
    else if cfg!(all(target_os = "macos", target_arch = "aarch64")) { "darwin-aarch64" }
    else if cfg!(all(target_os = "macos", target_arch = "x86_64")) { "darwin-x86_64" }
    else if cfg!(all(target_os = "linux", target_arch = "x86_64")) { "linux-x86_64" }
    else { "unknown" }
}
```

Note: `read_last_check`, `persist_check_completed`, `handle_update_decision` are extracted helpers to keep `run_one_cycle` ≤ 50 lines (Tiger-Style).

## 7. Current platform key — cfg! mapping table

`[VERIFIED: Tauri target naming convention from docs.rs Update.target docs]`

| Compile-time cfg | Tauri/our key |
|------------------|---------------|
| `all(target_os = "windows", target_arch = "x86_64")` | `"windows-x86_64"` |
| `all(target_os = "macos", target_arch = "aarch64")` | `"darwin-aarch64"` |
| `all(target_os = "macos", target_arch = "x86_64")` | `"darwin-x86_64"` |
| `all(target_os = "linux", target_arch = "x86_64")` | `"linux-x86_64"` |
| `all(target_os = "linux", target_arch = "aarch64")` | `"linux-aarch64"` |
| else | return `Err(UpdateError::MissingPlatform { key: format!(...) })` |

`cfg!` is compile-time → zero runtime cost. Tauri 2.x ships `tauri_plugin_os::platform()` for runtime detection but it's not needed here (we know our build target at compile time, and the key must match the bundle's filename in `latest.json`).

**Cross-reference:** Tauri's own updater plugin uses target string `target` field (see `Update.target: String`) to disambiguate. Our key must match what the GitHub Actions workflow (Phase 5) writes into `latest.json` `platforms` map.

## 8. [features] block + integration test gating

`[VERIFIED: doc.rust-lang.org/cargo/reference/features.html + Cargo Issue #2911]`

### Cargo.toml addition

```toml
[features]
integration = []
```

Empty deps array — feature is just a compile-time flag, doesn't pull in extra crates. `tempfile` already in `[dev-dependencies]` from Phase 2.

### Test module gating

```rust
// src-tauri/src/update/mod.rs
#[cfg(feature = "integration")]
pub mod tests_integration;

// src-tauri/src/update/tests_integration.rs
#![cfg(feature = "integration")]

use super::*;

#[test]
fn test_update_state_persists_across_load_save() { /* ... */ }

#[test]
fn test_skip_version_then_check_returns_silent_skip() { /* ... */ }

#[test]
fn test_dismiss_then_check_within_cooldown_returns_silent_skip() { /* ... */ }

#[test]
fn test_dismiss_after_cooldown_returns_notify() { /* ... */ }
```

### Run command

- Default tests only: `cargo test --package churchaudiostream --lib update::`
- Integration tests + default: `cargo test --package churchaudiostream --features integration --lib update::`

`--features integration` activates the flag — both default + gated tests run. Passing the flag does NOT replace the default tests, it ADDS the gated ones.

## 9. Logging in Tauri 2.x — log vs tracing vs eprintln

`[VERIFIED: tauri 2.x Cargo.toml dependency tree shows log = "0.4"]`

### Tauri pulls in `log` crate transitively

`tauri 2` depends on `log = "0.4"` → `log` macros (`log::info!`, `log::warn!`, `log::error!`) are usable WITHOUT adding it to our Cargo.toml. CONTEXT line 133 raises this question — answer: **use `log::warn!` for bg task warnings**.

```rust
log::warn!("[update] manifest fetch failed: {error}");
log::info!("[update] no update available; sleeping");
```

### Why not `tracing`?

`tracing` is NOT a transitive dep of Tauri 2.x. Adding it = new dep + structured logging machinery. Overkill for 5 log sites. Rejected.

### Why not `eprintln!`?

CLAUDE.md "Tiger-Style" line 517: *"No `println!` / `console.log` in production code (use `tracing` / `log` crate / Tauri logger)"*. Existing `lib.rs` uses `eprintln!` for sidecar logging — that's a pre-existing tech-debt site that should be cleaned up but is OUT OF SCOPE for Phase 3 (don't modify Phase 1+2 modules + don't refactor sidecar).

### Phase 3 rule

**New code uses `log::warn!` / `log::info!` / `log::error!`. Carry-over `eprintln!` in `lib.rs` `spawn_sidecar` stays.** A consumer may want to wire `tauri-plugin-log` later (separate phase) — until then, log records still go to stderr via the `log` crate's default impl (or are silently dropped if no subscriber registered; that's acceptable for now).

### Cargo.toml impact

**ZERO new deps.** `log` is already in the dependency graph via Tauri.

## 10. Package.json deps

`[VERIFIED: npm view 2026-05-01]`

| Package | Latest version | Caret form | Section |
|---------|---------------|-----------|---------|
| `@tauri-apps/plugin-updater` | 2.10.1 | `^2` | `dependencies` |
| `@tauri-apps/plugin-process` | 2.3.1 | `^2` | `dependencies` |

Convention: Tauri JS plugins go in `"dependencies"` (NOT `"devDependencies"`) because they ship in the production bundle. Existing `@tauri-apps/plugin-shell` is already there as precedent.

### package.json patch

```json
"dependencies": {
  "@tauri-apps/api": "^2.5.0",
  "@tauri-apps/plugin-process": "^2",
  "@tauri-apps/plugin-shell": "^2.3.0",
  "@tauri-apps/plugin-updater": "^2",
  "qrcode": "^1.5.4",
  "react": "^19.2.0",
  "react-dom": "^19.2.0"
}
```

Alphabetical insertion before `qrcode`. Use `^2` (not `^2.10.1`) to match the Rust `tauri-plugin-updater = "2"` major-version pin convention.

## 11. Capabilities / allowlist for updater plugin

`[VERIFIED: github.com/tauri-apps/plugins-workspace permissions/default.toml for both plugins]`

### Without these, IPC calls fail at runtime

Tauri 2.x has a strict capability system. `app_handle.updater()` from Rust does NOT need a capability (Rust-side privileged code), BUT:
- Frontend `import { check } from '@tauri-apps/plugin-updater'` REQUIRES `updater:default`
- Frontend `import { relaunch } from '@tauri-apps/plugin-process'` REQUIRES `process:default`

Phase 4 React UI will use both. If Phase 3 omits these, Phase 4 starts with broken IPC. Add now.

### `updater:default` set includes

```
allow-check
allow-download
allow-install
allow-download-and-install
```

### `process:default` set includes

```
allow-exit
allow-restart
```

### Patched `src-tauri/capabilities/default.json`

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Main window capabilities for sidecar management and core features",
  "windows": ["main"],
  "permissions": [
    "core:default",
    {
      "identifier": "shell:allow-spawn",
      "allow": [
        {
          "name": "binaries/server",
          "sidecar": true,
          "args": true
        }
      ]
    },
    "shell:allow-kill",
    "process:default",
    "updater:default"
  ]
}
```

Two new lines appended.

## 12. Pitfalls + recommended Cargo.toml + tauri.conf.json + capabilities additions

### Pitfall 1: `std::sync::Mutex` held across `await`

`[VERIFIED: tokio::sync::Mutex docs + clippy::await_holding_lock lint]`

```rust
// WRONG — clippy::await_holding_lock fires
let mut s = guard.state.lock().unwrap();
s.last_check_unix = now;
some_async_thing().await;     // BUG: lock held across await
save(&path, &s)?;
```

```rust
// CORRECT — release lock before await, re-acquire after
let new_state = {
    let mut s = guard.state.lock().unwrap();
    *s = with_check_completed(s.clone(), now);
    s.clone()
};
// lock released here
tokio::task::spawn_blocking({
    let path = guard.state_path.clone();
    move || save(&path, &new_state)
}).await??;
```

Pattern: do all mutation in a synchronous block (lock → mutate → clone-out → drop), then `spawn_blocking` for IO. Storage save is sync IO per Phase 2 contract; tokio runtime worker thread blocks → use `spawn_blocking`.

### Pitfall 2: `app_handle.path().app_data_dir()` re-resolution

CONTEXT decision says "cache in UpdateStateGuard" — confirmed correct. Each call resolves the path fresh (small cost but unnecessary). `state_path: PathBuf` cached at construction is right.

### Pitfall 3: empty `pubkey` runtime behavior

`[ASSUMED: based on plugin source structure]` — Builder sets pubkey from config; `check()` does NOT validate the pubkey format until signature verification time (post-download). Implication: **app starts fine with `REPLACE_WITH_USER_GENERATED_PUBKEY` placeholder**, bg task can call `check()` and get an `Update` struct, but `download_and_install()` fails with `Error::Minisign(...)` because signature doesn't match the placeholder.

**Risk for our bg task:** if `check()` succeeds but the placeholder is in place, frontend gets `update:available` event, user clicks "Update now", `download_and_install` fails. Frontend must handle the `Minisign` error gracefully (display "Update verification failed — contact admin").

**Mitigation:** Phase 3 bg task is fail-soft (any `UpdateError` from cycle is caught + logged + retried 6h later). NO crash. Document for Phase 4 frontend that `update_install` may fail with verification error.

`[ASSUMED]` — confirm by running locally with placeholder before merging Phase 3. If Builder panics on empty pubkey, bg task spawn must guard with `try_resolve_updater()` early-return + log.

### Pitfall 4: `bundle.createUpdaterArtifacts: true` requirement

`[VERIFIED: v2.tauri.app updater guide]` — without this key, `tauri build` does NOT generate the `.sig` file, so Phase 5 GitHub Actions has nothing to package into `latest.json`. Set in Phase 3 to avoid a Phase-5-blocked-on-conf-edit cycle.

### Pitfall 5: Worktree compile artifact stubs

Phase 1+2 noted: tauri-build resource manifest checks paths exist at compile time. Stubs needed:
- `src-tauri/binaries/server-x86_64-pc-windows-msvc.exe`
- `src-tauri/binaries/mediasoup-worker.exe`
- `sidecar/public/.gitkeep`
- `dist/index.html`

All gitignored. Same trick for Phase 3 worktree — executor must create stubs before `cargo test` runs, or compile fails.

### Recommended Cargo.toml (final state after Phase 3)

```toml
[package]
name = "churchaudiostream"
version = "0.1.2"
description = "Cross-platform church audio restreaming application"
authors = ["ChurchAudioStream"]
edition = "2021"

[lib]
name = "churchaudiostream_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[features]
integration = []

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["time"] }
semver = "1"
log = "0.4"

[dev-dependencies]
tempfile = "3"
```

Additions: `[features] integration = []`, three runtime deps (`tauri-plugin-updater`, `tauri-plugin-process`, `log`). `log` is added explicitly (not relying on Tauri's transitive) for Tiger-Style "explicit deps" hygiene — minimal cost since it's already in the resolved tree. **CONTEXT does NOT block this — review before final.**

Alternative: if reviewer prefers minimal Cargo.toml diff, omit `log = "0.4"` and rely on transitive. Document choice in plan.

### Recommended tauri.conf.json patch

Two changes only:

```json
"bundle": {
  "active": true,
  "targets": "all",
  "createUpdaterArtifacts": true,    // NEW
  "externalBin": ["binaries/server"],
  ...
},
"plugins": {
  "shell": {
    "open": false
  },
  "updater": {                       // NEW BLOCK
    "endpoints": [
      "https://github.com/roulendz/ChurchAudioStream/releases/latest/download/latest.json"
    ],
    "pubkey": "REPLACE_WITH_USER_GENERATED_PUBKEY",
    "windows": {
      "installMode": "passive"
    }
  }
}
```

NO `"dialog": false` (v1 legacy, omit).

### Recommended capabilities/default.json patch

Append `"process:default"` and `"updater:default"` to `permissions` array. See Section 11.

## 13. Recommendations for Phase 3 implementation

### Module layout (final state, alphabetical)

```
src-tauri/src/update/
├── mod.rs                  (modified: 4 new pub mod + re-exports)
├── checker.rs              (Phase 2, untouched)
├── commands.rs             (NEW: 5 #[tauri::command] async fns)
├── dispatcher.rs           (Phase 2, untouched)
├── errors.rs               (NEW: UpdateError enum + From impls)
├── lifecycle.rs            (NEW: start() + bg task loop + helpers)
├── manifest.rs             (Phase 1, untouched)
├── state_guard.rs          (NEW: UpdateStateGuard struct — separate per CONTEXT discretion if commands.rs gets > 200 lines)
├── storage.rs              (Phase 2, untouched)
├── tests_integration.rs    (NEW: gated by #[cfg(feature = "integration")])
└── version.rs              (Phase 1, untouched)
```

### Final mod.rs

```rust
pub mod checker;
pub mod commands;
pub mod dispatcher;
pub mod errors;
pub mod lifecycle;
pub mod manifest;
pub mod state_guard;       // or fold into commands.rs
pub mod storage;
pub mod version;

#[cfg(feature = "integration")]
pub mod tests_integration;

pub use checker::{evaluate_update, is_version_skipped, should_check_now, UpdateDecision};
pub use dispatcher::{
    UpdateAvailablePayload, UpdateDownloadProgressPayload, UpdateInstalledPayload,
};
pub use errors::UpdateError;
pub use state_guard::UpdateStateGuard;
pub use storage::{
    load, save, with_check_completed, with_dismissed_now, with_skipped_version,
    StorageError, UpdateState,
};
```

### lib.rs setup hook ordering

```rust
.setup(|app| {
    crate::update::lifecycle::start(app.handle())
        .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
    spawn_sidecar(app.handle().clone(), sidecar_should_run);
    Ok(())
})
```

`lifecycle::start` runs first (state load + manage + bg spawn). Sidecar spawn second. No ordering dep but updater state is ready before any IPC arrives.

### Plugin registration order

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())          // existing
    .plugin(tauri_plugin_updater::Builder::new().build())   // NEW
    .plugin(tauri_plugin_process::init())        // NEW
    .manage(AppLogBuffer(Mutex::new(LogBuffer::new(LOG_BUFFER_CAPACITY))))
    .manage(SidecarChild(Mutex::new(None)))
    .invoke_handler(tauri::generate_handler![
        get_buffered_logs,
        crate::update::commands::update_check_now,
        crate::update::commands::update_install,
        crate::update::commands::update_dismiss,
        crate::update::commands::update_skip_version,
        crate::update::commands::update_get_state,
    ])
    .setup(...)
```

`UpdateStateGuard.manage()` happens INSIDE `lifecycle::start` (called from setup) — NOT here. Don't double-manage.

### Acceptance commands

```bash
# Default unit tests (≥10 new + 46 carryover = ≥56 total)
cd src-tauri && cargo test --package churchaudiostream --lib update::

# Integration tests (≥4 new)
cd src-tauri && cargo test --package churchaudiostream --features integration --lib update::

# Clippy clean
cd src-tauri && cargo clippy --package churchaudiostream --all-targets -- -D warnings

# tauri build BLOCKED until user replaces pubkey placeholder — DO NOT RUN
```

### Test floor verification

| Module | Min new tests | Strategy |
|--------|--------------|----------|
| `errors.rs` | 4 | Display per variant + `From<ParseError>` + `From<ManifestError>` + `From<StorageError>` chain |
| `lifecycle.rs` | 2 | `current_platform_key()` returns expected on host triple + `current_unix()` returns positive value |
| `commands.rs` | 0-3 | Hard to unit-test (`tauri::State` requires running runtime); fold into integration suite |
| `state_guard.rs` | 1-2 | Construction + clone-state pattern |
| `tests_integration.rs` | 4 (named) | Per CONTEXT spec — exact names locked |

Worst case: 4 + 2 + 0 + 1 + 4 = 11 new tests. Floor met.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | cargo test (built-in) + tempfile 3 (existing dev-dep) |
| Config file | none — inline `#[cfg(test)] mod tests` per file |
| Quick run command | `cargo test --package churchaudiostream --lib update::` |
| Full suite command | `cargo test --package churchaudiostream --features integration --lib update::` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| P3-DEPS | Cargo + npm deps install | smoke | `cargo build && npm install` | n/a (toolchain) |
| P3-CONF | tauri.conf.json valid | smoke | `cargo build` (tauri-build validates) | n/a |
| P3-CMD | Commands compile + serialize | unit | `cargo test --lib update::commands` | NEW |
| P3-LIFE | Bg task helpers correct | unit | `cargo test --lib update::lifecycle` | NEW |
| P3-CAP | capabilities valid | smoke | `cargo build` (tauri-build validates schema) | n/a |
| P3-ERR | UpdateError From + Display | unit | `cargo test --lib update::errors` | NEW |
| P3-INT | State persistence + checker integration | integration | `cargo test --features integration --lib update::tests_integration` | NEW |

### Sampling Rate
- **Per task commit:** `cargo test --package churchaudiostream --lib update::`
- **Per wave merge:** `cargo test --package churchaudiostream --features integration --lib update::` + `cargo clippy --all-targets -- -D warnings`
- **Phase gate:** Both above green + `cargo build --package churchaudiostream` clean

### Wave 0 Gaps
- [ ] `src-tauri/src/update/errors.rs` — covers P3-ERR
- [ ] `src-tauri/src/update/commands.rs` — covers P3-CMD
- [ ] `src-tauri/src/update/lifecycle.rs` — covers P3-LIFE
- [ ] `src-tauri/src/update/state_guard.rs` — covers P3-CMD (if separate module per CONTEXT discretion)
- [ ] `src-tauri/src/update/tests_integration.rs` — covers P3-INT
- [ ] Stub binaries for worktree compile (gitignored): `src-tauri/binaries/server-x86_64-pc-windows-msvc.exe`, `binaries/mediasoup-worker.exe`, `sidecar/public/.gitkeep`, `dist/index.html`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no user auth surface) |
| V3 Session Management | no | — |
| V4 Access Control | yes | Tauri capability system — `updater:default` + `process:default` scoped to main window only |
| V5 Input Validation | yes | `evaluate_update` validates manifest version + URL before action; plugin enforces HTTPS + signature |
| V6 Cryptography | yes | minisign Ed25519 signature via `tauri-plugin-updater` — DO NOT hand-roll. Public key embedded in binary. |
| V14 Configuration | yes | `bundle.createUpdaterArtifacts` + `pubkey` in `tauri.conf.json` MUST be correct or updates fail closed |

### Known Threat Patterns for Tauri auto-updater

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| MITM injects malicious update | Tampering | Plugin enforces HTTPS via `Error::InsecureTransportProtocol`; minisign signature verification (Ed25519) cannot be bypassed |
| Downgrade attack (older signed version) | Tampering | Phase 1 `is_newer()` rejects; plugin's `check()` semver comparison rejects |
| Replay with stale `latest.json` | Tampering | GitHub-served HTTPS endpoint; `latest.json` regenerated on every release |
| Lost private key → no rollback path | Repudiation | Document key location + rotation procedure (CONTEXT manual step 5 — README.md "Building releases") |
| Placeholder pubkey ships to production | Information Disclosure | Phase 5 CI must `grep -F REPLACE_WITH_USER_GENERATED_PUBKEY` + fail build if found. Phase 3 embeds placeholder; user must replace before `tauri build` |
| Bg task crashes → updates silently disabled | Denial of Service | Fail-soft loop catches all errors + logs; user can manually trigger via `update_check_now` IPC |
| State file corruption blocks updates | DoS | Phase 2 corrupt-JSON → loud `StorageError::Parse`; `lifecycle::start` propagates error → app fails to start, user deletes file, retries (per Phase 2 module doc contract) |
| `update_install` invoked without `check` | Tampering | `update_install` re-fetches via `check()`; plugin re-validates signature on every download |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Tauri 2.x updater Builder accepts empty `pubkey` placeholder without panic at startup; failure deferred to `download_and_install` signature verification | 12 (Pitfall 3) | Bg task may panic at startup → app crashes. Mitigation: wrap `app_handle.updater()` call in `try` + log on `EmptyEndpoints` / similar variant |
| A2 | `log` crate is transitively available via Tauri 2 dep tree without explicit Cargo.toml entry | 9 | Linker error. Mitigation: add `log = "0.4"` explicitly (recommended in Section 12) |
| A3 | `tauri::async_runtime::spawn` and `tokio::spawn` are interchangeable for our use case | 6 | Unlikely — `async_runtime` IS tokio. Lib.rs already mixes both. |
| A4 | Removing `"dialog": false` from CONTEXT-suggested conf does not break any v1-compat layer | 3 | Cosmetic — key silently ignored in v2. Worst case: no-op |

If A1 is wrong → bg task must guard. Confirm with smoke test in Phase 3 verification before merge.

## Sources

### Primary (HIGH confidence)
- `https://docs.rs/tauri-plugin-updater/latest/tauri_plugin_updater/struct.Update.html` — Update struct + download_and_install signature
- `https://docs.rs/tauri-plugin-updater/latest/tauri_plugin_updater/enum.Error.html` — 29 Error variants
- `https://v2.tauri.app/plugin/updater/` — Builder, conf.json schema, capability set, install behavior
- `https://v2.tauri.app/plugin/process/` — init() + restart vs relaunch
- `https://v2.tauri.app/develop/state-management/` — Manager::manage + tauri::State pattern
- `https://v2.tauri.app/develop/calling-rust/` — Result<T, String> at IPC boundary
- `https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/updater/permissions/default.toml` — `updater:default` set
- `https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/process/permissions/default.toml` — `process:default` set
- `npm view @tauri-apps/plugin-updater version` → `2.10.1` (verified live 2026-05-01)
- `npm view @tauri-apps/plugin-process version` → `2.3.1` (verified live 2026-05-01)
- `cargo search tauri-plugin-updater` → `2.10.1`
- `cargo search tauri-plugin-process` → `2.3.1`

### Secondary (MEDIUM confidence)
- `https://github.com/tauri-apps/tauri/issues/12310` — known restart timing issue (out-of-scope mitigation)
- `https://github.com/tauri-apps/tauri/issues/11392` — App::restart does not restart after update.download_and_install in rust (resolved upstream)
- `https://doc.rust-lang.org/cargo/reference/features.html` — `[features]` block syntax
- `https://github.com/rust-lang/cargo/issues/2911` — feature gating tests pattern

### Tertiary (LOW confidence)
- A1 empty-pubkey-no-panic claim — based on plugin source structure, not directly tested. Verify in Phase 3 verification.

## Metadata

**Confidence breakdown:**
- API surface (Sections 1, 2, 4, 5): HIGH — verified against docs.rs Update struct + Error enum
- Conf schema (Section 3): HIGH — verified against v2.tauri.app + plugins-workspace
- Bg task pattern (Section 6): HIGH — direct mirror of working `spawn_sidecar` at lib.rs:60-177
- Capabilities (Section 11): HIGH — exact permissions set verified from upstream `permissions/default.toml`
- Versions (Section 10): HIGH — `npm view` + `cargo search` ran live 2026-05-01
- Logging recommendation (Section 9): MEDIUM — `log` is transitively available; explicit add recommended
- Empty-pubkey runtime behavior (A1): LOW — assumption, not tested; smoke test in verification

**Research date:** 2026-05-01
**Valid until:** 2026-06-01 (30 days; Tauri 2.x is stable, plugin minor versions infrequent)

---

## RESEARCH COMPLETE

**Phase:** quick-task 260501-uon — Phase 3 auto-updater Tauri plugin wiring
**Confidence:** HIGH

### Key Findings
- Plugin versions verified live: `tauri-plugin-updater = "2.10.1"`, `tauri-plugin-process = "2.3.1"`, `@tauri-apps/plugin-updater = 2.10.1`, `@tauri-apps/plugin-process = 2.3.1`. CONTEXT caret `^2` correct.
- `Update::download_and_install` callback signatures: `C: FnMut(usize, Option<u64>)` (chunk delta + total) + `D: FnOnce()`. CONTEXT must track running sum manually.
- Plugin handles HTTPS + signature validation internally — our `manifest::validate()` becomes redundant for the `check()` path. `evaluate_update` retains exclusive ownership of skip + dismiss logic.
- CONTEXT correction: `dialog: false` is v1 legacy, OMIT. Add `bundle.createUpdaterArtifacts: true` + `windows.installMode: "passive"`.
- CRITICAL: capability `"updater:default"` + `"process:default"` MUST be added to `capabilities/default.json` or Phase 4 React UI breaks at runtime.
- CRITICAL: plugin does NOT auto-restart after install — Phase 3 emits `update:installed` event; Phase 4 frontend calls `relaunch()`. CONTEXT line 81 needs correction.
- Use `log::warn!` + `log::info!` (transitive via Tauri) instead of `eprintln!` for new bg task code. Add `log = "0.4"` to Cargo.toml explicitly per Tiger-Style hygiene.

### File Created
`C:\laragon\www\ChurchAudioStream\.planning\quick\260501-uon-phase-3-auto-updater-tauri-plugin-wiring\260501-uon-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Plugin Rust API | HIGH | docs.rs verified, signatures quoted verbatim |
| Conf.json schema | HIGH | v2.tauri.app + plugins-workspace cross-check |
| Capabilities | HIGH | upstream permissions/default.toml verified |
| Versions | HIGH | npm + cargo live query |
| Logging recommendation | MEDIUM | log is transitive; explicit add safer |
| Empty-pubkey panic behavior (A1) | LOW | assumption — verify in smoke test |

### Open Questions
- A1: Does `tauri-plugin-updater` Builder panic on placeholder pubkey at app startup, or defer error to `download_and_install`? Verify with smoke test in Phase 3 worktree before merging.
- `lib.rs` carry-over `eprintln!` cleanup — out of scope but worth a follow-up phase.

### Ready for Planning
Research complete. Planner has full API surface + correction list against CONTEXT. Phase 3 plan can proceed.
