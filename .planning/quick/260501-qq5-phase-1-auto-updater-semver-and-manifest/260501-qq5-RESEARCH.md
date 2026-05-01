# Phase 1 Auto-Updater (semver + manifest types) — Research

**Researched:** 2026-05-01
**Confidence:** HIGH
**Scope:** Pure Rust types/functions only. No Tauri, no IPC, no IO.

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use `semver` crate (already in `Cargo.lock` 1.0.27 transitively via Tauri).
- Wrap crate behind own surface (`Semver`, `parse_semver()`, `compare()`, `is_newer()`).
- Inline `#[cfg(test)] mod tests { ... }` per file.
- Hand-rolled `ParseError` + `ManifestError` enums with manual `Display` + `std::error::Error` impls.
- `validate()` rejects `http://` URLs via strict prefix check + rejects empty `platforms` map.
- `asset_for_platform()` returns `Option<&'a PlatformAsset>` (borrow, no clone).
- Crate `[package].name = "churchaudiostream"`, `[lib].name = "churchaudiostream_lib"`. Acceptance: `cargo test --package churchaudiostream --lib update::`.

### Claude's Discretion
- Module ordering in `mod.rs`: `pub mod manifest; pub mod version;` + targeted re-exports.
- `Semver` struct: keep `(major, minor, patch)` as `u64` plus original input string for debug.
- Inline `&str` test fixtures, no `fixtures/` dir.

### Deferred (OUT OF SCOPE)
- Phase 2 checker/storage/dispatcher.
- Phase 3 Tauri plugin / IPC / signing.
- Phase 4 React UI.
- Phase 5 GitHub Actions workflow.
- `thiserror`, `anyhow`, `tracing`, `tauri-plugin-updater`.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| P1-VER | Pure semver parse/compare/is_newer | §1 semver crate API |
| P1-MAN | UpdateManifest + PlatformAsset serde types matching Tauri schema | §2 latest.json schema |
| P1-VAL | validate() rejects http URLs + empty platforms | §2 + §4 strict prefix |
| P1-ERR | Hand-rolled ParseError + ManifestError, no String errors | §3 error pattern |
| P1-TEST | 10+ unit tests, `cargo test ... --lib update::` green | §5 acceptance |

---

## 1. `semver` crate API [VERIFIED: github.com/dtolnay/semver]

**Crate:** `semver` 1.0.28 latest, **1.0.27 already pinned in `src-tauri/Cargo.lock`** (transitive via Tauri). Adding `semver = "1"` to `[dependencies]` reuses the same compiled artifact. MSRV 1.68. License MIT/Apache-2.0. Maintainer: dtolnay (Cargo's own semver).

**Trait derives on `Version`:**
```rust
#[derive(Clone, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct Version { pub major: u64, pub minor: u64, pub patch: u64, pub pre: Prerelease, pub build: BuildMetadata }
```
`Debug` + `Display` impl'd manually in `display.rs`. **`Ord` + `PartialOrd` derived** → `<`, `>`, `cmp()`, `partial_cmp()` all work directly. `0.1.2 < 0.1.3`, `0.9.0 < 0.10.0` — confirmed by Cargo's own usage.

**Parse signature:**
```rust
impl Version {
    pub fn parse(text: &str) -> Result<Self, semver::Error>;
}
```
`semver::Error` impls `std::error::Error + Display + Debug`.

**Features:** `default = ["std"]`, `std`, `serde` (optional). **Serde NOT enabled by default.** We do NOT enable it — manifest's `version` is plain `String` (defer parse to `validate()`), keeping `serde::Deserialize` derives trivial.

**Minimal usage:**
```rust
use semver::Version;

let parsed: Version = Version::parse("0.1.2")?;
let other = Version::parse("0.10.0")?;
assert!(parsed < other);                        // PartialOrd derived
assert_eq!(parsed.cmp(&other), Ordering::Less); // Ord derived
```

`Cargo.toml` add (single line):
```toml
semver = "1"
```

---

## 2. Tauri 2.x `latest.json` schema [VERIFIED: v2.tauri.app/plugin/updater]

**Required fields:** `version` (String, valid SemVer with or without leading `v`), `platforms.<key>.url` (String), `platforms.<key>.signature` (String, content of `.sig`).

**Optional:** `notes` (String), `pub_date` (String, RFC 3339).

**Platform key format:** `OS-ARCH`.
- OS: `linux` | `darwin` | `windows`
- ARCH: `x86_64` | `aarch64` | `i686` | `armv7`
- Examples: `windows-x86_64`, `darwin-aarch64`, `linux-x86_64`.

Field naming snake_case: `pub_date` (NOT `pubDate`), `notes` (NOT `release_notes`). Matches plan §3 struct exactly.

**Canonical sample:**
```json
{
  "version": "0.1.3",
  "notes": "Bug fixes and improvements",
  "pub_date": "2026-05-01T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IC4uLg==",
      "url": "https://github.com/roulendz/ChurchAudioStream/releases/download/v0.1.3/ChurchAudioStream_0.1.3_x64-setup.nsis.zip"
    }
  }
}
```

**Plan struct → schema mapping (1:1 match):**
```rust
#[derive(serde::Deserialize)]
pub struct UpdateManifest {
    pub version: String,                          // matches "version"
    pub notes: String,                            // matches "notes"  (defaulted? see pitfall §4)
    pub pub_date: String,                         // matches "pub_date" (snake_case, no rename needed)
    pub platforms: HashMap<String, PlatformAsset>,
}

#[derive(serde::Deserialize)]
pub struct PlatformAsset {
    pub signature: String,
    pub url: String,
}
```

`HashMap<String, PlatformAsset>` deserializes natively from a JSON object — `serde_json` standard behavior, no extra wiring.

---

## 3. Hand-rolled error pattern (Tiger-Style, zero deps)

Idiomatic pattern when avoiding `thiserror`. One enum per module.

```rust
// src-tauri/src/update/version.rs

use std::fmt;

#[derive(Debug)]
pub enum ParseError {
    Empty,
    Invalid { input: String, reason: String },
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParseError::Empty => write!(f, "semver input is empty"),
            ParseError::Invalid { input, reason } => {
                write!(f, "semver parse failed for {input:?}: {reason}")
            }
        }
    }
}

impl std::error::Error for ParseError {}

// Convert from underlying crate error at boundary
impl From<semver::Error> for ParseError {
    fn from(error: semver::Error) -> Self {
        ParseError::Invalid {
            input: String::new(), // filled by caller via map_err if needed
            reason: error.to_string(),
        }
    }
}
```

Same shape for `ManifestError`:
```rust
#[derive(Debug)]
pub enum ManifestError {
    InvalidVersion(ParseError),
    EmptyPlatforms,
    NonHttpsUrl { platform: String, url: String },
}
// impl Display + std::error::Error identically
```

Tiger-Style notes:
- Variants carry context (no opaque `()` payloads).
- `Debug` derived (formatter-only); `Display` hand-written for human messages.
- No `String` as `E` — typed enum throughout.
- `From<semver::Error>` keeps wrapping clean at module boundary.

---

## 4. Pitfalls + recommended `Cargo.toml` addition

### Pitfall 4.1 — `serde` feature on `semver` is NOT enabled by default
`semver::Version` does NOT impl `Deserialize` unless `features = ["serde"]`. Per CONTEXT.md decision, we keep `version: String` in `UpdateManifest` and parse in `validate()`. So **do NOT enable `semver/serde`**. Cleaner; one less feature flag.

### Pitfall 4.2 — `HashMap<String, PlatformAsset>` deserialization
Works out of the box with `#[derive(Deserialize)]`. No `serde(with = ...)` needed. Empty object `"platforms": {}` parses successfully — `validate()` must reject this case (test `manifest_rejects_empty_platforms`).

### Pitfall 4.3 — Missing optional fields
Tauri schema says `notes` + `pub_date` are optional. Plan struct declares them as `String` (required). Two options:
1. **Plan-literal:** keep `String`, fail deserialization if missing. Simpler. Acceptable for v0.1.x since our own CI generates the manifest (Phase 5) and always includes both.
2. **Permissive:** `pub notes: Option<String>` + `pub pub_date: Option<String>` with `#[serde(default)]`.

**Recommendation:** stick with plan-literal (`String`). Phase 5 workflow controls manifest generation; missing fields = bug worth failing on. If Phase 3 ever consumes external manifests, switch to `Option<String>` then. Add inline comment in `manifest.rs` documenting this choice.

### Pitfall 4.4 — `https://` strict prefix vs URL parse
Strict prefix `url.starts_with("https://")` is correct per CONTEXT.md decision. Edge: rejects whitespace-prefixed URLs (`" https://..."`) and uppercase scheme (`"HTTPS://..."`). Both desirable — manifest is machine-generated, malformed URL = bug. Document in `validate()` doc comment: "case-sensitive https:// prefix; reject anything else".

### Pitfall 4.5 — `semver` already transitively pinned
`Cargo.lock` shows `semver 1.0.27` already present (pulled by Tauri itself). Adding `semver = "1"` to `[dependencies]` does NOT bump the lock entry — Cargo reuses it. Zero binary size cost.

### Pitfall 4.6 — `Result<T, E>` chains: avoid nested `if let Ok(_)`
CLAUDE.md + plan §4 forbid nested if-in-if. Use `?` operator + early returns:
```rust
// GOOD
pub fn is_newer(current: &str, latest: &str) -> Result<bool, ParseError> {
    let current_parsed = parse_semver(current)?;
    let latest_parsed = parse_semver(latest)?;
    Ok(latest_parsed > current_parsed)
}

// BAD — nested if-let chain
if let Ok(c) = parse_semver(current) { if let Ok(l) = parse_semver(latest) { ... } }
```

### Recommended `Cargo.toml` addition
```toml
[dependencies]
# ... existing entries ...
semver = "1"
```
Single line. No features. No new transitive deps (already in lockfile). `serde` + `serde_json` already present and sufficient for manifest types.

---

## 5. Recommendations for Phase 1 implementation

### File layout (matches plan §3 + CONTEXT.md)
```
src-tauri/src/update/
├── mod.rs           # pub mod manifest; pub mod version;
├── version.rs       # Semver, ParseError, parse_semver, compare, is_newer + #[cfg(test)] mod tests
└── manifest.rs      # UpdateManifest, PlatformAsset, ManifestError, asset_for_platform, validate + #[cfg(test)] mod tests
```

Wire into `src-tauri/src/lib.rs` at top:
```rust
pub mod update;
```

### `Semver` wrapper struct
Keep our own type; delegate to `semver::Version` internally:
```rust
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct Semver {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    raw: String, // original input, for Debug + future error messages
}

pub fn parse_semver(input: &str) -> Result<Semver, ParseError> {
    if input.is_empty() { return Err(ParseError::Empty); }
    let v = semver::Version::parse(input).map_err(|e| ParseError::Invalid {
        input: input.to_string(),
        reason: e.to_string(),
    })?;
    Ok(Semver { major: v.major, minor: v.minor, patch: v.patch, raw: input.to_string() })
}

pub fn compare(a: &Semver, b: &Semver) -> std::cmp::Ordering { a.cmp(b) }

pub fn is_newer(current: &str, latest: &str) -> Result<bool, ParseError> {
    let c = parse_semver(current)?;
    let l = parse_semver(latest)?;
    Ok(l > c)
}
```
Note: ignoring `pre` + `build` per CONTEXT.md ("delegated entirely to semver crate"). For v0.x.x that's fine — we'll never publish prerelease tags. If later we need prerelease awareness, swap `(major, minor, patch)` storage for the full `semver::Version` and the public surface stays the same — that's the wrapper paying off.

### `validate()` flat structure (no nested ifs)
```rust
pub fn validate(manifest: &UpdateManifest) -> Result<(), ManifestError> {
    parse_semver(&manifest.version).map_err(ManifestError::InvalidVersion)?;
    if manifest.platforms.is_empty() {
        return Err(ManifestError::EmptyPlatforms);
    }
    for (platform, asset) in &manifest.platforms {
        if !asset.url.starts_with("https://") {
            return Err(ManifestError::NonHttpsUrl {
                platform: platform.clone(),
                url: asset.url.clone(),
            });
        }
    }
    Ok(())
}
```

### Test command (acceptance)
```bash
cd src-tauri
cargo test --package churchaudiostream --lib update::
```
Crate name = `churchaudiostream` (per `[package].name`), `--lib` filter restricts to lib target (`churchaudiostream_lib`), `update::` path filter runs only the new module's `#[cfg(test)] mod tests`. Confirmed working pattern for Tauri 2.x projects.

### Test list (10 cases per plan)
Already specified in plan §3 Phase 1. Inline `&str` literals, no fixtures dir. `manifest_rejects_http_url` uses `http://example.com` URL; `manifest_validates_https_urls` uses real-looking GitHub release URL.

### Don't-hand-roll items
- ✅ Use `semver` crate — proven, already pinned. Don't write a SemVer parser.
- ✅ Use `serde_json` (already present). Don't write JSON parser.
- ❌ Don't add `thiserror` yet — overkill for 2 enums.
- ❌ Don't add URL crate — strict prefix check is the spec.

## Sources

### Primary (HIGH)
- https://github.com/dtolnay/semver/blob/master/src/lib.rs — Version derives + parse signature
- https://github.com/dtolnay/semver/blob/master/Cargo.toml — features, MSRV
- https://v2.tauri.app/plugin/updater/ — latest.json schema
- `src-tauri/Cargo.lock` (local) — confirms semver 1.0.27 already pinned

### Confidence
- semver crate API: HIGH (source-verified)
- Tauri schema: HIGH (official docs)
- Error pattern: HIGH (Rust idiom)
- Pitfalls: HIGH (verified against locked deps + plan)

## Assumptions Log

(empty — all claims verified or cited)
