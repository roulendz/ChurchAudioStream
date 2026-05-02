---
phase: 260502-lad
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .github/workflows/release.yml
  - scripts/generate-update-manifest.mjs
  - scripts/generate-update-manifest.test.mjs
  - scripts/setup-signing-key.md
  - vitest.config.ts
autonomous: true
requirements:
  - P5-WF
  - P5-GEN
  - P5-TEST
  - P5-ASSET
  - P5-PUB
tags:
  - tauri
  - auto-updater
  - github-actions
  - ci
  - vitest
  - node-esm

must_haves:
  truths:
    - "`.github/workflows/release.yml` triggers on push.tags pattern `v*`"
    - "Workflow declares `permissions: { contents: write }` at job or workflow level"
    - "Workflow uses `tauri-apps/tauri-action@v0` with `releaseDraft: true`"
    - "Workflow flips draft -> published as final step via `gh release edit --draft=false`"
    - "Workflow uploads `latest.json` as a release asset via `gh release upload --clobber`"
    - "`scripts/generate-update-manifest.mjs` exists, ESM, zero external deps (only `node:fs/promises`)"
    - "Generator strips leading `v` from tag and validates remainder via SEMVER_REGEX"
    - "Generator output matches Rust `UpdateManifest` schema exactly: `version`, `notes`, `pub_date` (snake_case), `platforms.<key>.signature`, `platforms.<key>.url`"
    - "Generator URL field starts with literal `https://` (case-sensitive)"
    - "Generator emits `platforms.windows-x86_64` key by default (matches Phase 3 lifecycle.rs:204 `current_platform_key()`)"
    - "Generator reads signature via injected `readSig` (default: `readFile` + `.trim()`), strips trailing newline"
    - "Generator pure functions (`parseArgs`, `normalizeTag`, `buildManifest`, `generateManifest`) exported for unit tests"
    - "`scripts/generate-update-manifest.test.mjs` exists with 12+ vitest cases covering 6+ failure paths (missing v prefix, empty tag, non-semver, unknown flag, missing required flag, http url)"
    - "`vitest.config.ts` `test.include` extended with `scripts/**/*.test.mjs`"
    - "`scripts/setup-signing-key.md` exists, documents key generation + secret upload + pubkey-coordination warning"
    - "`npm test` green: 99 baseline tests + N new generator tests all pass"
    - "`npm run build` green: tsc -b + vite build succeed"
    - "Workflow YAML parses without syntax error (yq or python yaml.safe_load)"
  artifacts:
    - path: ".github/workflows/release.yml"
      provides: "Single end-to-end release workflow on tag push"
      contains: "tauri-apps/tauri-action@v0"
      contains_2: "gh release edit"
    - path: "scripts/generate-update-manifest.mjs"
      provides: "Pure ESM generator emitting Tauri UpdateManifest JSON to stdout"
      exports: ["parseArgs", "normalizeTag", "buildManifest", "generateManifest"]
      min_lines: 80
    - path: "scripts/generate-update-manifest.test.mjs"
      provides: "Vitest unit tests for generator"
      min_lines: 100
      min_test_cases: 12
    - path: "scripts/setup-signing-key.md"
      provides: "One-time runbook for Tauri signing key + GitHub repo secrets"
      min_lines: 30
    - path: "vitest.config.ts"
      provides: "Test config extended to discover scripts/**/*.test.mjs"
      contains: "scripts/**/*.test.mjs"
  key_links:
    - from: "scripts/generate-update-manifest.mjs"
      to: "src-tauri/src/update/manifest.rs"
      via: "schema mirror — version/notes/pub_date/platforms<k>.signature/url"
      pattern: "pub_date"
    - from: "scripts/generate-update-manifest.mjs"
      to: "src-tauri/src/update/version.rs"
      via: "SEMVER_REGEX mirrors parse_semver behavior (rejects leading v, accepts pre-release + build metadata)"
      pattern: "SEMVER_REGEX"
    - from: ".github/workflows/release.yml"
      to: "scripts/generate-update-manifest.mjs"
      via: "PowerShell step invokes `node scripts/generate-update-manifest.mjs --tag ... --notes ... --asset-url ... --sig-path ... --platform-key ... > latest.json`"
      pattern: "node scripts/generate-update-manifest.mjs"
    - from: ".github/workflows/release.yml"
      to: "src-tauri/tauri.conf.json"
      via: "tauri-action triggers `beforeBuildCommand: npm run build:bundle-deps` + `createUpdaterArtifacts: true` -> .exe + .exe.sig auto-uploaded"
      pattern: "tauri-apps/tauri-action@v0"
    - from: ".github/workflows/release.yml"
      to: "src-tauri/src/update/checker.rs"
      via: "platform key `windows-x86_64` matches `current_platform_key()` lookup in Phase 3 client lifecycle"
      pattern: "windows-x86_64"
    - from: "scripts/setup-signing-key.md"
      to: "src-tauri/tauri.conf.json"
      via: "documents pubkey at `plugins.updater.pubkey` already embedded in commit 4d9c69b"
      pattern: "pubkey"
---

<objective>
Phase 5 of master auto-updater plan: ship single end-to-end GitHub Actions release workflow that builds + signs Windows installer via tauri-action, then a tested zero-dep Node ESM generator emits `latest.json` matching the Rust `UpdateManifest` schema, then `gh` CLI uploads the manifest and publishes the release.

Purpose: close the auto-updater loop. Phase 1 = manifest types + validator. Phase 2 = state store. Phase 3 = Tauri plugin wiring + lifecycle. Phase 4 = frontend toast UI. Phase 5 = the publish pipeline that produces what Phase 3 fetches. Without Phase 5 the entire chain has nothing to consume.

Output: 4 new files (workflow YAML, generator script, generator test, signing-key runbook) + 1 modified file (vitest config). Industry-canonical pattern (OBS, Tauri example apps, dev.to references in RESEARCH §1). All 9 CONTEXT.md decisions honored verbatim.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260502-lad-phase-5-auto-updater-github-actions-publ/260502-lad-CONTEXT.md
@.planning/quick/260502-lad-phase-5-auto-updater-github-actions-publ/260502-lad-RESEARCH.md
@.planning/plans/auto-updater-plan.md
@src-tauri/src/update/manifest.rs
@src-tauri/src/update/version.rs
@src-tauri/src/update/checker.rs
@src-tauri/tauri.conf.json
@vitest.config.ts
@package.json

<interfaces>
<!-- Schema source of truth — Node generator output MUST round-trip through this Rust deserializer. -->

From src-tauri/src/update/manifest.rs:22-36:
```rust
pub struct UpdateManifest {
    pub version: String,        // semver, NO leading "v" — parse_semver rejects "v" prefix
    pub notes: String,          // any string
    pub pub_date: String,       // snake_case in JSON; NO serde rename; RFC 3339 expected
    pub platforms: HashMap<String, PlatformAsset>,  // non-empty
}
pub struct PlatformAsset {
    pub signature: String,      // raw .sig file content, trimmed
    pub url: String,            // MUST start with literal "https://" (case-sensitive)
}
```

From src-tauri/src/update/manifest.rs:90-104 (validate):
1. version parses as semver
2. platforms non-empty
3. every url starts with `https://` (case-sensitive)

From src-tauri/src/update/version.rs:87-101 (parse_semver):
- empty input -> ParseError::Empty
- delegates to `semver` crate which rejects leading `v`, accepts pre-release + build metadata

From src-tauri/src/update/checker.rs (Phase 3 contract):
- platform key for Windows = `windows-x86_64` (lifecycle.rs:204)
- `asset_for_platform(manifest, platform_key)` returns None -> SilentSkip

From src-tauri/tauri.conf.json:
- productName = "ChurchAudioStream" (line 3)
- bundle.createUpdaterArtifacts = true (line 15) -> tauri-action auto-uploads .exe + .sig
- bundle.externalBin = ["binaries/server"] (line 16) -> sidecar must exist before tauri build
- bundle.resources includes "binaries/mediasoup-worker.exe" (line 18)
- build.beforeBuildCommand = "npm run build:bundle-deps" (line 9) -> auto-runs build:listener + build:sidecar + build
- plugins.updater.endpoints = "https://github.com/roulendz/ChurchAudioStream/releases/latest/download/latest.json" (line 51)
- plugins.updater.pubkey = embedded Ed25519 pubkey (line 53, commit 4d9c69b)
</interfaces>

<critical_constants>
<!-- These three values are NOT interchangeable. Mixing them = silent download 404 or silent skip. -->

| Concept                      | Value                       | Where used                                  |
|------------------------------|-----------------------------|---------------------------------------------|
| Tauri manifest platform key  | `windows-x86_64`            | latest.json `platforms` key, generator default |
| NSIS bundle arch token       | `x64`                       | inside the .exe filename                    |
| Rust target triple           | `x86_64-pc-windows-msvc`    | only if `--target` flag passed (DO NOT)    |

NSIS bundle filename pattern: `${productName}_${version}_${arch}-setup.exe`
For us: `ChurchAudioStream_${version}_x64-setup.exe`
Adjacent .sig file: `ChurchAudioStream_${version}_x64-setup.exe.sig`

Path on runner (host-native, no `--target`):
`src-tauri/target/release/bundle/nsis/ChurchAudioStream_${version}_x64-setup.exe`
`src-tauri/target/release/bundle/nsis/ChurchAudioStream_${version}_x64-setup.exe.sig`

Manifest URL pattern (per D-08):
`https://github.com/${owner}/${repo}/releases/download/${tag}/${asset-name}`
</critical_constants>

<duplication_note>
Generator's `SEMVER_REGEX` and `normalizeTag` mirror `src-tauri/src/update/version.rs::parse_semver`. Two implementations of the same parser exist by necessity (Rust runs in client, Node runs in CI). Cite Rust as source of truth in generator file header. Round-trip vitest case asserts the Node output deserializes through what Rust expects.
</duplication_note>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend vitest.config.ts test.include for scripts/**/*.test.mjs</name>
  <files>vitest.config.ts</files>
  <action>
    Per D-09 + RESEARCH §4 + Pitfall 18: current `test.include` is `["src/**/*.{test,spec}.{ts,tsx}"]` (line 10). Without extension, scripts/ tests are silently skipped (npm test uses `--passWithNoTests` flag — would falsely report green).

    Edit `vitest.config.ts` line 10 to extend `include` array with `"scripts/**/*.test.mjs"`. Final value:
    ```ts
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "scripts/**/*.test.mjs",
    ],
    ```

    Do NOT change any other field. Coverage thresholds for hooks/lib/components stay untouched. Setup file, environment, globals stay untouched.

    Discovery sanity-check: after edit, run `npm test` once. Existing 99 tests still discovered + still pass (no new tests yet — Task 2 adds them). Output line count for `Test Files` and `Tests` MUST equal pre-edit baseline.
  </action>
  <verify>
    <automated>cd /c/laragon/www/ChurchAudioStream && npm test 2>&1 | grep -E "(Test Files|Tests)"</automated>
  </verify>
  <done>
    - `vitest.config.ts` line 10-13 contains both globs in `include` array
    - `npm test` discovers all existing 99 baseline tests (no regression)
    - No new tests detected yet (scripts/ empty until Task 2)
    - Exit code 0
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: TDD generator + tests (write tests first, then generator, both green)</name>
  <files>scripts/generate-update-manifest.test.mjs, scripts/generate-update-manifest.mjs</files>
  <behavior>
    RED phase — write all tests first; verify they all FAIL because the module doesn't exist yet (or fail because functions are missing).

    GREEN phase — implement the generator using RESEARCH §4 skeleton verbatim; verify all tests pass.

    Test cases (12+ minimum, organized by exported function):

    `normalizeTag` (6 cases):
    - strips leading `v` → `normalizeTag("v0.1.2") === "0.1.2"`
    - accepts pre-release → `normalizeTag("v1.0.0-alpha.1") === "1.0.0-alpha.1"`
    - accepts build metadata → `normalizeTag("v1.0.0+build.5") === "1.0.0+build.5"`
    - rejects missing `v` prefix → throws `/must start with "v"/`
    - rejects empty string → throws `/non-empty string/`
    - rejects non-semver remainder → throws `/not valid semver/` (e.g. `"v1.x.0"`)

    `parseArgs` (5 cases):
    - parses all required flags into correct keys + defaults `platformKey` to `"windows-x86_64"`
    - explicit `--platform-key darwin-aarch64` overrides default
    - rejects unknown flag → throws `/unknown flag/`
    - rejects missing required flag → throws `/missing required flag/` (e.g. only `--tag` given)
    - rejects flag with no value → throws `/flag missing value/` (odd-length argv)

    `buildManifest` (2 cases):
    - composes object matching UpdateManifest schema EXACTLY: keys `version`, `notes`, `pub_date` (snake_case), `platforms`, where `platforms[k]` has `signature` + `url`
    - rejects `http://` URL → throws `/must be https/`

    `generateManifest` (2 cases — DI pattern with `readSig` + `now`):
    - composes valid manifest with injected `now` returning fixed Date and injected `readSig` returning fake signature; output `pub_date` equals `now().toISOString()`
    - readSig contract: caller passes already-trimmed value, generator does NOT re-trim (whitespace inside fake sig stays)

    Schema cross-validation (1 case — mirrors src-tauri/src/update/manifest.rs deserializer expectations):
    - JSON.parse(JSON.stringify(output)) yields object where: `typeof version === "string"`, `typeof notes === "string"`, `typeof pub_date === "string"`, `typeof platforms === "object"`, every platform value has `typeof signature === "string"` + `typeof url === "string"` + `url.startsWith("https://") === true`

    Total: 16 cases (exceeds 12+ minimum and 6+ failure-path requirement: 1 empty tag, 1 missing-v, 1 non-semver, 1 unknown flag, 1 missing required, 1 missing value, 1 http url = 7 failure paths).

    Generator implementation per RESEARCH §4 verbatim (file header below):

    ```js
    #!/usr/bin/env node
    // scripts/generate-update-manifest.mjs
    //
    // Pure ESM. Zero external deps (Node built-ins only).
    // Tiger-Style: assert input boundaries, fail fast, no console.log,
    // descriptive names, functions <= 50 lines, no magic numbers.
    //
    // Schema source of truth: src-tauri/src/update/manifest.rs (UpdateManifest).
    // Semver behavior mirrors src-tauri/src/update/version.rs (parse_semver).
    // Two implementations of the same parser are intentional — Rust runs in
    // the client, this runs in CI. Round-trip vitest case asserts compatibility.
    //
    // Output: writes Tauri latest.json to stdout. Errors -> stderr + exit 1.
    ```

    Constants (named, no magic numbers/strings):
    ```js
    const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
    const REQUIRED_FLAGS = ["--tag", "--notes", "--asset-url", "--sig-path"];
    const KNOWN_FLAGS = [...REQUIRED_FLAGS, "--platform-key"];
    const DEFAULT_PLATFORM_KEY = "windows-x86_64";
    const HTTPS_PREFIX = "https://";
    const TAG_PREFIX = "v";
    ```

    Functions (each <= 50 LOC, single responsibility):
    - `parseArgs(argv): { tag, notes, assetUrl, sigPath, platformKey }` — hand-rolled flag parser per D-07
    - `normalizeTag(tag): string` — strip TAG_PREFIX, validate via SEMVER_REGEX
    - `buildManifest({ version, notes, pubDate, platformKey, assetUrl, signature }): object` — assemble + validate https
    - `readSignature(sigPath): Promise<string>` — `readFile` + `.trim()`, throw on empty
    - `generateManifest(args, { now, readSig }): Promise<object>` — orchestrate; DI for now/readSig per RESEARCH §4 testability rationale
    - `main(argv): Promise<void>` — top-level glue: parse, generate, write to stdout

    CLI invocation guard (RESEARCH §4 + Pitfall 19):
    ```js
    const invokedDirectly = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`;
    if (invokedDirectly) {
      main(process.argv.slice(2)).catch((err) => {
        process.stderr.write(`error: ${err.message}\n`);
        process.exit(1);
      });
    }
    ```
    Why: `process.argv[1]` uses backslashes on Windows. Without `.replace`, importing the module in tests triggers main() and crashes vitest (Pitfall 20).

    Tiger-Style assertions:
    - `parseArgs`: throw on undefined value, unknown flag, missing required
    - `normalizeTag`: throw on non-string, empty, missing prefix, non-semver remainder
    - `buildManifest`: throw on non-https url
    - `readSignature`: throw on empty trimmed content

    Output: `process.stdout.write(JSON.stringify(manifest, null, 2) + "\n")`. NEVER `console.log` (per CONTEXT specifics). Errors via `process.stderr.write(msg + "\n")` + `process.exit(1)`. Only in `main()`.

    DI pattern for `generateManifest`:
    ```js
    export async function generateManifest(args, { now = () => new Date(), readSig = readSignature } = {}) { ... }
    ```
    Tests pass `{ now: () => new Date("2026-05-02T12:00:00.000Z"), readSig: async () => "fake-sig" }`. Production calls with no second arg → defaults apply.

    Atomic commits per CLAUDE.md guidance:
    1. Commit RED: `test(updater): add failing tests for latest.json generator (16 cases)`
    2. Commit GREEN: `feat(updater): zero-dep ESM generator for latest.json (Phase 5)`

    Use Edit/Write tools — NEVER cat heredoc.
  </behavior>
  <action>
    Step 1 (RED): Write `scripts/generate-update-manifest.test.mjs` with 16 vitest cases listed above. Use vitest 4.x API (`describe`, `it`, `expect`, `import` from "vitest"). Import functions from `"./generate-update-manifest.mjs"` (relative path — vitest resolves from cwd via tinyglobby). Do NOT use vi.mock — DI pattern obviates module mocking. Run `npm test` — verify all 16 NEW tests fail (module not found). Commit RED.

    Step 2 (GREEN): Write `scripts/generate-update-manifest.mjs` per RESEARCH §4 skeleton + behavior block above. Export `parseArgs`, `normalizeTag`, `buildManifest`, `generateManifest`. Keep `readSignature` non-exported (consumed via DI default). Run `npm test` — verify all 99 baseline + 16 new = 115 tests pass. Commit GREEN.

    No REFACTOR step needed — generator is already minimal per Tiger-Style + D-07.
  </action>
  <verify>
    <automated>cd /c/laragon/www/ChurchAudioStream && npm test 2>&1 | tail -20</automated>
  </verify>
  <done>
    - `scripts/generate-update-manifest.mjs` exists, exports 4 pure functions, zero external deps (only `node:fs/promises` import)
    - `scripts/generate-update-manifest.test.mjs` exists, 16+ test cases organized by function, includes 7 failure-path cases (>= 6 required)
    - Includes 1 schema cross-validation case mirroring `src-tauri/src/update/manifest.rs` deserializer field requirements
    - `npm test` reports 99 baseline + 16+ new tests passing (total >= 115)
    - Generator file header cites Rust source-of-truth files
    - No `console.log` in generator (only `process.stdout.write` / `process.stderr.write`)
    - Two atomic commits exist: RED test commit + GREEN feat commit
    - Exit code 0
  </done>
</task>

<task type="auto">
  <name>Task 3: Create .github/workflows/release.yml (single end-to-end workflow)</name>
  <files>.github/workflows/release.yml</files>
  <action>
    Per D-01 + D-04 + D-05 + D-08 + RESEARCH §1 (verbatim copy-paste-able snippet). Single workflow on tag push, runs `windows-latest`, builds + signs + drafts via tauri-action, generates manifest via Node script, uploads + publishes via gh CLI.

    Create `.github/workflows/release.yml` with EXACT content from RESEARCH §1 (lines 78-148). Inline-comment each pitfall reference for future maintainers:

    Required structural elements (mandatory):
    - `name: Release`
    - `on: push: tags: ['v*']` — D-03 tag pattern
    - `permissions: contents: write` at workflow level — Pitfall 10 (gh CLI 403 without it)
    - `concurrency: { group: release-${{ github.ref }}, cancel-in-progress: false }` — Pitfall 11 (never cancel in-flight release)
    - `jobs.build-and-publish.runs-on: windows-latest` — D-04 single matrix entry
    - Steps in order:
      1. `actions/checkout@v4`
      2. `actions/setup-node@v4` with `node-version: '22'` + `cache: 'npm'` — RESEARCH §4 Node 22 lock
      3. `dtolnay/rust-toolchain@stable`
      4. `npm ci` — Pitfall 15 (locked deps, fails on drift)
      5. `tauri-apps/tauri-action@v0` step with `id: tauri` and env block:
         - `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`
         - `TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}` — Pitfall 2 + D-05
         - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}` — Pitfall 2 (must exist even if empty)
         - `with` block: `tagName: ${{ github.ref_name }}`, `releaseName: 'ChurchAudioStream ${{ github.ref_name }}'`, `releaseBody: 'See assets to download. The auto-updater will detect this release within 24h of users opening the app.'`, `releaseDraft: true`, `prerelease: false`
      6. `Generate latest.json` step (`shell: pwsh`) with env vars `TAG: ${{ github.ref_name }}`, `OWNER_REPO: ${{ github.repository }}`, runs the PowerShell block from RESEARCH §1 lines 121-138 verbatim
      7. `Upload latest.json + publish release` step (`shell: pwsh`) running `gh release upload "$env:TAG" latest.json --clobber` then `gh release edit "$env:TAG" --draft=false` — Pitfall 8 (publish MUST be last) + Pitfall 9 (--clobber for idempotency)

    Inline comments to add (these encode hard-won knowledge for future agents):
    - Above tauri-action step: `# tauri-action @v0 is current production tag; do NOT use @v1/@v2 (older blog refs are stale — Pitfall 1)`
    - Above signing env block: `# TAURI_SIGNING_PRIVATE_KEY_PASSWORD must EXIST even if empty (Pitfall 2). See scripts/setup-signing-key.md.`
    - Above generate step: `# NSIS arch token = "x64" (filename); manifest platform key = "windows-x86_64" (lookup). NOT interchangeable. (Pitfall 4)`
    - Inside generate step: `# Path is target/release/... (host-native, NO --target flag — Pitfall 3 would shift path to target/<triple>/release/...)`
    - Above publish step: `# Publish must be LAST. Tauri endpoint resolves to most-recently-PUBLISHED non-draft. Publishing before manifest upload = brief 404 window. (Pitfall 8)`
    - Final-line comment: `# Manual UAT smoke recipe: see scripts/setup-signing-key.md or PLAN "Manual UAT".`

    Do NOT add:
    - macOS / Linux matrix entries (D-04 deferred)
    - Explicit `npm run build:listener` / `build:sidecar` steps — `tauri.conf.json:9` `beforeBuildCommand` runs `npm run build:bundle-deps` automatically (Pitfall 12)
    - `--target` flag (Pitfall 3)
    - Any `echo $TAURI_SIGNING_*` debug step (Pitfall 16)
    - Setup-gh CLI step — pre-installed on `windows-latest` (RESEARCH §3 + assumption A2)

    Use Write tool — NEVER cat heredoc.

    Validate syntax after write: parse with python yaml (yq not guaranteed on Windows):
    `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('YAML OK')"`
  </action>
  <verify>
    <automated>cd /c/laragon/www/ChurchAudioStream && python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('YAML OK')" && grep -c "tauri-apps/tauri-action@v0" .github/workflows/release.yml && grep -c "gh release edit" .github/workflows/release.yml && grep -c "permissions:" .github/workflows/release.yml</automated>
  </verify>
  <done>
    - `.github/workflows/release.yml` exists
    - YAML parses without error (python yaml.safe_load returns clean)
    - Contains `tauri-apps/tauri-action@v0` exactly once
    - Contains `gh release edit "$env:TAG" --draft=false` (final publish step)
    - Contains `gh release upload "$env:TAG" latest.json --clobber` (idempotent upload)
    - Contains `permissions:` block with `contents: write`
    - Contains `on: push: tags: ['v*']` trigger
    - Contains `concurrency:` block with `cancel-in-progress: false`
    - Contains `runs-on: windows-latest`
    - Contains Pitfall reference comments (1, 2, 3, 4, 8 cited inline)
    - Does NOT contain `--target` flag anywhere
    - Does NOT contain `echo $TAURI_SIGNING` anywhere
  </done>
</task>

<task type="auto">
  <name>Task 4: Create scripts/setup-signing-key.md runbook</name>
  <files>scripts/setup-signing-key.md</files>
  <action>
    Per D-05 + RESEARCH §6. Create `scripts/setup-signing-key.md` with EXACT content from RESEARCH §6 lines 453-499. Verbatim copy — RESEARCH already produced the canonical runbook.

    Structure (from RESEARCH §6):
    1. Header + warning about pubkey-coordination (existing pubkey already embedded in `src-tauri/tauri.conf.json:53`, commit `4d9c69b` — do NOT regenerate without coordinated rollout)
    2. Section "1. Generate the keypair (LOCAL machine, ONCE)" — `npm run tauri signer generate -- -w ~/.tauri/churchaudiostream.key` + outputs description
    3. Section "2. Verify the public key matches tauri.conf.json" — `cat ~/.tauri/churchaudiostream.key.pub` + comparison instruction
    4. Section "3. Add private key + password to GitHub repo secrets" — table with both secret names + value sources, citing Settings → Secrets and variables → Actions → New repository secret
    5. Section "4. Verify by pushing a smoke tag" — references "Manual UAT smoke recipe" in PLAN
    6. Section "5. Key rotation (FUTURE — not Phase 5 work)" — describes the transition-release pattern (sign with OLD key first, then NEXT release uses new key)

    Append a Section "6. Manual UAT Smoke Recipe" containing the verbatim 6-step recipe from RESEARCH §8 lines 528-561 (git tag → push → gh run watch → gh release view --json assets → gh release download latest.json → cargo cross-validate → cleanup). Per D-06 this lives here (not automated, agent-runnable on demand).

    Use Write tool — NEVER cat heredoc.

    DO NOT include the actual private key, the password, or any rotation timeline. The runbook is operational documentation only.
  </action>
  <verify>
    <automated>cd /c/laragon/www/ChurchAudioStream && test -f scripts/setup-signing-key.md && wc -l scripts/setup-signing-key.md && grep -c "TAURI_SIGNING_PRIVATE_KEY" scripts/setup-signing-key.md && grep -c "v0.0.1-smoketest" scripts/setup-signing-key.md && grep -c "tauri.conf.json" scripts/setup-signing-key.md</automated>
  </verify>
  <done>
    - `scripts/setup-signing-key.md` exists
    - >= 30 lines
    - Mentions both `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
    - Contains pubkey-coordination warning + cites commit `4d9c69b`
    - Includes Section 6 Manual UAT Smoke Recipe with `v0.0.1-smoketest` tag flow
    - Cites `src-tauri/tauri.conf.json` pubkey location
    - Does NOT contain any actual key material, password, or secret value
  </done>
</task>

</tasks>

<acceptance_gates>
After all 4 tasks complete, the following gates MUST pass before declaring Phase 5 done:

1. `npm test` — vitest run green. Total = 99 baseline + 16+ new generator tests (>= 115 tests).
2. `npm run build` — `tsc -b && vite build` green. Workflow YAML changes don't affect this but run anyway as a regression check.
3. YAML syntax valid: `python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"` exits 0.
4. Generator unit-test coverage: 16+ cases including 7 failure paths (D-02 + D-07 satisfied).
5. All 5 must_haves artifacts exist with expected min_lines.
6. No `console.log` in generator (Tiger-Style).
7. No `--target` flag in workflow YAML (Pitfall 3).
8. No echoed secrets in any workflow step (Pitfall 16).
</acceptance_gates>

<manual_uat_smoke_recipe>
Per D-06 — NOT a gate, agent runs on demand AFTER repo secrets configured.

This recipe lives verbatim in `scripts/setup-signing-key.md` Section 6. Do NOT duplicate inline maintenance — the runbook is single source of truth.

Brief summary (full version in runbook):
1. `git tag v0.0.1-smoketest && git push origin v0.0.1-smoketest`
2. `gh run watch` to observe workflow
3. `gh release view v0.0.1-smoketest --json assets --jq '.assets[].name'` — expect 3 assets (.exe, .exe.sig, latest.json)
4. `gh release download v0.0.1-smoketest -p latest.json -O - | jq .` — verify schema shape
5. Optional: `cd src-tauri && cargo test --lib manifest_deserializes_from_json -- --exact` for Rust round-trip
6. Cleanup: `gh release delete v0.0.1-smoketest --yes --cleanup-tag` (also removes remote tag) + local `git tag -d v0.0.1-smoketest`

What it verifies: tag-push trigger, signing chain, asset auto-upload, generator output, gh upload+publish chain, naming convention matches `current_platform_key()`.

What it does NOT verify: actual installer install on clean machine, Tauri client picking up the update (requires running OLDER build pointing at same endpoint — manual cycle, deferred).
</manual_uat_smoke_recipe>

<verification>
Run after all 4 tasks complete:

```bash
# Test gate (Task 1 + Task 2 effects)
cd /c/laragon/www/ChurchAudioStream && npm test 2>&1 | tail -5
# Expect: "Tests  115+ passed", exit 0

# Build gate (regression check)
npm run build 2>&1 | tail -5
# Expect: "built in" line from vite, exit 0

# YAML syntax gate (Task 3)
python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('YAML OK')"
# Expect: "YAML OK"

# File existence gate (all 5 artifacts)
ls -la .github/workflows/release.yml scripts/generate-update-manifest.mjs scripts/generate-update-manifest.test.mjs scripts/setup-signing-key.md vitest.config.ts
# Expect: all 5 files exist

# Schema-mirror sanity gate (no Rust regression)
cd src-tauri && cargo test --lib manifest -- --test-threads=1 2>&1 | tail -10
# Expect: existing manifest tests still pass (no Rust changes, but worth confirming)
```
</verification>

<success_criteria>
- All 4 task `<done>` criteria satisfied
- All `<acceptance_gates>` pass
- 5 files in `must_haves.artifacts` exist with expected content
- All 18+ `must_haves.truths` verifiable post-execution via grep/cat/test
- All 6 `must_haves.key_links` traceable via the cited patterns
- No regressions in existing 99-test baseline
- No regressions in `npm run build`
- Workflow YAML is industry-canonical (matches OBS / Tauri example app patterns)
- Tiger-Style enforced in generator: assertions on input boundaries, fail fast, no console.log, no magic numbers (named constants), descriptive names, functions <= 50 LOC
- DRY: SEMVER_REGEX duplication of Rust `parse_semver` is documented + cited (single source of truth: schema in Rust; two parser implementations by necessity)
- SRP: generator is pure-input-output (DI'd `readSig` + `now`), workflow is single-responsibility (release events only)
</success_criteria>

<output>
After completion, create `.planning/quick/260502-lad-phase-5-auto-updater-github-actions-publ/260502-lad-SUMMARY.md` documenting:
- Files created (with line counts)
- Test count delta (99 baseline → final total)
- Build status (npm test + npm run build exit codes)
- YAML validity confirmation
- Any deviations from RESEARCH §1 / §4 / §6 snippets (expected: NONE)
- Manual UAT smoke recipe NOT executed (per D-06 — requires repo secrets + remote push + workflow minutes)
- Forward-compat path documented for macOS / Linux platform additions (D-04)
- Commit hashes for the atomic RED + GREEN commits in Task 2
</output>
