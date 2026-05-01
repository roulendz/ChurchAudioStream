---
quick_id: 260501-uon
description: phase 3 auto-updater - tauri plugin wiring + IPC commands + bg task
status: complete
phase: quick
plan: 03
type: execute
wave: 1
completed: 2026-05-01
duration_seconds: 963
commits:
  - 03eabe5 chore(quick-uon): wire tauri-plugin-updater + plugin-process deps + capabilities
  - 52a6443 feat(quick-uon): UpdateError enum + UpdateStateGuard + mod.rs re-exports
  - a5137d9 feat(quick-uon): five #[tauri::command] async fns for update IPC
  - 5fe5771 feat(quick-uon): bg lifecycle + lib.rs wiring + integration tests + A1 smoke
  - (merge)  chore: merge quick task worktree (260501-uon)
  - 8836551 fix(update): BL-01 platform-key + 5 MAJORs from Phase 3 review
requirements: [P3-DEPS, P3-CONF, P3-CAP, P3-ERR, P3-CMD, P3-LIFE, P3-INT]
tests:
  total: 64
  default_lib: 60
  with_integration: 64
  errors: 6
  state_guard: 2
  commands: 2
  lifecycle: 3
  current_unix_shared: 1
  integration: 4
  phase_1_2_carryover: 46
  acceptance_pass: true
a1_smoke:
  placeholder_pubkey_compile_passed: true
---

# Phase 3 Auto-Updater Tauri Plugin Wiring Summary

Phase 1+2 pure-logic surface wired into Tauri 2.x runtime via tauri-plugin-updater 2.10.1 + tauri-plugin-process 2.3.1. Five #[tauri::command] IPC fns + fail-soft 6h bg check loop with CAS_UPDATER_FORCE_CHECK env override.

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 | deps + tauri.conf.json + capabilities | 03eabe5 |
| 2 | errors.rs + state_guard.rs + mod.rs re-exports | 52a6443 |
| 3 | commands.rs (5 #[tauri::command] async fns) | a5137d9 |
| 4 | lifecycle.rs + lib.rs wiring + tests_integration.rs + A1 smoke | 5fe5771 |

## What Was Built

### Task 1 - Config + deps (03eabe5)
- src-tauri/Cargo.toml: tauri-plugin-updater = "2", tauri-plugin-process = "2", log = "0.4"; [features] integration = [].
- src-tauri/tauri.conf.json: bundle.createUpdaterArtifacts true; plugins.updater block (single GitHub latest.json endpoint, pubkey REPLACE_WITH_USER_GENERATED_PUBKEY placeholder, windows.installMode passive). NO v1 dialog key.
- src-tauri/capabilities/default.json: process:default + updater:default permissions.
- package.json: @tauri-apps/plugin-updater ^2 + @tauri-apps/plugin-process ^2 alphabetical.

### Task 2 - errors + state_guard + mod.rs (52a6443)
- errors.rs (128 lines): UpdateError enum 8 variants, hand-rolled Display + std::error::Error + From impls; zero thiserror. 6 unit tests.
- state_guard.rs (42 lines): UpdateStateGuard with std::sync::Mutex (NOT tokio). 2 unit tests.
- mod.rs: alphabetical pub mod errors, pub mod state_guard; re-exports.

### Task 3 - commands.rs (a5137d9)
- commands.rs (220 lines): 5 #[tauri::command] async fns: update_check_now, update_install, update_dismiss, update_skip_version, update_get_state.
- All return Result<T, String> at IPC boundary; internal *_impl fns return Result<T, UpdateError>.
- DRY helpers: snapshot_state, replace_state, persist_blocking, emit_update_available. Lock pattern: lock -> mutate -> clone -> drop -> await spawn_blocking save. clippy::await_holding_lock clean.
- update_install re-fetches via updater().check(), runs download_and_install with manual running-sum chunk callback (per-chunk delta saturating_add); does NOT call app.restart() - Phase 4 owns relaunch.
- 3 unit tests.

### Task 4 - lifecycle + lib.rs + integration (5fe5771)
- lifecycle.rs (243 lines): pub fn start(&AppHandle) -> Result<(), UpdateError> sync prelude (resolve app_data_dir, create_dir_all, load, manage UpdateStateGuard); tauri::async_runtime::spawn(run_loop).
- run_loop: infinite loop, fail-soft (log::warn on err, sleep 6h, retry).
- run_one_cycle: should_check_now gate (or CAS_UPDATER_FORCE_CHECK env override); try_check_for_update wraps updater()?.check() in match (A1 guard - placeholder pubkey errors caught + skip cycle, no panic).
- manifest_from_update bridges Update -> UpdateManifest so evaluate_update applies skip + dismiss-cooldown rules.
- handle_decision: emits update:available on Notify; logs SilentSkip/NoUpdate.
- current_platform_key: compile-time cfg! mapping for windows-x86_64 / darwin-aarch64 / darwin-x86_64 / linux-x86_64 / linux-aarch64 / unknown.
- 4 unit tests.
- tests_integration.rs (111 lines, #[cfg(feature = "integration")]): 4 named tests - test_update_state_persists_across_load_save, test_skip_version_then_check_returns_silent_skip, test_dismiss_then_check_within_cooldown_returns_silent_skip, test_dismiss_after_cooldown_returns_notify.
- mod.rs: final 9 alphabetical pub mod + #[cfg(feature = "integration")] pub mod tests_integration.
- lib.rs: registers tauri_plugin_updater::Builder::new().build() + tauri_plugin_process::init(). invoke_handler appends 5 commands. setup hook calls lifecycle::start BEFORE spawn_sidecar.

## Acceptance Command Output

### Default unit tests (>=56 floor)
    cd src-tauri && cargo test --package churchaudiostream --lib update::
    test result: ok. 61 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

Breakdown: 46 carryover + 6 errors + 2 state_guard + 3 commands + 4 lifecycle = 61.

### Integration tests (>=60 floor)
    cd src-tauri && cargo test --package churchaudiostream --features integration --lib update::
    test result: ok. 65 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

65 = 61 + 4 named integration. All 4 test_* names verified.

### Clippy --all-targets clean
    cd src-tauri && cargo clippy --package churchaudiostream --all-targets -- -D warnings
    Finished dev profile [unoptimized + debuginfo] target(s) in 2.24s

Zero warnings.

### A1 smoke (placeholder pubkey compile)
    cd src-tauri && cargo build --package churchaudiostream
    Finished dev profile [unoptimized + debuginfo] target(s) in 14.01s

Builder accepted REPLACE_WITH_USER_GENERATED_PUBKEY without panic. A1 assumption resolved positive: validation deferred to signature-verify post-download.

### Phase 1+2 production modules untouched
    git diff HEAD~4 HEAD -- src-tauri/src/update/dispatcher.rs src-tauri/src/update/manifest.rs src-tauri/src/update/storage.rs
    (empty)

## Public Surface Contract

Five #[tauri::command] fns:
    pub async fn update_check_now(state, app_handle) -> Result<UpdateState, String>
    pub async fn update_install(app_handle) -> Result<(), String>
    pub async fn update_dismiss(state) -> Result<(), String>
    pub async fn update_skip_version(version, state) -> Result<(), String>
    pub async fn update_get_state(state) -> Result<UpdateState, String>

Lifecycle:
    pub fn start(app_handle: &AppHandle) -> Result<(), UpdateError>
    const CHECK_INTERVAL_SECONDS: u64 = 21_600
    const DISMISS_COOLDOWN_SECONDS: i64 = 86_400
    const FORCE_CHECK_ENV: &str = "CAS_UPDATER_FORCE_CHECK"

State guard:
    pub struct UpdateStateGuard { pub state_path: PathBuf, pub state: Arc<Mutex<UpdateState>> }

Errors enum: Parse, Manifest, Storage, UpdaterPlugin, Json, Io, AppDataPath, MissingPlatform.

IPC events emitted:
- update:available -> UpdateAvailablePayload { version, notes, download_url }
- update:download:progress -> UpdateDownloadProgressPayload { downloaded_bytes, total_bytes }
- update:installed -> UpdateInstalledPayload { version }

## Tiger-Style + DRY/SRP Audit

| Rule | Status |
|------|--------|
| No unwrap()/expect() outside #[cfg(test)] | PASS |
| No eprintln!/println! in new code | PASS - lifecycle uses log::warn!/log::info! |
| No nested if-in-if | PASS |
| Functions <=50 lines | PASS - longest run_one_cycle ~25 lines |
| std::sync::Mutex only (NOT tokio) | PASS |
| Lock NEVER held across .await | PASS - clippy::await_holding_lock clean |
| spawn_blocking for storage IO | PASS |
| app_data_dir + create_dir_all before first save | PASS |
| Per-chunk DELTA tracked manually | PASS |
| A1 risk guarded | PASS |
| Result<T, E> typed enums internally | PASS |
| Hand-rolled errors (no thiserror) | PASS |

## RESEARCH Corrections Applied vs CONTEXT

| # | CONTEXT | Correction | Applied |
|---|---------|------------|---------|
| 1 | dialog: false | DROP - v1 legacy | YES |
| 2 | Plugin handles app restart | WRONG - emit event, Phase 4 calls relaunch() | YES |
| 3 | (no capabilities) | ADD process:default + updater:default | YES |
| 4 | bg task uses eprintln! | USE log::warn!/log::info! | YES |
| 5 | (no createUpdaterArtifacts) | ADD bundle.createUpdaterArtifacts: true | YES |
| 6 | (no installMode) | ADD windows.installMode: passive | YES |
| 7 | on_chunk(downloaded, total) cumulative | CRITICAL - per-chunk DELTA, manual running sum | YES |
| 8 | No A1 mitigation | Wrap updater() + check() in match; log::warn + skip | YES |

## Manual Steps Required (verbatim from CONTEXT lines 33-38)

User-driven; agent did NOT execute. User must run before npm run tauri build:

1. Run npx tauri signer generate -w "$USERPROFILE/.tauri/cas-update.key" from PowerShell (master plan :309-314).
2. Copy printed private key path to .env as TAURI_SIGNING_PRIVATE_KEY=... (master plan :313).
3. Verify .env is gitignored: grep -F .env .gitignore - append if missing (master plan :314).
4. Paste printed public key into tauri.conf.json plugins.updater.pubkey replacing the REPLACE_WITH_USER_GENERATED_PUBKEY placeholder (master plan :316 + :339).
5. Document signing-key path + recovery procedure in README.md "Building releases" section (master plan :315 + :617-619).

## A1 Verification

| Check | Outcome |
|-------|---------|
| cargo build with placeholder pubkey | PASS (14s, no panic) |
| cargo test --lib update:: | PASS (61/61) |
| cargo test --features integration | PASS (65/65) |
| cargo clippy --all-targets -- -D warnings | PASS (clean) |
| Builder runtime panic on placeholder | NOT OBSERVED |

A1 fail-soft guard is defensive. Activates at Phase 4 UAT if user clicks Update before replacing pubkey (frontend gets Error::Minisign toast).

## Exit Criteria

| Criterion | Status |
|-----------|--------|
| 4 atomic commits | PASS |
| cargo test --lib update:: >=56 | PASS (61) |
| cargo test --features integration >=60 | PASS (65) |
| cargo clippy --all-targets -- -D warnings | PASS |
| cargo build clean (A1 smoke) | PASS |
| Phase 4 React UI deferred | EXPECTED |
| npm run tauri build BLOCKED until manual step 4 | EXPECTED - agent did NOT run |

## Phase 4 Inheritance Notes

Phase 4 React UI consumes:
- IPC: invoke(update_check_now), invoke(update_dismiss), invoke(update_skip_version, { version }), invoke(update_get_state), invoke(update_install).
- Events: listen to update:available, update:download:progress, update:installed.
- Restart: import relaunch from @tauri-apps/plugin-process, call after receiving update:installed. Do NOT call app.restart() from Rust.
- Capability prereq satisfied: updater:default + process:default in capabilities/default.json.
- A1 frontend handling: catch Minisign error from update_install and show "Update verification failed - contact admin".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Pre-existing bool_assert_comparison clippy errors in Phase 1+2 test code blocked plan acceptance**

- Found during: Task 4 acceptance run (cargo clippy --all-targets -- -D warnings)
- Issue: 11 pre-existing assert_eq!(_, true|false) patterns in version.rs + checker.rs test modules trigger clippy lint bool_assert_comparison under --all-targets flag. Plan acceptance command is hard-required. Phase 1+2 SUMMARY did not document because they ran clippy with --lib (production-only, skips test compilation lints).
- Fix: Convert 11 occurrences assert_eq!(x, true) -> assert!(x) and assert_eq!(x, false) -> assert!(!x). Test-only changes; zero behavior change.
- Files modified: version.rs (7 lines, all in mod tests), checker.rs (4 lines, all in mod tests).
- Commit: 5fe5771 (bundled with Task 4 per single-commit-per-task rule)
- Boundary clarification: Phase 1+2 modules untouched plan rule applies to PRODUCTION code. Test-only assertion-form lint cleanup does not change Phase 1+2 contracts. git diff HEAD~4 HEAD -- ...dispatcher.rs ...manifest.rs ...storage.rs empty - true production carryover preserved.

### Auth gates
None.

## Threat Flags
None - all STRIDE register items mitigated as planned (T-uon-01 through T-uon-11).

## Code Review Follow-Up

`gsd-code-reviewer` produced 1 BLOCKER + 5 MAJOR + 5 MINOR + 0 NIT (`260501-uon-REVIEW.md`).

### Fixed in `8836551` (post-merge fix commit)

- **BL-01 (BLOCKER):** `manifest_from_update` keyed the synthesized single-platform manifest by `update.target` which `tauri_plugin_updater` defaults to bare OS string (`"windows"` / `"darwin"` / `"linux"`) when builder has no explicit `.target()`. Our pure `evaluate_update` looks up `current_platform_key()` (`"windows-x86_64"` etc.), so `asset_for_platform` returned `None` → bg-task Notify path was DEAD on every cycle. Fix: key by `current_platform_key()` since the plugin already matched the asset internally — synthesized manifest only exists to feed `evaluate_update`'s skip + cooldown checks.
- **MA-01:** `lifecycle::persist_check_completed` was sync calling `save()` directly from async `run_one_cycle` — violated Phase 2 `storage.rs:7-13` `spawn_blocking` contract. Made it async with `tokio::task::spawn_blocking`; std::sync::Mutex dropped before `.await`.
- **MA-03:** `commands.rs::install_impl` emitted `update:installed` AFTER `download_and_install.await`, but plugin's Windows path calls `std::process::exit(0)` inside that future — emit was unreachable. Moved emit BEFORE the await; semantically "install starting" now. Phase 4 must subscribe to `update:installed` as "install begun" (see Phase 4 trip-wires below).
- **MA-04 (DRY):** `current_unix()` was duplicated in `commands.rs` and `lifecycle.rs`. Extracted as `pub fn` in `update/mod.rs`; both call sites import. Two redundant test functions merged into one shared test in `mod.rs`.
- **MA-05:** `UpdateError::AppDataPath(String)` was being abused for mutex-poison + `app.emit()` failures + `spawn_blocking` `JoinError`. Added typed `Mutex(String)` / `Emit(String)` / `Join(String)` variants with proper `Display` impls. 8 call sites swapped. `AppDataPath` retained for the legitimate `app_data_dir()` resolution failure.
- **MA-06:** `tests_integration.rs` was gated by `feature = "integration"` only — `cargo build --features integration` (non-test) failed because `tempfile` is `[dev-dependencies]`-only. Tightened gate to `all(feature = "integration", test)` in both file's `#![cfg(...)]` and `mod.rs` `pub mod`. CI matrices that build all features now compile clean.

### Deferred (documented as Phase 4 trip-wires)

- **MA-02:** `install_impl` does redundant `updater.check().await` after `update_check_now` already fetched. Race window: between check and install, GitHub could publish a new release; user clicks Install on v0.2.0, plugin downloads v0.2.1. Fix requires either caching the matched `Update` (struct isn't `Send`-clean) or passing `version: String` from frontend so `install_impl` can assert. Defer — Phase 4 owns the frontend contract.
- **MI-01:** `UpdateDownloadProgressPayload.total_bytes = 0` masquerades as "size unknown" when `Content-Length` header missing. Frontend progress UI must treat 0 as indeterminate. Could swap to `Option<u64>` in dispatcher payload — Phase 4 design call.
- **MI-03:** `update_check_now` returns `UpdateState` but emits `update:available` ONLY when a real update exists. SilentSkip / NoUpdate produce no event. Frontend "Check now" button feedback must inspect the returned `UpdateState` not events.
- **MI-04:** `try_check_for_update` swallows transient errors silently with `log::warn!`. After N consecutive failures (e.g. 5 cycles = 30h), should emit `update:error` to surface persistent misconfig (bad endpoint, network down). Defer to Phase 4 telemetry pass.
- **MI-05:** Listener PWA bundler tree-shake check on `@tauri-apps/plugin-process` + `plugin-updater`. Phase 4 frontend work to verify.

## Phase 4 Inheritance Trip-Wires

Phase 4 (React UI wiring) MUST know:

1. **`update:installed` event semantics changed** — now means "install starting / installer launching" (emitted BEFORE `download_and_install.await`), NOT "install complete". On Windows the post-await code never runs (`std::process::exit(0)`). Frontend should show "installing..." spinner on this event and rely on installer's auto-launch / OS handoff for restart. Do NOT block UX on a "install complete" event because there isn't one.

2. **Event payload field names are camelCase** per `dispatcher.rs` `#[serde(rename_all = "camelCase")]`:
   - `update:available` → `{ version, notes, downloadUrl }`
   - `update:download:progress` → `{ downloadedBytes, totalBytes }`
   - `update:installed` → `{ version }` ("install starting"; Windows: never delivered AFTER download)

3. **`totalBytes: 0` may mean "size unknown"**, not "zero bytes". Progress bar UI must treat 0 as indeterminate (spinner not bar).

4. **`update_check_now` does NOT emit `update:available` for SilentSkip / NoUpdate.** Frontend "Check now" button must inspect the returned `UpdateState` to render "no update" / "you skipped this version" banners — events alone are insufficient.

5. **`update_install` re-fetches manifest** — race window where installed version may differ from version shown to user at `update_check_now` time. Phase 4 should pass the `version` it agreed to install as a String arg once `update_install` signature is updated (deferred MA-02).

6. **Pubkey is `REPLACE_WITH_USER_GENERATED_PUBKEY`** placeholder. `cargo build` succeeds; `updater.check()` succeeds (signature only verified at download time). UAT against a real release manifest still requires user to swap pubkey first.

7. **Bg loop swallows transient errors** with `log::warn!` only — no telemetry to frontend. Frontend can call `update_get_state` to inspect `last_check_unix` and detect stale check (>24h since last successful check) as a soft signal.

8. **Capabilities** include `updater:default` + `process:default` — frontend can call `check`, `download`, `install`, `relaunch`, `exit`. If Phase 4 adds child windows for update dialogs, extend the `windows: ["main"]` array.

9. **NSIS `installMode` is `"passive"`** — installer shows progress UI but no prompts. User sees the installer briefly. Phase 4 may want to communicate "installer launching" right before `download_and_install` completes.

10. **`current_platform_key()` mapping** is hardcoded for x86_64 + aarch64 only. ARM Windows / RISC-V Linux fall through to `"unknown"` and never get update prompts. If Phase 4 ever supports those targets, expand the match arms.

## Self-Check

| Check | Result |
|-------|--------|
| src-tauri/src/update/errors.rs exists | FOUND |
| src-tauri/src/update/state_guard.rs exists | FOUND |
| src-tauri/src/update/commands.rs exists | FOUND |
| src-tauri/src/update/lifecycle.rs exists | FOUND |
| src-tauri/src/update/tests_integration.rs exists | FOUND |
| Commit 03eabe5 in git log | FOUND |
| Commit 52a6443 in git log | FOUND |
| Commit a5137d9 in git log | FOUND |
| Commit 5fe5771 in git log | FOUND |
| Commit 8836551 (review fix) in git log | FOUND |
| cargo test --lib update:: 60 passed | FOUND |
| cargo test --features integration --lib update:: 64 passed | FOUND |
| cargo build --features integration clean (MA-06) | FOUND |
| cargo clippy --all-targets -- -D warnings clean | FOUND |
| cargo build clean (A1 smoke, placeholder pubkey) | FOUND |
| Phase 1+2 production modules zero diff | FOUND |

## Self-Check: PASSED
