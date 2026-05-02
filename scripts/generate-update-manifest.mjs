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
// the client, this runs in CI. The vitest schema cross-validation case
// asserts compatibility with the Rust deserializer + validate() rules.
//
// Output: writes Tauri latest.json to stdout. Errors -> stderr + exit 1.

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Named constants — no magic numbers/strings.
const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
const REQUIRED_FLAGS = ["--tag", "--notes", "--asset-url", "--sig-path"];
const KNOWN_FLAGS = [...REQUIRED_FLAGS, "--platform-key"];
const DEFAULT_PLATFORM_KEY = "windows-x86_64";
const HTTPS_PREFIX = "https://";
const TAG_PREFIX = "v";

const FLAG_TO_KEY = {
  "--tag": "tag",
  "--notes": "notes",
  "--asset-url": "assetUrl",
  "--sig-path": "sigPath",
  "--platform-key": "platformKey",
};

/**
 * Parse argv into named keys. Hand-rolled per D-07 (zero deps).
 * Throws on unknown flag, missing value, or missing required flag.
 */
export function parseArgs(argv) {
  if (!Array.isArray(argv)) {
    throw new Error("argv must be an array");
  }
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
    out[FLAG_TO_KEY[flag]] = value;
  }
  for (const required of REQUIRED_FLAGS) {
    const key = FLAG_TO_KEY[required];
    if (!out[key]) {
      throw new Error(`missing required flag: ${required}`);
    }
  }
  return out;
}

/**
 * Strip leading `v` and validate remainder as semver.
 * Mirrors src-tauri/src/update/version.rs::parse_semver behavior.
 */
export function normalizeTag(tag) {
  if (typeof tag !== "string" || tag.length === 0) {
    throw new Error("tag must be non-empty string");
  }
  if (!tag.startsWith(TAG_PREFIX)) {
    throw new Error(`tag must start with "${TAG_PREFIX}": ${tag}`);
  }
  const version = tag.slice(TAG_PREFIX.length);
  if (!SEMVER_REGEX.test(version)) {
    throw new Error(`tag is not valid semver after stripping "${TAG_PREFIX}": ${tag}`);
  }
  return version;
}

/**
 * Compose a Tauri UpdateManifest object.
 * Validates url uses literal "https://" (case-sensitive) per manifest.rs:96.
 */
export function buildManifest({ version, notes, pubDate, platformKey, assetUrl, signature }) {
  if (typeof assetUrl !== "string" || !assetUrl.startsWith(HTTPS_PREFIX)) {
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

/**
 * Read .sig file content, trim trailing newline (minisign emits one).
 * Throws on empty after trim.
 */
async function readSignature(sigPath) {
  const raw = await readFile(sigPath, "utf8");
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`signature file empty: ${sigPath}`);
  }
  return trimmed;
}

/**
 * Orchestrate manifest construction. DI for `now` + `readSig` per
 * RESEARCH §4 testability rationale (no module mocking).
 */
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

/**
 * CLI entrypoint. Owns side effects: stdout write, stderr write, exit code.
 * Pure functions above are exported for unit tests.
 */
async function main(argv) {
  const args = parseArgs(argv);
  const manifest = await generateManifest(args);
  process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
}

// Top-level invocation guard — only runs when invoked as CLI, not when
// imported by tests. Use Node's pathToFileURL to convert process.argv[1]
// (a filesystem path with platform-native separators + bare drive letter on
// Windows) into a comparable file:// URL with leading triple slash. Hand-
// rolled string concatenation is off-by-one on Windows (file:///C:/x vs
// file://C:/x — Pitfall 19 expanded).
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  });
}
