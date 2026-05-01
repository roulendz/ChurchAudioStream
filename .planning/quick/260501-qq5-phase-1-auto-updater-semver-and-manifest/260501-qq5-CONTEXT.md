# Quick Task 260501-qq5: Phase 1 auto-updater (semver + manifest types) - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Task Boundary

Implement **Phase 1** of `.planning/plans/auto-updater-plan.md` only.

Scope:
- `src-tauri/src/update/mod.rs` — module root
- `src-tauri/src/update/version.rs` — pure semver helpers (parse, compare, is_newer)
- `src-tauri/src/update/manifest.rs` — `UpdateManifest`, `PlatformAsset`, `asset_for_platform()`, `validate()`
- Wire `pub mod update;` into `src-tauri/src/lib.rs`
- 10+ cargo unit tests covering all listed cases in plan §3 Phase 1

Out of scope (future phases):
- ❌ Phase 2 checker/storage/dispatcher (no decision logic, no IO)
- ❌ Phase 3 Tauri plugin / IPC / signing keys
- ❌ Phase 4 React UI
- ❌ Phase 5 GitHub Actions workflow

Constraint: NO Tauri code, NO UI, NO signing key handling in this phase.

</domain>

<decisions>
## Implementation Decisions

User skipped re-discussion (plan §10: "This plan IS the discuss phase. When stuck, run /gsd-debug not /gsd-discuss-phase.").
The auto-updater-plan locks signatures, file paths, and tests cases. Below are the gray areas Claude resolved using sensible defaults that match the plan's spirit (Tiger-Style, DRY, minimum deps, no premature abstraction).

### Semver parsing strategy
- **Decision:** use the `semver` crate (Rust ecosystem standard, ~50 KB, MIT/Apache-2).
- **Why:** Tiger-Style favors deterministic + well-tested; hand-rolling a parser invites edge cases (pre-release, build metadata, leading zeros). The `semver` crate is the de-facto standard, used by `cargo` itself.
- **Wrapper:** Phase 1 still exposes `Semver`, `parse_semver()`, `compare()`, `is_newer()` so Phase 2/3 only depend on our own surface, not the crate directly. This preserves SRP and lets us swap implementations later without churn.

### Test layout
- **Decision:** inline `#[cfg(test)] mod tests { ... }` at the bottom of each `*.rs` file.
- **Why:** idiomatic Rust convention. Easier to find, no extra `mod tests;` wiring, runs with `cargo test --lib update::`. The plan literal mentions a `tests.rs` file but that's a hint — idiomatic placement is preferred and the plan's acceptance command (`cargo test --package churchaudiostream --lib update::`) works either way.

### Error type style
- **Decision:** hand-rolled error enums (`ParseError`, `ManifestError`) with manual `Display` + `std::error::Error` impls.
- **Why:** zero new deps for Phase 1 (no `thiserror`, no `anyhow`). Tiger-Style: explicit, deterministic, one-job-per-file. Errors live next to the module that produces them; a shared `errors.rs` only makes sense in Phase 3 when more error types accumulate.
- **No `String` errors:** every `Result<T, E>` has a typed enum per the plan §4 Tiger-Style checklist.

### URL validation in `manifest::validate()`
- **Decision:** every `PlatformAsset.url` MUST start with `https://`. Empty `platforms` map is rejected.
- **Why:** plan §3 explicitly says "urls are https" and "at least one platform entry". The test `manifest_rejects_http_url()` is listed as a security guardrail (refuse non-TLS).
- **Strict prefix check** (not URL parsing): no extra deps. Matches Tiger-Style fail-fast.

### `asset_for_platform()` lifetime semantics
- **Decision:** returns `Option<&'a PlatformAsset>` (borrowed reference, no clone), exactly per plan signature.

### Crate name in lib.rs
- The library crate is `churchaudiostream_lib` (per `Cargo.toml [lib]`), so the test invocation becomes:
  `cargo test --package churchaudiostream --lib update::` — same as plan acceptance.

### What we will NOT add to `Cargo.toml`
- ❌ `thiserror` / `anyhow` — hand-rolled errors, deferred until Phase 3.
- ❌ `tauri-plugin-updater` — Phase 3.
- ❌ `tracing` / `log` — no logging in pure functions.
- ✅ `semver = "1"` — only new dep needed.
- (`serde` + `serde_json` already present.)

### Claude's Discretion (areas not specified by plan)
- Test fixture style: inline `&str` literals in tests, no separate `fixtures/` directory (10 cases is small).
- Module ordering inside `mod.rs`: `pub mod manifest; pub mod version;` (alphabetical); re-export key types so callers can `use update::{Semver, UpdateManifest, ...}`.
- `Semver` struct fields: store `(major, minor, patch)` as `u64` plus the original input string for debugging — keeps `compare()` cheap and lossless. Pre-release / build metadata: delegated entirely to the `semver` crate (`Version` type).
- Public surface kept minimal: only what Phase 2/3 will call.

</decisions>

<specifics>
## Specific Ideas

- Plan signatures (plan §3 Phase 1) are the contract. Don't drift from them; later phases depend on these names.
- `validate()` test fixture for `manifest_rejects_http_url()` should construct an `UpdateManifest` with `http://` URL and assert `Err(ManifestError::NonHttpsUrl(_))`.
- `parse_semver_rejects_invalid()` covers `"abc"`, `"1.x.0"`, `""` per plan.
- `is_newer_handles_downgrade()` covers `0.2.0 vs 0.1.0 -> false`.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/plans/auto-updater-plan.md` §3 Phase 1 — exact signatures, file layout, test list, acceptance command.
- `.planning/plans/auto-updater-plan.md` §4 Cross-cutting — Tiger-Style + no nested ifs + DRY/SRP.
- `CLAUDE.md` (root) — caveman mode, naming, no spaghetti.
- `semver` crate docs (https://docs.rs/semver) — to be confirmed by researcher.

</canonical_refs>
