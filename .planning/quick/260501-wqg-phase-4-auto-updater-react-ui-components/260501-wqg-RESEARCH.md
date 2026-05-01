---
name: 260501-wqg-RESEARCH
description: Phase 4 React UI auto-updater research — versions, patterns, pitfalls
type: quick-research
quick_id: 260501-wqg
date: 2026-05-01
confidence: HIGH
---

# Research: Phase 4 React UI Auto-Updater

**Researched:** 2026-05-01
**Domain:** React 19 + Vitest + RTL + Tauri v2 IPC events
**Confidence:** HIGH (all versions verified `npm view`, all Tauri patterns from existing Phase 3 contract in repo)

## Summary

Phase 4 stack pins minimal new devDeps onto React 19.2 / Vite 7.2 / TypeScript 5.9 already in `package.json`. Vitest 4.1.5 + `@testing-library/react` 16.3.2 (peer-dep range `^18.0.0 || ^19.0.0` — verified). `@tauri-apps/api` 2.5 already installed; no new runtime deps. Pattern: `useReducer` + discriminated-union actions inside one `useUpdateState` hook; `useEffect` registers `listen<T>(...)` from `@tauri-apps/api/event`, returns the unlisten cleanup. ARIA: `role="status"` + `aria-live="polite"` for non-urgent (`UpdateAvailable`/`Downloading`/`Installing`); reserve `role="alert"` for errors only. Focus-trap during `Installing` is vendored (~40 lines), no library. CSS Modules zero-config in Vite — strict TS needs one `*.d.ts` ambient declaration.

**Primary recommendation:** Pin exact versions below; one `vitest.config.ts` at repo root; one `src/test-setup.ts` with `vi.mock` for `@tauri-apps/api/core` + `@tauri-apps/api/event`; reducer is a pure function exported separately for cheap unit tests.

---

## Pinned Versions + DevDeps

Add to root `package.json` `devDependencies` (alphabetical to match existing pattern):

```json
"@testing-library/jest-dom": "^6.9.1",
"@testing-library/react": "^16.3.2",
"@testing-library/user-event": "^14.6.1",
"@vitest/coverage-v8": "^4.1.5",
"jsdom": "^29.1.1",
"vitest": "^4.1.5"
```

**Verification (`npm view <pkg> version` on 2026-05-01):**
- vitest 4.1.5 — current
- @vitest/coverage-v8 4.1.5 — version-locked to vitest
- @testing-library/react 16.3.2 — peerDeps `react: ^18.0.0 || ^19.0.0`, `@testing-library/dom: ^10.0.0` (auto-installed transitively)
- @testing-library/jest-dom 6.9.1 — current
- @testing-library/user-event 14.6.1 — current
- jsdom 29.1.1 — current

**No runtime deps to add.** `@tauri-apps/api` ^2.5.0 + `@tauri-apps/plugin-process` ^2 + `@tauri-apps/plugin-updater` ^2 already in `dependencies`. Phase 4 imports `invoke` from `@tauri-apps/api/core` and `listen` from `@tauri-apps/api/event` (NOT `@tauri-apps/plugin-updater` directly — Phase 3 dispatcher.rs emits raw `update:*` events, frontend subscribes to those).

**Add to `package.json` `scripts`:**
```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

`npm test` runs once + exits (CI default). `test:coverage` is opt-in (coverage adds ~30% wall time); master plan acceptance only requires `npm test` green, run `test:coverage` manually before phase verify.

---

## Vitest + RTL Minimal Config

### `vitest.config.ts` (repo root)

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
        "src/hooks/useUpdateState.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/lib/relative-time.ts":    { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/components/UpdateToast/**":            { lines: 90, functions: 90, branches: 90, statements: 90 },
        "src/components/CheckForUpdatesButton/**":  { lines: 90, functions: 90, branches: 90, statements: 90 },
      },
    },
  },
});
```

Notes:
- `globals: false` — explicit `import { describe, it, expect, vi } from "vitest"`. Tiger-Style: no implicit ambient identifiers.
- `css: true` — Vite processes CSS Modules so `import styles from "./X.module.css"` returns the keyed object in tests (otherwise undefined).
- Per-file thresholds use globs as keys (Vitest 4.x supports). Validated: matches `@vitest/coverage-v8` 4.1.5 schema.
- `tsconfig.json` already has `"jsx": "react-jsx"`; Vitest reuses Vite's React plugin so JSX transform stays consistent with prod build.

### `src/test-setup.ts`

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Mock Tauri IPC surfaces. Tests opt in to invoke/listen behaviour per-suite
// via vi.mocked(invoke).mockResolvedValueOnce(...) etc.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),  // default: registers ok, returns no-op unlisten
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
  exit: vi.fn(),
}));
```

`@testing-library/jest-dom/vitest` extends `expect` with DOM matchers (`toBeInTheDocument`, `toHaveAttribute`, etc.). Vitest-specific entry point — DON'T import `@testing-library/jest-dom` (the old jest entry point).

### `tsconfig.json` patch

Existing root `tsconfig.json` extended; add to `compilerOptions.types`:
```json
"types": ["vitest/globals", "@testing-library/jest-dom"]
```
(only if you flip `globals: true`; with `globals: false` you can omit `vitest/globals`). Add `vitest.config.ts` to `include`.

---

## useReducer + Tauri Listen Pattern

### Action + state shape (discriminated unions)

```ts
// src/hooks/updateStateMachine.ts
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

export function updateReducer(state: UpdateUiState, action: UpdateAction): UpdateUiState {
  switch (action.type) {
    case "available":
      return { kind: "UpdateAvailable", version: action.version, notes: action.notes, downloadUrl: action.downloadUrl };
    case "progress": {
      // Guard: only valid if Downloading or transitioning from UpdateAvailable on first chunk.
      if (state.kind !== "Downloading" && state.kind !== "UpdateAvailable") return state;
      const version = state.kind === "Downloading" ? state.version : state.version;
      return { kind: "Downloading", version, downloadedBytes: action.downloadedBytes, totalBytes: action.totalBytes };
    }
    case "installed":
      return { kind: "Installing", version: action.version };
    case "checkCompleted":
      if (action.updateOffered) return state;  // available event will arrive separately
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

Reducer is pure, exported separately, 100% unit-test coverage trivial (one `it()` per `(state.kind × action.type)` combo).

### Hook with listener registration (StrictMode-safe)

```ts
// src/hooks/useUpdateState.ts
import { useEffect, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { updateReducer, type UpdateUiState, type UpdateAction } from "./updateStateMachine";
import type { UpdateState } from "../lib/types";

const INITIAL: UpdateUiState = { kind: "Idle" };

interface AvailableEvent { version: string; notes: string; downloadUrl: string }
interface ProgressEvent  { downloadedBytes: number; totalBytes: number }
interface InstalledEvent { version: string }

export function useUpdateState() {
  const [state, dispatch] = useReducer(updateReducer, INITIAL);
  const [persisted, setPersisted] = useState<UpdateState | null>(null);

  // Listener registration. Effect re-fires under StrictMode in dev — the
  // returned cleanup unlistens the FIRST registration before the SECOND
  // registers, so no double-fire in production builds. Always rely on the
  // returned UnlistenFn — it is the contract.
  useEffect(() => {
    let cancelled = false;
    const unlistens: UnlistenFn[] = [];

    (async () => {
      const a = await listen<AvailableEvent>("update:available", (e) => {
        dispatch({ type: "available", ...e.payload });
      });
      const p = await listen<ProgressEvent>("update:download:progress", (e) => {
        dispatch({ type: "progress", ...e.payload });
      });
      const i = await listen<InstalledEvent>("update:installed", (e) => {
        dispatch({ type: "installed", version: e.payload.version });
      });
      if (cancelled) {
        a(); p(); i();
        return;
      }
      unlistens.push(a, p, i);
    })().catch((err) => {
      // Tauri runtime missing (e.g. running in plain browser preview).
      // Logged once, no UI impact — events simply never arrive.
      console.warn("update event listener registration failed", err);
    });

    return () => {
      cancelled = true;
      for (const u of unlistens) u();
    };
  }, []);

  // Initial state hydrate from disk (UpdateState from Phase 3 storage.rs)
  useEffect(() => {
    invoke<UpdateState>("update_get_state")
      .then(setPersisted)
      .catch((err) => console.warn("update_get_state failed", err));
  }, []);

  const checkNow = async (): Promise<UpdateState> => {
    const result = await invoke<UpdateState>("update_check_now");
    setPersisted(result);
    dispatch({ type: "checkCompleted", lastCheckUnix: result.last_check_unix, updateOffered: state.kind === "UpdateAvailable" });
    return result;
  };

  const install   = async () => invoke<void>("update_install");
  const dismiss   = async () => { await invoke<void>("update_dismiss"); dispatch({ type: "dismissed" }); };
  const skip      = async (version: string) => { await invoke<void>("update_skip_version", { version }); dispatch({ type: "skipped", version }); };

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

**Key constraints honored:**
- `cancelled` flag — StrictMode double-effect-fire safety. First effect's cleanup runs `cancelled = true; unlistens[]`; second effect re-registers cleanly.
- `listen()` is async — race window between effect mount and first event arrival is unavoidable. Phase 3 backend is push-only for `update:available`; on the rare race, `update_check_now` re-fetches and the user sees state on next bg cycle (max 6h). Acceptable.
- No `useCallback` / `useMemo` wrapping the action creators — React 19 + the React Compiler era discourages premature memoization. If a child component complains about referential stability later, fix it at consumer site, not here.
- No `React.FC` (deprecated pattern). Hook returns object literal; consumers destructure.

### Testing the hook

Reducer test (pure, no React):
```ts
import { describe, it, expect } from "vitest";
import { updateReducer } from "./updateStateMachine";

describe("updateReducer", () => {
  it("transitions Idle -> UpdateAvailable on available action", () => {
    const next = updateReducer({ kind: "Idle" }, { type: "available", version: "0.2.0", notes: "x", downloadUrl: "u" });
    expect(next).toEqual({ kind: "UpdateAvailable", version: "0.2.0", notes: "x", downloadUrl: "u" });
  });
  // ... one test per (state.kind × action.type) combo
});
```

Hook test with mocked `listen`:
```ts
import { renderHook, act } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { useUpdateState } from "./useUpdateState";

it("registers three listeners on mount and unlistens on unmount", async () => {
  const unlistenSpies = [vi.fn(), vi.fn(), vi.fn()];
  vi.mocked(listen)
    .mockResolvedValueOnce(unlistenSpies[0])
    .mockResolvedValueOnce(unlistenSpies[1])
    .mockResolvedValueOnce(unlistenSpies[2]);

  const { unmount } = renderHook(() => useUpdateState());
  await act(async () => { /* flush microtasks */ });

  expect(listen).toHaveBeenCalledWith("update:available",         expect.any(Function));
  expect(listen).toHaveBeenCalledWith("update:download:progress", expect.any(Function));
  expect(listen).toHaveBeenCalledWith("update:installed",         expect.any(Function));

  unmount();
  for (const spy of unlistenSpies) expect(spy).toHaveBeenCalledOnce();
});
```

`renderHook` from `@testing-library/react` (16.x exports it). To dispatch a fake event payload in tests, capture the handler arg from `vi.mocked(listen).mock.calls[0][1]` and invoke it directly.

---

## ARIA Toast Pattern

### Role decision matrix

| State                | Role        | aria-live   | Why |
|----------------------|-------------|-------------|-----|
| `Idle`               | (no toast rendered) | — | hidden |
| `UpdateAvailable`    | `status`    | `polite`    | Non-urgent — user reads, picks button. Polite waits for screen-reader idle. |
| `Downloading`        | `status`    | `polite`    | Progress updates flood; assertive would interrupt user. `aria-busy="true"` while downloading. |
| `Installing`         | `status`    | `polite`    | Per CONTEXT decision: `<output role="status" aria-live="polite">Installing — the app will restart automatically</output>`. |
| `UpToDate` (inline result) | `status` | `polite` | Confirmation, non-blocking. |
| `error` (future)     | `alert`     | `assertive` | Only for actual failures. Reserved — Phase 4 doesn't yet emit error events. |

**Rule:** `role="status"` implies `aria-live="polite"` + `aria-atomic="true"` by default. Explicit `aria-live` belt-and-suspenders for older AT.

**`role="alert"` reserved for errors only.** Don't use for "Update available" — it interrupts whatever the user is doing, hostile UX.

### aria-live remount pitfall

**Pitfall:** Screen readers ONLY announce changes within an existing live region. If you mount/unmount the toast root on each state change, AT misses announcements.

**Fix:** Keep the toast container always mounted with a stable `role="status"` element; toggle visibility with CSS (transform/opacity). Children swap in place — AT picks up text changes inside the live region.

```tsx
// UpdateToast.tsx — outer always-mounted, inner content state-driven
export function UpdateToast() {
  const { state, install, dismiss, skip } = useUpdateState();
  const visible = state.kind !== "Idle";
  return (
    <div
      className={styles.toastRoot}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-visible={visible}
      data-state={state.kind}
    >
      {state.kind === "UpdateAvailable" && <AvailableContent state={state} onInstall={install} onLater={dismiss} onSkip={() => skip(state.version)} />}
      {state.kind === "Downloading"     && <DownloadingContent state={state} />}
      {state.kind === "Installing"      && <InstallingContent state={state} />}
    </div>
  );
}
```

CSS hides via `transform: translateY(-100%); pointer-events: none;` on `[data-visible="false"]` — element stays in DOM tree, AT live region preserved.

### Focus-trap (vendored, ~40 lines)

```ts
// src/lib/useFocusTrap.ts
import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    first?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      if (focusables.length === 0) { e.preventDefault(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); return; }
      if (!e.shiftKey && document.activeElement === last)  { e.preventDefault(); first.focus(); return; }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [active, containerRef]);
}
```

Activate when `state.kind === "Installing"` per CONTEXT decision (no buttons, but Tab-order should be parked inside the toast region so the user can't accidentally tab into background controls that are about to vanish on process exit).

### Reduced motion + visually-hidden text

```css
/* UpdateToast.module.css */
.toast-root {
  transform: translateY(0);
  transition: transform 240ms ease-out;
}
.toast-root[data-visible="false"] {
  transform: translateY(-100%);
  transition: transform 180ms ease-in;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .toast-root { transition: none; }
}

/* For full-notes screen-reader text when visually truncated */
.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
  white-space: nowrap;
  border: 0;
}
```

Use `<span className={styles.srOnly}>{fullNotes}</span>` paired with visible truncated text + `aria-label={fullNotes}` on container — AT users get full notes, sighted users see 80-char truncation per master plan.

---

## CSS Modules + Vite

Vite handles `*.module.css` zero-config. File `Component.module.css` exports an object with class names; class names are auto-hashed (e.g. `_toast-root_a1b2c`).

### Naming convention

Use **kebab-case** in CSS, access via **bracket notation** in TS:
```css
/* UpdateToast.module.css */
.toast-root { ... }
.button-primary { ... }
```
```tsx
import styles from "./UpdateToast.module.css";
<div className={styles["toast-root"]}>
```

OR Vite's `css.modules.localsConvention: "camelCase"` setting maps kebab-case CSS to camelCase TS keys. Existing project does NOT set this (checked `vite.config.ts` indirectly via convention). **Recommend bracket notation** — explicit, no Vite-config sneak-dep, lets `Component.module.css` files be authored with conventional CSS naming.

### TypeScript ambient declaration (one file, repo-wide)

```ts
// src/css-modules.d.ts
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
```

Without this file, `tsc -b` fails on `import styles from "./X.module.css"` under strict mode. `Readonly<Record<string, string>>` — typed but permissive (no per-file generated types; we don't need that level for 4 components). Add to `tsconfig.json` `include` if not already covered by `src/**`.

---

## Coverage Thresholds

Per-file thresholds documented above in `vitest.config.ts`. Two threshold tiers:

| Glob | Threshold | Rationale |
|------|-----------|-----------|
| `src/hooks/useUpdateState.ts` | 100% | Pure-function reducer + thin effect; trivial to cover. Master plan :540 mandates 100% on hooks. |
| `src/lib/relative-time.ts`    | 100% | Pure formatter, 14+ test cases per CONTEXT. Master plan :540 mandates 100% on lib. |
| `src/components/UpdateToast/**`           | 90% | Render + click branches per state; 90% leaves room for trivially-untestable defensive branches. |
| `src/components/CheckForUpdatesButton/**` | 90% | Same rationale. |

Coverage runs only via `npm run test:coverage` (opt-in). Default `npm test` runs unit tests only (faster CI feedback). Before declaring phase done, agent runs `test:coverage` and pastes the table to SUMMARY.md.

---

## Pitfalls (mapped to Phase 3 trip-wires)

1. **`update:installed` = "install starting" (TW#1).** UI must NOT render "Restart now" or wait for "install complete" event. State machine transitions UpdateAvailable | Downloading -> Installing on this event; Installing is terminal until process exits. CONTEXT decision honored: indeterminate spinner + auto-restart text only.

2. **`totalBytes: 0` = unknown size (TW#3, MI-01).** Render indeterminate CSS spinner, NEVER `0%`. Component logic:
   ```tsx
   {state.kind === "Downloading" && (
     state.totalBytes > 0
       ? <progress max={state.totalBytes} value={state.downloadedBytes} />
       : <div className={styles.spinnerIndeterminate} aria-label="downloading, size unknown" />
   )}
   ```

3. **`update_check_now` does NOT emit on SilentSkip / NoUpdate (TW#4, MI-03).** `<CheckForUpdatesButton />` reads the returned `UpdateState` (not events) to render inline result. Reducer dispatch `checkCompleted` carries `updateOffered: boolean` so the UI knows whether to wait for the `available` event or render "Up to date" / "Skipped — v0.1.5".

4. **Listen() race — events arrive before listener registers.** Phase 3 bg loop fires `update:available` only on cycles where an update exists; first cycle is at app startup. If the React tree mounts AFTER the bg loop's first emit, the event is lost. Mitigation: hydrate via `invoke("update_get_state")` on mount (returns persisted `UpdateState`); if a recent skip/dismiss isn't reflected, user can click "Check now" to force a fresh check. Not a blocker for v1.

5. **StrictMode double-effect-fire = double listener registration.** Mitigated via `cancelled` flag pattern in `useUpdateState`. Verify in `tsx` test: mount + immediate unmount + remount, expect 3 listeners net (not 6). Also verified by repo precedent — `[01-08]` decision in MEMORY.md mandates aborted-flag for async useEffect.

6. **Tab-key focus order during Installing.** `useFocusTrap(active=true)` cycles Tab inside the toast. Without trap, Tab-key takes user into background `SettingsPanel` form which is about to vanish on installer launch. Confusing.

7. **`role="alert"` overuse interrupts screen reader.** Use `role="status"` for normal flow; reserve `alert` for errors. CONTEXT decision aligned.

8. **CSS class collision with global `App.css`.** Existing `settings-qr-code` / `settings-log-viewer` / `settings-update-card` are global classes in `App.css`. New components use CSS Modules so internal classes auto-hash; only the wrapper div in `App.tsx` needs the global class. No collision.

9. **Mock returns Promise of UnlistenFn — common test typo.** `vi.mocked(listen).mockResolvedValueOnce(() => {})` — unlisten is a sync fn. Returning a Promise here breaks cleanup with `TypeError: u is not a function`. Test setup default in `src/test-setup.ts` uses `async () => () => {}` — note the bare arrow inside.

10. **`@tauri-apps/api/core` invoke camelCase arg names.** Phase 3 `update_skip_version(version: String, ...)` — frontend calls `invoke("update_skip_version", { version })`. Tauri auto-converts arg names via `serde::Deserialize` rename rules; current Rust signature uses `version` (no rename), so JS passes `{ version }`. Verified in `commands.rs:160-167`.

11. **Listener PWA tree-shake (MI-05).** Out of scope — listener PWA never imports `@tauri-apps/plugin-*`. Confirm by `grep` in `listener/src/` (separate codebase). NOT a Phase 4 blocker.

12. **Pubkey placeholder still in `tauri.conf.json` in dev (TW#6).** `cargo build` succeeds; `updater.check()` succeeds; signature only verified at download time. Phase 4 UI tests don't trigger real downloads (everything mocked). UAT hits this only if user clicks "Update now" against a real release before swapping pubkey — `update_install` returns `Err` with Minisign error; toast renders error state. Defer real-update UAT until manual step #4 from Phase 3 SUMMARY done.

---

## Recommended File Layout

```
src/
├── App.tsx                                 (edit: add <UpdateToast /> + <CheckForUpdatesButton />)
├── css-modules.d.ts                        (NEW: ambient declaration)
├── test-setup.ts                           (NEW: vi.mock + jest-dom + cleanup)
├── components/
│   ├── UpdateToast/
│   │   ├── UpdateToast.tsx                 (NEW)
│   │   ├── UpdateToast.module.css          (NEW)
│   │   ├── UpdateToast.test.tsx            (NEW)
│   │   └── index.ts                        (NEW: barrel re-export)
│   └── CheckForUpdatesButton/
│       ├── CheckForUpdatesButton.tsx       (NEW)
│       ├── CheckForUpdatesButton.module.css (NEW)
│       ├── CheckForUpdatesButton.test.tsx  (NEW)
│       └── index.ts                        (NEW: barrel re-export)
├── hooks/
│   ├── useUpdateState.ts                   (NEW)
│   ├── useUpdateState.test.ts              (NEW: hook + listener tests)
│   ├── updateStateMachine.ts               (NEW: reducer + types, exported separately)
│   └── updateStateMachine.test.ts          (NEW: pure reducer tests)
├── lib/
│   ├── relative-time.ts                    (NEW: pure formatter)
│   ├── relative-time.test.ts               (NEW)
│   ├── types.ts                            (NEW: UpdateState mirror of Rust storage.rs)
│   └── useFocusTrap.ts                     (NEW: vendored ~40-line trap)

vitest.config.ts                            (NEW at repo root)
package.json                                (edit: devDeps + scripts)
tsconfig.json                               (edit: include vitest.config.ts; possibly types)
```

**SRP boundaries:**
- `useUpdateState.ts` — IPC + effect side; consumes `updateReducer` and exposes action functions.
- `updateStateMachine.ts` — pure reducer + types; testable without React.
- `relative-time.ts` — pure formatter; testable in isolation.
- `useFocusTrap.ts` — generic hook; doesn't know about updates; reusable.

---

## Phase 4 Tauri Event Subscription — Canonical Snippet

The single most-copied snippet for executors:

```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface UpdateAvailablePayload {
  version: string;
  notes: string;
  downloadUrl: string;     // camelCase per dispatcher.rs `#[serde(rename_all = "camelCase")]`
}

const unlisten: UnlistenFn = await listen<UpdateAvailablePayload>(
  "update:available",
  (event) => {
    // event.payload typed; event.id, event.windowLabel also available
    console.log("update:", event.payload.version);
  }
);

// Later (e.g. effect cleanup):
unlisten();
```

Event name strings exactly as emitted by Phase 3 `dispatcher.rs` + `commands.rs:121`:
- `"update:available"` — payload `{ version, notes, downloadUrl }`
- `"update:download:progress"` — payload `{ downloadedBytes, totalBytes }`
- `"update:installed"` — payload `{ version }` (semantically "install starting" per TW#1)

---

## Sources

### Primary (HIGH confidence)
- `package.json` (root) — confirmed React 19.2, Vite 7.2, Tauri 2.5, plugin-updater 2.x already installed.
- `src-tauri/src/update/commands.rs` — exact Tauri command signatures + arg names.
- `src-tauri/src/update/storage.rs` — `UpdateState { last_check_unix, last_dismissed_unix, skipped_versions }` shape.
- `260501-uon-SUMMARY.md` Phase 4 trip-wires — 10 inheritance rules.
- `npm view <pkg> version` runs (2026-05-01) — vitest 4.1.5, @vitest/coverage-v8 4.1.5, @testing-library/react 16.3.2, @testing-library/jest-dom 6.9.1, @testing-library/user-event 14.6.1, jsdom 29.1.1.
- `npm view @testing-library/react peerDependencies` — confirmed `react: ^18.0.0 || ^19.0.0`.

### Secondary (MEDIUM confidence)
- React 19 RFC + docs — useReducer + StrictMode double-fire patterns; no `React.FC`; minimal `useCallback` (training data + Vercel/Next docs as of late 2025).
- WAI-ARIA Authoring Practices 1.2 — `role="status"` vs `role="alert"`; `aria-live` polite/assertive semantics.
- Tauri v2 docs — `listen()` returns `Promise<UnlistenFn>`; effect cleanup pattern.

### Repo precedent (HIGH confidence)
- `[01-08]` MEMORY decision: aborted-flag pattern for async useEffect (StrictMode safety) — reused in `useUpdateState`.
- Existing `src/hooks/useServerStatus.ts` etc. follow `useReducer`-style hook patterns (verified in `App.tsx` import block).

---

## Metadata

**Confidence breakdown:**
- Pinned versions: HIGH — verified `npm view` 2026-05-01.
- useReducer + listen pattern: HIGH — Phase 3 contract is in repo; React 19 idioms well-established.
- ARIA roles: HIGH — WAI-ARIA 1.2 spec is stable, role/aria-live semantics unambiguous.
- CSS Modules: HIGH — Vite zero-config + ambient declaration is a 5-year stable pattern.
- Coverage tooling: HIGH — `@vitest/coverage-v8` per-file thresholds documented in vitest 4.x schema.
- Pitfalls: HIGH for items 1-10 (mapped to Phase 3 trip-wires + repo precedent); MEDIUM for item 11 (separate codebase).

**Research date:** 2026-05-01
**Valid until:** 2026-06-01 (one month — vitest 4.x is current stable; React 19.2 is stable; Tauri 2.5 contract frozen for Phase 4 by trip-wires).
