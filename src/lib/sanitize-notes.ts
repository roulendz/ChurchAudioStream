/**
 * Defense-in-depth sanitization for GitHub release-note rendering.
 *
 * @remarks
 * Notes come from authenticated GitHub releases (only repo owner publishes),
 * so XSS via React text nodes is impossible. These helpers exist to:
 *   1. Block bidi-control spoofing of version strings (e.g., U+202E reversing
 *      "1.0.0" → "0.0.1" in display).
 *   2. Avoid lone-surrogate rendering when truncating non-BMP codepoints
 *      (emoji, math symbols) at a UTF-16 boundary.
 *
 * Codepoint-safe (not grapheme-safe). A grapheme cluster spanning multiple
 * codepoints (e.g., 👨‍👩‍👧‍👦 ZWJ sequence) may still split. Acceptable for
 * Phase 4: notes are mostly Latin text with occasional emoji.
 *
 * For grapheme-perfect truncation, swap `Array.from` for `Intl.Segmenter` —
 * adds bundle weight + browser compat caveats; not justified at v1.
 */

export const NOTES_TRUNCATE_LIMIT = 80;

/**
 * Bidirectional formatting controls (Unicode 15.1):
 *   U+202A LRE, U+202B RLE, U+202C PDF, U+202D LRO, U+202E RLO
 *   U+2066 LRI, U+2067 RLI, U+2068 FSI, U+2069 PDI
 * Two char-class ranges in a single regex for O(n) single-pass strip.
 */
export const BIDI_CONTROL_CHARS_RE = /[‪-‮⁦-⁩]/g;

/** Strip bidi-control codepoints. Pure. */
export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROL_CHARS_RE, "");
}

/**
 * Truncate `text` to at most `limit` Unicode codepoints. Appends "…" when
 * truncated. Codepoint-safe via `Array.from` iteration (handles surrogate
 * pairs for non-BMP characters).
 */
export function truncateNotesSafe(text: string, limit: number): string {
  const codepoints = Array.from(text);
  if (codepoints.length <= limit) return text;
  return `${codepoints.slice(0, limit).join("")}…`;
}

/**
 * Result of composed sanitization. `truncated` is the authoritative
 * "was this shortened?" flag — derived from the actual codepoint count
 * comparison inside the composer, NOT inferred from `display.endsWith("…")`
 * (which would mis-flag release notes that naturally end with U+2026).
 */
export interface SanitizedReleaseNotes {
  /** Bidi-stripped, codepoint-truncated to NOTES_TRUNCATE_LIMIT, ellipsis appended when truncated. */
  display: string;
  /** Bidi-stripped only — full text for sr-only screen-reader announcement / aria-label. */
  full: string;
  /** True iff the bidi-stripped text exceeded NOTES_TRUNCATE_LIMIT codepoints. */
  truncated: boolean;
}

/**
 * Composed sanitizer: strip bidi controls, then codepoint-safe truncate.
 * Returns both the truncated `display` form AND the full `full` form, plus
 * an authoritative `truncated` boolean. Callers never need to invoke
 * `stripBidiControls` separately — DRY: one pass through the input.
 */
export function sanitizeReleaseNotes(raw: string): SanitizedReleaseNotes {
  const full = stripBidiControls(raw);
  const codepointCount = Array.from(full).length;
  const truncated = codepointCount > NOTES_TRUNCATE_LIMIT;
  const display = truncated ? truncateNotesSafe(full, NOTES_TRUNCATE_LIMIT) : full;
  return { display, full, truncated };
}
