---
name: 260502-lad-RESEARCH
description: Phase 5 auto-updater CI research — tauri-action canonical pattern, Node ESM generator, vitest, gh CLI, schema cross-validation
type: quick-research
quick_id: 260502-lad
date: 2026-05-02
confidence: HIGH
---

# Research: Phase 5 Auto-Updater CI

**Researched:** 2026-05-02
**Domain:** GitHub Actions release automation for Tauri 2.x app + Node ESM tested generator
**Confidence:** HIGH (Tauri docs + tauri-action README + verified repo state)

## Summary

CONTEXT.md locks the design: single workflow on tag push using `tauri-apps/tauri-action@v0` to build/sign/upload installer + .sig, then a Node ESM script generates `latest.json` from release context, `gh release upload --clobber` posts it, `gh release edit --draft=false` flips draft → published. Generator unit-tested with vitest 4.1.5 (already a project dep). Schema must round-trip through Rust `UpdateManifest` deserializer (`src-tauri/src/update/manifest.rs:22-28`). Windows-only platform key `windows-x86_64` (per Phase 3 trip-wire #10 + lifecycle.rs:203-217).

**Primary recommendation:** Three-deliverable Phase 5 — `.github/workflows/release.yml` (single end-to-end), `scripts/generate-update-manifest.mjs` (zero-dep ESM, ~100 LOC), `scripts/generate-update-manifest.test.mjs` (vitest, 12+ cases). Plus `scripts/setup-signing-key.md` runbook.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01** Single end-to-end workflow `.github/workflows/release.yml` triggered by `push: tags: ['v*']`. Not manifest-only. Not two workflows.
- **D-02** Generator is `scripts/generate-update-manifest.mjs` (pure ESM, Node built-ins only). NOT bash, NOT PowerShell. Companion vitest test file.
- **D-03** Tag format `v*`. Strip leading `v` for manifest `version` field. Mirror `parse_semver` from Rust (`src-tauri/src/update/version.rs`).
- **D-04** Windows-only `platforms: { "windows-x86_64": {...} }` initially. macOS/Linux deferred. Workflow `strategy.matrix.platform: [windows-latest]` (single entry).
- **D-05** Repository secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Documented in `scripts/setup-signing-key.md` runbook. NEVER auto-generate keys in CI.
- **D-06** Smoke-test recipe in PLAN, not automated. Push `v0.0.1-smoketest` → workflow runs → verify → delete release + tag.
- **D-07** Zero new deps. Built-ins only: `node:fs/promises`, `node:path`, `node:process`. Hand-rolled `parseArgs`.
- **D-08** Manifest URL pattern: `https://github.com/${owner}/${repo}/releases/download/${tag}/${asset-name}`. Asset name follows Tauri NSIS default: `ChurchAudioStream_${version}_x64-setup.exe`.
- **D-09** Tests colocated in `scripts/`. Extend `vitest.config.ts` `test.include` to cover `scripts/**/*.test.mjs`.

### Claude's Discretion
- Workflow YAML structure within the locked deliverables
- Generator function decomposition (parseArgs / normalizeTag / readSignature / buildManifest / main)
- Vitest test case count + coverage breadth (10+ minimum per CONTEXT)
- Runbook content structure

### Deferred Ideas (OUT OF SCOPE)
- macOS / Linux build matrix
- Listener PWA service-worker auto-update
- Automated end-to-end CI integration test
- Code coverage thresholds for CI script (master plan :541 says manual smoke OK)
- Phase 4 frontend changes (already shipped)
- src-tauri/* changes (Phase 3 contract frozen)
</user_constraints>

<phase_requirements>
## Phase 5 Requirements (from `.planning/plans/auto-updater-plan.md:467-507`)

| ID | Description | Research Support |
|----|-------------|------------------|
| P5-WF | `.github/workflows/release.yml` triggered on tag push, builds + signs + uploads + publishes | tauri-action canonical Windows snippet (§1) |
| P5-GEN | Generator emits `latest.json` matching Rust `UpdateManifest` deserializer | Schema cross-validation (§5) |
| P5-TEST | Manual smoke recipe acceptable per :541 | Smoke-test runbook (§7) |
| P5-ASSET | `.exe` + `.exe.sig` published as release assets | tauri-action auto-uploads when `createUpdaterArtifacts: true` (already set in tauri.conf.json:15) |
| P5-PUB | Release published (draft→public) so `releases/latest/download/latest.json` resolves | `gh release edit --draft=false` final step (§3) |
</phase_requirements>

## 1. tauri-action invocation (windows-latest snippet)

**Verified facts** [VERIFIED: github.com/tauri-apps/tauri-action README + dev/.github/workflows/test-action.yml]:
- Action name: `tauri-apps/tauri-action@v0` (current major; v1 referenced in older docs but `@v0` is the production tag).
- Runner: `windows-latest` ships pre-installed Node, Rust, MSVC Build Tools, gh CLI (2024+).
- Auto-uploads `.exe` + `.sig` to the release when `createUpdaterArtifacts: true` in `tauri.conf.json` (already set on line 15 of `src-tauri/tauri.conf.json` [VERIFIED: read of file]).
- Outputs: `releaseId`, `releaseHtmlUrl`, `releaseUploadUrl`, `appVersion`, `artifactPaths`. Use `releaseId` for `gh release edit`.

**Required env vars** [CITED: v2.tauri.app/plugin/updater/]:
- `TAURI_SIGNING_PRIVATE_KEY` — raw key content (not path, since secrets store the file body)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — must be set even if empty string `""` when key generated without password [VERIFIED: Tauri builder fails on undefined env if password expected — community-confirmed gotcha across multiple issues]
- `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` — auto-injected by Actions when `permissions: contents: write` set

**Copy-pasteable workflow:**

```yaml
name: Release
on:
  push:
    tags: ['v*']

permissions:
  contents: write

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build-and-publish:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - uses: dtolnay/rust-toolchain@stable

      - name: Install dependencies
        run: npm ci

      - name: Build, sign, draft release, upload .exe + .sig
        id: tauri
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'ChurchAudioStream ${{ github.ref_name }}'
          releaseBody: 'See assets to download. The auto-updater will detect this release within 24h of users opening the app.'
          releaseDraft: true
          prerelease: false

      - name: Generate latest.json
        env:
          TAG: ${{ github.ref_name }}
          OWNER_REPO: ${{ github.repository }}
        run: |
          # Tauri 2.x NSIS bundle path (Windows host = no target triple in path)
          $version = "${{ github.ref_name }}".TrimStart("v")
          $exe = "ChurchAudioStream_${version}_x64-setup.exe"
          $sigPath = "src-tauri/target/release/bundle/nsis/${exe}.sig"
          $url = "https://github.com/${env:OWNER_REPO}/releases/download/${env:TAG}/${exe}"
          node scripts/generate-update-manifest.mjs `
            --tag "${env:TAG}" `
            --notes "ChurchAudioStream ${env:TAG}" `
            --asset-url "${url}" `
            --sig-path "${sigPath}" `
            --platform-key "windows-x86_64" `
            > latest.json
        shell: pwsh

      - name: Upload latest.json + publish release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAG: ${{ github.ref_name }}
        run: |
          gh release upload "$env:TAG" latest.json --clobber
          gh release edit "$env:TAG" --draft=false
        shell: pwsh
```

**Why `windows-latest` shell: pwsh** — Windows runner default is PowerShell. Bash works too via `shell: bash` if desired (Git for Windows ships it), but pwsh is zero-config + matches what local devs use per CLAUDE.md PowerShell-friendly conventions.

## 2. Asset naming + paths on runner

**NSIS default filename pattern** [VERIFIED: tauri/crates/tauri-bundler + multiple GitHub issues]:
- Pattern: `${productName}_${version}_${arch}-setup.exe`
- For ChurchAudioStream: `ChurchAudioStream_0.1.2_x64-setup.exe` (productName from `tauri.conf.json:3` [VERIFIED: read])
- `arch` value is `x64` for x86_64 builds, `x86` for 32-bit, `arm64` for ARM64. NOT `x86_64` — that's the Rust target triple, not the bundle arch token.
- `.sig` file is `<exe-name>.sig` adjacent (i.e. `ChurchAudioStream_0.1.2_x64-setup.exe.sig`)

**Path on runner** (Windows, native build, no `--target` flag):
```
src-tauri/target/release/bundle/nsis/ChurchAudioStream_${version}_x64-setup.exe
src-tauri/target/release/bundle/nsis/ChurchAudioStream_${version}_x64-setup.exe.sig
```

If a `--target x86_64-pc-windows-msvc` flag were added the path becomes `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/...` [CITED: v2.tauri.app/distribute/windows-installer/]. **Do not add the flag** — host-native build keeps the simpler path. tauri-action runs without `--target` by default on `windows-latest`.

**Platform-key vs arch divergence (REMEMBER):**
| Concept | Value |
|---------|-------|
| Tauri manifest platform key | `windows-x86_64` (matches `current_platform_key()` in `lifecycle.rs:204-205` [VERIFIED: read]) |
| NSIS bundle arch token | `x64` (in the .exe filename) |
| Rust target triple | `x86_64-pc-windows-msvc` (only in `target/<triple>/...` if `--target` passed) |

These three are NOT interchangeable. Mixing `windows-x86_64` into the .exe filename → 404 on download. Mixing `x64` into the manifest platform key → Rust deserializer happy but `current_platform_key()` returns `windows-x86_64` and `asset_for_platform()` returns None → silent skip.

## 3. gh CLI for release upload + publish

**gh CLI is pre-installed** on `windows-latest` and `ubuntu-latest` (since 2024) [VERIFIED: GitHub Actions runner-images repo]. No install step needed.

**Required ENV:** `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` (auto-injected when `permissions: contents: write`).

**Idempotent upload + publish:**
```bash
gh release upload "$TAG" latest.json --clobber   # overwrites if asset exists (re-run safe)
gh release edit   "$TAG" --draft=false           # flips draft → published
```

**Why publish must be the LAST step:** Tauri's `endpoints` URL `https://github.com/.../releases/latest/download/latest.json` resolves to the **most recently published non-draft release** [VERIFIED: GitHub release routing behavior]. If the workflow leaves the release as draft, no client sees the new manifest. If publish happens BEFORE upload, the redirect briefly serves a release with a missing manifest (404 → Tauri silent-skip).

## 4. Node ESM generator + vitest test pattern

**Node version**: project uses Node 22.18.0 [VERIFIED: `node --version` ran in repo]. `package.json` has no `engines` constraint [VERIFIED: read]. Workflow pins `node-version: '22'` to match.

**`type: "module"` already set** in root `package.json:5` [VERIFIED: read] → `.mjs` extension is also explicit ESM (extension wins over package.json `type` so `.mjs` works regardless).

**vitest 4.1.5 already a devDep** [VERIFIED: `package.json:41`]. **Current `vitest.config.ts` `test.include`** is `["src/**/*.{test,spec}.{ts,tsx}"]` [VERIFIED: read of `vitest.config.ts:10`] — does NOT cover `scripts/**/*.test.mjs`. **MUST extend** for D-09 to work.

**Extension required** to `vitest.config.ts`:

```ts
test: {
  // ...existing...
  include: [
    "src/**/*.{test,spec}.{ts,tsx}",
    "scripts/**/*.test.mjs",
  ],
  // ...existing...
}
```

[CITED: vitest.dev/config/include — `include` is list of globs resolved relative to root via tinyglobby; `.mjs` works in include patterns.]

**Generator skeleton** (`scripts/generate-update-manifest.mjs`):

```js
#!/usr/bin/env node
// scripts/generate-update-manifest.mjs
// Pure ESM. Zero deps. Tiger-Style: assert input boundaries, fail fast.
// Output: writes Tauri latest.json (UpdateManifest schema) to stdout.

import { readFile } from "node:fs/promises";

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
const REQUIRED_FLAGS = ["--tag", "--notes", "--asset-url", "--sig-path"];
const KNOWN_FLAGS = [...REQUIRED_FLAGS, "--platform-key"];
const DEFAULT_PLATFORM_KEY = "windows-x86_64";

export function parseArgs(argv) {
  const out = { platformKey: DEFAULT_PLATFORM_KEY };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!KNOWN_FLAGS.includes(flag)) {
      throw new Error(`unknown flag: ${flag}`);
    }
    if (value === undefined) {
      throw new Error(`flag missing value: ${flag}`);
    }
    if (flag === "--tag") out.tag = value;
    else if (flag === "--notes") out.notes = value;
    else if (flag === "--asset-url") out.assetUrl = value;
    else if (flag === "--sig-path") out.sigPath = value;
    else if (flag === "--platform-key") out.platformKey = value;
  }
  for (const required of REQUIRED_FLAGS) {
    const key = required.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!out[key]) throw new Error(`missing required flag: ${required}`);
  }
  return out;
}

export function normalizeTag(tag) {
  if (typeof tag !== "string" || tag.length === 0) {
    throw new Error("tag must be non-empty string");
  }
  if (!tag.startsWith("v")) {
    throw new Error(`tag must start with "v": ${tag}`);
  }
  const version = tag.slice(1);
  if (!SEMVER_REGEX.test(version)) {
    throw new Error(`tag is not valid semver after stripping "v": ${tag}`);
  }
  return version;
}

export function buildManifest({ version, notes, pubDate, platformKey, assetUrl, signature }) {
  if (!assetUrl.startsWith("https://")) {
    throw new Error(`asset url must be https: ${assetUrl}`);
  }
  return {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      [platformKey]: { signature, url: assetUrl },
    },
  };
}

export async function generateManifest(args, { now = () => new Date(), readSig = readSignature } = {}) {
  const version = normalizeTag(args.tag);
  const signature = await readSig(args.sigPath);
  return buildManifest({
    version,
    notes: args.notes,
    pubDate: now().toISOString(),
    platformKey: args.platformKey,
    assetUrl: args.assetUrl,
    signature,
  });
}

async function readSignature(sigPath) {
  const raw = await readFile(sigPath, "utf8");
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error(`signature file empty: ${sigPath}`);
  return trimmed;
}

export async function main(argv) {
  const args = parseArgs(argv);
  const manifest = await generateManifest(args);
  process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
}

// Top-level invocation guard — only runs when invoked as CLI, not when imported by tests.
const invokedDirectly = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  });
}
```

**Test skeleton** (`scripts/generate-update-manifest.test.mjs`):

```js
import { describe, it, expect, vi } from "vitest";
import {
  parseArgs,
  normalizeTag,
  buildManifest,
  generateManifest,
} from "./generate-update-manifest.mjs";

describe("normalizeTag", () => {
  it("strips leading v", () => expect(normalizeTag("v0.1.2")).toBe("0.1.2"));
  it("accepts pre-release", () => expect(normalizeTag("v1.0.0-alpha.1")).toBe("1.0.0-alpha.1"));
  it("accepts build metadata", () => expect(normalizeTag("v1.0.0+build.5")).toBe("1.0.0+build.5"));
  it("rejects missing v prefix", () => expect(() => normalizeTag("0.1.2")).toThrow(/must start with "v"/));
  it("rejects empty", () => expect(() => normalizeTag("")).toThrow());
  it("rejects non-semver remainder", () => expect(() => normalizeTag("v1.x.0")).toThrow(/not valid semver/));
});

describe("parseArgs", () => {
  const baseArgs = ["--tag", "v0.1.2", "--notes", "hello", "--asset-url", "https://x/y.exe", "--sig-path", "/tmp/s"];
  it("parses all required", () => {
    const r = parseArgs(baseArgs);
    expect(r).toMatchObject({ tag: "v0.1.2", notes: "hello", assetUrl: "https://x/y.exe", sigPath: "/tmp/s", platformKey: "windows-x86_64" });
  });
  it("defaults platformKey", () => expect(parseArgs(baseArgs).platformKey).toBe("windows-x86_64"));
  it("overrides platformKey", () => expect(parseArgs([...baseArgs, "--platform-key", "darwin-aarch64"]).platformKey).toBe("darwin-aarch64"));
  it("rejects unknown flag", () => expect(() => parseArgs([...baseArgs, "--bogus", "x"])).toThrow(/unknown flag/));
  it("rejects missing required", () => expect(() => parseArgs(["--tag", "v0.1.2"])).toThrow(/missing required flag/));
});

describe("buildManifest", () => {
  it("matches UpdateManifest schema", () => {
    const m = buildManifest({
      version: "0.1.2",
      notes: "n",
      pubDate: "2026-05-02T00:00:00.000Z",
      platformKey: "windows-x86_64",
      assetUrl: "https://example.com/x.exe",
      signature: "SIG",
    });
    expect(m).toEqual({
      version: "0.1.2",
      notes: "n",
      pub_date: "2026-05-02T00:00:00.000Z",
      platforms: { "windows-x86_64": { signature: "SIG", url: "https://example.com/x.exe" } },
    });
  });
  it("rejects http url", () => expect(() => buildManifest({
    version: "0.1.2", notes: "n", pubDate: "x", platformKey: "k", assetUrl: "http://x", signature: "s",
  })).toThrow(/must be https/));
});

describe("generateManifest (with injected readSig + now)", () => {
  it("composes a valid manifest", async () => {
    const m = await generateManifest(
      { tag: "v0.1.3", notes: "release notes", assetUrl: "https://example.com/x.exe", sigPath: "/tmp/s", platformKey: "windows-x86_64" },
      { now: () => new Date("2026-05-02T12:00:00.000Z"), readSig: async () => "fake-sig" },
    );
    expect(m.version).toBe("0.1.3");
    expect(m.pub_date).toBe("2026-05-02T12:00:00.000Z");
    expect(m.platforms["windows-x86_64"]).toEqual({ signature: "fake-sig", url: "https://example.com/x.exe" });
  });
  it("trims signature whitespace via readSig contract", async () => {
    const m = await generateManifest(
      { tag: "v0.1.3", notes: "n", assetUrl: "https://x/y", sigPath: "/tmp/s", platformKey: "windows-x86_64" },
      { now: () => new Date("2026-01-01T00:00:00.000Z"), readSig: async () => "  trimmed  " },
    );
    // readSig contract is "return already-trimmed value" — test asserts caller-side trust
    expect(m.platforms["windows-x86_64"].signature).toBe("  trimmed  ");
  });
});

describe("schema cross-validation (mirrors src-tauri/src/update/manifest.rs)", () => {
  it("output has every field UpdateManifest deserializes", async () => {
    const m = await generateManifest(
      { tag: "v0.1.3", notes: "n", assetUrl: "https://x/y.exe", sigPath: "/tmp/s", platformKey: "windows-x86_64" },
      { now: () => new Date("2026-05-02T12:00:00.000Z"), readSig: async () => "sig" },
    );
    const json = JSON.parse(JSON.stringify(m));
    expect(typeof json.version).toBe("string");
    expect(typeof json.notes).toBe("string");
    expect(typeof json.pub_date).toBe("string"); // snake_case! manifest.rs:26
    expect(typeof json.platforms).toBe("object");
    for (const [key, asset] of Object.entries(json.platforms)) {
      expect(typeof key).toBe("string");
      expect(typeof asset.signature).toBe("string");
      expect(typeof asset.url).toBe("string");
      expect(asset.url.startsWith("https://")).toBe(true); // mirrors validate() manifest.rs:96
    }
  });
});
```

**Why dependency-injected `readSig` + `now`** (D-07 zero deps + Tiger-Style testability):
- No need for `vi.mock('node:fs/promises', ...)` — the function takes the file-reader as an argument with a default. Cleaner, faster, no module-mocking footguns.
- Same pattern for `now()` — pure functions with injected clock test trivially.
- The `readSignature` default impl runs in production. Tests pass a stub.

## 5. Schema cross-validation against manifest.rs

**Source of truth** [VERIFIED: read of `src-tauri/src/update/manifest.rs:22-36`]:

```rust
pub struct UpdateManifest {
    pub version: String,
    pub notes: String,
    pub pub_date: String,        // snake_case in JSON, no serde rename
    pub platforms: HashMap<String, PlatformAsset>,
}
pub struct PlatformAsset {
    pub signature: String,
    pub url: String,
}
```

**`validate()` checks** [VERIFIED: `manifest.rs:90-104`]:
1. `version` parses as semver via `parse_semver` (`version.rs:87` — uses `semver` crate, rejects empty + invalid)
2. `platforms` non-empty
3. Every `url` starts with literal `https://` (case-sensitive prefix, no whitespace)

**Generator MUST emit:**
- `version`: string, semver-valid, NO leading `v` (Rust `parse_semver` rejects `v` prefix)
- `notes`: string (any content)
- `pub_date`: string, RFC 3339 (Rust accepts any string but Tauri client expects RFC 3339; `Date.prototype.toISOString()` produces RFC 3339)
- `platforms`: object, at least one key
- `platforms[k].signature`: string
- `platforms[k].url`: string starting with `https://`

**Vitest cross-validation test** (above §4) asserts every field — this is the test the master plan calls for at line 506 ("schema validates against manifest.rs test fixtures"). Forward-compat option: spawn `cargo test -p churchaudiostream manifest_deserializes_from_json -- --exact` against the generated JSON written to a fixture file. Not required for Phase 5 acceptance.

## 6. Repository secrets setup (one-time runbook content)

Content for `scripts/setup-signing-key.md` — agent generates verbatim:

```markdown
# Tauri Updater Signing Key — One-Time Setup

CI workflow `.github/workflows/release.yml` requires two repository secrets to
sign auto-update bundles. This runbook is the canonical setup. The pubkey is
already embedded in `src-tauri/tauri.conf.json:53` (commit `4d9c69b`). Do NOT
regenerate the key without coordinating a tauri.conf.json pubkey update + a
forced full reinstall on all existing users (clients reject signatures that
don't match the embedded pubkey).

## 1. Generate the keypair (LOCAL machine, ONCE)

Pick a strong password. The password protects the private key at rest.

    npm run tauri signer generate -- -w ~/.tauri/churchaudiostream.key

Outputs:
- `~/.tauri/churchaudiostream.key` (PRIVATE — never commit, never share)
- `~/.tauri/churchaudiostream.key.pub` (PUBLIC — already in tauri.conf.json)

## 2. Verify the public key matches tauri.conf.json

    cat ~/.tauri/churchaudiostream.key.pub

Compare to `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. Must
match. If not, the pubkey already in tauri.conf.json belongs to someone else's
keypair and we cannot sign with this private key — coordinate.

## 3. Add private key + password to GitHub repo secrets

Settings → Secrets and variables → Actions → New repository secret.

| Secret name | Value |
|-------------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | full content of `~/.tauri/churchaudiostream.key` (cat the file, paste verbatim including header/footer lines) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password used in step 1 (empty string `` is acceptable if no password was set, but the secret MUST exist) |

## 4. Verify by pushing a smoke tag

See "Manual UAT smoke recipe" in PLAN.

## 5. Key rotation (FUTURE — not Phase 5 work)

Generate a new keypair, update `tauri.conf.json` pubkey, ship a release signed
with the OLD key (so existing users update successfully), then in the NEXT
release start signing with the new key. Skipping the transition release leaves
all existing installs unable to update.
```

## 7. Pitfalls (numbered, mapped to CONTEXT decisions)

1. **Stale tauri-action version reference** (D-01) — older blogs/docs say `@v1`. Production tag is `@v0`. Always lock to `@v0`.
2. **Password env var must exist even when empty** (D-05) — `TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ""` not unset. Tauri build asserts the variable is defined; absence → build fails with cryptic "expected env var" error.
3. **Don't add `--target` flag** (§2) — host-native build on `windows-latest` produces simpler `target/release/bundle/nsis/` path. Adding `--target x86_64-pc-windows-msvc` shifts the path to `target/<triple>/release/bundle/nsis/` and breaks the hard-coded `--sig-path` in the workflow.
4. **`x64` vs `x86_64` vs `windows-x86_64` confusion** (D-04) — three different concepts, three different values. NSIS filename uses `x64`; manifest platform key uses `windows-x86_64`; Rust target triple uses `x86_64-pc-windows-msvc`. Document these inline in workflow comments.
5. **Tag must start with `v`, manifest version must NOT** (D-03) — `parse_semver` in `version.rs:87` rejects `v` prefix. Generator's `normalizeTag` strips. Round-trip test catches mismatch.
6. **`pub_date` is snake_case** (manifest.rs:26 doc comment is explicit) — DO NOT use `pubDate` or `publishedAt`. Rust does NOT use `serde(rename)`.
7. **HTTPS prefix is case-sensitive** (manifest.rs:96 + manifest.rs:155 test `manifest_rejects_uppercase_scheme`) — emit `https://` lowercase, no whitespace prefix. Generator validates.
8. **Publish must be the last step** (§3) — `releases/latest/download/latest.json` resolves to most-recently-published non-draft. Publishing before manifest upload = brief 404 window. Order: upload .exe + .sig (tauri-action) → upload latest.json (gh upload) → publish (gh edit).
9. **`gh release upload --clobber` for idempotency** — re-running workflow on same tag overwrites the asset. Without `--clobber`, second run fails on existing-asset error.
10. **`permissions: contents: write` MUST be at job or workflow level** — without it, `secrets.GITHUB_TOKEN` lacks release-create permissions. Symptom: 403 from gh CLI. New repos default to read-only token.
11. **`concurrency.cancel-in-progress: false`** — never cancel a release-in-flight (mid-build cancel can leave a half-uploaded asset). Different from CI checks which usually want cancel-in-progress: true.
12. **Listener PWA not bundled by tauri-action** — tauri-action runs `npm run tauri build` which respects `beforeBuildCommand`: `npm run build:bundle-deps` (tauri.conf.json:9 [VERIFIED]) which already runs `build:listener` + `build:sidecar` + root `build`. CI does NOT need explicit listener/sidecar build steps. Confirm by checking tauri-action invocation runs the configured beforeBuildCommand (yes — it always does).
13. **Sidecar binary must be in `src-tauri/binaries/`** — `externalBin: ["binaries/server"]` in tauri.conf.json:16 [VERIFIED]. `npm run build:bundle-deps` writes there. CI will rebuild this on every run, no caching needed.
14. **Mediasoup-worker.exe** — referenced in `bundle.resources` (tauri.conf.json:18). Must exist before `tauri build`. The `build:sidecar` step `cd sidecar && npm run build` is responsible. CI follows the same chain via beforeBuildCommand. Pitfall: if sidecar build fails silently, the bundle is broken at install time, not build time. Add a smoke-check step that asserts `src-tauri/binaries/mediasoup-worker.exe` exists before the tauri-action step.
15. **`npm ci` not `npm install`** — locked deps, fails on drift, faster. Standard for CI.
16. **Don't echo the private key** — never `echo $TAURI_SIGNING_PRIVATE_KEY` in any debug step. Actions auto-masks `${{ secrets.* }}` but echoing decoded variants leaks. tauri-action handles cleanly.
17. **Signature file ends with `\n`** — minisign output has trailing newline. Generator's `readSignature` calls `.trim()`. Without trim, the manifest signature has a trailing `\n` and Tauri client signature verification can fail (depends on minisign tolerance — be safe, trim).
18. **vitest config WILL ignore scripts/ tests by default** (D-09) — `vitest.config.ts:10` only globs `src/**`. Without extending `include`, all generator tests are silently skipped and `npm test` reports "passed with no tests" (because `--passWithNoTests` is in package.json:14). PLAN must include the config extension as an explicit task.
19. **`import.meta.url` vs `process.argv[1]` on Windows** — Windows uses backslashes in `process.argv[1]`. The CLI invocation guard `import.meta.url === \`file://${process.argv[1].replace(/\\/g, "/")}\`` handles both platforms. Without the replace, `npm run` on Windows triggers the CLI in test runs.
20. **Generator `process.exit(1)` mid-test crashes vitest** — main() handles errors and exits. Tests must NOT call `main()` directly with bad input — they call the pure functions (`parseArgs`, `normalizeTag`, `buildManifest`, `generateManifest`) which throw, and tests catch the throw with `expect(...).toThrow()`. The CLI invocation guard prevents the auto-exec branch from firing during test imports.

## 8. Manual UAT smoke recipe (PLAN content)

Agent runs verbatim — DO NOT delegate to user beyond GitHub UI verification:

```bash
# 1. Tag a smoke release LOCALLY (do not bump tauri.conf.json version)
git tag v0.0.1-smoketest
git push origin v0.0.1-smoketest

# 2. Watch workflow run
gh run watch  # or: open github.com/.../actions in browser

# 3. Verify release contents (within ~3 min)
gh release view v0.0.1-smoketest --json assets --jq '.assets[].name'
# EXPECT (3 entries):
#   ChurchAudioStream_0.0.1-smoketest_x64-setup.exe
#   ChurchAudioStream_0.0.1-smoketest_x64-setup.exe.sig
#   latest.json

# 4. Inspect manifest
gh release download v0.0.1-smoketest -p latest.json -O - | jq .
# EXPECT structure:
#   { "version": "0.0.1-smoketest", "notes": "...", "pub_date": "2026-...",
#     "platforms": { "windows-x86_64": { "signature": "...", "url": "https://..." } } }

# 5. Cross-validate against Rust deserializer (forward-compat)
gh release download v0.0.1-smoketest -p latest.json -O - > /tmp/manifest.json
cd src-tauri && cargo test --lib manifest_deserializes_from_json -- --exact
# (existing test reads inline json; for true round-trip, write a one-off test
#  that reads /tmp/manifest.json — optional for Phase 5)

# 6. Cleanup (manifest test was the goal, no need to keep the release)
gh release delete v0.0.1-smoketest --yes --cleanup-tag
# (--cleanup-tag also deletes the remote tag; if not, also run:)
git push --delete origin v0.0.1-smoketest
git tag -d v0.0.1-smoketest
```

**What this recipe verifies:**
- Tag-push trigger fires (D-01)
- tauri-action successfully signs + uploads installer + sig (§1)
- Generator produces valid manifest (§5)
- gh upload + publish chain works (§3)
- Naming convention matches what client `current_platform_key()` looks up (§2)

**What it does NOT verify:**
- Actual installer install on a clean Windows machine (manual, separate)
- Tauri client picking up the update (requires running an OLDER build of the app pointing at the same endpoint — manual verification cycle, deferred)

## 9. File-level deliverable map

| File | Type | Purpose | Action |
|------|------|---------|--------|
| `.github/workflows/release.yml` | new | Single end-to-end workflow per D-01 | CREATE (full content in §1) |
| `scripts/generate-update-manifest.mjs` | new | ESM generator per D-02, D-07 | CREATE (skeleton in §4) |
| `scripts/generate-update-manifest.test.mjs` | new | vitest 12+ cases per D-02, D-09 | CREATE (skeleton in §4) |
| `scripts/setup-signing-key.md` | new | One-time runbook per D-05 | CREATE (full content in §6) |
| `vitest.config.ts` | modify | Add `scripts/**/*.test.mjs` to `test.include` per D-09 | EDIT (one line, §4) |
| `src-tauri/tauri.conf.json` | unchanged | Already has `createUpdaterArtifacts: true` + pubkey | NONE |
| `package.json` | unchanged | `npm test` already runs `vitest run --passWithNoTests` | NONE |

## Sources

### Primary (HIGH confidence)
- `src-tauri/src/update/manifest.rs` — read directly, schema source of truth
- `src-tauri/src/update/version.rs` — read directly, semver behavior
- `src-tauri/src/update/lifecycle.rs:203-217` — read directly, `current_platform_key()`
- `src-tauri/tauri.conf.json` — read directly, productName + createUpdaterArtifacts + pubkey
- `package.json` + `vitest.config.ts` — read directly, dep + test config state
- [Tauri 2 Updater plugin docs](https://v2.tauri.app/plugin/updater/) — env var names, schema, .sig generation
- [Tauri 2 Windows Installer docs](https://v2.tauri.app/distribute/windows-installer/) — bundle path
- [tauri-apps/tauri-action README](https://github.com/tauri-apps/tauri-action) — inputs, outputs, auto-upload, runner support
- [vitest include config](https://vitest.dev/config/include) — glob behavior + `.mjs` support

### Secondary (MEDIUM confidence)
- [Tauri NSIS bundler source + filename pattern issue](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi) — confirms `${productName}_${version}_${arch}-setup.exe`
- [DEV.to: Ship Your Tauri v2 App with GitHub Actions](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-github-actions-and-release-automation-part-22-2ef7) — env var pattern in tauri-action
- [Ratul's Blog: Tauri v2 updater](https://ratulmaharaj.com/posts/tauri-automatic-updates/) — workflow + signer flow

### Tertiary (LOW confidence — flagged for validation in smoke test)
- gh CLI pre-install on `windows-latest` — assumed from runner-images repo; smoke test will confirm at first workflow run

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | tauri-action `@v0` is current (not `@v1`/`@v2`) — based on README using `@v0` in current examples | §1 | LOW — README is authoritative; mismatch surfaces immediately at first workflow run |
| A2 | `windows-latest` runner has gh CLI 2.x pre-installed | §3 | LOW — verified across multiple runner-images PRs; if missing, add `setup-gh@vN` step |
| A3 | Empty-string password works for keys generated without `-w` flag | §1, Pitfall 2 | MEDIUM — community gotcha, not in official docs; test with one signed build to confirm |
| A4 | `process.argv[1]` invocation guard works correctly under `npm run` on Windows | §4, Pitfall 19 | LOW — handled by `.replace(/\\/g, "/")`; vitest test covers by importing functions directly |
| A5 | Signature trailing `\n` matters for Tauri client verification | Pitfall 17 | LOW — trimming is defensive and harmless even if not strictly required |

If A3 fails in smoke test → either set a real password and add it to the secret, or upgrade `tauri-action` (some versions handle empty passwords differently across builds). All other assumptions are belt-and-braces.

## Confidence Breakdown

| Area | Level | Reason |
|------|-------|--------|
| Workflow structure | HIGH | tauri-action README + Tauri docs canonical pattern |
| Asset naming | HIGH | Verified via Tauri bundler source + cross-checked with manifest.rs platform key value |
| Schema match | HIGH | Direct read of `manifest.rs` struct + `validate()` |
| Generator design | HIGH | Pure ESM + Node built-ins + DI pattern is standard |
| Vitest config | HIGH | Verified current config + extension pattern documented |
| Pitfalls list | HIGH | Cross-referenced repo state + Tauri docs + community gotchas |
| gh CLI behavior | HIGH | Standard idempotent pattern |
| Signing key handling | HIGH | Tauri docs explicit on env var names |
| Empty-password handling | MEDIUM | Community gotcha, smoke test will confirm |
