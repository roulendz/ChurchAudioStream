# Research Summary: Admin Panel UI Migration

**Project:** ChurchAudioStream
**Milestone:** v1.1 — Admin Panel Improvements
**Researched:** 2026-05-05
**Confidence:** HIGH

## Executive Summary

Migrating the admin panel from hand-rolled CSS to shadcn/ui + Tailwind CSS v4. The stack is fully compatible (Vite 7, React 19, TypeScript 5.9 — all supported). Incremental migration is the correct strategy: Tailwind utilities coexist with existing App.css via CSS `@layer` specificity rules. Canvas-based VU meters require zero changes. The full migration is ~5 phases with clear dependency ordering.

## Stack Additions

| Package | Version | Purpose |
|---------|---------|---------|
| `tailwindcss` | ^4.2.4 | CSS framework (v4, CSS-first config) |
| `@tailwindcss/vite` | ^4.2.4 | First-party Vite plugin (supports Vite 7) |
| `class-variance-authority` | ^0.7.1 | Component variant styling |
| `clsx` | ^2.1.1 | Conditional class joining |
| `tailwind-merge` | ^3.5.0 | Tailwind class deduplication |
| `lucide-react` | ^1.14.0 | Icon library (shadcn default) |
| `tw-animate-css` | ^1.4.0 | Animation utilities (replaces deprecated tailwindcss-animate) |
| `radix-ui` | ^1.4.3 | Unified Radix primitives (React 19 compatible) |
| `@dnd-kit/react` | ^0.4.x | Drag-to-reorder (NOT legacy @dnd-kit/core) |

**Do NOT install:** postcss, autoprefixer, tailwindcss-animate, tailwind.config.js, @radix-ui/react-* (individual packages).

## Key shadcn Components Needed

| Feature | Components |
|---------|-----------|
| Sidebar | `Sidebar`, `SidebarProvider`, `SidebarMenu`, `SidebarMenuButton`, `SidebarTrigger` |
| Channel cards | `Card`, `CardHeader`, `CardTitle`, `CardContent`, `CardFooter` |
| Status badges | `Badge` (variants: default/secondary/destructive/outline) |
| Header | `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem` |
| Drag reorder | `@diceui/sortable` or raw `@dnd-kit/react` |
| Utility | `Tooltip`, `ScrollArea`, `Separator` |

## Critical Integration Order (Pitfall-Informed)

1. Path aliases (`@/` in tsconfig + vite) — unblocks shadcn CLI
2. Create `src/index.css` as Tailwind entry — separate from legacy App.css
3. Wrap App.css in `@layer legacy` — prevents cascade conflicts
4. Install Tailwind v4 + `@tailwindcss/vite` — skip Preflight, plugin FIRST in array
5. Resolve CSS variable collisions (`--accent`, `--border`, `--radius`) — map to shadcn tokens
6. Configure dark-only theme in `:root` (no `.dark` class needed)
7. Run `npx shadcn init` — components.json with `rsc: false`
8. Add components via CLI — `npx shadcn add sidebar card badge ...`

## Architecture Decisions

- **Incremental migration** — each component migrated atomically, no mixing BEM + Tailwind on same element
- **No Preflight** — import only `tailwindcss/theme.css` + `tailwindcss/utilities.css`
- **Canvas VU meters unchanged** — pixel-based rendering immune to CSS resets
- **Dark-only** — theme tokens directly in `:root`, no `.dark` selector
- **System font stack** — no external font CDN (desktop app)
- **shadcn Sidebar component** — has built-in `collapsible="icon"` mode

## Watch Out For

1. **CSS layer precedence** — unlayered App.css always beats layered Tailwind utilities (MUST wrap in @layer)
2. **Variable name collisions** — `--accent`, `--border`, `--radius` exist in both systems
3. **dnd-kit versioning** — use `@dnd-kit/react` v0.4+ (NOT `@dnd-kit/core`)
4. **Plugin order** — `tailwindcss()` BEFORE `react()` in Vite plugins array
5. **Module CSS specificity** — 2 existing CSS Modules are unlayered, migrate them early

## Effort Estimates

| Phase | Scope | Effort |
|-------|-------|--------|
| Foundation (Tailwind + shadcn init) | Config, aliases, layers | 0.5 day |
| Sidebar (icons + collapsible) | DashboardShell + Sidebar rewrite | 1 day |
| Cards + Badges | Channel cards, status, tooltips | 1 day |
| Header + Breadcrumb | Header redesign | 0.5 day |
| Drag-to-reorder | @dnd-kit/react integration | 1.5 days |
| **Total** | | **~4.5 days** |

## Sources

- Context7: shadcn/ui official docs (Sidebar, Card, Badge, Breadcrumb, installation)
- npm registry: version verification for all packages
- Tailwind CSS v4 docs: @layer behavior, Vite plugin, no-preflight imports
- @dnd-kit/react docs: React 19 compatible drag-and-drop
- Existing codebase: App.css analysis, component inventory, design tokens
