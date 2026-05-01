---
phase: quick-260501-wqg
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - tsconfig.json
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
autonomous: true
requirements: [P4-DEPS, P4-LIB-RELTIME, P4-HOOK-STATE, P4-HOOK-FOCUS, P4-COMP-TOAST, P4-COMP-BUTTON, P4-WIRE-APP, P4-COVERAGE]

must_haves:
  truths:
    - "useUpdateState hook subscribes to update:available, update:download:progress, update:installed events via @tauri-apps/api/event listen()"
    - "Event payloads consumed as camelCase: { version, notes, downloadUrl }, { downloadedBytes, totalBytes }, { version }"
    - "Downloading state with totalBytes === 0 renders indeterminate spinner element, NEVER a 0% progress bar"
    - "update_check_now return value drives UpToDate / SilentSkip render path (events not relied upon for those branches)"
    - "Later button calls invoke('update_dismiss') (no args); Skip button calls invoke('update_skip_version', { version }) one-click no modal"
    - "Toast root element has role='status' + aria-live='polite' + aria-atomic='true' (role='alert' reserved for errors only, none emitted in Phase 4)"
    - "Focus trap activates only while state.kind === 'Installing' and deactivates on unmount or state change"
    - "@media (prefers-reduced-motion: reduce) disables transform transitions on toast root"
    - "Installing state renders no Restart button — only spinner + 'Installing — the app will restart automatically' text"
    - "Toast container always mounted; visibility toggled via data-visible attribute + CSS transform (preserves aria-live region for screen readers)"
    - "useUpdateState aborted-flag pattern guards StrictMode double-effect-fire (no double listener registration in production)"
    - "vi.mock('@tauri-apps/api/core') and vi.mock('@tauri-apps/api/event') in src/test-setup.ts; tests opt into invoke/listen behavior via vi.mocked(...).mockResolvedValueOnce(...)"
    - "npm test exits green (vitest run); npm run build exits green (tsc -b && vite build)"
    - "npm run test:coverage meets per-file thresholds: 100% on src/hooks/useUpdateState.ts + src/hooks/updateStateMachine.ts + src/lib/relative-time.ts; 90% on src/components/UpdateToast/** + src/components/CheckForUpdatesButton/**"
    - "<UpdateToast /> rendered above <DashboardShell> in src/App.tsx (top-anchored, outside section conditionals)"
    - "<CheckForUpdatesButton /> rendered as <div className='settings-update-card'> sibling between <SettingsPanel /> and <div className='settings-qr-code'> in currentSection === 'settings' branch"
    - "src-tauri/* untouched (Phase 3 contract frozen — diff against HEAD shows zero changes under src-tauri/)"
  artifacts:
    - path: "package.json"
      provides: "vitest devDeps + test scripts"
      contains: "vitest"
    - path: "vitest.config.ts"
      provides: "vitest jsdom config + per-file coverage thresholds"
      contains: "coverage"
    - path: "src/test-setup.ts"
      provides: "vi.mock for Tauri IPC + jest-dom matchers + cleanup"
      contains: "vi.mock"
    - path: "src/css-modules.d.ts"
      provides: "ambient declaration for *.module.css imports"
      contains: "declare module"
    - path: "src/lib/relative-time.ts"
      provides: "pure unix-ts → human string formatter"
      exports: ["formatRelativeTime"]
    - path: "src/lib/relative-time.test.ts"
      provides: "14+ test cases covering all branches"
      contains: "describe"
    - path: "src/lib/types.ts"
      provides: "UpdateState TS mirror of Rust storage.rs"
      exports: ["UpdateState"]
    - path: "src/lib/useFocusTrap.ts"
      provides: "vendored ~40-line focus trap hook"
      exports: ["useFocusTrap"]
    - path: "src/lib/useFocusTrap.test.ts"
      provides: "tests for active gating + Tab/Shift-Tab cycling + return focus on cleanup"
      contains: "renderHook"
    - path: "src/hooks/updateStateMachine.ts"
      provides: "pure UpdateUiState + UpdateAction discriminated unions + updateReducer"
      exports: ["UpdateUiState", "UpdateAction", "updateReducer"]
    - path: "src/hooks/updateStateMachine.test.ts"
      provides: "100% reducer transition coverage (state × action matrix)"
      contains: "updateReducer"
    - path: "src/hooks/useUpdateState.ts"
      provides: "useReducer + listen() registration + invoke() action creators"
      exports: ["useUpdateState"]
    - path: "src/hooks/useUpdateState.test.ts"
      provides: "listener registration + cleanup + action creator wiring tests"
      contains: "renderHook"
    - path: "src/components/UpdateToast/UpdateToast.tsx"
      provides: "top-anchored toast with state-driven content + ARIA + focus trap"
      exports: ["UpdateToast"]
    - path: "src/components/UpdateToast/UpdateToast.module.css"
      provides: "slide-down/slide-up CSS + reduced-motion + sr-only utility"
      contains: "translateY"
    - path: "src/components/UpdateToast/UpdateToast.test.tsx"
      provides: "render-per-state + click handlers + ARIA + indeterminate spinner branch"
      contains: "render"
    - path: "src/components/UpdateToast/index.ts"
      provides: "barrel re-export"
      contains: "export"
    - path: "src/components/CheckForUpdatesButton/CheckForUpdatesButton.tsx"
      provides: "button + last-checked subtext + skipped chip + inline result"
      exports: ["CheckForUpdatesButton"]
    - path: "src/components/CheckForUpdatesButton/CheckForUpdatesButton.module.css"
      provides: "card layout + spinner + skipped chip styles"
      contains: "card"
    - path: "src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx"
      provides: "click → spinner → result + skipped chip + 60s tick humanization"
      contains: "render"
    - path: "src/components/CheckForUpdatesButton/index.ts"
      provides: "barrel re-export"
      contains: "export"
    - path: "src/App.tsx"
      provides: "wires UpdateToast + CheckForUpdatesButton"
      contains: "UpdateToast"
    - path: "src/App.css"
      provides: ".settings-update-card spacing"
      contains: "settings-update-card"
  key_links:
    - from: "src/hooks/useUpdateState.ts"
      to: "@tauri-apps/api/event listen()"
      via: "useEffect with aborted-flag cleanup"
      pattern: "listen<.*>\\(\"update:"
    - from: "src/hooks/useUpdateState.ts"
      to: "src-tauri command names"
      via: "invoke()"
      pattern: "invoke<.*>\\(\"update_(check_now|install|dismiss|skip_version|get_state)\""
    - from: "src/components/UpdateToast/UpdateToast.tsx"
      to: "useUpdateState"
      via: "destructured hook"
      pattern: "useUpdateState\\(\\)"
    - from: "src/components/CheckForUpdatesButton/CheckForUpdatesButton.tsx"
      to: "useUpdateState + relative-time"
      via: "destructured hook + formatRelativeTime"
      pattern: "formatRelativeTime|useUpdateState"
    - from: "src/App.tsx"
      to: "src/components/UpdateToast + src/components/CheckForUpdatesButton"
      via: "JSX render"
      pattern: "<UpdateToast|<CheckForUpdatesButton"
---

<objective>
Phase 4 of master auto-updater plan — deliver React 19 UI surface that consumes the Phase 3 Tauri IPC contract: `<UpdateToast />`, `<CheckForUpdatesButton />`, `useUpdateState` hook, `relative-time.ts` formatter, vendored `useFocusTrap` hook. Wire both components into `src/App.tsx`. Add Vitest + React Testing Library tooling with per-file coverage thresholds (100% hooks/lib, 90% components).

Purpose: surface auto-update flow to admin user without touching Phase 3 backend (frozen contract). Honor all 10 Phase 3 trip-wires + every CONTEXT.md locked decision. Tiger-Style throughout (assertions on boundaries, no nested ifs, ≤50-line functions, descriptive names).

Output: 4 React components/hooks/lib files (each with co-located test), 4 root-config files (vitest.config.ts, test-setup.ts, css-modules.d.ts, package.json patch), App.tsx + App.css wiring, all gates green (`npm test`, `npm run test:coverage`, `npm run build`).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
@$HOME/.claude/skills/tiger-style/SKILL.md
</execution_context>

<context>
# Master plan + locked context (READ FIRST)
@.planning/plans/auto-updater-plan.md
@.planning/quick/260501-wqg-phase-4-auto-updater-react-ui-components/260501-wqg-CONTEXT.md
@.planning/quick/260501-wqg-phase-4-auto-updater-react-ui-components/260501-wqg-RESEARCH.md

# Phase 3 trip-wires (MUST honor all 10) + IPC contract surface
@.planning/quick/260501-uon-phase-3-auto-updater-tauri-plugin-wiring/260501-uon-SUMMARY.md
@src-tauri/src/update/commands.rs
@src-tauri/src/update/storage.rs

# Existing wiring point — DO NOT modify SettingsPanel, only App.tsx + App.css
@src/App.tsx
@src/components/SettingsPanel.tsx
@package.json

# Project-wide rules
@./CLAUDE.md

<interfaces>
<!-- Tauri command signatures (frontend invokes by exact name + arg shape) -->
<!-- Source: src-tauri/src/update/commands.rs -->

```ts
// All commands return Result<T, String> at IPC boundary; thrown on Err.
invoke<UpdateState>("update_check_now"): Promise<UpdateState>
invoke<void>("update_install"): Promise<void>
invoke<void>("update_dismiss"): Promise<void>
invoke<void>("update_skip_version", { version: string }): Promise<void>
invoke<UpdateState>("update_get_state"): Promise<UpdateState>
```

```ts
// UpdateState mirror of Rust src-tauri/src/update/storage.rs:30-34
// snake_case on the wire (#[derive(Serialize)] no rename) — frontend uses snake_case keys.
export interface UpdateState {
  last_check_unix: number;
  last_dismissed_unix: number;
  skipped_versions: string[];
}
```

```ts
// Event payloads (camelCase per dispatcher.rs #[serde(rename_all = "camelCase")])
listen<{ version: string; notes: string; downloadUrl: string }>("update:available", ...)
listen<{ downloadedBytes: number; totalBytes: number }>("update:download:progress", ...)
listen<{ version: string }>("update:installed", ...)
// totalBytes === 0 means "size unknown" → indeterminate spinner, never 0%.
// "update:installed" semantically = "install starting" (Windows exits before await returns).
```
</interfaces>
</context>

<tasks>

<!-- ============================================================ -->
<!-- TASK 1 — Tooling: vitest devDeps + config + test-setup + css-modules.d.ts + scripts -->
<!-- ============================================================ -->

<task type="auto">
  <name>Task 1: Add vitest tooling — devDeps, vitest.config.ts, test-setup.ts, css-modules.d.ts, scripts</name>
  <files>
    package.json,
    tsconfig.json,
    vitest.config.ts,
    src/test-setup.ts,
    src/css-modules.d.ts
  </files>
  <action>
Add Vitest + React Testing Library tooling to root project. NO source/component code in this task — tooling only so subsequent tasks can run `npm test` immediately.

**1. package.json — add devDependencies (alphabetical, exact pinned versions per RESEARCH.md):**

```json
"@testing-library/jest-dom": "^6.9.1",
"@testing-library/react": "^16.3.2",
"@testing-library/user-event": "^14.6.1",
"@vitest/coverage-v8": "^4.1.5",
"jsdom": "^29.1.1",
"vitest": "^4.1.5"
```

Insert into existing `devDependencies` block keeping alphabetical order. Do NOT touch `dependencies`.

**2. package.json — add scripts (after existing scripts, before closing brace):**

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

**3. Run `npm install` — verify lockfile updates and all six packages resolve. Tiger-Style assertion: if `npm install` exits non-zero, abort task and report.**

**4. Create `vitest.config.ts` at repo root** — exact contents per RESEARCH.md §"Vitest + RTL Minimal Config" (verbatim, including per-file coverage thresholds):

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/test-setup.ts", "src/main.tsx"],
      thresholds: {
        "src/hooks/useUpdateState.ts":        { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/hooks/updateStateMachine.ts":    { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/lib/relative-time.ts":           { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/components/UpdateToast/**":           { lines: 90, functions: 90, branches: 90, statements: 90 },
        "src/components/CheckForUpdatesButton/**": { lines: 90, functions: 90, branches: 90, statements: 90 },
      },
    },
  },
});
```

**5. Create `src/test-setup.ts`** — exact contents per RESEARCH.md §"src/test-setup.ts":

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
  exit: vi.fn(),
}));
```

CRITICAL: `listen` mock returns `async () => () => {}` — the inner arrow IS the unlisten fn (sync). RESEARCH.md pitfall #9: returning `Promise<unlistenFn>` from the mock breaks cleanup with `TypeError: u is not a function`.

**6. Create `src/css-modules.d.ts`:**

```ts
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
```

**7. Patch `tsconfig.json`** — read current file, then:
- Add `"vitest.config.ts"` to top-level `include` array (or `references`/per-config `include` whichever applies). If repo uses `tsconfig.app.json` + `tsconfig.node.json` solution-style refs, add to whichever already includes Vite config files. Use Read tool first to inspect, then Edit.
- Do NOT add `"types"` array if `globals: false` is the vitest config (per RESEARCH.md note — explicit imports avoid ambient pollution).

**8. Verify `npm test` exits green with zero test files** (Vitest treats "no tests found" as exit 0 by default in 4.x; confirm or use `--passWithNoTests` flag in script if needed). If `--passWithNoTests` required, append to the `test` script: `"test": "vitest run --passWithNoTests"`.

**9. Verify `npm run build` still green** — `tsc -b && vite build` must pass. The new `src/css-modules.d.ts` ambient declaration must be picked up by tsconfig include (typically `src/**` already covers it).

**Tiger-Style:** No console.log in any new file. Descriptive names per CLAUDE.md. No magic numbers (jsdom version, vitest version are pinned constants in package.json — that is fine, not magic).
  </action>
  <verify>
    <automated>
npm install &&
npm test -- --passWithNoTests &&
npm run build &&
test -f vitest.config.ts &&
test -f src/test-setup.ts &&
test -f src/css-modules.d.ts &&
grep -q '"vitest"' package.json &&
grep -q '"test"' package.json &&
grep -q '"test:coverage"' package.json
    </automated>
  </verify>
  <done>
- `package.json` has six new devDeps + three new scripts (`test`, `test:watch`, `test:coverage`).
- `vitest.config.ts`, `src/test-setup.ts`, `src/css-modules.d.ts` exist with verbatim contents above.
- `npm install` succeeds; `node_modules/vitest/` exists.
- `npm test` exits 0 (no test files yet — `--passWithNoTests` accepted).
- `npm run build` exits 0 (tsc + vite green).
- `tsconfig.json` does NOT regress build.
- Zero changes under `src-tauri/` (`git diff --stat src-tauri/` empty).
  </done>
</task>

<!-- ============================================================ -->
<!-- TASK 2 — Pure lib + types: relative-time.ts, types.ts, useFocusTrap.ts + tests -->
<!-- ============================================================ -->

<task type="auto" tdd="true">
  <name>Task 2: Pure lib — relative-time.ts (formatter), types.ts (UpdateState mirror), useFocusTrap.ts (vendored trap) + tests</name>
  <files>
    src/lib/relative-time.ts,
    src/lib/relative-time.test.ts,
    src/lib/types.ts,
    src/lib/useFocusTrap.ts,
    src/lib/useFocusTrap.test.ts
  </files>
  <behavior>
- formatRelativeTime(unix: number | undefined, nowMs?: number): string
  - undefined → "never"
  - 0 → "never"
  - negative → "never"
  - future ts (within 30s) → "just now"
  - future ts (≥30s) → "in the future"
  - 0..59 seconds ago → "just now"
  - 60..3599 seconds ago → "{N} minute(s) ago" (singular at 1)
  - 3600..86399 seconds ago → "{N} hour(s) ago"
  - 86400..(365*86400-1) seconds ago → "{N} day(s) ago"
  - ≥365 days ago → "{N} year(s) ago"
  - boundary cases: exactly 60s → "1 minute ago"; exactly 3600s → "1 hour ago"; exactly 86400s → "1 day ago"; exactly 365*86400s → "1 year ago"
- useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>): void
  - active=false → no-op (no listeners)
  - active=true → focuses first focusable in container; Tab on last focusable cycles to first; Shift-Tab on first cycles to last; on cleanup returns focus to previously-focused element
  - empty container (no focusables) → preventDefault on Tab (no crash)
  - containerRef.current === null → no-op (no crash)
  </behavior>
  <action>
**1. `src/lib/types.ts` — UpdateState TS mirror of Rust `storage.rs:29-34`:**

```ts
/**
 * Mirror of `src-tauri/src/update/storage.rs::UpdateState`.
 * Wire format is snake_case (#[derive(Serialize)] without rename_all).
 */
export interface UpdateState {
  last_check_unix: number;
  last_dismissed_unix: number;
  skipped_versions: string[];
}
```

**2. `src/lib/relative-time.ts` — pure formatter, ≤50 lines, no external deps:**

```ts
/**
 * Convert a unix timestamp (seconds) to a human-readable relative string.
 *
 * Tiger-Style: pure function, no clock side-effects (nowMs injected for tests).
 * Returns "never" for missing/zero/negative inputs (defensive — no exception
 * thrown on bad data so the UI degrades gracefully).
 */
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY;
const FUTURE_TOLERANCE_SECONDS = 30;

export function formatRelativeTime(unix: number | undefined, nowMs: number = Date.now()): string {
  if (unix === undefined || unix === 0 || unix < 0) return "never";
  const nowSec = Math.floor(nowMs / 1000);
  const deltaSec = nowSec - unix;
  if (deltaSec < -FUTURE_TOLERANCE_SECONDS) return "in the future";
  if (deltaSec < SECONDS_PER_MINUTE) return "just now";
  if (deltaSec < SECONDS_PER_HOUR) {
    const minutes = Math.floor(deltaSec / SECONDS_PER_MINUTE);
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  if (deltaSec < SECONDS_PER_DAY) {
    const hours = Math.floor(deltaSec / SECONDS_PER_HOUR);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (deltaSec < SECONDS_PER_YEAR) {
    const days = Math.floor(deltaSec / SECONDS_PER_DAY);
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  const years = Math.floor(deltaSec / SECONDS_PER_YEAR);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}
```

**3. `src/lib/relative-time.test.ts` — 14+ test cases covering 100% lines/branches:**

```ts
import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "./relative-time";

const NOW_MS = 1_700_000_000_000; // fixed clock for determinism
const NOW_SEC = NOW_MS / 1000;

describe("formatRelativeTime", () => {
  it("returns 'never' for undefined", () => {
    expect(formatRelativeTime(undefined, NOW_MS)).toBe("never");
  });
  it("returns 'never' for zero", () => {
    expect(formatRelativeTime(0, NOW_MS)).toBe("never");
  });
  it("returns 'never' for negative", () => {
    expect(formatRelativeTime(-1, NOW_MS)).toBe("never");
  });
  it("returns 'in the future' for ts > nowSec + 30s tolerance", () => {
    expect(formatRelativeTime(NOW_SEC + 60, NOW_MS)).toBe("in the future");
  });
  it("returns 'just now' for ts within 30s of future tolerance", () => {
    expect(formatRelativeTime(NOW_SEC + 10, NOW_MS)).toBe("just now");
  });
  it("returns 'just now' for 0..59 seconds ago", () => {
    expect(formatRelativeTime(NOW_SEC - 5, NOW_MS)).toBe("just now");
    expect(formatRelativeTime(NOW_SEC - 59, NOW_MS)).toBe("just now");
  });
  it("returns '1 minute ago' at exact 60s boundary", () => {
    expect(formatRelativeTime(NOW_SEC - 60, NOW_MS)).toBe("1 minute ago");
  });
  it("returns 'N minutes ago' plural", () => {
    expect(formatRelativeTime(NOW_SEC - 120, NOW_MS)).toBe("2 minutes ago");
    expect(formatRelativeTime(NOW_SEC - 59 * 60, NOW_MS)).toBe("59 minutes ago");
  });
  it("returns '1 hour ago' at exact 3600s boundary", () => {
    expect(formatRelativeTime(NOW_SEC - 3600, NOW_MS)).toBe("1 hour ago");
  });
  it("returns 'N hours ago' plural", () => {
    expect(formatRelativeTime(NOW_SEC - 2 * 3600, NOW_MS)).toBe("2 hours ago");
    expect(formatRelativeTime(NOW_SEC - 23 * 3600, NOW_MS)).toBe("23 hours ago");
  });
  it("returns '1 day ago' at exact 86400s boundary", () => {
    expect(formatRelativeTime(NOW_SEC - 86_400, NOW_MS)).toBe("1 day ago");
  });
  it("returns 'N days ago' plural", () => {
    expect(formatRelativeTime(NOW_SEC - 3 * 86_400, NOW_MS)).toBe("3 days ago");
    expect(formatRelativeTime(NOW_SEC - 364 * 86_400, NOW_MS)).toBe("364 days ago");
  });
  it("returns '1 year ago' at exact 365-day boundary", () => {
    expect(formatRelativeTime(NOW_SEC - 365 * 86_400, NOW_MS)).toBe("1 year ago");
  });
  it("returns 'N years ago' plural", () => {
    expect(formatRelativeTime(NOW_SEC - 730 * 86_400, NOW_MS)).toBe("2 years ago");
  });
});
```

**4. `src/lib/useFocusTrap.ts` — vendored ~40 lines per RESEARCH.md §"Focus-trap (vendored)":**

```ts
import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Trap Tab/Shift-Tab focus inside `containerRef` while `active` is true.
 * On deactivation (active flips false OR component unmounts), returns focus
 * to the element that had focus when the trap activated.
 *
 * Tiger-Style: descriptive names, no magic strings outside the constant
 * above, single-responsibility (DOES NOT manage open/close state — caller
 * passes `active` derived from feature state).
 */
export function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Tab") return;
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [active, containerRef]);
}
```

**5. `src/lib/useFocusTrap.test.ts` — covers active=false no-op, active=true Tab cycle, Shift-Tab cycle, empty container, null ref, return focus on unmount:**

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef, createRef } from "react";
import { useFocusTrap } from "./useFocusTrap";

function makeContainer(buttonCount: number): HTMLDivElement {
  const div = document.createElement("div");
  for (let i = 0; i < buttonCount; i++) {
    const btn = document.createElement("button");
    btn.textContent = `b${i}`;
    div.appendChild(btn);
  }
  document.body.appendChild(div);
  return div;
}

describe("useFocusTrap", () => {
  it("is a no-op when active=false", () => {
    const container = makeContainer(2);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = container;
    const focusSpy = vi.spyOn(container.querySelectorAll("button")[0]!, "focus");
    renderHook(() => useFocusTrap(false, ref));
    expect(focusSpy).not.toHaveBeenCalled();
    container.remove();
  });

  it("is a no-op when containerRef.current is null", () => {
    const ref = createRef<HTMLElement>();
    expect(() => renderHook(() => useFocusTrap(true, ref))).not.toThrow();
  });

  it("focuses first focusable on activation", () => {
    const container = makeContainer(3);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = container;
    renderHook(() => useFocusTrap(true, ref));
    expect(document.activeElement).toBe(container.querySelectorAll("button")[0]);
    container.remove();
  });

  it("cycles Tab from last to first", () => {
    const container = makeContainer(2);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = container;
    renderHook(() => useFocusTrap(true, ref));
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    buttons[1]!.focus();
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
    container.remove();
  });

  it("cycles Shift-Tab from first to last", () => {
    const container = makeContainer(2);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = container;
    renderHook(() => useFocusTrap(true, ref));
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    buttons[0]!.focus();
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    container.remove();
  });

  it("preventDefaults Tab when no focusables", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = container;
    renderHook(() => useFocusTrap(true, ref));
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    container.remove();
  });

  it("returns focus to previouslyFocused on unmount", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const container = makeContainer(1);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = container;
    const { unmount } = renderHook(() => useFocusTrap(true, ref));
    unmount();
    expect(document.activeElement).toBe(opener);
    container.remove();
    opener.remove();
  });
});
```

**Tiger-Style:** All numeric thresholds are named constants (`SECONDS_PER_MINUTE` etc.). Functions ≤50 lines (formatRelativeTime ~25, useFocusTrap ~30). No nested ifs. No magic strings.
  </action>
  <verify>
    <automated>
npm test -- src/lib/relative-time.test.ts &&
npm test -- src/lib/useFocusTrap.test.ts &&
npm run test:coverage -- src/lib/relative-time.test.ts src/lib/useFocusTrap.test.ts &&
test -f src/lib/types.ts &&
grep -q "interface UpdateState" src/lib/types.ts &&
grep -q "last_check_unix" src/lib/types.ts
    </automated>
  </verify>
  <done>
- All five files exist with content matching action block.
- `npm test -- src/lib/` passes (≥14 cases for relative-time, ≥7 cases for useFocusTrap).
- Coverage on `src/lib/relative-time.ts` is 100% lines/functions/branches/statements.
- `src/lib/types.ts` exports `UpdateState` interface with snake_case fields matching Rust `storage.rs`.
- No console.log in any file.
- `npm run build` still green.
  </done>
</task>

<!-- ============================================================ -->
<!-- TASK 3 — Hooks: updateStateMachine.ts (pure reducer) + useUpdateState.ts (effect + IPC) + tests -->
<!-- ============================================================ -->

<task type="auto" tdd="true">
  <name>Task 3: State machine + hook — pure reducer (updateStateMachine.ts) + effect/IPC hook (useUpdateState.ts) + tests</name>
  <files>
    src/hooks/updateStateMachine.ts,
    src/hooks/updateStateMachine.test.ts,
    src/hooks/useUpdateState.ts,
    src/hooks/useUpdateState.test.ts
  </files>
  <behavior>
- `updateReducer` is a pure function: same input → same output, no side-effects, no clock.
- States (discriminated union on `kind`): Idle | UpdateAvailable | Downloading | Installing | UpToDate | SilentSkip
- Actions: available | progress | installed | checkCompleted | dismissed | skipped | reset
- Transitions:
  - any state + `available` → UpdateAvailable
  - { Downloading | UpdateAvailable } + `progress` → Downloading (totalBytes preserved)
  - other state + `progress` → unchanged (guard, no transition from Idle)
  - any state + `installed` → Installing
  - any state + `checkCompleted` with updateOffered=true → unchanged (the available event handles transition)
  - any state + `checkCompleted` with updateOffered=false → UpToDate
  - any state + `dismissed` → Idle
  - any state + `skipped` → SilentSkip
  - any state + `reset` → Idle
- `useUpdateState` hook:
  - Mounts → registers 3 listeners + invokes update_get_state to hydrate persisted state.
  - StrictMode-safe: aborted-flag pattern (per repo decision [01-08]).
  - Unmounts → calls all 3 unlisten functions.
  - Returns: { state, lastCheckUnix, skippedVersions, checkNow, install, dismiss, skip }.
  - checkNow: invokes update_check_now → setPersisted → dispatch checkCompleted with updateOffered=(state.kind === UpdateAvailable).
  - install: invokes update_install (no dispatch — installed event arrives via listener).
  - dismiss: invokes update_dismiss → dispatch dismissed.
  - skip(version): invokes update_skip_version with { version } → dispatch skipped { version }.
  </behavior>
  <action>
**1. `src/hooks/updateStateMachine.ts` — pure reducer + types per RESEARCH.md §"Action + state shape":**

```ts
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
  | { type: "checkCompleted"; lastCheckUnix: number; updateOffered: boolean }
  | { type: "dismissed" }
  | { type: "skipped"; version: string }
  | { type: "reset" };

/**
 * Pure reducer for update UI state. No clock, no IO, no React. Exported
 * separately so tests run without the React renderer.
 */
export function updateReducer(state: UpdateUiState, action: UpdateAction): UpdateUiState {
  switch (action.type) {
    case "available":
      return {
        kind: "UpdateAvailable",
        version: action.version,
        notes: action.notes,
        downloadUrl: action.downloadUrl,
      };
    case "progress": {
      if (state.kind !== "Downloading" && state.kind !== "UpdateAvailable") return state;
      const version = state.version;
      return {
        kind: "Downloading",
        version,
        downloadedBytes: action.downloadedBytes,
        totalBytes: action.totalBytes,
      };
    }
    case "installed":
      return { kind: "Installing", version: action.version };
    case "checkCompleted":
      if (action.updateOffered) return state;
      return { kind: "UpToDate", checkedAtUnix: action.lastCheckUnix };
    case "dismissed":
      return { kind: "Idle" };
    case "skipped":
      return { kind: "SilentSkip", skippedVersion: action.version };
    case "reset":
      return { kind: "Idle" };
  }
}
```

**2. `src/hooks/updateStateMachine.test.ts` — one `it()` per (state.kind × action.type) combo aiming for 100% coverage:**

```ts
import { describe, it, expect } from "vitest";
import { updateReducer, type UpdateUiState } from "./updateStateMachine";

const IDLE: UpdateUiState = { kind: "Idle" };
const AVAILABLE: UpdateUiState = {
  kind: "UpdateAvailable",
  version: "0.2.0",
  notes: "x",
  downloadUrl: "u",
};
const DOWNLOADING: UpdateUiState = {
  kind: "Downloading",
  version: "0.2.0",
  downloadedBytes: 1000,
  totalBytes: 5000,
};

describe("updateReducer", () => {
  it("Idle + available → UpdateAvailable", () => {
    const next = updateReducer(IDLE, { type: "available", version: "0.2.0", notes: "n", downloadUrl: "u" });
    expect(next.kind).toBe("UpdateAvailable");
  });
  it("any + available → UpdateAvailable (overwrites)", () => {
    const next = updateReducer(DOWNLOADING, { type: "available", version: "0.3.0", notes: "n", downloadUrl: "u" });
    expect(next).toEqual({ kind: "UpdateAvailable", version: "0.3.0", notes: "n", downloadUrl: "u" });
  });
  it("Idle + progress → unchanged", () => {
    const next = updateReducer(IDLE, { type: "progress", downloadedBytes: 100, totalBytes: 1000 });
    expect(next).toBe(IDLE);
  });
  it("UpdateAvailable + progress → Downloading (preserves version)", () => {
    const next = updateReducer(AVAILABLE, { type: "progress", downloadedBytes: 100, totalBytes: 1000 });
    expect(next).toEqual({ kind: "Downloading", version: "0.2.0", downloadedBytes: 100, totalBytes: 1000 });
  });
  it("Downloading + progress → Downloading (updates bytes)", () => {
    const next = updateReducer(DOWNLOADING, { type: "progress", downloadedBytes: 2000, totalBytes: 5000 });
    expect(next).toEqual({ kind: "Downloading", version: "0.2.0", downloadedBytes: 2000, totalBytes: 5000 });
  });
  it("any + installed → Installing", () => {
    const next = updateReducer(DOWNLOADING, { type: "installed", version: "0.2.0" });
    expect(next).toEqual({ kind: "Installing", version: "0.2.0" });
  });
  it("checkCompleted updateOffered=true → unchanged", () => {
    const next = updateReducer(AVAILABLE, { type: "checkCompleted", lastCheckUnix: 1, updateOffered: true });
    expect(next).toBe(AVAILABLE);
  });
  it("checkCompleted updateOffered=false → UpToDate", () => {
    const next = updateReducer(IDLE, { type: "checkCompleted", lastCheckUnix: 1700000000, updateOffered: false });
    expect(next).toEqual({ kind: "UpToDate", checkedAtUnix: 1700000000 });
  });
  it("any + dismissed → Idle", () => {
    expect(updateReducer(AVAILABLE, { type: "dismissed" })).toEqual({ kind: "Idle" });
    expect(updateReducer(DOWNLOADING, { type: "dismissed" })).toEqual({ kind: "Idle" });
  });
  it("any + skipped → SilentSkip", () => {
    const next = updateReducer(AVAILABLE, { type: "skipped", version: "0.2.0" });
    expect(next).toEqual({ kind: "SilentSkip", skippedVersion: "0.2.0" });
  });
  it("any + reset → Idle", () => {
    expect(updateReducer(DOWNLOADING, { type: "reset" })).toEqual({ kind: "Idle" });
  });
});
```

**3. `src/hooks/useUpdateState.ts` — effect + IPC per RESEARCH.md §"Hook with listener registration":**

```ts
import { useEffect, useReducer, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { updateReducer, type UpdateUiState } from "./updateStateMachine";
import type { UpdateState } from "../lib/types";

const INITIAL: UpdateUiState = { kind: "Idle" };

interface AvailablePayload { version: string; notes: string; downloadUrl: string }
interface ProgressPayload  { downloadedBytes: number; totalBytes: number }
interface InstalledPayload { version: string }

/**
 * Subscribe to Phase 3 update:* events and expose typed UI state +
 * action creators that wrap Tauri `invoke()` calls.
 *
 * StrictMode safety: aborted-flag pattern per repo decision [01-08].
 * The first effect mount registers listeners; cleanup unlistens. Under
 * StrictMode-dev-double-fire, the second mount registers fresh listeners
 * after the first cleanup completes — no double-subscription leak.
 */
export function useUpdateState() {
  const [state, dispatch] = useReducer(updateReducer, INITIAL);
  const [persisted, setPersisted] = useState<UpdateState | null>(null);

  useEffect(() => {
    let aborted = false;
    const unlistens: UnlistenFn[] = [];

    (async () => {
      const a = await listen<AvailablePayload>("update:available", (event) => {
        dispatch({
          type: "available",
          version: event.payload.version,
          notes: event.payload.notes,
          downloadUrl: event.payload.downloadUrl,
        });
      });
      const p = await listen<ProgressPayload>("update:download:progress", (event) => {
        dispatch({
          type: "progress",
          downloadedBytes: event.payload.downloadedBytes,
          totalBytes: event.payload.totalBytes,
        });
      });
      const i = await listen<InstalledPayload>("update:installed", (event) => {
        dispatch({ type: "installed", version: event.payload.version });
      });
      if (aborted) {
        a(); p(); i();
        return;
      }
      unlistens.push(a, p, i);
    })().catch((error) => {
      console.warn("useUpdateState: listener registration failed", error);
    });

    return () => {
      aborted = true;
      for (const fn of unlistens) fn();
    };
  }, []);

  useEffect(() => {
    invoke<UpdateState>("update_get_state")
      .then(setPersisted)
      .catch((error) => console.warn("useUpdateState: update_get_state failed", error));
  }, []);

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

  return {
    state,
    lastCheckUnix: persisted?.last_check_unix ?? 0,
    skippedVersions: persisted?.skipped_versions ?? [],
    checkNow,
    install,
    dismiss,
    skip,
  };
}
```

**4. `src/hooks/useUpdateState.test.ts` — covers listener registration, cleanup, action creators, error path:**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useUpdateState } from "./useUpdateState";
import type { UpdateState } from "../lib/types";

const DEFAULT_STATE: UpdateState = {
  last_check_unix: 0,
  last_dismissed_unix: 0,
  skipped_versions: [],
};

describe("useUpdateState", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(DEFAULT_STATE);
    vi.mocked(listen).mockImplementation(async () => () => {});
  });

  it("registers three listeners on mount", async () => {
    renderHook(() => useUpdateState());
    await waitFor(() => {
      expect(vi.mocked(listen)).toHaveBeenCalledWith("update:available", expect.any(Function));
      expect(vi.mocked(listen)).toHaveBeenCalledWith("update:download:progress", expect.any(Function));
      expect(vi.mocked(listen)).toHaveBeenCalledWith("update:installed", expect.any(Function));
    });
  });

  it("calls all three unlisten fns on unmount", async () => {
    const unlistenSpies = [vi.fn(), vi.fn(), vi.fn()];
    vi.mocked(listen)
      .mockResolvedValueOnce(unlistenSpies[0]!)
      .mockResolvedValueOnce(unlistenSpies[1]!)
      .mockResolvedValueOnce(unlistenSpies[2]!);

    const { unmount } = renderHook(() => useUpdateState());
    await waitFor(() => expect(vi.mocked(listen)).toHaveBeenCalledTimes(3));
    unmount();
    await waitFor(() => {
      for (const spy of unlistenSpies) expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  it("hydrates persisted state on mount via update_get_state", async () => {
    const persisted: UpdateState = {
      last_check_unix: 1_700_000_000,
      last_dismissed_unix: 0,
      skipped_versions: ["0.1.5"],
    };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "update_get_state") return persisted;
      return DEFAULT_STATE;
    });
    const { result } = renderHook(() => useUpdateState());
    await waitFor(() => expect(result.current.lastCheckUnix).toBe(1_700_000_000));
    expect(result.current.skippedVersions).toEqual(["0.1.5"]);
  });

  it("dispatches available when update:available event fires", async () => {
    let availableHandler: ((event: { payload: { version: string; notes: string; downloadUrl: string } }) => void) | null = null;
    vi.mocked(listen).mockImplementation(async (eventName: string, handler) => {
      if (eventName === "update:available") availableHandler = handler as typeof availableHandler;
      return () => {};
    });
    const { result } = renderHook(() => useUpdateState());
    await waitFor(() => expect(availableHandler).not.toBeNull());
    await act(async () => {
      availableHandler!({ payload: { version: "0.2.0", notes: "release notes", downloadUrl: "https://x/y" } });
    });
    expect(result.current.state).toEqual({
      kind: "UpdateAvailable",
      version: "0.2.0",
      notes: "release notes",
      downloadUrl: "https://x/y",
    });
  });

  it("dispatches progress when update:download:progress event fires", async () => {
    let availableHandler: ((event: { payload: { version: string; notes: string; downloadUrl: string } }) => void) | null = null;
    let progressHandler: ((event: { payload: { downloadedBytes: number; totalBytes: number } }) => void) | null = null;
    vi.mocked(listen).mockImplementation(async (eventName: string, handler) => {
      if (eventName === "update:available") availableHandler = handler as typeof availableHandler;
      if (eventName === "update:download:progress") progressHandler = handler as typeof progressHandler;
      return () => {};
    });
    const { result } = renderHook(() => useUpdateState());
    await waitFor(() => expect(progressHandler).not.toBeNull());
    await act(async () => {
      availableHandler!({ payload: { version: "0.2.0", notes: "n", downloadUrl: "u" } });
      progressHandler!({ payload: { downloadedBytes: 100, totalBytes: 1000 } });
    });
    expect(result.current.state).toMatchObject({
      kind: "Downloading",
      downloadedBytes: 100,
      totalBytes: 1000,
    });
  });

  it("dispatches installed when update:installed event fires", async () => {
    let installedHandler: ((event: { payload: { version: string } }) => void) | null = null;
    vi.mocked(listen).mockImplementation(async (eventName: string, handler) => {
      if (eventName === "update:installed") installedHandler = handler as typeof installedHandler;
      return () => {};
    });
    const { result } = renderHook(() => useUpdateState());
    await waitFor(() => expect(installedHandler).not.toBeNull());
    await act(async () => installedHandler!({ payload: { version: "0.2.0" } }));
    expect(result.current.state).toEqual({ kind: "Installing", version: "0.2.0" });
  });

  it("checkNow invokes update_check_now and sets persisted", async () => {
    const checkResult: UpdateState = { last_check_unix: 1700, last_dismissed_unix: 0, skipped_versions: [] };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "update_check_now") return checkResult;
      return DEFAULT_STATE;
    });
    const { result } = renderHook(() => useUpdateState());
    await act(async () => { await result.current.checkNow(); });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_check_now");
    expect(result.current.lastCheckUnix).toBe(1700);
  });

  it("install invokes update_install (no args)", async () => {
    const { result } = renderHook(() => useUpdateState());
    await act(async () => { await result.current.install(); });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_install");
  });

  it("dismiss invokes update_dismiss and dispatches dismissed → Idle", async () => {
    const { result } = renderHook(() => useUpdateState());
    await act(async () => { await result.current.dismiss(); });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_dismiss");
    expect(result.current.state).toEqual({ kind: "Idle" });
  });

  it("skip invokes update_skip_version with { version } and dispatches skipped → SilentSkip", async () => {
    const { result } = renderHook(() => useUpdateState());
    await act(async () => { await result.current.skip("0.2.0"); });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_skip_version", { version: "0.2.0" });
    expect(result.current.state).toEqual({ kind: "SilentSkip", skippedVersion: "0.2.0" });
  });

  it("logs warning when listener registration throws (does not crash)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(listen).mockRejectedValue(new Error("tauri runtime missing"));
    expect(() => renderHook(() => useUpdateState())).not.toThrow();
    await waitFor(() => expect(warnSpy).toHaveBeenCalled());
    warnSpy.mockRestore();
  });
});
```

**Tiger-Style:** No console.log (only console.warn for unrecoverable IPC registration failure). All IPC calls go through typed `invoke<T>()` helpers. Functions ≤50 lines. Action creators are flat — no nested ifs.
  </action>
  <verify>
    <automated>
npm test -- src/hooks/updateStateMachine.test.ts &&
npm test -- src/hooks/useUpdateState.test.ts &&
npm run test:coverage
    </automated>
  </verify>
  <done>
- Four files exist with content matching action block.
- `npm test -- src/hooks/` passes (≥11 reducer cases, ≥10 hook cases).
- `npm run test:coverage` reports 100% lines/functions/branches/statements on `src/hooks/updateStateMachine.ts` AND `src/hooks/useUpdateState.ts`.
- No console.log; only single console.warn for IPC registration failure.
- `npm run build` still green (strict TS happy with discriminated unions + UnlistenFn type).
- Zero src-tauri/ changes.
  </done>
</task>

<!-- ============================================================ -->
<!-- TASK 4 — UpdateToast component (top-anchored, ARIA, focus-trap, indeterminate-spinner branch) + tests -->
<!-- ============================================================ -->

<task type="auto" tdd="true">
  <name>Task 4: UpdateToast component — ARIA-correct, top-anchored, indeterminate-spinner branch, focus-trap during Installing + tests</name>
  <files>
    src/components/UpdateToast/UpdateToast.tsx,
    src/components/UpdateToast/UpdateToast.module.css,
    src/components/UpdateToast/UpdateToast.test.tsx,
    src/components/UpdateToast/index.ts
  </files>
  <behavior>
- Render outer div always (aria-live region preserved across state changes per RESEARCH.md §"aria-live remount pitfall").
- Outer div has role="status", aria-live="polite", aria-atomic="true", data-state={state.kind}, data-visible={visible}.
- Idle state → no inner content (visually hidden via data-visible="false").
- UpdateAvailable → version + 80-char-truncated notes (full notes in sr-only span + aria-label) + Install/Later/Skip buttons.
- Downloading totalBytes>0 → <progress max value /> + bytes/percent text.
- Downloading totalBytes===0 → indeterminate spinner div + "Downloading…" text (NEVER renders 0%).
- Installing → indeterminate spinner + "Installing — the app will restart automatically" text. NO buttons. Focus trap active.
- Install button click → install().
- Later button click → dismiss().
- Skip button click → skip(version) — one-click, no confirmation.
- Reduced motion media query disables transform transitions (pure CSS).
  </behavior>
  <action>
**1. `src/components/UpdateToast/UpdateToast.tsx`:**

```tsx
import { useRef } from "react";
import styles from "./UpdateToast.module.css";
import { useUpdateState } from "../../hooks/useUpdateState";
import { useFocusTrap } from "../../lib/useFocusTrap";
import type { UpdateUiState } from "../../hooks/updateStateMachine";

const NOTES_TRUNCATE_LIMIT = 80;

function truncateNotes(notes: string): { display: string; full: string; truncated: boolean } {
  if (notes.length <= NOTES_TRUNCATE_LIMIT) {
    return { display: notes, full: notes, truncated: false };
  }
  return { display: `${notes.slice(0, NOTES_TRUNCATE_LIMIT)}…`, full: notes, truncated: true };
}

interface AvailableProps {
  state: Extract<UpdateUiState, { kind: "UpdateAvailable" }>;
  onInstall: () => void;
  onLater: () => void;
  onSkip: () => void;
}
function AvailableContent({ state, onInstall, onLater, onSkip }: AvailableProps) {
  const { display, full, truncated } = truncateNotes(state.notes);
  return (
    <div className={styles["toast-content"]}>
      <div className={styles["toast-headline"]}>Update available — v{state.version}</div>
      <div className={styles["toast-notes"]} aria-label={truncated ? full : undefined}>
        {display}
        {truncated && <span className={styles["sr-only"]}>{full}</span>}
      </div>
      <div className={styles["toast-actions"]}>
        <button type="button" className={styles["button-primary"]} onClick={onInstall}>
          Install
        </button>
        <button type="button" className={styles["button-secondary"]} onClick={onLater}>
          Later
        </button>
        <button type="button" className={styles["button-tertiary"]} onClick={onSkip}>
          Skip this version
        </button>
      </div>
    </div>
  );
}

interface DownloadingProps {
  state: Extract<UpdateUiState, { kind: "Downloading" }>;
}
function DownloadingContent({ state }: DownloadingProps) {
  const isIndeterminate = state.totalBytes === 0;
  return (
    <div className={styles["toast-content"]} aria-busy="true">
      <div className={styles["toast-headline"]}>Downloading v{state.version}…</div>
      {isIndeterminate ? (
        <div
          className={styles["spinner-indeterminate"]}
          role="progressbar"
          aria-label="downloading, size unknown"
          aria-valuetext="downloading, size unknown"
        />
      ) : (
        <progress
          className={styles["progress-bar"]}
          max={state.totalBytes}
          value={state.downloadedBytes}
          aria-label={`download progress ${state.downloadedBytes} of ${state.totalBytes} bytes`}
        />
      )}
    </div>
  );
}

interface InstallingProps {
  state: Extract<UpdateUiState, { kind: "Installing" }>;
}
function InstallingContent({ state }: InstallingProps) {
  return (
    <div className={styles["toast-content"]} aria-busy="true">
      <div className={styles["toast-headline"]}>Installing v{state.version}</div>
      <div className={styles["spinner-indeterminate"]} role="progressbar" aria-label="installing" />
      <output className={styles["toast-text"]}>Installing — the app will restart automatically</output>
    </div>
  );
}

export function UpdateToast() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { state, install, dismiss, skip } = useUpdateState();
  const visible = state.kind !== "Idle";
  const trapActive = state.kind === "Installing";
  useFocusTrap(trapActive, containerRef);

  return (
    <div
      ref={containerRef}
      className={styles["toast-root"]}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-visible={visible}
      data-state={state.kind}
    >
      {state.kind === "UpdateAvailable" && (
        <AvailableContent
          state={state}
          onInstall={install}
          onLater={dismiss}
          onSkip={() => skip(state.version)}
        />
      )}
      {state.kind === "Downloading" && <DownloadingContent state={state} />}
      {state.kind === "Installing" && <InstallingContent state={state} />}
    </div>
  );
}
```

**2. `src/components/UpdateToast/UpdateToast.module.css`:**

```css
.toast-root {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  background: var(--card-bg, #1a1f2e);
  color: var(--text-primary, #ffffff);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  padding: 1rem 1.5rem;
  transform: translateY(0);
  transition: transform 240ms ease-out;
}
.toast-root[data-visible="false"] {
  transform: translateY(-100%);
  transition: transform 180ms ease-in;
  pointer-events: none;
}

.toast-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 720px;
  margin: 0 auto;
}

.toast-headline {
  font-weight: 600;
  font-size: 1rem;
}

.toast-notes {
  font-size: 0.875rem;
  color: var(--text-secondary, #a0a4b8);
}

.toast-text {
  font-size: 0.875rem;
}

.toast-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.button-primary,
.button-secondary,
.button-tertiary {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: none;
  font-weight: 500;
  cursor: pointer;
  font-size: 0.875rem;
}

.button-primary {
  background: var(--update-accent, #16a34a);
  color: #ffffff;
}

.button-secondary {
  background: transparent;
  color: var(--text-primary, #ffffff);
  border: 1px solid var(--border-color, #2a3142);
}

.button-tertiary {
  background: transparent;
  color: var(--text-secondary, #a0a4b8);
}

.progress-bar {
  width: 100%;
  height: 8px;
}

.spinner-indeterminate {
  width: 24px;
  height: 24px;
  border: 3px solid var(--border-color, #2a3142);
  border-top-color: var(--update-accent, #16a34a);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .toast-root { transition: none; }
  .spinner-indeterminate { animation: none; }
}
```

**3. `src/components/UpdateToast/UpdateToast.test.tsx` — render-per-state + click handlers + ARIA + indeterminate-spinner branch:**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { UpdateToast } from "./UpdateToast";
import type { UpdateState } from "../../lib/types";

const DEFAULT_STATE: UpdateState = { last_check_unix: 0, last_dismissed_unix: 0, skipped_versions: [] };

interface CapturedHandlers {
  available?: (event: { payload: { version: string; notes: string; downloadUrl: string } }) => void;
  progress?: (event: { payload: { downloadedBytes: number; totalBytes: number } }) => void;
  installed?: (event: { payload: { version: string } }) => void;
}

function captureListenHandlers(): CapturedHandlers {
  const captured: CapturedHandlers = {};
  vi.mocked(listen).mockImplementation(async (eventName: string, handler) => {
    if (eventName === "update:available") captured.available = handler as never;
    if (eventName === "update:download:progress") captured.progress = handler as never;
    if (eventName === "update:installed") captured.installed = handler as never;
    return () => {};
  });
  return captured;
}

describe("UpdateToast", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(DEFAULT_STATE);
    vi.mocked(listen).mockImplementation(async () => () => {});
  });

  it("renders aria-live polite root with role='status' even when Idle (preserves AT region)", () => {
    render(<UpdateToast />);
    const root = screen.getByRole("status");
    expect(root).toHaveAttribute("aria-live", "polite");
    expect(root).toHaveAttribute("aria-atomic", "true");
    expect(root).toHaveAttribute("data-visible", "false");
    expect(root).toHaveAttribute("data-state", "Idle");
  });

  it("renders UpdateAvailable content with version + notes + 3 buttons", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.available).toBeDefined());
    await act(handlers.available!, { version: "0.2.0", notes: "Bug fixes and perf", downloadUrl: "u" });
    expect(screen.getByText(/v0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Bug fixes and perf/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /install/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /later/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip/i })).toBeInTheDocument();
  });

  it("truncates notes longer than 80 chars and exposes full notes via sr-only + aria-label", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.available).toBeDefined());
    const longNotes = "A".repeat(120);
    await act(handlers.available!, { version: "0.2.0", notes: longNotes, downloadUrl: "u" });
    const truncatedDisplay = `${"A".repeat(80)}…`;
    expect(screen.getByText(truncatedDisplay)).toBeInTheDocument();
  });

  it("Install button calls invoke('update_install')", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.available).toBeDefined());
    await act(handlers.available!, { version: "0.2.0", notes: "n", downloadUrl: "u" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /install/i }));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_install");
  });

  it("Later button calls invoke('update_dismiss')", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.available).toBeDefined());
    await act(handlers.available!, { version: "0.2.0", notes: "n", downloadUrl: "u" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /later/i }));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_dismiss");
  });

  it("Skip button calls invoke('update_skip_version', { version }) one-click", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.available).toBeDefined());
    await act(handlers.available!, { version: "0.2.0", notes: "n", downloadUrl: "u" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /skip/i }));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_skip_version", { version: "0.2.0" });
  });

  it("Downloading with totalBytes>0 renders <progress> with max+value, NOT a spinner", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.progress).toBeDefined());
    await act(handlers.available!, { version: "0.2.0", notes: "n", downloadUrl: "u" });
    await act(handlers.progress!, { downloadedBytes: 250, totalBytes: 1000 });
    const progressEl = document.querySelector("progress");
    expect(progressEl).toBeInTheDocument();
    expect(progressEl).toHaveAttribute("max", "1000");
    expect(progressEl).toHaveAttribute("value", "250");
  });

  it("Downloading with totalBytes===0 renders indeterminate spinner, NOT 0% progress", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.progress).toBeDefined());
    await act(handlers.available!, { version: "0.2.0", notes: "n", downloadUrl: "u" });
    await act(handlers.progress!, { downloadedBytes: 250, totalBytes: 0 });
    expect(document.querySelector("progress")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/downloading, size unknown/i)).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it("Installing state renders no buttons + auto-restart text", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    await waitFor(() => expect(handlers.installed).toBeDefined());
    await act(handlers.installed!, { version: "0.2.0" });
    expect(screen.getByText(/will restart automatically/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("data-state attribute mirrors current UI state.kind for CSS hooks", async () => {
    const handlers = captureListenHandlers();
    render(<UpdateToast />);
    const root = screen.getByRole("status");
    expect(root).toHaveAttribute("data-state", "Idle");
    await waitFor(() => expect(handlers.available).toBeDefined());
    await act(handlers.available!, { version: "0.2.0", notes: "n", downloadUrl: "u" });
    expect(root).toHaveAttribute("data-state", "UpdateAvailable");
    expect(root).toHaveAttribute("data-visible", "true");
  });
});

// helper: act() wrapping listener invocation to flush React state updates
import { act as reactAct } from "react";
async function act(handler: ((event: { payload: unknown }) => void) | undefined, payload: unknown): Promise<void> {
  await reactAct(async () => {
    handler?.({ payload });
  });
}
```

**4. `src/components/UpdateToast/index.ts`:**

```ts
export { UpdateToast } from "./UpdateToast";
```

**Tiger-Style:** Three sub-component functions for SRP (AvailableContent / DownloadingContent / InstallingContent each ≤25 lines). truncateNotes is pure. NOTES_TRUNCATE_LIMIT named constant. No nested ifs. Toast root always mounted (aria-live preservation). No console.log.
  </action>
  <verify>
    <automated>
npm test -- src/components/UpdateToast &&
npm run test:coverage
    </automated>
  </verify>
  <done>
- All four files exist.
- `npm test -- src/components/UpdateToast` passes (≥10 cases).
- `npm run test:coverage` reports ≥90% lines/branches/functions/statements on `src/components/UpdateToast/**`.
- Toast renders no buttons during Installing.
- totalBytes===0 path renders aria-labeled spinner, NOT 0% progress.
- aria-live="polite" + role="status" present on outer always-mounted div.
- `npm run build` green.
- Zero src-tauri/ changes.
  </done>
</task>

<!-- ============================================================ -->
<!-- TASK 5 — CheckForUpdatesButton component (settings card, last-checked subtext, skipped chip, 60s tick) + tests -->
<!-- ============================================================ -->

<task type="auto" tdd="true">
  <name>Task 5: CheckForUpdatesButton component — last-checked subtext (60s tick), skipped-versions chip, inline result + tests</name>
  <files>
    src/components/CheckForUpdatesButton/CheckForUpdatesButton.tsx,
    src/components/CheckForUpdatesButton/CheckForUpdatesButton.module.css,
    src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx,
    src/components/CheckForUpdatesButton/index.ts
  </files>
  <behavior>
- Renders a card with: title "Check for updates", "Check now" button, subtext line "Last checked: {humanized}".
- Subtext re-humanizes every 60s via setInterval (cleared on unmount).
- Click "Check now" → spinner replaces button text → checkNow() resolves → spinner removed → inline result message rendered for 4s ("Up to date" if state becomes UpToDate, "Update available — see banner" if UpdateAvailable, "Skipped — see chip below" if SilentSkip).
- Skipped versions render below as small chips: "Skipped: vX.Y.Z" (one chip per version in skipped_versions array).
- If skipped_versions empty → no chip row.
- Button disabled while spinner active.
- All on-screen text uses descriptive copy per CLAUDE.md.
  </behavior>
  <action>
**1. `src/components/CheckForUpdatesButton/CheckForUpdatesButton.tsx`:**

```tsx
import { useEffect, useState } from "react";
import styles from "./CheckForUpdatesButton.module.css";
import { useUpdateState } from "../../hooks/useUpdateState";
import { formatRelativeTime } from "../../lib/relative-time";

const HUMANIZE_TICK_MS = 60_000;
const RESULT_DISPLAY_MS = 4_000;

type CheckResult = "idle" | "pending" | "uptodate" | "available" | "skipped";

function buildResultMessage(result: CheckResult): string {
  switch (result) {
    case "uptodate": return "Up to date";
    case "available": return "Update available — see banner";
    case "skipped": return "Already skipped — see chip below";
    case "pending": return "";
    case "idle": return "";
  }
}

export function CheckForUpdatesButton() {
  const { state, lastCheckUnix, skippedVersions, checkNow } = useUpdateState();
  const [humanized, setHumanized] = useState<string>(() => formatRelativeTime(lastCheckUnix));
  const [result, setResult] = useState<CheckResult>("idle");

  useEffect(() => {
    setHumanized(formatRelativeTime(lastCheckUnix));
    const interval = setInterval(() => {
      setHumanized(formatRelativeTime(lastCheckUnix));
    }, HUMANIZE_TICK_MS);
    return () => clearInterval(interval);
  }, [lastCheckUnix]);

  async function onClick(): Promise<void> {
    setResult("pending");
    try {
      await checkNow();
    } catch (error) {
      console.warn("CheckForUpdatesButton: check_now failed", error);
      setResult("idle");
      return;
    }
    setResult("idle");
  }

  // Reflect post-check state.kind into inline result for RESULT_DISPLAY_MS.
  useEffect(() => {
    if (result !== "idle") return;
    if (state.kind === "UpToDate") setResult("uptodate");
    else if (state.kind === "UpdateAvailable") setResult("available");
    else if (state.kind === "SilentSkip") setResult("skipped");
    else return;
    const timer = setTimeout(() => setResult("idle"), RESULT_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [state.kind, result]);

  const pending = result === "pending";
  const message = buildResultMessage(result);

  return (
    <div className={styles["card"]}>
      <div className={styles["card-header"]}>
        <h3 className={styles["card-title"]}>Check for updates</h3>
        <button
          type="button"
          className={styles["check-button"]}
          onClick={onClick}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? <span className={styles["spinner"]} aria-label="checking" /> : "Check now"}
        </button>
      </div>
      <div className={styles["card-subtext"]}>Last checked: {humanized}</div>
      {message !== "" && (
        <div className={styles["card-result"]} role="status">
          {message}
        </div>
      )}
      {skippedVersions.length > 0 && (
        <div className={styles["chip-row"]}>
          {skippedVersions.map((v) => (
            <span key={v} className={styles["chip"]}>Skipped: v{v}</span>
          ))}
        </div>
      )}
    </div>
  );
}
```

**2. `src/components/CheckForUpdatesButton/CheckForUpdatesButton.module.css`:**

```css
.card {
  background: var(--card-bg, #1a1f2e);
  border: 1px solid var(--border-color, #2a3142);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.card-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary, #ffffff);
}

.card-subtext {
  font-size: 0.8125rem;
  color: var(--text-secondary, #a0a4b8);
}

.card-result {
  font-size: 0.875rem;
  color: var(--update-accent, #16a34a);
}

.check-button {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: none;
  background: var(--update-accent, #16a34a);
  color: #ffffff;
  font-weight: 500;
  cursor: pointer;
  font-size: 0.875rem;
  min-width: 96px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.check-button:disabled { opacity: 0.6; cursor: progress; }

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.chip {
  font-size: 0.75rem;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  background: var(--border-color, #2a3142);
  color: var(--text-secondary, #a0a4b8);
}

@keyframes spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .spinner { animation: none; }
}
```

**3. `src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx`:**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CheckForUpdatesButton } from "./CheckForUpdatesButton";
import type { UpdateState } from "../../lib/types";

const NOW_SEC = Math.floor(Date.now() / 1000);
const STATE_RECENT: UpdateState = {
  last_check_unix: NOW_SEC - 7200,
  last_dismissed_unix: 0,
  skipped_versions: [],
};

describe("CheckForUpdatesButton", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(STATE_RECENT);
    vi.mocked(listen).mockImplementation(async () => () => {});
  });

  it("renders title + Check now button", async () => {
    render(<CheckForUpdatesButton />);
    expect(screen.getByText(/check for updates/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check now/i })).toBeInTheDocument();
  });

  it("renders 'Last checked: never' when last_check_unix is 0", async () => {
    vi.mocked(invoke).mockResolvedValue({ ...STATE_RECENT, last_check_unix: 0 });
    render(<CheckForUpdatesButton />);
    await waitFor(() => expect(screen.getByText(/last checked: never/i)).toBeInTheDocument());
  });

  it("renders humanized last-checked subtext (e.g. '2 hours ago')", async () => {
    render(<CheckForUpdatesButton />);
    await waitFor(() => expect(screen.getByText(/last checked: 2 hours ago/i)).toBeInTheDocument());
  });

  it("clicking Check now invokes update_check_now and shows spinner during pending", async () => {
    let resolveCheck: (value: UpdateState) => void;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "update_check_now") return new Promise<UpdateState>((res) => { resolveCheck = res; });
      return STATE_RECENT;
    });
    render(<CheckForUpdatesButton />);
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: /check now/i });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByLabelText(/checking/i)).toBeInTheDocument();
    resolveCheck!(STATE_RECENT);
    await waitFor(() => expect(screen.getByRole("button", { name: /check now/i })).not.toBeDisabled());
  });

  it("renders skipped-version chips when skipped_versions non-empty", async () => {
    vi.mocked(invoke).mockResolvedValue({ ...STATE_RECENT, skipped_versions: ["0.1.5", "0.1.6"] });
    render(<CheckForUpdatesButton />);
    await waitFor(() => {
      expect(screen.getByText(/skipped: v0\.1\.5/i)).toBeInTheDocument();
      expect(screen.getByText(/skipped: v0\.1\.6/i)).toBeInTheDocument();
    });
  });

  it("does NOT render chip row when skipped_versions empty", async () => {
    render(<CheckForUpdatesButton />);
    await waitFor(() => expect(screen.queryByText(/skipped: v/i)).not.toBeInTheDocument());
  });

  it("renders inline 'Up to date' result after checkCompleted with no update", async () => {
    let availableHandler: ((event: { payload: { version: string; notes: string; downloadUrl: string } }) => void) | null = null;
    vi.mocked(listen).mockImplementation(async (eventName: string, handler) => {
      if (eventName === "update:available") availableHandler = handler as never;
      return () => {};
    });
    render(<CheckForUpdatesButton />);
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: /check now/i });
    await user.click(button);
    // No `available` event fires → state transitions to UpToDate via checkCompleted dispatch.
    await waitFor(() => expect(screen.getByText(/up to date/i)).toBeInTheDocument());
  });

  it("re-humanizes last-checked subtext on 60s tick", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(invoke).mockResolvedValue({ ...STATE_RECENT, last_check_unix: NOW_SEC - 30 });
      render(<CheckForUpdatesButton />);
      // Initial render: "just now"
      await waitFor(() => expect(screen.getByText(/last checked: just now/i)).toBeInTheDocument(), { timeout: 100 });
      // Advance 90s (past 60s minute boundary) — clock moves forward, but last_check_unix is fixed,
      // so the relative offset grows. After tick, recomputed humanized should change.
      vi.setSystemTime(Date.now() + 90_000);
      vi.advanceTimersByTime(60_000);
      await waitFor(() => expect(screen.getByText(/last checked: 2 minutes ago/i)).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });
});
```

**4. `src/components/CheckForUpdatesButton/index.ts`:**

```ts
export { CheckForUpdatesButton } from "./CheckForUpdatesButton";
```

**Tiger-Style:** No console.log (single console.warn for user-actioned check failure). HUMANIZE_TICK_MS + RESULT_DISPLAY_MS named constants. CheckForUpdatesButton function ~50 lines. buildResultMessage pure helper. No nested ifs.
  </action>
  <verify>
    <automated>
npm test -- src/components/CheckForUpdatesButton &&
npm run test:coverage
    </automated>
  </verify>
  <done>
- All four files exist.
- `npm test -- src/components/CheckForUpdatesButton` passes (≥7 cases).
- `npm run test:coverage` reports ≥90% lines/branches/functions/statements on `src/components/CheckForUpdatesButton/**`.
- Skipped chips rendered when `skipped_versions` non-empty.
- 60s tick test passes via fake timers.
- `npm run build` green.
- Zero src-tauri/ changes.
  </done>
</task>

<!-- ============================================================ -->
<!-- TASK 6 — Wire components into App.tsx + add settings-update-card style + final acceptance gates -->
<!-- ============================================================ -->

<task type="auto">
  <name>Task 6: Wire UpdateToast + CheckForUpdatesButton into App.tsx + App.css; run all acceptance gates</name>
  <files>
    src/App.tsx,
    src/App.css
  </files>
  <action>
**1. Edit `src/App.tsx`:**

- Add imports near other component imports:

```ts
import { UpdateToast } from "./components/UpdateToast";
import { CheckForUpdatesButton } from "./components/CheckForUpdatesButton";
```

- Wrap the existing `<DashboardShell>` return in a fragment and render `<UpdateToast />` ABOVE the shell so it overlays via `position: fixed; top: 0`:

```tsx
return (
  <>
    <UpdateToast />
    <DashboardShell ...existing props...>
      ...existing children...
    </DashboardShell>
  </>
);
```

- In the `currentSection === "settings"` branch, insert `<div className="settings-update-card"><CheckForUpdatesButton /></div>` between `<SettingsPanel />` and `<div className="settings-qr-code">`. The settings block becomes:

```tsx
{currentSection === "settings" && (
  <>
    <SettingsPanel
      config={config}
      interfaces={interfaces}
      onSave={updateConfig}
    />
    <div className="settings-update-card">
      <CheckForUpdatesButton />
    </div>
    <div className="settings-qr-code">
      <QrCodeDisplay config={config} />
    </div>
    <div className="settings-log-viewer">
      <LogViewer subscribe={subscribe} />
    </div>
  </>
)}
```

Do NOT modify `<SettingsPanel />` — it is a sibling card per locked decision.

**2. Edit `src/App.css`** — append after the `.settings-qr-code` block (near line 1252):

```css
/* Settings: auto-updater card spacing */
.settings-update-card {
  margin-top: 1.5rem;
}
```

**3. Run all acceptance gates:**

```bash
npm test
npm run test:coverage
npm run build
```

All three must exit 0. `npm run test:coverage` must satisfy per-file thresholds (100% on lib + hooks, 90% on components).

**4. Manual UAT note (NOT an automated gate, document in SUMMARY):**

Master plan acceptance includes "Lighthouse score ≥ 95" — this is a manual DevTools check on the running Tauri app, NOT covered by `npm test`. Note in SUMMARY.md as a deferred manual UAT step (user runs after Phase 4 ships, before tagging release). Do NOT block phase completion on it; the four automated gates above are the executable acceptance criteria.

**5. Verify zero `src-tauri/` diff:**

```bash
git diff --stat src-tauri/
```

Must output nothing (Phase 3 contract frozen).

**6. Verify SettingsPanel.tsx untouched:**

```bash
git diff src/components/SettingsPanel.tsx
```

Must output nothing.

**Tiger-Style:** No console.log added to App.tsx. Imports alphabetical within their group. JSX flat — no nested ternaries beyond what already exists.
  </action>
  <verify>
    <automated>
npm test &&
npm run test:coverage &&
npm run build &&
grep -q "<UpdateToast" src/App.tsx &&
grep -q "<CheckForUpdatesButton" src/App.tsx &&
grep -q "settings-update-card" src/App.tsx &&
grep -q "settings-update-card" src/App.css &&
test -z "$(git diff --stat src-tauri/)" &&
test -z "$(git diff src/components/SettingsPanel.tsx)"
    </automated>
  </verify>
  <done>
- `<UpdateToast />` rendered as sibling above `<DashboardShell>` in App.tsx (top-anchored via fixed positioning).
- `<CheckForUpdatesButton />` wrapped in `<div className="settings-update-card">` between `<SettingsPanel />` and `<div className="settings-qr-code">` in `currentSection === "settings"` branch.
- `.settings-update-card { margin-top: 1.5rem; }` added to App.css.
- `npm test` exits 0 with all suites green (relative-time, useFocusTrap, updateStateMachine, useUpdateState, UpdateToast, CheckForUpdatesButton).
- `npm run test:coverage` exits 0 — per-file thresholds met (100% on `src/lib/relative-time.ts`, `src/hooks/updateStateMachine.ts`, `src/hooks/useUpdateState.ts`; ≥90% on each component dir).
- `npm run build` exits 0 (`tsc -b && vite build` both green).
- `git diff --stat src-tauri/` empty.
- `git diff src/components/SettingsPanel.tsx` empty.
- Lighthouse ≥95 documented as deferred manual UAT step in SUMMARY.md (NOT a blocking gate for plan completion).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Tauri IPC (frontend ↔ Rust) | Frontend invokes `update_*` commands; Rust returns Result<T, String>. Errors stringified at boundary. |
| Tauri events (Rust → frontend) | dispatcher.rs emits typed payloads; frontend deserializes camelCase JSON. |
| Browser DOM (user input) | Click handlers wired directly to invoke() — no intermediate parsing. |
| Listener PWA (separate codebase) | OUT OF SCOPE — Phase 4 only touches src/* (admin UI), not listener/. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-wqg-01 | Tampering | Event payload spoofing from compromised Tauri runtime | accept | Tauri runtime is the trust root; frontend cannot defend against compromised runtime. Phase 3 already enforces this boundary via Rust `Emitter` API. |
| T-wqg-02 | Information Disclosure | Update notes rendered in DOM contain user-controlled GitHub release body | mitigate | React 19 escapes string children by default. NO `dangerouslySetInnerHTML` anywhere in this phase. notes rendered via `{display}` text node + aria-label string only. |
| T-wqg-03 | Denial of Service | Listener registration race / double-fire under StrictMode | mitigate | aborted-flag pattern in useUpdateState (per repo decision [01-08]). Test verifies single net subscription after mount/unmount/remount. |
| T-wqg-04 | Spoofing | Skip button bypassing user intent (e.g. accidental click) | accept | One-click skip per locked CONTEXT decision (Linear/Slack pattern). Reversible — any newer version triggers fresh prompt. No confirmation modal. |
| T-wqg-05 | Tampering | Notes truncation losing security-relevant text (e.g. "CRITICAL FIX" dropped at char 81) | mitigate | Full notes preserved in sr-only span + container aria-label. Screen readers and copy-paste users get full text; sighted users see "…" cue. |
| T-wqg-06 | Repudiation | User claims they did NOT click Install but plugin ran anyway | accept | invoke() resolves only after click event handler fires. No telemetry pipeline in v1. Rust-side `update_install` re-fetches manifest (Phase 3 MA-02 race window) — defer to v2. |
| T-wqg-07 | Information Disclosure | console.warn leaking IPC error details to dev console | mitigate | Only logged in two narrow paths (registration failure + check_now failure). Production builds inherit Vite's minification + no separate telemetry transport. |
| T-wqg-08 | Elevation of Privilege | Update install requires elevated permissions on Windows | accept | Tauri `installMode: passive` (Phase 3) handles UAC handoff. Frontend has no role; `update_install` is the only path that triggers it. |
| T-wqg-09 | Tampering | totalBytes manipulated to cause UI to show fake 100% during slow download | mitigate | UI computes percent from server-supplied bytes; trust boundary is Rust → JS. If totalBytes==0, UI shows indeterminate spinner per trip-wire #3 (no false 100%). |
</threat_model>

<verification>
**Per-task automated gates** (each task lists its own command); the phase-level acceptance run is:

```bash
npm test                # all suites green
npm run test:coverage   # per-file thresholds met
npm run build           # tsc + vite both clean
git diff --stat src-tauri/    # must be empty
git diff src/components/SettingsPanel.tsx  # must be empty
```

**Coverage matrix verification** (read from `coverage/coverage-summary.json` or terminal "text" reporter output after `test:coverage`):

| File / Glob | Required | Tier |
|-------------|----------|------|
| `src/lib/relative-time.ts` | 100% all metrics | hooks/lib |
| `src/hooks/updateStateMachine.ts` | 100% all metrics | hooks/lib |
| `src/hooks/useUpdateState.ts` | 100% all metrics | hooks/lib |
| `src/components/UpdateToast/**` | ≥90% all metrics | component |
| `src/components/CheckForUpdatesButton/**` | ≥90% all metrics | component |

If a file falls below threshold, vitest exits non-zero and `npm run test:coverage` fails.

**Trip-wire compliance audit** (manual code-review pass before declaring done):

| Trip-Wire | How Verified |
|-----------|--------------|
| #1 No "Restart" button | Grep `src/components/UpdateToast/` for "restart" — must not appear in JSX. |
| #2 camelCase payloads | Grep useUpdateState.ts for `downloadUrl`, `downloadedBytes`, `totalBytes` — all present. |
| #3 totalBytes:0 indeterminate | UpdateToast.test.tsx covers this branch explicitly. |
| #4 update_check_now no events for SilentSkip/NoUpdate | useUpdateState.checkNow dispatches checkCompleted from return value, not events. |
| #5 install re-fetches manifest | Frontend not concerned (Rust-side, deferred MA-02). |
| #6 Placeholder pubkey | Frontend not concerned. |
| #7 last_check_unix stale signal | CheckForUpdatesButton renders "never" when 0 (humanized via formatRelativeTime). |
| #8 Capabilities already exposed | Frontend uses listen()/invoke() — no new capability requests. |
| #9 NSIS passive installer | Installing toast text mentions "app will restart automatically" — aligned. |
| #10 platform_key x86_64+aarch64 | Frontend not concerned. |
</verification>

<success_criteria>
Phase 4 complete when ALL of:

1. Six tasks above all marked done with their `<verify>` commands green.
2. `npm test` exits 0; `npm run test:coverage` exits 0 with thresholds met; `npm run build` exits 0.
3. Zero diff under `src-tauri/`. Zero diff in `src/components/SettingsPanel.tsx`.
4. All 17 truths in `must_haves.truths` verifiable by code inspection or test output.
5. All 25 artifacts in `must_haves.artifacts` exist on disk with the right exports/contents.
6. All 5 key_links in `must_haves.key_links` traceable via grep.
7. SUMMARY.md notes Lighthouse ≥95 as deferred manual UAT (not an automated gate).
8. Tiger-Style audit (manual checklist):
   - No console.log (only console.warn for IPC failures).
   - No nested ifs (max one level inside any function).
   - All functions ≤50 lines.
   - All numeric thresholds named constants (NOTES_TRUNCATE_LIMIT, HUMANIZE_TICK_MS, RESULT_DISPLAY_MS, SECONDS_PER_*, FUTURE_TOLERANCE_SECONDS, RESULT_DISPLAY_MS).
   - All file/symbol names self-explanatory per CLAUDE.md.
   - DRY: formatRelativeTime used in CheckForUpdatesButton and tests; updateReducer factored out for cheap pure tests.
9. CONTEXT.md decisions honored:
   - useReducer in useUpdateState (no zustand) ✓
   - "Later" → invoke("update_dismiss") ✓
   - "Skip" → invoke("update_skip_version", { version }) one-click ✓
   - Button card sibling under SettingsPanel ✓
   - Installing: spinner + "app will restart automatically", no Restart button ✓
   - Vitest 4.1.5 + coverage-v8 + RTL 16.3.2 + jsdom 29.1.1 ✓
   - CSS Modules per component ✓
   - Vendored useFocusTrap (no focus-trap-react) ✓
</success_criteria>

<output>
After completion, create `.planning/quick/260501-wqg-phase-4-auto-updater-react-ui-components/260501-wqg-SUMMARY.md` with:

- Frontmatter: quick_id, description, status: complete, commits list, duration, tests {default, coverage_pass: true}, lighthouse_deferred: true.
- Section "What Was Built" — one paragraph per task (6 paragraphs).
- Section "Acceptance Command Output" — verbatim output of `npm test`, `npm run test:coverage` (table), `npm run build`.
- Section "Tiger-Style + DRY/SRP Audit" — checklist passing each rule.
- Section "Trip-Wire Compliance" — table mapping each of 10 Phase 3 trip-wires to the file/test that honors it.
- Section "Manual UAT Deferred" — Lighthouse ≥95 (DevTools), real-update install (requires user to swap pubkey + tag release).
- Section "Phase 5 Inheritance Notes" — none expected; Phase 5 is GitHub Actions CI.
- Section "Self-Check" — file-existence checks for all 25 artifacts.
</output>
