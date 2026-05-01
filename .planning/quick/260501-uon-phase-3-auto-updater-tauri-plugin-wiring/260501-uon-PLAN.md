---
quick_id: 260501-uon
description: phase 3 auto-updater: tauri plugin wiring + IPC commands + bg task
status: ready
phase: quick
plan: 03
type: execute
wave: 1
depends_on:
  - 260501-qq5
  - 260501-t83
files_modified:
  - src-tauri/Cargo.toml
  - src-tauri/tauri.conf.json
  - src-tauri/capabilities/default.json
  - src-tauri/src/update/mod.rs
  - src-tauri/src/update/errors.rs
  - src-tauri/src/update/state_guard.rs
  - src-tauri/src/update/commands.rs
  - src-tauri/src/update/lifecycle.rs
  - src-tauri/src/update/tests_integration.rs
  - src-tauri/src/lib.rs
  - package.json
autonomous: true
requirements:
  - P3-DEPS
  - P3-CONF
  - P3-CAP
  - P3-ERR
  - P3-CMD
  - P3-LIFE
  - P3-INT
must_haves:
  truths:
    - "src-tauri/Cargo.toml lists tauri-plugin-updater = \"2\", tauri-plugin-process = \"2\", log = \"0.4\" under [dependencies] and [features] block contains integration = []."
    - "package.json [dependencies] lists @tauri-apps/plugin-updater ^2 and @tauri-apps/plugin-process ^2 alphabetically before qrcode."
    - "src-tauri/tauri.conf.json has bundle.createUpdaterArtifacts = true; plugins.updater block has endpoints array (single GitHub latest.json URL), pubkey REPLACE_WITH_USER_GENERATED_PUBKEY, windows.installMode = \"passive\"; NO dialog key (v1 legacy omitted per RESEARCH §3)."
    - "src-tauri/capabilities/default.json permissions array contains both \"updater:default\" and \"process:default\" (Phase 4 frontend prerequisite)."
    - "src-tauri/src/update/errors.rs declares pub enum UpdateError with variants Parse(ParseError), Manifest(ManifestError), Storage(StorageError), UpdaterPlugin(tauri_plugin_updater::Error), Json(serde_json::Error), Io(std::io::Error), AppDataPath(String), MissingPlatform { key: String }; hand-rolled Display + empty std::error::Error + From impls for each wrapped variant; zero thiserror."
    - "src-tauri/src/update/state_guard.rs declares pub struct UpdateStateGuard { pub state_path: PathBuf, pub state: Arc<Mutex<UpdateState>> } using std::sync::Mutex (NOT tokio); Send + Sync verified at type level."
    - "src-tauri/src/update/commands.rs exports five #[tauri::command] async fns: update_check_now, update_install, update_dismiss, update_skip_version, update_get_state; all return Result<T, String>; internal *_impl fns return Result<T, UpdateError>; conversion via .map_err(|e| e.to_string()) at boundary only."
    - "update_install in commands.rs awaits Update::download_and_install with on_chunk: FnMut(usize, Option<u64>) tracking running sum manually (per-chunk delta correction); emits update:download:progress per chunk and update:installed on completion; returns Ok(()) without calling restart (Phase 4 owns relaunch)."
    - "src-tauri/src/update/lifecycle.rs exports pub fn start(app_handle: &AppHandle) -> Result<(), UpdateError>; sync prelude resolves app_data_dir, create_dir_all, load(), constructs UpdateStateGuard, manage()s it; tauri::async_runtime::spawn runs run_loop with 6h sleep + CAS_UPDATER_FORCE_CHECK env override; fail-soft (no panic on cycle errors); A1 guarded — placeholder pubkey in updater() call wrapped in match, log::warn! + skip cycle on Err."
    - "lifecycle.rs uses log::warn!/log::info! NOT eprintln! for new bg-task code (RESEARCH §9)."
    - "src-tauri/src/update/mod.rs final state has 8 alphabetical pub mod (checker, commands, dispatcher, errors, lifecycle, manifest, state_guard, storage, version) plus #[cfg(feature = \"integration\")] pub mod tests_integration; re-exports include UpdateError + UpdateStateGuard."
    - "src-tauri/src/lib.rs registers tauri_plugin_updater::Builder::new().build() and tauri_plugin_process::init() plugins; setup hook calls crate::update::lifecycle::start(app.handle())? BEFORE spawn_sidecar; invoke_handler appended with crate::update::commands::{update_check_now, update_install, update_dismiss, update_skip_version, update_get_state}."
    - "src-tauri/src/update/tests_integration.rs gated by #[cfg(feature = \"integration\")] declares exactly four #[test] fns with names: test_update_state_persists_across_load_save, test_skip_version_then_check_returns_silent_skip, test_dismiss_then_check_within_cooldown_returns_silent_skip, test_dismiss_after_cooldown_returns_notify."
    - "Acceptance: cd src-tauri && cargo test --package churchaudiostream --lib update:: returns >=56 passing tests (46 carryover + >=10 new module unit tests), 0 failed."
    - "Acceptance: cd src-tauri && cargo test --package churchaudiostream --features integration --lib update:: returns the four named integration tests passing, plus all default tests still pass."
    - "Acceptance: cd src-tauri && cargo clippy --package churchaudiostream --all-targets -- -D warnings clean (zero warnings)."
    - "Phase 1+2 modules untouched: git diff HEAD~ -- src-tauri/src/update/version.rs src-tauri/src/update/manifest.rs src-tauri/src/update/checker.rs src-tauri/src/update/storage.rs src-tauri/src/update/dispatcher.rs reports zero changes."
    - "Tiger-Style: zero unwrap()/expect() outside #[cfg(test)] in new files; zero eprintln!/println! in new files; zero nested-if-in-if; no fn body > 50 lines."
    - "Smoke test: cargo build --package churchaudiostream succeeds with placeholder pubkey REPLACE_WITH_USER_GENERATED_PUBKEY in tauri.conf.json (A1 verification — Builder must not panic at startup)."
    - "npm run tauri build NOT run by agent (blocked on real pubkey); SUMMARY.md documents the five user-driven manual steps verbatim from CONTEXT §Manual Steps Required."
  artifacts:
    - path: src-tauri/Cargo.toml
      provides: "deps + integration feature flag"
      contains: "tauri-plugin-updater"
      contains_alt: "[features]"
    - path: src-tauri/tauri.conf.json
      provides: "updater plugin config + createUpdaterArtifacts + windows.installMode"
      contains: "createUpdaterArtifacts"
      not_contains: "\"dialog\""
    - path: src-tauri/capabilities/default.json
      provides: "updater + process capability permissions"
      contains: "updater:default"
      contains_alt: "process:default"
    - path: src-tauri/src/update/errors.rs
      provides: "UpdateError typed enum + From impls + Display"
      min_lines: 80
    - path: src-tauri/src/update/state_guard.rs
      provides: "UpdateStateGuard managed state wrapper"
      min_lines: 25
    - path: src-tauri/src/update/commands.rs
      provides: "five #[tauri::command] async fns"
      min_lines: 200
    - path: src-tauri/src/update/lifecycle.rs
      provides: "bg task start + run_loop + helpers"
      min_lines: 150
    - path: src-tauri/src/update/tests_integration.rs
      provides: "four named integration tests"
      min_lines: 60
    - path: src-tauri/src/update/mod.rs
      provides: "module declarations + re-exports"
      contains: "pub mod state_guard"
    - path: src-tauri/src/lib.rs
      provides: "plugin registration + lifecycle::start in setup + 5 new commands in invoke_handler"
      contains: "tauri_plugin_updater::Builder"
    - path: package.json
      provides: "@tauri-apps/plugin-updater + @tauri-apps/plugin-process deps"
      contains: "@tauri-apps/plugin-updater"
  key_links:
    - from: src-tauri/src/lib.rs
      to: src-tauri/src/update/lifecycle.rs
      via: "setup hook calls crate::update::lifecycle::start(app.handle())?"
    - from: src-tauri/src/lib.rs
      to: src-tauri/src/update/commands.rs
      via: "invoke_handler registers 5 commands"
    - from: src-tauri/src/update/lifecycle.rs
      to: src-tauri/src/update/checker.rs
      via: "calls should_check_now + evaluate_update"
    - from: src-tauri/src/update/lifecycle.rs
      to: src-tauri/src/update/storage.rs
      via: "load + with_check_completed + save (spawn_blocking for IO)"
    - from: src-tauri/src/update/commands.rs
      to: src-tauri/src/update/state_guard.rs
      via: "tauri::State<'_, UpdateStateGuard> param"
    - from: src-tauri/src/update/commands.rs
      to: src-tauri/src/update/dispatcher.rs
      via: "emits UpdateAvailablePayload + UpdateDownloadProgressPayload + UpdateInstalledPayload via app_handle.emit"
    - from: src-tauri/src/update/errors.rs
      to: "tauri_plugin_updater::Error + std::io::Error + serde_json::Error + ParseError + ManifestError + StorageError"
      via: "From impls for ? propagation"
    - from: src-tauri/tauri.conf.json
      to: tauri-plugin-updater
      via: "plugins.updater config block read by Builder::new().build()"
    - from: src-tauri/capabilities/default.json
      to: "Phase 4 frontend"
      via: "updater:default + process:default permits @tauri-apps/plugin-updater + plugin-process JS calls"

canonical_refs:
  - .planning/plans/auto-updater-plan.md:304-393
  - .planning/quick/260501-uon-phase-3-auto-updater-tauri-plugin-wiring/260501-uon-CONTEXT.md
  - .planning/quick/260501-uon-phase-3-auto-updater-tauri-plugin-wiring/260501-uon-RESEARCH.md
  - .planning/quick/260501-qq5-phase-1-auto-updater-semver-and-manifest/260501-qq5-SUMMARY.md
  - .planning/quick/260501-t83-phase-2-auto-updater-orchestration-check/260501-t83-SUMMARY.md
---

<objective>
Wire Phase 1+2 pure-logic surface into Tauri 2.x runtime. Add `tauri-plugin-updater`
+ `tauri-plugin-process` deps, configure plugin in `tauri.conf.json`, register
capabilities, build typed `UpdateError`, ship `UpdateStateGuard` managed state, expose
five `#[tauri::command]` IPC fns, spawn fail-soft bg check loop with 6h cooldown +
`CAS_UPDATER_FORCE_CHECK` override.

Out of scope: Phase 4 React UI. Phase 5 GitHub Actions. User-driven keypair generation
+ pubkey embedding + `npm run tauri build`. Phase 1+2 module modifications (only
`mod.rs` gets one-line additions per CONTEXT).

Honor RESEARCH corrections vs CONTEXT: drop `dialog: false` (v1 legacy), add
`bundle.createUpdaterArtifacts: true` + `windows.installMode: "passive"`, append
`updater:default` + `process:default` capabilities, use `log::warn!` not `eprintln!`,
track running download sum manually (per-chunk delta), DO NOT call `app.restart()` —
Phase 4 frontend owns `relaunch()`. Guard A1 (placeholder pubkey panic risk) with
match + log::warn + skip cycle.

Output: 11 files modified/created, 4 atomic commits (one per task), all tests green,
clippy clean, smoke test passes with placeholder pubkey.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260501-uon-phase-3-auto-updater-tauri-plugin-wiring/260501-uon-CONTEXT.md
@.planning/quick/260501-uon-phase-3-auto-updater-tauri-plugin-wiring/260501-uon-RESEARCH.md
@.planning/quick/260501-qq5-phase-1-auto-updater-semver-and-manifest/260501-qq5-SUMMARY.md
@.planning/quick/260501-t83-phase-2-auto-updater-orchestration-check/260501-t83-SUMMARY.md
@.planning/plans/auto-updater-plan.md
@src-tauri/src/lib.rs
@src-tauri/src/update/mod.rs
@src-tauri/Cargo.toml
@src-tauri/tauri.conf.json
@src-tauri/capabilities/default.json
@package.json

<interfaces>
<!-- Phase 1+2 surface that Phase 3 consumes — extracted from prior SUMMARYs + worktree code. -->
<!-- Executor uses these directly. NO codebase exploration needed for these modules. -->

From src-tauri/src/update/version.rs (Phase 1, untouched):
```rust
pub struct Semver { pub major: u64, pub minor: u64, pub patch: u64, /* private raw */ }
pub enum ParseError { Empty, Invalid { input: String, reason: String } }
pub fn parse_semver(input: &str) -> Result<Semver, ParseError>;
pub fn is_newer(current: &str, latest: &str) -> Result<bool, ParseError>;
```

From src-tauri/src/update/manifest.rs (Phase 1, untouched):
```rust
pub struct UpdateManifest { pub version: String, pub notes: String, pub pub_date: String, pub platforms: HashMap<String, PlatformAsset> }
pub struct PlatformAsset { pub signature: String, pub url: String }
pub enum ManifestError { InvalidVersion(ParseError), EmptyPlatforms, NonHttpsUrl { platform: String, url: String } }
pub fn validate(manifest: &UpdateManifest) -> Result<(), ManifestError>;
pub fn asset_for_platform<'a>(manifest: &'a UpdateManifest, platform_key: &str) -> Option<&'a PlatformAsset>;
```

From src-tauri/src/update/storage.rs (Phase 2, untouched):
```rust
#[derive(Default, Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct UpdateState {
    pub last_check_unix: i64,
    pub last_dismissed_unix: i64,
    pub skipped_versions: Vec<String>,
}
pub enum StorageError { Io(std::io::Error), Parse(serde_json::Error) }
pub fn load(path: &Path) -> Result<UpdateState, StorageError>;          // sync IO; needs spawn_blocking
pub fn save(path: &Path, state: &UpdateState) -> Result<(), StorageError>;  // sync IO; atomic via tmp+rename; precondition: parent dir exists
pub fn with_dismissed_now(state: UpdateState, now_unix: i64) -> UpdateState;
pub fn with_skipped_version(state: UpdateState, version: &str) -> UpdateState;
pub fn with_check_completed(state: UpdateState, now_unix: i64) -> UpdateState;
```

From src-tauri/src/update/checker.rs (Phase 2, untouched):
```rust
pub enum UpdateDecision {
    Notify { version: String, notes: String, download_url: String },
    SilentSkip(String),
    NoUpdate,
}
pub fn should_check_now(last_check_unix: i64, now_unix: i64, interval_seconds: i64) -> bool;
pub fn is_version_skipped(version: &str, skipped: &[String]) -> bool;
pub fn evaluate_update(
    current_version: &str,
    manifest: &UpdateManifest,
    platform_key: &str,
    skipped_versions: &[String],
    last_dismissed_unix: i64,
    now_unix: i64,
    dismiss_cooldown_seconds: i64,
) -> UpdateDecision;
```

From src-tauri/src/update/dispatcher.rs (Phase 2, untouched — all #[serde(rename_all = "camelCase")]):
```rust
pub struct UpdateAvailablePayload { pub version: String, pub notes: String, pub download_url: String }
pub struct UpdateDownloadProgressPayload { pub downloaded_bytes: u64, pub total_bytes: u64 }
pub struct UpdateInstalledPayload { pub version: String }
```

From tauri-plugin-updater 2.x (RESEARCH §1 — verified docs.rs):
```rust
use tauri_plugin_updater::UpdaterExt;
let updater = app_handle.updater()?;                  // Result<Updater, tauri_plugin_updater::Error>
let maybe: Option<Update> = updater.check().await?;   // Result<Option<Update>, ...>

pub struct Update {
    pub body: Option<String>,
    pub current_version: String,
    pub version: String,
    pub date: Option<OffsetDateTime>,
    pub target: String,
    pub download_url: Url,
    pub signature: String,
    /* ... */
}

pub async fn download_and_install<C: FnMut(usize, Option<u64>), D: FnOnce()>(
    &self, on_chunk: C, on_download_finish: D,
) -> Result<(), tauri_plugin_updater::Error>;
// CRITICAL: on_chunk first arg is per-chunk DELTA, not cumulative — caller tracks running sum.
```

From src-tauri/src/lib.rs (existing spawn_sidecar at :60-177 — mirror this pattern):
- `tauri::async_runtime::spawn(async move { ... })` for bg task spawn (NOT raw tokio::spawn).
- `app_handle: tauri::AppHandle` cloned into closure via `move`.
- `tokio::time::sleep(Duration::from_secs(...))` for cooldown.
- `app_handle.path().app_data_dir()` returns `Result<PathBuf, tauri::Error>`.
- `std::fs::create_dir_all(&dir)` for first-run dir creation.
- `app_handle.emit("event-name", &payload)` for IPC events.

From RESEARCH §11 — capability sets:
```
updater:default → allow-check, allow-download, allow-install, allow-download-and-install
process:default → allow-exit, allow-restart
```
</interfaces>

<worktree_stub_artifacts>
<!-- Phase 1+2 SUMMARYs both noted: tauri-build resource manifest checks paths exist at compile time. -->
<!-- Worktree must create these BEFORE first cargo test/build, else compile fails: -->
<!--   - src-tauri/binaries/server-x86_64-pc-windows-msvc.exe   (zero-byte, gitignored) -->
<!--   - src-tauri/binaries/mediasoup-worker.exe                 (zero-byte, gitignored) -->
<!--   - sidecar/public/.gitkeep                                 (empty, gitignored) -->
<!--   - dist/index.html                                         (empty, gitignored) -->
<!-- All four are .gitignore'd; verify with `git status --ignored`. NOT committed. -->
</worktree_stub_artifacts>
</context>

<tasks>

<task type="auto">
  <name>Task 1: deps + tauri.conf.json + capabilities (config-only, zero Rust code)</name>
  <files>src-tauri/Cargo.toml, package.json, src-tauri/tauri.conf.json, src-tauri/capabilities/default.json</files>
  <action>
**Pure-config task. NO Rust source. Produces single commit. Verifies build still compiles.**

Step 1 — `src-tauri/Cargo.toml`:
- Append under `[dependencies]` (preserve existing alphabetical-ish order):
  ```
  tauri-plugin-updater = "2"
  tauri-plugin-process = "2"
  log = "0.4"
  ```
  RESEARCH §9 + §12: `log` added explicitly (not transitive) per Tiger-Style hygiene. CONTEXT line 133 question resolved.
- Insert `[features]` block AFTER `[build-dependencies]` and BEFORE `[dependencies]` (Cargo convention):
  ```
  [features]
  integration = []
  ```
- Final `Cargo.toml` matches RESEARCH §12 "Recommended Cargo.toml" verbatim.

Step 2 — `package.json`:
- Add to `dependencies` block in alphabetical order (insert before `qrcode`):
  ```
  "@tauri-apps/plugin-process": "^2",
  "@tauri-apps/plugin-updater": "^2",
  ```
- Use `^2` (NOT `^2.10.1`) per CONTEXT decision + RESEARCH §10 — matches Rust major-version pin.

Step 3 — `src-tauri/tauri.conf.json`:
- Inside existing `bundle` block, add key `"createUpdaterArtifacts": true` (RESEARCH §3 — Phase 5 prep, generates `.sig` at build).
- Inside existing `plugins` block (currently only has `shell`), add NEW key `updater`:
  ```
  "updater": {
    "endpoints": [
      "https://github.com/roulendz/ChurchAudioStream/releases/latest/download/latest.json"
    ],
    "pubkey": "REPLACE_WITH_USER_GENERATED_PUBKEY",
    "windows": {
      "installMode": "passive"
    }
  }
  ```
- DO NOT add `"dialog": false` — v1 legacy per RESEARCH §3 + CORRECTION 1. Omit.
- Final block matches RESEARCH §12 "Recommended tauri.conf.json patch" exactly.

Step 4 — `src-tauri/capabilities/default.json`:
- Append two strings to `permissions` array, alphabetical-ish after existing entries:
  ```
  "process:default",
  "updater:default"
  ```
- RESEARCH §11 + CORRECTION 5: required for Phase 4 frontend to call `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process` JS APIs. Without these, Phase 4 starts with broken IPC.

Step 5 — Worktree stub artifacts (gitignored, NOT committed):
- Create zero-byte stubs to satisfy `tauri-build` resource manifest precheck:
  - `src-tauri/binaries/server-x86_64-pc-windows-msvc.exe`
  - `src-tauri/binaries/mediasoup-worker.exe`
  - `sidecar/public/.gitkeep`
  - `dist/index.html`
- Verify all four are gitignored: `git status --ignored` includes them, `git status` does NOT.

Step 6 — Verify build still compiles (smoke A1):
- Run `cd src-tauri && cargo build --package churchaudiostream` — must succeed.
- Run `cd src-tauri && cargo test --package churchaudiostream --lib update::` — 46 carryover tests still green.
- Run `cd .. && npm install` to materialize new JS deps.

Step 7 — Atomic commit:
```
chore(quick-uon): wire tauri-plugin-updater + plugin-process deps + capabilities

- Cargo.toml: tauri-plugin-updater "2", tauri-plugin-process "2", log "0.4"
- Cargo.toml: [features] integration = [] for gated test module
- tauri.conf.json: bundle.createUpdaterArtifacts + plugins.updater (endpoints,
  pubkey placeholder, windows.installMode "passive"); no v1 dialog key
- capabilities/default.json: process:default + updater:default for Phase 4 IPC
- package.json: @tauri-apps/plugin-updater + plugin-process ^2 alphabetical
- Pubkey is REPLACE_WITH_USER_GENERATED_PUBKEY placeholder; tauri build blocked
  on real key per CONTEXT manual step 4
```
  </action>
  <verify>
    <automated>cd src-tauri && cargo build --package churchaudiostream && cargo test --package churchaudiostream --lib update::</automated>
  </verify>
  <done>Cargo build clean (zero new warnings); 46/46 carryover tests still green; tauri.conf.json contains createUpdaterArtifacts + plugins.updater block (no dialog key); capabilities/default.json has both new permissions; package.json + Cargo.toml diff matches RESEARCH §12 exactly; commit landed.</done>
</task>

<task type="auto">
  <name>Task 2: errors.rs + state_guard.rs + mod.rs registration</name>
  <files>src-tauri/src/update/errors.rs, src-tauri/src/update/state_guard.rs, src-tauri/src/update/mod.rs</files>
  <action>
**Two new modules + mod.rs alphabetical insert. Single commit.**

Step 1 — `src-tauri/src/update/errors.rs` (NEW, ~100 lines):

```rust
//! Phase 3 typed error enum wrapping Phase 1+2 errors plus Tauri runtime errors.
//!
//! Hand-rolled `Display` + empty `std::error::Error` + `From` impls per Phase 1+2
//! precedent. NO `thiserror` dep. The IPC boundary in `commands.rs` converts to
//! `String` via `.to_string()`; internal call sites stay typed.

use crate::update::manifest::ManifestError;
use crate::update::storage::StorageError;
use crate::update::version::ParseError;

#[derive(Debug)]
pub enum UpdateError {
    Parse(ParseError),
    Manifest(ManifestError),
    Storage(StorageError),
    UpdaterPlugin(tauri_plugin_updater::Error),
    Json(serde_json::Error),
    Io(std::io::Error),
    AppDataPath(String),
    MissingPlatform { key: String },
}

impl std::fmt::Display for UpdateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UpdateError::Parse(e) => write!(f, "version parse error: {e}"),
            UpdateError::Manifest(e) => write!(f, "manifest error: {e}"),
            UpdateError::Storage(e) => write!(f, "storage error: {e}"),
            UpdateError::UpdaterPlugin(e) => write!(f, "updater plugin error: {e}"),
            UpdateError::Json(e) => write!(f, "json error: {e}"),
            UpdateError::Io(e) => write!(f, "io error: {e}"),
            UpdateError::AppDataPath(s) => write!(f, "app data path error: {s}"),
            UpdateError::MissingPlatform { key } => write!(f, "no asset for platform {key}"),
        }
    }
}

impl std::error::Error for UpdateError {}

impl From<ParseError> for UpdateError { fn from(e: ParseError) -> Self { UpdateError::Parse(e) } }
impl From<ManifestError> for UpdateError { fn from(e: ManifestError) -> Self { UpdateError::Manifest(e) } }
impl From<StorageError> for UpdateError { fn from(e: StorageError) -> Self { UpdateError::Storage(e) } }
impl From<tauri_plugin_updater::Error> for UpdateError {
    fn from(e: tauri_plugin_updater::Error) -> Self { UpdateError::UpdaterPlugin(e) }
}
impl From<serde_json::Error> for UpdateError { fn from(e: serde_json::Error) -> Self { UpdateError::Json(e) } }
impl From<std::io::Error> for UpdateError { fn from(e: std::io::Error) -> Self { UpdateError::Io(e) } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_renders_each_variant() {
        // Construct minimal instance per variant; assert Display contains discriminator phrase.
        let parse = UpdateError::Parse(ParseError::Empty);
        assert!(parse.to_string().contains("version parse error"));

        let mp = UpdateError::MissingPlatform { key: "windows-x86_64".into() };
        assert!(mp.to_string().contains("no asset for platform windows-x86_64"));

        let app = UpdateError::AppDataPath("denied".into());
        assert!(app.to_string().contains("denied"));
    }

    #[test]
    fn from_parse_error_wraps_into_update_error() {
        let err: UpdateError = ParseError::Empty.into();
        assert!(matches!(err, UpdateError::Parse(_)));
    }

    #[test]
    fn from_manifest_error_wraps_into_update_error() {
        let err: UpdateError = ManifestError::EmptyPlatforms.into();
        assert!(matches!(err, UpdateError::Manifest(_)));
    }

    #[test]
    fn from_storage_error_wraps_into_update_error() {
        let io = std::io::Error::new(std::io::ErrorKind::NotFound, "x");
        let err: UpdateError = StorageError::Io(io).into();
        assert!(matches!(err, UpdateError::Storage(_)));
    }

    #[test]
    fn from_io_error_wraps_into_update_error() {
        let io = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "x");
        let err: UpdateError = io.into();
        assert!(matches!(err, UpdateError::Io(_)));
    }

    #[test]
    fn question_mark_propagates_parse_error() {
        fn inner() -> Result<(), UpdateError> {
            let _ = crate::update::version::parse_semver("")?;
            Ok(())
        }
        assert!(matches!(inner(), Err(UpdateError::Parse(_))));
    }
}
```

Step 2 — `src-tauri/src/update/state_guard.rs` (NEW, ~30 lines):

```rust
//! Tauri-managed state wrapper for `UpdateState` + persistence path.
//!
//! `state_path` is cached on construction (resolved once from `app_data_dir`), so
//! commands and lifecycle do not re-resolve. `Mutex<UpdateState>` uses
//! `std::sync::Mutex` (NOT tokio) — lock-hold time is microseconds and storage IO
//! is wrapped in `spawn_blocking`. Caller MUST clone state out of the lock BEFORE
//! `await`-ing IO to avoid `clippy::await_holding_lock`.

use crate::update::storage::UpdateState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct UpdateStateGuard {
    pub state_path: PathBuf,
    pub state: Arc<Mutex<UpdateState>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guard_constructs_with_default_state() {
        let g = UpdateStateGuard {
            state_path: PathBuf::from("/tmp/x.json"),
            state: Arc::new(Mutex::new(UpdateState::default())),
        };
        let s = g.state.lock().unwrap();
        assert_eq!(s.last_check_unix, 0);
        assert_eq!(s.skipped_versions.len(), 0);
    }

    #[test]
    fn guard_clone_state_releases_lock() {
        let g = UpdateStateGuard {
            state_path: PathBuf::from("/tmp/x.json"),
            state: Arc::new(Mutex::new(UpdateState::default())),
        };
        // Pattern used by commands: lock → clone → drop, then async work.
        let snapshot = { g.state.lock().unwrap().clone() };
        assert_eq!(snapshot, UpdateState::default());
    }
}
```

Step 3 — Extend `src-tauri/src/update/mod.rs` to (alphabetical):

```rust
pub mod checker;
pub mod dispatcher;
pub mod errors;
pub mod manifest;
pub mod state_guard;
pub mod storage;
pub mod version;

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

(Tasks 3 and 4 will add `commands`, `lifecycle`, and feature-gated `tests_integration`.)

Step 4 — Tiger-Style audit for new files:
- `grep -n 'unwrap\|expect(' src-tauri/src/update/errors.rs src-tauri/src/update/state_guard.rs` → only inside `#[cfg(test)]`.
- `grep -n 'eprintln\|println!' src-tauri/src/update/errors.rs src-tauri/src/update/state_guard.rs` → zero.
- All bodies < 50 lines.
- No nested if-in-if.

Step 5 — Run unit tests. Expect at least 6 new tests (errors: 6, state_guard: 2 = 8 — exceeds 4-floor for errors.rs):
```
cd src-tauri && cargo test --package churchaudiostream --lib update::errors
cd src-tauri && cargo test --package churchaudiostream --lib update::state_guard
cd src-tauri && cargo test --package churchaudiostream --lib update::    # full suite
```

Floor: ≥46 (carryover) + ≥8 (errors + state_guard) = ≥54 tests.

Step 6 — Atomic commit:
```
feat(quick-uon): UpdateError enum + UpdateStateGuard + mod.rs re-exports

- errors.rs: hand-rolled enum wrapping Parse/Manifest/Storage/UpdaterPlugin/
  Json/Io/AppDataPath/MissingPlatform; manual Display + std::error::Error +
  From impls per Phase 1/2 precedent (no thiserror)
- state_guard.rs: UpdateStateGuard { state_path, state: Arc<Mutex<UpdateState>> }
  using std::sync::Mutex (lock holds microseconds; IO via spawn_blocking)
- mod.rs: alphabetical pub mod errors + state_guard; pub use UpdateError +
  UpdateStateGuard
```
  </action>
  <verify>
    <automated>cd src-tauri && cargo test --package churchaudiostream --lib update:: && cargo clippy --package churchaudiostream --lib -- -D warnings</automated>
  </verify>
  <done>≥54 tests green (46 carryover + ≥8 new in errors + state_guard); clippy clean; mod.rs has 7 alphabetical pub mod + UpdateError/UpdateStateGuard re-exports; Phase 1+2 modules untouched (`git diff --stat HEAD~ -- src-tauri/src/update/{checker,dispatcher,manifest,storage,version}.rs` empty); commit landed.</done>
</task>

<task type="auto">
  <name>Task 3: commands.rs (5 #[tauri::command] async fns + thin _impl helpers)</name>
  <files>src-tauri/src/update/commands.rs, src-tauri/src/update/mod.rs</files>
  <action>
**Five IPC commands. Each splits into thin `#[tauri::command]` wrapper that converts `UpdateError → String` at the boundary, plus typed `_impl` fn that does the real work. Single commit.**

Step 1 — `src-tauri/src/update/commands.rs` (NEW, ~250 lines):

```rust
//! Tauri IPC commands for the auto-updater.
//!
//! Five commands: check / install / dismiss / skip / get_state. Each is a thin
//! `#[tauri::command]` wrapper returning `Result<T, String>` (Tauri requires
//! `E: Serialize`); internal logic stays typed via `_impl` helpers returning
//! `Result<T, UpdateError>`. `String` exposure is exactly one line per command.
//!
//! Locking pattern: lock std::sync::Mutex inside a sync block, mutate, clone the
//! new state out, drop the lock, THEN `await` IO via `spawn_blocking`. Never hold
//! the std Mutex across an await — clippy::await_holding_lock would fire.

use crate::update::dispatcher::{
    UpdateAvailablePayload, UpdateDownloadProgressPayload, UpdateInstalledPayload,
};
use crate::update::errors::UpdateError;
use crate::update::state_guard::UpdateStateGuard;
use crate::update::storage::{
    save, with_check_completed, with_dismissed_now, with_skipped_version, UpdateState,
};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

fn current_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn snapshot_state(guard: &UpdateStateGuard) -> Result<UpdateState, UpdateError> {
    let s = guard.state.lock().map_err(|_| UpdateError::AppDataPath("state poisoned".into()))?;
    Ok(s.clone())
}

fn replace_state(guard: &UpdateStateGuard, new_state: UpdateState) -> Result<(), UpdateError> {
    let mut s = guard.state.lock().map_err(|_| UpdateError::AppDataPath("state poisoned".into()))?;
    *s = new_state;
    Ok(())
}

async fn persist_blocking(path: std::path::PathBuf, state: UpdateState) -> Result<(), UpdateError> {
    tokio::task::spawn_blocking(move || save(&path, &state))
        .await
        .map_err(|e| UpdateError::AppDataPath(format!("spawn_blocking: {e}")))??;
    Ok(())
}

// === update_check_now ===

#[tauri::command]
pub async fn update_check_now(
    state: tauri::State<'_, UpdateStateGuard>,
    app_handle: AppHandle,
) -> Result<UpdateState, String> {
    let guard_arc = guard_arc_from(&state);
    check_now_impl(&guard_arc, &app_handle).await.map_err(|e| e.to_string())
}

fn guard_arc_from(s: &tauri::State<'_, UpdateStateGuard>) -> Arc<UpdateStateGuard> {
    // Tauri's State<'_, T> derefs to &T. Wrap in Arc by cloning the inner Arcs;
    // alternatively pass &UpdateStateGuard directly. Helper kept for symmetry.
    let inner: &UpdateStateGuard = s.inner();
    Arc::new(UpdateStateGuard {
        state_path: inner.state_path.clone(),
        state: inner.state.clone(),
    })
}

async fn check_now_impl(
    guard: &UpdateStateGuard,
    app_handle: &AppHandle,
) -> Result<UpdateState, UpdateError> {
    // Drives a one-shot check independently of the bg task. Returns full state so
    // frontend Settings can render last_check_unix + skip list inline.
    let updater = app_handle.updater().map_err(UpdateError::UpdaterPlugin)?;
    let maybe_update = updater.check().await.map_err(UpdateError::UpdaterPlugin)?;
    let now = current_unix();

    let new_state = with_check_completed(snapshot_state(guard)?, now);
    replace_state(guard, new_state.clone())?;
    persist_blocking(guard.state_path.clone(), new_state.clone()).await?;

    if let Some(update) = maybe_update {
        emit_update_available(app_handle, &update)?;
    }
    Ok(new_state)
}

fn emit_update_available(app_handle: &AppHandle, update: &tauri_plugin_updater::Update) -> Result<(), UpdateError> {
    let payload = UpdateAvailablePayload {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        download_url: update.download_url.to_string(),
    };
    app_handle.emit("update:available", &payload).map_err(|e| UpdateError::AppDataPath(e.to_string()))?;
    Ok(())
}

// === update_install ===

#[tauri::command]
pub async fn update_install(app_handle: AppHandle) -> Result<(), String> {
    install_impl(&app_handle).await.map_err(|e| e.to_string())
}

async fn install_impl(app_handle: &AppHandle) -> Result<(), UpdateError> {
    // Re-fetch via plugin (per CONTEXT decision: not caching Update struct).
    let updater = app_handle.updater().map_err(UpdateError::UpdaterPlugin)?;
    let update = updater.check().await
        .map_err(UpdateError::UpdaterPlugin)?
        .ok_or(UpdateError::MissingPlatform { key: "no update available".into() })?;

    let version_for_event = update.version.clone();
    let app_for_chunk = app_handle.clone();
    let mut downloaded: u64 = 0;

    update.download_and_install(
        move |chunk_len, total_len| {
            // CRITICAL: chunk_len is per-chunk DELTA. Track running sum manually.
            downloaded = downloaded.saturating_add(chunk_len as u64);
            let payload = UpdateDownloadProgressPayload {
                downloaded_bytes: downloaded,
                total_bytes: total_len.unwrap_or(0),
            };
            let _ = app_for_chunk.emit("update:download:progress", &payload);
        },
        || { /* download finished — no-op; install proceeds */ },
    ).await.map_err(UpdateError::UpdaterPlugin)?;

    let installed = UpdateInstalledPayload { version: version_for_event };
    app_handle.emit("update:installed", &installed)
        .map_err(|e| UpdateError::AppDataPath(e.to_string()))?;
    // Phase 4 frontend calls relaunch() from @tauri-apps/plugin-process.
    // Do NOT call app_handle.restart() here — RESEARCH §2 + CORRECTION 4.
    Ok(())
}

// === update_dismiss ===

#[tauri::command]
pub async fn update_dismiss(state: tauri::State<'_, UpdateStateGuard>) -> Result<(), String> {
    let guard_arc = guard_arc_from(&state);
    dismiss_impl(&guard_arc).await.map_err(|e| e.to_string())
}

async fn dismiss_impl(guard: &UpdateStateGuard) -> Result<(), UpdateError> {
    let new_state = with_dismissed_now(snapshot_state(guard)?, current_unix());
    replace_state(guard, new_state.clone())?;
    persist_blocking(guard.state_path.clone(), new_state).await
}

// === update_skip_version ===

#[tauri::command]
pub async fn update_skip_version(
    version: String,
    state: tauri::State<'_, UpdateStateGuard>,
) -> Result<(), String> {
    let guard_arc = guard_arc_from(&state);
    skip_impl(&guard_arc, &version).await.map_err(|e| e.to_string())
}

async fn skip_impl(guard: &UpdateStateGuard, version: &str) -> Result<(), UpdateError> {
    let new_state = with_skipped_version(snapshot_state(guard)?, version);
    replace_state(guard, new_state.clone())?;
    persist_blocking(guard.state_path.clone(), new_state).await
}

// === update_get_state ===

#[tauri::command]
pub async fn update_get_state(
    state: tauri::State<'_, UpdateStateGuard>,
) -> Result<UpdateState, String> {
    let guard_arc = guard_arc_from(&state);
    snapshot_state(&guard_arc).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update::storage::UpdateState;

    #[test]
    fn current_unix_returns_positive() {
        assert!(current_unix() > 0);
    }

    #[test]
    fn snapshot_state_returns_default_when_default() {
        let g = UpdateStateGuard {
            state_path: std::path::PathBuf::from("/tmp/x.json"),
            state: Arc::new(std::sync::Mutex::new(UpdateState::default())),
        };
        let snap = snapshot_state(&g).unwrap();
        assert_eq!(snap, UpdateState::default());
    }

    #[test]
    fn replace_state_then_snapshot_returns_new() {
        let g = UpdateStateGuard {
            state_path: std::path::PathBuf::from("/tmp/x.json"),
            state: Arc::new(std::sync::Mutex::new(UpdateState::default())),
        };
        let mut new_s = UpdateState::default();
        new_s.last_check_unix = 1234;
        replace_state(&g, new_s.clone()).unwrap();
        assert_eq!(snapshot_state(&g).unwrap().last_check_unix, 1234);
    }
}
```

Notes on Tiger-Style + DRY:
- `snapshot_state` + `replace_state` + `persist_blocking` are DRY helpers, used by 4 of 5 commands.
- `current_unix` lives here too (lifecycle.rs gets its own copy in Task 4 — same one-line fn, intentionally local to module per SRP "lifecycle owns its clock"; not a DRY violation since both are 4-line trivial wrappers and live in different concerns).
- Each public + private fn body < 50 lines.
- Zero nested if-in-if.
- Lock NEVER held across `.await` — confirmed by `snapshot_state` (clone → drop) → then async.
- `snapshot_state` returns `Result` because `Mutex::lock` returns `PoisonError`; map to `UpdateError::AppDataPath("state poisoned")` per CONTEXT errors.rs decision (`AppDataPath` carries `String` for non-Serialize Tauri errors).

Step 2 — Extend `src-tauri/src/update/mod.rs` to add `pub mod commands;` (alphabetical between `checker` and `dispatcher`). Final order:
```
pub mod checker;
pub mod commands;
pub mod dispatcher;
pub mod errors;
pub mod manifest;
pub mod state_guard;
pub mod storage;
pub mod version;
```

Step 3 — Tiger-Style audit:
- `grep -n 'unwrap\|expect(' src-tauri/src/update/commands.rs` → only inside `#[cfg(test)]`.
- `grep -n 'eprintln\|println!' src-tauri/src/update/commands.rs` → zero.
- `grep -nE 'if .* \{$' src-tauri/src/update/commands.rs` followed by `grep -A 10 'if let Some'` — manual confirm flat early-return.
- `cargo clippy --package churchaudiostream --lib -- -D warnings` — must pass `clippy::await_holding_lock` (no Mutex held across await).

Step 4 — Run tests. Floor ≥ 54 + 3 commands tests = ≥57:
```
cd src-tauri && cargo test --package churchaudiostream --lib update::commands
cd src-tauri && cargo test --package churchaudiostream --lib update::    # full
cd src-tauri && cargo clippy --package churchaudiostream --lib -- -D warnings
```

Step 5 — Atomic commit:
```
feat(quick-uon): five #[tauri::command] async fns for update IPC

- update_check_now: drives one-shot check; emits update:available on Some(Update);
  persists last_check_unix + returns full state for frontend Settings render
- update_install: re-fetches via updater().check(), calls download_and_install
  with running-sum chunk callback (per-chunk delta), emits download:progress +
  installed; does NOT call restart (Phase 4 frontend owns relaunch via
  @tauri-apps/plugin-process)
- update_dismiss: persists last_dismissed_unix = now
- update_skip_version: appends version to skip list (storage helper dedupes)
- update_get_state: snapshot clone of UpdateState
- All commands: thin Result<T, String> wrapper → typed Result<T, UpdateError> _impl;
  lock pattern is snapshot→drop→await, never held across .await
```
  </action>
  <verify>
    <automated>cd src-tauri && cargo test --package churchaudiostream --lib update:: && cargo clippy --package churchaudiostream --lib -- -D warnings</automated>
  </verify>
  <done>≥57 tests green; clippy clean (specifically no `clippy::await_holding_lock`); commands.rs exports five `#[tauri::command]` fns; mod.rs has 8 alphabetical pub mod (no tests_integration yet); commit landed.</done>
</task>

<task type="auto">
  <name>Task 4: lifecycle.rs (bg task) + lib.rs wiring + tests_integration.rs + smoke A1</name>
  <files>src-tauri/src/update/lifecycle.rs, src-tauri/src/update/tests_integration.rs, src-tauri/src/update/mod.rs, src-tauri/src/lib.rs</files>
  <action>
**Final task: bg lifecycle, app wiring, gated integration tests, A1 smoke. Single commit.**

Step 1 — `src-tauri/src/update/lifecycle.rs` (NEW, ~180 lines):

```rust
//! Bg task lifecycle for the auto-updater.
//!
//! `start()` runs synchronously: resolves app_data_dir, ensures it exists, loads
//! UpdateState from disk, constructs UpdateStateGuard, registers via manage().
//! Then spawns the async run_loop which polls every 6h (or immediately if
//! CAS_UPDATER_FORCE_CHECK=1). Loop body is fail-soft: any UpdateError from
//! run_one_cycle is logged and the loop sleeps and retries.
//!
//! A1 mitigation: the bg task wraps `app_handle.updater()` in a match. If the
//! placeholder pubkey causes Builder error variants to fire, log::warn! and skip
//! the cycle without panicking the app.

use crate::update::checker::{evaluate_update, should_check_now, UpdateDecision};
use crate::update::dispatcher::UpdateAvailablePayload;
use crate::update::errors::UpdateError;
use crate::update::manifest::{PlatformAsset, UpdateManifest};
use crate::update::state_guard::UpdateStateGuard;
use crate::update::storage::{load, save, with_check_completed, UpdateState};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

const CHECK_INTERVAL_SECONDS: u64 = 6 * 3600;
const DISMISS_COOLDOWN_SECONDS: i64 = 24 * 3600;
const FORCE_CHECK_ENV: &str = "CAS_UPDATER_FORCE_CHECK";

pub fn start(app_handle: &AppHandle) -> Result<(), UpdateError> {
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

    let handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        run_loop(handle).await;
    });
    Ok(())
}

async fn run_loop(app_handle: AppHandle) {
    loop {
        if let Err(e) = run_one_cycle(&app_handle).await {
            log::warn!("[update] cycle failed: {e}");
        }
        tokio::time::sleep(Duration::from_secs(CHECK_INTERVAL_SECONDS)).await;
    }
}

async fn run_one_cycle(app_handle: &AppHandle) -> Result<(), UpdateError> {
    let force = std::env::var(FORCE_CHECK_ENV).is_ok();
    let now = current_unix();
    let last_check = read_last_check(app_handle)?;
    if !force && !should_check_now(last_check, now, CHECK_INTERVAL_SECONDS as i64) {
        return Ok(());
    }

    // A1 guard: if Builder/check error fires (placeholder pubkey or transient
    // network failure), log + return Ok — the loop sleeps and retries.
    let maybe_update = match try_check_for_update(app_handle).await {
        Ok(opt) => opt,
        Err(e) => {
            log::warn!("[update] check failed (skipping cycle): {e}");
            return Ok(());
        }
    };

    persist_check_completed(app_handle, now)?;
    let Some(update) = maybe_update else {
        log::info!("[update] no update available; sleeping");
        return Ok(());
    };

    let decision = evaluate_against_state(app_handle, &update, now)?;
    handle_decision(app_handle, decision)?;
    Ok(())
}

async fn try_check_for_update(app_handle: &AppHandle) -> Result<Option<tauri_plugin_updater::Update>, UpdateError> {
    let updater = app_handle.updater().map_err(UpdateError::UpdaterPlugin)?;
    let maybe = updater.check().await.map_err(UpdateError::UpdaterPlugin)?;
    Ok(maybe)
}

fn read_last_check(app_handle: &AppHandle) -> Result<i64, UpdateError> {
    let state: tauri::State<'_, UpdateStateGuard> = app_handle.state::<UpdateStateGuard>();
    let s = state.state.lock().map_err(|_| UpdateError::AppDataPath("state poisoned".into()))?;
    Ok(s.last_check_unix)
}

fn persist_check_completed(app_handle: &AppHandle, now: i64) -> Result<(), UpdateError> {
    let state: tauri::State<'_, UpdateStateGuard> = app_handle.state::<UpdateStateGuard>();
    let new_state = {
        let mut s = state.state.lock().map_err(|_| UpdateError::AppDataPath("state poisoned".into()))?;
        *s = with_check_completed(s.clone(), now);
        s.clone()
    };
    save(&state.state_path, &new_state)?;
    Ok(())
}

fn evaluate_against_state(app_handle: &AppHandle, update: &tauri_plugin_updater::Update, now: i64) -> Result<UpdateDecision, UpdateError> {
    let manifest = manifest_from_update(update);
    let platform_key = current_platform_key();
    let state: tauri::State<'_, UpdateStateGuard> = app_handle.state::<UpdateStateGuard>();
    let (skipped, last_dismissed) = {
        let s = state.state.lock().map_err(|_| UpdateError::AppDataPath("state poisoned".into()))?;
        (s.skipped_versions.clone(), s.last_dismissed_unix)
    };
    Ok(evaluate_update(
        &update.current_version,
        &manifest,
        platform_key,
        &skipped,
        last_dismissed,
        now,
        DISMISS_COOLDOWN_SECONDS,
    ))
}

fn manifest_from_update(update: &tauri_plugin_updater::Update) -> UpdateManifest {
    let mut platforms: HashMap<String, PlatformAsset> = HashMap::new();
    platforms.insert(
        update.target.clone(),
        PlatformAsset {
            signature: update.signature.clone(),
            url: update.download_url.to_string(),
        },
    );
    UpdateManifest {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        pub_date: update.date.map(|d| d.to_string()).unwrap_or_default(),
        platforms,
    }
}

fn handle_decision(app_handle: &AppHandle, decision: UpdateDecision) -> Result<(), UpdateError> {
    match decision {
        UpdateDecision::Notify { version, notes, download_url } => {
            let payload = UpdateAvailablePayload { version, notes, download_url };
            app_handle.emit("update:available", &payload)
                .map_err(|e| UpdateError::AppDataPath(e.to_string()))?;
            Ok(())
        }
        UpdateDecision::SilentSkip(reason) => {
            log::info!("[update] silent skip: {reason}");
            Ok(())
        }
        UpdateDecision::NoUpdate => {
            log::info!("[update] no decision-relevant update");
            Ok(())
        }
    }
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
    else if cfg!(all(target_os = "linux", target_arch = "aarch64")) { "linux-aarch64" }
    else { "unknown" }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_unix_returns_positive() {
        assert!(current_unix() > 0);
    }

    #[test]
    fn current_platform_key_is_known_target() {
        let key = current_platform_key();
        let known = ["windows-x86_64", "darwin-aarch64", "darwin-x86_64", "linux-x86_64", "linux-aarch64", "unknown"];
        assert!(known.contains(&key), "unexpected platform key: {key}");
    }

    #[test]
    fn dismiss_cooldown_is_24_hours() {
        assert_eq!(DISMISS_COOLDOWN_SECONDS, 86_400);
    }

    #[test]
    fn check_interval_is_6_hours() {
        assert_eq!(CHECK_INTERVAL_SECONDS, 21_600);
    }
}
```

Tiger-Style:
- Each fn body < 50 lines (largest: `run_one_cycle` ~25 lines).
- Zero nested if-in-if (all flat early-return + match).
- Zero `unwrap`/`expect` outside `#[cfg(test)]`.
- Zero `eprintln`/`println` — uses `log::warn!`/`log::info!` only.
- A1 guarded: `try_check_for_update` returns `Result`, caller `match`es and returns `Ok(())` on `Err` after log.

Step 2 — `src-tauri/src/update/tests_integration.rs` (NEW, ~120 lines, gated):

```rust
#![cfg(feature = "integration")]

//! Integration tests gated by `--features integration`.
//!
//! These exercise UpdateState round-trip via real storage IO + evaluate_update
//! against fixtures. Same pure-Rust pattern as Phase 2 inline tests; flag is the
//! master-plan §3 step 7 requirement (lines 382-388).

use crate::update::checker::{evaluate_update, UpdateDecision};
use crate::update::manifest::{PlatformAsset, UpdateManifest};
use crate::update::storage::{
    load, save, with_check_completed, with_dismissed_now, with_skipped_version, UpdateState,
};
use std::collections::HashMap;
use tempfile::tempdir;

fn fixture_manifest(version: &str, url: &str) -> UpdateManifest {
    let mut platforms = HashMap::new();
    platforms.insert(
        "windows-x86_64".to_string(),
        PlatformAsset { signature: "sig".into(), url: url.into() },
    );
    UpdateManifest {
        version: version.into(),
        notes: "release notes".into(),
        pub_date: "2026-05-01T00:00:00Z".into(),
        platforms,
    }
}

#[test]
fn test_update_state_persists_across_load_save() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("update-state.json");

    let mut s = UpdateState::default();
    s = with_check_completed(s, 1_000);
    s = with_dismissed_now(s, 2_000);
    s = with_skipped_version(s, "0.2.0");
    save(&path, &s).unwrap();

    let loaded = load(&path).unwrap();
    assert_eq!(loaded, s);
    assert_eq!(loaded.last_check_unix, 1_000);
    assert_eq!(loaded.last_dismissed_unix, 2_000);
    assert_eq!(loaded.skipped_versions, vec!["0.2.0".to_string()]);
}

#[test]
fn test_skip_version_then_check_returns_silent_skip() {
    let manifest = fixture_manifest("0.2.0", "https://example.com/installer.exe");
    let skipped = vec!["0.2.0".to_string()];
    let decision = evaluate_update(
        "0.1.0", &manifest, "windows-x86_64", &skipped,
        0, 10_000, 86_400,
    );
    match decision {
        UpdateDecision::SilentSkip(reason) => assert!(reason.contains("0.2.0") || reason.contains("skip")),
        other => panic!("expected SilentSkip, got {other:?}"),
    }
}

#[test]
fn test_dismiss_then_check_within_cooldown_returns_silent_skip() {
    let manifest = fixture_manifest("0.2.0", "https://example.com/installer.exe");
    let now = 100_000;
    let dismissed_recently = now - 3_600;        // 1h ago, within 24h cooldown
    let decision = evaluate_update(
        "0.1.0", &manifest, "windows-x86_64", &[],
        dismissed_recently, now, 86_400,
    );
    assert!(matches!(decision, UpdateDecision::SilentSkip(_)),
        "expected SilentSkip during cooldown, got {decision:?}");
}

#[test]
fn test_dismiss_after_cooldown_returns_notify() {
    let manifest = fixture_manifest("0.2.0", "https://example.com/installer.exe");
    let now = 1_000_000;
    let dismissed_long_ago = now - (25 * 3_600); // 25h ago, past 24h cooldown
    let decision = evaluate_update(
        "0.1.0", &manifest, "windows-x86_64", &[],
        dismissed_long_ago, now, 86_400,
    );
    match decision {
        UpdateDecision::Notify { version, .. } => assert_eq!(version, "0.2.0"),
        other => panic!("expected Notify after cooldown, got {other:?}"),
    }
}
```

Step 3 — Final `src-tauri/src/update/mod.rs`:

```rust
pub mod checker;
pub mod commands;
pub mod dispatcher;
pub mod errors;
pub mod lifecycle;
pub mod manifest;
pub mod state_guard;
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

Step 4 — `src-tauri/src/lib.rs` — minimal targeted edits (NOT a rewrite; preserve existing `spawn_sidecar`, `LogBuffer`, `AppLogBuffer`, `SidecarChild`, `get_buffered_logs`, `on_window_event`, etc.).

Three precise diffs:

(a) Inside `tauri::Builder::default()` chain, add two `.plugin(...)` calls AFTER `.plugin(tauri_plugin_shell::init())`:

```rust
.plugin(tauri_plugin_shell::init())
.plugin(tauri_plugin_updater::Builder::new().build())
.plugin(tauri_plugin_process::init())
```

(b) Extend `invoke_handler` arg list (alphabetically by command name; keep `get_buffered_logs` first):

```rust
.invoke_handler(tauri::generate_handler![
    get_buffered_logs,
    crate::update::commands::update_check_now,
    crate::update::commands::update_dismiss,
    crate::update::commands::update_get_state,
    crate::update::commands::update_install,
    crate::update::commands::update_skip_version,
])
```

(c) Inside the `setup` closure, call `lifecycle::start` BEFORE `spawn_sidecar`:

```rust
.setup({
    let sidecar_should_run = sidecar_should_run.clone();
    move |app| {
        crate::update::lifecycle::start(app.handle())
            .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
        spawn_sidecar(app.handle().clone(), sidecar_should_run);
        Ok(())
    }
})
```

The `UpdateStateGuard` is `manage()`'d INSIDE `lifecycle::start` — do NOT call `.manage()` for it in the Builder chain. Keep existing `.manage(AppLogBuffer(...))` and `.manage(SidecarChild(...))`.

Do NOT modify any `eprintln!` in existing `spawn_sidecar` — out of scope per RESEARCH §9.

Step 5 — Verify compile + tests + clippy + smoke A1.

```bash
cd src-tauri && cargo build --package churchaudiostream                                       # A1 smoke: must NOT panic with placeholder pubkey
cd src-tauri && cargo test --package churchaudiostream --lib update::                         # ≥ 56 tests (46 + ≥10 new)
cd src-tauri && cargo test --package churchaudiostream --features integration --lib update::  # adds 4 named tests
cd src-tauri && cargo clippy --package churchaudiostream --all-targets -- -D warnings         # zero warnings
```

Expected unit-test floor: 46 (carryover) + 6 (errors) + 2 (state_guard) + 3 (commands) + 4 (lifecycle) = **61 unit** + **4 integration** = **65 total**.

A1 smoke verification: run `cargo build` from worktree. If `tauri-plugin-updater` Builder panics on the placeholder pubkey at compile time, the build fails — escalate to user with the exact error + the RESEARCH A1 mitigation note (we already wrap in match, so a runtime-only panic would still be caught at app startup). Document outcome in SUMMARY.md "A1 verification".

Step 6 — Final Tiger-Style + DRY/SRP audit:
- `grep -nE 'unwrap\(|expect\(' src-tauri/src/update/{commands,lifecycle,errors,state_guard,tests_integration}.rs | grep -v '#\[cfg(test)\]\|mod tests\|tests::\|let .* = .*\.unwrap\(\); *$' | grep -v 'integration'`  → only inside test modules.
- `grep -nE 'eprintln\!|println\!' src-tauri/src/update/{commands,lifecycle,errors,state_guard,tests_integration}.rs` → zero.
- `grep -c 'fn ' src-tauri/src/update/lifecycle.rs` should be > 8 (helpers extracted to keep run_one_cycle ≤ 50 lines).
- `git diff --stat HEAD~3 -- src-tauri/src/update/{checker,dispatcher,manifest,storage,version}.rs` → empty.

Step 7 — Atomic commit:
```
feat(quick-uon): bg lifecycle + lib.rs wiring + integration tests + A1 smoke

- lifecycle.rs: start() syncs app_data_dir + load + manage(UpdateStateGuard);
  spawn run_loop with 6h cooldown + CAS_UPDATER_FORCE_CHECK env override;
  fail-soft try_check_for_update guards A1 (placeholder pubkey) — log::warn
  + skip cycle on any updater plugin error (no panic)
- lifecycle.rs: manifest_from_update bridges Update -> UpdateManifest so Phase 2
  evaluate_update can apply skip + dismiss-cooldown rules; emits update:available
  on Notify decision
- tests_integration.rs: 4 named tests gated by --features integration
- mod.rs: pub mod commands + lifecycle + tests_integration; full re-exports
- lib.rs: register tauri_plugin_updater + tauri_plugin_process; setup hook calls
  lifecycle::start before spawn_sidecar; invoke_handler appends 5 update commands
- A1 verified: cargo build succeeds with placeholder pubkey (no startup panic)
```
  </action>
  <verify>
    <automated>cd src-tauri && cargo build --package churchaudiostream && cargo test --package churchaudiostream --lib update:: && cargo test --package churchaudiostream --features integration --lib update:: && cargo clippy --package churchaudiostream --all-targets -- -D warnings</automated>
  </verify>
  <done>cargo build clean (A1 smoke pass — placeholder pubkey does not panic); ≥61 unit tests + 4 integration tests all green; clippy --all-targets clean; lib.rs registers 2 new plugins + 5 new commands + lifecycle::start in setup; mod.rs has 9 alphabetical pub mod + feature-gated tests_integration; Phase 1+2 modules untouched (verified via git diff); commit landed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| GitHub releases endpoint → Tauri updater plugin | Untrusted manifest JSON traverses HTTPS; plugin enforces TLS + Ed25519 signature verification |
| Tauri updater plugin → application code | Trusted within process; plugin already validated signature/HTTPS/semver |
| WebView frontend → IPC commands | Frontend in same trust zone as host (bundled), but IPC capability gates required |
| Disk (update-state.json) → application memory | State file is local; corrupt/tampered file → loud StorageError per Phase 2 contract |
| Environment variables → bg task | `CAS_UPDATER_FORCE_CHECK` lets dev override 6h cooldown; not a privilege escalation |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-uon-01 | Tampering | manifest fetch (lifecycle::run_one_cycle) | mitigate | tauri-plugin-updater enforces HTTPS via Error::InsecureTransportProtocol; minisign Ed25519 signature verification cannot be disabled (RESEARCH §1) |
| T-uon-02 | Tampering | downgrade attack (older signed version) | mitigate | Phase 1 is_newer() rejects + plugin's check() semver comparison rejects (RESEARCH §1) |
| T-uon-03 | Tampering | placeholder pubkey ships to production | accept (Phase 3) → mitigate (Phase 5) | Phase 3 embeds REPLACE_WITH_USER_GENERATED_PUBKEY placeholder; Phase 5 CI must `grep -F REPLACE_WITH_USER_GENERATED_PUBKEY` and fail build. Documented as user manual step 4 in SUMMARY |
| T-uon-04 | Denial of Service | bg task crashes silently disable updates | mitigate | run_loop is fail-soft: any UpdateError caught + logged via log::warn; loop never exits; manual trigger via update_check_now IPC available |
| T-uon-05 | Denial of Service | state file corruption blocks startup | accept | Phase 2 contract: corrupt-JSON → loud StorageError::Parse; lifecycle::start propagates error via ? — app fails to start, user deletes %APPDATA%/.../update-state.json, retries (per Phase 2 module doc) |
| T-uon-06 | Denial of Service | Mutex held across .await deadlocks bg task | mitigate | Lock pattern enforced: snapshot_state clones inside sync block then drops lock BEFORE .await; clippy::await_holding_lock catches violations at CI |
| T-uon-07 | Information Disclosure | UpdateError variant strings leak internal details over IPC | accept | Display strings are intentionally human-readable for frontend toast; no secrets (paths/keys) in any variant. AppDataPath(String) carries OS error message — acceptable disclosure for local-only IPC |
| T-uon-08 | Elevation of Privilege | install path uses non-bundled installer | mitigate | tauri.conf.json windows.installMode = "passive" — uses bundled NSIS installer, no admin escalation; signed by minisign before download |
| T-uon-09 | Tampering | update_install bypasses check (replay attack) | mitigate | update_install re-fetches via updater().check() — plugin re-validates signature on every download (RESEARCH §1) |
| T-uon-10 | Spoofing | unauthorized frontend invokes update commands | mitigate | Tauri capability system: updater:default + process:default scoped to "main" window only (capabilities/default.json windows: ["main"]) |
| T-uon-11 | Repudiation | lost private key = no rollback path | accept | Documented in CONTEXT manual step 5 + master plan §7 risks: SUMMARY.md tells user to back up `~/.tauri/cas-update.key` and document recovery in README.md "Building releases" |
</threat_model>

<verification>
## Phase-Level Verification

After all 4 task commits land:

```bash
# 1. Test floor (default)
cd src-tauri && cargo test --package churchaudiostream --lib update::
# Expected: ≥56 passed (46 carryover + ≥10 new)

# 2. Test floor (with integration feature)
cd src-tauri && cargo test --package churchaudiostream --features integration --lib update::
# Expected: ≥60 passed (above + 4 named integration tests)

# 3. Clippy clean
cd src-tauri && cargo clippy --package churchaudiostream --all-targets -- -D warnings
# Expected: zero warnings

# 4. A1 smoke (placeholder pubkey doesn't panic at build)
cd src-tauri && cargo build --package churchaudiostream
# Expected: clean build

# 5. Phase 1+2 modules truly untouched
cd src-tauri && git log --oneline -- src/update/version.rs src/update/manifest.rs src/update/checker.rs src/update/storage.rs src/update/dispatcher.rs | head -20
# Expected: only Phase 1+2 commits (qq5 + t83), zero new commits from Phase 3

# 6. Final mod.rs structure
cat src-tauri/src/update/mod.rs
# Expected: 9 alphabetical pub mod (checker→commands→dispatcher→errors→lifecycle→manifest→state_guard→storage→version)
# Plus #[cfg(feature = "integration")] pub mod tests_integration;
# Plus full re-export block

# 7. Tiger-Style audit (new files only)
grep -rnE 'unwrap\(|expect\(' src-tauri/src/update/{commands,lifecycle,errors,state_guard,tests_integration}.rs | grep -vE '(#\[cfg\(test\)\]|mod tests|::tests::|test_)' || echo OK
# Expected: OK (zero matches outside test modules)

grep -rnE 'eprintln!|println!' src-tauri/src/update/{commands,lifecycle,errors,state_guard,tests_integration}.rs || echo OK
# Expected: OK (zero matches)

# 8. Manual SUMMARY check
# Verify SUMMARY.md "Manual Steps Required" lists exactly 5 user-driven actions
# verbatim from CONTEXT.md lines 33-38:
#   1. npx tauri signer generate -w "$USERPROFILE/.tauri/cas-update.key"
#   2. .env: TAURI_SIGNING_PRIVATE_KEY=...
#   3. .gitignore .env
#   4. Replace REPLACE_WITH_USER_GENERATED_PUBKEY in tauri.conf.json
#   5. README.md "Building releases" section
```

**BLOCKED — agent must NOT run:**
- `npm run tauri build` — requires real pubkey (user manual step 4); document blocker in SUMMARY.md "Exit Criteria".
</verification>

<success_criteria>
**All these MUST be true before phase verification:**

- [ ] 4 atomic commits on master (one per task), each with task-specific message
- [ ] `cargo test --package churchaudiostream --lib update::` ≥ 56 tests, all green
- [ ] `cargo test --package churchaudiostream --features integration --lib update::` ≥ 60 tests (4 named + above), all green
- [ ] `cargo clippy --package churchaudiostream --all-targets -- -D warnings` clean
- [ ] `cargo build --package churchaudiostream` clean (A1 smoke: placeholder pubkey does not panic at startup)
- [ ] `tauri.conf.json` contains `bundle.createUpdaterArtifacts: true` + `plugins.updater` block (NO `dialog` key)
- [ ] `capabilities/default.json` permissions include `process:default` AND `updater:default`
- [ ] `package.json` dependencies include `@tauri-apps/plugin-updater ^2` AND `@tauri-apps/plugin-process ^2`
- [ ] `Cargo.toml` dependencies include `tauri-plugin-updater = "2"`, `tauri-plugin-process = "2"`, `log = "0.4"`; features include `integration = []`
- [ ] `src-tauri/src/update/` contains 9 production modules (existing 5 + commands + errors + lifecycle + state_guard) + 1 feature-gated tests_integration
- [ ] `lib.rs` registers `tauri_plugin_updater::Builder::new().build()` AND `tauri_plugin_process::init()`
- [ ] `lib.rs` setup hook calls `crate::update::lifecycle::start(app.handle())?` BEFORE `spawn_sidecar`
- [ ] `lib.rs` `invoke_handler` registers 5 update commands
- [ ] Phase 1+2 modules untouched: `git diff HEAD~3 -- src/update/{checker,dispatcher,manifest,storage,version}.rs` empty
- [ ] Tiger-Style: zero unwrap/expect/eprintln/println in new code outside `#[cfg(test)]`
- [ ] No fn body > 50 lines in new code
- [ ] No nested-if-in-if in new code
- [ ] SUMMARY.md "Manual Steps Required" lists 5 user-driven actions verbatim from CONTEXT
- [ ] SUMMARY.md "A1 Verification" notes whether placeholder pubkey caused any startup issue
- [ ] SUMMARY.md "Exit Criteria" documents `npm run tauri build` is BLOCKED on user manual step 4
</success_criteria>

<output>
After completion, create `.planning/quick/260501-uon-phase-3-auto-updater-tauri-plugin-wiring/260501-uon-SUMMARY.md`.

Required SUMMARY sections:
- Frontmatter: quick_id, description, status: complete, phase: quick, plan: 03, type: execute, wave: 1, completed (date), commits (4 hashes), requirements (P3-DEPS, P3-CONF, P3-CAP, P3-ERR, P3-CMD, P3-LIFE, P3-INT), tests (total ≥60, breakdown, acceptance_pass: true)
- Tasks (4 with commit hashes)
- Acceptance command output (paste from cargo test runs)
- Tiger-Style + DRY/SRP audit table
- Public surface contract verification (5 commands + lifecycle::start signatures)
- Manual Steps Required (5 user-driven actions verbatim from CONTEXT lines 33-38)
- A1 Verification (cargo build + cargo test outcome with placeholder pubkey)
- Exit Criteria (npm run tauri build BLOCKED until user replaces pubkey)
- Deviations from Plan
- Threat Flags (any STRIDE items not mitigated as planned)
- Self-Check (files exist; commits on master; tests passing; clippy clean; Phase 1+2 untouched)
</output>
