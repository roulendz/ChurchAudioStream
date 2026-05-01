# Phase 2 Auto-Updater Orchestration — Research

**Researched:** 2026-05-01
**Domain:** Rust pure-logic decision functions + JSON state file IO + Tauri event payload structs
**Confidence:** HIGH (all claims verified against Phase 1 source, tempfile docs, Tauri 2.x docs)

## User Constraints (from CONTEXT.md)

### Locked Decisions
- `dispatcher.rs` is **payload-type definitions only** — no `app.emit()`, no Tauri imports, no async. `UpdateAvailablePayload { version, notes, download_url }`, `UpdateDownloadProgressPayload { downloaded_bytes, total_bytes }`, `UpdateInstalledPayload { version }`. All `#[derive(Serialize, Clone, Debug)]`. No `Deserialize`.
- `UpdateDecision` enum: `Notify { version, notes, platform_url }` / `SilentSkip(String)` / `NoUpdate`.
- `SilentSkip(String)` reasons match plan strings exactly: `"user skipped"`, `"dismissed cooldown"`, `"bad manifest: {e}"`, `"bad current: {e}"`.
- Storage format: JSON via `serde_json` (already in Cargo.toml). Caller passes `&Path`.
- `load()`: file-not-found OR empty → `Ok(UpdateState::default())`. Other IO/parse errors propagate.
- Pure mutation helpers take `state: UpdateState` BY VALUE, return `UpdateState`. No `&mut self`.
- `with_skipped_version` dedupes (no-op if already in list).
- `StorageError` enum hand-rolled (variants `Io(io::Error)`, `Parse(serde_json::Error)`). Manual `Display` + `std::error::Error`. No `thiserror`.
- `checker.rs` has NO error type — all functions infallible.
- Tiger-Style: `debug_assert!(now_unix >= last_check_unix)` in `should_check_now`. Flat early-returns in `evaluate_update`. No nested ifs.
- `is_version_skipped(version: &str, skipped: &[String]) -> bool` per plan signature.
- Inline `#[cfg(test)] mod tests` per file.
- `tempfile = "3"` under `[dev-dependencies]` ONLY.
- 12+ plan-listed tests + ~2 dispatcher payload tests = ≥14 new tests; total ≥36 across `update::*`.

### Claude's Discretion
- `UpdateState::default()` via `#[derive(Default)]` (all-zero / empty Vec).
- File-not-found via `std::io::ErrorKind::NotFound`.
- Empty-file detection: read content first, check `.is_empty()`, return default — avoids `serde_json::Error::Eof` branching.
- `mod.rs` final order alphabetical: `pub mod checker; pub mod dispatcher; pub mod manifest; pub mod storage; pub mod version;`.
- Selective `pub use` re-exports from `mod.rs` for Phase 3 ergonomics.

### Deferred (OUT OF SCOPE)
- Tauri plugin / IPC / `app.emit()` (Phase 3).
- Signing keys (Phase 3).
- React UI (Phase 4).
- GitHub Actions workflow (Phase 5).
- HTTP fetching of `latest.json` (Phase 3).
- Reading current version from `Cargo.toml` at runtime (Phase 3).
- Touching `manifest.rs` / `version.rs` (Phase 1 review follow-ups deferred).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| P2-CHK | `should_check_now`, `is_version_skipped`, `evaluate_update` pure functions | §6, §7 |
| P2-DEC | `UpdateDecision::{Notify, SilentSkip, NoUpdate}` enum | §7 |
| P2-STO | `UpdateState` + `load`/`save` + 3 pure mutation helpers | §2, §3 |
| P2-DSP | Event payload structs (no emit) | §4 |
| P2-ERR | `StorageError` hand-rolled enum wrapping `io::Error` + `serde_json::Error` | §5 |
| P2-TEST | ≥14 new tests, ≥36 total in `update::*` | §9 |

---

## 1. tempfile crate API

**Latest version:** `3.27.0` [VERIFIED: docs.rs/tempfile]
**License:** MIT OR Apache-2.0 (compatible with project)
**Use only in `[dev-dependencies]`** — zero runtime overhead. No transitive impact on shipped binary size.

`tempdir()` returns `io::Result<TempDir>`. `TempDir::path()` returns `&Path`. Auto-deletes on drop.

**Idiomatic pattern (Windows-safe):**
```rust
use tempfile::tempdir;

let dir = tempdir().unwrap();                       // tests can unwrap
let path = dir.path().join("update-state.json");    // borrow, NOT move
// ... do IO ...
// `dir` drops at end of test → directory deleted
```

**Pitfall:** Do NOT use `dir.into_path()` — consumes `TempDir`, disables auto-delete, leaks on test panic. Do NOT pass `dir` itself to `AsRef<Path>` APIs (triggers premature drop). Always borrow via `dir.path()`.

**Cargo.toml addition:**
```toml
[dev-dependencies]
tempfile = "3"
```

[CITED: docs.rs/tempfile/latest/tempfile/]

---

## 2. serde_json IO patterns for `UpdateState`

### Save (NOT atomic, acceptable for 3-field state)

```rust
let json = serde_json::to_string_pretty(state).map_err(StorageError::Parse)?;
std::fs::write(path, json).map_err(StorageError::Io)?;
Ok(())
```

**Trade-off:** `fs::write` is a single syscall on Windows but **not atomic** (truncate-then-write window can corrupt file on power loss). Acceptable here:
- 3 fields (`last_check_unix`, `last_dismissed_unix`, `skipped_versions`).
- File rebuilt from current process state every save.
- Worst case (corrupt file): `load()` returns parse error → caller logs → next save overwrites. No data loss beyond last dismiss/skip click.
- Atomic-rename pattern (`tempfile::NamedTempFile::persist()`) is overkill for this use case and adds Windows rename-over-existing-file complexity. **Skip.**

**Why `to_string_pretty` not `to_string`:**
- Human-readable when debugging (file at `$APPDATA/...`).
- Negligible size overhead (~30 bytes for 3 fields).
- One fewer error path than `serde_json::to_writer_pretty` + `File::create` (no separate write/flush errors).

### Load (with empty-file + missing-file early-returns)

```rust
let content = match std::fs::read_to_string(path) {
    Ok(content) => content,
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
        return Ok(UpdateState::default());
    }
    Err(error) => return Err(StorageError::Io(error)),
};
if content.is_empty() {
    return Ok(UpdateState::default());
}
let state = serde_json::from_str(&content).map_err(StorageError::Parse)?;
Ok(state)
```

### `serde_json` empty-input behavior

- `serde_json::from_str("")` → `Err(Error)` whose `.classify()` is `Category::Eof`.
- `serde_json::from_str("{}")` on a `Default`-derived struct → `Ok(Default)`. Only works because every field has a default.
- **We do not rely on `{}`** — explicit `content.is_empty()` check before `from_str` is one fewer error variant to handle and works regardless of `Default` derivation choice. [CITED: docs.rs/serde_json/latest/serde_json/struct.Error.html]

---

## 3. `std::io::ErrorKind::NotFound` idiom

**Standard match-on-kind pattern:**
```rust
match std::fs::read_to_string(path) {
    Ok(content) => content,
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
        return Ok(UpdateState::default());
    }
    Err(error) => return Err(StorageError::Io(error)),
}
```

`error.kind()` returns `ErrorKind` enum. `ErrorKind::NotFound` is platform-agnostic — works on Windows (`ERROR_FILE_NOT_FOUND` 0x2) and Unix (`ENOENT`). No `cfg(windows)` needed. [CITED: doc.rust-lang.org/std/io/enum.ErrorKind.html]

**Alternative (rejected):** `if !path.exists() { return Ok(default()) }` race-conditions with concurrent writers. Match-on-kind is single-syscall and atomic with the read attempt.

---

## 4. Tauri 2.x event payload conventions

[VERIFIED: v2.tauri.app/develop/calling-frontend]

**Minimum derives:** `Serialize + Clone`. `Debug` is project-style (Phase 1 has it on every type). No `Deserialize` — these are emit-only outbound types.

**Wire format:** **camelCase** via `#[serde(rename_all = "camelCase")]`. This is the Tauri 2.x convention for IPC payloads.

> **Important contrast with Phase 1 manifest:** `UpdateManifest` uses `pub_date` (snake_case) because that's the Tauri `latest.json` SCHEMA on disk. Event payloads going OUT to the JS frontend follow Tauri's IPC convention (camelCase). Different surfaces, different rules. Do not "fix" `pub_date` to be consistent with payloads.

**Recommended struct shape (CONTEXT.md decisions):**

```rust
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAvailablePayload {
    pub version: String,
    pub notes: String,
    pub download_url: String,        // → "downloadUrl" on the wire
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadProgressPayload {
    pub downloaded_bytes: u64,       // → "downloadedBytes"
    pub total_bytes: u64,            // → "totalBytes"
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstalledPayload {
    pub version: String,
}
```

**Round-trip test pattern (locks the wire format):**
```rust
#[test]
fn update_available_payload_serializes() {
    let payload = UpdateAvailablePayload {
        version: "0.1.3".to_string(),
        notes: "fixes".to_string(),
        download_url: "https://example.com/x.zip".to_string(),
    };
    let json = serde_json::to_string(&payload).unwrap();
    assert!(json.contains(r#""version":"0.1.3""#));
    assert!(json.contains(r#""downloadUrl":"https://example.com/x.zip""#));
    assert!(!json.contains("download_url"));   // proves rename worked
}
```

`u64` for byte counts is correct — covers files >4GB and matches `tauri-plugin-updater`'s progress types Phase 3 will wire in.

---

## 5. Hand-rolled `StorageError` wrapping `io::Error` + `serde_json::Error`

Both wrapped types impl `std::error::Error + Display`. Forward `Display` to inner. Provide `From` impls so `?` works inside `load`/`save`.

```rust
use std::fmt;

#[derive(Debug)]
pub enum StorageError {
    Io(std::io::Error),
    Parse(serde_json::Error),
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StorageError::Io(error) => write!(f, "update-state IO failed: {error}"),
            StorageError::Parse(error) => write!(f, "update-state JSON parse failed: {error}"),
        }
    }
}

impl std::error::Error for StorageError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            StorageError::Io(error) => Some(error),
            StorageError::Parse(error) => Some(error),
        }
    }
}

impl From<std::io::Error> for StorageError {
    fn from(error: std::io::Error) -> Self {
        StorageError::Io(error)
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(error: serde_json::Error) -> Self {
        StorageError::Parse(error)
    }
}
```

**Why `source()` is wired** (Phase 1 left it empty): wrapping types should expose the cause for Phase 3 logging. Tiny extra code, much better debug experience. Not strictly required — Phase 1 pattern is `impl std::error::Error for ParseError {}` (empty). Match Phase 1's empty form for tightest consistency, OR upgrade. **Recommendation:** match Phase 1 empty form for consistency; defer `source()` until a third error type lands.

**Resulting `load`/`save` ergonomics with `?`:**

```rust
pub fn load(path: &Path) -> Result<UpdateState, StorageError> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(UpdateState::default());
        }
        Err(e) => return Err(StorageError::Io(e)),
    };
    if content.is_empty() {
        return Ok(UpdateState::default());
    }
    let state = serde_json::from_str(&content)?;        // From<serde_json::Error>
    Ok(state)
}

pub fn save(path: &Path, state: &UpdateState) -> Result<(), StorageError> {
    let json = serde_json::to_string_pretty(state)?;    // From<serde_json::Error>
    std::fs::write(path, json)?;                        // From<std::io::Error>
    Ok(())
}
```

Notice `load` writes the NotFound branch explicitly (not via `?`) because we want a non-error early-return, not a propagated error. `save` uses `?` everywhere because every error propagates.

---

## 6. `should_check_now` Tiger-Style + clock-skew handling

```rust
pub fn should_check_now(
    last_check_unix: i64,
    now_unix: i64,
    min_interval_seconds: i64,
) -> bool {
    debug_assert!(
        now_unix >= last_check_unix,
        "now_unix ({now_unix}) must be >= last_check_unix ({last_check_unix})"
    );
    debug_assert!(min_interval_seconds >= 0);

    // Defense in depth: if production hits clock skew (NTP rollback, VM
    // suspend/resume, user adjusts system clock), `now < last` is possible.
    // Returning `true` is the safe choice — caller refreshes state with
    // current `now` after the check, naturally healing the skew.
    if now_unix < last_check_unix {
        return true;
    }

    now_unix - last_check_unix >= min_interval_seconds
}
```

**Why return `true` on skew (not `false`):**
- `false` would mean "skip check forever" (next check requires `now > last + interval`, but `last` is stuck in the future).
- `true` means "check now, refresh `last_check_unix` to current `now`, problem solved next call".
- Aligns with plan Layer 2 contract: caller updates state after check.

**Test coverage (plan-mandated 3 + 1 skew):**
- `should_check_when_never_checked` — `last=0, now=1000, interval=3600 → true`.
- `should_not_check_within_cooldown` — `last=now-100, interval=3600 → false`.
- `should_check_after_cooldown_expires` — `last=now-7200, interval=3600 → true`.
- `should_check_when_clock_went_backward` (recommended addition) — `last=now+500 → true`. Validates skew branch.

`debug_assert!` is a release-mode no-op, so production hitting the skew never panics — the explicit `if` handles it.

---

## 7. `evaluate_update` flat decision tree

Plan §3 Phase 2 GOOD example is the implementation template. Order of checks (locked):

1. **Parse `manifest.version`** → on err: `SilentSkip("bad manifest: {e}")`.
2. **Parse `current`** → on err: `SilentSkip("bad current: {e}")`.
3. **NoUpdate check** (`!is_newer_parsed(&current, &latest)`) → `NoUpdate`.
4. **Skipped check** (`is_version_skipped(&manifest.version, skipped)`) → `SilentSkip("user skipped")`.
5. **Dismiss-cooldown check** (`now_unix - last_dismissed_unix < dismiss_cooldown_seconds`) → `SilentSkip("dismissed cooldown")`.
6. **Else** → `Notify { version, notes, platform_url }`.

**Helper needed:** `is_newer_parsed(&Semver, &Semver) -> bool` (private) since we already have `Semver` from steps 1-2 — avoids re-parsing inside `is_newer(&str, &str)`. Or call `latest > current_parsed` directly via `PartialOrd` on `Semver`. Either works; direct comparison is one less function.

**Template (matches plan exactly + carries Notify fields per CONTEXT.md):**

```rust
use crate::update::manifest::{asset_for_platform, UpdateManifest};
use crate::update::version::parse_semver;

pub enum UpdateDecision {
    Notify {
        version: String,
        notes: String,
        platform_url: String,
    },
    SilentSkip(String),
    NoUpdate,
}

pub fn evaluate_update(
    current: &str,
    manifest: &UpdateManifest,
    skipped: &[String],
    last_dismissed_unix: i64,
    now_unix: i64,
    dismiss_cooldown_seconds: i64,
    platform_key: &str,
) -> UpdateDecision {
    let latest = match parse_semver(&manifest.version) {
        Err(error) => return UpdateDecision::SilentSkip(format!("bad manifest: {error}")),
        Ok(value) => value,
    };
    let current_parsed = match parse_semver(current) {
        Err(error) => return UpdateDecision::SilentSkip(format!("bad current: {error}")),
        Ok(value) => value,
    };
    if latest <= current_parsed {
        return UpdateDecision::NoUpdate;
    }
    if is_version_skipped(&manifest.version, skipped) {
        return UpdateDecision::SilentSkip("user skipped".to_string());
    }
    if now_unix - last_dismissed_unix < dismiss_cooldown_seconds {
        return UpdateDecision::SilentSkip("dismissed cooldown".to_string());
    }
    let platform_url = asset_for_platform(manifest, platform_key)
        .map(|asset| asset.url.clone())
        .unwrap_or_default();
    UpdateDecision::Notify {
        version: manifest.version.clone(),
        notes: manifest.notes.clone(),
        platform_url,
    }
}
```

**Note on `platform_key`:** Plan §3 Phase 2 signature shows 6 params (no `platform_key`). CONTEXT.md `Notify { platform_url }` requires per-platform URL lookup → caller must supply the key. Adding `platform_key: &str` as 7th param is the minimal extension. Phase 3 will pass `tauri_plugin_os::platform()` or similar. **If platform asset missing**, `unwrap_or_default()` yields empty string — Phase 3 will treat empty `download_url` as a no-op signal. Alternative: return `SilentSkip("platform asset missing")` — defer to CONTEXT.md or take agent's call during planning.

**Recommendation:** Return `SilentSkip("no asset for platform {key}")` instead of empty string — fail-fast Tiger-Style. Empty URL silently broken downstream is exactly the bug class we want to prevent.

---

## 8. Pitfalls + recommended Cargo.toml additions

### Pitfalls
- **`serde_json::to_string_pretty` vs `to_string`** — pretty for human-readable state file; cost is ~30 bytes; debugging benefit large. Use pretty.
- **`Path` vs `PathBuf` in API** — accept `&Path` (caller decides ownership). Phase 3 will pass `app_handle.path().app_data_dir()?.join("update-state.json")`.
- **Don't use `File::create` + `serde_json::to_writer`** — adds separate write-error and flush-error paths. `to_string_pretty` + `fs::write` is one error variant per call.
- **Concurrent writes are NOT a concern in Phase 2** — single-process Tauri app, single update-check task. No mutex. Document and skip.
- **`tempdir()` test isolation on Windows** — use `let dir = tempdir()?; let path = dir.path().join(...);` pattern. NEVER `dir.into_path()` — destroys auto-cleanup, leaves test residue.
- **Test panic + TempDir cleanup** — `TempDir`'s `Drop` is best-effort. If a test panics mid-IO, Windows may hold a file handle; cleanup may fail. Normal — does not affect correctness, only leaves stray `Temp/` dirs. tempfile crate documents this. Acceptable for unit tests.
- **`should_check_now` skew handling** — plan mandates `debug_assert!(now >= last)` (release-mode no-op). MUST also have a runtime `if now_unix < last_check_unix { return true; }` defense in depth. See §6.
- **`evaluate_update` flat structure** — plan §3 Phase 2 explicitly shows GOOD vs BAD. Copy GOOD verbatim, do not reinvent. CLAUDE.md "no nested if-in-if" + Tiger-Style audit will reject nested patterns.
- **`UpdateDecision::Notify` field cloning** — `manifest.version.clone()` + `manifest.notes.clone()` is fine. Caller (Phase 3) sends payload across IPC, owns its data. Borrowed `&str` would tie `Notify` lifetime to manifest, causing async lifetime headaches downstream.
- **`pub_date` snake_case is intentional** — do NOT add `#[serde(rename_all = "camelCase")]` to `UpdateManifest` while adding it to dispatcher payloads. Different surfaces.
- **Phase 1 `Semver` does `PartialOrd` already** — use `latest > current_parsed` directly, no need for `is_newer_parsed` helper.
- **`UpdateState` field order** — irrelevant for serialization (JSON object), but `#[derive(Default)]` requires all fields impl `Default` (i64=0, Vec=empty — both auto). No custom impl needed.

### Cargo.toml additions

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["time"] }
semver = "1"
# (no new runtime deps for Phase 2)

[dev-dependencies]
tempfile = "3"
```

Single line added: `tempfile = "3"` under `[dev-dependencies]`. Zero runtime overhead. Confirmed not transitively present (Phase 1 didn't add it). [VERIFIED: Cargo.toml inspection]

---

## 9. Recommendations for Phase 2 implementation

### File-by-file plan (alphabetical commit order matches `mod.rs`)

**1. `src-tauri/src/update/checker.rs`**
- `pub enum UpdateDecision { Notify { version, notes, platform_url }, SilentSkip(String), NoUpdate }` — `#[derive(Debug)]` for test assertions; `PartialEq` for `assert_eq!` in tests.
- `pub fn should_check_now(last_check_unix: i64, now_unix: i64, min_interval_seconds: i64) -> bool` — `debug_assert!(now >= last)`, runtime skew guard.
- `pub fn is_version_skipped(version: &str, skipped: &[String]) -> bool` — one-liner `skipped.iter().any(|v| v == version)`.
- `pub fn evaluate_update(current, manifest, skipped, last_dismissed_unix, now_unix, dismiss_cooldown_seconds, platform_key) -> UpdateDecision` — flat early-return chain (§7 template). 7th param = platform_key (fail-fast on missing asset).
- Inline `#[cfg(test)] mod tests` at file bottom. ~9 tests.

**2. `src-tauri/src/update/dispatcher.rs`**
- Three `#[derive(Serialize, Clone, Debug)]` + `#[serde(rename_all = "camelCase")]` structs (§4).
- No functions. Pure type definitions. Phase 3 fills in `app.emit()` calls.
- Inline `#[cfg(test)] mod tests` — 3 round-trip serialization tests (one per type) locking camelCase wire format.

**3. `src-tauri/src/update/storage.rs`**
- `pub struct UpdateState { last_check_unix: i64, last_dismissed_unix: i64, skipped_versions: Vec<String> }` with `#[derive(Serialize, Deserialize, Default, Debug, Clone, PartialEq)]`.
- `pub enum StorageError { Io(io::Error), Parse(serde_json::Error) }` with manual `Display` + empty `std::error::Error` (Phase 1 consistency) + `From<io::Error>` + `From<serde_json::Error>`.
- `pub fn load(path: &Path) -> Result<UpdateState, StorageError>` — NotFound + empty handling per §2/§3.
- `pub fn save(path: &Path, state: &UpdateState) -> Result<(), StorageError>` — `to_string_pretty` + `fs::write`.
- `pub fn with_dismissed_now(state: UpdateState, now_unix: i64) -> UpdateState` — by-value, returns new.
- `pub fn with_skipped_version(state: UpdateState, version: &str) -> UpdateState` — dedupe via `iter().any()` check; if absent, push clone.
- `pub fn with_check_completed(state: UpdateState, now_unix: i64) -> UpdateState` — sets `last_check_unix`.
- Inline `#[cfg(test)] mod tests` with `tempfile::tempdir()` for IO tests. ~6 tests.

**4. `src-tauri/src/update/mod.rs`** (replace contents)
```rust
pub mod checker;
pub mod dispatcher;
pub mod manifest;
pub mod storage;
pub mod version;
```

Selective re-exports (optional, for Phase 3 ergonomics — defer if unsure):
```rust
pub use checker::{evaluate_update, is_version_skipped, should_check_now, UpdateDecision};
pub use dispatcher::{UpdateAvailablePayload, UpdateDownloadProgressPayload, UpdateInstalledPayload};
pub use storage::{
    load, save, with_check_completed, with_dismissed_now, with_skipped_version,
    StorageError, UpdateState,
};
```
Phase 3 writes `use crate::update::*;` — clean.

### Test budget (≥14 new + 22 existing = ≥36 total)

| File | Test count | Tests |
|------|-----------|-------|
| `checker.rs` | 9 | `should_check_when_never_checked`, `should_not_check_within_cooldown`, `should_check_after_cooldown_expires`, `should_check_when_clock_went_backward` (skew), `evaluate_returns_notify_for_new_version`, `evaluate_returns_silent_skip_when_skipped`, `evaluate_returns_silent_skip_within_dismiss_cooldown`, `evaluate_returns_no_update_when_current_latest`, `evaluate_returns_no_update_when_downgrade` |
| `storage.rs` | 6 | `with_dismissed_now_does_not_mutate_input`, `with_skipped_version_dedupes`, `with_check_completed_sets_timestamp`, `storage_round_trip`, `storage_load_returns_default_when_missing`, `storage_load_returns_default_for_empty_file` |
| `dispatcher.rs` | 3 | `update_available_payload_serializes_to_camel_case`, `update_download_progress_payload_serializes`, `update_installed_payload_serializes` |
| **Phase 2 new** | **18** | (above) |
| **Phase 1 existing** | **22** | (per qq5-SUMMARY) |
| **Total** | **40** | exceeds ≥36 floor |

### Acceptance command

```bash
cd src-tauri && cargo test --package churchaudiostream --lib update::
```

Expected: `40 passed; 0 failed; 0 ignored`.

Plus clean clippy:
```bash
cd src-tauri && cargo clippy --package churchaudiostream --lib -- -D warnings
```

### Tiger-Style + DRY/SRP audit gates (carry over from Phase 1)

| Gate | Target |
|------|--------|
| `cargo test --package churchaudiostream --lib update::` | 40/40 pass |
| `cargo clippy --package churchaudiostream --lib -- -D warnings` | clean |
| `unwrap()` / `expect(` outside `#[cfg(test)]` | zero |
| `println!` / `eprintln!` in `update/` | zero |
| Nested `if let Ok(_) = _ { if ` | zero |
| `String` as `E` in `Result<T, E>` | zero (StorageError is typed) |
| Function bodies > 50 lines | zero (`evaluate_update` is ~25 with 7th param + asset lookup) |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `evaluate_update` should add 7th param `platform_key: &str` (not in plan signature but required by `Notify { platform_url }` in CONTEXT.md) | §7 | If planner disagrees, drop `platform_url` from `Notify` and let Phase 3 look it up — but CONTEXT.md locks `platform_url` in `Notify`, so adding the param is the minimal fix |
| A2 | Missing platform asset → `SilentSkip("no asset for platform {key}")` (fail-fast) rather than empty `download_url` string | §7, §9 | Empty-string-as-signal is silently broken; SilentSkip is loud. If planner prefers empty, change two lines |
| A3 | `StorageError` matches Phase 1's empty `std::error::Error` impl (no `source()`) for consistency, even though wiring `source()` would be tiny improvement | §5 | Cosmetic. Both work. Phase 1 follow-up could uplift all error types together |

---

## Sources

### Primary (HIGH confidence)
- Phase 1 source `src-tauri/src/update/{version,manifest,mod}.rs` — exact patterns to mirror
- `260501-qq5-SUMMARY.md` — Phase 1 contract + audit gates
- `260501-t83-CONTEXT.md` — locked decisions
- `auto-updater-plan.md` §3 Phase 2 — signatures, file layout, test list
- `src-tauri/Cargo.toml` — current deps state
- [docs.rs/tempfile/latest/tempfile/](https://docs.rs/tempfile/latest/tempfile/) — `tempdir()` API + `TempDir` drop semantics + version 3.27.0
- [v2.tauri.app/develop/calling-frontend/](https://v2.tauri.app/develop/calling-frontend/) — `Serialize + Clone` minimum + `rename_all = "camelCase"` convention
- [doc.rust-lang.org/std/io/enum.ErrorKind.html](https://doc.rust-lang.org/std/io/enum.ErrorKind.html) — `ErrorKind::NotFound` platform-agnostic
- [docs.rs/serde_json/latest/serde_json/struct.Error.html](https://docs.rs/serde_json/latest/serde_json/struct.Error.html) — empty-input behavior

### Secondary (MEDIUM confidence)
- WebSearch cross-verification of Tauri 2.x camelCase convention — multiple sources agree

### Tertiary
- None.

---

## Metadata

**Confidence breakdown:**
- File-by-file plan: HIGH — every signature traces to plan §3 Phase 2 + CONTEXT.md decisions
- Tauri payload conventions: HIGH — verified by official docs + WebSearch cross-check
- tempfile usage: HIGH — verified by docs.rs, version 3.27.0 current
- StorageError shape: HIGH — Phase 1's `ParseError`/`ManifestError` is the template
- `evaluate_update` with `platform_key` 7th param: MEDIUM — plan signature has 6 params; the 7th is needed to satisfy CONTEXT.md `Notify { platform_url }`. Flagged in Assumptions Log.

**Research date:** 2026-05-01
**Valid until:** 2026-05-31 (Tauri 2.x stable, tempfile 3.x stable, no breaking changes expected within 30 days)
