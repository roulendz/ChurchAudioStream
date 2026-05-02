// scripts/generate-update-manifest.test.mjs
//
// Vitest unit tests for the Tauri latest.json generator.
//
// 16 cases organized by exported function. 7 failure-path cases (>= 6
// required by D-02). Schema cross-validation case mirrors deserializer
// expectations in src-tauri/src/update/manifest.rs (`UpdateManifest`).
//
// DI pattern: tests inject `now` + `readSig` directly to `generateManifest` —
// no module mocking required. See RESEARCH §4 testability rationale.

import { describe, it, expect } from "vitest";
import {
  parseArgs,
  normalizeTag,
  buildManifest,
  generateManifest,
} from "./generate-update-manifest.mjs";

describe("normalizeTag", () => {
  it("strips leading v", () => {
    expect(normalizeTag("v0.1.2")).toBe("0.1.2");
  });

  it("accepts pre-release suffix", () => {
    expect(normalizeTag("v1.0.0-alpha.1")).toBe("1.0.0-alpha.1");
  });

  it("accepts build metadata", () => {
    expect(normalizeTag("v1.0.0+build.5")).toBe("1.0.0+build.5");
  });

  it("rejects missing v prefix", () => {
    expect(() => normalizeTag("0.1.2")).toThrow(/must start with "v"/);
  });

  it("rejects empty string", () => {
    expect(() => normalizeTag("")).toThrow(/non-empty string/);
  });

  it("rejects non-semver remainder", () => {
    expect(() => normalizeTag("v1.x.0")).toThrow(/not valid semver/);
  });
});

describe("parseArgs", () => {
  const baseArgs = [
    "--tag", "v0.1.2",
    "--notes", "hello",
    "--asset-url", "https://example.com/y.exe",
    "--sig-path", "/tmp/s",
  ];

  it("parses all required flags + defaults platformKey", () => {
    const r = parseArgs(baseArgs);
    expect(r).toMatchObject({
      tag: "v0.1.2",
      notes: "hello",
      assetUrl: "https://example.com/y.exe",
      sigPath: "/tmp/s",
      platformKey: "windows-x86_64",
    });
  });

  it("explicit --platform-key overrides default", () => {
    const r = parseArgs([...baseArgs, "--platform-key", "darwin-aarch64"]);
    expect(r.platformKey).toBe("darwin-aarch64");
  });

  it("rejects unknown flag", () => {
    expect(() => parseArgs([...baseArgs, "--bogus", "x"])).toThrow(/unknown flag/);
  });

  it("rejects missing required flag", () => {
    expect(() => parseArgs(["--tag", "v0.1.2"])).toThrow(/missing required flag/);
  });

  it("rejects flag with no value (odd-length argv)", () => {
    expect(() => parseArgs(["--tag"])).toThrow(/flag missing value/);
  });

  it("MI-01 regression: accepts empty --notes \"\" (legitimate empty release notes)", () => {
    // Pre-fix `if (!out[key])` rejected empty string as "missing required".
    // Distinguish absent (undefined) from empty (legitimate).
    const r = parseArgs([
      "--tag", "v0.1.2",
      "--notes", "",
      "--asset-url", "https://example.com/x.exe",
      "--sig-path", "/tmp/s",
    ]);
    expect(r.notes).toBe("");
  });
});

describe("buildManifest", () => {
  it("composes object matching UpdateManifest schema exactly", () => {
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
      platforms: {
        "windows-x86_64": { signature: "SIG", url: "https://example.com/x.exe" },
      },
    });
  });

  it("rejects http:// url (must be https)", () => {
    expect(() => buildManifest({
      version: "0.1.2",
      notes: "n",
      pubDate: "x",
      platformKey: "windows-x86_64",
      assetUrl: "http://insecure/x.exe",
      signature: "s",
    })).toThrow(/must start with https:\/\//);
  });
});

describe("generateManifest (DI: now + readSig)", () => {
  it("composes valid manifest with injected now + readSig", async () => {
    const m = await generateManifest(
      {
        tag: "v0.1.3",
        notes: "release notes",
        assetUrl: "https://example.com/x.exe",
        sigPath: "/tmp/s",
        platformKey: "windows-x86_64",
      },
      {
        now: () => new Date("2026-05-02T12:00:00.000Z"),
        readSig: async () => "fake-sig",
      },
    );
    expect(m.version).toBe("0.1.3");
    expect(m.pub_date).toBe("2026-05-02T12:00:00.000Z");
    expect(m.platforms["windows-x86_64"]).toEqual({
      signature: "fake-sig",
      url: "https://example.com/x.exe",
    });
  });

  it("readSig contract: caller already trims, generator does NOT re-trim", async () => {
    const m = await generateManifest(
      {
        tag: "v0.1.3",
        notes: "n",
        assetUrl: "https://x/y",
        sigPath: "/tmp/s",
        platformKey: "windows-x86_64",
      },
      {
        now: () => new Date("2026-01-01T00:00:00.000Z"),
        readSig: async () => "  inner-whitespace-preserved  ",
      },
    );
    expect(m.platforms["windows-x86_64"].signature).toBe("  inner-whitespace-preserved  ");
  });
});

describe("schema cross-validation (mirrors src-tauri/src/update/manifest.rs)", () => {
  it("output passes the same checks UpdateManifest deserializer + validate() apply", async () => {
    const m = await generateManifest(
      {
        tag: "v0.1.3",
        notes: "n",
        assetUrl: "https://example.com/x.exe",
        sigPath: "/tmp/s",
        platformKey: "windows-x86_64",
      },
      {
        now: () => new Date("2026-05-02T12:00:00.000Z"),
        readSig: async () => "sig",
      },
    );
    const json = JSON.parse(JSON.stringify(m));
    expect(typeof json.version).toBe("string");
    expect(typeof json.notes).toBe("string");
    expect(typeof json.pub_date).toBe("string"); // snake_case! manifest.rs:26
    expect(typeof json.platforms).toBe("object");
    expect(Object.keys(json.platforms).length).toBeGreaterThan(0);
    for (const [key, asset] of Object.entries(json.platforms)) {
      expect(typeof key).toBe("string");
      expect(typeof asset.signature).toBe("string");
      expect(typeof asset.url).toBe("string");
      expect(asset.url.startsWith("https://")).toBe(true); // manifest.rs:96 case-sensitive
    }
  });
});
