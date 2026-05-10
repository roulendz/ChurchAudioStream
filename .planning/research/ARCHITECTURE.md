# Architecture: shadcn/ui + Tailwind Migration for Admin Panel

**Domain:** Admin panel UI modernization (shadcn/ui + Tailwind v4 integration)
**Researched:** 2026-05-05
**Overall confidence:** HIGH

---

## Current State Analysis

### Layout Structure
- `DashboardShell` — CSS Grid (`sidebar-width | 1fr`), 2-row (`header | content`)
- `Sidebar` — plain `<button>` nav with BEM modifiers (`sidebar-nav-item--active`)
- Single `App.css` (~1356 lines) holds ALL admin styles via CSS custom properties
- 2 CSS Modules: `UpdateToast.module.css`, `CheckForUpdatesButton.module.css`

### Component Inventory (18 .tsx files)

| Component | Current Styling | Complexity | shadcn Migration |
|-----------|----------------|-----------|-----------------|
| DashboardShell | global CSS grid | Low | Tailwind grid classes |
| Sidebar | BEM buttons | Low | shadcn Sidebar or Tailwind nav |
| ChannelList | BEM cards + buttons | Medium | Card + Button + Badge |
| ChannelConfigPanel | form-field classes | Medium | Input + Select + Checkbox |
| ChannelCreateDialog | custom dialog | Low | Dialog + Input |
| ProcessingControls | custom slider/toggle | Medium | Slider + ToggleGroup |
| SourceSelector | custom list + picks | Medium | Select + Badge + Button |
| VuMeter | Canvas 60fps RAF | High | **NO CHANGE** (Canvas) |
| VuMeterBank | flex wrapper | Low | Tailwind flex only |
| ServerStatus | stat-card grid | Medium | Card grid |
| ListenerCountBadge | pill badge | Low | Badge |
| ConnectionStatus | dot + label | Low | Badge variant |
| SettingsPanel | form fields | High | Input + Select + Checkbox + Button |
| LogViewer | monospace scroller | Medium | Card shell (internals stay) |
| QrCodeDisplay | centered card | Low | Card |
| CheckForUpdatesButton | CSS Module | Low | Button (delete module) |
| UpdateToast | CSS Module | Low | Toaster/Sonner (delete module) |

### Current Design Tokens
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
  --success: #4caf50;
  --warning: #ff9800;
  --error: #f44336;
  --border: #2a3a5e;
  --radius: 6px;
}
```

---

## Recommended Architecture

### Strategy: Incremental Migration (NOT big-bang)

**Rationale:**
- App is live, used in production
- Dark-only theme = simpler (no light mode to worry about)
- Small team = cannot afford weeks of broken UI
- Incremental = ship one component per PR, old CSS coexists with Tailwind

### Migration Phases

```
Phase 1: Foundation (Tailwind + shadcn init, zero visual change)
Phase 2: Primitives (add shadcn components to src/components/ui/)
Phase 3: Leaf components (Badge, Button — no dependents)
Phase 4: Cards and panels (ServerStatus, QrCode, LogViewer)
Phase 5: Forms (Settings, ChannelConfig, ProcessingControls)
Phase 6: Complex compositions (ChannelList, Dialog, SourceSelector)
Phase 7: Layout (Sidebar, DashboardShell)
Phase 8: Cleanup (delete App.css, enable preflight)
```

---

## File Structure After Migration

```
src/
  components/
    ui/                          <-- shadcn primitives (CLI-generated)
      badge.tsx
      button.tsx
      card.tsx
      checkbox.tsx
      dialog.tsx
      input.tsx
      label.tsx
      select.tsx
      slider.tsx
      toggle-group.tsx
      toaster.tsx
    layout/
      DashboardShell.tsx         <-- Tailwind grid
      Sidebar.tsx                <-- Tailwind nav buttons
    channels/
      ChannelList.tsx            <-- Card + Button + Badge
      ChannelConfigPanel.tsx     <-- Input + Select + Checkbox
      ChannelCreateDialog.tsx    <-- Dialog + Input
      ProcessingControls.tsx     <-- Slider + ToggleGroup
      SourceSelector.tsx         <-- Select + Badge + Button
    monitoring/
      VuMeter.tsx                <-- UNCHANGED (Canvas, no Tailwind)
      VuMeterBank.tsx            <-- Tailwind flex wrapper only
      ServerStatus.tsx           <-- Card grid
      ListenerCountBadge.tsx     <-- Badge
    settings/
      QrCodeDisplay.tsx          <-- Card
      SettingsPanel.tsx          <-- Input + Select + Checkbox + Button
    ConnectionStatus.tsx         <-- Badge variant
    LogViewer.tsx                <-- Card shell, monospace internals
  lib/
    utils.ts                     <-- cn() utility (clsx + tailwind-merge)
  styles/
    index.css                    <-- Tailwind imports + theme tokens
  App.css                        <-- DELETED in Phase 8
```

---

## Integration Points

### 1. Vite Config Update

```typescript
// vite.config.ts
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    target: "es2022",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
```

### 2. TypeScript Path Alias

```json
// tsconfig.app.json — add to compilerOptions
{
  "baseUrl": ".",
  "paths": { "@/*": ["./src/*"] }
}
```

### 3. Tailwind CSS Entry (No Preflight)

```css
/* src/styles/index.css */
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);

/* Custom theme: dark-only, matching existing design tokens */
@theme inline {
  --color-background: oklch(0.15 0.02 260);
  --color-foreground: oklch(0.9 0.01 260);
  --color-card: oklch(0.17 0.025 260);
  --color-card-foreground: oklch(0.9 0.01 260);
  --color-primary: oklch(0.65 0.14 250);
  --color-primary-foreground: oklch(1 0 0);
  --color-secondary: oklch(0.2 0.03 260);
  --color-secondary-foreground: oklch(0.7 0.01 260);
  --color-muted: oklch(0.2 0.025 260);
  --color-muted-foreground: oklch(0.5 0.01 270);
  --color-accent: oklch(0.65 0.14 250);
  --color-accent-foreground: oklch(1 0 0);
  --color-destructive: oklch(0.55 0.2 25);
  --color-border: oklch(0.28 0.035 250);
  --color-input: oklch(0.22 0.025 250);
  --color-ring: oklch(0.65 0.14 250);
  --radius: 0.375rem;
}
```

### 4. Import Order in main.tsx

```typescript
// During migration (Phases 1-7):
import "./App.css";           // legacy styles — keeps working
import "./styles/index.css";  // Tailwind — utilities layer, lower specificity

// After Phase 8 cleanup:
import "./styles/index.css";  // Tailwind only
```

### 5. cn() Utility

```typescript
// src/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

---

## Canvas VuMeter Coexistence Strategy

**Problem:** VuMeter uses raw Canvas 2D at 60fps via requestAnimationFrame. Tailwind utilities have no effect inside Canvas drawing calls.

**Solution:**

1. **VuMeter internals unchanged.** All `ctx.fillStyle`, gradient creation, `ctx.fillRect` calls stay exactly as-is. Canvas rendering is pixel-based, not CSS-based.

2. **Wrapper div migrates to Tailwind:**
```typescript
// Before (App.css class):
<div className="vu-meter">

// After (Tailwind utilities):
<div className="flex flex-col items-center gap-1">
```

3. **Canvas element keeps inline style** — `style={{ width, height }}` is immune to Tailwind reset.

4. **VuMeterBank wrapper migrates:**
```typescript
// Before:
<div className="vu-meter-bank">

// After:
<div className="flex flex-wrap gap-4 p-4 bg-card border border-border rounded-md">
```

5. **Colors hardcoded in Canvas** — `COLOR_GREEN`, `COLOR_RED`, etc. are constants in VuMeter.tsx. NOT affected by CSS variables or Tailwind theme.

**Key insight:** Tailwind's preflight (even if enabled later) cannot interfere with `ctx.fillStyle` calls. Only element-level CSS dimensions matter, and those use inline styles already.

---

## Theme Mapping

| Current CSS Variable | shadcn Token | Tailwind Class |
|---------------------|-------------|---------------|
| `--bg-primary` | `background` | `bg-background` |
| `--bg-secondary` | `card` | `bg-card` |
| `--bg-tertiary` | `muted` | `bg-muted` |
| `--bg-input` | `input` | `bg-input` |
| `--text-primary` | `foreground` | `text-foreground` |
| `--text-secondary` | `card-foreground` | `text-card-foreground` |
| `--text-muted` | `muted-foreground` | `text-muted-foreground` |
| `--accent` | `primary` | `bg-primary text-primary` |
| `--success` | (custom) | `text-green-400` |
| `--warning` | (custom) | `text-amber-400` |
| `--error` | `destructive` | `text-destructive` |
| `--border` | `border` | `border-border` |
| `--radius` | `radius` | `rounded-md` |

**Dark-only:** Set `<html class="dark">` in `index.html`. Define all tokens in `:root` directly. No `.dark` selector needed.

---

## Component Boundaries

| Layer | Responsibility | Communicates With |
|-------|---------------|-------------------|
| `ui/*` | Pure presentation primitives (shadcn-generated) | Props only, no hooks |
| `layout/*` | Page structure, navigation state | App.tsx via props |
| `channels/*` | Channel CRUD + config UI | WebSocket hooks |
| `monitoring/*` | Real-time display | Audio levels hook, resource stats hook |
| `settings/*` | Server config forms | WebSocket hooks |
| `lib/utils.ts` | cn() merge utility | All components import |

---

## Build Order (Detailed Migration Sequence)

### Phase 1: Foundation (zero visual change)

```bash
npm install tailwindcss @tailwindcss/vite tailwind-merge clsx
npx shadcn@latest init
```

- Add `@tailwindcss/vite` plugin to `vite.config.ts`
- Add `@/` path alias to `tsconfig.app.json` + `vite.config.ts`
- Create `src/styles/index.css` (no preflight, theme tokens)
- Create `src/lib/utils.ts` (cn utility)
- Import `styles/index.css` in `main.tsx` AFTER `App.css`
- **Verify:** App looks identical, no regressions

### Phase 2: Add shadcn Primitives

```bash
npx shadcn@latest add button badge card input label select checkbox slider dialog toggle-group
```

- Components generated in `src/components/ui/`
- NOT used anywhere yet — just available in codebase
- **Verify:** Build passes, no runtime errors

### Phase 3: Migrate Leaf Components (no downstream deps)

| Order | Component | Change |
|-------|-----------|--------|
| 3.1 | ListenerCountBadge | Replace HTML + class → shadcn Badge |
| 3.2 | ConnectionStatus | Replace HTML + class → Badge variant |
| 3.3 | CheckForUpdatesButton | Replace HTML + CSS Module → shadcn Button |
| 3.4 | UpdateToast | Replace HTML + CSS Module → shadcn Toaster |

**After 3.4:** Delete `CheckForUpdatesButton.module.css` and `UpdateToast.module.css`

### Phase 4: Migrate Cards/Panels

| Order | Component | Change |
|-------|-----------|--------|
| 4.1 | ServerStatus | stat-card → shadcn Card |
| 4.2 | QrCodeDisplay | custom card → shadcn Card |
| 4.3 | LogViewer | outer shell → Card, keep monospace internals |
| 4.4 | VuMeterBank | wrapper div → Tailwind flex classes |

### Phase 5: Migrate Forms

| Order | Component | Change |
|-------|-----------|--------|
| 5.1 | SettingsPanel | form-field → Input + Select + Checkbox + Label + Button |
| 5.2 | ProcessingControls | slider + toggle → Slider + ToggleGroup |
| 5.3 | SourceSelector | custom UI → Select + Badge + Button |
| 5.4 | ChannelConfigPanel | composition of 5.1-5.3 patterns |
| 5.5 | ChannelCreateDialog | custom → Dialog + Input + Button |

### Phase 6: Migrate Channel List

| Order | Component | Change |
|-------|-----------|--------|
| 6.1 | ChannelList | channel-card → Card + StatusBadge + Button |

This is the most complex single component. Create a `StatusBadge` wrapper:
```typescript
const statusVariants = {
  streaming: "bg-green-500/15 text-green-400 border-green-500/30",
  starting: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  error: "bg-red-500/15 text-red-400 border-red-500/30",
  stopped: "bg-muted text-muted-foreground border-border",
} as const;
```

### Phase 7: Migrate Layout

| Order | Component | Change |
|-------|-----------|--------|
| 7.1 | Sidebar | BEM nav → Tailwind nav buttons (or shadcn Sidebar) |
| 7.2 | DashboardShell | CSS grid → Tailwind grid classes |

**Note:** Sidebar could use shadcn's full Sidebar component OR just Tailwind utilities. Recommend Tailwind utilities — the current sidebar is simple (4 buttons), shadcn Sidebar is heavy (collapsible, mobile drawer, etc.).

### Phase 8: Cleanup

- Delete `src/App.css` entirely
- Remove `import "./App.css"` from `main.tsx`
- Enable Tailwind preflight (switch to full `@import "tailwindcss"`)
- Remove any remaining BEM class references
- Full visual regression check

---

## Patterns to Follow

### Pattern 1: One Component Per PR
Migrate one component, remove its CSS from App.css comment block (or leave it — dead CSS until Phase 8). Each PR is reviewable and revertible.

### Pattern 2: Semantic Wrapper Components
Wrap shadcn primitives for domain-specific variants:
```typescript
// src/components/ui/status-badge.tsx
import { Badge } from "./badge";
import { cn } from "@/lib/utils";

const variants = { streaming: "...", starting: "...", error: "...", stopped: "..." };

export function StatusBadge({ status }: { status: string }) {
  return <Badge className={cn(variants[status as keyof typeof variants])}>{status}</Badge>;
}
```

### Pattern 3: Canvas Components Stay Pure
VuMeter uses no Tailwind internally. Only wrapper elements get Tailwind classes.

### Pattern 4: Form Pattern
```typescript
<div className="space-y-4">
  <div className="space-y-2">
    <Label htmlFor="port">Port</Label>
    <Input id="port" type="number" value={port} onChange={...} />
    {error && <p className="text-sm text-destructive">{error}</p>}
  </div>
</div>
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Mixed Old + New in Same Element
**Bad:** `className="channel-card bg-card"` — half old, half new
**Why:** Specificity conflicts, impossible to predict winner
**Fix:** Migrate entire component at once

### Anti-Pattern 2: @apply Rebuilding Old Classes
**Bad:** `@apply flex items-center gap-2` to recreate `.channel-card-info`
**Why:** Defeats utility-first purpose, harder to maintain than inline
**Fix:** Inline utilities directly in JSX

### Anti-Pattern 3: Tailwind Inside Canvas
**Bad:** Reading Tailwind theme values for Canvas fillStyle
**Why:** Runtime overhead, Canvas doesn't use CSS
**Fix:** Keep Canvas colors as hardcoded constants

### Anti-Pattern 4: Importing Full Tailwind During Transition
**Bad:** `@import "tailwindcss"` (includes preflight)
**Why:** Preflight resets headings, margins, buttons — breaks ALL existing CSS instantly
**Fix:** Import only `tailwindcss/theme.css` + `tailwindcss/utilities.css` until Phase 8

### Anti-Pattern 5: Over-Engineering Sidebar
**Bad:** Using shadcn's full Sidebar (collapsible, mobile sheet, keyboard nav)
**Why:** Current sidebar is 4 static buttons in a desktop-only Tauri app
**Fix:** Simple Tailwind nav with `aria-current` for active state

---

## Coexistence Mechanics (How Both Systems Work Simultaneously)

### CSS Specificity During Transition

```
App.css classes:       specificity = 0-1-0 (single class)
Tailwind utilities:    specificity = 0-1-0 (single class) BUT in @layer utilities
```

CSS `@layer` has LOWER priority than unlayered styles. So existing App.css always wins over Tailwind utilities if both target the same element. This means:
- Migrated components (using ONLY Tailwind) work correctly
- Unmigrated components (using ONLY App.css) work correctly
- No conflicts during transition period

### Import Order Matters

```typescript
import "./App.css";           // unlayered = higher priority
import "./styles/index.css";  // @layer utilities = lower priority
```

This is intentional. Unmigrated components keep working. Migrated components only use Tailwind (no old classes on the element), so they also work.

---

## Data Flow (Unchanged by Migration)

```
WebSocket hooks (useChannels, useAudioLevels, useServerStatus)
      |
      v
App.tsx (state orchestrator, section navigation)
      |
      v
DashboardShell (layout grid) --> Sidebar (nav)
      |
      v
Section content (ChannelList | Monitoring | Settings | Overview)
      |
      v
Leaf components (VuMeter, Badge, Card, etc.)
```

Migration is purely presentational. No hook changes, no state changes, no prop interface changes.

---

## New vs Modified Components

### New Files (created by migration)
- `src/components/ui/*.tsx` — shadcn primitives (~12 files)
- `src/lib/utils.ts` — cn() utility
- `src/styles/index.css` — Tailwind entry + theme

### Modified Files (className changes only)
- All 18 existing `.tsx` components get className updates
- `vite.config.ts` — add tailwindcss plugin + path alias
- `tsconfig.app.json` — add baseUrl + paths
- `main.tsx` — add styles/index.css import

### Deleted Files
- `src/App.css` (Phase 8)
- `src/components/UpdateToast/UpdateToast.module.css` (Phase 3)
- `src/components/CheckForUpdatesButton/CheckForUpdatesButton.module.css` (Phase 3)

---

## Package Dependencies

```bash
# Production
npm install tailwind-merge clsx

# Development
npm install -D tailwindcss @tailwindcss/vite
```

shadcn components add their own deps when generated (e.g., `@radix-ui/react-dialog`, `@radix-ui/react-select`, etc.). Each `npx shadcn add` command installs required packages automatically.

---

## Sources

- [shadcn/ui Vite Installation](https://ui.shadcn.com/docs/installation/vite) — Official setup (HIGH confidence)
- [shadcn/ui Theming](https://ui.shadcn.com/docs/theming) — CSS variable system, oklch tokens (HIGH confidence)
- [Tailwind v4 Preflight Disable](https://github.com/tailwindlabs/tailwindcss/issues/15723) — Import splitting method (HIGH confidence)
- [Tailwind CSS v4 Adding Custom Styles](https://tailwindcss.com/docs/adding-custom-styles) — @theme inline syntax (HIGH confidence)
- [coder/coder MUI-to-shadcn Migration](https://github.com/coder/coder/issues/18993) — Real-world incremental strategy (MEDIUM confidence)
- [shadcn/ui Handbook 2026](https://shadcnspace.com/blog/shadcn-ui-handbook) — Component organization best practices (MEDIUM confidence)
