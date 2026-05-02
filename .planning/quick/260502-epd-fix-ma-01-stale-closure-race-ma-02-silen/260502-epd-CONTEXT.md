---
name: 260502-epd-CONTEXT
description: Locked decisions for review-fix follow-up to 260501-wqg (Phase 4 React UI)
type: quick-context
quick_id: 260502-epd
date: 2026-05-02
status: ready-for-planning
---

# Quick Task 260502-epd: Fix 260501-wqg Review Findings — Context

**Gathered:** 2026-05-02
**Status:** Ready for planning

<domain>
## Task Boundary

Fix all 7 findings from `.planning/quick/260501-wqg-phase-4-auto-updater-react-ui-components/260501-wqg-REVIEW.md` produced by the auto code-review at the end of quick task 260501-wqg (Phase 4 auto-updater React UI). Scope chosen by user: "Fix everything (MAJORs + all 5 MINORs)".

In scope: 2 MAJOR + 5 MINOR fixes in `src/hooks/`, `src/lib/`, `src/components/UpdateToast/`, `src/components/CheckForUpdatesButton/`, `tsconfig.node.json`. Regression tests for race-window + IPC-error paths. DRY: extract reusable note-sanitization to `src/lib/sanitize-notes.ts`. SRP: keep reducer pure, hook owns IO + error-handling.

Out of scope: any logic Phase 5 would touch (CI workflow), src-tauri/* changes (Phase 3 contract is fixed), src/components/SettingsPanel.tsx (sibling-card decision still locked from 260501-wqg).

</domain>

<findings_addressed>
## Findings Source

| ID | Severity | Source | Location |
|----|----------|--------|----------|
| MA-01 | MAJOR | REVIEW.md:56-78 | `src/hooks/useUpdateState.ts:70-79` + `src/hooks/updateStateMachine.ts:43-45` |
| MA-02 | MAJOR | REVIEW.md:80-102 | `src/hooks/useUpdateState.ts:81-93` |
| MI-01 | MINOR | REVIEW.md:106-112 | `src/components/UpdateToast/UpdateToast.tsx:9-14` |
| MI-02 | MINOR | REVIEW.md:114-117 | `src/components/UpdateToast/UpdateToast.tsx:13` |
| MI-03 | MINOR | REVIEW.md:119-124 | `src/lib/useFocusTrap.ts:22-24` |
| MI-04 | MINOR | REVIEW.md:126-132 | `src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx:91-104` |
| MI-05 | MINOR | REVIEW.md:134-137 | `tsconfig.node.json:11` |

</findings_addressed>

<decisions>
## Implementation Decisions

### MA-01 — Stale-closure race in `checkNow`
**Decision:** Drop `updateOffered` field from `checkCompleted` action. Reducer inspects current `state.kind`.
- Reducer change at `updateStateMachine.ts:43-45`:
  ```ts
  case "checkCompleted":
    if (state.kind === "UpdateAvailable") return state;
    if (state.kind === "Downloading") return state;
    if (state.kind === "Installing") return state;
    return { kind: "UpToDate", checkedAtUnix: action.lastCheckUnix };
  ```
- Hook change at `useUpdateState.ts:70-79`: drop `updateOffered: state.kind === "UpdateAvailable"` from dispatched action; pass only `lastCheckUnix`.
- Action type definition: drop `updateOffered: boolean` from `UpdateAction` discriminated union.

**Why:** Reducer-local guard sees latest state at dispatch time; closure-local guard sees state from hook's last render. Race window: event handler dispatches `available` mid-`await invoke()` → reducer flips to `UpdateAvailable` → `checkCompleted` arrives with stale `updateOffered=false` → reducer overwrites `UpdateAvailable` with `UpToDate`. New design closes the race because the reducer holds the source of truth.

**How to apply:** Add regression test asserting interleaved dispatch order (`available` then `checkCompleted` with no `updateOffered` field) preserves `UpdateAvailable`. Also extend `Downloading` and `Installing` to the guard — symmetric protection.

### MA-02 — Silent IPC error swallow in `install` / `dismiss` / `skip`
**Decision:** Wrap each `await invoke()` in try/catch INSIDE the hook. On failure: `console.warn(<command_name>_failed, error)` and SKIP the dispatch. State remains unchanged so user can retry.
- Pattern (DRY): extract a single helper inside the hook `dispatchOnSuccess<T>(command: string, args: object | undefined, action: UpdateAction): Promise<void>` — invokes, on success dispatches action, on failure warns and returns.
- Apply to `install` (no dispatch on success — installer takes over per TW#1; just warn on rejection), `dismiss` (dispatch `dismissed` on success), `skip` (dispatch `skipped` on success).

**Why:** Same try/catch + warn pattern already in `CheckForUpdatesButton.tsx:34-44`. DRY: factor it. SRP: hook owns IPC concerns including error handling; components only render. Skip-dispatch-on-failure preserves user's chance to retry by not transitioning UI prematurely.

**How to apply:** Helper definition inside the hook closure (reads `dispatch`). Tests mock `invoke` to throw; assert no state change + warn called once.

### MI-01 — Strip RTL / bidi control characters from notes (defense-in-depth)
**Decision:** Add `stripBidiControls(text: string): string` in new module `src/lib/sanitize-notes.ts`. Strips: U+202A-U+202E (LRE, RLE, PDF, LRO, RLO) + U+2066-U+2069 (LRI, RLI, FSI, PDI). Optionally also general C0/C1 control chars except `\n` `\t` (notes are plaintext).

**Why:** GitHub release notes are authenticated (only repo owner publishes), low XSS risk. But RTL override could spoof "Version 1.0.0" → "Version 0.0.1" visual order. Defense-in-depth costs nothing.

**How to apply:** Pure function, fully unit-tested (10+ cases). Compose with truncation in same module.

### MI-02 — Surrogate-pair-safe truncation
**Decision:** Replace `notes.slice(0, 80)` with `Array.from(text).slice(0, NOTES_TRUNCATE_LIMIT).join("")`. Adds `…` only when source codepoint count > limit.
- Helper signature: `truncateNotesSafe(text: string, limit: number): string`
- Lives in `src/lib/sanitize-notes.ts` alongside `stripBidiControls`.
- Compose: `composeAndTruncate = (raw) => truncateNotesSafe(stripBidiControls(raw), NOTES_TRUNCATE_LIMIT)` exported as `sanitizeReleaseNotes`.

**Why:** `slice(0, 80)` cuts at UTF-16 code-unit boundary. Surrogate pair at index 79-80 produces lone surrogate → replacement char in render. `Array.from` iterates codepoints (correct for emoji, non-BMP scripts). `Intl.Segmenter` would be grapheme-perfect but adds bundle weight; codepoint-safe is the standard React-app trade-off.

**How to apply:** Update `UpdateToast.tsx` to import + call `sanitizeReleaseNotes(state.notes)`. Drop in-component `truncateNotes`. 14+ test cases for sanitize-notes (ASCII < limit, ASCII at limit, ASCII > limit, surrogate pair at boundary, emoji at boundary, RTL char in middle, RTL at boundary, multi-line, empty string, only-controls, mixed).

### MI-03 — Document `useFocusTrap` snapshot quirk
**Decision:** Add JSDoc `@remarks` block at top of `useFocusTrap.ts`:
```ts
/**
 * @remarks Focusable elements snapshot at activation. Do NOT mount/unmount
 * focusable children while the trap is active — Tab cycling will use the
 * stale list. Phase 4 trap activates only during `Installing` (no buttons
 * rendered) so this is harmless. If you need dynamic focusables, replace
 * the snapshot with a `MutationObserver` query in the keydown handler.
 */
```

**Why:** Documenting known limitations prevents future "bug" reports. Adding a MutationObserver would double the hook's complexity for a constraint that doesn't apply to current callers — not worth it.

**How to apply:** JSDoc only. No code change. No new test.

### MI-04 — Delete no-op test in CheckForUpdatesButton.test.tsx
**Decision:** Delete the "Already skipped" test block at `:91-104`. The skip-result path is already covered indirectly by the integration scenario at `:73-89` ("up-to-date result"). Adding a true unit test for "Already skipped" requires extracting `buildResultMessage(kind: ResultKind): string` from the component into a pure helper — defer that refactor unless the result-message logic grows.

**Why:** No-op tests inflate green-count and hide real coverage gaps. Deleting reveals the gap honestly. Coverage threshold check confirms no regression (CheckForUpdatesButton was at 93.47% line / 90.47% branch before; the no-op test contributes nothing to either).

**How to apply:** Delete the `it("...")` block + its long apologetic comment. Re-run `npm run test:coverage` — must still pass ≥90% threshold.

### MI-05 — `tsconfig.node.json verbatimModuleSyntax` gotcha note
**Decision:** Add a brief inline comment in `tsconfig.node.json` next to `"verbatimModuleSyntax": true`:
```jsonc
"verbatimModuleSyntax": true,  // requires `import type` for type-only imports (e.g. UserConfig from vitest/config)
```

**Why:** `verbatimModuleSyntax` is a low-traffic setting. Without the breadcrumb, a future contributor trying to add a vitest type import will hit a confusing error. JSON-with-comments is allowed (TS supports `tsconfig.json` jsonc parsing).

**How to apply:** Single line edit. No test. Verify `tsc -b` still succeeds.

### Test Strategy
**Decision:** Add regression tests, not just patch tests. Each MAJOR fix gets a test that would FAIL on the pre-fix code:
- MA-01 regression: simulate `update:available` event arriving mid-`await invoke()` — assert state stays `UpdateAvailable` after `checkNow` resolves (use deferred promise + manual resolve).
- MA-02 regression: mock `invoke` to throw on each of `update_install` / `update_dismiss` / `update_skip_version` — assert state unchanged + `console.warn` called.

Sanitize-notes gets full pure-function test suite (14+ cases per MI-01 + MI-02 combined).

Coverage thresholds unchanged (90% components, 100% hooks/lib). After fixes, coverage should stay ≥ pre-fix levels.

</decisions>

<specifics>
## Specific Ideas

- **DRY helper for hook IPC error handling:** Define INSIDE `useUpdateState` closure (reads `dispatch` from useReducer). Don't export — this is a private implementation detail.
- **`sanitize-notes.ts` exports:** `stripBidiControls`, `truncateNotesSafe`, `sanitizeReleaseNotes` (composition). All pure. 100% coverage required (lib tier).
- **Constants:** `BIDI_CONTROL_CHARS_RE = /[‪-‮⁦-⁩]/g`. `NOTES_TRUNCATE_LIMIT = 80` lives in sanitize-notes.ts now (was inlined in UpdateToast).
- **Atomic commits:** one commit per finding (MA-01, MA-02, MI-01+MI-02 combined since same file, MI-03, MI-04, MI-05) = 6 atomic commits. Each commit message: `fix(quick-260502-epd): <ID> <one-liner>`.
- **No new dependencies.** `Array.from` is built-in. RTL strip is regex.

</specifics>

<canonical_refs>
## Canonical References

- 260501-wqg REVIEW.md (source of all 7 findings).
- 260501-wqg PLAN.md must_haves.truths (frontend behavioral contracts that fixes must preserve — TW#4 in particular).
- 260501-wqg CONTEXT.md (still-locked decisions: useReducer no zustand; no Restart button; standalone card placement; etc.).
- src/hooks/useUpdateState.ts (current state; lines 70-93 are the change-target).
- src/hooks/updateStateMachine.ts (current reducer; lines 43-45 are the change-target).
- src/components/UpdateToast/UpdateToast.tsx (current notes truncation; lines 9-14).
- src/lib/useFocusTrap.ts (target for JSDoc).
- src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx (no-op test at lines 91-104).
- tsconfig.node.json (verbatimModuleSyntax line).

</canonical_refs>
