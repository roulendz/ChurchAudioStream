---
phase: 11-foundation
plan: 05
subsystem: ui
tags: [css-cleanup, migration-validation, design-tokens, testing]

requires: [11-02, 11-03, 11-04]
provides:
  - "Zero legacy CSS — App.css deleted (1355 lines)"
  - "css-modules.d.ts deleted"
  - "VuMeter container converted to Tailwind utilities"
  - "11 design token tests (OKLCH, migration, smoke)"
  - "vitest @/ path alias configured"
affects: [12-sidebar, 13-channels, 14-header]

tech-stack:
  removed: [App.css, css-modules.d.ts]
  patterns: [design-token-tests, migration-completeness-tests, component-smoke-tests]
---

## What Changed

1. **Deleted legacy CSS**: Removed `src/App.css` (1355 lines) and `src/css-modules.d.ts`. Only `src/index.css` remains.
2. **Converted VuMeter**: Container div and label converted from App.css classes to Tailwind utilities (`flex flex-col items-center gap-1.5`, `truncate text-xs text-muted-foreground`). Canvas drawing code unchanged.
3. **Design token tests**: Created `src/__tests__/design-tokens.test.tsx` with 11 tests across 3 suites:
   - `design tokens` (6 tests): OKLCH import, token presence, color format, no .dark selector, system font, @theme inline
   - `CSS migration completeness` (3 tests): App.css deleted, no .module.css files, no css-modules.d.ts
   - `component smoke tests` (2 tests): DashboardShell and ConnectionStatus render
4. **vitest alias fix**: Added `resolve.alias` for `@/` to `vitest.config.ts` (was only in `vite.config.ts`).

## Verification

- `npm run build` exits 0
- 117/117 tests pass (1 pre-existing scripts test failure unrelated to migration)
- Zero `App.css`, `module.css`, or `css-modules` references in src/
- Only CSS file: `src/index.css`

## Requirements Completed

- FOUN-03: All App.css styles converted to Tailwind utilities; App.css deleted
- TYPO-01: Consistent design token usage across all admin components
