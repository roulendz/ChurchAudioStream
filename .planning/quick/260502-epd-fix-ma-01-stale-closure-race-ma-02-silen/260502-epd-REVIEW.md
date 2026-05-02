---
name: 260502-epd-REVIEW
description: Code review for review-fix follow-up to 260501-wqg
type: quick-review
quick_id: 260502-epd
date: 2026-05-02
files_reviewed: 13
files_reviewed_list:
  - .gitignore
  - tsconfig.node.json
  - vitest.config.ts
  - src/lib/sanitize-notes.ts
  - src/lib/sanitize-notes.test.ts
  - src/lib/useFocusTrap.ts
  - src/hooks/updateStateMachine.ts
  - src/hooks/updateStateMachine.test.ts
  - src/hooks/useUpdateState.ts
  - src/hooks/useUpdateState.test.ts
  - src/components/UpdateToast/UpdateToast.tsx
  - src/components/UpdateToast/UpdateToast.test.tsx
  - src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx
findings:
  critical: 0
  major: 0
  minor: 2
  total: 2
status: PASS
---

# Code Review: 260502-epd

## Summary
- Files reviewed: 13
- Critical: 0
- Major: 0
- Minor: 2
- Verdict: **PASS** — both Major fixes correct, regression tests load-bearing (would fail on pre-fix code), no trip-wire violations, no security regressions, all 5 Minor closures verified. Two cosmetic Minor items noted as future polish; do not block merge.

## Critical
None.

## Major
None.

## Minor

### MI-A — `display.endsWith("…")` heuristic mis-flags release notes that naturally end with U+2026
**File:** `src/components/UpdateToast/UpdateToast.tsx:17`

```ts
const truncated = display.endsWith("…");
```

If GitHub release body ends with literal U+2026 horizontal-ellipsis AND sanitized length ≤ 80 codepoints, `truncated` becomes `true` despite no truncation. Effect: `aria-label={full}` set + `<span sr-only>{full}</span>` rendered → screen reader hears notes twice. Visual UI unaffected. Same defect triggers when bidi-strip shortens a `…`-suffixed note below the limit (e.g., `"v1.0 fixes…‮"`).

Already documented in `260502-epd-SUMMARY.md` future-maintainer note 1. Practical risk near zero (release notes rarely end at exactly the boundary with `…`).

**Fix (when ready):**
```ts
const truncated = Array.from(stripBidiControls(state.notes)).length > NOTES_TRUNCATE_LIMIT;
```
Adds one re-iteration. Eliminates ambiguity. Re-export `NOTES_TRUNCATE_LIMIT` already imported via `sanitize-notes`.

### MI-B — `dispatchOnSuccess` widens `commandName` to bare `string` (loses literal narrowing)
**File:** `src/hooks/useUpdateState.ts:80-92`

```ts
async function dispatchOnSuccess(
  commandName: string,
  args: Record<string, unknown> | undefined,
  action: UpdateAction,
): Promise<void>
```

Three call-sites pass literals `"update_dismiss"` / `"update_skip_version"`. A typo at the call-site (`"update_dimiss"`) compiles fine and only fails at runtime via Tauri "command not found" → `console.warn(...)` swallows. Same risk pre-fix for the bare-`invoke` path; helper extraction did not regress, but did not capture the opportunity to tighten.

**Fix (optional, when adding more commands):** define `type UpdateCommand = "update_dismiss" | "update_skip_version" | "update_install" | "update_check_now" | "update_get_state"` in `lib/types.ts`, narrow `commandName: UpdateCommand`. Compile-time typo guard. Defer to next refactor.

## Fix-effectiveness check (per finding from 260501-wqg)

| ID    | Original Bug                              | Fix Applied                                                                            | Bug Actually Fixed? | Test Verifies?                                                          |
|-------|-------------------------------------------|----------------------------------------------------------------------------------------|---------------------|-------------------------------------------------------------------------|
| MA-01 | Stale-closure race in `checkNow`          | Dropped `updateOffered` field; reducer reads current `state.kind` for 3 guards         | **Y**               | **Y** — `useUpdateState.test.ts:205-238` deferred-promise + handler-capture; would FAIL pre-fix (closure had `state.kind="Idle"` → reducer flipped to UpToDate) |
| MA-02 | Silent IPC swallow in install/dismiss/skip | `dispatchOnSuccess` helper try/catch + warn + skip-dispatch; install inline equivalent | **Y**               | **Y** — 3 tests at `useUpdateState.test.ts:240-280` mock invoke to throw, assert `warnSpy` called with exact `"<cmd> failed"` message + state unchanged. Pre-fix had no `console.warn` → warn assertion would FAIL |
| MI-01 | Bidi controls not stripped from notes      | `stripBidiControls` + `BIDI_CONTROL_CHARS_RE` in `sanitize-notes.ts`                   | **Y**               | **Y** — 4 tests in `sanitize-notes.test.ts:9-23` cover RLO Trojan-Source vector, all 9 bidi controls, non-bidi preservation, empty input |
| MI-02 | Surrogate-pair break at truncation         | `truncateNotesSafe` uses `Array.from(text)` codepoint iteration                        | **Y**               | **Y** — `sanitize-notes.test.ts:35-42` proves `"a😀b"` truncates to `"a😀…"` not lone surrogate |
| MI-03 | useFocusTrap snapshot quirk undocumented   | `@remarks` block added to JSDoc                                                        | **Y**               | N/A (documentation)                                                     |
| MI-04 | No-op `expect(true).toBe(true)` test       | Test deleted                                                                            | **Y**               | N/A (deletion); grep confirms 0 matches in `src/`                       |
| MI-05 | `verbatimModuleSyntax` gotcha undocumented | Inline jsonc breadcrumb at `tsconfig.node.json:11`                                     | **Y**               | N/A (documentation)                                                     |

## Regression-test load-bearing check

**MA-01 timeline trace** (`useUpdateState.test.ts:205-238`):
1. Mock `invoke("update_check_now")` → returns `checkPromise` (deferred, pending).
2. Capture `available` listener handler reference.
3. `result.current.checkNow()` invoked, await suspends. Hook closure captured `state.kind === "Idle"`.
4. Fire `update:available` event handler → reducer: `{ kind: "UpdateAvailable", ... }`.
5. Resolve `checkPromise` → `dispatch({ type: "checkCompleted", lastCheckUnix: 1700 })`.
6. Assert `state.kind === "UpdateAvailable"`.

**Pre-fix behavior:** action carried `updateOffered: state.kind === "UpdateAvailable"` from CLOSURE. Closure saw `Idle` → `updateOffered=false`. Reducer: `if (action.updateOffered) return state; return UpToDate`. Test would assert `"UpdateAvailable"` against `"UpToDate"` → **FAIL**. Real bug exposure.

**Post-fix behavior:** action carries only `lastCheckUnix`. Reducer reads CURRENT `state.kind === "UpdateAvailable"` → returns state unchanged → test PASSES.

Verdict: regression test is genuinely load-bearing. Not a false-positive.

**MA-02 timeline trace** (3 tests, identical pattern per command):
1. Mock `invoke(cmd)` → throws Error.
2. Spy `console.warn`.
3. Capture `state` before action.
4. Call `result.current.<install|dismiss|skip>(...)`.
5. Assert `warnSpy.toHaveBeenCalledWith("<cmd> failed", any(Error))` AND state identity unchanged.

**Pre-fix behavior:** no try/catch; `await invoke(...)` rejects, dispatch never reached. State unchanged (passes that assertion accidentally) BUT `console.warn` never called with that message → **FAIL** on warn assertion.

Verdict: warn assertion is the load-bearing assertion. Real regression coverage.

## Trip-wire check (10 from 260501-wqg)

| TW   | Description                                                  | Sentinel                                                                                          | Result |
|------|--------------------------------------------------------------|---------------------------------------------------------------------------------------------------|--------|
| #1   | NO "Restart now" button in UpdateToast                       | `grep -i "restart now" src/` → only 2 test-assertion lines enforcing absence                     | **PASS** |
| #2   | Event payloads camelCase (downloadUrl/downloadedBytes/totalBytes) | `useUpdateState.ts:34-43` reads `downloadUrl`, `downloadedBytes`, `totalBytes` (unchanged)        | **PASS** |
| #3   | `totalBytes === 0` → indeterminate spinner, never 0%         | `UpdateToast.tsx:44` `isIndeterminate = state.totalBytes === 0` ternary preserved                 | **PASS** |
| #4   | `update_check_now` return drives UpToDate UI                 | `useUpdateState.ts:97` dispatches `checkCompleted`; reducer fall-through to `UpToDate` for Idle/UpToDate/SilentSkip; `useUpdateState.test.ts:133-144` "Idle path → UpToDate" passes | **PASS** |
| #5   | `update_skip_version` arg shape `{ version }`                | `useUpdateState.ts:116` `dispatchOnSuccess("update_skip_version", { version }, ...)`              | **PASS** |
| #6   | Backend (out of scope)                                       | `git diff src-tauri/` empty per SUMMARY                                                          | **PASS** |
| #7   | `last_check_unix === 0` → "never"                            | `relative-time.ts` untouched                                                                      | **PASS** |
| #8-10| Backend (out of scope)                                       | src-tauri/* untouched                                                                             | **PASS** |

## 17 truths from 260501-wqg PLAN.md (spot-check)

- 3 buttons in UpdateAvailable state — `UpdateToast.tsx:25-35` Install + Later + Skip. **PASS**
- 0 buttons in Installing state — `InstallingContent` no `<button>`. **PASS**
- Indeterminate spinner on `totalBytes === 0` — `UpdateToast.tsx:48-54`. **PASS**
- `<progress>` with `max`/`value` — `UpdateToast.tsx:56-62`. **PASS**
- `aria-live="polite"` root — `UpdateToast.tsx:92`. **PASS**
- `role="status"` on root — `UpdateToast.tsx:91`. **PASS**
- `data-state` mirrors `state.kind` — `UpdateToast.tsx:95`. **PASS**
- Focus trap activates only during Installing — `UpdateToast.tsx:84` `trapActive = state.kind === "Installing"`. **PASS**
- 3 listeners + 3 unlistens — `useUpdateState.ts:31-53` + `:60`. **PASS**
- Aborted-flag pattern — `useUpdateState.ts:27,49-52,59`. **PASS**
- StrictMode-safe — aborted-flag handles double-mount; test at `useUpdateState.test.ts:44-64` proves. **PASS**
- No zustand — only `useReducer` + `useState`. **PASS**

## DRY / SRP / Tiger-Style audit

**DRY:** `dispatchOnSuccess` consolidates 2 of 3 IPC dispatch sites (dismiss + skip). Install intentionally inline (no success dispatch — TW#1). Justified single-call deviation documented in summary note 3.

**SRP:**
- `sanitize-notes.ts` exports exactly 3 functions + 2 constants. Pure, no IO. **PASS**
- `updateStateMachine.ts` reducer pure, no IO, no React. **PASS**
- `useUpdateState.ts` hook composes IO (invoke + listen) with reducer; `dispatchOnSuccess` correctly scoped inside closure (reads `dispatch`). **PASS**

**Tiger-Style / fail-fast:**
- Reducer guards exhaustive (compile-time `noFallthroughCasesInSwitch`). **PASS**
- No silent state corruption: 3 explicit early-returns better than nested condition. **PASS**
- Test count went 74 → 97 (+23 tests, –1 deleted). Behavior coverage strengthened. **PASS**

**No nested if-in-if-in-if:** reducer `checkCompleted` uses 3 flat `if` early-returns per CLAUDE.md rule. **PASS**

**Function lengths (≤50 lines):**
- `sanitize-notes.ts` longest: `truncateNotesSafe` 5 lines. **PASS**
- `updateReducer` 33 lines. **PASS**
- `useUpdateState` hook body 102 lines (composite of nested helpers; each helper ≤14 lines). Acceptable — hook orchestration pattern, not single-function logic.
- `UpdateToast` `AvailableContent` 25 lines, `DownloadingContent` 22 lines, `InstallingContent` 8 lines, `UpdateToast` 23 lines. **PASS**

**Magic numbers named:** `NOTES_TRUNCATE_LIMIT=80`, `BIDI_CONTROL_CHARS_RE`, `HUMANIZE_TICK_MS=60_000`, `RESULT_DISPLAY_MS=4_000`. **PASS**

## Test quality audit

**sanitize-notes.test.ts (16 cases):**
- Boundaries: codepoint (5/3/2 emoji), surrogate-pair-at-boundary, RTL-at-boundary, empty, only-controls, multi-line. **All present.**
- Composition: bidi-then-truncate, no-ellipsis-when-shrunk-below-limit, only-controls→empty, exported constant assertion. **All present.**
- Coverage threshold 100% per `vitest.config.ts:21` enforces no untested branch.

**Regression false-positive check:** verified above (MA-01 + MA-02 timelines). Both load-bearing.

**Flakiness:** no `setTimeout` wall-clock waits in regression tests. `useUpdateState.test.ts:44-64` aborted-flag test uses controlled delays (50/30/20ms) inside mocked `listen` resolution + `waitFor` with timeout 500ms — bounded, not flaky. **PASS**

## Security audit

- `BIDI_CONTROL_CHARS_RE = /[‪-‮⁦-⁩]/g` — character class, no alternation, no quantifiers, no nested groups. O(n) single-pass. **No catastrophic backtracking.** **PASS**
- React text-node rendering of `display` (sanitized) and `full` (bidi-stripped) — JSX auto-escapes. **No XSS surface.** **PASS**
- No `dangerouslySetInnerHTML`, no `eval`, no `innerHTML` introduced. **PASS**
- No untrusted-string interpolation in template literals reaching DOM. **PASS**
- `console.warn` messages use literal command names (compile-time strings) + Error object. No format-string injection. **PASS**

## Strengths

- **Reducer-local guards (MA-01 fix)** are textbook fix for stale-closure-vs-async-IO. Three flat early-returns per CLAUDE.md no-nested-if rule.
- **`dispatchOnSuccess` (MA-02 fix)** is correctly scoped inside hook closure — would have leaked reducer abstraction if module-scoped. Decision documented in summary note 2.
- **Regression tests genuinely load-bearing.** Both MA-01 race-window test (deferred-promise + handler-capture) and MA-02 IPC-error tests (warnSpy assertion) would FAIL on pre-fix code. No fake-test theater.
- **`sanitize-notes.ts`** has clean public surface (3 functions + 2 constants), pure, 100% coverage threshold enforced. Codepoint-safe truncation correctly implemented via `Array.from`.
- **Bidi-control regex uses literal codepoints** in source (per future-maintainer note 4) — grep-friendly + reviewable, despite editor "invisible Unicode" warnings. Test fixtures consistent.
- **`coverage/` added to `.gitignore`** (Rule 3 deviation acknowledged) — prevents pollution of `git status` from `npm run test:coverage` HTML output.
- **`tsconfig.node.json` jsonc inline note** documents `verbatimModuleSyntax: true` constraint at the exact line — future contributor adding type imports gets immediate context.
- **`useFocusTrap` `@remarks`** documents snapshot-at-activation quirk + MutationObserver upgrade path — acceptable Phase-4 behavior with explicit constraint statement.
- **MI-04 deletion** preserved coverage (93.47/90.47/90.9/94.59 — all ≥90 threshold). Test count went down by 1 but quality went up (false-positive test removed).
- **Six commits in clean order** (MI-05 → MI-03 → MI-04 → MI-01+02 → MA-01 → MA-02), each with single concern. Follows SRP at the commit level.

---

_Reviewed: 2026-05-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
