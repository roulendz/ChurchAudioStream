---
phase: quick-260502-epd
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - tsconfig.node.json
  - src/lib/useFocusTrap.ts
  - src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx
  - src/lib/sanitize-notes.ts
  - src/lib/sanitize-notes.test.ts
  - src/components/UpdateToast/UpdateToast.tsx
  - src/components/UpdateToast/UpdateToast.test.tsx
  - vitest.config.ts
  - src/hooks/updateStateMachine.ts
  - src/hooks/updateStateMachine.test.ts
  - src/hooks/useUpdateState.ts
  - src/hooks/useUpdateState.test.ts
autonomous: true
requirements: [MA-01, MA-02, MI-01, MI-02, MI-03, MI-04, MI-05]
tags: [react, vitest, tauri, hooks, sanitization, dry, srp]

must_haves:
  truths:
    - "updateReducer case 'checkCompleted' early-returns when state.kind is UpdateAvailable | Downloading | Installing (reducer-local guard, not closure-local)"
    - "UpdateAction.checkCompleted no longer carries updateOffered field — only { type: 'checkCompleted'; lastCheckUnix: number }"
    - "useUpdateState.checkNow dispatches checkCompleted with only { type, lastCheckUnix } (no updateOffered)"
    - "useUpdateState defines a single internal helper dispatchOnSuccess(commandName, args, action) inside the hook closure that wraps invoke + dispatch with try/catch + console.warn on failure"
    - "useUpdateState.install does NOT dispatch on success (Phase 3 update:installed event drives transition per TW#1 — no Restart button)"
    - "useUpdateState.dismiss dispatches { type: 'dismissed' } only on success; warns on failure and skips dispatch"
    - "useUpdateState.skip dispatches { type: 'skipped', version } only on success; warns on failure and skips dispatch"
    - "src/lib/sanitize-notes.ts exists and exports stripBidiControls, truncateNotesSafe, sanitizeReleaseNotes, NOTES_TRUNCATE_LIMIT, BIDI_CONTROL_CHARS_RE"
    - "UpdateToast AvailableContent calls sanitizeReleaseNotes(state.notes) for visible truncated notes AND stripBidiControls(state.notes) for the sr-only full notes (defense-in-depth symmetry per RESEARCH A2)"
    - "UpdateToast no longer defines its own NOTES_TRUNCATE_LIMIT constant or truncateNotes function (centralized in sanitize-notes.ts — DRY)"
    - "src/lib/useFocusTrap.ts has @remarks JSDoc block documenting the snapshot-at-activation quirk and the MutationObserver upgrade path"
    - "src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx no longer contains the no-op `expect(true).toBe(true)` 'Already skipped' test block"
    - "tsconfig.node.json has inline jsonc-comment next to verbatimModuleSyntax: true documenting the import-type requirement"
    - "vitest.config.ts per-file thresholds include src/lib/sanitize-notes.ts at 100% lines/functions/branches/statements"
    - "Race-window regression test in useUpdateState.test.ts simulates update:available event arriving mid-await invoke('update_check_now') and asserts state.kind stays UpdateAvailable after checkNow resolves"
    - "Three IPC-error regression tests in useUpdateState.test.ts (one per install/dismiss/skip) assert state unchanged + console.warn called once with `${commandName} failed` + Error when invoke throws"
    - "All 10 Phase 3 trip-wires from 260501-wqg still honored — no Restart button, camelCase payloads, totalBytes:0 indeterminate, update_check_now drives UpToDate, exact skip arg shape, 'never' for last_check_unix === 0"
    - "All 17 truths from 260501-wqg PLAN.md must_haves still hold (no behavioral regression in toast, button, focus trap, ARIA, persistence, sibling-card placement)"
    - "npm test exits 0 (vitest run); npm run test:coverage meets all per-file thresholds (90% components, 100% hooks/lib including new sanitize-notes.ts); npm run build exits 0 (tsc -b && vite build)"

  artifacts:
    - path: "src/lib/sanitize-notes.ts"
      provides: "pure release-note sanitization (bidi strip + codepoint-safe truncate + composition)"
      exports: ["stripBidiControls", "truncateNotesSafe", "sanitizeReleaseNotes", "NOTES_TRUNCATE_LIMIT", "BIDI_CONTROL_CHARS_RE"]
    - path: "src/lib/sanitize-notes.test.ts"
      provides: "14+ unit cases for stripBidiControls + truncateNotesSafe + sanitizeReleaseNotes"
      contains: "describe"
    - path: "src/hooks/updateStateMachine.ts"
      provides: "reducer with reducer-local checkCompleted guard (no updateOffered field on action)"
      contains: "case \"checkCompleted\""
    - path: "src/hooks/updateStateMachine.test.ts"
      provides: "tests updated to drop updateOffered + 3 new symmetric guard cases for UpdateAvailable/Downloading/Installing"
      contains: "checkCompleted"
    - path: "src/hooks/useUpdateState.ts"
      provides: "dispatchOnSuccess helper, install warn-only, dismiss/skip via helper, checkNow without updateOffered"
      contains: "dispatchOnSuccess"
    - path: "src/hooks/useUpdateState.test.ts"
      provides: "MA-01 race-window regression test + MA-02 three IPC-error regression tests + updated checkNow assertion"
      contains: "MA-01 regression"
    - path: "src/components/UpdateToast/UpdateToast.tsx"
      provides: "imports sanitizeReleaseNotes + stripBidiControls; uses both for visible + sr-only notes"
      contains: "sanitizeReleaseNotes"
    - path: "src/components/UpdateToast/UpdateToast.test.tsx"
      provides: "truncation tests assert sanitized output; trip-wire #1 + ARIA tests preserved"
      contains: "truncates notes"
    - path: "src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx"
      provides: "no-op 'Already skipped' test block deleted; remaining 10 tests intact"
      contains: "describe"
    - path: "src/lib/useFocusTrap.ts"
      provides: "JSDoc with @remarks documenting snapshot-at-activation quirk"
      contains: "@remarks"
    - path: "tsconfig.node.json"
      provides: "verbatimModuleSyntax with inline jsonc breadcrumb"
      contains: "verbatimModuleSyntax"
    - path: "vitest.config.ts"
      provides: "100% per-file threshold for src/lib/sanitize-notes.ts added to thresholds map"
      contains: "src/lib/sanitize-notes.ts"

  key_links:
    - from: "src/components/UpdateToast/UpdateToast.tsx"
      to: "src/lib/sanitize-notes.ts"
      via: "import { sanitizeReleaseNotes, stripBidiControls } from '../../lib/sanitize-notes'"
      pattern: "from \"\\.\\./\\.\\./lib/sanitize-notes\""
    - from: "src/hooks/useUpdateState.ts"
      to: "src/hooks/updateStateMachine.ts"
      via: "dispatch({ type: 'checkCompleted', lastCheckUnix }) — no updateOffered"
      pattern: "type: \"checkCompleted\", lastCheckUnix"
    - from: "src/hooks/useUpdateState.ts"
      to: "@tauri-apps/api/core invoke()"
      via: "dispatchOnSuccess('update_dismiss' | 'update_skip_version', args, action) wraps invoke + try/catch + warn"
      pattern: "dispatchOnSuccess"
    - from: "vitest.config.ts"
      to: "src/lib/sanitize-notes.ts"
      via: "thresholds entry enforces 100% coverage on the new module"
      pattern: "src/lib/sanitize-notes.ts"
---

<objective>
Fix all 7 review findings (2 MAJOR + 5 MINOR) from `.planning/quick/260501-wqg-phase-4-auto-updater-react-ui-components/260501-wqg-REVIEW.md` as a small follow-up to quick task 260501-wqg (Phase 4 auto-updater React UI).

Purpose: close stale-closure race in `checkNow` (MA-01), eliminate silent IPC error swallow in `install`/`dismiss`/`skip` (MA-02), harden release-note rendering against bidi spoof + surrogate-pair split (MI-01 + MI-02), document `useFocusTrap` snapshot quirk (MI-03), delete no-op test (MI-04), document `verbatimModuleSyntax` gotcha (MI-05). Six atomic commits, one per finding (MI-01+MI-02 combined since same file). Preserve all 17 truths from 260501-wqg PLAN.md must_haves and all 10 Phase 3 trip-wires.

Output: 2 new files (sanitize-notes.ts + sanitize-notes.test.ts), 10 modified files (hooks + tests + UpdateToast + UpdateToast tests + CheckForUpdatesButton tests + useFocusTrap + tsconfig.node.json + vitest.config.ts), 6 atomic commits, all gates green.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/quick/260502-epd-fix-ma-01-stale-closure-race-ma-02-silen/260502-epd-CONTEXT.md
@.planning/quick/260502-epd-fix-ma-01-stale-closure-race-ma-02-silen/260502-epd-RESEARCH.md
@.planning/quick/260501-wqg-phase-4-auto-updater-react-ui-components/260501-wqg-REVIEW.md
@.planning/quick/260501-wqg-phase-4-auto-updater-react-ui-components/260501-wqg-PLAN.md
@src/hooks/useUpdateState.ts
@src/hooks/updateStateMachine.ts
@src/hooks/useUpdateState.test.ts
@src/hooks/updateStateMachine.test.ts
@src/components/UpdateToast/UpdateToast.tsx
@src/components/UpdateToast/UpdateToast.test.tsx
@src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx
@src/lib/useFocusTrap.ts
@tsconfig.node.json
@vitest.config.ts

<interfaces>
<!-- Existing types/exports executor needs. Extracted from current source. -->
<!-- No need to re-explore the codebase — these are the contracts. -->

From src/hooks/updateStateMachine.ts (current — to be modified):
```typescript
export type UpdateUiState =
  | { kind: "Idle" }
  | { kind: "UpdateAvailable"; version: string; notes: string; downloadUrl: string }
  | { kind: "Downloading"; version: string; downloadedBytes: number; totalBytes: number }
  | { kind: "Installing"; version: string }
  | { kind: "UpToDate"; checkedAtUnix: number }
  | { kind: "SilentSkip"; skippedVersion: string };

export type UpdateAction =
  | { type: "available"; version: string; notes: string; downloadUrl: string }
  | { type: "progress"; downloadedBytes: number; totalBytes: number }
  | { type: "installed"; version: string }
  | { type: "checkCompleted"; lastCheckUnix: number; updateOffered: boolean }  // ← drop updateOffered (MA-01)
  | { type: "dismissed" }
  | { type: "skipped"; version: string }
  | { type: "reset" };

export function updateReducer(state: UpdateUiState, action: UpdateAction): UpdateUiState;
```

From src/lib/types.ts (unchanged — Tauri storage mirror):
```typescript
export interface UpdateState {
  last_check_unix: number;
  last_dismissed_unix: number;
  skipped_versions: string[];
}
```

Tauri commands invoked by useUpdateState (names MUST stay exact — Phase 3 contract frozen, src-tauri/* untouchable):
- `update_check_now` → `Promise<UpdateState>`
- `update_get_state` → `Promise<UpdateState>`
- `update_install` → `Promise<void>` (no args — Phase 3 dispatcher emits update:installed; per TW#1 no Restart button)
- `update_dismiss` → `Promise<void>` (no args)
- `update_skip_version` → `Promise<void>` (args: `{ version: string }`)

Tauri events listened by useUpdateState (camelCase payloads — Phase 3 dispatcher contract):
- `update:available` → `{ version: string; notes: string; downloadUrl: string }`
- `update:download:progress` → `{ downloadedBytes: number; totalBytes: number }`
- `update:installed` → `{ version: string }`

console.warn precedent (6 in-repo usages — pattern: `console.warn("<command> failed", error)`):
- `src/components/CheckForUpdatesButton/CheckForUpdatesButton.tsx:39` — `console.warn("CheckForUpdatesButton: check_now failed", error)`
- `src/hooks/useUpdateState.ts:55,67` — `useUpdateState: listener registration failed` / `useUpdateState: update_get_state failed`
- `src/components/LogViewer.tsx:109,159,166`
</interfaces>

<locked_decisions>
<!-- From 260502-epd-CONTEXT.md — NON-NEGOTIABLE -->
- **MA-01:** Drop `updateOffered` field from `checkCompleted` action union. Reducer inspects `state.kind` (returns state if `UpdateAvailable | Downloading | Installing`, else `UpToDate`). Hook passes only `lastCheckUnix`.
- **MA-02:** DRY helper `dispatchOnSuccess(commandName, args, action)` defined INSIDE `useUpdateState` closure (reads `dispatch`). Skip-dispatch on failure. `install` does NOT use the helper — warns only (no success dispatch per TW#1, installer takes over). `dismiss` + `skip` use it.
- **MI-01 + MI-02:** New module `src/lib/sanitize-notes.ts` exports `stripBidiControls`, `truncateNotesSafe`, `sanitizeReleaseNotes`. Constants `BIDI_CONTROL_CHARS_RE` + `NOTES_TRUNCATE_LIMIT = 80` live there. 100% lib coverage. 14+ unit tests.
- **MI-03:** JSDoc `@remarks` block at top of `useFocusTrap.ts` documenting snapshot quirk. No code change. No new test.
- **MI-04:** Delete no-op test at `CheckForUpdatesButton.test.tsx:91-104`. Coverage threshold (90%) must still pass.
- **MI-05:** Inline JSONC comment next to `verbatimModuleSyntax: true` in `tsconfig.node.json`.
- **A2 (RESEARCH open question — DECIDED YES per planner):** sr-only full notes ALSO pass through `stripBidiControls` (defense-in-depth symmetry). Visible display = `sanitizeReleaseNotes` (strip + truncate). sr-only `full` = `stripBidiControls` only (no truncate — AT consumes full text).
- **Atomic commits:** 6 total — one per finding (MI-01+MI-02 combined since same file). Order: MI-05 → MI-03 → MI-04 → MI-01+MI-02 → MA-01 → MA-02. Format: `fix(quick-260502-epd): <ID> <one-liner>`.
- **No new dependencies.** No zustand. No `Intl.Segmenter`. No new lib.
- **Coverage thresholds unchanged for existing files:** 100% hooks/lib, 90% components. Add `src/lib/sanitize-notes.ts` to 100% lib tier.
- **Out of scope:** src-tauri/* (Phase 3 frozen), Phase 5 CI workflow, listener PWA, sidecar, src/components/SettingsPanel.tsx, any new Tauri commands or capabilities.
</locked_decisions>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: MI-05 — tsconfig.node.json verbatimModuleSyntax inline jsonc comment</name>
  <files>tsconfig.node.json</files>
  <behavior>
    - Documentation-only change (single-line jsonc inline comment).
    - No new test (locked decision MI-05 — JSDoc/comment only).
    - Verify `tsc -b` still parses tsconfig.node.json successfully.
  </behavior>
  <action>
Edit `tsconfig.node.json` line 11. Replace exactly:
```jsonc
    "verbatimModuleSyntax": true,
```
with:
```jsonc
    "verbatimModuleSyntax": true,  // requires `import type` for type-only imports (e.g. UserConfig from vitest/config)
```

Per RESEARCH §6 MI-05 + §5 pitfall #5 (D-MI-05 from CONTEXT). JSON-with-comments is supported by the TypeScript tsconfig parser by default — no schema change needed.

After save, commit:
```bash
git add tsconfig.node.json
git commit -m "fix(quick-260502-epd): MI-05 verbatimModuleSyntax inline note"
```
  </action>
  <verify>
    <automated>npm run build</automated>
  </verify>
  <done>tsconfig.node.json line 11 carries the jsonc breadcrumb. `npm run build` (tsc -b && vite build) exits 0. Commit `fix(quick-260502-epd): MI-05 verbatimModuleSyntax inline note` exists in git log.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: MI-03 — useFocusTrap @remarks JSDoc</name>
  <files>src/lib/useFocusTrap.ts</files>
  <behavior>
    - JSDoc-only change (no code change, no new test) per locked decision MI-03.
    - Existing 8 useFocusTrap tests must still pass unchanged.
    - VS Code IntelliSense renders `@remarks` as a distinct "Remarks" section under the summary (TSDoc spec).
  </behavior>
  <action>
Replace the existing JSDoc block in `src/lib/useFocusTrap.ts` lines 6-14 (the block above `export function useFocusTrap`). Keep the existing prose; APPEND an `@remarks` block before the closing `*/`.

Final block:
```ts
/**
 * Trap Tab/Shift-Tab focus inside `containerRef` while `active` is true.
 * On deactivation (active flips false OR component unmounts), returns focus
 * to the element that had focus when the trap activated.
 *
 * Tiger-Style: descriptive names, no magic strings outside the constant
 * above, single-responsibility (DOES NOT manage open/close state — caller
 * passes `active` derived from feature state).
 *
 * @remarks
 * Focusable elements snapshot at activation. Do NOT mount/unmount focusable
 * children while the trap is active — Tab cycling will use the stale list.
 * Phase 4 trap activates only during `Installing` (no buttons rendered) so
 * this is harmless. If you need dynamic focusables, replace the snapshot
 * with a `MutationObserver` query in the keydown handler.
 */
```

No code below the JSDoc changes. No test changes.

Per RESEARCH §4 + CONTEXT MI-03. TSDoc reference: https://tsdoc.org/pages/tags/remarks/

Commit:
```bash
git add src/lib/useFocusTrap.ts
git commit -m "fix(quick-260502-epd): MI-03 useFocusTrap @remarks JSDoc"
```
  </action>
  <verify>
    <automated>npx vitest run src/lib/useFocusTrap.test.ts</automated>
  </verify>
  <done>JSDoc above `useFocusTrap` contains `@remarks` block. No code change. All 8 existing useFocusTrap tests pass. Commit `fix(quick-260502-epd): MI-03 useFocusTrap @remarks JSDoc` exists.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: MI-04 — delete no-op 'Already skipped' test</name>
  <files>src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx</files>
  <behavior>
    - Pure deletion (no replacement test added — locked decision: defer `buildResultMessage` extraction).
    - Coverage threshold for `src/components/CheckForUpdatesButton/**` (90% per vitest.config.ts:22) MUST still pass after deletion. RESEARCH §5 pitfall #4 reasoning: deleted test contributes 0 covered lines (file was at 93.47% line / 90.47% branch with it; identical without it because test body is `expect(true).toBe(true)`).
    - Remaining 10 tests in the describe block must pass unchanged.
  </behavior>
  <action>
Delete the entire `it("renders inline 'Already skipped' result when checkNow returns and existing state is SilentSkip", ...)` block at `src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx:91-104`. Remove the full `it(...)` call including ALL the apologetic comment lines INSIDE the test body and the closing `});`.

After deletion, the test file should jump from the test ending at line 89 (`expect(screen.getByText(/update available — see banner/i)).toBeInTheDocument();` then `});`) directly to the next test at what was line 106 (`it("logs warning and clears spinner when checkNow throws", ...)`).

Do NOT extract `buildResultMessage` from the component. Do NOT add a replacement test. Per CONTEXT MI-04 + RESEARCH §5 pitfall #9.

Run `npm run test:coverage` to confirm `src/components/CheckForUpdatesButton/**` still ≥90% on all four metrics (lines/functions/branches/statements). If it fails (it should not — verified by RESEARCH math), STOP and report — do NOT lower the threshold (CONTEXT prohibits).

Commit:
```bash
git add src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx
git commit -m "fix(quick-260502-epd): MI-04 delete no-op test"
```
  </action>
  <verify>
    <automated>npm run test:coverage</automated>
  </verify>
  <done>The `it(...)` block at former lines 91-104 is gone. File grep for `expect(true).toBe(true)` returns 0 matches in this file. `npm run test:coverage` exits 0 with `src/components/CheckForUpdatesButton/**` ≥90% on all four metrics. Commit `fix(quick-260502-epd): MI-04 delete no-op test` exists.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: MI-01 + MI-02 — sanitize-notes lib + UpdateToast wiring</name>
  <files>src/lib/sanitize-notes.ts, src/lib/sanitize-notes.test.ts, src/components/UpdateToast/UpdateToast.tsx, src/components/UpdateToast/UpdateToast.test.tsx, vitest.config.ts</files>
  <behavior>
    - **TDD order:** write `src/lib/sanitize-notes.test.ts` FIRST with all 14+ cases asserting against the not-yet-existing module → run `npx vitest run src/lib/sanitize-notes.test.ts` → MUST fail (module missing) → THEN create `src/lib/sanitize-notes.ts` → tests go green.
    - `stripBidiControls(text)` removes only U+202A-U+202E + U+2066-U+2069. Pure. Returns string. No throws.
    - `truncateNotesSafe(text, limit)` returns `text` unchanged if `Array.from(text).length <= limit`; else returns first `limit` codepoints + `…`. Pure. No throws. Codepoint-safe (does NOT split surrogate pairs).
    - `sanitizeReleaseNotes(raw)` = `truncateNotesSafe(stripBidiControls(raw), NOTES_TRUNCATE_LIMIT)`. NOTES_TRUNCATE_LIMIT = 80.
    - `UpdateToast.AvailableContent` calls `sanitizeReleaseNotes(state.notes)` for visible display, calls `stripBidiControls(state.notes)` for sr-only `full` notes (per A2 decision — defense-in-depth symmetry).
    - `UpdateToast.tsx` no longer defines `NOTES_TRUNCATE_LIMIT` constant or `truncateNotes` function (deleted — DRY centralization in sanitize-notes.ts).
    - All 11 existing UpdateToast.test.tsx tests still pass (notes-truncation tests at lines 61-80 work because they use ASCII-only — `sanitizeReleaseNotes("A".repeat(120))` still produces `"A".repeat(80) + "…"`).
    - `vitest.config.ts` thresholds map gains entry: `"src/lib/sanitize-notes.ts": { lines: 100, functions: 100, branches: 100, statements: 100 }`.
    - Coverage gate: 100% on `src/lib/sanitize-notes.ts` after this task.

    **Test cases for sanitize-notes.test.ts (14+ — copy from RESEARCH §3):**

    `describe("stripBidiControls")`:
    1. removes RLO U+202E (Trojan Source vector): `stripBidiControls("v1.0.0‮")` → `"v1.0.0"`
    2. removes all 9 bidi controls in one pass: `stripBidiControls("a‪‫‬‭‮⁦⁧⁨⁩b")` → `"ab"`
    3. preserves regular Unicode: `stripBidiControls("Hello 世界 🚀")` → `"Hello 世界 🚀"` (unchanged)
    4. returns empty for empty input: `stripBidiControls("")` → `""`

    `describe("truncateNotesSafe")`:
    5. returns unchanged when length ≤ limit: `truncateNotesSafe("short", 10)` → `"short"`
    6. returns unchanged when length === limit (no ellipsis): `truncateNotesSafe("abcde", 5)` → `"abcde"`
    7. truncates ASCII over limit + appends ellipsis: `truncateNotesSafe("abcdefghij", 5)` → `"abcde…"`
    8. does NOT split surrogate pair at boundary: `truncateNotesSafe("a😀b", 2)` → `"a😀…"` (NOT `"a\uD83D…"`)
    9. counts emoji as single codepoint: `truncateNotesSafe("🚀🚀🚀🚀🚀", 3)` → `"🚀🚀🚀…"`
    10. preserves multi-line text below limit: `truncateNotesSafe("line1\nline2", 20)` → `"line1\nline2"`
    11. counts newlines as codepoints (truncation respects them): `truncateNotesSafe("a\nb\nc\nd", 3)` → `"a\nb…"`
    12. returns empty for empty input: `truncateNotesSafe("", 10)` → `""`

    `describe("sanitizeReleaseNotes (composition)")`:
    13. strips bidi then truncates: `sanitizeReleaseNotes("v1.0.0‮" + "x".repeat(200))` → does not contain U+202E AND `Array.from(out).length <= NOTES_TRUNCATE_LIMIT + 1` (+1 for ellipsis)
    14. does not append ellipsis when sanitized length ≤ limit: `sanitizeReleaseNotes("short‮")` → `"short"`
    15. handles only-control-char input → empty string, no ellipsis: `sanitizeReleaseNotes("‮‭")` → `""`
    16. exports NOTES_TRUNCATE_LIMIT constant equal to 80: `expect(NOTES_TRUNCATE_LIMIT).toBe(80)`
  </behavior>
  <action>
**Step 1 (RED — write failing test first per TDD):** Create `src/lib/sanitize-notes.test.ts` with the 16 cases above. Imports:
```ts
import { describe, it, expect } from "vitest";
import {
  stripBidiControls,
  truncateNotesSafe,
  sanitizeReleaseNotes,
  NOTES_TRUNCATE_LIMIT,
} from "./sanitize-notes";
```
Run `npx vitest run src/lib/sanitize-notes.test.ts` — MUST fail with "Cannot find module './sanitize-notes'". This is the RED gate.

**Step 2 (GREEN — implement):** Create `src/lib/sanitize-notes.ts` per RESEARCH §3. Full file content:

```ts
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
```

NOTE: regex uses escape sequences `‪-‮⁦-⁩` — keep this form (NOT raw bidi chars in source) so the file is reviewable in editors and grep-friendly.

Run `npx vitest run src/lib/sanitize-notes.test.ts` — MUST pass (16/16).

**Step 3 (Wire into UpdateToast):** Modify `src/components/UpdateToast/UpdateToast.tsx`:

(a) Delete lines 7-14 entirely (the `NOTES_TRUNCATE_LIMIT` constant + `truncateNotes` function).

(b) Add import after line 5 (after `import type { UpdateUiState } from "../../hooks/updateStateMachine";`):
```ts
import { sanitizeReleaseNotes, stripBidiControls } from "../../lib/sanitize-notes";
```

(c) Replace lines 22-23 (`AvailableContent` body opener):

Before:
```tsx
function AvailableContent({ state, onInstall, onLater, onSkip }: AvailableProps) {
  const { display, full, truncated } = truncateNotes(state.notes);
```

After:
```tsx
function AvailableContent({ state, onInstall, onLater, onSkip }: AvailableProps) {
  const display = sanitizeReleaseNotes(state.notes);
  const full = stripBidiControls(state.notes);
  const truncated = display.endsWith("…");
```

The rest of `AvailableContent` (the JSX returning `<div className={styles["toast-content"]}>...</div>`) is UNCHANGED — same `display`, `full`, `truncated` variable names so the JSX needs no edits.

**Step 4 (UpdateToast.test.tsx — verify existing tests still pass; update only if needed):** Run `npx vitest run src/components/UpdateToast/UpdateToast.test.tsx`. The 11 existing tests use ASCII-only notes → `sanitizeReleaseNotes("A".repeat(120))` = `"A".repeat(80) + "…"` exactly matches the test expectation at line 67-70. No edits expected.

If any test fails because of the `display.endsWith("…")` boundary at exactly 80 chars (e.g., test at line 73-80 uses "Short release notes" which is 19 chars ≤ 80 → no ellipsis → truncated=false → no sr-only span — same behavior as before), STOP and re-check. Do NOT loosen tests; the contract is identical.

**Step 5 (vitest.config.ts):** Add a new threshold entry. Replace the `thresholds: { ... }` block. After this edit, the block must contain (in any order):
```ts
        "src/hooks/useUpdateState.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/hooks/updateStateMachine.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/lib/relative-time.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/lib/sanitize-notes.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/components/UpdateToast/**": { lines: 90, functions: 90, branches: 90, statements: 90 },
        "src/components/CheckForUpdatesButton/**": { lines: 90, functions: 90, branches: 90, statements: 90 },
```

**Step 6 (gate + commit):** Run `npm run test:coverage`. Verify all thresholds pass including the new 100% on `src/lib/sanitize-notes.ts`. Run `npm run build` — must exit 0.

```bash
git add src/lib/sanitize-notes.ts src/lib/sanitize-notes.test.ts src/components/UpdateToast/UpdateToast.tsx src/components/UpdateToast/UpdateToast.test.tsx vitest.config.ts
git commit -m "fix(quick-260502-epd): MI-01+MI-02 sanitize-notes lib + UpdateToast wiring"
```

Per CONTEXT MI-01 + MI-02 + A2 decision + RESEARCH §3 + §6.
  </action>
  <verify>
    <automated>npm run test:coverage</automated>
  </verify>
  <done>
- `src/lib/sanitize-notes.ts` exists with all 5 named exports (`stripBidiControls`, `truncateNotesSafe`, `sanitizeReleaseNotes`, `NOTES_TRUNCATE_LIMIT`, `BIDI_CONTROL_CHARS_RE`).
- `src/lib/sanitize-notes.test.ts` has 16 cases, all green.
- `src/components/UpdateToast/UpdateToast.tsx` imports both helpers; `AvailableContent` uses `sanitizeReleaseNotes` for display + `stripBidiControls` for full sr-only; old `NOTES_TRUNCATE_LIMIT` + `truncateNotes` removed.
- `vitest.config.ts` thresholds map includes `src/lib/sanitize-notes.ts: 100%`.
- All 11 UpdateToast tests still pass without edits.
- `npm run test:coverage` exits 0 with all per-file thresholds met (incl. 100% on new sanitize-notes.ts).
- `npm run build` exits 0.
- Commit `fix(quick-260502-epd): MI-01+MI-02 sanitize-notes lib + UpdateToast wiring` exists.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: MA-01 — reducer-local checkCompleted guard + drop updateOffered</name>
  <files>src/hooks/updateStateMachine.ts, src/hooks/updateStateMachine.test.ts, src/hooks/useUpdateState.ts, src/hooks/useUpdateState.test.ts</files>
  <behavior>
    - **TDD order for the regression:** add the new race-window test to `useUpdateState.test.ts` FIRST asserting `state.kind === "UpdateAvailable"` after the simulated mid-`await` event → run `npx vitest run src/hooks/useUpdateState.test.ts` → MUST fail on pre-fix code (closure stale → state flips to UpToDate) → THEN apply reducer + hook fixes → test goes green.
    - `UpdateAction.checkCompleted` shape becomes `{ type: "checkCompleted"; lastCheckUnix: number }` (drop `updateOffered: boolean`).
    - `updateReducer` `case "checkCompleted"` body: three flat early-returns for `state.kind === "UpdateAvailable" | "Downloading" | "Installing"` (preserves state); else returns `{ kind: "UpToDate", checkedAtUnix: action.lastCheckUnix }`. No nested ifs (per CLAUDE.md rule #6).
    - `useUpdateState.checkNow` dispatches `{ type: "checkCompleted", lastCheckUnix: result.last_check_unix }` only — no `updateOffered`.
    - All existing `updateStateMachine.test.ts` tests using `updateOffered: true|false` updated to drop the field. Title at line 54 ("checkCompleted updateOffered=true → unchanged") renamed to reflect reducer-local guard semantics.
    - 3 NEW symmetric guard tests added: `checkCompleted on UpdateAvailable | Downloading | Installing → unchanged` (referential equality via `.toBe(state)`).
    - 2 NEW positive transition tests added: `checkCompleted on UpToDate → UpToDate (refresh timestamp)` and `checkCompleted on SilentSkip → UpToDate (skip cleared by fresh check)`.
    - `useUpdateState.test.ts` test at line 146 ("checkNow dispatches updateOffered=true ...") — body unchanged but rename title to reflect reducer-local guard semantics. Existing test at line 133 ("checkNow invokes update_check_now and sets persisted (Idle path → UpToDate)") body unchanged.
    - 1 NEW MA-01 race-window regression test using deferred-promise + handler-capture pattern from RESEARCH §1.
    - TypeScript compile MUST pass after reducer + action change (compile errors at every old `updateOffered: ...` usage are expected and are the to-fix list).
    - Commit only after all four files build + test green.
  </behavior>
  <action>
**Step 1 (RED — add race-window test first):** Append to `src/hooks/useUpdateState.test.ts` (inside the `describe("useUpdateState", ...)` block, before its closing `});`):

```ts
  it("MA-01 regression: update:available arriving mid-checkNow does NOT overwrite UpdateAvailable", async () => {
    let availableHandler: ((event: { payload: { version: string; notes: string; downloadUrl: string } }) => void) | null = null;
    vi.mocked(listen).mockImplementation(async (eventName: string, handler) => {
      if (eventName === "update:available") availableHandler = handler as typeof availableHandler;
      return () => {};
    });
    let resolveCheck: (value: UpdateState) => void;
    const checkPromise = new Promise<UpdateState>((res) => { resolveCheck = res; });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "update_check_now") return checkPromise;
      return DEFAULT_STATE;
    });

    const { result } = renderHook(() => useUpdateState());
    await waitFor(() => expect(availableHandler).not.toBeNull());

    let checkNowDone: Promise<UpdateState>;
    await act(async () => {
      checkNowDone = result.current.checkNow();
    });

    await act(async () => {
      availableHandler!({ payload: { version: "0.2.0", notes: "n", downloadUrl: "u" } });
    });
    expect(result.current.state.kind).toBe("UpdateAvailable");

    await act(async () => {
      resolveCheck!({ last_check_unix: 1700, last_dismissed_unix: 0, skipped_versions: [] });
      await checkNowDone;
    });

    // Post-fix: reducer-local guard sees state.kind === "UpdateAvailable" → returns state unchanged.
    expect(result.current.state.kind).toBe("UpdateAvailable");
  });
```

Run `npx vitest run src/hooks/useUpdateState.test.ts -t "MA-01 regression"` — MUST fail (pre-fix closure-stale path overwrites with UpToDate).

**Step 2 (GREEN — modify the action union):** In `src/hooks/updateStateMachine.ts` line 13, change:
```ts
  | { type: "checkCompleted"; lastCheckUnix: number; updateOffered: boolean }
```
to:
```ts
  | { type: "checkCompleted"; lastCheckUnix: number }
```

**Step 3 (GREEN — modify the reducer):** Replace `updateStateMachine.ts` lines 43-45:

Before:
```ts
    case "checkCompleted":
      if (action.updateOffered) return state;
      return { kind: "UpToDate", checkedAtUnix: action.lastCheckUnix };
```

After:
```ts
    case "checkCompleted":
      if (state.kind === "UpdateAvailable") return state;
      if (state.kind === "Downloading") return state;
      if (state.kind === "Installing") return state;
      return { kind: "UpToDate", checkedAtUnix: action.lastCheckUnix };
```

**Step 4 (GREEN — modify the hook):** In `src/hooks/useUpdateState.ts` lines 70-79, replace:

Before:
```ts
  const checkNow = async (): Promise<UpdateState> => {
    const result = await invoke<UpdateState>("update_check_now");
    setPersisted(result);
    dispatch({
      type: "checkCompleted",
      lastCheckUnix: result.last_check_unix,
      updateOffered: state.kind === "UpdateAvailable",
    });
    return result;
  };
```

After:
```ts
  const checkNow = async (): Promise<UpdateState> => {
    const result = await invoke<UpdateState>("update_check_now");
    setPersisted(result);
    dispatch({ type: "checkCompleted", lastCheckUnix: result.last_check_unix });
    return result;
  };
```

**Step 5 (GREEN — fix compile errors in tests):** Run `npx tsc -b` — expect failures at every `updateOffered: ...` reference in the test files. Fix:

In `src/hooks/updateStateMachine.test.ts`:

(a) Replace lines 54-57:
```ts
  it("checkCompleted updateOffered=true → unchanged", () => {
    const next = updateReducer(AVAILABLE, { type: "checkCompleted", lastCheckUnix: 1, updateOffered: true });
    expect(next).toBe(AVAILABLE);
  });
```
with the 3 new symmetric guard tests + UpToDate refresh + SilentSkip clear:
```ts
  it("checkCompleted on UpdateAvailable → unchanged (reducer-local guard)", () => {
    const next = updateReducer(AVAILABLE, { type: "checkCompleted", lastCheckUnix: 1700 });
    expect(next).toBe(AVAILABLE);
  });
  it("checkCompleted on Downloading → unchanged (reducer-local guard)", () => {
    const next = updateReducer(DOWNLOADING, { type: "checkCompleted", lastCheckUnix: 1700 });
    expect(next).toBe(DOWNLOADING);
  });
  it("checkCompleted on Installing → unchanged (reducer-local guard)", () => {
    const next = updateReducer(INSTALLING, { type: "checkCompleted", lastCheckUnix: 1700 });
    expect(next).toBe(INSTALLING);
  });
```

(b) Replace lines 58-61:
```ts
  it("checkCompleted updateOffered=false → UpToDate", () => {
    const next = updateReducer(IDLE, { type: "checkCompleted", lastCheckUnix: 1700000000, updateOffered: false });
    expect(next).toEqual({ kind: "UpToDate", checkedAtUnix: 1700000000 });
  });
```
with three positive cases:
```ts
  it("checkCompleted on Idle → UpToDate", () => {
    const next = updateReducer(IDLE, { type: "checkCompleted", lastCheckUnix: 1700000000 });
    expect(next).toEqual({ kind: "UpToDate", checkedAtUnix: 1700000000 });
  });
  it("checkCompleted on UpToDate → UpToDate (refresh timestamp)", () => {
    const next = updateReducer(UPTODATE, { type: "checkCompleted", lastCheckUnix: 1800 });
    expect(next).toEqual({ kind: "UpToDate", checkedAtUnix: 1800 });
  });
  it("checkCompleted on SilentSkip → UpToDate (skip cleared by fresh check)", () => {
    const next = updateReducer(SILENTSKIP, { type: "checkCompleted", lastCheckUnix: 1800 });
    expect(next).toEqual({ kind: "UpToDate", checkedAtUnix: 1800 });
  });
```

In `src/hooks/useUpdateState.test.ts`:

(c) Test at line 146 — rename ONLY the title (body already exercises the reducer-local guard correctly because state was driven to UpdateAvailable via the event handler before checkNow is awaited). Replace:
```ts
  it("checkNow dispatches updateOffered=true when state is already UpdateAvailable (preserves UpdateAvailable)", async () => {
```
with:
```ts
  it("checkNow preserves UpdateAvailable when state is already UpdateAvailable (reducer-local guard)", async () => {
```

The body of this test is unchanged.

(d) Test at line 133 ("checkNow invokes update_check_now and sets persisted (Idle path → UpToDate)") — body unchanged, no `updateOffered` in body.

**Step 6 (Verify):**
```bash
npx tsc -b                          # MUST exit 0
npx vitest run src/hooks            # MUST exit 0 (all reducer + hook tests green incl. new race-window test)
npm run test:coverage               # MUST exit 0 (100% on hooks/lib still met)
npm run build                        # MUST exit 0
```

**Step 7 (Commit):**
```bash
git add src/hooks/updateStateMachine.ts src/hooks/updateStateMachine.test.ts src/hooks/useUpdateState.ts src/hooks/useUpdateState.test.ts
git commit -m "fix(quick-260502-epd): MA-01 reducer-local checkCompleted guard"
```

Per CONTEXT MA-01 + RESEARCH §1 + §6 (file-level fix map for action type, reducer, hook).
  </action>
  <verify>
    <automated>npx vitest run src/hooks &amp;&amp; npm run test:coverage &amp;&amp; npm run build</automated>
  </verify>
  <done>
- `UpdateAction.checkCompleted` no longer has `updateOffered` field.
- Reducer `case "checkCompleted"` early-returns for UpdateAvailable, Downloading, Installing; falls through to UpToDate else.
- `useUpdateState.checkNow` dispatches `{ type: "checkCompleted", lastCheckUnix }` only.
- `updateStateMachine.test.ts` has 3 new symmetric guard tests + Idle/UpToDate/SilentSkip positive tests; no `updateOffered` references remain.
- `useUpdateState.test.ts` has the new MA-01 regression test + renamed line-146 test (body unchanged); no `updateOffered` references.
- `npx tsc -b` exits 0; `npx vitest run src/hooks` exits 0 (all hook + reducer tests pass incl. MA-01 regression); `npm run test:coverage` meets 100% hook/lib thresholds; `npm run build` exits 0.
- Commit `fix(quick-260502-epd): MA-01 reducer-local checkCompleted guard` exists.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 6: MA-02 — dispatchOnSuccess helper + skip-on-failure for install/dismiss/skip</name>
  <files>src/hooks/useUpdateState.ts, src/hooks/useUpdateState.test.ts</files>
  <behavior>
    - **TDD order:** add the 3 IPC-error regression tests to `useUpdateState.test.ts` FIRST → run them → MUST fail (current code has no try/catch, so unhandled rejections propagate or `dismiss`/`skip` dispatch unconditionally) → THEN modify the hook → tests go green.
    - Hook defines a single internal helper `dispatchOnSuccess(commandName, args, action)` inside the hook closure (NOT exported, NOT module-scoped). Reads `dispatch` from closure. Pattern: `try { await invoke(commandName, args); } catch (error) { console.warn(\`${commandName} failed\`, error); return; } dispatch(action);`. No `useCallback` (per RESEARCH §2 — closure cost is sub-microsecond, React 19 compiler handles it).
    - `install` is the EXCEPTION — does NOT use the helper. Inline `try { await invoke<void>("update_install"); } catch (error) { console.warn("update_install failed", error); }`. NO success dispatch (Phase 3 dispatcher emits `update:installed` event → reducer transitions; per TW#1 no Restart button). Comment in source explains why.
    - `dismiss` rewrites to: `await dispatchOnSuccess("update_dismiss", undefined, { type: "dismissed" });`
    - `skip` rewrites to: `await dispatchOnSuccess("update_skip_version", { version }, { type: "skipped", version });`
    - On rejection: state UNCHANGED + `console.warn` called once with `"<commandName> failed"` + Error. Caller does NOT throw (the `await invoke` rejection is caught inside).
    - Existing tests for `install` (line 166), `dismiss` (line 172), `skip` (line 179) still pass — they use the success path and the dispatched action shape is unchanged.
    - Coverage: 100% on `src/hooks/useUpdateState.ts` still met (the helper + 3 catch branches + 1 install catch branch all exercised).
    - **CLAUDE.md compliance:** function ≤ 50 lines (helper is 8 lines), no nested ifs (helper is flat try/catch + return), descriptive name (`dispatchOnSuccess`), DRY (single helper for the 2 callers that share the pattern), SRP (hook owns IPC error handling, components only render).
  </behavior>
  <action>
**Step 1 (RED — add 3 IPC-error regression tests):** Append to `src/hooks/useUpdateState.test.ts` (inside the `describe("useUpdateState", ...)` block, before its closing `});`):

```ts
  it("MA-02 regression: install warns and does NOT dispatch when invoke rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "update_install") throw new Error("ipc closed");
      return DEFAULT_STATE;
    });
    const { result } = renderHook(() => useUpdateState());
    const stateBefore = result.current.state;
    await act(async () => { await result.current.install(); });
    expect(warnSpy).toHaveBeenCalledWith("update_install failed", expect.any(Error));
    expect(result.current.state).toBe(stateBefore);
    warnSpy.mockRestore();
  });

  it("MA-02 regression: dismiss warns and does NOT dispatch when invoke rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "update_dismiss") throw new Error("ipc closed");
      return DEFAULT_STATE;
    });
    const { result } = renderHook(() => useUpdateState());
    const stateBefore = result.current.state;
    await act(async () => { await result.current.dismiss(); });
    expect(warnSpy).toHaveBeenCalledWith("update_dismiss failed", expect.any(Error));
    expect(result.current.state).toBe(stateBefore);
    warnSpy.mockRestore();
  });

  it("MA-02 regression: skip warns and does NOT dispatch when invoke rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "update_skip_version") throw new Error("ipc closed");
      return DEFAULT_STATE;
    });
    const { result } = renderHook(() => useUpdateState());
    const stateBefore = result.current.state;
    await act(async () => { await result.current.skip("0.2.0"); });
    expect(warnSpy).toHaveBeenCalledWith("update_skip_version failed", expect.any(Error));
    expect(result.current.state).toBe(stateBefore);
    warnSpy.mockRestore();
  });
```

Run `npx vitest run src/hooks/useUpdateState.test.ts -t "MA-02 regression"` — MUST fail (pre-fix code: `install` rejects unhandled, `dismiss`/`skip` dispatch even on failure).

**Step 2 (GREEN — modify hook):** In `src/hooks/useUpdateState.ts`, after the second `useEffect` block (the `update_get_state` hydration block ending around line 68) and BEFORE the `const checkNow` declaration, insert the helper:

```ts
  /**
   * Invoke a Tauri command; on success dispatch `action`; on failure warn and
   * skip the dispatch so state stays unchanged (preserves user's chance to
   * retry). Defined inside the hook so it closes over `dispatch`. No
   * useCallback — closure cost is sub-microsecond and React 19 compiler
   * handles call-site memoization. Used by `dismiss` and `skip`. NOT used by
   * `install` because install has no success dispatch (Phase 3 dispatcher
   * emits `update:installed` → reducer transitions; per TW#1 no Restart
   * button).
   */
  async function dispatchOnSuccess(
    commandName: string,
    args: Record<string, unknown> | undefined,
    action: UpdateAction,
  ): Promise<void> {
    try {
      await invoke<void>(commandName, args);
    } catch (error) {
      console.warn(`${commandName} failed`, error);
      return;
    }
    dispatch(action);
  }
```

You will also need to import `UpdateAction` from `./updateStateMachine` — modify line 4. Replace:
```ts
import { updateReducer, type UpdateUiState } from "./updateStateMachine";
```
with:
```ts
import { updateReducer, type UpdateUiState, type UpdateAction } from "./updateStateMachine";
```

Then replace the existing `install` / `dismiss` / `skip` declarations (lines 81-93):

Before:
```ts
  const install = async (): Promise<void> => {
    await invoke<void>("update_install");
  };

  const dismiss = async (): Promise<void> => {
    await invoke<void>("update_dismiss");
    dispatch({ type: "dismissed" });
  };

  const skip = async (version: string): Promise<void> => {
    await invoke<void>("update_skip_version", { version });
    dispatch({ type: "skipped", version });
  };
```

After:
```ts
  const install = async (): Promise<void> => {
    try {
      await invoke<void>("update_install");
    } catch (error) {
      console.warn("update_install failed", error);
    }
    // No dispatch on success — Phase 3 dispatcher emits update:installed
    // → reducer transitions to Installing. Per TW#1 (no Restart button).
  };

  const dismiss = async (): Promise<void> => {
    await dispatchOnSuccess("update_dismiss", undefined, { type: "dismissed" });
  };

  const skip = async (version: string): Promise<void> => {
    await dispatchOnSuccess("update_skip_version", { version }, { type: "skipped", version });
  };
```

**Step 3 (Verify):**
```bash
npx tsc -b                                   # MUST exit 0 (UpdateAction import + helper signature compile)
npx vitest run src/hooks/useUpdateState.test.ts  # MUST exit 0 (16 tests now: 13 original + MA-01 regression + 3 MA-02 regressions)
npm run test:coverage                        # MUST exit 0 (100% on src/hooks/useUpdateState.ts: helper + 3 catch branches all hit)
npm run build                                # MUST exit 0
```

If `npm run test:coverage` flags an uncovered branch, the most likely cause is the `install` catch block — verify the MA-02 install regression test exercises it (it does — `mockImplementation` throws on `update_install`).

**Step 4 (Commit):**
```bash
git add src/hooks/useUpdateState.ts src/hooks/useUpdateState.test.ts
git commit -m "fix(quick-260502-epd): MA-02 dispatchOnSuccess helper + skip-on-failure"
```

Per CONTEXT MA-02 + RESEARCH §2 + §6.
  </action>
  <verify>
    <automated>npx vitest run src/hooks/useUpdateState.test.ts &amp;&amp; npm run test:coverage &amp;&amp; npm run build</automated>
  </verify>
  <done>
- `useUpdateState.ts` defines `dispatchOnSuccess` helper inside the hook closure with try/catch + warn + skip-dispatch pattern.
- `install` has its own inline try/catch + warn (no success dispatch — comment explains why).
- `dismiss` calls `dispatchOnSuccess("update_dismiss", undefined, { type: "dismissed" })`.
- `skip` calls `dispatchOnSuccess("update_skip_version", { version }, { type: "skipped", version })`.
- 3 MA-02 regression tests pass (install/dismiss/skip each warn + leave state unchanged on rejection).
- All 13 pre-existing useUpdateState tests still pass (success paths unchanged).
- `npx tsc -b` exits 0; `npx vitest run src/hooks/useUpdateState.test.ts` exits 0; `npm run test:coverage` meets 100% hook threshold; `npm run build` exits 0.
- Commit `fix(quick-260502-epd): MA-02 dispatchOnSuccess helper + skip-on-failure` exists.
  </done>
</task>

</tasks>

<verification>
After all 6 commits land in order (MI-05 → MI-03 → MI-04 → MI-01+MI-02 → MA-01 → MA-02), run the full gate suite from the repo root:

```bash
npm test                  # vitest run — all suites green
npm run test:coverage     # per-file thresholds met (90% components, 100% hooks/lib + new sanitize-notes.ts)
npm run build             # tsc -b && vite build — both exit 0
git log --oneline -7      # confirm 6 atomic commits in expected order
```

Cross-cutting checks (manual `Grep` from repo root):

1. **MA-01 — no `updateOffered` references anywhere in src/:**
   ```bash
   grep -rn "updateOffered" src/  # MUST return zero matches
   ```

2. **MA-02 — `install` no longer has success dispatch and helper exists:**
   ```bash
   grep -n "dispatchOnSuccess" src/hooks/useUpdateState.ts  # ≥3 matches (definition + dismiss + skip)
   grep -n "console.warn(\"update_install failed\"" src/hooks/useUpdateState.ts  # 1 match
   ```

3. **MI-01+MI-02 — sanitize-notes wired, no orphan truncateNotes in UpdateToast:**
   ```bash
   grep -n "truncateNotes" src/components/UpdateToast/UpdateToast.tsx  # MUST be zero (function deleted)
   grep -n "sanitizeReleaseNotes\\|stripBidiControls" src/components/UpdateToast/UpdateToast.tsx  # 2 matches (import + 2 call sites)
   ```

4. **MI-03 — @remarks present:**
   ```bash
   grep -n "@remarks" src/lib/useFocusTrap.ts  # 1 match
   ```

5. **MI-04 — no-op test deleted:**
   ```bash
   grep -n "expect(true).toBe(true)" src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx  # zero matches
   ```

6. **MI-05 — jsonc breadcrumb present:**
   ```bash
   grep -n "verbatimModuleSyntax.*requires .import type." tsconfig.node.json  # 1 match
   ```

7. **Trip-wire #1 preserved (no Restart button anywhere):**
   ```bash
   grep -rin "restart now" src/  # zero matches in production code (test assertion at UpdateToast.test.tsx counts as preserved)
   ```

8. **src-tauri/* untouched (Phase 3 frozen):**
   ```bash
   git diff --name-only HEAD~6..HEAD -- src-tauri/  # zero output (no files under src-tauri changed across the 6 commits)
   ```

If any check fails, do NOT proceed to summary — re-open the relevant task and fix before declaring complete.
</verification>

<success_criteria>
- All 7 findings (MA-01, MA-02, MI-01, MI-02, MI-03, MI-04, MI-05) addressed per locked CONTEXT.md decisions.
- 6 atomic commits in git log in order: MI-05 → MI-03 → MI-04 → MI-01+MI-02 → MA-01 → MA-02. Each commit message: `fix(quick-260502-epd): <ID> <one-liner>`.
- `npm test` exits 0 (all vitest suites green, including 4 new regression tests: 1 race-window + 3 IPC-error).
- `npm run test:coverage` exits 0 with all per-file thresholds met:
  * `src/hooks/useUpdateState.ts` 100% lines/functions/branches/statements
  * `src/hooks/updateStateMachine.ts` 100%
  * `src/lib/relative-time.ts` 100%
  * `src/lib/sanitize-notes.ts` 100% (new threshold)
  * `src/components/UpdateToast/**` ≥90%
  * `src/components/CheckForUpdatesButton/**` ≥90% (post no-op deletion)
- `npm run build` exits 0 (tsc -b + vite build both clean).
- Zero `updateOffered` references in `src/`.
- Zero `expect(true).toBe(true)` in `src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx`.
- `src-tauri/` zero changes across the 6 commits (Phase 3 contract frozen).
- All 17 truths from 260501-wqg PLAN.md still verifiable (no behavioral regression to toast, button, focus trap, ARIA, persistence, sibling-card placement).
- All 10 Phase 3 trip-wires honored.
</success_criteria>

<output>
After completion, create `.planning/quick/260502-epd-fix-ma-01-stale-closure-race-ma-02-silen/260502-epd-SUMMARY.md` documenting:
- Each of the 6 commits (sha + one-liner)
- Files touched (12 total — 2 new, 10 modified)
- Test counts before/after (vitest run output)
- Coverage report after (per-file thresholds)
- Confirmation that `src-tauri/` unchanged (`git diff --name-only HEAD~6..HEAD -- src-tauri/` empty)
- Confirmation all 10 Phase 3 trip-wires + all 17 260501-wqg truths preserved
</output>
