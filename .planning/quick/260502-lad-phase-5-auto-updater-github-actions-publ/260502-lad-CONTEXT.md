---
name: 260502-lad-CONTEXT
description: Locked decisions for Phase 5 auto-updater CI (single tauri-action workflow + tested Node generator)
type: quick-context
quick_id: 260502-lad
date: 2026-05-02
status: ready-for-planning
---

# Quick Task 260502-lad: Phase 5 Auto-Updater CI — Context

**Gathered:** 2026-05-02
**Status:** Ready for planning

<domain>
## Task Boundary

Phase 5 of `.planning/plans/auto-updater-plan.md` (lines 467-507). Deliver
GitHub Actions infrastructure that, on any pushed semver tag, builds + signs
the Windows installer AND publishes a `latest.json` manifest matching the
Rust `UpdateManifest` schema (`src-tauri/src/update/manifest.rs`).

User explicitly delegated UX/CI patterns to Claude with reference to "industry
giants" (OBS, Discord, etc.). Decisions below follow Tauri's official
`tauri-action` pattern + canonical Node-generator + testable script.

In scope: `.github/workflows/release.yml` (single end-to-end workflow), Node
generator + vitest tests, repository-secret documentation, smoke-test
recipe.

Out of scope: Phase 4 frontend changes (already merged), src-tauri/* changes
(Phase 3 contract frozen), listener PWA (separate auto-update via service
worker), macOS/Linux build targets (Phase 3 `current_platform_key` covers
them but binary build matrix deferred — forward-compat doc only).

</domain>

<industry_pattern_audit>
## Industry CI Patterns (cited)

| App | CI pattern | Source |
|-----|-----------|--------|
| **Tauri example apps** | Single workflow on tag push using `tauri-apps/tauri-action`. Builds + signs + drafts release + uploads .exe/.sig + publishes. | github.com/tauri-apps/tauri-action README |
| **OBS Studio** | Single workflow on tag, matrix-builds Win/macOS/Linux, uploads to release. | github.com/obsproject/obs-studio/.github/workflows |
| **VSCode** | Multi-stage: build → sign → release. We don't need their scale; one stage is fine. | (industry knowledge) |
| **Discord desktop** | Closed-source but uses Squirrel (Electron auto-updater) — Tauri equivalent is the updater plugin we use. |  |

Common thread: **one workflow per release event, signing keys as repo secrets, manifest as a release asset GitHub auto-redirects to via `/releases/latest/download/`** — exactly what `src-tauri/tauri.conf.json` `plugins.updater.endpoints` already configured.

</industry_pattern_audit>

<decisions>
## Implementation Decisions

### D-01 — Single end-to-end release workflow (NOT manifest-only)
**Decision:** ONE workflow `.github/workflows/release.yml`, triggered by `push: tags: ['v*']`. Steps:
1. Checkout
2. Setup Node + Rust + cache
3. Install deps (`npm ci`)
4. Use `tauri-apps/tauri-action@v0` to build + sign + create draft release + upload `.exe` + `.exe.sig`
5. Generate `latest.json` via `node scripts/generate-update-manifest.mjs`
6. Upload `latest.json` to the same release via `gh release upload`
7. Publish the release (transitions draft → published, which triggers Tauri clients' auto-update check)

**Why:** Master plan §5 spec was manifest-only, but user delegated to "industry best." Two-workflow split (build elsewhere + manifest publish) leaves a manual step (forget to set `TAURI_SIGNING_PRIVATE_KEY` → unsigned installer → updates fail silently). Single workflow eliminates the gap and matches `tauri-action`'s canonical example. OBS uses the same pattern.

**How to apply:** Triggers on tag push only (NOT on `release:published`) — workflow CREATES the release as part of its run. Idempotent: re-running on the same tag uses `--clobber` to overwrite assets.

### D-02 — Node.js generator script (NOT inline bash, NOT PowerShell)
**Decision:** `scripts/generate-update-manifest.mjs` — pure ESM Node script. Takes flags `--tag`, `--notes`, `--asset-url`, `--sig-path` and stdouts the JSON manifest. Workflow YAML pipes stdout to `latest.json`.

Companion: `scripts/generate-update-manifest.test.mjs` — vitest unit tests (10+ cases covering tag normalization, schema-shape, error paths). Reuses Phase 4 vitest config. Add to `npm test` automatically (vitest discovers `*.test.mjs` if config includes it).

**Why:** Inline bash heredoc is unreadable + untestable. PowerShell limits us to Windows runners (`tauri-action` matrix needs ubuntu-latest cross-compile or windows-latest native — both should work). Node is already a dev dep, vitest already configured (Phase 4). Pure-function generator means local + CI run identical code.

**How to apply:** Script imports `node:fs/promises` for sig-file read; uses `process.argv` minimal flag parser (no commander dep — keep it lean). Top-level `async function main()` with `process.exit(1)` on validation error. Tiger-Style: assertions on input boundaries.

### D-03 — Tag format: accept `v*` only, strip the `v` for semver field
**Decision:** Trigger pattern `tags: ['v*']`. Generator strips leading `v` and validates remainder as semver via duplicate of `parse_semver` logic (Node side — pure function, mirror of Rust `version.rs`). Reject anything that doesn't match `^v\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$` BEFORE any work.

**Why:** GitHub convention + npm/cargo convention is `v1.2.3` for tags, `1.2.3` for the manifest field. tauri-action does this. Phase 1 `parse_semver` rejects the leading `v` so we can't pass tag-as-version unchanged. Single source of truth: tag = `v` + semver.

**How to apply:** `normalizeTag(tag): string` exported from generator. 6+ test cases (with-v, without-v=reject, with-prerelease, with-build, invalid, empty).

### D-04 — Windows-only platforms entry initially (forward-compat path documented)
**Decision:** Generator outputs `platforms: { "windows-x86_64": { signature, url } }`. Build matrix runs `windows-latest` only. macOS/Linux build matrix entries + corresponding `darwin-*`/`linux-*` platform keys deferred to a future phase (no functional impact — Tauri's `current_platform_key()` falls back to no-update on unsupported triples per TW#10).

**Why:** Target market is church admin laptops (Windows-dominant). Phase 3 SUMMARY trip-wire #10 already documents Windows-only platform support. Avoid building macOS/Linux installers we can't even sign (separate Apple Developer cert needed for macOS). Forward path: add matrix entry, add corresponding asset glob in workflow, generator already supports the schema.

**How to apply:** Workflow `strategy.matrix.platform: [windows-latest]`. Single-platform tauri-action invocation. Generator script accepts `--platform-key` arg defaulting to `windows-x86_64` (so future macOS run just passes `--platform-key darwin-aarch64`).

### D-05 — Repository secrets documented in workflow comments + a one-time setup script
**Decision:** Workflow YAML reads `TAURI_SIGNING_PRIVATE_KEY` (file content) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional, empty if no password) from `secrets`. Add `scripts/setup-signing-key.md` — a one-page user runbook covering: generate key, add to GitHub Settings → Secrets, swap pubkey in tauri.conf.json (already done per commit `4d9c69b`).

**Why:** Tauri signing requires Ed25519 private key on the build machine. Secrets are the canonical secure store. A README runbook prevents the "wait, why does build fail?" cycle for first-time setup. We do NOT auto-generate keys in CI (security: private key must be human-controlled).

**How to apply:** Workflow inline-comments cite the secret names + link to runbook. Runbook lists exact commands.

### D-06 — Smoke-test recipe in PLAN, not automated
**Decision:** Acceptance per master plan :541 says "manual smoke test acceptable, no formal coverage" for Phase 5. Add a smoke recipe in PLAN: push `v0.0.1-smoketest` tag → workflow runs in <2 min → release contains `.exe` + `.exe.sig` + `latest.json` → manifest validates against Rust `manifest::validate` (run cargo test on the fixture). Delete the smoke release afterwards.

**Why:** End-to-end CI test would require burning workflow minutes + producing real release artifacts. Manual recipe is the standard for low-traffic release pipelines. Generator unit tests + schema cross-check via `manifest.rs` test fixtures cover the failure modes.

**How to apply:** PLAN includes the recipe verbatim under "Manual UAT." Not a gate.

### D-07 — Node generator zero new deps
**Decision:** Use only Node built-ins (`node:fs/promises`, `node:path`, `node:process`). No `commander`, no `yargs`, no `zx`. Schema validation is hand-rolled (10 LOC).

**Why:** Tiger-Style + DRY/SRP master plan rules: "No 'util' or 'helpers' dumping ground." A 100-LOC generator with zero deps is auditable in one read. Adding `commander` for 4 flags is overkill.

**How to apply:** Minimal `parseArgs(argv): { tag, notes, assetUrl, sigPath, platformKey }` function. Hand-rolled. 4+ test cases (all-args, missing-required, unknown-flag-rejected, defaults-applied).

### D-08 — Manifest URL pattern matches GitHub asset download URL exactly
**Decision:** Generator constructs URL as `https://github.com/${owner}/${repo}/releases/download/${tag}/${asset-name}`. Owner + repo + tag + asset-name passed as flags (workflow expands them from GitHub Actions context). Asset name follows tauri-action default: `${productName}_${version}_${arch}-setup.exe`. For us: `ChurchAudioStream_${version}_x64-setup.exe`.

**Why:** GitHub's asset download URL is stable + supported by Tauri's `https`-prefix validation in `manifest::validate` (line 99). Hardcoding URL pattern in workflow YAML keeps secrets out of the script + makes the script testable with arbitrary URLs.

**How to apply:** Workflow uses GitHub Actions expressions `${{ github.repository }}` + `${{ github.ref_name }}` to build the URL. Generator just receives the finished URL.

### D-09 — Tests live in scripts/ alongside generator (NOT in src/lib)
**Decision:** `scripts/generate-update-manifest.test.mjs` — colocated with the script. vitest config already globs `**/*.test.{js,ts,mjs}` — confirm + extend if needed.

**Why:** SRP — script is build-tooling, not app code. Keeping it out of `src/` prevents accidental bundling into the Tauri webview build. vitest discovers it automatically.

**How to apply:** Verify `vitest.config.ts` `test.include` covers `scripts/**/*.test.mjs`. If it doesn't, extend.

</decisions>

<specifics>
## Specific Ideas

- **Workflow file**: `.github/workflows/release.yml` (NOT `publish-update-manifest.yml` per master plan — single workflow now does everything).
- **Permissions**: workflow needs `contents: write` (create + edit releases). Add to `jobs.<name>.permissions`.
- **Concurrency**: `concurrency: { group: release-${{ github.ref }}, cancel-in-progress: false }` — never cancel a release-in-flight.
- **tauri-action options**:
   - `tagName: ${{ github.ref_name }}`
   - `releaseName: 'ChurchAudioStream ${{ github.ref_name }}'`
   - `releaseBody: 'See assets to download. The auto-updater will detect this release within 24h of users opening the app.'` (overridable by user-edited release notes after the fact)
   - `releaseDraft: true` — workflow's last step flips to published
   - `prerelease: false`
   - `args: '--config src-tauri/tauri.conf.json'`
- **Generator schema match**: every output field must match `UpdateManifest` deserializer in `manifest.rs:25-29` exactly: `version`, `notes`, `pub_date` (snake_case!), `platforms.<key>.signature`, `platforms.<key>.url`. Add a vitest case that JSON.parses sample output and asserts every field present + correct type.
- **Generator pub_date**: ISO 8601 UTC: `new Date().toISOString()` → `2026-05-02T12:34:56.789Z`. Rust `pub_date: String` accepts any string but Tauri expects RFC 3339; `toISOString()` is RFC-3339-compliant.
- **Signature read**: `await fs.readFile(sigPath, 'utf8').then(s => s.trim())` — strip trailing newline (sig file ends with `\n` from minisign).
- **No console.log in script proper** — generator stdouts JSON via `process.stdout.write(json + "\n")`. Errors via `process.stderr.write(msg + "\n")` + `process.exit(1)`. Tiger-Style.

</specifics>

<canonical_refs>
## Canonical References

- Master plan: `.planning/plans/auto-updater-plan.md:467-507` (Phase 5 spec).
- Manifest schema source of truth: `src-tauri/src/update/manifest.rs` (Phase 1).
- Tauri updater config (endpoint URL pattern + pubkey): `src-tauri/tauri.conf.json` `plugins.updater`.
- Tauri version field reference (semver parser to mirror in Node): `src-tauri/src/update/version.rs`.
- Phase 3 trip-wire #10 (platform key Windows-only): `.planning/quick/260501-uon-phase-3-auto-updater-tauri-plugin-wiring/260501-uon-SUMMARY.md`.
- Phase 4 vitest config to extend: `vitest.config.ts`.
- tauri-action README: github.com/tauri-apps/tauri-action (industry-standard CI pattern).

</canonical_refs>
