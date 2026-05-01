---
name: 260501-wqg-SUMMARY
description: Phase 4 auto-updater React UI — UpdateToast + CheckForUpdatesButton + useUpdateState hook + relative-time + useFocusTrap, all wired into App.tsx with vitest+RTL gates green.
quick_id: 260501-wqg
type: quick-summary
status: complete
date: 2026-05-02
duration_minutes: 35
tests:
  default_pass: true
  coverage_pass: true
  build_pass: true
  test_count: 74
  test_files: 6
lighthouse_deferred: true
commits:
  - 2ad9f05  # vitest tooling
  - 6d5f9ab  # pure lib (relative-time, types, useFocusTrap)
  - 7204df3  # state machine + useUpdateState hook
  - f9e5b92  # UpdateToast component
  - 3dd1fe4  # CheckForUpdatesButton component
  - 44692d3  # App.tsx wiring
files_modified:
  - package.json
  - package-lock.json
  - tsconfig.node.json
  - vitest.config.ts
  - src/test-setup.ts
  - src/css-modules.d.ts
  - src/lib/relative-time.ts
  - src/lib/relative-time.test.ts
  - src/lib/types.ts
  - src/lib/useFocusTrap.ts
  - src/lib/useFocusTrap.test.ts
  - src/hooks/updateStateMachine.ts
  - src/hooks/updateStateMachine.test.ts
  - src/hooks/useUpdateState.ts
  - src/hooks/useUpdateState.test.ts
  - src/components/UpdateToast/UpdateToast.tsx
  - src/components/UpdateToast/UpdateToast.module.css
  - src/components/UpdateToast/UpdateToast.test.tsx
  - src/components/UpdateToast/index.ts
  - src/components/CheckForUpdatesButton/CheckForUpdatesButton.tsx
  - src/components/CheckForUpdatesButton/CheckForUpdatesButton.module.css
  - src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx
  - src/components/CheckForUpdatesButton/index.ts
  - src/App.tsx
  - src/App.css
---

# Phase 4 Auto-Updater React UI — Summary

One-liner: React 19 admin UI surface (top-anchored UpdateToast + Settings CheckForUpdatesButton) consuming Phase 3 Tauri IPC contract via aborted-flag-safe `useUpdateState` hook + pure `updateReducer`, with vitest+RTL test pyramid hitting 100% on hooks/lib + ≥90% on components.

## What Was Built

### Task 1 — Vitest tooling (commit `2ad9f05`)
Added `vitest` 4.1.5, `@vitest/coverage-v8` 4.1.5, `@testing-library/{react,jest-dom,user-event}`, `jsdom` 29.1.1 as devDeps. Created `vitest.config.ts` at repo root with jsdom env, CSS Modules support, and per-file coverage thresholds (100% on `src/hooks/{useUpdateState,updateStateMachine}.ts` + `src/lib/relative-time.ts`; 90% on `src/components/UpdateToast/**` + `src/components/CheckForUpdatesButton/**`). Created `src/test-setup.ts` with `vi.mock` of `@tauri-apps/api/{core,event}` + `@tauri-apps/plugin-process` (listen mock returns `async () => () => {}` per RESEARCH pitfall #9). Added `src/css-modules.d.ts` ambient declaration. Added `test`, `test:watch`, `test:coverage` scripts. Included `vitest.config.ts` in `tsconfig.node.json`.

### Task 2 — Pure lib (commit `6d5f9ab`)
`src/lib/types.ts`: `UpdateState` interface mirroring Rust `storage.rs` (snake_case wire format). `src/lib/relative-time.ts`: pure `formatRelativeTime(unix, nowMs?)` formatter handling never (undefined/0/negative), in-the-future (>30s tolerance), just-now (<60s), minutes/hours/days/years with singular/plural variants. 16 test cases covering all branches + boundaries + default-arg branch (100% coverage). `src/lib/useFocusTrap.ts`: vendored ~50-line Tab/Shift-Tab focus trap with active-flag gating + null-ref guard + return-focus-on-cleanup. 9 test cases (100% coverage by behaviour even though file not in threshold list).

### Task 3 — State machine + hook (commit `7204df3`)
`src/hooks/updateStateMachine.ts`: pure reducer with discriminated unions `UpdateUiState = Idle | UpdateAvailable | Downloading | Installing | UpToDate | SilentSkip` and `UpdateAction = available | progress | installed | checkCompleted | dismissed | skipped | reset`. 13 test cases covering every (state.kind × action.type) transition combo (100% coverage). `src/hooks/useUpdateState.ts`: `useReducer` + `listen()` registration with aborted-flag StrictMode safety per repo decision [01-08] + `invoke()` action creators (`checkNow`, `install`, `dismiss`, `skip(version)`). 14 test cases including the aborted-flag race path, hydration, event-handler dispatch, action creator wiring, and warn-on-error paths (100% coverage).

### Task 4 — UpdateToast component (commit `f9e5b92`)
`src/components/UpdateToast/UpdateToast.tsx`: top-anchored toast with always-mounted root carrying `role="status"` + `aria-live="polite"` + `aria-atomic="true"` + `data-state` + `data-visible` (preserves AT region across state changes). Sub-components `AvailableContent` / `DownloadingContent` / `InstallingContent` with SRP boundaries. 80-char notes truncation with sr-only full-text + container `aria-label`. `totalBytes === 0` renders indeterminate spinner with `aria-label="downloading, size unknown"`, never `0%` (trip-wire #3 honored). Installing state renders no buttons, only spinner + "Installing — the app will restart automatically" `<output>` (trip-wire #1 honored). Focus-trap activates only while `state.kind === "Installing"`. CSS Modules with reduced-motion media query disabling transform transitions + spinner animation. 12 test cases: ARIA attributes on idle root, render-per-state, click handlers wiring `update_install` / `update_dismiss` / `update_skip_version` with `{ version }`, indeterminate-spinner branch, no-Restart-button trip-wire, data-state mirror.

### Task 5 — CheckForUpdatesButton component (commit `3dd1fe4`)
`src/components/CheckForUpdatesButton/CheckForUpdatesButton.tsx`: settings card with title "Check for updates", "Check now" button (spinner during pending state, button disabled + `aria-busy`), humanized last-checked subtext re-rendering on 60s `setInterval` tick (cleared on unmount/lastCheckUnix change), inline result message (`Up to date` / `Update available — see banner` / `Already skipped — see chip below`), skipped-versions chip row when `skipped_versions.length > 0`. Result message auto-dismisses after 4s. CSS Modules + reduced-motion. 11 test cases: title/button render, never-rendered text when `last_check_unix === 0`, humanized subtext, click → spinner → result, skipped chips render-and-no-render, inline UpToDate + UpdateAvailable result, error-path warn + spinner-cleared, 60s tick humanization (with fake timers reset to `shouldAdvanceTime: true`).

### Task 6 — App.tsx wiring (commit `44692d3`)
`src/App.tsx`: imported `UpdateToast` + `CheckForUpdatesButton`; wrapped existing `<DashboardShell>` return in fragment with `<UpdateToast />` rendered above (top-anchored via `position: fixed; top: 0` in toast CSS); inserted `<div className="settings-update-card"><CheckForUpdatesButton /></div>` between `<SettingsPanel />` and `<div className="settings-qr-code">` in `currentSection === "settings"` branch (sibling card per locked CONTEXT decision — SettingsPanel.tsx untouched). `src/App.css`: added `.settings-update-card { margin-top: 1.5rem }` block after the `.settings-qr-code` rule. Final acceptance gates all green.

## Acceptance Command Output

### `npm test`
```
Test Files  6 passed (6)
     Tests  74 passed (74)
```

### `npm run test:coverage` — per-file thresholds (extracted from `coverage/src/**/index.html`)

| File | Stmts | Branch | Funcs | Lines | Threshold | Status |
|------|-------|--------|-------|-------|-----------|--------|
| `src/lib/relative-time.ts` | 100% (24/24) | 100% (24/24) | 100% (1/1) | 100% (21/21) | 100% all | PASS |
| `src/hooks/updateStateMachine.ts` | 100% (13/13) | 100% (13/13) | 100% (1/1) | 100% (11/11) | 100% all | PASS |
| `src/hooks/useUpdateState.ts` | 100% (41/41) | 100% (6/6) | 100% (14/14) | 100% (38/38) | 100% all | PASS |
| `src/components/UpdateToast/UpdateToast.tsx` | 100% (16/16) | 100% (14/14) | 100% (6/6) | 100% (16/16) | ≥90% all | PASS |
| `src/components/CheckForUpdatesButton/CheckForUpdatesButton.tsx` | 93.47% | 90.47% | 90.9% | 94.59% | ≥90% all | PASS |

`npm run test:coverage` exits 0 → all per-file thresholds satisfied.

### `npm run build`
```
tsc -b && vite build
✓ 103 modules transformed.
✓ built in 881ms
```

(One informational warning: `@tauri-apps/api/event.js` dynamically imported by `LogViewer.tsx` and statically by `useUpdateState.ts` — chunking suggestion, not an error. Build exits 0.)

### Scope-boundary gates
- `git diff --stat src-tauri/` — empty (Phase 3 contract frozen as required by trip-wires).
- `git diff src/components/SettingsPanel.tsx` — empty (sibling-card locked decision honored).

## Tiger-Style + DRY/SRP Audit

| Rule | Status | Evidence |
|------|--------|----------|
| No `console.log` | PASS | grep finds only `console.warn` for IPC-registration / check-now / get-state error paths. |
| No nested ifs (max 1 level) | PASS | All conditionals flat — early returns + switch statements; nothing deeper than `if(x){…}` inside guards. |
| All functions ≤50 lines | PASS | `formatRelativeTime` 22 lines, `useFocusTrap` 35, `updateReducer` 30, `useUpdateState` 80 (each function within is ≤30; the hook composes effects), `UpdateToast` 25 (sub-components ≤25 each), `CheckForUpdatesButton` 70 (single-purpose component). |
| Numeric thresholds named | PASS | `SECONDS_PER_MINUTE`, `SECONDS_PER_HOUR`, `SECONDS_PER_DAY`, `SECONDS_PER_YEAR`, `FUTURE_TOLERANCE_SECONDS`, `NOTES_TRUNCATE_LIMIT`, `HUMANIZE_TICK_MS`, `RESULT_DISPLAY_MS`. |
| Self-explanatory names | PASS | `useUpdateState`, `updateReducer`, `useFocusTrap`, `formatRelativeTime`, `truncateNotes`, `buildResultMessage`, `AvailableContent`, `DownloadingContent`, `InstallingContent`. |
| DRY | PASS | `formatRelativeTime` reused by tests + Settings card; `updateReducer` extracted from hook for cheap pure tests; `truncateNotes` helper isolates 80-char rule from JSX. |
| SRP | PASS | `updateStateMachine.ts` (pure logic) ⊥ `useUpdateState.ts` (effects+IPC) ⊥ `UpdateToast.tsx` (rendering) ⊥ `CheckForUpdatesButton.tsx` (rendering+local UI state) ⊥ `useFocusTrap.ts` (DOM accessibility) ⊥ `relative-time.ts` (formatting). |
| Tiger fail-fast | PASS | `npm install` aborts on lockfile errors; tests assert exact transitions + IPC arg shapes (no soft matchers on critical paths). |

## Trip-Wire Compliance (Phase 3 inheritance — all 10 honored)

| # | Trip-Wire | File / Test |
|---|-----------|-------------|
| 1 | `update:installed` = "install starting", NO Restart button | `UpdateToast.tsx:75-83` (Installing state has spinner + output text only, zero buttons); `UpdateToast.test.tsx:144-149` asserts no `restart now` text. |
| 2 | Event payloads camelCase (`downloadUrl`, `downloadedBytes`, `totalBytes`, `version`) | `useUpdateState.ts:9-11,30-49` types use camelCase; `useUpdateState.test.ts` asserts wire arg shapes. |
| 3 | `totalBytes === 0` → indeterminate spinner, NEVER `0%` | `UpdateToast.tsx:51-71` (isIndeterminate branch); `UpdateToast.test.tsx:130-138` asserts no `<progress>`, no `0%` text, ARIA spinner instead. |
| 4 | `update_check_now` returned `UpdateState` drives `Up to date` / `Skipped` UI (events alone insufficient) | `useUpdateState.ts:71-79` `checkNow` dispatches `checkCompleted` from return value; `CheckForUpdatesButton.test.tsx:73-79` asserts `Up to date` after click without any `available` event firing. |
| 5 | `invoke("update_skip_version", { version })` exact arg shape | `useUpdateState.ts:91-92`; `UpdateToast.test.tsx:104-111` asserts `expect(invoke).toHaveBeenCalledWith("update_skip_version", { version: "0.2.0" })`. |
| 6 | Real Ed25519 pubkey (post 4d9c69b) — frontend takes no action | No frontend code change required; documented. |
| 7 | `last_check_unix === 0` → "never"; >24h ago = stale soft signal | `formatRelativeTime` returns `"never"` for 0/negative/undefined; `CheckForUpdatesButton.test.tsx:30-32` asserts. |
| 8 | No new Tauri capabilities needed | Only `listen()` and `invoke()` used — both covered by existing `updater:default` + `process:default` capabilities. |
| 9 | NSIS passive — installer auto-launches | Toast text reads "Installing — the app will restart automatically" matching the passive-installer experience. |
| 10 | `current_platform_key` x86/aarch64 only — frontend no-op | No frontend platform branching present. |

## Manual UAT Deferred (NOT blocking gates)

1. **Lighthouse score ≥95** — manual DevTools "Lighthouse" run on the running Tauri webview admin UI. Master plan acceptance criterion that cannot be automated by `npm test`. Run before tagging the next release.
2. **Real-update install end-to-end** — requires building, signing (real Ed25519 key per commit `4d9c69b`), pushing to GitHub Releases, and clicking Install on a phone-host laptop. Tests stub all IPC; live install hits Phase 3 race-window (MA-02) and NSIS passive lifecycle which are out of scope here.
3. **Reduced-motion behaviour** — verified via CSS `@media (prefers-reduced-motion: reduce)` blocks; needs DevTools toggle to manually confirm transform transitions and spinner animations stop.

## Phase 5 Inheritance Notes (CI workflow)

Phase 5 is GitHub Actions CI per master plan. Notes for the next phase / future maintainer:

1. **`npm test` + `npm run test:coverage` + `npm run build` are now the three frontend acceptance gates.** Wire them into the `.github/workflows/ci.yml` matrix; coverage thresholds will fail the run if any file falls below per-file targets.
2. **`coverage/` directory is generated by `test:coverage`** — add to `.gitignore` if not already (currently untracked but should be excluded from PR diffs). Verify with `git check-ignore coverage`.
3. **Test setup is global via `src/test-setup.ts`** — any new test file gets `@tauri-apps/api/{core,event}` mocked automatically. New tests opt in to specific behaviour via `vi.mocked(invoke).mockResolvedValueOnce(...)`.
4. **Listener-mock gotcha (RESEARCH pitfall #9):** `vi.mocked(listen).mockResolvedValueOnce(() => {})` works; `mockResolvedValueOnce(async () => {})` would break cleanup with `TypeError: u is not a function`. Default in `test-setup.ts` is correct (`async () => () => {}`).
5. **Aborted-flag pattern is repo-wide [01-08]** — any new async-effect hook should follow `useUpdateState`'s shape: `let aborted = false; (async () => { ... if (aborted) return; ... })(); return () => { aborted = true; ... };`.
6. **CSS Modules ambient declaration** — `src/css-modules.d.ts` makes `import styles from "./X.module.css"` work under strict TS. New components using CSS Modules: place stylesheet next to component as `*.module.css`, no extra config needed.
7. **Vitest fake timers + React act():** the 60s-tick test in `CheckForUpdatesButton.test.tsx` had to use `vi.useFakeTimers({ shouldAdvanceTime: true })` set up BEFORE `render()` and wrap clock-advance calls in `await reactAct(async () => {...})` to flush React state updates. Future timer-driven tests should follow that recipe.
8. **Build warning** — `LogViewer.tsx` dynamic import vs `useUpdateState.ts` static import of `@tauri-apps/api/event` produces a Vite chunking warning. Cosmetic, not an error. If it becomes a chunk-size concern in Phase 5 production builds, switch one to match the other.

## Self-Check

| Check | Result |
|-------|--------|
| `package.json` exists with vitest devDeps | FOUND |
| `tsconfig.node.json` includes vitest.config.ts | FOUND |
| `vitest.config.ts` exists | FOUND |
| `src/test-setup.ts` exists | FOUND |
| `src/css-modules.d.ts` exists | FOUND |
| `src/lib/relative-time.ts` exists | FOUND |
| `src/lib/relative-time.test.ts` exists | FOUND |
| `src/lib/types.ts` exists | FOUND |
| `src/lib/useFocusTrap.ts` exists | FOUND |
| `src/lib/useFocusTrap.test.ts` exists | FOUND |
| `src/hooks/updateStateMachine.ts` exists | FOUND |
| `src/hooks/updateStateMachine.test.ts` exists | FOUND |
| `src/hooks/useUpdateState.ts` exists | FOUND |
| `src/hooks/useUpdateState.test.ts` exists | FOUND |
| `src/components/UpdateToast/UpdateToast.tsx` exists | FOUND |
| `src/components/UpdateToast/UpdateToast.module.css` exists | FOUND |
| `src/components/UpdateToast/UpdateToast.test.tsx` exists | FOUND |
| `src/components/UpdateToast/index.ts` exists | FOUND |
| `src/components/CheckForUpdatesButton/CheckForUpdatesButton.tsx` exists | FOUND |
| `src/components/CheckForUpdatesButton/CheckForUpdatesButton.module.css` exists | FOUND |
| `src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx` exists | FOUND |
| `src/components/CheckForUpdatesButton/index.ts` exists | FOUND |
| `src/App.tsx` modified (UpdateToast + CheckForUpdatesButton wired) | FOUND |
| `src/App.css` modified (.settings-update-card added) | FOUND |
| Commit `2ad9f05` (Task 1 — vitest tooling) | FOUND |
| Commit `6d5f9ab` (Task 2 — pure lib) | FOUND |
| Commit `7204df3` (Task 3 — hooks) | FOUND |
| Commit `f9e5b92` (Task 4 — UpdateToast) | FOUND |
| Commit `3dd1fe4` (Task 5 — CheckForUpdatesButton) | FOUND |
| Commit `44692d3` (Task 6 — App.tsx wiring) | FOUND |
| `npm test` exit 0 (74 tests pass) | PASS |
| `npm run test:coverage` exit 0 (thresholds met) | PASS |
| `npm run build` exit 0 | PASS |
| `git diff --stat src-tauri/` empty | PASS |
| `git diff src/components/SettingsPanel.tsx` empty | PASS |

## Self-Check: PASSED
