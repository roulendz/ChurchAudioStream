---
phase: 260501-qq5-phase-1-auto-updater-semver-and-manifest
reviewed: 2026-05-01T00:00:00Z
depth: quick
files_reviewed: 5
files_reviewed_list:
  - src-tauri/src/update/mod.rs
  - src-tauri/src/update/version.rs
  - src-tauri/src/update/manifest.rs
  - src-tauri/src/lib.rs
  - src-tauri/Cargo.toml
findings:
  critical: 0
  major: 3
  minor: 4
  nit: 2
  total: 9
status: findings
---

# Phase 260501-qq5: Code Review Report

**Reviewed:** 2026-05-01
**Depth:** quick
**Files Reviewed:** 5
**Status:** findings

## Summary

Phase 1 implementation clean overall. Pure-logic surface, no Tauri/IO yet, no panic paths in production, no secrets, no `unwrap` outside tests. Cargo dep addition (`semver = "1"`) minimal.

Three MAJOR correctness bugs hidden in `Semver` ordering: `raw: String` participates in derived `Ord` as fourth tiebreaker, so two versions with same `(major, minor, patch)` but different raw strings (pre-release suffix, build metadata) compare unequal — and `is_newer` returns wrong result. Phase 2 will inherit: `is_newer("1.0.0", "1.0.0-alpha")` returns `true` (false downgrade-as-upgrade). URL validation prefix-only — accepts `https://` with no host or with userinfo tricks. Manifest validator skips empty-string checks on `notes`/`pub_date`/`signature` despite Tiger-Style fail-fast claim.

Test gaps: no pre-release/build-metadata cases, no whitespace input, no multi-bad-URL determinism, no empty-signature.

## BLOCKER

_(none)_

## MAJOR

### MA-01: `Semver` derived `Ord` includes `raw` as tiebreaker — broken comparison for equal triples with different raw

**File:** `src-tauri/src/update/version.rs:14-20`
**Issue:** `#[derive(Ord, PartialOrd)]` walks fields in declaration order: `major, minor, patch, raw`. `raw: String` is the fourth field and participates. Two `Semver` values with identical triples but different raw strings compare non-equal, and ordering is lexical on raw. Doc comment claims ordering is "numeric and never influenced by lexicographic raw string" — this is FALSE. Examples that misbehave:

- `parse_semver("1.0.0").cmp(parse_semver("1.0.0+build"))` → `Ordering::Less` (raw `"1.0.0"` < `"1.0.0+build"`), should be `Equal` per semver §10.
- `is_newer("1.0.0", "1.0.0-alpha")` → returns `Ok(true)` (raw `"1.0.0-alpha"` > `"1.0.0"` lexically), but `1.0.0-alpha` is OLDER than `1.0.0` per semver §11. Phase 2 update check would offer a downgrade as an upgrade.

Note: `semver::Version::parse` accepts pre-release/build metadata (`"1.0.0-alpha"`, `"1.0.0+build"`) without error, so these values reach the broken path through normal input.

**Fix:** Drop `raw` from ordering. Either:

```rust
// Option A: implement Ord manually on (major, minor, patch) only
impl Ord for Semver {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        (self.major, self.minor, self.patch).cmp(&(other.major, other.minor, other.patch))
    }
}
impl PartialOrd for Semver { fn partial_cmp(&self, o: &Self) -> Option<std::cmp::Ordering> { Some(self.cmp(o)) } }
impl PartialEq for Semver { fn eq(&self, o: &Self) -> bool { self.cmp(o) == std::cmp::Ordering::Equal } }
impl Eq for Semver {}
```

Or Option B: store the parsed `semver::Version` and delegate to its `Ord` (handles pre-release/build correctly per spec). Add explicit tests `is_newer("1.0.0", "1.0.0-alpha") == false` and `is_newer("1.0.0", "1.0.0+build") == false`.

### MA-02: `is_newer` returns wrong result for pre-release / build-metadata inputs (consequence of MA-01)

**File:** `src-tauri/src/update/version.rs:78-82`
**Issue:** `is_newer` inherits the broken comparison. Phase 2 reads app version from `Cargo.toml` (`"0.1.2"`) and remote `latest.json` `version` field. If a CI mistake or test fixture publishes `"0.1.2-rc1"` or `"0.1.2+build7"` after `"0.1.2"` is shipped, listeners get false-positive update prompts (or worse, the path triggers a downgrade install in Phase 3). No regression test covers this.

**Fix:** Resolved by MA-01. Add tests:

```rust
#[test] fn is_newer_handles_pre_release_as_older() {
    assert_eq!(is_newer("1.0.0", "1.0.0-alpha").unwrap(), false);
    assert_eq!(is_newer("1.0.0-alpha", "1.0.0").unwrap(), true);
}
#[test] fn is_newer_treats_build_metadata_as_equal() {
    assert_eq!(is_newer("1.0.0", "1.0.0+build").unwrap(), false);
    assert_eq!(is_newer("1.0.0+build1", "1.0.0+build2").unwrap(), false);
}
```

### MA-03: URL validation is prefix-only — accepts `https://` with empty host and userinfo splats

**File:** `src-tauri/src/update/manifest.rs:90-104`
**Issue:** `asset.url.starts_with("https://")` passes:
- `"https://"` (zero-length host)
- `"https:///path"` (empty host, triple-slash)
- `"https://attacker.com@trusted.example/x.zip"` (userinfo `attacker.com` → connection target is `trusted.example`, but visual scan reads `attacker.com`)
- `"https:// "` (space after scheme — host parses as space)

Phase 3 will feed this URL to a downloader. Doc comment defends "machine-generated, deviation = bug" but that contradicts the Tiger-Style "fail-fast at boundaries" claim and the explicit case-sensitive uppercase-rejection logic (which is laxer-than-claimed). Boundary input from network is untrusted regardless of generator.

**Fix:** Parse and assert structural invariants:

```rust
fn url_is_secure(url: &str) -> bool {
    // Without adding `url` crate: minimum manual checks
    if !url.starts_with("https://") { return false; }
    let after_scheme = &url["https://".len()..];
    if after_scheme.is_empty() { return false; }
    // Host must come before first '/', '?', '#' and be non-empty, contain no '@'
    let host_end = after_scheme
        .find(|c: char| c == '/' || c == '?' || c == '#')
        .unwrap_or(after_scheme.len());
    let host = &after_scheme[..host_end];
    !host.is_empty() && !host.contains('@') && !host.contains(' ')
}
```

Better: add `url = "2"` dep and use `url::Url::parse`, assert `scheme() == "https"`, `host_str().is_some()`, `username().is_empty()`. Add tests for each rejected form.

## MINOR

### MI-01: `parse_semver` rejects empty but not whitespace-only

**File:** `src-tauri/src/update/version.rs:54-57`
**Issue:** `if input.is_empty()` only catches `""`. Input `"   "` falls through to `semver::Version::parse` which returns `Invalid` with crate-internal error message. Two near-identical errors with different variants — caller logic that special-cases `Empty` (e.g., "config not set") misses whitespace.

**Fix:**

```rust
if input.trim().is_empty() {
    return Err(ParseError::Empty);
}
```

Add test `parse_semver("   ")` returns `ParseError::Empty`.

### MI-02: `validate` does not check `notes`, `pub_date`, `signature` non-empty

**File:** `src-tauri/src/update/manifest.rs:90-104`
**Issue:** Module doc says "missing fields = bug worth failing on" and serde guarantees presence (since fields are `String` not `Option<String>`), but `""` passes serde and `validate`. Tiger-Style fail-fast on boundary: empty = missing in practice. Phase 5 CI could emit empty `notes` accidentally, downstream UI shows blank changelog.

**Fix:** Extend `ManifestError`:

```rust
ManifestError::EmptyField { field: &'static str },
ManifestError::EmptySignature { platform: String },
```

In `validate`, check `manifest.notes.is_empty()`, `manifest.pub_date.is_empty()`, and per-platform `asset.signature.is_empty()`. Add tests.

### MI-03: `validate` iteration order over `HashMap` non-deterministic — error variant carries arbitrary platform on multi-bad input

**File:** `src-tauri/src/update/manifest.rs:95-102`
**Issue:** `for (platform, asset) in &manifest.platforms` walks `HashMap` in unspecified order. If two platforms have non-https URLs, which one surfaces in `NonHttpsUrl { platform, url }` is run-dependent. Hard to write a reliable test, hard to debug from a single error report ("which one is wrong?" — could be either). Tiger-Style says fail fast on FIRST violation, but "first" should be deterministic.

**Fix:** Sort platform keys before iteration, or switch to `BTreeMap<String, PlatformAsset>` (preserves insertion-stable, key-sorted order). `BTreeMap` is the cleaner change:

```rust
use std::collections::BTreeMap;
pub struct UpdateManifest {
    // ...
    pub platforms: BTreeMap<String, PlatformAsset>,
}
```

Serde supports `BTreeMap` natively; no other change needed.

### MI-04: No test coverage for the actual file path consumers (Phase 2 inherits)

**File:** `src-tauri/src/update/version.rs:84-186`, `src-tauri/src/update/manifest.rs:106-236`
**Issue:** Tests cover happy-path + each error variant once, but skip:
- `parse_semver` with pre-release (`"1.0.0-alpha"`), build metadata (`"1.0.0+build"`), whitespace (`"   "`, `" 1.0.0 "`).
- `is_newer` with pre-release / build metadata pairs (would expose MA-01/MA-02).
- `validate` with empty signature, empty notes, empty pub_date, multiple bad URLs (determinism), `"https://"` zero-host.

**Fix:** Add the test cases listed under MA-02 and MI-02. CLAUDE.md rule: "Each function tested so we know where bugs can come in" — current coverage misses the bug-prone semver edge cases entirely.

## NIT

### NI-01: Two hand-rolled error enums duplicate `Display` + `Error` impl boilerplate

**File:** `src-tauri/src/update/version.rs:30-47`, `src-tauri/src/update/manifest.rs:40-66`
**Issue:** Each enum repeats `impl fmt::Display { match ... }` + `impl std::error::Error {}`. Mild DRY violation. Acceptable for Phase 1 (only two enums, no `thiserror` dep). Flag for Phase 3+ when more error types added — at three enums, justify a `thiserror` dep or a small declarative macro.

**Fix:** Defer. Re-evaluate when adding the next error enum.

### NI-02: `compare` is a one-liner public wrapper around `Ord::cmp`

**File:** `src-tauri/src/update/version.rs:71-73`
**Issue:** `compare(a, b) == a.cmp(b)`. Pure indirection. Doc comment names it as Phase 2/3 contract — fine, but a free function adds nothing over the trait method. Callers can use `a.cmp(b)` directly.

**Fix:** Defer. If Phase 2 never uses `compare()` directly (only `is_newer`), drop it then.

---

_Reviewed: 2026-05-01_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
