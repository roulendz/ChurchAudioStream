---
phase: 260501-uon-phase-3-auto-updater-tauri-plugin-wiring
reviewed: 2026-05-01T00:00:00Z
depth: quick
files_reviewed: 11
files_reviewed_list:
  - src-tauri/src/update/errors.rs
  - src-tauri/src/update/state_guard.rs
  - src-tauri/src/update/commands.rs
  - src-tauri/src/update/lifecycle.rs
  - src-tauri/src/update/tests_integration.rs
  - src-tauri/src/update/mod.rs
  - src-tauri/src/lib.rs
  - src-tauri/Cargo.toml
  - src-tauri/tauri.conf.json
  - src-tauri/capabilities/default.json
  - package.json
findings:
  critical: 1
  warning: 6
  info: 5
  total: 12
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-01T00:00:00Z
**Depth:** quick
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 3 wires Phase 1+2 logic into Tauri runtime. Lock-across-await footgun avoided correctly. Async storage IO mostly wrapped in `spawn_blocking` (one slip in lifecycle). Tiger-Style mostly clean — no `unwrap`/`expect` outside tests except top-level `.expect("failed to run...")` in `lib.rs:228` (acceptable fail-fast at app entry).

ONE BLOCKER: `update.target` field returned by `tauri-plugin-updater` defaults to bare OS string (`"windows"` / `"darwin"` / `"linux"`) when builder is not given an explicit `.target()` — NOT `{os}-{arch}` like `current_platform_key()` returns. `lifecycle::manifest_from_update` keys the synthesized manifest by `update.target`, then `evaluate_against_state` looks up `current_platform_key()`. Mismatch → `asset_for_platform` returns `None` → `SilentSkip("no asset for platform windows-x86_64")` → Notify never fires. Entire happy-path bg notification is broken.

Also: `download_and_install` calls `std::process::exit(0)` on Windows before `update:installed` event can be emitted — Phase 4 must NOT depend on that event.

## BLOCKER

### BL-01: `update.target` mismatch breaks Notify path

**File:** `src-tauri/src/update/lifecycle.rs:143-158` + `:117-141` + `:195-209`

**What's wrong:** `tauri_plugin_updater` (verified `tauri-plugin-updater-2.10.1/src/updater.rs:403-407, 545`) sets `update.target = updater_os()` when builder has no explicit target — bare `"windows"` / `"darwin"` / `"linux"`. `manifest_from_update` inserts the asset under that bare-OS key. `evaluate_against_state` then calls `evaluate_update(..., current_platform_key(), ...)` which is `"windows-x86_64"`. `asset_for_platform` lookup fails → `SilentSkip("no asset for platform windows-x86_64")`. Bg cycle never emits `update:available`. **The frontend command `update_check_now` does emit directly via `emit_update_available` and is unaffected**, but the periodic bg path is dead.

Verified plugin internals:

```rust
// tauri-plugin-updater-2.10.1/src/updater.rs:403
let target = if let Some(target) = &self.target {
    target
} else {
    updater_os().ok_or(Error::UnsupportedOs)?  // "windows" / "darwin" / "linux"
};
// :545
target: target.to_owned(),
```

The plugin internally searches `[{os}-{arch}-{installer}, {os}-{arch}]` keys in the JSON (`get_urls` :578-586) — it just doesn't STORE which key matched.

**Fix:** Don't reconstruct an `UpdateManifest` from a single-platform-keyed map. Either:

```rust
// Option A: key by current_platform_key, since plugin already matched
fn manifest_from_update(update: &tauri_plugin_updater::Update) -> UpdateManifest {
    let mut platforms = HashMap::new();
    platforms.insert(
        current_platform_key().to_string(),  // <-- use OUR key, not plugin's bare OS
        PlatformAsset {
            signature: update.signature.clone(),
            url: update.download_url.to_string(),
        },
    );
    UpdateManifest { ... }
}
```

```rust
// Option B (cleaner): bypass evaluate_update's platform check entirely.
// Plugin already matched the asset; only re-check version skip + dismiss cooldown.
// Refactor evaluate_against_state to call a new pure helper
// `apply_user_filters(version, skipped, last_dismissed_unix, now, cooldown) -> UpdateDecision`
// that drops the asset_for_platform call.
```

Add a regression test under `#[cfg(feature = "integration")]` that asserts `manifest_from_update(...).platforms.get(current_platform_key()).is_some()`.

## MAJOR

### MA-01: Async lifecycle calls sync `save()` — violates Phase 2 contract

**File:** `src-tauri/src/update/lifecycle.rs:103-115`

**What's wrong:** `persist_check_completed` is sync and calls `save(&state.state_path, &new_state)` directly. It is invoked from async `run_one_cycle`. Phase 2 `storage.rs:7-13` module-doc explicitly: *"Async callers (e.g. tokio update-check task) must wrap `load`/`save` in `tokio::task::spawn_blocking` to avoid stalling the runtime."* `commands.rs::persist_blocking` does this; lifecycle does not. Small writes today, but breaks the contract — and the bg loop is the exact "tokio update-check task" the doc names.

**Fix:** Mirror `commands.rs::persist_blocking` in lifecycle:

```rust
async fn persist_check_completed(app_handle: &AppHandle, now: i64) -> Result<(), UpdateError> {
    let (path, new_state) = {
        let state: tauri::State<'_, UpdateStateGuard> = app_handle.state::<UpdateStateGuard>();
        let mut s = state.state.lock().map_err(|_| UpdateError::AppDataPath("state poisoned".into()))?;
        *s = with_check_completed(s.clone(), now);
        (state.state_path.clone(), s.clone())
    };
    tokio::task::spawn_blocking(move || save(&path, &new_state))
        .await
        .map_err(|e| UpdateError::AppDataPath(format!("spawn_blocking: {e}")))??;
    Ok(())
}
```

Also update `run_one_cycle:75` to `.await` it.

### MA-02: `install_impl` does redundant `updater.check().await` — duplicate network round-trip + race

**File:** `src-tauri/src/update/commands.rs:108-116`

**What's wrong:** Frontend flow is `update_check_now` (fetches manifest, emits available) → user clicks Install → `update_install` (fetches manifest AGAIN). Two issues:
1. Duplicate HTTP call to GitHub for same JSON. Wasted bandwidth + adds 100-2000ms latency before download starts.
2. Race window: between check and install, a new release could publish. User clicks Install on v0.2.0, `install_impl.check()` returns v0.2.1 — version_for_event in payload (`update.version.clone()` line 118) won't match what user agreed to install. Could skip a minor revision without consent or, worse, install before signature is propagated.

**Fix:** Cache the matched `Update` after `update_check_now`. Either store as `Mutex<Option<Update>>` in `UpdateStateGuard` (Update isn't `Send` though — needs `Arc<Mutex<...>>` and check trait bounds), or pass `version: String` from frontend and assert in `install_impl` that re-checked update matches:

```rust
async fn install_impl(app_handle: &AppHandle, expected_version: &str) -> Result<(), UpdateError> {
    let updater = app_handle.updater()?;
    let update = updater.check().await?.ok_or(...)?;
    if update.version != expected_version {
        return Err(UpdateError::AppDataPath(format!(
            "version drift: expected {expected_version}, got {}", update.version
        )));
    }
    // ... rest
}
```

`#[tauri::command] pub async fn update_install(version: String, ...)`. Update Phase 4 frontend contract.

### MA-03: `update:installed` event is unreachable on Windows

**File:** `src-tauri/src/update/commands.rs:137-143`

**What's wrong:** `tauri-plugin-updater-2.10.1/src/updater.rs:865`:

```rust
ShellExecuteW(...);  // launch installer
std::process::exit(0);  // plugin exits app process
```

The exit happens INSIDE `download_and_install` (via `install` → `install_inner` on Windows). So `install_impl` line 141's `app_handle.emit("update:installed", ...)` is unreachable on Windows — process is gone. Phase 4 frontend MUST NOT block on this event. Linux AppImage / macOS .app paths may differ.

**Fix:** Remove the `update:installed` emit OR move it BEFORE `download_and_install.await`. Recommended:

```rust
// Emit BEFORE download_and_install — frontend uses it to show "installing..." spinner
app_handle.emit("update:installed", &installed)?;  // really "starting install"
update.download_and_install(...).await?;
// (control never returns on Windows; that's expected)
```

OR rename the event to `update:install:starting` to match reality. Document in Phase 4 inheritance notes.

### MA-04: DRY — `current_unix()` duplicated

**File:** `src-tauri/src/update/commands.rs:25-30` and `src-tauri/src/update/lifecycle.rs:188-193`

**What's wrong:** Identical 6-line function `current_unix()` defined twice with identical body. Violates DRY rule from `CLAUDE.md`.

**Fix:** Move to a shared module — either `update/clock.rs` (new) or as `pub fn current_unix() -> i64` in `update/mod.rs`. Single source of truth. Both call sites import.

### MA-05: `UpdateError::AppDataPath` abused as catch-all

**File:** `src-tauri/src/update/commands.rs:36, 44, 52, 67, 142` + `src-tauri/src/update/lifecycle.rs:99, 109, 129, 174`

**What's wrong:** `UpdateError::AppDataPath(String)` is reused for:
- mutex poisoning (`"state poisoned"`)
- `spawn_blocking` JoinError
- `app_handle.emit(...)` failures

None of these are app-data-path errors. Tiger-Style says error variants describe what went wrong; this is misleading when reading logs (`"app data path error: state poisoned"` is nonsense). Phase 4 frontend may switch on error message text and get confused.

**Fix:** Add typed variants:

```rust
pub enum UpdateError {
    // ...existing
    Mutex(String),
    Emit(String),
    Join(String),
}
```

Update `Display` impls and call sites. Quick refactor, large clarity win.

### MA-06: `tests_integration` compile-fails under `cargo build --features integration`

**File:** `src-tauri/src/update/tests_integration.rs:15` + `src-tauri/Cargo.toml:30`

**What's wrong:** `use tempfile::tempdir;` — `tempfile` is in `[dev-dependencies]`, only linked during `cargo test`. The module is gated `#![cfg(feature = "integration")]`, NOT `#![cfg(all(feature = "integration", test))]`. So `cargo build --features integration` (non-test) tries to compile this file, fails to resolve `tempfile`. CI matrix that builds all features will trip on this.

**Fix:** Either (a) tighten the gate:

```rust
#![cfg(all(feature = "integration", test))]
```

or (b) move `tempfile` to `[dependencies]` with `optional = true` and gate via the integration feature:

```toml
[dependencies]
tempfile = { version = "3", optional = true }

[features]
integration = ["dep:tempfile"]
```

Option (a) is simpler and matches Phase 1+2's inline test pattern.

## MINOR

### MI-01: `total_bytes = 0` masquerades as "total unknown"

**File:** `src-tauri/src/update/commands.rs:128`

**What's wrong:** `total_len.unwrap_or(0)` — frontend can't distinguish "0 bytes total" from "size unknown". Dispatcher payload type `UpdateDownloadProgressPayload` has no nullable field. If GitHub omits Content-Length, progress bar will divide by zero.

**Fix:** Change `UpdateDownloadProgressPayload.total_bytes` to `Option<u64>` (serializes as `null`/number in JSON), or use a sentinel like `u64::MAX`. Phase 4 inheritance — frontend code path must handle.

### MI-02: `download_and_install` uses `update.version` for installed payload but `update` was checked, not installed

**File:** `src-tauri/src/update/commands.rs:118, 137-139`

**What's wrong:** `version_for_event = update.version.clone()` is captured BEFORE download. If install signature verification fails, payload still says "installed v0.2.0". Combined with MA-03 (unreachable on Windows), this is moot — but on non-Windows platforms it's a lie.

**Fix:** Move emit AFTER `download_and_install.await?` is OK (current code) but only because `?` early-returns on failure. Verify the early-return path is correct on all targets. Add comment: `// Only reached on non-Windows; Windows exits inside download_and_install`. Cross-check Linux/macOS plugin paths in a follow-up.

### MI-03: SilentSkip / NoUpdate emit nothing → frontend has no way to show "checking…" feedback after manual click

**File:** `src-tauri/src/update/commands.rs:73-99`

**What's wrong:** `update_check_now` returns the new state but only emits `update:available` if a real update exists. If user clicks "Check now" and result is NoUpdate or SilentSkip (already-skipped version), frontend gets the state object back but no event. Phase 4 must build feedback off the return value, not events. Note for Phase 4 inheritance — not strictly a bug.

**Fix:** Document explicitly. Optionally emit `update:check:complete` with `UpdateState` for consistency with bg-check path which emits NOTHING for NoUpdate/SilentSkip either.

### MI-04: `try_check_for_update` swallows errors silently — masks pubkey-replaced misconfig

**File:** `src-tauri/src/update/lifecycle.rs:67-73`

**What's wrong:** A1 mitigation comment claims this catches placeholder-pubkey errors. Verified: `updater.check()` does NOT validate pubkey (verification is in `download` only — `tauri-plugin-updater-2.10.1/src/updater.rs:712`). So check() doesn't fail on placeholder pubkey. But it DOES swallow ALL transient errors (network down, 502, malformed manifest) silently with `log::warn!`. In production with bad endpoint config, no one will notice. Tiger-Style "fail loudly" violation.

**Fix:** Bg path should remain fail-soft (don't crash app over transient network), but escalate after N consecutive failures. Add a counter to `UpdateState` (`consecutive_check_failures: u32`) and emit `update:error` after threshold (e.g., 5 cycles = 30h). Phase 4 inheritance.

### MI-05: `package.json` has unused `@tauri-apps/plugin-process` listener-side leak risk

**File:** `package.json:18-19`

**What's wrong:** Both `@tauri-apps/plugin-process` and `@tauri-apps/plugin-updater` are root-level deps. Root frontend (admin UI) needs them. But `listener/package.json` doesn't — and the listener PWA bundler will likely false-positive include them if anyone wires them up later. Not a Phase 3 bug; Phase 4 footgun.

**Fix:** N/A for Phase 3. Phase 4: confirm the listener bundler tree-shakes these deps and they don't bloat the PWA.

## NIT

(None worth flagging — code is clean.)

## Phase 4 Inheritance Trip-Wires

Phase 4 (frontend wiring) MUST know:

1. **`update:installed` event NEVER fires on Windows.** Plugin's `std::process::exit(0)` runs inside `download_and_install` before any post-await emit. Frontend should call `relaunch()` from `@tauri-apps/plugin-process` AFTER manually-emitted "install starting" event, or rely on installer's own auto-launch. (See MA-03.)

2. **Event payload field names are camelCase** per `dispatcher.rs` `#[serde(rename_all = "camelCase")]`:
   - `update:available` → `{ version, notes, downloadUrl }`
   - `update:download:progress` → `{ downloadedBytes, totalBytes }`
   - `update:installed` → `{ version }` (Windows: never delivered)

3. **`totalBytes: 0` may mean "size unknown"**, not "zero bytes". Frontend progress UI must treat 0 as indeterminate. (See MI-01.)

4. **`update_check_now` does NOT emit `update:available` for SilentSkip / NoUpdate.** Frontend "Check now" button must inspect the returned `UpdateState` to render "no update" / "you skipped this version" banners — events alone are insufficient. (See MI-03.)

5. **`update_install` re-fetches manifest** — there's a race window where the installed version may differ from the version shown to the user at `update_check_now` time. If MA-02 is fixed, frontend should pass the `version` it agreed to install as a String arg.

6. **Pubkey is `REPLACE_WITH_USER_GENERATED_PUBKEY`** placeholder. `cargo build` succeeds; `updater.check()` succeeds; but `download_and_install` will fail signature verification. UAT against a real release manifest requires user to swap pubkey first. If BL-01 is fixed first, the bg loop will finally produce a real Notify event that can be UAT-tested even with placeholder pubkey (signature verify only happens at install time, not check time).

7. **Bg loop swallows transient errors** with `log::warn!` only — no telemetry to frontend. Frontend can call `update_get_state` to inspect `last_check_unix` to detect "stale" check (>24h since last successful check) as a soft signal. (See MI-04.)

8. **Capabilities** include `updater:default` and `process:default` — frontend can call `check`, `download`, `install`, `relaunch`, `exit`. Verify the windows array `["main"]` covers any future child windows used for update dialogs.

9. **NSIS installMode is `passive`** — installer shows progress UI but no prompts. User sees the installer briefly. Phase 4 may want to communicate "installer launching" right before download_and_install completes.

10. **`current_platform_key()` mapping** is hardcoded for x86_64 + aarch64 only. ARM Windows / RISC-V Linux fall through to `"unknown"`. If Phase 4 ever supports those, expand the match arms.

---

_Reviewed: 2026-05-01T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
