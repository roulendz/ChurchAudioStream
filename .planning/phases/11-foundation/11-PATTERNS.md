# Phase 11: Foundation (Tailwind CSS v4 + shadcn/ui migration) - Pattern Map

**Mapped:** 2026-05-05
**Files analyzed:** 30 (new/modified/deleted)
**Analogs found:** 28 / 30 (VuMeter.tsx has no CSS to convert; index.css is net-new CSS architecture)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/index.css` | config | static | `src/App.css` (lines 1-24, token block) | role-match |
| `src/main.tsx` | entry | static | self (change import line) | exact |
| `vite.config.ts` | config | static | self (add plugin + alias) | exact |
| `tsconfig.json` | config | static | self (add reference) | exact |
| `tsconfig.app.json` | config | static | self (add paths) | exact |
| `components.json` | config | static | none (new shadcn file, use RESEARCH.md template) | no-analog |
| `src/lib/utils.ts` | utility | transform | `src/lib/relative-time.ts` | role-match |
| `src/lib/utils.test.ts` | test | transform | `src/lib/relative-time.test.ts` | exact |
| `src/components/ui/` | component | static | none (shadcn-generated) | no-analog |
| `src/App.tsx` | component | request-response | self (change import) | exact |
| `src/components/layout/DashboardShell.tsx` | component | request-response | self (convert classes) | exact |
| `src/components/layout/Sidebar.tsx` | component | request-response | self (convert classes) | exact |
| `src/components/ConnectionStatus.tsx` | component | request-response | self (convert classes) | exact |
| `src/components/SettingsPanel.tsx` | component | request-response | self (convert classes) | exact |
| `src/components/LogViewer.tsx` | component | streaming | self (convert classes) | exact |
| `src/components/channels/ChannelList.tsx` | component | request-response | self (convert classes) | exact |
| `src/components/channels/ChannelConfigPanel.tsx` | component | request-response | self (convert classes) | exact |
| `src/components/channels/ChannelCreateDialog.tsx` | component | request-response | self (convert classes) | exact |
| `src/components/channels/ProcessingControls.tsx` | component | event-driven | self (convert classes) | exact |
| `src/components/channels/SourceSelector.tsx` | component | request-response | self (convert classes) | exact |
| `src/components/monitoring/ListenerCountBadge.tsx` | component | request-response | self (convert classes) | exact |
| `src/components/monitoring/ServerStatus.tsx` | component | request-response | self (convert classes) | exact |
| `src/components/monitoring/VuMeter.tsx` | component | streaming | N/A (canvas, no CSS classes) | no-change |
| `src/components/monitoring/VuMeterBank.tsx` | component | streaming | self (convert classes) | exact |
| `src/components/settings/QrCodeDisplay.tsx` | component | request-response | self (convert classes) | exact |
| `src/components/CheckForUpdatesButton/CheckForUpdatesButton.tsx` | component | event-driven | self (CSS module -> Tailwind) | exact |
| `src/components/UpdateToast/UpdateToast.tsx` | component | event-driven | self (CSS module -> Tailwind) | exact |
| `src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx` | test | request-response | self (update assertions) | exact |
| `src/components/UpdateToast/UpdateToast.test.tsx` | test | request-response | self (update assertions) | exact |
| `vitest.config.ts` | config | static | self (add tailwindcss plugin) | exact |

**Files to DELETE:**
| File | Lines | Reason |
|------|-------|--------|
| `src/App.css` | 1356 | All styles replaced by Tailwind utilities + index.css tokens |
| `src/components/CheckForUpdatesButton/CheckForUpdatesButton.module.css` | 78 | Converted to inline Tailwind |
| `src/components/UpdateToast/UpdateToast.module.css` | 108 | Converted to inline Tailwind |
| `src/css-modules.d.ts` | ~5 | No more CSS module imports |

## Pattern Assignments

### `src/index.css` (config, static) -- NEW

**Analog:** `src/App.css` lines 1-24 (token block being replaced)

**Existing token block** (App.css lines 1-24):
```css
:root {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --bg-tertiary: #0f3460;
  --bg-input: #1e2a4a;
  --text-primary: #e0e0e0;
  --text-secondary: #a0a0b0;
  --text-muted: #6b6b80;
  --accent: #5a9cf5;
  --accent-hover: #4a8ce5;
  --accent-disabled: #3a5a80;
  --success: #4caf50;
  --warning: #ff9800;
  --error: #f44336;
  --border: #2a3a5e;
  --border-focus: #5a9cf5;
  --radius: 6px;
  --font-mono: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
  --sidebar-width: 220px;
}
```

**New pattern:** Use RESEARCH.md Pattern 5 (complete index.css template with `@import "tailwindcss"`, `@import "tw-animate-css"`, `@import "shadcn/tailwind.css"`, `:root` OKLCH tokens, `@theme inline` block, `@layer base` body defaults). Full template in RESEARCH.md lines 273-383.

---

### `src/main.tsx` (entry, static) -- MODIFY

**Current** (lines 1-9):
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**Change:** Add `import "./index.css"` before App import. No other changes.

---

### `vite.config.ts` (config, static) -- MODIFY

**Current** (lines 1-19):
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
```

**Changes:**
1. Add `import tailwindcss from "@tailwindcss/vite"` import
2. Add `import { resolve } from "node:path"` (use `node:` prefix -- tsconfig.node.json has `verbatimModuleSyntax: true`, pitfall 6)
3. Add `tailwindcss()` to plugins array: `plugins: [react(), tailwindcss()]`
4. Add `resolve.alias` block: `resolve: { alias: { "@": resolve(__dirname, "./src") } }`

---

### `tsconfig.json` (config, static) -- MODIFY

**Current** (lines 1-7):
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

**Change:** Add `compilerOptions` with `baseUrl` and `paths`:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "files": [],
  "references": [...]
}
```

---

### `tsconfig.app.json` (config, static) -- MODIFY

**Current** (lines 1-24):
```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    ...
  },
  "include": ["src"]
}
```

**Change:** Add `baseUrl` and `paths` to `compilerOptions`:
```json
"baseUrl": ".",
"paths": {
  "@/*": ["./src/*"]
}
```

---

### `components.json` (config, static) -- NEW

**No analog in codebase.** Use RESEARCH.md Pattern 3 template (lines 223-244). Key values:
- `rsc: false` (not Next.js)
- `style: "new-york"`
- `tailwind.config: ""` (Tailwind v4, no JS config)
- `tailwind.css: "src/index.css"`

---

### `src/lib/utils.ts` (utility, transform) -- NEW

**Analog:** `src/lib/relative-time.ts` (same directory, same role pattern)

**Import pattern** from `src/lib/relative-time.ts` (line 1 comment style + export):
```typescript
/**
 * Convert a unix timestamp (seconds) to a human-readable relative string.
 * Tiger-Style: pure function, no clock side-effects...
 */
export function formatRelativeTime(...): string {
```

**New file follows same pattern:** Single exported pure function, JSDoc comment, no side effects.
```typescript
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

### `src/lib/utils.test.ts` (test, transform) -- NEW

**Analog:** `src/lib/relative-time.test.ts` (lines 1-57)

**Test structure pattern:**
```typescript
import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "./relative-time";

describe("formatRelativeTime", () => {
  it("returns 'never' for undefined", () => {
    expect(formatRelativeTime(undefined, NOW_MS)).toBe("never");
  });
  // ... more it() blocks
});
```

**Key patterns:**
- Import `{ describe, it, expect }` from `"vitest"` (no `vi` needed for pure function tests)
- Single `describe()` block named after function
- Each `it()` covers one behavior
- Direct assertions with `expect().toBe()` / `.toEqual()`

---

### `src/App.tsx` (component, request-response) -- MODIFY

**Current import** (line 2):
```tsx
import "./App.css";
```

**Change:** Remove `import "./App.css"`. CSS now loaded via `main.tsx` importing `index.css`. Also convert inline class names throughout file to Tailwind utilities (lines 68-154 have ~15 class references like `overview-section`, `settings-update-card`, etc.).

**App.tsx class reference inventory** (lines 58-157):
- `overview-section` (line 69)
- `overview-channel-badges` (line 77)
- `overview-subheading` (line 78)
- `overview-badge-grid` (line 79)
- `overview-badge-item` (line 81)
- `overview-badge-name` (line 82)
- `listener-badge` (line 83)
- `listener-badge-count` (line 84)
- `monitoring-section` (line 131)
- `monitoring-section-title` (line 132)
- `settings-update-card` (line 144)
- `settings-qr-code` (line 147)
- `settings-log-viewer` (line 150)

---

### `src/components/layout/DashboardShell.tsx` (component, request-response) -- MODIFY

**Current class pattern** (lines 22-34):
```tsx
<div className="dashboard-shell">
  <header className="dashboard-header">
    <h1 className="app-title">Church Audio Stream - Admin</h1>
  </header>
  <Sidebar ... />
  <main className="dashboard-content">{children}</main>
</div>
```

**Corresponding App.css styles** (lines 43-65):
```css
.dashboard-shell {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  grid-template-rows: auto 1fr;
  min-height: 100vh;
}
.dashboard-header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background-color: var(--bg-primary);
  position: sticky;
  top: 0;
  z-index: 100;
}
```

**Tailwind conversion:** Replace with inline utilities. Use RESEARCH.md Pattern 6 (lines 397-409) as template.

---

### `src/components/layout/Sidebar.tsx` (component, request-response) -- MODIFY

**Current class pattern** (lines 23-38):
```tsx
<nav className="dashboard-sidebar" aria-label="Dashboard navigation">
  <button
    className={`sidebar-nav-item${isActive ? " sidebar-nav-item--active" : ""}`}
    ...
  >
```

**Corresponding App.css styles** (lines 77-99):
```css
.dashboard-sidebar {
  grid-row: 2;
  background-color: var(--bg-secondary);
  border-right: 1px solid var(--border);
  padding: 1rem 0;
  overflow-y: auto;
}
.sidebar-nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.6rem 1.25rem;
  background: none;
  border: none;
  border-left: 3px solid transparent;
  color: var(--text-secondary);
  font-size: 0.9rem;
  ...
}
```

**Tailwind conversion:** Needs `cn()` import for conditional active state. Use RESEARCH.md Example 1 (lines 571-589) as template.

---

### `src/components/ConnectionStatus.tsx` (component, request-response) -- MODIFY

**Current class pattern** (lines 8-22, 35-39):
```tsx
const STATUS_DISPLAY: Record<...> = {
  connected: { label: "Connected", className: "status-dot--connected" },
  connecting: { label: "Connecting...", className: "status-dot--connecting" },
  ...
};
// ...
<div className="connection-status">
  <span className={`status-dot ${className}`} />
  <span className="status-label">{displayLabel}</span>
</div>
```

**Tailwind conversion:** Replace status modifier classes with Tailwind utility variants. Use RESEARCH.md Example 2 (lines 593-605) as template. Map:
- `status-dot--connected` -> `bg-success shadow-[0_0_6px] shadow-success`
- `status-dot--connecting` -> `bg-warning animate-pulse`
- `status-dot--disconnected` -> `bg-destructive`

---

### `src/components/CheckForUpdatesButton/CheckForUpdatesButton.tsx` (component, event-driven) -- MODIFY (CSS module migration)

**Current CSS module pattern** (lines 1-2, 63-89):
```tsx
import styles from "./CheckForUpdatesButton.module.css";
// ...
<div className={styles["card"]}>
  <div className={styles["card-header"]}>
    <h3 className={styles["card-title"]}>...</h3>
    <button className={styles["check-button"]} ...>
```

**Module CSS source** (`CheckForUpdatesButton.module.css` lines 1-78):
```css
.card { background: var(--card-bg, #1a1f2e); border: 1px solid ...; border-radius: 8px; padding: 1rem 1.25rem; ... }
.check-button { padding: 0.5rem 1rem; border-radius: 6px; background: var(--update-accent, #16a34a); ... }
.spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.4); border-top-color: #ffffff; border-radius: 50%; animation: spin 1s linear infinite; }
.chip { font-size: 0.75rem; padding: 0.125rem 0.5rem; border-radius: 999px; ... }
```

**Tailwind conversion:**
1. Remove `import styles from "./CheckForUpdatesButton.module.css"`
2. Add `import { cn } from "@/lib/utils"` (if conditional classes needed)
3. Replace all `styles["xxx"]` with inline Tailwind utilities
4. Use RESEARCH.md Pattern 7 (lines 416-433) as template
5. DELETE `CheckForUpdatesButton.module.css`

---

### `src/components/UpdateToast/UpdateToast.tsx` (component, event-driven) -- MODIFY (CSS module migration)

**Current CSS module pattern** (lines 1-2, 17-35, 86-106):
```tsx
import styles from "./UpdateToast.module.css";
// ...
<div className={styles["toast-root"]} role="status" data-visible={visible} data-state={state.kind}>
  <div className={styles["toast-content"]}>
    <div className={styles["toast-headline"]}>...</div>
    <div className={styles["toast-actions"]}>
      <button className={styles["button-primary"]} ...>Install</button>
      <button className={styles["button-secondary"]} ...>Later</button>
```

**Module CSS source** (`UpdateToast.module.css` lines 1-108):
```css
.toast-root { position: fixed; top: 0; left: 0; right: 0; z-index: 1000; background: var(--card-bg); ... }
.toast-root[data-visible="false"] { transform: translateY(-100%); pointer-events: none; }
.button-primary { background: var(--update-accent, #16a34a); color: #ffffff; ... }
.spinner-indeterminate { width: 24px; height: 24px; border: 3px solid ...; animation: spin 1s linear infinite; }
.sr-only { position: absolute; width: 1px; height: 1px; ... }
```

**Tailwind conversion:**
1. Remove `import styles from "./UpdateToast.module.css"`
2. Add `import { cn } from "@/lib/utils"` 
3. Replace all `styles["xxx"]` with inline Tailwind utilities
4. `sr-only` -> Tailwind's built-in `sr-only` class
5. Toast slide animation: use `transition-transform duration-[240ms] ease-out` + conditional `data-[visible=false]:-translate-y-full`
6. DELETE `UpdateToast.module.css`

---

### `src/components/SettingsPanel.tsx` (component, request-response) -- MODIFY

**Current class pattern** (lines 188-303, high complexity, many form fields):
```tsx
<section className="settings-panel">
  <h2>Server Settings</h2>
  <div className="settings-form">
    <div className="form-field">
      <label htmlFor="settings-port">Port</label>
      <input ... className={portError ? "input-error" : ""} />
      {portError && <span className="field-error">{portError}</span>}
    </div>
    ...
    <div className="form-field form-field--checkbox">
      <label><input type="checkbox" ... /> Enable mDNS</label>
    </div>
    ...
    <button className="btn-save" ...>Save</button>
```

**Tailwind conversion:** Use RESEARCH.md Example 4 (lines 628-644) for form field pattern. Use `cn()` for conditional error borders.

---

### `src/components/channels/ChannelList.tsx` (component, request-response) -- MODIFY

**Current class pattern** (lines 54-161):
```tsx
<div className="channel-list">
  <div className="channel-list-header">
    <button className="btn-primary">+ New Channel</button>
  </div>
  <ul className="channel-cards">
    <li className="channel-card">
      <span className={`channel-status-badge ${statusModifier(channel.status)}`}>
      ...
      <button className="btn-icon">&#9650;</button>
      <button className="btn-secondary btn-stop">Stop</button>
      <button className="btn-icon btn-remove-channel">X</button>
```

**Tailwind conversion:** Use RESEARCH.md Example 3 (lines 607-623) for button variants. Use `cn()` for status badge conditional classes. Status modifier function (lines 14-26) maps to Tailwind utility strings:
- `channel-status--streaming` -> `bg-success/20 text-success`
- `channel-status--starting` -> `bg-warning/20 text-warning`
- `channel-status--error` -> `bg-destructive/20 text-destructive`
- `channel-status--stopped` -> `bg-muted text-muted-foreground`

---

### `src/components/monitoring/VuMeter.tsx` (component, streaming) -- NO CHANGE

Canvas-based pixel rendering. Only CSS class references are container layout (`vu-meter`, `vu-meter-label`) which are minimal. Hard-coded hex colors in JS constants (lines 19-27) remain untouched -- canvas draws pixels, not CSS. Only container div class needs Tailwind conversion.

---

### `src/components/monitoring/ServerStatus.tsx` (component, request-response) -- MODIFY

**Current class pattern** (lines 41-116):
```tsx
<div className="server-status">
  <div className="stat-card">
    <div className="stat-card-label">Total Listeners</div>
    <div className="stat-card-value stat-card-value--large">{totalListeners}</div>
  </div>
  ...
  <span className={`worker-dot ${worker.alive ? "worker-dot--alive" : "worker-dot--dead"}`} />
```

**Tailwind conversion:** Stat cards become `bg-card border border-border rounded-md p-4`. Worker dot alive/dead uses `cn()` with conditional `bg-success`/`bg-destructive`.

---

### `vitest.config.ts` (config, static) -- MODIFY

**Current** (lines 1-30):
```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    ...
    css: true,
```

**Change:** Add `import tailwindcss from "@tailwindcss/vite"` and add `tailwindcss()` to plugins: `plugins: [react(), tailwindcss()]`. Needed for CSS import resolution (`@import "tailwindcss"` in index.css).

---

### Design Tokens Test -- `src/__tests__/design-tokens.test.ts` -- NEW

**Analog:** `src/lib/relative-time.test.ts` (pure function test pattern)

**Test structure pattern:**
```typescript
import { describe, it, expect } from "vitest";

describe("design tokens", () => {
  it("--background resolves to OKLCH value", () => {
    // render component or check CSS custom property
  });
});
```

Note: jsdom has limited CSS custom property support. Tests may need to verify DOM rendering rather than computed styles. Use `@testing-library/react` render + check element exists approach.

---

### Settings DesignTokensSection -- embedded in `src/components/SettingsPanel.tsx` -- NEW (sub-component)

**Analog:** `src/components/monitoring/ServerStatus.tsx` lines 53-116 (grid of stat cards)

**Pattern:** Grid of visual items with label + visual indicator:
```tsx
<div className="server-status">
  <div className="stat-card">
    <div className="stat-card-label">Total Listeners</div>
    <div className="stat-card-value">{totalListeners}</div>
  </div>
```

**New pattern (Tailwind):** Use RESEARCH.md Example 5 (lines 648-690). Token swatch grid with `bg-card border border-border rounded-md p-5`, swatch items `size-10 rounded-md border border-border`, labels `text-xs text-muted-foreground`.

---

## Shared Patterns

### cn() Class Utility
**Source:** `src/lib/utils.ts` (to be created)
**Apply to:** All components with conditional class names -- Sidebar.tsx, ConnectionStatus.tsx, SettingsPanel.tsx, ChannelList.tsx, ProcessingControls.tsx, SourceSelector.tsx, ServerStatus.tsx, CheckForUpdatesButton.tsx, UpdateToast.tsx

```typescript
import { cn } from "@/lib/utils"

// Usage: conditional classes
className={cn(
  "base-classes here",
  isActive && "active-state-classes",
  hasError && "error-classes"
)}
```

### Button Variants
**Source:** `src/App.css` button definitions (to be replaced)
**Apply to:** ChannelList.tsx, ChannelConfigPanel.tsx, ChannelCreateDialog.tsx, SettingsPanel.tsx, CheckForUpdatesButton.tsx, UpdateToast.tsx, QrCodeDisplay.tsx

**Primary button pattern:**
```tsx
className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-accent-hover disabled:bg-accent-disabled disabled:text-muted-foreground disabled:cursor-not-allowed"
```

**Secondary button pattern:**
```tsx
className="px-3 py-1.5 bg-transparent border border-border rounded-md text-muted-foreground text-sm cursor-pointer transition-all hover:border-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
```

**Icon button pattern:**
```tsx
className="bg-transparent border border-border rounded-md text-muted-foreground size-7 text-xs inline-flex items-center justify-center cursor-pointer transition-all hover:border-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
```

### Form Field Pattern
**Source:** `src/App.css` form field definitions
**Apply to:** SettingsPanel.tsx, ChannelConfigPanel.tsx, ChannelCreateDialog.tsx, SourceSelector.tsx

```tsx
<div className="flex flex-col gap-1.5">
  <label htmlFor="id" className="text-sm font-medium text-muted-foreground">Label</label>
  <input
    className={cn(
      "px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm",
      "outline-none transition-colors focus:border-ring",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      hasError && "border-destructive"
    )}
  />
</div>
```

### Checkbox Field Pattern
**Apply to:** SettingsPanel.tsx, ChannelConfigPanel.tsx, SourceSelector.tsx

```tsx
<div className="flex items-center gap-2">
  <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
    <input type="checkbox" className="accent-primary" />
    Label text
  </label>
</div>
```

### Section Card Pattern
**Source:** `src/App.css` stat-card / settings-panel definitions
**Apply to:** SettingsPanel.tsx, ServerStatus.tsx, QrCodeDisplay.tsx, CheckForUpdatesButton.tsx

```tsx
<section className="bg-card border border-border rounded-md p-5">
  <h2 className="text-lg font-semibold text-foreground mb-4">Title</h2>
  {/* content */}
</section>
```

### Test Structure Pattern
**Source:** `src/lib/relative-time.test.ts` (pure utility tests), `src/components/CheckForUpdatesButton/CheckForUpdatesButton.test.tsx` (component tests)
**Apply to:** `src/lib/utils.test.ts`, `src/__tests__/design-tokens.test.ts`

**Pure utility test:**
```typescript
import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges class strings", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });
});
```

**Component test (existing pattern from CheckForUpdatesButton.test.tsx):**
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

describe("ComponentName", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(DEFAULT_STATE);
    vi.mocked(listen).mockImplementation(async () => () => {});
  });
  it("renders expected element", () => {
    render(<Component />);
    expect(screen.getByText(/text/i)).toBeInTheDocument();
  });
});
```

### Import Path Convention
**After migration:** Use `@/` path alias for cross-directory imports.
```typescript
// Before: relative paths
import { useUpdateState } from "../../hooks/useUpdateState";

// After: @/ alias (shadcn convention)
import { cn } from "@/lib/utils"
```

Note: Existing component imports use relative paths (`../../hooks/useXxx`). Changing ALL existing imports to `@/` is optional for this phase -- only NEW code (cn() import, new test files) must use `@/`. Existing relative imports continue to work.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `components.json` | config | static | shadcn CLI config -- new to project. Use RESEARCH.md Pattern 3 template verbatim. |
| `src/components/ui/` | component | static | shadcn-generated primitives. Generated by `npx shadcn@latest add <component>`. No hand-coding needed. |
| `src/index.css` | config | static | New CSS architecture (Tailwind v4 imports + OKLCH tokens + @theme inline). No existing analog -- use RESEARCH.md Pattern 5 template. |

## Metadata

**Analog search scope:** `src/`, `vite.config.ts`, `tsconfig*.json`, `vitest.config.ts`
**Files scanned:** 30 source files + 3 CSS files + 5 config files
**Pattern extraction date:** 2026-05-05
