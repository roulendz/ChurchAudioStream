import { describe, it, expect } from "vitest";
import {
  stripBidiControls,
  truncateNotesSafe,
  sanitizeReleaseNotes,
  NOTES_TRUNCATE_LIMIT,
} from "./sanitize-notes";

describe("stripBidiControls", () => {
  it("removes RLO U+202E (Trojan Source vector)", () => {
    expect(stripBidiControls("v1.0.0‮")).toBe("v1.0.0");
  });
  it("removes all 9 bidi controls in one pass", () => {
    const all = "‪‫‬‭‮⁦⁧⁨⁩";
    expect(stripBidiControls(`a${all}b`)).toBe("ab");
  });
  it("preserves regular Unicode (non-bidi-control)", () => {
    expect(stripBidiControls("Hello 世界 🚀")).toBe("Hello 世界 🚀");
  });
  it("returns empty for empty input", () => {
    expect(stripBidiControls("")).toBe("");
  });
});

describe("truncateNotesSafe", () => {
  it("returns unchanged when length ≤ limit", () => {
    expect(truncateNotesSafe("short", 10)).toBe("short");
  });
  it("returns unchanged when length === limit (no ellipsis)", () => {
    expect(truncateNotesSafe("abcde", 5)).toBe("abcde");
  });
  it("truncates ASCII over limit + appends ellipsis", () => {
    expect(truncateNotesSafe("abcdefghij", 5)).toBe("abcde…");
  });
  it("does NOT split surrogate pair at boundary (codepoint-safe)", () => {
    // "a😀b" = 3 codepoints, 4 code units. Limit 2 → "a😀…" not "a\uD83D…"
    expect(truncateNotesSafe("a😀b", 2)).toBe("a😀…");
  });
  it("counts emoji as single codepoint", () => {
    // 🚀 = 1 codepoint (U+1F680). 5 emoji + limit 3 → 3 emoji + ellipsis
    expect(truncateNotesSafe("🚀🚀🚀🚀🚀", 3)).toBe("🚀🚀🚀…");
  });
  it("preserves multi-line text below limit", () => {
    expect(truncateNotesSafe("line1\nline2", 20)).toBe("line1\nline2");
  });
  it("counts newlines as codepoints (truncation respects them)", () => {
    expect(truncateNotesSafe("a\nb\nc\nd", 3)).toBe("a\nb…");
  });
  it("returns empty for empty input", () => {
    expect(truncateNotesSafe("", 10)).toBe("");
  });
});

describe("sanitizeReleaseNotes (composition)", () => {
  it("strips bidi then truncates", () => {
    const raw = `v1.0.0‮${"x".repeat(200)}`;
    const out = sanitizeReleaseNotes(raw);
    expect(out).not.toContain("‮");
    expect(Array.from(out).length).toBeLessThanOrEqual(NOTES_TRUNCATE_LIMIT + 1); // +1 for ellipsis
  });
  it("does not append ellipsis when sanitized length ≤ limit", () => {
    // Bidi strip can shrink length below limit
    const raw = "short‮";
    expect(sanitizeReleaseNotes(raw)).toBe("short");
  });
  it("handles only-control-char input → empty string, no ellipsis", () => {
    expect(sanitizeReleaseNotes("‮‭")).toBe("");
  });
  it("uses NOTES_TRUNCATE_LIMIT constant (regression-guards exported value)", () => {
    expect(NOTES_TRUNCATE_LIMIT).toBe(80);
  });
});
