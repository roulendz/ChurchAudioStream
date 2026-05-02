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
  it("strips bidi then truncates; flags truncated=true", () => {
    const raw = `v1.0.0‮${"x".repeat(200)}`;
    const { display, full, truncated } = sanitizeReleaseNotes(raw);
    expect(display).not.toContain("‮");
    expect(full).not.toContain("‮");
    expect(truncated).toBe(true);
    expect(Array.from(display).length).toBeLessThanOrEqual(NOTES_TRUNCATE_LIMIT + 1); // +1 for ellipsis
  });
  it("does not append ellipsis when sanitized length ≤ limit; flags truncated=false", () => {
    // Bidi strip can shrink length below limit
    const raw = "short‮";
    const { display, full, truncated } = sanitizeReleaseNotes(raw);
    expect(display).toBe("short");
    expect(full).toBe("short");
    expect(truncated).toBe(false);
  });
  it("handles only-control-char input → empty display + full, truncated=false", () => {
    const { display, full, truncated } = sanitizeReleaseNotes("‮‭");
    expect(display).toBe("");
    expect(full).toBe("");
    expect(truncated).toBe(false);
  });
  it("MI-A regression: notes naturally ending with U+2026 ≤ limit are NOT mis-flagged truncated", () => {
    // Pre-fix UpdateToast inferred truncation from `display.endsWith("…")` —
    // a release note ending with a real ellipsis would be wrongly flagged.
    // New design: composer returns authoritative `truncated` flag derived
    // from codepoint count, not from output suffix.
    const raw = "Hotfix released, more details soon…";
    const { display, full, truncated } = sanitizeReleaseNotes(raw);
    expect(display).toBe(raw);
    expect(full).toBe(raw);
    expect(truncated).toBe(false);
  });
  it("MI-A regression: notes naturally ending with U+2026 over limit ARE flagged truncated", () => {
    const raw = `${"x".repeat(NOTES_TRUNCATE_LIMIT)}…`;
    const { display, truncated } = sanitizeReleaseNotes(raw);
    expect(truncated).toBe(true);
    expect(display).toBe(`${"x".repeat(NOTES_TRUNCATE_LIMIT)}…`);
  });
  it("uses NOTES_TRUNCATE_LIMIT constant (regression-guards exported value)", () => {
    expect(NOTES_TRUNCATE_LIMIT).toBe(80);
  });
});
