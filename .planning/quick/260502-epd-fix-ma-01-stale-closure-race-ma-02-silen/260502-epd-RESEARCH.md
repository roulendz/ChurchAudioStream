# Research: Review-Fix Patterns (260502-epd)

**Researched:** 2026-05-02
**Domain:** React 19 hooks + Vitest 4 + RTL 16 — race-window testing, DRY IPC error handling, codepoint-safe truncation, JSDoc conventions
**Confidence:** HIGH (verified against in-repo source + locked CONTEXT.md decisions)

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **MA-01:** Drop `updateOffered` from `checkCompleted` action. Reducer inspects `state.kind` (returns state if `UpdateAvailable | Downloading | Installing`, else `UpToDate`). Hook passes only `lastCheckUnix`.
- **MA-02:** DRY helper `dispatchOnSuccess(commandName, args, action)` defined INSIDE `useUpdateState` closure (reads `dispatch`). Skip-dispatch on failure. `install` warns only (no dispatch — installer takes over per TW#1). `dismiss` + `skip` dispatch on success.
- **MI-01 + MI-02:** New module `src/lib/sanitize-notes.ts` exports `stripBidiControls`, `truncateNotesSafe`, `sanitizeReleaseNotes` (composition). Constants `BIDI_CONTROL_CHARS_RE` + `NOTES_TRUNCATE_LIMIT = 80` live there. 100% lib coverage. 14+ test cases.
- **MI-03:** JSDoc `@remarks` block at top of `useFocusTrap.ts` documenting snapshot quirk. No code change.
- **MI-04:** Delete no-op test at `CheckForUpdatesButton.test.tsx:91-104`. Coverage threshold (90%) must still pass.
- **MI-05:** Inline JSONC comment next to `verbatimModuleSyntax: true` in `tsconfig.node.json`.
- **Atomic commits:** 6 total — one per finding (MI-01+MI-02 combined). Format: `fix(quick-260502-epd): <ID> <one-liner>`.
- **No new dependencies.** No zustand. No `Intl.Segmenter`. No new lib.
- **Coverage thresholds unchanged:** 100% hooks/lib, 90% components.

### Claude's Discretion
- Exact wording of warn messages (precedent: `"<command_name>_failed"` lowercase, see CheckForUpdatesButton.tsx:39 + useUpdateState.ts:55,67).
- Test layout / naming inside the existing `describe` blocks.
- Whether to add a sanitize-notes test for "only-controls input" or keep to the 14 listed in CONTEXT.

### Deferred Ideas (OUT OF SCOPE)
- Phase 5 CI workflow.
- src-tauri/* changes (Phase 3 contract is fixed).
- src/components/SettingsPanel.tsx sibling-card placement (locked from 260501-wqg).
- Extracting `buildResultMessage` from CheckForUpdatesButton (deferred per MI-04 reasoning).
- `Intl.Segmenter` grapheme-perfect truncation (codepoint-safe is sufficient per MI-02 trade-off).
- `MutationObserver`-based focus-trap rebuild (per MI-03 reasoning).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MA-01 | Stale-closure race in `checkNow` | §1 race-window test pattern + §6 file-map (drop `updateOffered` from action type, hook, reducer) |
| MA-02 | Silent IPC error swallow in `install` / `dismiss` / `skip` | §2 DRY hook-internal helper + §6 file-map |
| MI-01 | Strip RTL/bidi control chars from notes | §3 codepoint-safe truncation + bidi strip |
| MI-02 | Surrogate-pair-safe truncation | §3 (same module) |
| MI-03 | Document `useFocusTrap` snapshot quirk | §4 JSDoc `@remarks` convention |
| MI-04 | Delete no-op test | §5 pitfall #4 (coverage math) |
| MI-05 | `verbatimModuleSyntax` gotcha note | §5 pitfall #5 |

## Project Constraints (from CLAUDE.md)

- **DRY** — extract shared logic. MA-02 helper is the canonical instance. MI-01+MI-02 sanitize-notes module is the second.
- **SRP** — reducer pure (no IO), hook owns IPC + error handling, components only render. Sanitize-notes lib has zero React/IO dependencies.
- **Self-explanatory naming** — `dispatchOnSuccess`, `BIDI_CONTROL_CHARS_RE`, `NOTES_TRUNCATE_LIMIT`, `truncateNotesSafe`, `sanitizeReleaseNotes`. NOT `dispatch2`, `re`, `clean`, `truncate`.
- **Tiger-Style** fail fast/hard — but for IPC, "fail fast" means warn-and-skip-dispatch (preserve user retry chance), NOT throw uncaught (would crash React 19 silently).
- **No nested if-in-if-in-if** — reducer guard is flat `if … return; if … return; if … return; return …`. Helper is flat `try { await; dispatch; } catch { warn; return; }`. No three-deep ternaries in `truncateNotesSafe`.
- **Each function tested** — `dispatchOnSuccess` indirectly tested via the 3 commands. Sanitize-notes pure functions get full unit suite.

---

## 1. Race-window test pattern (deferred promise + mocked listen)

**Goal:** Prove pre-fix code FAILS, post-fix code PASSES. Test must simulate `update:available` event arriving DURING `await invoke("update_check_now")`.

**Pattern: deferred-resolution promise + handler capture.** Both primitives already exist in this codebase — combine them.

**Existing primitive 1** (`useUpdateState.test.ts:82-86`): handler capture via `vi.mocked(listen).mockImplementation`.

**Existing primitive 2** (`CheckForUpdatesButton.test.tsx:40-43`): deferred-resolution `let resolveCheck; new Promise(res => { resolveCheck = res; })`.

### Snippet (drop into `useUpdateState.test.ts`)

```ts
it("MA-01 regression: update:available arriving mid-checkNow does NOT overwrite UpdateAvailable", async () => {
  // Capture the listen handler so we can fire the event manually.
  let availableHandler: ((event: { payload: { version: string; notes: string; downloadUrl: string } }) => void) | null = null;
  vi.mocked(listen).mockImplementation(async (eventName: string, handler) => {
    if (eventName === "update:available") availableHandler = handler as typeof availableHandler;
    return () => {};
  });

  // Defer update_check_now resolution so we can fire the event mid-await.
  let resolveCheck: (value: UpdateState) => void;
  const checkPromise = new Promise<UpdateState>((res) => { resolveCheck = res; });
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "update_check_now") return checkPromise;
    return DEFAULT_STATE;
  });

  const { result } = renderHook(() => useUpdateState());
  await waitFor(() => expect(availableHandler).not.toBeNull());

  // Start checkNow but do NOT await it yet — the invoke is pending.
  let checkNowDone: Promise<UpdateState>;
  await act(async () => {
    checkNowDone = result.current.checkNow();
  });

  // Fire update:available DURING the pending invoke. Reducer flips to UpdateAvailable.
  await act(async () => {
    availableHandler!({ payload: { version: "0.2.0", notes: "n", downloadUrl: "u" } });
  });
  expect(result.current.state.kind).toBe("UpdateAvailable");

  // Now resolve the invoke — checkCompleted dispatches AFTER UpdateAvailable already set.
  await act(async () => {
    resolveCheck!({ last_check_unix: 1700, last_dismissed_unix: 0, skipped_versions: [] });
    await checkNowDone;
  });

  // Post-fix: reducer guard sees state.kind === "UpdateAvailable" and returns state unchanged.
  // Pre-fix: closure captured state.kind === "Idle" → updateOffered=false → reducer overwrites with UpToDate.
  expect(result.current.state.kind).toBe("UpdateAvailable");
});
```

### Why this works

- `result.current` is a getter — re-reads latest state on each access. Stable identity across renders confirmed by `@testing-library/react@16.3.2` (CHANGELOG verified — getter API stable since v13).
- `act()` wrap on the manual handler call is REQUIRED. Firing a captured listener callback bypasses React's event boundary; without `act()` you get the React 19 "not wrapped in act" warning AND state-batching becomes unreliable.
- `act(async () => { checkNowDone = result.current.checkNow(); })` starts the call inside `act` (so the `setPersisted` and any sync `dispatch` are batched) but the inner `await invoke` is left pending — the `act` resolves on the microtask flush, NOT on the invoke promise.
- Final `await checkNowDone` inside `act` is the standard "drain" pattern.

### After dropping `updateOffered`, also update existing test

**Existing test at `useUpdateState.test.ts:146-164`** ("checkNow dispatches updateOffered=true when state is already UpdateAvailable") — keep the assertion (`state.kind === "UpdateAvailable"` after `checkNow`) but the title is misleading post-fix. Rename to:

```ts
it("checkNow preserves UpdateAvailable when state is already UpdateAvailable (reducer-local guard)", …)
```

The body needs no change — it already exercises the new behavior correctly.

### Reducer test additions (`updateStateMachine.test.ts`)

Action type changes — `updateOffered: boolean` removed. Update existing tests at lines 54-57 and 58-61. Add 3 new guard tests for the symmetric protection per CONTEXT decision:

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

Verify: TypeScript discriminated-union exhaustiveness still enforced. After dropping `updateOffered`, `tsc -b` will COMPLAIN at every old test using `updateOffered: true` — these MUST be updated. Compile-error driven refactor = good.

---

## 2. DRY hook-internal IPC error helper (MA-02)

**Goal:** Single helper for the try/catch + warn + skip-dispatch pattern repeated across `install`, `dismiss`, `skip`.

### Snippet (drop into `useUpdateState.ts`)

```ts
export function useUpdateState() {
  const [state, dispatch] = useReducer(updateReducer, INITIAL);
  const [persisted, setPersisted] = useState<UpdateState | null>(null);

  // ... existing useEffect blocks unchanged ...

  /**
   * Invoke a Tauri command, dispatch `action` on success, warn and skip on failure.
   * Defined inside the hook so it closes over `dispatch`. Re-created per render
   * (acceptable: not perf-critical, used only in event handlers — over-memoizing
   * with useCallback fights React 19 compiler optimizations).
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

  const checkNow = async (): Promise<UpdateState> => {
    const result = await invoke<UpdateState>("update_check_now");
    setPersisted(result);
    dispatch({ type: "checkCompleted", lastCheckUnix: result.last_check_unix });
    return result;
  };

  const install = async (): Promise<void> => {
    try {
      await invoke<void>("update_install");
    } catch (error) {
      console.warn("update_install failed", error);
    }
    // No dispatch on success — Phase 3 dispatcher emits update:installed event
    // which transitions reducer to Installing. Per TW#1 (no Restart button).
  };

  const dismiss = async (): Promise<void> => {
    await dispatchOnSuccess("update_dismiss", undefined, { type: "dismissed" });
  };

  const skip = async (version: string): Promise<void> => {
    await dispatchOnSuccess("update_skip_version", { version }, { type: "skipped", version });
  };

  return { state, lastCheckUnix: persisted?.last_check_unix ?? 0, skippedVersions: persisted?.skipped_versions ?? [], checkNow, install, dismiss, skip };
}
```

### Why NOT useCallback

- React 19 compiler memoizes call sites automatically when stable.
- `dispatchOnSuccess` not passed as a prop, not a dep of any `useEffect`, not in any `useMemo` dep array → memoization buys nothing.
- Creating one closure per render in a hook used by 1-2 components is sub-microsecond. Over-memoization adds eslint noise + hides bugs (forgotten deps).
- Precedent in this file: `checkNow`, `install`, `dismiss`, `skip` are already plain `const … = async () => …` — not `useCallback`-wrapped. Stay consistent.

### Why `install` doesn't use the helper

`install` has NO success dispatch (Phase 3 dispatcher fires `update:installed` event → reducer transitions). The helper signature requires an `action` arg. Forcing a synthetic action would violate SRP. Inlining `install`'s try/catch (4 lines) is cheaper than warping the helper to support an optional action.

Alternative considered + rejected: helper with `action: UpdateAction | null`. Adds a branch `if (action !== null) dispatch(action)` — dead weight for the 2/3 callers that always dispatch. Rejected.

### Test additions (MA-02 regression — `useUpdateState.test.ts`)

Three tests, one per command:

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
  expect(result.current.state).toBe(stateBefore); // unchanged → user can retry
  warnSpy.mockRestore();
});

it("MA-02 regression: dismiss warns and does NOT dispatch when invoke rejects", async () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "update_dismiss") throw new Error("ipc closed");
    return DEFAULT_STATE;
  });
  const { result } = renderHook(() => useUpdateState());
  // Drive state to UpdateAvailable so we can verify dismiss does NOT clear it on failure.
  let availableHandler: ((event: { payload: { version: string; notes: string; downloadUrl: string } }) => void) | null = null;
  vi.mocked(listen).mockImplementation(async (eventName: string, handler) => {
    if (eventName === "update:available") availableHandler = handler as typeof availableHandler;
    return () => {};
  });
  // (Re-render not needed; listeners attached on first mount above. If the
  // capture-pattern requires re-mount, restructure: set listen mock BEFORE renderHook.)
  // …
  await act(async () => { await result.current.dismiss(); });
  expect(warnSpy).toHaveBeenCalledWith("update_dismiss failed", expect.any(Error));
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

### `console.warn` precedent in this codebase

Verified by grep — already standard:
- `src/components/CheckForUpdatesButton/CheckForUpdatesButton.tsx:39` — `console.warn("CheckForUpdatesButton: check_now failed", error)`
- `src/components/LogViewer.tsx:109,159,166` — multiple usages
- `src/hooks/useUpdateState.ts:55,67` — already in this file

No Tauri logger in use on the frontend. Stick with `console.warn`. REVIEW.md confirms ("Strengths" section): _"console.warn used only for IPC failures (graceful degradation path)"_.

---

## 3. Codepoint-safe truncation + bidi strip (MI-01 + MI-02)

### New file `src/lib/sanitize-notes.ts`

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

### Why `Array.from` over manual surrogate-pair detection

`Array.from(string)` invokes `String.prototype[Symbol.iterator]` which yields by Unicode codepoint (per ECMAScript spec — well-supported across all modern engines including Tauri's WebView2 / WKWebView / WebKitGTK). Equivalent to `[...string]` spread but slightly clearer intent.

```js
Array.from("a😀b").length    // → 3 (codepoints)
"a😀b".length                  // → 4 (UTF-16 code units — 😀 is a surrogate pair)
"a😀b".slice(0, 2)             // → "a\uD83D" lone surrogate → renders as "a�"
Array.from("a😀b").slice(0, 2).join("")  // → "a😀" correct
```

### Why NOT `Intl.Segmenter`

- Bundle weight: polyfill ~30 KB gzipped if targeting older WebViews.
- Tauri targets modern WebViews (WebView2 on Win, WKWebView on macOS, WebKitGTK 2.36+ on Linux) — all support it natively. So bundle weight is moot.
- BUT: API surface heavier (`new Intl.Segmenter("en", { granularity: "grapheme" })` per call). Worth it ONLY if grapheme clusters matter (flag emoji 🇱🇻, ZWJ family 👨‍👩‍👧‍👦, combining marks).
- Phase 4 notes are GitHub release bodies — overwhelmingly Latin + occasional standalone emoji. Codepoint-safe is the right cost/benefit point.
- Documented in the JSDoc — future contributor knows the trade-off + the upgrade path.

### Bidi regex coverage

Verified character set:
- `U+202A` LRE — Left-to-Right Embedding
- `U+202B` RLE — Right-to-Left Embedding
- `U+202C` PDF — Pop Directional Formatting
- `U+202D` LRO — Left-to-Right Override
- `U+202E` RLO — Right-to-Left Override (the "Trojan Source" attack vector)
- `U+2066` LRI — Left-to-Right Isolate
- `U+2067` RLI — Right-to-Left Isolate
- `U+2068` FSI — First Strong Isolate
- `U+2069` PDI — Pop Directional Isolate

Two ranges in one char class = single regex pass = no perf concern even on multi-KB notes.

**Optional further hardening** (NOT in CONTEXT scope, document as future work):
- BOM `U+FEFF` — could mask truncation point.
- Zero-width joiners `U+200B`, `U+200C`, `U+200D` — cluster manipulation, not version spoof.

CONTEXT scopes only the bidi controls — stop there.

### Test plan (`src/lib/sanitize-notes.test.ts`) — 14+ cases

Per CONTEXT MI-02 decision. Concrete suite:

```ts
import { describe, it, expect } from "vitest";
import {
  stripBidiControls,
  truncateNotesSafe,
  sanitizeReleaseNotes,
  NOTES_TRUNCATE_LIMIT,
} from "./sanitize-notes";

describe("stripBidiControls", () => {
  it("removes RLO U+202E (Trojan Source vector)", () => {
    expect(stripBidiControls("v1.0.0‮")).toBe("v1.0.0");
  });
  it("removes all 9 bidi controls in one pass", () => {
    const all = "‪‫‬‭‮⁦⁧⁨⁩";
    expect(stripBidiControls(`a${all}b`)).toBe("ab");
  });
  it("preserves regular Unicode (non-bidi-control)", () => {
    expect(stripBidiControls("Hello 世界 🚀")).toBe("Hello 世界 🚀");
  });
  it("returns empty for empty input", () => {
    expect(stripBidiControls("")).toBe("");
  });
});

describe("truncateNotesSafe", () => {
  it("returns unchanged when length ≤ limit", () => {
    expect(truncateNotesSafe("short", 10)).toBe("short");
  });
  it("returns unchanged when length === limit (no ellipsis)", () => {
    expect(truncateNotesSafe("abcde", 5)).toBe("abcde");
  });
  it("truncates ASCII over limit + appends ellipsis", () => {
    expect(truncateNotesSafe("abcdefghij", 5)).toBe("abcde…");
  });
  it("does NOT split surrogate pair at boundary (codepoint-safe)", () => {
    // "a😀b" = 3 codepoints, 4 code units. Limit 2 → "a😀…" not "a\uD83D…"
    expect(truncateNotesSafe("a😀b", 2)).toBe("a😀…");
  });
  it("counts emoji as single codepoint", () => {
    // 🚀 = 1 codepoint (U+1F680). 5 emoji + limit 3 → 3 emoji + ellipsis
    expect(truncateNotesSafe("🚀🚀🚀🚀🚀", 3)).toBe("🚀🚀🚀…");
  });
  it("preserves multi-line text below limit", () => {
    expect(truncateNotesSafe("line1\nline2", 20)).toBe("line1\nline2");
  });
  it("counts newlines as codepoints (truncation respects them)", () => {
    expect(truncateNotesSafe("a\nb\nc\nd", 3)).toBe("a\nb…");
  });
  it("returns empty for empty input", () => {
    expect(truncateNotesSafe("", 10)).toBe("");
  });
});

describe("sanitizeReleaseNotes (composition)", () => {
  it("strips bidi then truncates", () => {
    const raw = `v1.0.0‮${"x".repeat(200)}`;
    const out = sanitizeReleaseNotes(raw);
    expect(out).not.toContain("‮");
    expect(Array.from(out).length).toBeLessThanOrEqual(NOTES_TRUNCATE_LIMIT + 1); // +1 for ellipsis
  });
  it("does not append ellipsis when sanitized length ≤ limit", () => {
    // Bidi strip can shrink length below limit
    const raw = "short‮";
    expect(sanitizeReleaseNotes(raw)).toBe("short");
  });
  it("handles only-control-char input → empty string, no ellipsis", () => {
    expect(sanitizeReleaseNotes("‮‭")).toBe("");
  });
  it("uses NOTES_TRUNCATE_LIMIT constant (regression-guards exported value)", () => {
    expect(NOTES_TRUNCATE_LIMIT).toBe(80);
  });
});
```

### `UpdateToast.tsx` changes

Replace lines 7-14:

```ts
import { sanitizeReleaseNotes } from "../../lib/sanitize-notes";

// remove NOTES_TRUNCATE_LIMIT constant + truncateNotes function
```

Replace `AvailableContent` body line 23:

```ts
const sanitized = sanitizeReleaseNotes(state.notes);
const truncated = sanitized.endsWith("…");
const full = state.notes; // raw, for AT — but should we sanitize the AT version too?
```

**Open question for executor:** Should sr-only `full` text also pass through `stripBidiControls` so screen-readers don't get bidi-spoofed? Recommend YES (defense-in-depth applies symmetrically). Concrete:

```ts
const fullSanitized = stripBidiControls(state.notes);
// then: <span className={styles["sr-only"]}>{fullSanitized}</span>
```

Add `stripBidiControls` to the import. Existing UpdateToast tests that assert on full notes (`UpdateToast.test.tsx:79`, etc.) use ASCII-only strings → no test break.

---

## 4. JSDoc `@remarks` convention (MI-03)

### TSDoc spec reference

`@remarks` is a TSDoc-standard block tag. VS Code IntelliSense + TypeScript LSP render it as a distinct "Remarks" section below the summary. Different from:
- `@example` — usage example (rendered as code block)
- `@deprecated` — lifecycle marker (rendered as warning)
- `@see` — cross-reference (rendered as link)

`@remarks` is the right tag for "things to know about using this API but not lifecycle-critical."

[CITED: TSDoc spec — https://tsdoc.org/pages/tags/remarks/]

### Snippet (drop into `src/lib/useFocusTrap.ts` — REPLACE existing JSDoc at lines 6-14)

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
export function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>): void {
```

Existing `Tiger-Style:` paragraph kept (don't lose context). `@remarks` block appended. No code change. No test change.

---

## 5. Pitfalls (numbered, mapped to fix IDs)

### #1 — React 19 `act()` for non-event-boundary state updates (MA-01 test)

Firing a captured `listen()` callback from inside a test is OUTSIDE React's event boundary. State updates triggered this way produce the React 19 warning `"An update to X inside a test was not wrapped in act(...)"` AND batching becomes unreliable. ALWAYS wrap with `await act(async () => { handler(...); })`. Existing UpdateToast tests already do this via `fireEvent` helper (`UpdateToast.test.tsx:28-32`) — copy the pattern.

### #2 — `vitest@4.x` + `@testing-library/react@16.x` + React 19 peer deps

Verified compatible (already in package.json + already running green in 260501-wqg). `renderHook` from `@testing-library/react` v16 returns `{ result, rerender, unmount }` where `result.current` is a getter that always returns the latest state — DO NOT destructure `result.current` early in the test (you'll capture the initial render). Pattern: `result.current.state` re-read after each `act()`.

### #3 — TypeScript discriminated-union exhaustiveness after dropping `updateOffered` (MA-01)

`switch (action.type)` over `UpdateAction` is checked for exhaustiveness because of `noFallthroughCasesInSwitch: true` (per `tsconfig.node.json:18`) AND `strict: true`. After removing `updateOffered: boolean` from `UpdateAction`, the reducer's `case "checkCompleted"` body must compile — `action.updateOffered` reference will FAIL to compile (good, forces the cleanup). All test files using `updateOffered: true | false` will also fail to compile. Use this as a checklist: run `tsc -b` after removal, fix every error, ship green.

### #4 — Coverage threshold after deleting MI-04 no-op test

Math: deleting a test that asserts `expect(true).toBe(true)` removes 0 covered lines from `CheckForUpdatesButton.tsx`. The test file itself is excluded from coverage (`vitest.config.ts:16` `exclude: ["src/**/*.{test,spec}.{ts,tsx}", …]`). Coverage % UNCHANGED. Threshold 90% (per `vitest.config.ts:22`) still met (file was at 93.47% line / 90.47% branch per REVIEW.md). Verify: `npm run test:coverage` after deletion, confirm green.

### #5 — `verbatimModuleSyntax: true` in `tsconfig.node.json` (MI-05)

Setting forces type-only imports to use `import type { … }` syntax (no value-import emit suppression at runtime). Currently fine — `vitest.config.ts` only imports values (`defineConfig`, `react`). Future contributor adding `import { UserConfig } from "vitest/config"` will hit `error TS1484: 'UserConfig' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.` Inline JSONC comment on line 11 prevents the confusion. JSONC is supported by TypeScript's `tsconfig.json` parser (per official docs).

### #6 — `console.warn` allowed (already precedent)

Verified by grep: 6 existing usages in `src/`. Codebase explicitly endorses for IPC failure paths (REVIEW.md "Strengths" line). No Tauri-specific logger required for the frontend. Stick with `console.warn(\`${commandName} failed\`, error)` template — matches existing `update_get_state failed` and `check_now failed` precedents.

### #7 — DRY helper closure-creation cost

Defining `dispatchOnSuccess` inside the hook recreates the function every render. For `useUpdateState` callers (UpdateToast + CheckForUpdatesButton) the hook runs maybe 10× per session (mount + state transitions). 10 closure allocations per session = unmeasurable. Don't useCallback. Don't extract to module scope (would lose `dispatch` access — would require passing `dispatch` as arg, which leaks the reducer abstraction outside the hook → SRP violation).

### #8 — `dismiss` invokes `update_dismiss` but reducer's `dismissed` action transitions to `Idle` (not a separate "Dismissed" state)

Confirmed reading reducer line 47. Helper signature works fine — the `action.type === "dismissed"` value is what matters; the resulting state is the reducer's responsibility.

### #9 — Skip-result coverage of `buildResultMessage("skipped")` after MI-04 deletion

REVIEW.md MI-04 notes the deletion REVEALS a real coverage gap. Per CONTEXT decision: defer the `buildResultMessage` extraction unless the result-message logic grows. So the gap stays. If `vitest.config.ts` 90% threshold catches it, the EXECUTOR must either (a) add an integration test exercising the path, or (b) adjust the threshold (NOT acceptable per CONTEXT — thresholds unchanged). Pre-flight: read `CheckForUpdatesButton.tsx` to confirm `buildResultMessage("skipped")` IS in current line/branch coverage somehow OR that its omission keeps file ≥90%. (The test was a no-op so it contributed 0 coverage — file was at 93.47% with it, will be at 93.47% without it.)

### #10 — Six atomic commits

Per CONTEXT: one commit per finding, MI-01+MI-02 combined since same file. Order matters for rebases — recommend:
1. `fix(quick-260502-epd): MI-05 verbatimModuleSyntax inline note` (smallest, no test)
2. `fix(quick-260502-epd): MI-03 useFocusTrap @remarks JSDoc` (no code change, no test)
3. `fix(quick-260502-epd): MI-04 delete no-op test` (deletion only)
4. `fix(quick-260502-epd): MI-01+MI-02 sanitize-notes lib + UpdateToast wiring` (new lib + 14 tests + UpdateToast import swap)
5. `fix(quick-260502-epd): MA-01 reducer-local checkCompleted guard` (action-type change, reducer change, hook change, reducer tests, hook regression test)
6. `fix(quick-260502-epd): MA-02 dispatchOnSuccess helper + skip-on-failure` (hook change, 3 regression tests)

Each commit must independently build + test green. Order chosen so the trickier MAJORs land last on top of clean MINOR base.

---

## 6. File-level fix map (per-finding diff hints)

### MA-01 — `src/hooks/updateStateMachine.ts` (action type + reducer)

**Lines 9-16, action union:**

Before:
```ts
| { type: "checkCompleted"; lastCheckUnix: number; updateOffered: boolean }
```
After:
```ts
| { type: "checkCompleted"; lastCheckUnix: number }
```

**Lines 43-45, reducer case:**

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

### MA-01 — `src/hooks/useUpdateState.ts:70-79`

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

### MA-01 — `src/hooks/updateStateMachine.test.ts:54-61`

Drop `updateOffered: true|false` from the two existing checkCompleted tests. Add the 6 new guard tests from §1.

### MA-02 — `src/hooks/useUpdateState.ts:81-93`

See full replacement in §2.

### MI-01 + MI-02 — new file `src/lib/sanitize-notes.ts`

See full content in §3.

### MI-01 + MI-02 — `src/components/UpdateToast/UpdateToast.tsx`

Lines 7-14: delete `NOTES_TRUNCATE_LIMIT` constant + `truncateNotes` function.

Add at top of file:
```ts
import { sanitizeReleaseNotes, stripBidiControls } from "../../lib/sanitize-notes";
```

Lines 22-23 (`AvailableContent` body):
Before:
```ts
function AvailableContent({ state, onInstall, onLater, onSkip }: AvailableProps) {
  const { display, full, truncated } = truncateNotes(state.notes);
```
After:
```ts
function AvailableContent({ state, onInstall, onLater, onSkip }: AvailableProps) {
  const display = sanitizeReleaseNotes(state.notes);
  const full = stripBidiControls(state.notes);
  const truncated = display.endsWith("…");
```

### MI-03 — `src/lib/useFocusTrap.ts:6-14`

Replace existing JSDoc block per snippet in §4. No code change.

### MI-04 — `src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx:91-104`

Delete entire `it("renders inline 'Already skipped' result …")` block including the comment.

### MI-05 — `tsconfig.node.json:11`

Before:
```jsonc
    "verbatimModuleSyntax": true,
```
After:
```jsonc
    "verbatimModuleSyntax": true,  // requires `import type` for type-only imports (e.g. UserConfig from vitest/config)
```

Verify `tsc -b` still succeeds. JSON-with-comments parsing is enabled in TypeScript by default for tsconfig files.

---

## Sources

### Primary (HIGH confidence)
- In-repo source verified: `src/hooks/useUpdateState.ts`, `updateStateMachine.ts`, `UpdateToast.tsx`, `useFocusTrap.ts`, `CheckForUpdatesButton.test.tsx`, `vitest.config.ts`, `tsconfig.node.json`, `package.json`.
- 260501-wqg REVIEW.md — source of all 7 findings + observed behavior.
- 260502-epd CONTEXT.md — locked decisions.
- TSDoc spec for `@remarks`: https://tsdoc.org/pages/tags/remarks/ [CITED]
- React 19 testing patterns: `@testing-library/react@16.3.2` getter-based `result.current` API [VERIFIED in package.json].
- Vitest 4 + RTL 16 + React 19 compatibility: confirmed working in 260501-wqg (test suite green).
- ECMAScript `String.prototype[Symbol.iterator]` codepoint iteration — well-established standard.
- Unicode bidi controls: U+202A-U+202E + U+2066-U+2069 [VERIFIED Unicode 15.1 standard].

### Secondary (MEDIUM confidence)
- `console.warn` precedent: 6 in-repo usages (grep verified). Aligns with REVIEW.md "Strengths" endorsement.
- Trojan Source attack vector (Boucher & Anderson 2021) — RLO U+202E used to spoof source code; same vector applies to release-note display.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | After deleting MI-04 no-op test, `CheckForUpdatesButton.tsx` coverage stays ≥90% | §5 #4 + §5 #9 | Coverage gate fails. Mitigation: REVIEW.md states pre-deletion was 93.47% line / 90.47% branch; deleted test contributed 0 covered lines so post-deletion identical. Executor verifies via `npm run test:coverage`. |
| A2 | sr-only full notes should also be bidi-stripped (not just truncated display) | §3 sub-section "UpdateToast.tsx changes" + §6 MI-01+MI-02 | Without the strip, screen-readers could announce bidi-spoofed text. Defense-in-depth principle suggests YES. CONTEXT does not explicitly cover this — flag for executor confirmation OR for discuss-phase. |
| A3 | React 19 compiler optimizes hook closures sufficiently to avoid `useCallback` for `dispatchOnSuccess` | §2 "Why NOT useCallback" | Performance regression unlikely (helper used in event handlers, not render hot path). Stays consistent with existing `checkNow`/`install`/`dismiss`/`skip` style. |

---

## RESEARCH COMPLETE

**Phase:** quick-task 260502-epd — fix 7 review findings from 260501-wqg
**Confidence:** HIGH

### Key Findings
- Race-window test pattern: combine deferred-promise mock (CheckForUpdatesButton precedent) + handler-capture mock (useUpdateState precedent) + `act()` wrap. Drop-in snippet provided.
- DRY helper `dispatchOnSuccess(commandName, args, action)` inside hook closure — `install` opts out (no success dispatch per TW#1), `dismiss`+`skip` use it. No `useCallback`.
- Sanitize-notes lib: `Array.from(text).slice(0, n).join("")` for codepoint-safe truncation; `/[‪-‮⁦-⁩]/g` for bidi-strip. 14 unit tests. New file `src/lib/sanitize-notes.ts`.
- `@remarks` is the correct TSDoc tag for `useFocusTrap` snapshot quirk. JSDoc-only change.
- `console.warn` already standard in this codebase (6 usages). Pattern: `console.warn("<command> failed", error)`.
- Coverage threshold safe after MI-04 deletion (no-op test contributed 0 covered lines).
- Six atomic commits in order: MI-05 → MI-03 → MI-04 → MI-01+MI-02 → MA-01 → MA-02.

### File Created
`C:\laragon\www\ChurchAudioStream\.planning\quick\260502-epd-fix-ma-01-stale-closure-race-ma-02-silen\260502-epd-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Race-window test pattern | HIGH | Both primitives (deferred promise + handler capture) already exist in repo tests. |
| DRY hook helper | HIGH | Pattern matches existing `console.warn` usage; closure scope justified by SRP. |
| Codepoint truncation | HIGH | `Array.from` + bidi regex are stable Unicode/ECMAScript primitives. |
| `@remarks` JSDoc | HIGH | TSDoc spec cited; VS Code IntelliSense renders distinctly. |
| `console.warn` allowed | HIGH | 6 in-repo precedents grep-verified. |
| Coverage post-MI-04 | MEDIUM | Math reasoning sound but executor must verify with `npm run test:coverage`. |

### Open Questions
- A2 (sr-only bidi strip) — recommend YES but CONTEXT silent. Executor or discuss-phase to confirm.

### Ready for Planning
Research complete. Planner can lift snippets directly into PLAN tasks. File-level fix map (§6) gives concrete before/after for every finding.
