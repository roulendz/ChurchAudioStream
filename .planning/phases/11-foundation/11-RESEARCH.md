# Phase 11: Foundation - Research

**Researched:** 2026-05-05
**Domain:** Tailwind CSS v4 + shadcn/ui design system migration (React/Vite admin app)
**Confidence:** HIGH

## Summary

Phase 11 performs a FULL migration of the admin app from 1356 lines of hand-rolled global CSS (App.css) + 2 CSS module files to Tailwind CSS v4 utility classes + shadcn/ui design tokens. No legacy CSS remains. App.css and both module files deleted. Preflight enabled. All 21 components converted to inline Tailwind utilities. OKLCH tokens mapped from existing hex palette to shadcn semantic variables.

Stack is well-documented and stable: Tailwind CSS v4.2.4, @tailwindcss/vite 4.2.4, shadcn CLI 4.7.0 (also provides runtime `shadcn/tailwind.css`), tw-animate-css 1.4.0, radix-ui 1.4.3 (unified package), clsx 2.1.1, tailwind-merge 3.5.0, class-variance-authority 0.7.1, lucide-react 1.14.0. All verified against npm registry.

**Primary recommendation:** Install dependencies, run `npx shadcn@latest init`, create index.css with OKLCH tokens mapped to existing palette, convert all 21 components to Tailwind utility classes, delete App.css and both .module.css files, add Vitest tests for tokens and cn() utility.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Full migration to shadcn OKLCH tokens -- no dual variable systems, no legacy CSS vars retained
- Variable name collisions (--accent, --border, --radius) resolved by replacing legacy vars with shadcn equivalents everywhere
- OKLCH color format for all tokens (shadcn standard)
- New `src/index.css` with `@import "tailwindcss"` + `:root` OKLCH tokens. App.css deleted after full conversion.
- App.css (1356 lines) fully rewritten -- all styles replaced with Tailwind utility classes inline on components + shadcn tokens in index.css. App.css deleted.
- Both CSS module files (CheckForUpdatesButton.module.css, UpdateToast.module.css) converted to Tailwind utility classes, module files deleted
- No CSS layers needed -- Tailwind's built-in cascade handles everything
- Tailwind Preflight enabled -- full CSS reset since no legacy styles to conflict with
- Permanent "Design Tokens" section in Settings page -- color swatches, typography, spacing as living documentation
- Vitest unit tests validate component rendering, token resolution, cn() utility
- `@/` path alias maps to `src/` (shadcn standard) -- update tsconfig + vite resolve
- shadcn components in `src/components/ui/` (default), custom components in `src/components/`

### Claude's Discretion
- Exact OKLCH color values mapped from existing hex palette
- Component conversion order within this phase
- Vitest test structure and assertions
- Design tokens section layout and detail level

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUN-01 | Admin app builds with Tailwind CSS v4 via @tailwindcss/vite plugin (no PostCSS) | Standard Stack section: exact packages, vite.config.ts plugin setup |
| FOUN-02 | shadcn/ui CLI configured with components.json, cn() utility, and @/ path aliases | Architecture Patterns: components.json schema, lib/utils.ts, tsconfig paths |
| FOUN-03 | ~~Existing App.css wrapped in @layer legacy~~ **OVERRIDDEN: Full deletion of App.css** | User override: no legacy coexistence, full migration |
| FOUN-04 | Dark theme tokens mapped from existing palette to shadcn OKLCH variables | Code Examples: complete OKLCH conversion table, index.css template |
| FOUN-05 | System font stack configured (no external CDN fonts) | Code Examples: font-family token in index.css |
| TYPO-01 | Consistent design token usage across all admin components | Architecture Patterns: token usage via Tailwind utilities |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Design token definitions (OKLCH vars) | Frontend Server (Vite CSS) | -- | CSS variables live in index.css, processed by @tailwindcss/vite at build time |
| Component styling | Browser / Client | -- | Tailwind utility classes applied inline on React components |
| cn() merge utility | Browser / Client | -- | Runtime class merging in React components |
| Path alias resolution | Build tool (Vite + TSC) | -- | Compile-time resolution, no runtime impact |
| Design Tokens display | Browser / Client | -- | React component rendering color swatches |
| Test validation | Build tool (Vitest) | -- | CI/dev-time assertion of tokens and rendering |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tailwindcss | 4.2.4 | Utility-first CSS framework | [VERIFIED: npm registry] Industry standard, v4 is CSS-first config |
| @tailwindcss/vite | 4.2.4 | Vite plugin for Tailwind v4 | [VERIFIED: npm registry] Official first-party plugin, replaces PostCSS |
| shadcn (CLI + runtime) | 4.7.0 | Component generator + tailwind.css base styles | [VERIFIED: npm registry] Provides CLI and `shadcn/tailwind.css` CSS export |
| radix-ui | 1.4.3 | Accessible unstyled UI primitives (unified package) | [VERIFIED: npm registry] Replaces individual @radix-ui/react-* packages |
| tw-animate-css | 1.4.0 | Animation classes for shadcn components | [VERIFIED: npm registry] Replaced tailwindcss-animate for Tailwind v4 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| clsx | 2.1.1 | Conditional class string construction | [VERIFIED: npm registry] Used inside cn() utility |
| tailwind-merge | 3.5.0 | Intelligent Tailwind class deduplication | [VERIFIED: npm registry] Prevents conflicting utilities (e.g. `p-4 p-2` -> `p-2`) |
| class-variance-authority | 0.7.1 | Component variant definitions | [VERIFIED: npm registry] Type-safe variant props for reusable components |
| lucide-react | 1.14.0 | SVG icon library | [VERIFIED: npm registry] shadcn default icon library |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| radix-ui (unified) | Individual @radix-ui/react-* | Unified avoids version drift; tree-shakeable so no bundle penalty |
| tw-animate-css | tailwindcss-animate | tailwindcss-animate deprecated for Tailwind v4; tw-animate-css is replacement |
| clsx + tailwind-merge | just clsx | tailwind-merge handles Tailwind-specific dedup; clsx alone can't resolve `p-4 p-2` conflicts |

**Installation:**
```bash
npm install tailwindcss @tailwindcss/vite shadcn radix-ui tw-animate-css clsx tailwind-merge class-variance-authority lucide-react
```

**Version verification:** All versions verified against npm registry on 2026-05-05.

## Architecture Patterns

### System Architecture Diagram

```
src/index.css (entry)
  |
  |-- @import "tailwindcss"        --> Tailwind base/utilities/Preflight
  |-- @import "tw-animate-css"     --> Animation keyframes
  |-- @import "shadcn/tailwind.css" --> shadcn base component styles
  |
  |-- @theme inline { ... }        --> Maps CSS vars to Tailwind utilities
  |                                     (--color-primary -> bg-primary class)
  |
  |-- :root { ... }                --> OKLCH design tokens (dark-only, direct)
  |
  v
React Components (*.tsx)
  |-- className="bg-primary text-primary-foreground ..."  (Tailwind utilities)
  |-- cn() for conditional/merged classes
  |-- No CSS modules, no global class selectors
  |
  v
@tailwindcss/vite plugin (build)
  |-- Scans all .tsx for used classes
  |-- Generates optimized CSS bundle
  v
dist/assets/*.css (output)
```

### Recommended Project Structure
```
src/
  index.css              # Tailwind imports + @theme inline + :root tokens
  main.tsx               # import "./index.css" (replaces App.css import)
  App.tsx                # No CSS import
  lib/
    utils.ts             # cn() utility (clsx + tailwind-merge)
  components/
    ui/                  # shadcn-generated components (Button, Card, etc.)
    layout/
      DashboardShell.tsx # Converted to Tailwind utilities
      Sidebar.tsx        # Converted to Tailwind utilities
    channels/            # Converted to Tailwind utilities
    monitoring/          # Converted to Tailwind utilities
    settings/            # Converted to Tailwind utilities
    CheckForUpdatesButton/
      CheckForUpdatesButton.tsx  # Converted (module.css DELETED)
      index.ts
    UpdateToast/
      UpdateToast.tsx    # Converted (module.css DELETED)
      index.ts
  hooks/                 # Unchanged (no styling)
components.json          # shadcn CLI config (project root)
```

### Pattern 1: vite.config.ts Setup
**What:** Add @tailwindcss/vite plugin + @/ path alias
**When to use:** One-time setup

```typescript
// Source: https://ui.shadcn.com/docs/installation/vite [CITED]
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
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
})
```

**Note on plugin order:** shadcn docs show `[react(), tailwindcss()]`. CONTEXT.md and STATE.md say tailwindcss BEFORE react. Both work with Vite 7 / Tailwind 4.2 — order is not critical per Tailwind v4 docs. [ASSUMED] Use `[react(), tailwindcss()]` to match shadcn official docs.

### Pattern 2: tsconfig Path Aliases
**What:** Add `@/` path alias for shadcn imports
**When to use:** Required for shadcn components

```json
// tsconfig.json — add to compilerOptions
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

```json
// tsconfig.app.json — add to compilerOptions
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```
Source: [CITED: https://ui.shadcn.com/docs/installation/vite]

### Pattern 3: components.json
**What:** shadcn CLI configuration
**When to use:** Created during `npx shadcn@latest init`

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```
Source: [CITED: https://ui.shadcn.com/docs/components-json]

**Key decisions:**
- `rsc: false` -- NOT a Next.js app, no RSC
- `style: "new-york"` -- only valid style (default deprecated) [CITED: shadcn docs]
- `tailwind.config: ""` -- empty string for Tailwind v4 (no JS config file)
- `tailwind.css: "src/index.css"` -- points to CSS entry

### Pattern 4: cn() Utility
**What:** Class name merging with Tailwind dedup
**When to use:** Every component with conditional classes

```typescript
// src/lib/utils.ts
// Source: https://ui.shadcn.com/docs/installation/manual [CITED]
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

### Pattern 5: index.css with Dark-Only OKLCH Tokens
**What:** Complete CSS entry with design tokens
**When to use:** Replaces App.css

```css
/* src/index.css */
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

/* Dark-only app: tokens go directly in :root, no .dark selector needed */
:root {
  /* --- Backgrounds --- */
  --background: oklch(0.228 0.038 282.9);
  --foreground: oklch(0.907 0.000 263.3);
  --card: oklch(0.254 0.057 266.7);
  --card-foreground: oklch(0.907 0.000 263.3);
  --popover: oklch(0.254 0.057 266.7);
  --popover-foreground: oklch(0.907 0.000 263.3);

  /* --- Semantic --- */
  --primary: oklch(0.689 0.148 256.4);
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.325 0.088 255.1);
  --secondary-foreground: oklch(0.907 0.000 263.3);
  --muted: oklch(0.292 0.061 267.1);
  --muted-foreground: oklch(0.535 0.033 285.2);
  --accent: oklch(0.325 0.088 255.1);
  --accent-foreground: oklch(0.907 0.000 263.3);
  --destructive: oklch(0.643 0.215 28.8);

  /* --- Chrome --- */
  --border: oklch(0.353 0.066 265.0);
  --input: oklch(0.292 0.061 267.1);
  --ring: oklch(0.689 0.148 256.4);
  --radius: 0.375rem;

  /* --- Sidebar --- */
  --sidebar: oklch(0.254 0.057 266.7);
  --sidebar-foreground: oklch(0.907 0.000 263.3);
  --sidebar-primary: oklch(0.689 0.148 256.4);
  --sidebar-primary-foreground: oklch(1 0 0);
  --sidebar-accent: oklch(0.325 0.088 255.1);
  --sidebar-accent-foreground: oklch(0.907 0.000 263.3);
  --sidebar-border: oklch(0.353 0.066 265.0);
  --sidebar-ring: oklch(0.689 0.148 256.4);

  /* --- Chart / Status --- */
  --chart-1: oklch(0.689 0.148 256.4);
  --chart-2: oklch(0.673 0.162 144.2);
  --chart-3: oklch(0.770 0.174 64.0);
  --chart-4: oklch(0.643 0.215 28.8);
  --chart-5: oklch(0.535 0.033 285.2);

  /* --- App-specific (non-shadcn) --- */
  --success: oklch(0.673 0.162 144.2);
  --warning: oklch(0.770 0.174 64.0);
  --accent-hover: oklch(0.639 0.150 256.6);
  --accent-disabled: oklch(0.460 0.073 253.5);
  --font-mono: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-accent-hover: var(--accent-hover);
  --color-accent-disabled: var(--accent-disabled);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    line-height: 1.5;
  }
}
```

### Pattern 6: Component Migration (Global CSS -> Tailwind)
**What:** Converting BEM/global class selectors to inline Tailwind utilities
**When to use:** Every component that references App.css classes

**Before (App.css class references):**
```tsx
<div className="dashboard-shell">
  <header className="dashboard-header">
    <h1 className="app-title">Church Audio Stream - Admin</h1>
  </header>
  <nav className="dashboard-sidebar">...</nav>
  <main className="dashboard-content">{children}</main>
</div>
```

**After (Tailwind utilities):**
```tsx
<div className="grid grid-cols-[220px_1fr] grid-rows-[auto_1fr] min-h-screen">
  <header className="col-span-full flex items-center justify-between px-5 py-3 border-b border-border bg-background sticky top-0 z-50">
    <h1 className="text-xl font-semibold text-foreground">Church Audio Stream - Admin</h1>
  </header>
  <nav className="row-start-2 bg-card border-r border-border py-4 overflow-y-auto">...</nav>
  <main className="row-start-2 p-6 overflow-y-auto">{children}</main>
</div>
```

### Pattern 7: CSS Module Migration
**What:** Converting CSS module imports to inline Tailwind
**When to use:** CheckForUpdatesButton and UpdateToast

**Before:**
```tsx
import styles from "./CheckForUpdatesButton.module.css";
// ...
<div className={styles.card}>
  <button className={styles["check-button"]}>Check</button>
</div>
```

**After:**
```tsx
// No CSS import
<div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2">
  <button className="px-4 py-2 rounded-md bg-success text-white font-medium text-sm min-w-24 inline-flex items-center justify-center disabled:opacity-60 disabled:cursor-progress">
    Check
  </button>
</div>
```

### Anti-Patterns to Avoid
- **Mixing global CSS classes with Tailwind:** Don't keep some styles in a CSS file and others inline. Full migration means ALL styles are Tailwind utilities or shadcn tokens in index.css.
- **Using @layer legacy:** The user explicitly rejected incremental migration. No @layer wrappers.
- **Keeping CSS modules alongside Tailwind:** Delete module files after conversion. Don't maintain two systems.
- **Hand-rolling CSS custom properties outside index.css:** All tokens live in index.css `:root`. No component-level `<style>` blocks.
- **Using `var(--custom-prop)` in className:** Use Tailwind utility classes that map to tokens (e.g., `bg-primary` not `bg-[var(--primary)]`). Exception: app-specific non-shadcn vars like `--font-mono` can use arbitrary values `font-[family-name:var(--font-mono)]`.

## OKLCH Color Conversion Table

All hex values computed via sRGB -> XYZ (D65) -> OKLab -> OKLCH transformation.

| Legacy Variable | Hex | OKLCH Value | shadcn Token Mapping |
|----------------|-----|-------------|---------------------|
| --bg-primary | #1a1a2e | oklch(0.228 0.038 282.9) | --background |
| --bg-secondary | #16213e | oklch(0.254 0.057 266.7) | --card, --sidebar |
| --bg-tertiary | #0f3460 | oklch(0.325 0.088 255.1) | --secondary, --accent |
| --bg-input | #1e2a4a | oklch(0.292 0.061 267.1) | --input, --muted |
| --text-primary | #e0e0e0 | oklch(0.907 0.000 263.3) | --foreground |
| --text-secondary | #a0a0b0 | oklch(0.711 0.023 285.7) | (used inline where needed) |
| --text-muted | #6b6b80 | oklch(0.535 0.033 285.2) | --muted-foreground |
| --accent | #5a9cf5 | oklch(0.689 0.148 256.4) | --primary, --ring |
| --accent-hover | #4a8ce5 | oklch(0.639 0.150 256.6) | --accent-hover (custom) |
| --accent-disabled | #3a5a80 | oklch(0.460 0.073 253.5) | --accent-disabled (custom) |
| --success | #4caf50 | oklch(0.673 0.162 144.2) | --success (custom), --chart-2 |
| --warning | #ff9800 | oklch(0.770 0.174 64.0) | --warning (custom), --chart-3 |
| --error | #f44336 | oklch(0.643 0.215 28.8) | --destructive, --chart-4 |
| --border | #2a3a5e | oklch(0.353 0.066 265.0) | --border |
| --border-focus | #5a9cf5 | oklch(0.689 0.148 256.4) | --ring (same as accent) |

[VERIFIED: Computed via Node.js sRGB->XYZ->OKLab->OKLCH conversion at research time]

**Mapping rationale:**
- `--accent` (blue) -> `--primary` because shadcn uses `bg-primary` for primary actions (buttons, active states). Our accent IS primary color.
- `--bg-tertiary` -> `--secondary` and `--accent` because these are used for subtle interactive backgrounds in shadcn.
- `--error` -> `--destructive` direct mapping (shadcn uses destructive for error/danger states).
- `--success`, `--warning`, `--accent-hover`, `--accent-disabled` are NOT standard shadcn tokens. Defined as custom vars + registered via `@theme inline` for Tailwind utility access.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Class name merging | String concatenation with ternaries | cn() (clsx + tailwind-merge) | Handles Tailwind dedup, conditional classes, proper override semantics |
| Component variants | Switch statements for className | class-variance-authority (cva) | Type-safe variant definitions, compound variants, defaultVariants |
| CSS reset/normalize | Custom `* { margin: 0 }` rules | Tailwind Preflight | Battle-tested reset, matches Tailwind utility assumptions |
| Icon SVGs | Inline `<svg>` elements | lucide-react | Consistent sizing, accessibility, tree-shakeable |
| Animation keyframes | Custom @keyframes in CSS | tw-animate-css | Standard set matching shadcn component expectations |
| Color format conversion | CSS calc() hacks | OKLCH values in :root | Perceptually uniform, native browser support |

**Key insight:** shadcn provides a coherent design system where tokens, utilities, and components work together. Hand-rolling any part breaks the integration.

## Common Pitfalls

### Pitfall 1: Dark Mode Class Toggle on Dark-Only App
**What goes wrong:** shadcn default CSS uses `.dark { }` selector with `@custom-variant dark`. For dark-only app, styles never activate because no element has `.dark` class.
**Why it happens:** shadcn assumes light+dark mode toggle.
**How to avoid:** Put dark values directly in `:root`. Omit `.dark` selector entirely. Remove `@custom-variant dark` line. Don't use `dark:` prefix utilities.
**Warning signs:** All colors appear as light theme (white backgrounds, black text).

### Pitfall 2: CSS Variable Name Collisions
**What goes wrong:** Existing App.css defines `--accent`, `--border`, `--radius`. shadcn also uses these names. During partial migration, values conflict.
**Why it happens:** Both systems chose same semantic names independently.
**How to avoid:** Full migration resolves this -- old vars deleted with App.css, new vars in index.css use shadcn OKLCH format. No collision possible after App.css deletion.
**Warning signs:** Wrong colors on components that still reference old vars.

### Pitfall 3: Tailwind Preflight Resetting Heading Styles
**What goes wrong:** h1-h6 become unstyled (inherit font-size/weight) after Preflight. Headings look like body text.
**Why it happens:** Preflight sets `font-size: inherit; font-weight: inherit` on all headings.
**How to avoid:** Every `<h1>`, `<h2>`, etc. must have explicit Tailwind typography classes: `text-xl font-semibold`, `text-lg font-semibold`, etc.
**Warning signs:** All headings appear same size as paragraph text after migration.

### Pitfall 4: CSS Module Import Left Behind
**What goes wrong:** TypeScript file still imports `./CheckForUpdatesButton.module.css` after file deleted. Build fails.
**Why it happens:** Forgot to remove import statement when deleting module CSS file.
**How to avoid:** For each deleted .module.css file: (1) delete file, (2) remove import in .tsx, (3) replace all `styles.xxx` with Tailwind classes.
**Warning signs:** Vite build error: "Failed to resolve import".

### Pitfall 5: Missing @theme inline Registration
**What goes wrong:** Custom CSS variables (--success, --warning) work in `var()` but not as Tailwind utilities (`bg-success`).
**Why it happens:** `@theme inline` maps CSS vars to Tailwind utilities. Without registration, Tailwind doesn't know about custom vars.
**How to avoid:** Every custom var that needs a Tailwind utility class must be in the `@theme inline` block as `--color-xxx: var(--xxx)`.
**Warning signs:** `bg-success` produces no color. Works only with `bg-[var(--success)]`.

### Pitfall 6: verbatimModuleSyntax + path Import
**What goes wrong:** `import path from "path"` in vite.config.ts fails with `verbatimModuleSyntax` enabled.
**Why it happens:** tsconfig.node.json has `verbatimModuleSyntax: true`. `path` is a CJS module -- needs `import path from "node:path"` or use `import { resolve } from "node:path"`.
**How to avoid:** Use `import { resolve } from "node:path"` with named import, or `import path from "node:path"` (the `node:` prefix works with verbatimModuleSyntax).
**Warning signs:** TypeScript error on vite.config.ts about module syntax.

### Pitfall 7: shadcn as devDependency
**What goes wrong:** `@import "shadcn/tailwind.css"` fails in production build if shadcn is devDependency.
**Why it happens:** `shadcn/tailwind.css` is a runtime CSS import from node_modules, resolved at build time by Vite. Vite resolves from dependencies at build, but some bundlers treat devDeps differently.
**How to avoid:** Install `shadcn` as regular dependency (not devDependency). It exports `./tailwind.css` used in production CSS.
**Warning signs:** Build works in dev, fails in `npm run build` or CI.

### Pitfall 8: Vitest CSS Processing
**What goes wrong:** Tests fail because Tailwind classes not processed, or CSS imports error.
**Why it happens:** vitest.config.ts needs `css: true` to process CSS imports. Also needs @tailwindcss/vite plugin to resolve `@import "tailwindcss"`.
**How to avoid:** vitest.config.ts already has `css: true`. Must also add tailwindcss plugin to vitest config.
**Warning signs:** Test errors about CSS import resolution.

## Component Migration Reference

### All 21 Components to Convert

| Component | CSS Source | Migration Complexity | Notes |
|-----------|-----------|---------------------|-------|
| DashboardShell.tsx | App.css (grid layout) | Medium | Grid template columns/rows |
| Sidebar.tsx | App.css (nav items) | Medium | Active state BEM modifier |
| ConnectionStatus.tsx | App.css (status dots) | Low | Animation keyframes -> tw-animate |
| SettingsPanel.tsx | App.css (form fields) | High | Many form element styles |
| LogViewer.tsx | App.css (log entries) | High | Scrollbar styling, log levels |
| ChannelList.tsx | App.css (cards, buttons) | High | Many button variants |
| ChannelConfigPanel.tsx | App.css (config sections) | Medium | Section containers |
| ChannelCreateDialog.tsx | App.css (dialog) | Low | Simple container |
| ProcessingControls.tsx | App.css (sliders, toggles) | Medium | Segmented toggle, slider |
| SourceSelector.tsx | App.css (source items) | Medium | Interactive list items |
| ListenerCountBadge.tsx | App.css (badge) | Low | Simple badge |
| ServerStatus.tsx | App.css (stat cards) | Medium | Grid of cards |
| VuMeter.tsx | None (canvas) | None | Pixel rendering, no CSS |
| VuMeterBank.tsx | App.css (flex layout) | Low | Container layout |
| QrCodeDisplay.tsx | App.css (QR display) | Low | Simple centered layout |
| CheckForUpdatesButton.tsx | module.css | Medium | CSS module -> Tailwind + delete module |
| UpdateToast.tsx | module.css | Medium | CSS module -> Tailwind + delete module |
| App.tsx | imports App.css | Low | Change import to index.css |
| main.tsx | none | None | Already minimal |

**Files to DELETE after migration:**
1. `src/App.css` (1356 lines)
2. `src/components/CheckForUpdatesButton/CheckForUpdatesButton.module.css` (78 lines)
3. `src/components/UpdateToast/UpdateToast.module.css` (108 lines)
4. `src/css-modules.d.ts` (no longer needed, CSS modules gone)

## Code Examples

### Example 1: Sidebar Nav Item with Active State
```tsx
// Before: BEM classes from App.css
<button className={`sidebar-nav-item${isActive ? " sidebar-nav-item--active" : ""}`}>
  {label}
</button>

// After: Tailwind utilities with cn()
import { cn } from "@/lib/utils"

<button
  className={cn(
    "flex items-center gap-3 w-full px-5 py-2.5 border-l-[3px] border-l-transparent",
    "text-muted-foreground text-sm text-left cursor-pointer transition-all duration-150",
    "hover:bg-white/[0.04] hover:text-foreground",
    isActive && "border-l-primary text-primary bg-primary/[0.08]"
  )}
>
  {label}
</button>
```

### Example 2: Connection Status with Animation
```tsx
// After: Tailwind utilities
const dotVariants: Record<string, string> = {
  connected: "bg-success shadow-[0_0_6px] shadow-success",
  connecting: "bg-warning animate-pulse",
  reconnecting: "bg-warning animate-pulse",
  disconnected: "bg-destructive",
}

<div className="flex items-center gap-2 text-sm px-3 py-1 rounded-full bg-card">
  <span className={cn("size-2 rounded-full shrink-0", dotVariants[status])} />
  <span className="text-muted-foreground whitespace-nowrap">{displayLabel}</span>
</div>
```

### Example 3: Button Variants (Primary, Secondary, Icon)
```tsx
// After: Tailwind utilities mapping to App.css button styles
// Primary button
<button className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-accent-hover disabled:bg-accent-disabled disabled:text-muted-foreground disabled:cursor-not-allowed">
  Save
</button>

// Secondary button
<button className="px-3 py-1.5 bg-transparent border border-border rounded-md text-muted-foreground text-sm cursor-pointer transition-all hover:border-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed">
  Cancel
</button>

// Icon button
<button className="bg-transparent border border-border rounded-md text-muted-foreground size-7 text-xs inline-flex items-center justify-center cursor-pointer transition-all hover:border-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed">
  X
</button>
```

### Example 4: Form Field
```tsx
<div className="flex flex-col gap-1.5">
  <label htmlFor="settings-port" className="text-sm font-medium text-muted-foreground">
    Port
  </label>
  <input
    id="settings-port"
    type="number"
    className={cn(
      "px-3 py-2 bg-input border border-border rounded-md text-foreground text-sm",
      "outline-none transition-colors focus:border-ring",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      portError && "border-destructive"
    )}
  />
  {portError && <span className="text-xs text-destructive">{portError}</span>}
</div>
```

### Example 5: Design Tokens Section in Settings
```tsx
// Permanent section in Settings page showing live token values
function DesignTokensSection() {
  const tokenGroups = [
    {
      label: "Backgrounds",
      tokens: [
        { name: "background", className: "bg-background" },
        { name: "card", className: "bg-card" },
        { name: "secondary", className: "bg-secondary" },
        { name: "muted", className: "bg-muted" },
        { name: "input", className: "bg-input" },
      ],
    },
    {
      label: "Semantic",
      tokens: [
        { name: "primary", className: "bg-primary" },
        { name: "destructive", className: "bg-destructive" },
        { name: "success", className: "bg-success" },
        { name: "warning", className: "bg-warning" },
      ],
    },
  ]

  return (
    <section className="bg-card border border-border rounded-md p-5">
      <h2 className="text-lg font-semibold mb-4 text-foreground">Design Tokens</h2>
      {tokenGroups.map(({ label, tokens }) => (
        <div key={label} className="mb-4">
          <h3 className="text-sm font-semibold text-foreground mb-2">{label}</h3>
          <div className="flex flex-wrap gap-3">
            {tokens.map(({ name, className }) => (
              <div key={name} className="flex flex-col items-center gap-1">
                <div className={cn("size-10 rounded-md border border-border", className)} />
                <span className="text-xs text-muted-foreground">{name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tailwind.config.js/ts | CSS-first config (@theme, @import) | Tailwind v4.0 (Jan 2025) | No JS config file needed |
| PostCSS plugin | @tailwindcss/vite native plugin | Tailwind v4.0 | Faster builds, tighter Vite integration |
| tailwindcss-animate | tw-animate-css | shadcn Mar 2025 update | Direct CSS import, no plugin config |
| HSL color format | OKLCH color format | shadcn Mar 2025 update | Perceptually uniform, wider gamut |
| Individual @radix-ui/react-* packages | Unified radix-ui package | radix-ui v1.4 (Feb 2026) | Single dependency, no version drift |
| React.forwardRef pattern | data-slot + direct function components | React 19 + shadcn 2025 | Simpler code, no ref forwarding boilerplate |
| `hsl(var(--color))` wrapper | `var(--color)` direct (values include format) | Tailwind v4 | Simpler variable usage |
| @layer base for vars | :root directly (outside @layer) | Tailwind v4 | Variables must be outside @layer for proper cascade |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Plugin order `[react(), tailwindcss()]` works (matching shadcn docs) vs STATE.md saying tailwindcss BEFORE react | Architecture Patterns | Low -- both orders work, easy to swap if issues arise |
| A2 | `shadcn` package as regular dependency (not devDep) required for `shadcn/tailwind.css` CSS import | Standard Stack | Medium -- if Vite resolves devDeps at build time, could be devDep instead |
| A3 | `--success` and `--warning` custom vars registered in @theme inline will generate `bg-success`/`bg-warning` utilities | Code Examples | Medium -- if Tailwind requires specific naming, may need `--color-success` only |

## Open Questions (RESOLVED)

1. **shadcn init behavior on existing project** — RESOLVED: Skip `npx shadcn init`. Manually create components.json and src/lib/utils.ts. This avoids any overwrites and gives full control over index.css OKLCH tokens.

2. **Tailwind v4 + Vitest plugin configuration** — RESOLVED: Add tailwindcss() to vitest.config.ts plugins array. jsdom doesn't render CSS visually but the plugin ensures CSS imports resolve without errors. If tests pass without it, the plugin can be removed later.

3. **@keyframes pulse already in tw-animate-css?** — RESOLVED: Use Tailwind's built-in `animate-pulse` class. It provides opacity-based pulse which matches the current connection status dot behavior. tw-animate-css adds additional utilities but the built-in is sufficient.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | npm, Vite, vitest | Yes | (via nvm4w) | -- |
| npm | Package installation | Yes | (via nvm4w) | -- |
| Vite | Build tool | Yes | 7.2.4 (in package.json) | -- |
| Vitest | Test runner | Yes | 4.1.5 (in package.json) | -- |
| TypeScript | Type checking | Yes | 5.9.3 (in package.json) | -- |

No external services or tools needed beyond existing setup.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 + @testing-library/react 16.3.2 |
| Config file | vitest.config.ts (exists) |
| Quick run command | `npm test` |
| Full suite command | `npm run test:coverage` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUN-01 | App builds with Tailwind CSS v4 | build | `npm run build` | N/A (build cmd) |
| FOUN-02 | cn() utility merges classes correctly | unit | `npm test -- src/lib/utils.test.ts` | No -- Wave 0 |
| FOUN-02 | shadcn components install without errors | smoke | `npx shadcn@latest add button --yes` | N/A (CLI) |
| FOUN-04 | OKLCH tokens resolve to correct colors | unit | `npm test -- src/__tests__/design-tokens.test.ts` | No -- Wave 0 |
| FOUN-05 | No external font network requests | manual-only | Visual inspection in DevTools Network tab | N/A |
| TYPO-01 | Components render with consistent tokens | unit | `npm test -- src/components/**/*.test.tsx` | Partial (2 exist) |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm run test:coverage`
- **Phase gate:** Full suite green + `npm run build` succeeds

### Wave 0 Gaps
- [ ] `src/lib/utils.test.ts` -- covers FOUN-02 (cn() utility)
- [ ] `src/__tests__/design-tokens.test.ts` -- covers FOUN-04 (token resolution)
- [ ] vitest.config.ts update -- add tailwindcss plugin if needed for CSS resolution

## Security Domain

No security concerns for this phase. Pure frontend CSS/styling migration. No auth, no data handling, no API changes, no user input processing beyond what already exists.

## Project Constraints (from CLAUDE.md)

- **DRY:** cn() utility centralizes class merging logic. Token definitions in single index.css.
- **SRP:** Each component handles its own styling via className props. No cross-component style leakage.
- **Self-explanatory naming:** Tailwind utility classes are self-documenting. Token names match shadcn convention.
- **Tests:** cn() utility tested. Token resolution tested. Component rendering tested.
- **Tiger-Style (fail fast):** If token missing or class invalid, visual regression immediately visible.
- **No spaghetti:** Flat utility classes, no nested CSS selectors, no BEM modifier chains.
- **Agent runs commands:** Agent handles all build/test steps.

## Sources

### Primary (HIGH confidence)
- [npm registry] - tailwindcss 4.2.4, @tailwindcss/vite 4.2.4, shadcn 4.7.0, radix-ui 1.4.3, tw-animate-css 1.4.0, clsx 2.1.1, tailwind-merge 3.5.0, cva 0.7.1, lucide-react 1.14.0
- [https://ui.shadcn.com/docs/installation/vite] - Vite installation steps
- [https://ui.shadcn.com/docs/installation/manual] - Full CSS template, components.json schema, cn() utility
- [https://ui.shadcn.com/docs/tailwind-v4] - Tailwind v4 migration, OKLCH format, @theme inline
- [https://ui.shadcn.com/docs/theming] - Complete CSS variable list
- [https://ui.shadcn.com/docs/components-json] - components.json schema reference
- [https://tailwindcss.com/docs/preflight] - Preflight reset behavior

### Secondary (MEDIUM confidence)
- [https://ui.shadcn.com/docs/changelog/2026-02-radix-ui] - Unified radix-ui package announcement
- [https://www.npmjs.com/package/shadcn] - shadcn package exports (./tailwind.css)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified against npm registry, shadcn docs fetched and parsed
- Architecture: HIGH -- patterns from official shadcn installation docs, verified against codebase structure
- Pitfalls: HIGH -- derived from known Tailwind v4 behavior, shadcn dark mode docs, and codebase analysis

**Research date:** 2026-05-05
**Valid until:** 2026-06-05 (stable ecosystem, 30-day validity)
