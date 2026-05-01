# Plan: Tauri Auto-Updater with Combination UX

**For**: Fresh agent picking up this work
**Code style**: DRY, SRP, Tiger-Style, functional, no nested if-in-if, all functions tested
**UX target**: Silent background check on launch → toast banner if update found → "Check for updates" button in Settings (manual)
**Estimated effort**: 4-6 hours, four PRs (one per phase)

---

## 0. Read this first (background context)

The repo is **ChurchAudioStream** — Tauri 2.x + Node.js sidecar (mediasoup) + React listener PWA. Currently shipping v0.1.2 with NSIS install/uninstall hooks. Manual update flow today: user downloads new `.msi`/`.exe` from GitHub Releases and double-clicks.

Existing constraints (do NOT violate):

- **Caveman mode** is the user's default communication preference. Drop articles in PR descriptions, code comments stay normal.
- **DRY/SRP** enforced (CLAUDE.md). One job per function. Shared helpers go in `lib/`.
- **No nested if-in-if-else**. Use early returns / guard clauses. CLAUDE.md says "no spaghetti code, no nested if in ifs in if".
- **Self-explanatory naming**. Bad: `d`, `tmp`, `data`. Good: `latestManifest`, `currentSemver`.
- **Tiger-Style**: assertions at boundaries (input/output), fail fast, deterministic where possible, no dead code.
- **All functions have tests**. Pure functions get unit tests, side-effect functions get integration tests.
- **Tests must run as part of CI / local pre-commit**. PowerShell tests via `scripts/tests/Test-*.ps1`. TypeScript tests via Vitest (sidecar already uses it).
- **No emojis** in files/UI unless user explicitly asks. User has asked once for icons → that's a one-off.
- **Win10/11 + GStreamer + WebView2** prereqs documented in `README.md` and `scripts/install-prerequisites.ps1`. Auto-updater does NOT touch GStreamer/WebView2 — those are external prereqs.
- **Stale sidecar trap** (CLAUDE.md): `tauri dev` does NOT respawn sidecar. Read CLAUDE.md §"Stale sidecar binary trap" before testing UAT.

Current architecture you must preserve:

```
churchaudiostream.exe    ← Tauri Rust shell (admin GUI)
server.exe               ← Node.js sidecar (mediasoup + Express + WS), pkg-bundled
binaries/mediasoup-worker.exe
public/                  ← listener PWA (React, served from sidecar HTTPS:7777)
scripts/                 ← install/uninstall hooks (NSIS-bundled)
```

**v0.1.2 release URL**: `https://github.com/roulendz/ChurchAudioStream/releases/tag/v0.1.2`. Use this format for `latest.json` URL planning.

---

## 1. End-to-end UX flow (the goal)

```
[App launch]
    ↓
[Rust: spawn updater check task in background, non-blocking]
    ↓
[Updater: GET https://.../latest.json (5s timeout)]
    ↓
[Compare semver(current) vs semver(latest)]
    ↓
[No update? → silent, no UI noise]
    ↓
[Update available?]
    ↓
[Rust → JS via Tauri event "update:available" with {version, notes, download_url}]
    ↓
[React Admin UI: render <UpdateToast /> banner at top of admin window]
    ↓
[User clicks "Update now" → Rust calls plugin.downloadAndInstall() → progress events → restart]
[OR User clicks "Later" → toast dismissed for 24h (persisted to local config)]
[OR User clicks "Skip this version" → never prompt for this version (persisted)]
    ↓
[Settings page: "Check for updates" button → calls same Rust handler manually]
[Last check timestamp displayed: "Last checked: 2 hours ago"]
```

Phone PWA is NOT in scope — service worker handles itself (already configured `skipWaiting + clientsClaim` in `listener/vite.config.ts`).

---

## 2. Architecture (DRY/SRP boundaries)

Three layers. Each layer has ONE job. No layer reaches across more than its immediate neighbor.

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: React Admin UI                                     │
│ - <UpdateToast />          (display only, props in)         │
│ - <CheckForUpdatesButton/> (button in Settings)             │
│ - useUpdateState()         (custom hook, listens to events) │
└─────────────────────────────────────────────────────────────┘
                           ↑ Tauri IPC events
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: Rust orchestrator (src-tauri)                      │
│ - update_checker module    (when to check, debounce)        │
│ - update_dispatcher module (emit events to JS, install)     │
│ - update_storage module    (skipped versions, last check)   │
└─────────────────────────────────────────────────────────────┘
                           ↑ tauri-plugin-updater
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Pure version logic (Rust + shared, testable)       │
│ - semver_compare()         (pure: str, str -> Ordering)     │
│ - should_check_now()       (pure: last_check_ts, now -> b)  │
│ - manifest_for_platform()  (pure: manifest, platform -> Op) │
└─────────────────────────────────────────────────────────────┘
```

**Tiger-Style assertions** at every layer boundary:
- Layer 1 → `debug_assert!(version.matches semver_regex)` on input
- Layer 2 → assert `last_check_ts >= 0`, `now > last_check_ts`
- Layer 3 → React PropTypes / TypeScript strict types, runtime guard at IPC boundary

---

## 3. Phased implementation plan

### Phase 1: Pure version logic + tests (NO Tauri code yet)

**Goal**: Test-drive the version comparison in isolation. No async, no HTTP, no IPC. Just functions in/out.

**Files to create**:

```
src-tauri/src/update/
├── mod.rs              ← module root
├── version.rs          ← pure semver helpers
└── manifest.rs         ← parse/validate latest.json
```

**Functions (with signatures, all pure)**:

```rust
// src-tauri/src/update/version.rs

/// Parse a semver string into a sortable struct.
/// Tiger-Style: returns Result, never panics on bad input.
pub fn parse_semver(input: &str) -> Result<Semver, ParseError>;

/// Compare two parsed semvers. Pure, deterministic.
pub fn compare(a: &Semver, b: &Semver) -> std::cmp::Ordering;

/// Whether `latest > current`. Convenience wrapper.
pub fn is_newer(current: &str, latest: &str) -> Result<bool, ParseError>;
```

```rust
// src-tauri/src/update/manifest.rs

#[derive(Deserialize)]
pub struct UpdateManifest {
    pub version: String,
    pub notes: String,
    pub pub_date: String,
    pub platforms: HashMap<String, PlatformAsset>,
}

#[derive(Deserialize)]
pub struct PlatformAsset {
    pub signature: String,
    pub url: String,
}

/// Pull the asset for the given platform key.
/// Tiger-Style: explicit None if missing, never .unwrap().
pub fn asset_for_platform<'a>(
    manifest: &'a UpdateManifest,
    platform_key: &str,
) -> Option<&'a PlatformAsset>;

/// Validate manifest invariants:
///   - version is parseable semver
///   - at least one platform entry
///   - urls are https
pub fn validate(manifest: &UpdateManifest) -> Result<(), ManifestError>;
```

**Tests** (file `src-tauri/src/update/tests.rs`, run via `cargo test`):

```rust
#[test] fn parse_semver_accepts_valid()           // "0.1.2", "1.0.0", "2.10.0"
#[test] fn parse_semver_rejects_invalid()         // "abc", "1.x.0", ""
#[test] fn compare_orders_correctly()             // 0.1.2 < 0.1.3, 0.9.0 < 0.10.0
#[test] fn is_newer_handles_equal()               // 0.1.2 vs 0.1.2 -> false
#[test] fn is_newer_handles_downgrade()           // 0.2.0 vs 0.1.0 -> false
#[test] fn manifest_validates_https_urls()
#[test] fn manifest_rejects_http_url()            // security: refuse non-TLS
#[test] fn manifest_rejects_empty_platforms()
#[test] fn asset_for_platform_returns_match()
#[test] fn asset_for_platform_returns_none_for_unknown()
```

**Acceptance**: `cargo test --package churchaudiostream --lib update::` runs green. 10+ test cases all passing.

---

### Phase 2: Rust orchestration layer (decisions, no UI)

**Goal**: Decide WHEN to check, debounce, persist state. Still no UI.

**Files to create**:

```
src-tauri/src/update/
├── checker.rs          ← when to check (debounce logic)
├── storage.rs          ← read/write skipped versions, last check ts
└── dispatcher.rs       ← emit Tauri events
```

**Pure functions (testable without Tauri)**:

```rust
// src-tauri/src/update/checker.rs

/// Whether enough time has passed since last check.
/// Pure: clock injected as param. No SystemTime::now() inside.
/// Tiger-Style: assert last_check_unix <= now_unix.
pub fn should_check_now(last_check_unix: i64, now_unix: i64, min_interval_seconds: i64) -> bool;

/// Whether this version was explicitly skipped by user.
pub fn is_version_skipped(version: &str, skipped: &[String]) -> bool;

/// Top-level decision: should we surface this update to the user?
/// Combines version comparison + skip list + cooldown.
/// Returns enum: Notify | SilentSkip(reason) | NoUpdate.
pub fn evaluate_update(
    current: &str,
    manifest: &UpdateManifest,
    skipped: &[String],
    last_dismissed_unix: i64,
    now_unix: i64,
    dismiss_cooldown_seconds: i64,
) -> UpdateDecision;
```

```rust
// src-tauri/src/update/storage.rs

/// On-disk state file at $APPDATA/com.churchaudiostream.app/update-state.json
#[derive(Serialize, Deserialize, Default)]
pub struct UpdateState {
    pub last_check_unix: i64,
    pub last_dismissed_unix: i64,
    pub skipped_versions: Vec<String>,
}

pub fn load(path: &Path) -> Result<UpdateState, StorageError>;
pub fn save(path: &Path, state: &UpdateState) -> Result<(), StorageError>;

/// Pure mutation helpers (return new state, don't mutate in place).
pub fn with_dismissed_now(state: UpdateState, now_unix: i64) -> UpdateState;
pub fn with_skipped_version(state: UpdateState, version: &str) -> UpdateState;
pub fn with_check_completed(state: UpdateState, now_unix: i64) -> UpdateState;
```

**Tests** (`src-tauri/src/update/checker_tests.rs`):

```rust
#[test] fn should_check_when_never_checked()            // last=0 -> true
#[test] fn should_not_check_within_cooldown()           // last=now-100, min=3600 -> false
#[test] fn should_check_after_cooldown_expires()        // last=now-7200, min=3600 -> true
#[test] fn evaluate_returns_notify_for_new_version()
#[test] fn evaluate_returns_silent_skip_when_skipped()
#[test] fn evaluate_returns_silent_skip_within_dismiss_cooldown()
#[test] fn evaluate_returns_no_update_when_current_latest()
#[test] fn evaluate_returns_no_update_when_downgrade()  // server published 0.1.0, client has 0.1.5
#[test] fn with_dismissed_now_does_not_mutate_input()  // pure mutation contract
#[test] fn with_skipped_version_dedupes()
#[test] fn storage_round_trip()                         // save -> load -> equal
#[test] fn storage_load_returns_default_when_missing()  // first run
```

**No nested ifs**: `evaluate_update` should be a flat match/early-return chain:

```rust
// GOOD (flat, early-returns)
pub fn evaluate_update(...) -> UpdateDecision {
    let latest = match parse_semver(&manifest.version) {
        Err(e) => return UpdateDecision::SilentSkip(format!("bad manifest: {e}")),
        Ok(v) => v,
    };
    let current_parsed = match parse_semver(current) {
        Err(e) => return UpdateDecision::SilentSkip(format!("bad current: {e}")),
        Ok(v) => v,
    };
    if !is_newer_parsed(&current_parsed, &latest) {
        return UpdateDecision::NoUpdate;
    }
    if is_version_skipped(&manifest.version, skipped) {
        return UpdateDecision::SilentSkip("user skipped".into());
    }
    if now_unix - last_dismissed_unix < dismiss_cooldown_seconds {
        return UpdateDecision::SilentSkip("dismissed cooldown".into());
    }
    UpdateDecision::Notify
}

// BAD (nested if-in-if-else - DO NOT WRITE)
pub fn evaluate_update_BAD(...) -> UpdateDecision {
    if let Ok(latest) = parse_semver(&manifest.version) {
        if let Ok(current_parsed) = parse_semver(current) {
            if is_newer_parsed(&current_parsed, &latest) {
                if !is_version_skipped(...) { ... }
            }
        }
    }
}
```

**Acceptance**: `cargo test update::checker_tests` green, `cargo test update::storage_tests` green. 12+ tests passing.

---

### Phase 3: Tauri plugin wiring + IPC events

**Goal**: Connect to actual Tauri updater plugin. Signing keys. IPC events. App data persistence.

**Steps**:

1. **Generate signing keypair** (one-time, dev box only):
   ```bash
   npx tauri signer generate -w ~/.tauri/cas-update.key
   # Saves private key. Public key prints to stdout.
   ```
   - Add `TAURI_SIGNING_PRIVATE_KEY` to dev `.env` (NOT committed)
   - Add `.env` to `.gitignore` if not already
   - Document the key location in `README.md` § Building releases
   - Embed public key in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`

2. **Install plugin** (`src-tauri/Cargo.toml`):
   ```toml
   tauri-plugin-updater = "2"
   tauri-plugin-process = "2"
   ```
   And `package.json`:
   ```json
   "@tauri-apps/plugin-updater": "^2",
   "@tauri-apps/plugin-process": "^2"
   ```

3. **Configure plugin** (`src-tauri/tauri.conf.json`):
   ```json
   "plugins": {
     "updater": {
       "endpoints": [
         "https://github.com/roulendz/ChurchAudioStream/releases/latest/download/latest.json"
       ],
       "pubkey": "<paste public key here>",
       "dialog": false
     }
   }
   ```
   - `dialog: false` = we use OUR custom UI, not the built-in modal
   - Endpoint URL = GitHub release "Latest" download link (auto-resolves to newest release)

4. **Wire Tauri commands** (`src-tauri/src/lib.rs` or new `src-tauri/src/update/commands.rs`):
   ```rust
   #[tauri::command]
   pub async fn update_check_now(...) -> Result<UpdateInfo, String>;

   #[tauri::command]
   pub async fn update_install(...) -> Result<(), String>;

   #[tauri::command]
   pub async fn update_dismiss(...) -> Result<(), String>;

   #[tauri::command]
   pub async fn update_skip_version(...) -> Result<(), String>;

   #[tauri::command]
   pub async fn update_get_state(...) -> Result<UpdateState, String>;
   ```

5. **Spawn background check on app launch** (`src-tauri/src/lib.rs`):
   ```rust
   // After app setup, spawn task that:
   // 1. Loads state
   // 2. Calls should_check_now() - the pure function from Phase 2
   // 3. If true: fetch manifest, evaluate_update(), dispatch event
   // 4. Updates state.last_check_unix
   //
   // No nested ifs. Each step is a function call with early return on error.
   ```

6. **Emit events to frontend**:
   ```rust
   app.emit("update:available", &UpdateAvailablePayload { ... })?;
   app.emit("update:download:progress", &progress)?;
   app.emit("update:installed", &())?;
   ```

**Tests** (integration, run with `cargo test --features integration`):

- `test_update_state_persists_across_load_save`
- `test_skip_version_then_check_returns_silent_skip`
- `test_dismiss_then_check_within_cooldown_returns_silent_skip`
- `test_dismiss_after_cooldown_returns_notify`

**Acceptance**:
- `cargo test --features integration update::` green
- Manual: launch app with stub `latest.json` → see event emit in WebView console (`window.__TAURI__.event.listen(...)`)

---

### Phase 4: React UI via frontend-design skill

**Goal**: Polished toast banner + Settings button. Use the `frontend-design` skill (mandatory — user asked).

**Spawn frontend-design skill with this brief**:

```
Build two React components for ChurchAudioStream admin UI:

1. <UpdateToast />
   - Anchored top of admin window, slides down on appear, slides up on dismiss
   - Shows: "Version {version} available - {first 80 chars of notes}"
   - Three buttons: "Update now" (primary), "Later" (secondary), "Skip this version" (tertiary)
   - "Update now" -> shows download progress bar inside the toast
   - On install complete -> "Restart now" button
   - Color: matches existing app theme (green #16a34a accent)
   - Mobile-tablet friendly (admin runs on Tauri webview, not phones, but designer-quality matters)
   - Accessible: ARIA live region, keyboard nav, focus trap during install

2. <CheckForUpdatesButton />
   - Goes in Settings panel
   - Label: "Check for updates"
   - Subtext: "Last checked: {humanized timestamp}" (e.g. "2 hours ago", "yesterday")
   - On click: spinner inline, calls update_check_now() command
   - Shows result inline: "Up to date" / "Update available - see toast"

Constraints:
- TypeScript strict mode
- No external UI libs unless already in package.json (we use plain React)
- Follow CLAUDE.md naming rules: descriptive, no abbreviations
- Functional components only, hooks for state
- Pure render functions (no business logic in components)
- Vitest tests for component rendering + interaction
- Existing styles live in src/App.css and src/components/*.css
```

The frontend-design skill will produce these files:

```
src/components/UpdateToast/
├── UpdateToast.tsx
├── UpdateToast.module.css
├── UpdateToast.test.tsx        ← Vitest + React Testing Library
└── index.ts

src/components/CheckForUpdatesButton/
├── CheckForUpdatesButton.tsx
├── CheckForUpdatesButton.module.css
├── CheckForUpdatesButton.test.tsx
└── index.ts

src/hooks/
└── useUpdateState.ts           ← listens to "update:*" events, exposes state
└── useUpdateState.test.ts

src/lib/
└── relative-time.ts            ← pure: unix ts -> "2 hours ago"
└── relative-time.test.ts
```

**Tests required**:
- `relative-time.test.ts` — 10+ cases (just now, seconds ago, minutes, hours, days, future timestamps, edge of boundary)
- `UpdateToast.test.tsx` — renders all states (idle, downloading, ready-to-restart), button clicks fire correct callbacks, ARIA roles correct
- `CheckForUpdatesButton.test.tsx` — click triggers handler, spinner shows during pending, result message updates
- `useUpdateState.test.ts` — event listener registration/cleanup, state transitions

**Acceptance**:
- `npm test` green (Vitest)
- Storybook-style manual review: launch admin UI in dev mode with mocked update event, verify toast renders correctly
- Lighthouse accessibility score >= 95 on the toast component (check in DevTools)

---

### Phase 5: Publishing infrastructure

**Goal**: Make `latest.json` get auto-generated on every GitHub release.

**File to create**: `.github/workflows/publish-update-manifest.yml`

```yaml
name: Publish update manifest
on:
  release:
    types: [published]
jobs:
  manifest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Generate latest.json
        run: |
          # Bash script that:
          # 1. Reads release tag (e.g. v0.1.3)
          # 2. Reads release body (notes)
          # 3. Computes URLs for each platform asset (NSIS .exe + signature .sig)
          # 4. Reads .sig file content for signature field
          # 5. Writes latest.json with {version, notes, pub_date, platforms}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Upload latest.json to release
        run: gh release upload "$TAG" latest.json --clobber
```

**Build pipeline change** (`build.ts` or `tauri.conf.json`): ensure `.sig` file is generated alongside `.exe`. Tauri does this automatically when `TAURI_SIGNING_PRIVATE_KEY` env var is set during `tauri build`.

**Tests**:
- `scripts/tests/Test-Manifest.ps1` — parse a generated `latest.json`, verify schema (PowerShell because that's what we have for scripts; could also be a Vitest test in TypeScript)
- Manual: push a v0.1.3-test tag, verify `latest.json` appears as release asset

**Acceptance**:
- Pushing a tag → release publishes → workflow runs → `latest.json` appears as release asset within 2 minutes
- `latest.json` schema validates against `manifest.rs` test fixtures

---

## 4. Cross-cutting requirements (do this for every phase)

### Tiger-Style checklist

- [ ] Every public function has assertions on input boundaries (`debug_assert!`, `assert!`, TS `invariant()` from `tiny-invariant`)
- [ ] Every public function has assertions on output where possible
- [ ] No `unwrap()` / `expect()` in production code paths (only in tests)
- [ ] No `println!` / `console.log` in production code (use `tracing` / `log` crate / Tauri logger)
- [ ] Functions ≤ 50 lines. If larger, extract.
- [ ] No magic numbers. `const SECONDS_PER_HOUR: i64 = 3600;` not `3600` inline.
- [ ] Every `Result<T, E>` has typed error, never `String`. Errors live in `update::errors` module.

### DRY/SRP checklist

- [ ] No copy-pasted blocks > 5 lines. Extract.
- [ ] One concept per module. `version.rs` does NOT reach into `storage.rs`.
- [ ] Pure functions live in their own module, side-effect functions in another.
- [ ] No "util" or "helpers" dumping ground — name modules by what they DO.

### No nested if-in-if-else checklist

- [ ] Search every file you write for `if .* {` followed within 10 lines by another `if .* {` inside the same block. If found, refactor.
- [ ] Use early returns / guard clauses. Use `match` statements. Use `?` operator in Rust.
- [ ] Maximum nesting depth: 2 levels. (One `if` inside one `for` is fine. `if` inside `if` inside `match` is NOT.)

### Test coverage targets

- Phase 1 (pure version): 100% line coverage
- Phase 2 (orchestration): 95% line coverage (some IO error paths hard to test)
- Phase 3 (Tauri integration): 70% line coverage (IPC + plugin internals not directly testable)
- Phase 4 (React UI): 90% line coverage on components, 100% on hooks
- Phase 5 (CI workflow): manual smoke test acceptable, no formal coverage

Run coverage:
```bash
# Rust
cargo install cargo-llvm-cov
cargo llvm-cov --package churchaudiostream --lib

# TypeScript
npm test -- --coverage
```

---

## 5. File checklist (final state after all phases)

```
src-tauri/
├── Cargo.toml                                       (add 2 deps)
├── tauri.conf.json                                  (add updater plugin config + pubkey)
└── src/
    ├── lib.rs                                       (register updater plugin + bg task)
    └── update/
        ├── mod.rs
        ├── version.rs              + tests
        ├── manifest.rs             + tests
        ├── checker.rs              + tests
        ├── storage.rs              + tests
        ├── dispatcher.rs           + tests
        ├── commands.rs             + tests
        └── errors.rs

src/                                                  (admin React UI)
├── components/
│   ├── UpdateToast/                + tests          (frontend-design skill output)
│   └── CheckForUpdatesButton/      + tests
├── hooks/
│   └── useUpdateState.ts           + tests
└── lib/
    └── relative-time.ts            + tests

scripts/
└── tests/
    └── Test-Manifest.ps1                            (validate generated latest.json schema)

.github/
└── workflows/
    └── publish-update-manifest.yml                  (CI to publish latest.json on release)

README.md                                            (document signing key + update flow)
.gitignore                                           (add ~/.tauri/cas-update.key path NOTE)
```

---

## 6. Acceptance criteria (overall)

The new agent's work is DONE when ALL of these are true:

- [ ] All Phase 1-5 tests pass: `cargo test update::` green, `npm test` green
- [ ] `cargo clippy --all-targets -- -D warnings` clean
- [ ] No nested if-in-if-else anywhere in new code (manual review + grep)
- [ ] No function over 50 lines in new code
- [ ] `npm run tauri build` succeeds, MSI/NSIS bundles include updater plugin
- [ ] Manual smoke test: build v0.1.99, run on a Win10 VM, manually edit `latest.json` to advertise v0.1.100, restart app → toast appears within 30 seconds
- [ ] Click "Update now" → progress bar shows → app restarts → version is now v0.1.100
- [ ] Click "Skip this version" → restart → no toast
- [ ] Click "Later" → restart within 24h → no toast → restart after 25h → toast back
- [ ] Settings → "Check for updates" → spinner → result inline
- [ ] Lighthouse accessibility >= 95 on toast component
- [ ] README.md updated with: how to release, where private key lives, how rollback works

---

## 7. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Lost private key = can never publish updates | Document recovery procedure: rotate pubkey in next major version, document path to back up key (`~/.tauri/cas-update.key`) |
| Manifest serves wrong platform asset | Fail-fast in `validate()` — refuse manifest with no entry for current platform |
| HTTP endpoint hijacked / MITM | Plugin enforces HTTPS + signature verification (Ed25519). Refuse downgrade attacks via `is_newer()` check. |
| User on slow connection — download blocks UI | Plugin handles async; progress events let UI stay responsive. Test on throttled network in DevTools. |
| User dismisses toast forever | "Skip this version" affects ONE version. Next release pre-empts the skip. Document this clearly in toast hover-text. |
| Auto-check spam (every launch in development) | `should_check_now()` has min 6-hour cooldown. Override via env var `CAS_UPDATER_FORCE_CHECK=1` for dev. |
| Phone PWA stale after update | Already handled: vite-plugin-pwa `skipWaiting + clientsClaim` is set. |

---

## 8. Out of scope (do NOT do)

- ❌ Differential / delta updates (not worth it at this size)
- ❌ Phone PWA auto-update (already works via service worker)
- ❌ Sidecar-only updates (whole bundle ships atomically; this is a feature not a limitation)
- ❌ macOS / Linux update channels (Win10/11 only for v0.x.x)
- ❌ Self-hosted update server (GitHub Releases is fine until 100+ deployments)
- ❌ Code signing the .exe / .msi (separate concern; SmartScreen warning is acceptable for v0.x.x)
- ❌ A/B rollout / staged release (not needed at this scale)

---

## 9. Suggested PR breakdown

| PR | Phase | LOC est. | Reviewable in |
|---|---|---|---|
| #1 `feat(update): version logic + manifest types (no Tauri)` | 1 | ~300 | 30 min |
| #2 `feat(update): orchestration + storage (no UI yet)` | 2 | ~400 | 30 min |
| #3 `feat(update): Tauri plugin + IPC events + signing` | 3 | ~300 | 45 min |
| #4 `feat(update): React UI via frontend-design + tests` | 4 | ~600 | 60 min |
| #5 `ci: publish-update-manifest workflow + README` | 5 | ~150 | 20 min |

Each PR ships independently — the previous one's code works without the next one (Phase 1 alone has tests; Phase 2 wraps Phase 1; etc.). Don't merge as one giant PR.

---

## 10. First action for the new agent

Read these files in order:

1. `CLAUDE.md` (root) — project rules
2. `.planning/plans/auto-updater-plan.md` — this file
3. `src-tauri/tauri.conf.json` — current config
4. `src-tauri/Cargo.toml` — current deps
5. `src-tauri/src/lib.rs` — current Rust entry
6. Tauri 2.x updater docs at https://v2.tauri.app/plugin/updater/
7. The user's `tiger-style` skill (already in available skills list)
8. The user's `frontend-design` skill (already in available skills list)

Then start Phase 1. Write tests FIRST (TDD), then implementation. Commit after each green test suite.

Caveman PR titles (user preference): `feat(update): pure semver + manifest types` not "Add semantic versioning logic with manifest type definitions for the update system".

When stuck, run `/gsd-debug` not `/gsd-discuss-phase`. This plan IS the discuss phase.
