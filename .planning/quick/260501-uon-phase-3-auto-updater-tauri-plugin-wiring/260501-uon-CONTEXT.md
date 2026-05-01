# Quick Task 260501-uon: Phase 3 auto-updater (Tauri plugin wiring + IPC events + bg task) - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning
**Depends on:** Phase 1 (260501-qq5) + Phase 2 (260501-t83) — already merged at `1497727`

<domain>
## Task Boundary

Implement **Phase 3** of `.planning/plans/auto-updater-plan.md` (master spec lines 304-393).

Scope:
- `src-tauri/Cargo.toml` — add `tauri-plugin-updater = "2"` + `tauri-plugin-process = "2"` under `[dependencies]`. Add `[features]` block with `integration = []`.
- `package.json` (root) — add `@tauri-apps/plugin-updater` ^2 + `@tauri-apps/plugin-process` ^2.
- `src-tauri/tauri.conf.json` — add `plugins.updater` block per master plan §Phase 3 step 3 (lines 331-342). `pubkey` = `REPLACE_WITH_USER_GENERATED_PUBKEY` placeholder.
- `src-tauri/src/update/commands.rs` — five `#[tauri::command]` async functions: `update_check_now`, `update_install`, `update_dismiss`, `update_skip_version`, `update_get_state`.
- `src-tauri/src/update/lifecycle.rs` — `start(app_handle: &AppHandle) -> Result<(), UpdateError>` spawns the bg check task.
- `src-tauri/src/update/errors.rs` — `UpdateError` enum wrapping `ParseError` + `ManifestError` + `StorageError` + `tauri_plugin_updater::Error` + `serde_json::Error` + `std::io::Error`.
- `src-tauri/src/update/state_guard.rs` — `UpdateStateGuard(Arc<Mutex<UpdateState>>)` Tauri-managed state wrapper. (May fold into `commands.rs` if planner thinks it small enough.)
- `src-tauri/src/update/mod.rs` — register `pub mod commands; pub mod errors; pub mod lifecycle;` (alphabetical with existing 5).
- `src-tauri/src/lib.rs` — register two plugins, manage `UpdateStateGuard`, extend `invoke_handler` with five new commands, spawn `lifecycle::start` in setup hook.

Out of scope:
- ❌ React UI (Phase 4 — master plan :395-465)
- ❌ GitHub Actions `latest.json` workflow (Phase 5 — master plan :467-507)
- ❌ Generating the actual signing keypair (user-driven; agent embeds placeholder)
- ❌ `npm run tauri build` verification (blocked on real pubkey)
- ❌ Modifying Phase 1/2 modules (`version.rs`, `manifest.rs`, `checker.rs`, `storage.rs`, `dispatcher.rs`) — only `mod.rs` gets one-line additions.

## Manual Steps Required (USER-DRIVEN — agent must NOT execute)

Documented in SUMMARY.md after agent finishes. User runs these to make `npm run tauri build` succeed:

1. Run `npx tauri signer generate -w "$USERPROFILE/.tauri/cas-update.key"` from PowerShell (master plan :309-314).
2. Copy printed private key path to `.env` as `TAURI_SIGNING_PRIVATE_KEY=...` (master plan :313).
3. Verify `.env` is gitignored: `grep -F .env .gitignore` — append if missing (master plan :314).
4. Paste printed public key into `tauri.conf.json` `plugins.updater.pubkey` replacing the `REPLACE_WITH_USER_GENERATED_PUBKEY` placeholder (master plan :316 + :339).
5. Document signing-key path + recovery procedure in `README.md` "Building releases" section (master plan :315 + :617-619).

</domain>

<decisions>
## Implementation Decisions

User skipped re-discussion (master plan §10 line 670: "this plan IS the discuss phase"). Phase 1 + 2 set the precedent.

### `#[tauri::command]` return type (IPC boundary contract)
- **Decision:** all five commands return `Result<T, String>`. Internal logic uses typed `UpdateError`. Convert at the boundary via `.map_err(|e| e.to_string())`.
- **Why:** Tauri commands require `E: Serialize`. Hand-rolled `UpdateError` wraps non-Serialize types (`tauri_plugin_updater::Error`, `std::io::Error`, `serde_json::Error`) — adding `Serialize` is impractical and breaks the typed-error invariant. The `String` exemption is documented as a master-plan §4 carve-out at the IPC boundary only; internal call sites keep typed `Result<T, UpdateError>`.
- **Caveman commit-message convention:** "convert UpdateError to String at IPC boundary; internal stays typed".

### `UpdateStateGuard` shape
- **Decision:** `pub struct UpdateStateGuard { state_path: PathBuf, state: Arc<Mutex<UpdateState>> }` lives in either `state_guard.rs` (separate module) or as a private item in `commands.rs` — planner picks based on size.
- **Why path inside the guard:** lifecycle task + commands both need the path to call `storage::save`. Storing it once on construction (from `app_handle.path().app_data_dir()` resolution) means no command has to re-resolve it. SRP: guard owns "where the state lives + the state itself".
- **Mutex over RwLock:** writes are infrequent (one `save` per dismiss/skip/check-completed event) but reads-followed-by-writes are typical (read state → mutate via `with_*` helper → save). `Mutex` is simpler and the lock-hold time is microseconds. RwLock would be premature.
- **Tokio Mutex vs std Mutex:** `std::sync::Mutex` because lock holds are non-async (storage IO is wrapped in `spawn_blocking` per Phase 2 contract; commands `await` only OUTSIDE the lock scope). Avoids the "tokio lock held across await" footgun.

### `app_data_dir` resolution + first-run dir creation
- **Decision:** `lifecycle::start` resolves `app_handle.path().app_data_dir()?`, runs `std::fs::create_dir_all(&dir)?` (idempotent), constructs `state_path = dir.join("update-state.json")`, calls `storage::load(&state_path)?` (returns `default()` for missing/empty), and stores the constructed `UpdateStateGuard` via `app_handle.manage(...)`.
- **Why agent does it in lifecycle, not in `commands::*`:** SRP — commands are thin wrappers; lifecycle owns startup orchestration. Phase 2 storage.rs module doc made the parent-dir precondition explicit.

### Background check task (lifecycle.rs)
- **Decision:** `tokio::spawn` after `manage(UpdateStateGuard)` is registered. Loop body:
  1. read `state.last_check_unix` under lock (release lock immediately).
  2. compute `should_check_now(last, now_unix(), 6 * 3600)` (6-hour cooldown per master plan :622). If `CAS_UPDATER_FORCE_CHECK=1` env var, skip the gate.
  3. if false, sleep 6 hours and loop. (`tokio::time::sleep`).
  4. if true: fetch via `app_handle.updater()?.check().await?` → `tauri_plugin_updater::Update`.
  5. construct an `UpdateManifest`-equivalent `(version, notes, platforms_with_one_entry_for_current_platform)` from the `Update` struct, plus `current_version` from `app_handle.config().version`.
  6. resolve `platform_key` from `tauri_plugin_os::platform()` + arch (or compile-time `cfg!(target_os = ..., target_arch = ...)` since Tauri runs natively only).
  7. read `skipped_versions` + `last_dismissed_unix` under lock; release; call `evaluate_update(...)`.
  8. on `Notify { ... }`: emit `update:available` with `UpdateAvailablePayload` derived 1:1 from the `Notify` payload (Phase 2 review's MA-04 fix made these field-shape identical).
  9. acquire lock, apply `with_check_completed(now)`, release; spawn-blocking `storage::save`.
  10. sleep 6 hours, loop.
- **Decision: simplest possible mapping from `tauri_plugin_updater::Update` to our `UpdateManifest`.** The plugin already validates the manifest internally (signature, https, version-parse). Phase 3 still calls our `evaluate_update` because it owns the user-skip / dismiss-cooldown logic that the plugin doesn't know about.
- **No retry logic on fetch error:** log and proceed — a transient network failure shouldn't crash the bg task. Just sleep 6h and retry next cycle.

### `update_install` flow
- **Decision:** `update_check_now` returns the `tauri_plugin_updater::Update` handle to the frontend implicitly via emitted event payload only (NOT through the `Result`); `update_install` re-fetches via `updater()?.check().await?` and calls `update.download_and_install(on_chunk, on_finished).await`.
- **Why re-fetch instead of caching:** caching the `Update` struct in `UpdateStateGuard` couples mutex with async lifetime, and the plugin's check is fast (it already cached HTTP response server-side). Simpler. Trade-off: ~50ms latency on user click "Update now". Acceptable.
- **`on_chunk` callback:** emits `UpdateDownloadProgressPayload` via `app_handle.emit("update:download:progress", ...)`.
- **`on_finished` callback:** emits `UpdateInstalledPayload` via `app_handle.emit("update:installed", ...)`. Plugin then handles app restart.

### `update_dismiss` / `update_skip_version` / `update_get_state` semantics
- `update_dismiss(state: tauri::State<'_, UpdateStateGuard>) -> Result<(), String>`: lock → `with_dismissed_now(state, now())` → release → spawn-blocking save. Stateless on the wire (frontend already knows what was dismissed).
- `update_skip_version(version: String, state: tauri::State<...>) -> Result<(), String>`: lock → `with_skipped_version(state, &version)` → release → save.
- `update_get_state(state: tauri::State<...>) -> Result<UpdateState, String>`: lock → clone → return. Frontend Settings page renders `last_check_unix` and skip list from this.

### Errors
- **Decision:** new module `src-tauri/src/update/errors.rs` (master plan §5 file checklist line 571 calls for it). `UpdateError` enum:
  ```
  pub enum UpdateError {
      Parse(ParseError),                    // from version.rs
      Manifest(ManifestError),              // from manifest.rs
      Storage(StorageError),                // from storage.rs
      UpdaterPlugin(tauri_plugin_updater::Error),
      Json(serde_json::Error),
      Io(std::io::Error),
      AppDataPath(String),                  // app_handle.path().app_data_dir() error
      MissingPlatform { key: String },      // current host has no asset in manifest
  }
  ```
- **Decision:** hand-rolled `Display` + empty `std::error::Error` impl + `From<...>` for each wrapped variant. Mirrors Phase 1/2.
- **`AppDataPath(String)` carries a `String` because** the underlying `tauri::Error` is too broad to wrap typed and we lose nothing by stringifying at this boundary.

### Integration tests
- **Decision:** `[features]` block in `Cargo.toml`: `integration = []` (empty feature flag, gates `#[cfg(feature = "integration")]` test modules).
- **Why feature flag:** integration tests need `tempfile::tempdir` (already a dev-dep from Phase 2) but DON'T need a real Tauri runtime. They exercise `UpdateState` round-trip via real storage IO + `evaluate_update` against fixtures. Same pure-Rust pattern as Phase 2; flag is just a master-plan §3 step 7 (line 382-388) requirement.
- **Test names exact** (master plan :385-388):
  1. `test_update_state_persists_across_load_save`
  2. `test_skip_version_then_check_returns_silent_skip`
  3. `test_dismiss_then_check_within_cooldown_returns_silent_skip`
  4. `test_dismiss_after_cooldown_returns_notify`
- **Location:** `src-tauri/src/update/tests_integration.rs` declared under `#[cfg(feature = "integration")] pub mod tests_integration;` in `mod.rs`. Inline tests in commands/lifecycle/errors are unit tests (no flag).

### Unit test requirements per new module
- `errors.rs`: 3-4 tests — `Display` for each variant, `From` impl chain (e.g. `?` propagation `ParseError -> UpdateError`).
- `commands.rs`: 3-4 tests — exercise commands via plain function calls (NOT through `tauri::test`) by manually constructing `tauri::State`-equivalent. May be hard to test directly; if so, fold tests into integration suite.
- `lifecycle.rs`: 1-2 tests — pure helper extraction (e.g. `current_platform_key()` returning compile-time constant, mappable across targets).

Acceptance: ≥10 new module tests (3-4 errors + 1-2 lifecycle + 4 integration + a few commands or lifecycle helpers) + 46 carryover. Total ≥56 tests.

### Bg task: `current_unix()` clock injection
- **Decision:** Phase 1/2 functions take `now_unix: i64` injected. Lifecycle task is the boundary that calls `std::time::SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64`. Wrap in a private `fn current_unix() -> i64` so test mocks (if needed later) can swap it.
- **No `chrono`/`time` crate** — `std::time` is enough.

### Tauri plugin version pinning
- **Decision:** `tauri-plugin-updater = "2"` and `tauri-plugin-process = "2"` (caret `^2.0.0`). Match Tauri 2.x already in `Cargo.toml`.
- **Why not exact pin:** plugins are minor-version-stable per Tauri's semver promise. `^2` is the convention used by every Tauri 2.x project.

### What we will NOT add to `Cargo.toml`
- ❌ `thiserror` / `anyhow` — hand-rolled errors continue.
- ❌ `chrono` / `time` — `std::time` is enough for `now_unix()`.
- ❌ `tracing` / `log` — bg task uses `eprintln!` only at startup banner per Phase 1/2 precedent. (Wait — Tiger-Style says no `eprintln!` in production. Use `log::warn!` if Tauri already pulls in `log`. Defer to research.)
- ❌ `tokio::sync::Mutex` — `std::sync::Mutex` per decision above.
- ✅ `tauri-plugin-updater = "2"` runtime dep.
- ✅ `tauri-plugin-process = "2"` runtime dep (for the restart after install).

### Cross-cutting from Phase 1+2 reviews (no impact on Phase 3)
- Phase 1 review: URL strict-prefix laxness (MA-03) — closed by Phase 3 because `tauri-plugin-updater` does its own URL + signature verification. Note in SUMMARY.
- Phase 2 review: deferred MI-03/MI-04/MI-06/NI-02 still deferred. Phase 3 doesn't unblock them.

### Claude's Discretion
- `lifecycle::start(app_handle: &AppHandle) -> Result<(), UpdateError>` runs synchronously (path resolve + dir create + state load + state guard manage), then `tokio::spawn` for the actual loop. Returning `Result` lets `lib.rs setup` propagate fatal errors (corrupt state file = panic via `?` is acceptable; user can delete the file).
- `current_platform_key()`: use `cfg!` macros at compile time:
  - Windows x86_64 → `"windows-x86_64"`
  - macOS aarch64 → `"darwin-aarch64"`
  - macOS x86_64 → `"darwin-x86_64"`
  - Linux x86_64 → `"linux-x86_64"`
  - else → return `Err(UpdateError::MissingPlatform { key: format!("...") })` with detected triple.
- `update_install` waits for `download_and_install` to complete before returning `Ok(())`; restart is plugin-driven via `tauri_plugin_process::restart()` if needed. Master plan §Phase 3 step 6 line 380 lists `update:installed` as the post-install event; restart is implicit.
- Worktree compile may need stub binaries again (Phase 1 + 2 noted: `src-tauri/binaries/server-x86_64-pc-windows-msvc.exe`, `mediasoup-worker.exe`, `sidecar/public/.gitkeep`, `dist/index.html`). Same gitignored trick.

</decisions>

<specifics>
## Specific Ideas

- Phase 1+2 module layout: alphabetical `pub mod`. After Phase 3 final state of `mod.rs`:
  ```
  pub mod checker;
  pub mod commands;
  pub mod dispatcher;
  pub mod errors;
  pub mod lifecycle;
  pub mod manifest;
  pub mod storage;
  pub mod version;

  #[cfg(feature = "integration")]
  pub mod tests_integration;

  pub use checker::{evaluate_update, is_version_skipped, should_check_now, UpdateDecision};
  pub use dispatcher::{UpdateAvailablePayload, UpdateDownloadProgressPayload, UpdateInstalledPayload};
  pub use errors::UpdateError;
  pub use storage::{
      load, save, with_check_completed, with_dismissed_now, with_skipped_version,
      StorageError, UpdateState,
  };
  ```
- `lib.rs` setup hook calls `lifecycle::start(app.handle())?` BEFORE `spawn_sidecar(...)` (no ordering dep but cleaner to init updater first).
- `tauri.conf.json` `plugins.updater` block:
  ```
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/roulendz/ChurchAudioStream/releases/latest/download/latest.json"
      ],
      "pubkey": "REPLACE_WITH_USER_GENERATED_PUBKEY",
      "dialog": false
    }
  }
  ```

</specifics>

<canonical_refs>
## Canonical References

- `.planning/plans/auto-updater-plan.md:304-393` — Phase 3 contract (steps 1-6 + acceptance).
- `.planning/plans/auto-updater-plan.md:510-552` — Cross-cutting Tiger-Style + DRY/SRP + no nested if checks.
- `.planning/plans/auto-updater-plan.md:555-592` — Final file checklist.
- `.planning/plans/auto-updater-plan.md:615-625` — Risks (6-hour cooldown + force-check env var).
- `.planning/plans/auto-updater-plan.md:670` — "this plan IS the discuss phase" — rationale for skipping live questioning.
- `.planning/quick/260501-qq5-phase-1-auto-updater-semver-and-manifest/260501-qq5-SUMMARY.md` — Phase 1 surface contract (Semver, ParseError, parse_semver, compare, is_newer, UpdateManifest, PlatformAsset, ManifestError, asset_for_platform, validate).
- `.planning/quick/260501-t83-phase-2-auto-updater-orchestration-check/260501-t83-SUMMARY.md` — Phase 2 surface contract (UpdateState, StorageError, load/save, mutation helpers, UpdateDecision::{Notify { version, notes, download_url }, SilentSkip, NoUpdate}, should_check_now, is_version_skipped, evaluate_update 7-param, three Tauri payload types).
- `src-tauri/src/update/storage.rs:7-25` — Phase 2 inheritance contract: sync IO needs `spawn_blocking`, save precondition is parent dir must exist, corrupt-JSON recovery is caller responsibility.
- `src-tauri/src/lib.rs:58-175` — existing `spawn_sidecar` pattern to mirror for `lifecycle::start`.
- `CLAUDE.md` (root) — caveman mode, naming, no spaghetti.

</canonical_refs>
