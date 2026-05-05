# Technology Stack: shadcn/ui + Tailwind CSS Integration

**Project:** ChurchAudioStream Admin Panel
**Researched:** 2026-05-05
**Overall Confidence:** HIGH (verified via Context7 + npm registry)

## Recommended Stack Additions

### Core Packages (Runtime)

| Package | Version | Purpose | Why |
|---------|---------|---------|-----|
| `tailwindcss` | ^4.2.4 | Utility-first CSS framework | Bundled inside `@tailwindcss/vite` as dep; install explicitly for IDE tooling + CLI access |
| `@tailwindcss/vite` | ^4.2.4 | First-party Vite plugin for Tailwind v4 | Replaces PostCSS pipeline; native Vite integration, 5x faster builds. **Peer dep: vite ^5.2 \| ^6 \| ^7 \| ^8** — our Vite 7.2 is supported |
| `class-variance-authority` | ^0.7.1 | Variant-driven component styling | Used by every shadcn component (button, badge, etc.) for variant props |
| `clsx` | ^2.1.1 | Conditional class joining | Used inside `cn()` utility that shadcn generates |
| `tailwind-merge` | ^3.5.0 | Intelligent Tailwind class deduplication | Resolves conflicting utilities (e.g., `px-4 px-2` keeps last); `cn()` pipes clsx through this |
| `lucide-react` | ^1.14.0 | Icon library | Default shadcn icon set; tree-shakeable, consistent with component design |
| `tw-animate-css` | ^1.4.0 | Animation utilities for Tailwind v4 | Replaces deprecated `tailwindcss-animate`; used by Dialog, Sheet, Toast animations |
| `radix-ui` | ^1.4.3 | Unified Radix primitives | Peer: react ^16.8-19. Components like Dialog, Select, Tooltip come from here. Single package replaces dozens of `@radix-ui/react-*` |

### Dev Packages

| Package | Version | Purpose | Why |
|---------|---------|---------|-----|
| `shadcn` | ^4.6.0 | CLI for adding/updating components | `npx shadcn@latest init` bootstraps config; `npx shadcn@latest add button` adds components. Dev-only — not bundled |

### Already Present (no install needed)

| Package | Current | Required By | Status |
|---------|---------|-------------|--------|
| `@types/node` | ^25.2.2 | Vite `path.resolve` in alias config | Already installed |
| `react` | ^19.2.0 | radix-ui peer | Satisfied |
| `react-dom` | ^19.2.0 | radix-ui peer | Satisfied |
| `@types/react` | ^19.2.5 | radix-ui peer (@types/react: *) | Satisfied |
| `@types/react-dom` | ^19.2.3 | radix-ui peer | Satisfied |
| `vite` | ^7.2.4 | @tailwindcss/vite peer (^5.2\|^6\|^7\|^8) | Satisfied |

## Installation Commands

```bash
# Runtime dependencies
npm install tailwindcss @tailwindcss/vite class-variance-authority clsx tailwind-merge lucide-react tw-animate-css radix-ui

# Dev dependency (CLI only)
npm install -D shadcn@latest
```

## Configuration Changes Required

### 1. vite.config.ts — Add Tailwind plugin + path alias

```typescript
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
```

**Changes from current:**
- Added `import path from "path"`
- Added `import tailwindcss from "@tailwindcss/vite"`
- Added `tailwindcss()` to plugins array
- Added `resolve.alias` block for `@` path mapping

### 2. tsconfig.json — Add baseUrl + paths

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### 3. tsconfig.app.json — Mirror paths for IDE resolution

Add to `compilerOptions`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### 4. src/index.css — NEW FILE (Tailwind entry point)

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

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
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

:root {
  --radius: 0.625rem;
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.145 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.145 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.396 0.141 25.723);
  --border: oklch(0.269 0 0);
  --input: oklch(0.269 0 0);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.145 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.985 0 0);
  --sidebar-primary-foreground: oklch(0.205 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(0.269 0 0);
  --sidebar-ring: oklch(0.556 0 0);
}
```

**Note:** Dark theme shown above (matches existing app dark aesthetic). `shadcn init` generates this — values above are "neutral" base dark theme. Customize after init to match existing `--bg-primary: #1a1a2e` palette.

### 5. src/main.tsx — Import index.css

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

### 6. src/lib/utils.ts — NEW FILE (cn utility)

```typescript
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

### 7. components.json — NEW FILE (shadcn CLI config, project root)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "hooks": "@/hooks",
    "lib": "@/lib",
    "ui": "@/components/ui"
  }
}
```

**Key:** `"rsc": false` because Tauri/Vite = client-side only (no React Server Components).

## Migration Strategy: Existing CSS

Existing `src/App.css` (~1350 lines plain CSS) **coexists** with Tailwind. No immediate rewrite needed.

**Approach:**
1. Keep `App.css` as-is during integration
2. New components use shadcn/Tailwind
3. Gradually migrate old components from plain CSS to Tailwind utilities
4. CSS Modules (`*.module.css`) also coexist — Vite processes both pipelines

**Potential conflict:** Existing `:root` CSS variables in `App.css` use names like `--accent`, `--border` which overlap shadcn's CSS variable names. Resolution: Either namespace existing vars (e.g., `--app-accent`) or map shadcn's theme to match existing values during `index.css` setup.

## What NOT to Install (Common Mistakes)

| Package | Why NOT |
|---------|---------|
| `postcss` | Tailwind v4 Vite plugin bypasses PostCSS entirely |
| `autoprefixer` | Tailwind v4 handles vendor prefixes internally |
| `tailwindcss-animate` | Deprecated; replaced by `tw-animate-css` for v4 |
| `tailwind.config.js` | Tailwind v4 is CSS-first config; no JS config file needed |
| `@radix-ui/react-*` (individual) | Unified `radix-ui` package replaces all individual packages |
| `postcss.config.js` | Not needed with @tailwindcss/vite plugin |

## CLI Workflow (After Setup)

```bash
# Initialize shadcn (creates components.json, lib/utils.ts, index.css theme)
npx shadcn@latest init

# Add individual components as needed
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add dialog
npx shadcn@latest add select
npx shadcn@latest add toast

# Components land in src/components/ui/
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| CSS Framework | Tailwind v4 | Tailwind v3 | v4 has first-party Vite plugin, faster, CSS-first config |
| Component Lib | shadcn/ui | Radix Themes | shadcn = copy-paste ownership, full customization; Radix Themes = opinionated pre-styled |
| Component Lib | shadcn/ui | MUI/Ant Design | Too heavy, own styling system conflicts with Tailwind |
| Animations | tw-animate-css | tailwindcss-animate | Deprecated for v4; tw-animate-css is official replacement |
| Icons | lucide-react | heroicons | lucide = shadcn default, larger icon set, same API |
| Radix package | radix-ui (unified) | @radix-ui/react-* | Unified = single dep, simpler upgrades, less node_modules bloat |

## Compatibility Matrix

| Dependency | Required Version | Our Version | Status |
|------------|-----------------|-------------|--------|
| Vite | ^5.2 \| ^6 \| ^7 \| ^8 | 7.2.4 | PASS |
| React | ^16.8-19 | 19.2.0 | PASS |
| TypeScript | >=4.7 | 5.9.3 | PASS |
| Node.js | >=18 | (nvm4w) | PASS |

## Sources

- Context7: `/llmstxt/ui_shadcn_llms_txt` — Vite installation guide, components.json schema, theming, CLI docs
- npm registry: direct `npm view` for all version numbers + peer deps (verified 2026-05-05)
- [Tailwind CSS v4 Vite docs](https://tailwindcss.com/docs)
- [@tailwindcss/vite npm](https://www.npmjs.com/package/@tailwindcss/vite)
- [shadcn/ui installation](https://ui.shadcn.com/docs/installation/vite)
- [shadcn CLI](https://ui.shadcn.com/docs/cli)
