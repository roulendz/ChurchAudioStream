---
quick_id: 260501-qq5
description: phase 1 auto-updater — semver + manifest types
status: complete
phase: quick
plan: 01
type: execute
wave: 1
completed: 2026-05-01
duration_minutes: 7
commits:
  - d1d2998 feat(quick-qq5): pure semver helpers + parse_semver/compare/is_newer
  - 9c7dcd7 feat(quick-qq5): UpdateManifest + PlatformAsset types + validate
  - bf33a7d chore: merge quick task worktree (260501-qq5 phase 1 auto-updater)
  - ff79774 fix(update): exclude raw from Semver Ord — pre-release/build metadata regression
requirements:
  - P1-VER
  - P1-MAN
  - P1-VAL
  - P1-ERR
  - P1-TEST
key-files:
  created:
    - src-tauri/src/update/mod.rs
    - src-tauri/src/update/version.rs
    - src-tauri/src/update/manifest.rs
  modified:
    - src-tauri/Cargo.toml (added: semver = "1")
    - src-tauri/Cargo.lock (semver 1.0.28 pulled into workspace deps)
    - src-tauri/src/lib.rs (added: pub mod update;)
tests:
  total: 22
  version: 13
  manifest: 9
  acceptance_threshold: 10
  acceptance_pass: true
  added_post_review:
    - is_newer_treats_pre_release_as_equal_in_phase_1
    - is_newer_treats_build_metadata_as_equal
    - compare_ignores_raw_string_tiebreaker
tech-stack:
  added:
    - semver = "1" (already pinned 1.0.27 transitively via Tauri; now a direct dep)
  patterns:
    - hand-rolled error enums with manual Display + std::error::Error impl (no thiserror)
    - wrapper-around-crate pattern (Semver wraps semver::Version) for swap-without-churn
    - field declaration order load-bearing for derive(Ord) on Semver (numeric not lexical)
    - case-sensitive https:// prefix check (deliberate fail-fast against malformed URLs)
decisions:
  - hand-rolled ParseError + ManifestError, no thiserror dep — Tiger-Style explicit
  - Semver wrapper struct (not re-export semver::Version) so Phase 2/3 depend on our surface
  - inline #[cfg(test)] mod tests at file bottom (idiomatic Rust, no separate tests.rs)
  - notes + pub_date kept as required String (not Option); Phase 5 CI controls manifest gen
  - https:// strict prefix check is case-sensitive and rejects whitespace-prefixed URLs
---

# Quick Task 260501-qq5: Phase 1 Auto-Updater (semver + manifest types) Summary

Pure-Rust foundation for auto-updater. Wraps `semver` crate behind own `Semver` type;
defines `UpdateManifest` matching Tauri 2.x `latest.json` schema; ships hand-rolled
error enums (`ParseError`, `ManifestError`) with manual `Display` + `std::error::Error`.
Zero Tauri code, zero IPC, zero IO — all pure functions.

## What Was Built

### `src-tauri/src/update/version.rs` (179 lines)

Public surface:
- `Semver { major, minor, patch, raw }` — derives `Clone, Debug, Eq, PartialEq, Ord, PartialOrd`. Field order load-bearing for numeric ordering (0.9.0 < 0.10.0).
- `ParseError::{Empty, Invalid { input, reason }}` — `Debug` + hand-written `Display` + empty `std::error::Error` impl.
- `parse_semver(input: &str) -> Result<Semver, ParseError>`
- `compare(a, b) -> Ordering` (delegates to derived `Ord`)
- `is_newer(current: &str, latest: &str) -> Result<bool, ParseError>`

Tests (10):
1. `parse_semver_accepts_valid` (0.1.2, 1.0.0, 2.10.0)
2. `parse_semver_rejects_invalid` (`abc`, `1.x.0`)
3. `parse_semver_rejects_empty` (`""`)
4. `compare_orders_correctly` (incl. 0.9.0 < 0.10.0 numeric proof, equality)
5. `is_newer_handles_equal` → `Ok(false)`
6. `is_newer_handles_downgrade` (0.2.0 → 0.1.0) → `Ok(false)`
7. `is_newer_handles_upgrade` (0.1.2 → 0.1.3) → `Ok(true)`
8. `is_newer_propagates_parse_error_from_current`
9. `is_newer_propagates_parse_error_from_latest`
10. `parse_error_displays_human_readable`

### `src-tauri/src/update/manifest.rs` (236 lines)

Public surface:
- `UpdateManifest { version, notes, pub_date, platforms: HashMap<String, PlatformAsset> }` — `serde::Deserialize`. Snake-case `pub_date` matches Tauri schema verbatim.
- `PlatformAsset { signature, url }` — `serde::Deserialize`.
- `ManifestError::{InvalidVersion(ParseError), EmptyPlatforms, NonHttpsUrl { platform, url }}` — `Debug` + hand-written `Display` + empty `std::error::Error` impl.
- `asset_for_platform<'a>(&'a UpdateManifest, &str) -> Option<&'a PlatformAsset>` — borrow, no clone.
- `validate(&UpdateManifest) -> Result<(), ManifestError>` — flat structure, no nested ifs.

Tests (9):
1. `manifest_validates_https_urls` (two-platform happy path: windows-x86_64 + darwin-aarch64)
2. `manifest_rejects_http_url` (asserts `platform` + `url` carried in error)
3. `manifest_rejects_uppercase_scheme` (case-sensitive prefix proof)
4. `manifest_rejects_empty_platforms`
5. `manifest_rejects_invalid_version`
6. `asset_for_platform_returns_match`
7. `asset_for_platform_returns_none_for_unknown`
8. `manifest_deserializes_from_json` (canonical Tauri shape — version/notes/pub_date/platforms all asserted)
9. `manifest_error_displays_human_readable`

DRY helper `make_manifest(version, url) -> UpdateManifest` keeps test bodies clean.

### `src-tauri/src/update/mod.rs`

Two declarations, alphabetical: `pub mod manifest; pub mod version;`.

### `src-tauri/Cargo.toml`

Single new line: `semver = "1"` under `[dependencies]`. No features. Zero binary
size cost — already pinned 1.0.27 transitively via Tauri.

### `src-tauri/src/lib.rs`

Single new line at top: `pub mod update;`.

## Acceptance Command Output

```
$ cd src-tauri && cargo test --package churchaudiostream --lib update::
running 19 tests
test update::manifest::tests::asset_for_platform_returns_match ... ok
test update::manifest::tests::asset_for_platform_returns_none_for_unknown ... ok
test update::manifest::tests::manifest_rejects_uppercase_scheme ... ok
test update::manifest::tests::manifest_rejects_http_url ... ok
test update::manifest::tests::manifest_error_displays_human_readable ... ok
test update::version::tests::is_newer_handles_upgrade ... ok
test update::version::tests::parse_error_displays_human_readable ... ok
test update::version::tests::compare_orders_correctly ... ok
test update::manifest::tests::manifest_deserializes_from_json ... ok
test update::version::tests::is_newer_handles_downgrade ... ok
test update::version::tests::is_newer_handles_equal ... ok
test update::manifest::tests::manifest_rejects_empty_platforms ... ok
test update::version::tests::is_newer_propagates_parse_error_from_current ... ok
test update::version::tests::is_newer_propagates_parse_error_from_latest ... ok
test update::manifest::tests::manifest_rejects_invalid_version ... ok
test update::manifest::tests::manifest_validates_https_urls ... ok
test update::version::tests::parse_semver_accepts_valid ... ok
test update::version::tests::parse_semver_rejects_empty ... ok
test update::version::tests::parse_semver_rejects_invalid ... ok

test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

19 tests total, 9 above the 10-minimum acceptance threshold. All green.

## Tiger-Style + DRY/SRP/no-nested-if Audit

| Gate | Result |
|------|--------|
| `cargo test --package churchaudiostream --lib update::` | 19/19 pass |
| `cargo build --package churchaudiostream` | clean, zero new warnings |
| `cargo clippy --package churchaudiostream --lib -- -D warnings` | clean, zero warnings |
| `unwrap()`/`expect(` outside `#[cfg(test)]` | zero matches |
| `println!`/`eprintln!` in `update/` | zero matches |
| Nested `if let Ok(_) = _ { if ` | zero matches |
| `String` as `E` in `Result<T, E>` | zero matches |
| Function bodies > 50 lines | zero matches (largest: `validate` ~14 lines) |
| Field declaration order in `Semver` (numeric ordering) | verified by `compare_orders_correctly` (0.9.0 < 0.10.0) |
| One `#[cfg(test)]` module per `*.rs` file (DRY tests) | yes |

## Public Surface Contract Verification (vs plan §3 Phase 1)

| Symbol | Plan signature | Implemented signature | Match |
|--------|----------------|----------------------|-------|
| `Semver` | `pub struct Semver { major: u64, minor: u64, patch: u64, raw: String (private) }` | identical | yes |
| `ParseError` | `pub enum ParseError { Empty, Invalid { input, reason } }` | identical | yes |
| `parse_semver` | `(input: &str) -> Result<Semver, ParseError>` | identical | yes |
| `compare` | `(a: &Semver, b: &Semver) -> Ordering` | identical | yes |
| `is_newer` | `(current: &str, latest: &str) -> Result<bool, ParseError>` | identical | yes |
| `UpdateManifest` | `pub struct UpdateManifest { version: String, notes: String, pub_date: String, platforms: HashMap<String, PlatformAsset> }` | identical | yes |
| `PlatformAsset` | `pub struct PlatformAsset { signature: String, url: String }` | identical | yes |
| `ManifestError` | `pub enum ManifestError { InvalidVersion(ParseError), EmptyPlatforms, NonHttpsUrl { platform, url } }` | identical | yes |
| `asset_for_platform` | `<'a>(manifest: &'a UpdateManifest, platform_key: &str) -> Option<&'a PlatformAsset>` | identical | yes |
| `validate` | `(manifest: &UpdateManifest) -> Result<(), ManifestError>` | identical | yes |

Phase 2 can land without churn.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stub artifacts to satisfy `tauri-build` resource manifest**

- **Found during:** Task 1 verification (cargo test compile)
- **Issue:** Worktree had no `src-tauri/binaries/server-x86_64-pc-windows-msvc.exe`, no `src-tauri/binaries/mediasoup-worker.exe`, and no `sidecar/public/` directory. `tauri-build` (build.rs) checks all `tauri.conf.json` `externalBin` + `resources` paths exist at compile time — missing → `error: failed to run custom build command`. Pure-Rust unit tests for `update::*` could not run.
- **Fix:** Created zero-byte stub `src-tauri/binaries/{server-x86_64-pc-windows-msvc,mediasoup-worker}.exe` + empty `sidecar/public/.gitkeep`. All three paths are `.gitignore`'d (verified: `git status --ignored`), so they never enter the commit. Tests then ran clean.
- **Files modified:** none committed — stub paths are gitignored build infrastructure
- **Commit:** n/a (no source change)
- **Note for orchestrator:** Worktree-fresh executions on this repo will repeatedly hit this. Long-term fix is documenting this in CLAUDE.md "build order" (out of scope here).

**2. [Process — agent error caught] First Write attempts targeted main repo, not worktree**

- **Found during:** Task 1 first verification — `cargo test` reported `0 tests` even though source claimed to exist.
- **Issue:** Initial Write tool invocations used `C:\laragon\www\ChurchAudioStream\src-tauri\...` paths (main repo) instead of `C:\laragon\www\ChurchAudioStream\.claude\worktrees\agent-a9e04af042953ed64\src-tauri\...` (worktree). Cargo built worktree code, found no `update` module → 0 tests.
- **Fix:** Cleaned main repo (`git checkout --` + `rm -rf update/`) then re-wrote all files inside worktree path. Main repo state restored. Worktree state correct.
- **Files modified:** none — main repo reverted, worktree files re-created
- **Commit:** n/a
- **Note:** Caveman fix; no behavioural deviation from plan.

### Architectural Changes (Rule 4)

None.

### Authentication Gates

None.

## Threat Flags

None. Pure-Rust types + pure validators. No network, no filesystem, no IPC, no
deserialization of untrusted input (Phase 1 manifests come from controlled CI).

## Code Review Follow-Up

`gsd-code-reviewer` found 0 BLOCKER, 3 MAJOR, 4 MINOR, 2 NIT (full report at `260501-qq5-REVIEW.md`).

### Fixed in `ff79774` (post-merge fix commit)

- **MA-01 / MA-02** — `Semver` derived `Ord` walked `raw: String` as a 4th tiebreaker. So `1.0.0` vs `1.0.0+build` compared `Less` (lexical) instead of `Equal` (per semver §10), and `is_newer("1.0.0", "1.0.0-alpha")` returned `true` (false downgrade-as-upgrade for Phase 2/3). Replaced derive with manual `Ord/PartialOrd/Eq/PartialEq` on `(major, minor, patch)` tuple. Doc comment rewritten to state Phase 1 contract (pre-release/build metadata discarded → equal triples compare equal). Three regression tests added: `is_newer_treats_pre_release_as_equal_in_phase_1`, `is_newer_treats_build_metadata_as_equal`, `compare_ignores_raw_string_tiebreaker`. Final test count: **22/22 green**.

### Deferred to Phase 2 / hardening pass

- **MA-03** — `validate()` URL check is `starts_with("https://")` only. Accepts `https://` (empty host), `https://attacker@trusted.example/...` (userinfo splat), `https:// ` (whitespace). Plan §3 Phase 1 explicitly accepted strict prefix as fine; Phase 3 Tauri plugin does its own URL parsing + signature verification. Defer until network code lands.
- **MI-01** — `parse_semver("   ")` returns `Invalid` not `Empty`. Cosmetic variant choice. Defer.
- **MI-02** — `validate()` does not assert `notes`/`pub_date`/`signature` non-empty. Phase 5 CI controls manifest generation. Defer until untrusted manifest sources exist.
- **MI-03** — `validate()` iterates `HashMap` non-deterministically; `NonHttpsUrl` carries arbitrary platform key on multi-bad input. Switch to `BTreeMap` in Phase 2 when more code touches the manifest type.
- **MI-04** — Test gaps for whitespace, empty signature, multi-bad-URL determinism. Add when MI-01/MI-02/MI-03 are fixed.
- **NI-01 / NI-02** — `Display`/`Error` boilerplate duplication; `compare()` thin wrapper. Defer per reviewer recommendation (re-evaluate when third error enum lands or `compare` proves unused in Phase 2).

## Self-Check: PASSED

Files exist:
- `src-tauri/src/update/mod.rs` — FOUND
- `src-tauri/src/update/version.rs` — FOUND
- `src-tauri/src/update/manifest.rs` — FOUND

Commits on master:
- `d1d2998` (Task 1) — `feat(quick-qq5): pure semver helpers + parse_semver/compare/is_newer`
- `9c7dcd7` (Task 2) — `feat(quick-qq5): UpdateManifest + PlatformAsset types + validate`
- `bf33a7d` — `chore: merge quick task worktree`
- `ff79774` — `fix(update): exclude raw from Semver Ord — pre-release/build metadata regression`

Final acceptance: `cargo test --package churchaudiostream --lib update::` → **22 passed; 0 failed**. `cargo clippy --package churchaudiostream --lib -- -D warnings` clean.
