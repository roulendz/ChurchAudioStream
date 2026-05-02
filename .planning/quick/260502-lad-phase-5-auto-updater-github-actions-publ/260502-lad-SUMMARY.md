---
name: 260502-lad-SUMMARY
description: Phase 5 auto-updater GitHub Actions release workflow + zero-dep Node ESM generator + signing-key runbook
status: complete
date: 2026-05-02
phase: 260502-lad
plan: 01
subsystem: auto-updater-ci
tags:
  - tauri
  - auto-updater
  - github-actions
  - ci
  - vitest
  - node-esm
commits:
  - 261d943
  - 731fe65
  - a7fe5b1
  - 3965c63
  - b25887e
  - 7161343
files_modified:
  - vitest.config.ts
  - scripts/generate-update-manifest.test.mjs
  - scripts/generate-update-manifest.mjs
  - .github/workflows/release.yml
  - scripts/setup-signing-key.md
requirements:
  - P5-WF
  - P5-GEN
  - P5-TEST
  - P5-ASSET
  - P5-PUB
metrics:
  duration_minutes: 10
  tasks_completed: 4
  commits: 6
  tests_added: 16
  tests_total: 115
---

# Phase 5 Quick Task 260502-lad: Auto-Updater CI Publish Workflow Summary

Single end-to-end Tauri release workflow + tested zero-dep Node ESM `latest.json` generator + one-time signing-key runbook. Closes the auto-updater chain (Phase 1 manifest types -> Phase 2 state -> Phase 3 Tauri plugin -> Phase 4 React UI -> Phase 5 publish pipeline).

## Deliverables

### 1. `vitest.config.ts` (modified, +3 lines)
Extended `test.include` from `["src/**/*.{test,spec}.{ts,tsx}"]` to also cover `scripts/**/*.test.mjs`. Without this, vitest silently skips generator tests under `--passWithNoTests` flag.

Commit: **261d943**

### 2. `scripts/generate-update-manifest.test.mjs` (new, 184 lines, 16 cases)
Vitest unit tests for the generator. Organised by exported function:

| Function           | Cases | Failure paths                                          |
| ------------------ | ----- | ------------------------------------------------------ |
| `normalizeTag`     | 6     | missing-v, empty, non-semver-remainder                 |
| `parseArgs`        | 5     | unknown-flag, missing-required, missing-value          |
| `buildManifest`    | 2     | http url                                               |
| `generateManifest` | 2     | (success-path DI demonstrations)                       |
| schema cross-val   | 1     | mirrors `manifest.rs` deserializer + `validate()`      |

Total failure-path coverage: 7 (>= 6 required by D-02). DI pattern (`{ now, readSig }`) eliminates need for module mocking.

Commit (RED): **731fe65**

### 3. `scripts/generate-update-manifest.mjs` (new, 153 lines)
Pure ESM, zero external deps (only `node:fs/promises` + `node:url`). Tiger-Style: input boundary assertions, fail-fast, no `console.log`, named constants (no magic numbers), descriptive names, functions <= 50 LOC, max 2 nesting levels.

Architecture:
- **Pure functions exported for tests:** `parseArgs`, `normalizeTag`, `buildManifest`, `generateManifest`
- **DI pattern:** `generateManifest(args, { now, readSig })` accepts injected clock + sig reader
- **Side effects in `main()` only:** stdout write, stderr write, exit code
- **CLI invocation guard** uses `pathToFileURL(process.argv[1]).href` (Node built-in) — handles cross-platform path/URL conversion correctly
- **DRY:** `FLAG_TO_KEY` table replaces 5x branching if-else; SEMVER_REGEX duplication of Rust `parse_semver` documented in file header (Rust = source of truth, two implementations by necessity since Rust runs in client + Node runs in CI)
- **SRP:** `readSignature` handles file IO + trim, `buildManifest` validates schema, `normalizeTag` validates tag, `parseArgs` parses CLI

Commit (GREEN): **a7fe5b1**

### 4. `.github/workflows/release.yml` (new, 103 lines)
Single end-to-end workflow on tag push (`v*`). Pipeline:
1. checkout + setup-node@22 (cache npm) + dtolnay/rust-toolchain@stable
2. `npm ci` (locked deps)
3. `tauri-apps/tauri-action@v0` -> builds, signs, drafts release, uploads `.exe` + `.exe.sig`
4. PowerShell step invokes `node scripts/generate-update-manifest.mjs` -> `latest.json`
5. `gh release upload latest.json --clobber` + `gh release edit --draft=false` (publish LAST per Pitfall 8)

Inline Pitfall references: 1 (action @v0), 2 (PASSWORD must exist), 3 (no `--target`), 4 (`x64` vs `windows-x86_64`), 8 (publish last), 9 (`--clobber`), 10 (`contents:write`), 11 (`cancel-in-progress:false`), 12 (`beforeBuildCommand`), 15 (`npm ci`).

Commit: **3965c63**

### 5. `scripts/setup-signing-key.md` (new, 134 lines)
One-time signing-key + GitHub secrets runbook. Six sections:
1. Generate keypair (LOCAL machine, `npm run tauri signer generate`)
2. Verify pubkey matches `src-tauri/tauri.conf.json:53` (commit `4d9c69b`)
3. Add `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repo secrets
4. Verify via Section 6
5. Key rotation procedure (transition release pattern — sign with OLD key first to migrate existing installs)
6. Manual UAT smoke recipe (verbatim from RESEARCH §8)

Top-of-file warning emphasises pubkey-coordination risk: rotating without transition release orphans every existing install.

Commit: **b25887e**

## Test Results

| Phase                | Test Files | Tests       | Outcome |
| -------------------- | ---------- | ----------- | ------- |
| Baseline (pre-task)  | 7          | 99          | green   |
| After T1 (config)    | 7          | 99          | green   |
| After T2 RED         | 7 + 1 fail | 99          | RED (expected — module missing) |
| After T2 GREEN       | 8          | **115**     | green   |
| After T3, T4         | 8          | 115         | green   |
| After Rule 1 fix     | 8          | 115         | green   |

Test delta: **+16** (12+ minimum from D-02 satisfied, 7 failure paths >= 6 required).

## Build Result

`npm run build` (tsc -b + vite build): **green**, 854 ms vite bundle, 114 modules transformed. Pre-existing dynamic-import warnings in `LogViewer.tsx` are out of scope (unrelated to Phase 5 changes).

## YAML Validity

`.github/workflows/release.yml` parses cleanly via Node `yaml@2`. Structural anchors verified:
- `on.push.tags`: `["v*"]`
- `permissions.contents`: `write`
- `concurrency.cancel-in-progress`: `false`
- `jobs.build-and-publish.runs-on`: `windows-latest`
- 7 steps, including `tauri-apps/tauri-action@v0` (one occurrence) + `gh release upload --clobber` + `gh release edit --draft=false` (publish-last guarantee)
- NO `--target` flag (only mentioned in a comment forbidding it)
- NO `echo $TAURI_SIGNING*` debug step

## End-to-End Smoke Test

Local invocation:
```bash
echo "test-sig-content" > /tmp/fake.sig
node scripts/generate-update-manifest.mjs \
  --tag v0.1.99 --notes "smoke" \
  --asset-url "https://github.com/x/y/releases/download/v0.1.99/test.exe" \
  --sig-path /tmp/fake.sig
```

Output (verified):
```json
{
  "version": "0.1.99",
  "notes": "smoke",
  "pub_date": "2026-05-02T12:46:02.649Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "test-sig-content",
      "url": "https://github.com/x/y/releases/download/v0.1.99/test.exe"
    }
  }
}
```

Schema fields match Rust `UpdateManifest` deserializer (`src-tauri/src/update/manifest.rs:22-29`) exactly: `version`, `notes`, `pub_date` (snake_case), `platforms.<key>.{signature, url}`. URL starts with literal `https://`. Platform key `windows-x86_64` matches `current_platform_key()` in `lifecycle.rs:204`.

Rust round-trip test (`cargo test --lib manifest_deserializes_from_json`): **green**, 1 test passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] CLI invocation guard off-by-one on Windows**

- **Found during:** post-T4 end-to-end smoke test
- **Issue:** RESEARCH §4 invocation guard skeleton (`import.meta.url === \`file://${process.argv[1]?.replace(/\\/g, "/")}\``) produced `file://C:/x` while Node's actual `import.meta.url` for absolute paths is `file:///C:/x` (triple slash). Result: `node scripts/generate-update-manifest.mjs ...` exited 0 with NO stdout — `main()` never ran. Schema-shape tests passed (they call exported pure functions directly, bypassing the guard) so the bug evaded the test suite.
- **Fix:** use `pathToFileURL(process.argv[1]).href` from Node's built-in `node:url`. Produces canonical `file://` URL with leading triple slash on every platform. DRY (one Node API instead of hand-rolled string concatenation), correct cross-platform.
- **Bonus cleanup:** removed unused `FLAG_STRIP_LENGTH` constant (Tiger-Style: no dead code).
- **Files modified:** `scripts/generate-update-manifest.mjs` (+8/-5 lines)
- **Commit:** **7161343**
- **Verification:** smoke test now emits valid manifest to stdout, exit 0; all 115 tests still pass.

This deviation does NOT change the Plan's deliverables, schema, or tests — it fixes a bug introduced by the RESEARCH §4 reference snippet.

## Manual UAT Smoke Recipe — NOT Executed

Per CONTEXT D-06: requires repo secrets (`TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) configured in GitHub Actions + remote push of a real tag + workflow minutes. Out of scope for executor; documented verbatim in `scripts/setup-signing-key.md` Section 6.

## Forward-Compat Path (macOS / Linux per D-04)

Generator already accepts `--platform-key` arg defaulting to `windows-x86_64`. Future macOS/Linux additions:
1. Add matrix entry to `.github/workflows/release.yml` (`strategy.matrix.platform: [windows-latest, macos-latest, ubuntu-latest]`)
2. Per-platform PowerShell/Bash step constructs `--platform-key darwin-aarch64` (etc) + correct asset path/name
3. Generator + Rust deserializer + `current_platform_key()` already support arbitrary platform key strings — no code changes there
4. macOS additionally requires Apple Developer cert setup (separate runbook)

## Phase 6 Inheritance Trip-Wires

**NONE.** Phase 5 closes the auto-updater chain. Future Phase 6 (admin dashboard) is an unrelated feature surface — no auto-updater contract to inherit from this plan.

## Self-Check

| Check                                                          | Result    |
| -------------------------------------------------------------- | --------- |
| `vitest.config.ts` modified (test.include extended)            | FOUND     |
| `scripts/generate-update-manifest.test.mjs` exists (>= 100 LOC, >= 12 cases) | FOUND (184 LOC, 16 cases) |
| `scripts/generate-update-manifest.mjs` exists (>= 80 LOC, exports 4 fns) | FOUND (153 LOC, 4 fns)    |
| `.github/workflows/release.yml` exists, YAML parses            | FOUND, parses             |
| `scripts/setup-signing-key.md` exists (>= 30 LOC)              | FOUND (134 LOC)           |
| Commit 261d943 (T1 vitest config)                              | FOUND in git log          |
| Commit 731fe65 (T2 RED tests)                                  | FOUND in git log          |
| Commit a7fe5b1 (T2 GREEN generator)                            | FOUND in git log          |
| Commit 3965c63 (T3 workflow)                                   | FOUND in git log          |
| Commit b25887e (T4 runbook)                                    | FOUND in git log          |
| Commit 7161343 (Rule 1 fix)                                    | FOUND in git log          |
| `npm test` green (115 tests)                                   | PASSED                    |
| `npm run build` green (tsc + vite)                             | PASSED                    |
| YAML lint green (`yaml@2` parse)                               | PASSED                    |
| Generator stdout schema matches Rust `UpdateManifest`          | PASSED (smoke + Rust round-trip) |
| Rust `manifest_deserializes_from_json` test                    | PASSED                    |
| No src-tauri/listener/sidecar/src changes (frozen contract)    | VERIFIED (only 5 allowed files in diff) |
| No file deletions                                              | VERIFIED                  |

## Self-Check: PASSED
