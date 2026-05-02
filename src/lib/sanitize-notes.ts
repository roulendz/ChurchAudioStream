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

/** Composed sanitizer: strip bidi controls then codepoint-safe truncate. */
export function sanitizeReleaseNotes(raw: string): string {
  return truncateNotesSafe(stripBidiControls(raw), NOTES_TRUNCATE_LIMIT);
}
