---
name: 260502-lad-REVIEW
description: Code review for Phase 5 auto-updater GitHub Actions CI
type: quick-review
quick_id: 260502-lad
date: 2026-05-02
files_reviewed: 5
findings:
  critical: 0
  major: 1
  minor: 4
  total: 5
status: PASS-WITH-FIXES (all 1 MAJOR + 2 of 4 MINORs fixed inline in commit 8fa70d2)
---

# Code Review: 260502-lad

## Summary
- Files reviewed: 5
- Critical: 0
- Major: 1 (FIXED in commit 8fa70d2)
- Minor: 4 (2 FIXED in commit 8fa70d2; 2 deferred — see below)
- Verdict: **PASS-WITH-FIXES**

Schema match exact. Workflow ordering correct (publish-after-upload). Tests comprehensive (16 cases, 7 failure paths). One real injection-defense gap in PowerShell script — easy fix. Rest is polish.

## Critical
None.

## Major

### MA-01 — PowerShell `${{ }}` interpolation in script body = injection vector — FIXED 8fa70d2

**File:** `.github/workflows/release.yml:79`

```powershell
$version = "${{ github.ref_name }}".TrimStart("v")
```

`${{ github.ref_name }}` is GitHub Actions text substitution **before** PowerShell parses the line. If a tag string ever contains `"`, `;`, or backtick, attacker controls the script. Git refnames are restricted but not airtight (parens, single quotes, backslashes allowed). GitHub security docs flag this exact pattern.

Lines 80, 82, 84, 85, 87 already use `${env:TAG}` / `${env:OWNER_REPO}` correctly via the `env:` block — line 79 was the lone outlier.

**Fix applied (commit 8fa70d2):**
```powershell
$version = "${env:TAG}".TrimStart("v")
```

(`TAG` is already exported via `env:` block on line 75.) Comment block added explaining why env-block is required.

## Minor

### MI-01 — `parseArgs` rejects empty `--notes ""` as "missing required flag" — FIXED 8fa70d2

**File:** `scripts/generate-update-manifest.mjs:57`

`!out[key]` falsy check conflated "absent" with "empty string". Empty release notes are legitimate.

**Fix applied:** `out[key] === undefined`. Added regression test asserting `--notes ""` is accepted.

### MI-02 — `buildManifest` https-check error doesn't name the failed input flag — FIXED 8fa70d2

**File:** `scripts/generate-update-manifest.mjs:88`

Said "asset url" but invocation context lost. Renamed to `--asset-url must start with https://`. Test regex updated to match.

### MI-03 — `dtolnay/rust-toolchain@stable` tracks floating channel tag — DEFERRED

**File:** `.github/workflows/release.yml:42`

`@stable` is a moving label. SHA-pin recommended for reproducible release builds. Acceptable for Phase 5 per CONTEXT (matches other actions pinning to major). Defer until first cross-toolchain breakage observed.

### MI-04 — `releaseBody` claims "within 24h" — DEFERRED (depends on Phase 3 bg-loop cadence — already 24h)

**File:** `.github/workflows/release.yml:65`

The 24h claim is correct: Phase 3 `lifecycle.rs` bg-loop polls `update_check_now` every 24h. So this is documentation that matches behavior. No action needed.

## Schema correctness check (all PASS)

| Field | Rust type (`manifest.rs`) | Generator emits | Match |
|-------|---------------------------|-----------------|-------|
| `version` | `String` (semver, no `v`) | `String` from `normalizeTag(tag).slice(1)` | YES |
| `notes` | `String` | `String` from `--notes` | YES |
| `pub_date` | `String` (snake_case) | `pub_date: now().toISOString()` | YES |
| `platforms` | `HashMap<String, PlatformAsset>` non-empty | object with single key (default `windows-x86_64`) | YES |
| `PlatformAsset.signature` | `String` | from `readSignature(sigPath)` trimmed | YES |
| `PlatformAsset.url` | `String` (literal `https://`) | validated in `buildManifest` | YES |
| Platform key literal | `windows-x86_64` per `lifecycle.rs:205` | `DEFAULT_PLATFORM_KEY = "windows-x86_64"` | YES |

## Workflow correctness check

| Concern | Rule | Compliance |
|---------|------|------------|
| Trigger | `push.tags: ['v*']` | YES |
| Permissions | `contents: write` | YES |
| Concurrency | `cancel-in-progress: false` | YES |
| tauri-action env | `TAURI_SIGNING_PRIVATE_KEY` + `_PASSWORD` + `GITHUB_TOKEN` | YES |
| `releaseDraft: true` | required so manifest can land before publish | YES |
| Publish AFTER manifest upload | `gh release edit --draft=false` last step | YES |
| `--clobber` on upload | idempotent re-runs | YES |
| `runs-on: windows-latest` | Windows-only D-04 | YES |
| `npm ci` not `npm install` | locked deps | YES |
| No `--target` flag | host-native build per Pitfall 3 | YES |
| `actions/checkout@v4` pinned major | YES |
| `actions/setup-node@v4` not deprecated v3 | YES |
| `tauri-apps/tauri-action@v0` current | YES |
| No secret echo | YES |
| No injection of user-controlled string into shell | env, not `${{ }}` interpolation | FIXED in 8fa70d2 (was MA-01) |

## Strengths

- Generator cleanly DI-able: `now` + `readSig` injected, no module mocks needed
- Top-level invocation guard uses `pathToFileURL(process.argv[1])` — handles Windows `C:` drive-letter quirk per Pitfall 19
- Schema cross-validation test walks every field the Rust deserializer cares about including `pub_date` snake_case sentinel and case-sensitive `https://` prefix — guards against accidental rename refactors on either side
- Pure functions exported separately from CLI `main()` — clean SRP boundary
- Named constants (`SEMVER_REGEX`, `KNOWN_FLAGS`, `DEFAULT_PLATFORM_KEY`, `HTTPS_PREFIX`, `TAG_PREFIX`) — zero magic strings
- All generator functions ≤50 lines, no nested if-in-if
- `process.stdout.write` / `process.stderr.write` (no `console.log`) — Tiger-Style honored
- Workflow comments cite exact pitfall numbers from research — review-friendly
- Runbook documents pubkey rotation procedure with the load-bearing transition-release step (skipping it = orphan all installs) — saves a future incident
- Runbook smoke-test recipe is self-contained: tag, watch, verify, cleanup — agent-runnable
- `concurrency.cancel-in-progress: false` correctly distinguishes release from CI semantics
- SEMVER_REGEX simple and bounded — no catastrophic backtracking risk

## Files reviewed (absolute paths)

- `C:\laragon\www\ChurchAudioStream\vitest.config.ts`
- `C:\laragon\www\ChurchAudioStream\scripts\generate-update-manifest.mjs`
- `C:\laragon\www\ChurchAudioStream\scripts\generate-update-manifest.test.mjs`
- `C:\laragon\www\ChurchAudioStream\.github\workflows\release.yml`
- `C:\laragon\www\ChurchAudioStream\scripts\setup-signing-key.md`

## Cross-references consulted

- `src-tauri/src/update/manifest.rs` (schema source-of-truth)
- `src-tauri/src/update/version.rs` (semver behavior parity)
- `src-tauri/src/update/lifecycle.rs:203-217` (`current_platform_key`)
- `src-tauri/tauri.conf.json:53` (embedded pubkey)
