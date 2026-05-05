---
phase: 11-foundation
plan: "02"
subsystem: admin-ui
tags: [tailwind, css-migration, component-conversion]
dependency_graph:
  requires: [11-01]
  provides: [layout-shell-tailwind, sidebar-tailwind, connection-status-tailwind, app-tsx-no-css-import]
  affects: [src/App.tsx, src/components/layout/, src/components/ConnectionStatus.tsx, src/components/monitoring/, src/components/settings/QrCodeDisplay.tsx]
tech_stack:
  added: []
  patterns: [cn()-conditional-classes, tailwind-utility-inline, oklch-token-usage]
key_files:
  created: []
  modified:
    - src/App.tsx
    - src/components/layout/DashboardShell.tsx
    - src/components/layout/Sidebar.tsx
    - src/components/ConnectionStatus.tsx
    - src/components/monitoring/ListenerCountBadge.tsx
    - src/components/monitoring/VuMeterBank.tsx
    - src/components/settings/QrCodeDisplay.tsx
decisions:
  - "Removed listener-badge-count wrapper span in App.tsx overview — count placed directly in badge span"
  - "Used bg-card for VuMeterBank and QrCodeDisplay containers (maps to --bg-secondary OKLCH)"
  - "Added cn() to ListenerCountBadge for conditional empty state styling"
metrics:
  duration: "3m 49s"
  completed: "2026-05-05T17:19:49Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 7
---

# Phase 11 Plan 02: Layout Shell + Small Component Tailwind Conversion Summary

Converted 7 components from App.css global class references to inline Tailwind utility classes with cn() for conditionals and OKLCH design tokens for colors. Removed `import "./App.css"` from App.tsx.

## What Was Done

### Task 1: DashboardShell, Sidebar, ConnectionStatus (commit 62796af)

**DashboardShell.tsx** -- 4 class references replaced:
- `dashboard-shell` -> `grid grid-cols-[220px_1fr] grid-rows-[auto_1fr] min-h-screen`
- `dashboard-header` -> `col-span-full flex items-center justify-between px-5 py-3 border-b border-border bg-background sticky top-0 z-50`
- `app-title` -> `text-xl font-semibold text-foreground`
- `dashboard-content` -> `row-start-2 p-6 overflow-y-auto`

**Sidebar.tsx** -- Added `cn()` import; nav container + button converted:
- `dashboard-sidebar` -> `row-start-2 bg-card border-r border-border py-4 overflow-y-auto`
- `sidebar-nav-item` + `--active` BEM modifier -> cn() with `border-l-primary text-primary bg-primary/[0.08]` conditional
- Button reset classes added: `bg-transparent border-0 font-[inherit]` (Preflight resets differently)

**ConnectionStatus.tsx** -- Added `cn()` import; STATUS_DISPLAY record values converted:
- `status-dot--connected` -> `bg-success shadow-[0_0_6px] shadow-success`
- `status-dot--connecting/reconnecting` -> `bg-warning animate-pulse`
- `status-dot--disconnected` -> `bg-destructive`
- Container -> `flex items-center gap-2 text-sm px-3 py-1 rounded-full bg-card`

### Task 2: App.tsx, ListenerCountBadge, VuMeterBank, QrCodeDisplay (commit 8538d60)

**App.tsx** -- Removed `import "./App.css"`. 13 class references converted:
- `overview-section` -> `space-y-6`
- `overview-channel-badges` -> `bg-card border border-border rounded-md p-5`
- `overview-subheading` -> `text-base font-semibold text-foreground mb-3`
- `overview-badge-grid` -> `flex flex-wrap gap-3`
- `overview-badge-item` -> `flex items-center gap-2 bg-secondary rounded-md px-3 py-2`
- `listener-badge` + `listener-badge-count` -> single span with `inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold`
- `monitoring-section` -> `space-y-4`
- `monitoring-section-title` -> `text-xl font-semibold text-foreground`
- `settings-update-card/qr-code/log-viewer` -> `mt-6`
- Bare `<h2>` tags -> explicit `text-xl font-semibold text-foreground` (Preflight resets heading styles)

**ListenerCountBadge.tsx** -- Added cn() import. Badge + icon + count converted to inline Tailwind. Empty state uses cn() conditional `text-muted-foreground`.

**VuMeterBank.tsx** -- `vu-meter-bank` -> `flex flex-wrap gap-4 p-4 bg-card border border-border rounded-md`. Empty state -> `text-muted-foreground italic p-8 text-center bg-card border border-border rounded-md`.

**QrCodeDisplay.tsx** -- 6 class references converted:
- `qr-display` -> `flex flex-col items-center gap-4 p-6 bg-card border border-border rounded-md`
- `qr-url` -> `font-mono text-sm text-primary break-all`
- `qr-hint` -> `text-xs text-muted-foreground text-center max-w-[300px]`
- `qr-loading` -> `text-muted-foreground italic`
- `btn-copy` -> inline button with hover:border-primary/hover:text-primary transition
- `stat-card-label` -> `text-xs text-muted-foreground mb-1`

## Build Output

CSS bundle dropped from 45.68 kB to 29.36 kB (35% reduction) — dead App.css rules no longer included in output.

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

1. `npm run build` exits 0
2. Zero `App.css` imports in App.tsx
3. Zero legacy class names (`dashboard-shell`, `sidebar-nav-item`, `connection-status`, `overview-section`, `monitoring-section`, etc.) across all 7 files
4. `cn()` used in Sidebar.tsx for active state
5. `cn()` used in ConnectionStatus.tsx for status dot variants

## Threat Flags

None -- pure CSS class migration, no new network endpoints or auth paths.

## Self-Check: PASSED

- All 7 modified files exist on disk
- All 2 task commits found in git log (62796af, 8538d60)
- SUMMARY.md exists at .planning/phases/11-foundation/11-02-SUMMARY.md
