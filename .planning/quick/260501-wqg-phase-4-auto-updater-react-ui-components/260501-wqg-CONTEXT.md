---
name: 260501-wqg-CONTEXT
description: Locked decisions for Phase 4 auto-updater React UI before planning
type: quick-context
quick_id: 260501-wqg
date: 2026-05-01
status: ready-for-planning
---

# Quick Task 260501-wqg: Phase 4 Auto-Updater React UI — Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Task Boundary

Phase 4 of `.planning/plans/auto-updater-plan.md` (lines 395-465). Deliver
React 19 UI surface that consumes the Phase 3 Tauri IPC contract:

- `<UpdateToast />` — top-anchored toast banner (idle / available / downloading / installing)
- `<CheckForUpdatesButton />` — button + last-checked subtext for Settings section
- `useUpdateState` hook — listens to `update:*` events, exposes typed state, reducer-driven
- `relative-time.ts` — pure unix-ts → "2 hours ago" formatter
- Wire both components into `src/App.tsx` (toast top-anchored, button in `currentSection === "settings"` branch)
- Vitest + React Testing Library tests (90% line coverage on components, 100% on hooks/lib)

In scope: components, hooks, lib, tests, App.tsx wiring, vitest devDeps + config.
Out of scope: src-tauri/* (Phase 3 contract is fixed), Phase 5 CI workflow, listener PWA.

</domain>

<phase_3_inheritance>
## Phase 3 Trip-Wires (Phase 4 MUST honor all 10)

Source: `.planning/quick/260501-uon-phase-3-auto-updater-tauri-plugin-wiring/260501-uon-SUMMARY.md` §"Phase 4 Inheritance Trip-Wires"

1. `update:installed` event = "install starting", NOT "install complete". Windows process exits before any post-await emit. UI: indeterminate spinner + "Installing — app will restart automatically". No "Restart now" button.
2. Event payloads are camelCase: `{ version, notes, downloadUrl }`, `{ downloadedBytes, totalBytes }`, `{ version }`.
3. `totalBytes: 0` → indeterminate spinner (size unknown), NEVER render `0%`.
4. `update_check_now` does NOT emit events for `SilentSkip` / `NoUpdate` — frontend reads returned `UpdateState` and renders inline result message ("Up to date", "Already skipped").
5. `update_install` re-fetches manifest (race-window deferred MA-02). No frontend mitigation in this phase.
6. Pubkey is REAL (post Phase 3 fix-commit `4d9c69b`). Frontend takes no action.
7. Bg loop swallows transient errors; frontend can detect stale by inspecting `last_check_unix` on `UpdateState` (>24h = stale soft signal — surface as "Last checked: never" or grey-text).
8. Capabilities `updater:default` + `process:default` already exposed. Frontend uses `@tauri-apps/plugin-updater` events via `listen()` from `@tauri-apps/api/event` — no extra capability changes needed.
9. NSIS `installMode: "passive"` — installer briefly visible. Toast can read "Installer launching — app will restart" right when `update:installed` fires.
10. `current_platform_key()` x86_64 + aarch64 only. Frontend takes no action; if user is on unsupported triple, bg loop simply never offers an update.

</phase_3_inheritance>

<decisions>
## Implementation Decisions

### State Management Shape
**Decision:** `useReducer` inside a custom `useUpdateState` hook.
- Single reducer with discriminated-union actions: `available | progress | installed | check_completed | dismissed | skipped | reset`.
- State machine: `Idle | UpdateAvailable | Downloading | Installing | UpToDate | SilentSkip`.
- No external store (zustand etc.) — one feature, one hook, no cross-tree consumers.
- Hook returns `{ state, dispatch, lastCheckUnix, skippedVersions }` plus action creators that wrap Tauri `invoke()` calls.

**Why:** React 19 idiomatic, easy unit-test (reducer is a pure function), no new deps. Only the App.tsx component consumes the state — no need for a global store.

**How to apply:** Planner uses `useReducer<Reducer<UpdateUiState, UpdateAction>>`. Tests cover reducer transitions (pure) + listener registration/cleanup (effect).

### "Later" Dismissal Semantics
**Decision:** Calls `invoke("update_dismiss")` (existing Phase 3 command). Toast hides until either next app launch OR next bg-loop check ≥24h later.
- Bg loop already enforces 24h debounce via `last_dismissed_unix`.
- No frontend-side timer needed — backend is the source of truth.

**Why:** VS Code / Slack / Discord pattern — "snooze until tomorrow". Reuses Phase 3 contract instead of duplicating debounce logic in JS.

**How to apply:** "Later" button → `invoke("update_dismiss")` → reducer dispatches `dismissed` → toast slide-up animates out. Reducer transitions `UpdateAvailable | Downloading -> Idle`.

### "Skip this version" UX
**Decision:** One-click skip + inline toast feedback "Skipped — you won't be reminded about v{version}". No confirmation modal.
- Calls `invoke("update_skip_version", { version })`.
- Reducer dispatches `skipped` with the version string; toast slide-up animates out.
- Skipped versions appear as small grey-text in `<CheckForUpdatesButton />` subtext: "Last checked: 2 hours ago · Skipped: v0.1.5".

**Why:** Linear / Slack one-click pattern. Confirmation modals add friction for an action the user already chose deliberately by clicking "Skip". The skip is silently reversible because any newer version triggers a fresh prompt.

**How to apply:** "Skip" button → confirm: false → invoke → dispatch → render skipped versions chip in Settings.

### `<CheckForUpdatesButton />` Placement
**Decision:** Standalone card placed in `currentSection === "settings"` branch of `App.tsx`, BELOW `<SettingsPanel />` and ABOVE `<QrCodeDisplay />`. New className: `settings-update-card`.
- NOT inside `SettingsPanel.tsx` (which is a config-form component with save/restart lifecycle).
- Mirrors existing pattern: `settings-qr-code` and `settings-log-viewer` are sibling divs around `SettingsPanel`.

**Why:** SettingsPanel is form-driven (port, interface, domain, mDNS) with `idle/saving/restarting/saved/error` states. Embedding an action-button with its own async lifecycle would violate SRP and confuse the form's save semantics.

**How to apply:** Edit `src/App.tsx` `currentSection === "settings"` JSX block, insert `<div className="settings-update-card"><CheckForUpdatesButton /></div>` after `<SettingsPanel />`.

### Install Terminal State (post `update:installed` event)
**Decision:** Indeterminate spinner + text "Installing — the app will restart automatically".
- NO "Restart now" button (it would be a dead control on Windows per trip-wire #1).
- Toast stays visible (not dismissable) until process exits.
- ARIA live region announces "Update installing".

**Why:** Per trip-wire #1, Windows `std::process::exit(0)` runs before any "install complete" event could fire. NSIS `installMode: "passive"` (trip-wire #9) auto-launches the installer UI. A "Restart" button would be a click-to-nowhere because the OS is about to take over.

**How to apply:** State `Installing` renders no buttons, only `<output role="status" aria-live="polite">Installing — the app will restart automatically</output>` + indeterminate progress spinner.

### Coverage Tooling
**Decision:** Vitest with `@vitest/coverage-v8` provider, `jsdom` environment.
- Configure in `vitest.config.ts` at repo root.
- Coverage threshold: 90% lines on `src/components/UpdateToast/**`, `src/components/CheckForUpdatesButton/**`; 100% on `src/hooks/useUpdateState.ts` and `src/lib/relative-time.ts`.
- Add devDeps: `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`.
- New `npm test` script: `vitest run` (CI default); `npm run test:watch`: `vitest`.

**Why:** Master plan acceptance requires `npm test` green. Sidecar already uses vitest so the team knows the tool. v8 coverage is faster than istanbul.

**How to apply:** Plan tasks include "add devDeps + write `vitest.config.ts` + add test scripts to root `package.json`".

### Theme + Design Tokens
**Decision:** Use existing CSS variables from `src/App.css` and the `frontend-design` skill's distinctive style guide. Green accent `#16a34a` (per master plan). Component CSS via `*.module.css` files (CSS Modules).
- Vite has CSS Modules support out-of-the-box; no extra config.
- Toast slide-down/slide-up via CSS transform + transition (no animation libs).
- Focus-trap during install state implemented manually with a `useFocusTrap` ref-effect (no external `focus-trap-react` lib — too heavy for one component).

**Why:** Constraint :423 says "no external UI libs unless already in package.json". CSS Modules avoid global selector collisions with existing `App.css` styles.

**How to apply:** Each component gets `Component.module.css`. Reset `--update-accent: #16a34a` as the only theme override.

### Test Strategy Per Surface
**Decision:**
- `relative-time.test.ts`: 14+ pure-function cases (just-now <60s, seconds, minute boundary, minutes, hour boundary, hours, day boundary, days, future ts → "in the future" or "just now", year boundary, negative ts → "never", `0` → "never", undefined → "never").
- `useUpdateState.test.ts`: 100% reducer transitions (one test per action × state combo) + listener registration/cleanup (mock `@tauri-apps/api/event`).
- `UpdateToast.test.tsx`: render-tests for each state (`Idle/UpdateAvailable/Downloading/Installing/UpToDate`), button click handlers, ARIA `role="status"` / `role="alert"`, focus-trap during Installing.
- `CheckForUpdatesButton.test.tsx`: click → spinner → result message, "Skipped versions" chip rendering, last-checked humanization.

**Why:** 90% / 100% coverage targets per master plan :540. Pure-function tests are cheap; reducer tests pin the state machine; render tests guard the trip-wire-driven UX rules.

**How to apply:** Each test file colocated with its source. Mocks for `@tauri-apps/api/core` (invoke) and `@tauri-apps/api/event` (listen) defined once in `src/test-setup.ts`.

</decisions>

<specifics>
## Specific Ideas

- **Toast animation:** `transform: translateY(-100%)` → `translateY(0)`, 240ms ease-out enter, 180ms ease-in exit. Reduced-motion: instant via `@media (prefers-reduced-motion: reduce)`.
- **Progress bar:** When `totalBytes > 0` → determinate `<progress max={totalBytes} value={downloadedBytes} />`; when `totalBytes === 0` → indeterminate CSS spinner.
- **Notes truncation:** First 80 chars per master plan :406. If truncated, append `…` and provide aria-label with full notes for screen readers.
- **Last checked humanization:** `useMemo` + `useEffect` updating every 60s via `setInterval`, cleared on unmount. Avoids re-rendering whole tree.
- **Focus trap:** `useFocusTrap(active: boolean, containerRef)` — vendored simple implementation. Listens for Tab/Shift-Tab keydowns, cycles focus inside container, returns focus to opener on deactivate.
- **Tests use `vi.mock`** for `@tauri-apps/api/core` and `@tauri-apps/api/event` to avoid running Tauri runtime in jsdom.

</specifics>

<canonical_refs>
## Canonical References

- Master plan: `.planning/plans/auto-updater-plan.md:395-465` (Phase 4) + `:510-552` (cross-cutting Tiger-Style + coverage).
- Phase 3 SUMMARY: `.planning/quick/260501-uon-phase-3-auto-updater-tauri-plugin-wiring/260501-uon-SUMMARY.md` §"Phase 4 Inheritance Trip-Wires" + §"IPC contract".
- Phase 3 commands.rs: `src-tauri/src/update/commands.rs` (real Tauri command names: `update_check_now`, `update_install`, `update_dismiss`, `update_skip_version`, `update_get_state`).
- Phase 3 storage.rs: `src-tauri/src/update/storage.rs` (`UpdateState { last_check_unix, last_dismissed_unix, skipped_versions }`).
- Phase 3 dispatcher.rs: emits `update:available`, `update:download:progress`, `update:installed` (camelCase payload).
- Existing App.tsx layout: `src/App.tsx` (DashboardShell + 4 sections) — toast goes outside `<DashboardShell>` (top-anchored), button card goes in `currentSection === "settings"` branch.
- frontend-design skill: `.claude/skills/frontend-design/` — distinctive, polished, ARIA-correct components.

</canonical_refs>
