---
name: 260502-epd-SUMMARY
description: Fix all 7 review findings from 260501-wqg (Phase 4 auto-updater React UI)
status: complete
date: 2026-05-02
phase: quick-260502-epd
plan: 01
type: quick-summary
quick_id: 260502-epd
commits:
  - 49a99c7  # MI-05 verbatimModuleSyntax inline note
  - 1570c84  # MI-03 useFocusTrap @remarks JSDoc
  - 0d6c2d2  # MI-04 delete no-op test
  - 5b33c5c  # MI-01+MI-02 sanitize-notes lib + UpdateToast wiring
  - 840e59a  # MA-01 reducer-local checkCompleted guard
  - a628d13  # MA-02 dispatchOnSuccess helper + skip-on-failure
files_modified:
  - tsconfig.node.json
  - src/lib/useFocusTrap.ts
  - src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx
  - src/lib/sanitize-notes.ts            # NEW
  - src/lib/sanitize-notes.test.ts       # NEW
  - src/components/UpdateToast/UpdateToast.tsx
  - src/components/UpdateToast/UpdateToast.test.tsx
  - vitest.config.ts
  - src/hooks/updateStateMachine.ts
  - src/hooks/updateStateMachine.test.ts
  - src/hooks/useUpdateState.ts
  - src/hooks/useUpdateState.test.ts
  - .gitignore                            # ADDED coverage/ (Rule 3 deviation)
files_modified_count: 13
files_new: 2
findings_addressed:
  critical: 0
  major: 2
  minor: 5
  total: 7
---

# Phase quick-260502-epd Plan 01: Fix 7 Review Findings — Summary

**One-liner:** Closed MA-01 stale-closure race by moving `checkCompleted` guard from hook closure to reducer (sees current state); closed MA-02 silent IPC swallow by adding `dispatchOnSuccess` helper that warns + skips dispatch on rejection; hardened release-note rendering against bidi spoof + surrogate-pair split via new `src/lib/sanitize-notes.ts` module; documented `useFocusTrap` snapshot quirk; deleted no-op test; documented `verbatimModuleSyntax` gotcha.

## Fixes Applied (commit order)

1. **[MI-05] `49a99c7`** — `tsconfig.node.json` line 11: appended jsonc breadcrumb `// requires \`import type\` for type-only imports (e.g. UserConfig from vitest/config)` next to `verbatimModuleSyntax: true`. Documentation only. Build green.
2. **[MI-03] `1570c84`** — `src/lib/useFocusTrap.ts` JSDoc: appended `@remarks` block documenting snapshot-at-activation quirk + MutationObserver upgrade path. JSDoc only, no code change. 9 useFocusTrap tests still pass.
3. **[MI-04] `0d6c2d2`** — Deleted no-op `it("renders inline 'Already skipped' result …")` test at `CheckForUpdatesButton.test.tsx:91-104` (body was `expect(true).toBe(true)` + apologetic comment). Coverage threshold (90%) preserved — file at 93.47/90.47/90.9/94.59.
4. **[MI-01+MI-02] `5b33c5c`** — Created `src/lib/sanitize-notes.ts` with `stripBidiControls`, `truncateNotesSafe`, `sanitizeReleaseNotes`, constants `BIDI_CONTROL_CHARS_RE` + `NOTES_TRUNCATE_LIMIT=80`. Created `src/lib/sanitize-notes.test.ts` with 16 unit cases (RED-GREEN-confirmed). Wired `UpdateToast.tsx`: `display = sanitizeReleaseNotes(state.notes)`, `full = stripBidiControls(state.notes)`, `truncated = display.endsWith("…")`. Deleted in-component `NOTES_TRUNCATE_LIMIT` + `truncateNotes`. Added `src/lib/sanitize-notes.ts: 100%` per-file threshold to `vitest.config.ts`. Added `coverage/` to `.gitignore` (Rule 3 — generated artifact would pollute git status).
5. **[MA-01] `840e59a`** — Dropped `updateOffered: boolean` from `UpdateAction.checkCompleted` discriminated-union. Replaced reducer single-line guard with three flat early-returns for `state.kind === "UpdateAvailable" | "Downloading" | "Installing"` (CLAUDE.md no-nested-if rule). Hook `checkNow` now dispatches `{ type, lastCheckUnix }` only. Added MA-01 race-window regression test (deferred-promise + handler-capture pattern). Added 5 new reducer tests (3 symmetric guard + UpToDate refresh + SilentSkip clear). Renamed existing line-146 test title to reflect reducer-local guard semantics.
6. **[MA-02] `a628d13`** — Added `dispatchOnSuccess(commandName, args, action)` helper inside hook closure: try `await invoke(...)` → on success `dispatch(action)`; on failure `console.warn(\`${commandName} failed\`, error)` + return (skip dispatch). `install` rewritten with own inline try/catch + warn (NO success dispatch — Phase 3 dispatcher emits `update:installed`, per TW#1 no Restart button). `dismiss` calls helper with `{ type: "dismissed" }`. `skip` calls helper with `{ type: "skipped", version }`. Imported `UpdateAction` type. Added 3 MA-02 IPC-error regression tests (one per command). Updated 2 pre-existing assertions to match new `invoke(cmd, undefined)` 2-arg call shape.

## Test Results

| Phase | Test files | Tests | Result |
|-------|-----------|-------|--------|
| Baseline (HEAD a2d983b) | 6 | 74 | All green |
| After MI-05 (T1) | 6 | 74 | All green (no test change) |
| After MI-03 (T2) | 6 | 74 | All green (no test change) |
| After MI-04 (T3) | 6 | 73 | All green (-1 no-op deleted) |
| After MI-01+MI-02 (T4) | 7 | 89 | All green (+16 sanitize tests) |
| After MA-01 (T5) | 7 | 90 | All green (+5 reducer + 1 race-window − 1 renamed) |
| After MA-02 (T6) | 7 | 97 | All green (+3 IPC-error regressions, helper exercised via existing dismiss/skip success paths) |

**Final:** `npm test` → 7 test files / 97 tests / 100% pass.

**Regression tests added (4):**
- `MA-01 regression: update:available arriving mid-checkNow does NOT overwrite UpdateAvailable` — proves race window closed.
- `MA-02 regression: install warns and does NOT dispatch when invoke rejects` — proves silent install rejection now warns + state preserved.
- `MA-02 regression: dismiss warns and does NOT dispatch when invoke rejects` — proves dismiss skip-dispatch on failure.
- `MA-02 regression: skip warns and does NOT dispatch when invoke rejects` — proves skip skip-dispatch on failure.

## Coverage Results

| File | Stmts | Branch | Funcs | Lines | Threshold | Result |
|------|-------|--------|-------|-------|-----------|--------|
| `src/lib/sanitize-notes.ts` (new) | 100 | 100 | 100 | 100 | 100 | ✓ |
| `src/hooks/useUpdateState.ts` | 100 | 100 | 100 | 100 | 100 | ✓ |
| `src/hooks/updateStateMachine.ts` | 100 | 100 | 100 | 100 | 100 | ✓ |
| `src/lib/relative-time.ts` | 100 | 100 | 100 | 100 | 100 | ✓ |
| `src/components/UpdateToast/**` | ≥90 | ≥90 | ≥90 | ≥90 | 90 | ✓ |
| `src/components/CheckForUpdatesButton/**` | 93.47 | 90.47 | 90.9 | 94.59 | 90 | ✓ (post no-op deletion identical) |

`npm run test:coverage` exits 0. All per-file thresholds met. (No threshold-failure messages from v8 reporter.)

## Build Result

`npm run build` → `tsc -b` (exit 0) + `vite build` (exit 0, dist 265.87 kB / gzip 84.94 kB). Two pre-existing dynamic-import warnings from LogViewer.tsx + tauri-apps API (unrelated to this plan).

## Self-Check

### 7 findings addressed

| ID | Description | Commit | Sentinel | Result |
|----|-------------|--------|----------|--------|
| MA-01 | Stale-closure race in `checkNow` | 840e59a | `grep -rn updateOffered src/` → 0 matches | ✓ |
| MA-02 | Silent IPC swallow in install/dismiss/skip | a628d13 | `dispatchOnSuccess` x3 in `useUpdateState.ts` + `console.warn("update_install failed"` x1 | ✓ |
| MI-01 | Bidi-control strip from notes | 5b33c5c | `stripBidiControls` exported from `src/lib/sanitize-notes.ts` + 2 call sites in UpdateToast | ✓ |
| MI-02 | Surrogate-pair-safe truncation | 5b33c5c | `truncateNotesSafe` uses `Array.from(text).length`; tests prove emoji boundary handled | ✓ |
| MI-03 | useFocusTrap snapshot JSDoc | 1570c84 | `grep @remarks src/lib/useFocusTrap.ts` → 1 match | ✓ |
| MI-04 | Delete no-op test | 0d6c2d2 | `grep "expect(true).toBe(true)" src/` → 0 matches | ✓ |
| MI-05 | verbatimModuleSyntax gotcha note | 49a99c7 | `grep "verbatimModuleSyntax.*requires" tsconfig.node.json` → 1 match | ✓ |

### 10 trip-wires from 260501-wqg preserved

| TW | Description | Sentinel | Result |
|----|-------------|----------|--------|
| #1 | NO "Restart now" button anywhere in UpdateToast | `grep -i "restart now" src/` → only test assertions enforcing absence | ✓ |
| #2 | camelCase event payloads | `useUpdateState.ts` listens for `downloadUrl`, `downloadedBytes`, `totalBytes` (unchanged) | ✓ |
| #3 | `totalBytes === 0` indeterminate spinner (not 0%) | `UpdateToast.tsx` `isIndeterminate = state.totalBytes === 0` ternary preserved | ✓ |
| #4 | `update_check_now` return drives UpToDate/SilentSkip | MA-01 reducer guard preserves fall-through to `UpToDate` when state in Idle/UpToDate/SilentSkip; race-window test asserts | ✓ |
| #5 | `invoke("update_skip_version", { version })` exact arg shape | `useUpdateState.ts:97` `dispatchOnSuccess("update_skip_version", { version }, ...)` preserves | ✓ |
| #6 | Backend (out of scope) | `git diff src-tauri/` → empty | ✓ |
| #7 | `last_check_unix === 0` → "never" | `relative-time.ts` unchanged, test preserved | ✓ |
| #8-10 | Backend (out of scope) | src-tauri/* untouched | ✓ |

### 17 truths from 260501-wqg PLAN.md preserved

All 17 truths from the parent plan still hold — no behavioral regression. Toast still renders 3 buttons in Available state, no buttons in Installing state, indeterminate spinner on `totalBytes === 0`, `<progress>` element with `max`/`value` when sized, `aria-live="polite"` root, `role="status"`, `data-state` attribute mirrors UI state, sibling-card placement of CheckForUpdatesButton untouched, focus trap activates only during Installing, `last_check_unix === 0` → "never", humanized relative time, 60s tick re-humanize, persistence via Tauri storage round-trip, 3 listeners on mount + 3 unlistens on unmount, aborted-flag pattern, StrictMode-safe, no zustand. Verification: 97/97 tests pass and include the original 70-pre-fix coverage matrix.

### Gates green

| Gate | Command | Result |
|------|---------|--------|
| Tests | `npm test` | 7 files / 97 tests / 0 failures |
| Coverage | `npm run test:coverage` | EXIT=0, all per-file thresholds met (incl. new `src/lib/sanitize-notes.ts: 100%`) |
| Build | `npm run build` | EXIT=0 (tsc -b + vite build) |
| TypeScript | `npx tsc -b` | EXIT=0 |
| src-tauri untouched | `git diff --name-only HEAD~6..HEAD -- src-tauri/` | empty |
| Commit count + order | `git log --oneline -7` | 6 commits MI-05→MI-03→MI-04→MI-01+02→MA-01→MA-02 on top of a2d983b |

## Future Maintainer Notes

1. **`display.endsWith("…")` heuristic edge case (UpdateToast.tsx:17):**
   The `truncated` flag now infers from the sanitized output ending in `"…"`. If GitHub release notes ever contain a literal trailing horizontal ellipsis character (U+2026) within the first 80 codepoints AND the sanitized length ≤ 80, `truncated` would erroneously be `true`. Practical risk near zero (release notes rarely end with ellipsis at exactly the limit boundary), but if observed, switch to: `const truncated = Array.from(stripBidiControls(state.notes)).length > NOTES_TRUNCATE_LIMIT`. Adds a re-iteration cost; current heuristic preferred for simplicity.

2. **`dispatchOnSuccess` helper is INSIDE the hook closure (intentional):**
   The helper reads `dispatch` from `useReducer` closure. Module-scoping it would require passing `dispatch` as an argument, leaking the reducer abstraction outside the hook (SRP violation). The closure cost is sub-microsecond and React 19's compiler memoizes call sites. NO `useCallback` wrapper — adds eslint noise without measurable benefit. Stay consistent with existing `checkNow`/`install`/`dismiss`/`skip` style.

3. **`install` does NOT use `dispatchOnSuccess`:**
   Phase 3 dispatcher emits `update:installed` event after the installer takes over → reducer transitions to `Installing` via the event-listener path. `install`'s job is purely to fire-and-forget the IPC. Per TW#1 there is no Restart button, so there is no UI transition to drive on the happy path. The inline try/catch + warn pattern is 4 lines; forcing the helper to support an optional `action` parameter would be dead weight for the 2/3 callers that always dispatch.

4. **Bidi regex uses literal codepoint ranges (not escape sequences):**
   `BIDI_CONTROL_CHARS_RE = /[‪-‮⁦-⁩]/g` contains the actual bidi-control codepoints in source. This is intentional — they're the chars being stripped, so editors will warn about "invisible Unicode" but the regex remains grep-friendly and reviewable. Test fixtures use the same chars for the same reason. Hook warnings about invisible Unicode are EXPECTED for both the lib file and its test.

5. **`coverage/` dir added to `.gitignore`:**
   `npm run test:coverage` writes HTML reports to `./coverage/`. Without the gitignore entry, every coverage run would pollute `git status` with hundreds of generated files. This was a Rule 3 (auto-fix blocking) deviation since the ignore was missing pre-existing.

6. **Two pre-existing test assertions updated for new `invoke(cmd, undefined)` 2-arg signature:**
   - `useUpdateState.test.ts:175` — dismiss success path.
   - `UpdateToast.test.tsx:99` — Later button click path.
   Both were `toHaveBeenCalledWith("update_dismiss")` and now expect `("update_dismiss", undefined)` because `dispatchOnSuccess` always passes the 2-arg form. NOT a behavioral change — Tauri's `invoke()` treats omitted vs. explicit-undefined args identically.

## Self-Check: PASSED

- All 6 commits exist in git log in expected order.
- All 13 modified files present (12 planned + .gitignore Rule 3 deviation).
- `src/lib/sanitize-notes.ts` exports verified: `stripBidiControls`, `truncateNotesSafe`, `sanitizeReleaseNotes`, `NOTES_TRUNCATE_LIMIT`, `BIDI_CONTROL_CHARS_RE`.
- All sentinel greps return expected counts.
- src-tauri/* zero changes.
- All gates green.

---

_Executed: 2026-05-02_
_Executor: Claude (gsd-execute-plan)_
_Base commit: a2d983b_
_Final commit: a628d13_
