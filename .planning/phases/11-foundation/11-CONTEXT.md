# Phase 11: Foundation - Context

**Gathered:** 2026-05-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Admin app fully migrates from hand-rolled CSS to Tailwind CSS v4 + shadcn/ui design system. No legacy CSS remains — all styles converted to Tailwind utilities and shadcn tokens. Existing UI appearance preserved through accurate OKLCH token mapping. Tests validate the migration.

</domain>

<decisions>
## Implementation Decisions

### Token Mapping Strategy
- Full migration to shadcn OKLCH tokens — no dual variable systems, no legacy CSS vars retained
- Variable name collisions (--accent, --border, --radius) resolved by replacing legacy vars with shadcn equivalents everywhere
- OKLCH color format for all tokens (shadcn standard)
- New `src/index.css` with `@import "tailwindcss"` + `:root` OKLCH tokens. App.css deleted after full conversion.

### CSS Architecture & Cleanup
- App.css (1356 lines) fully rewritten — all styles replaced with Tailwind utility classes inline on components + shadcn tokens in index.css. App.css deleted.
- Both CSS module files (CheckForUpdatesButton.module.css, UpdateToast.module.css) converted to Tailwind utility classes, module files deleted
- No CSS layers needed — Tailwind's built-in cascade handles everything
- Tailwind Preflight enabled — full CSS reset since no legacy styles to conflict with

### Verification & Dev Experience
- Permanent "Design Tokens" section in Settings page — color swatches, typography, spacing as living documentation
- Vitest unit tests validate component rendering, token resolution, cn() utility
- `@/` path alias maps to `src/` (shadcn standard) — update tsconfig + vite resolve
- shadcn components in `src/components/ui/` (default), custom components in `src/components/`

### Claude's Discretion
- Exact OKLCH color values mapped from existing hex palette
- Component conversion order within this phase
- Vitest test structure and assertions
- Design tokens section layout and detail level

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- 11 custom hooks (useServerStatus, useChannels, useSources, useAudioLevels, useListenerCounts, useResourceStats, useUpdateState, useWebSocket) — all preserved, no styling changes
- Canvas-based VuMeter.tsx — pixel rendering unaffected by CSS migration
- useFocusTrap accessibility hook in src/lib/ — preserved
- QR code generation (qrcode package) — preserved

### Established Patterns
- State management via custom hooks + prop drilling (no Redux/Context)
- React 19.2 with StrictMode
- Component-scoped logic in individual files under src/components/
- Two CSS module components (CheckForUpdatesButton, UpdateToast) — will be converted
- Global CSS in App.css with BEM-like class names — will be replaced

### Integration Points
- vite.config.ts — add @tailwindcss/vite plugin BEFORE react() plugin
- tsconfig.app.json — add `@/` path alias (paths: {"@/*": ["./src/*"]})
- src/main.tsx — import index.css instead of App.css
- package.json — add tailwindcss, @tailwindcss/vite, shadcn dependencies
- components.json — shadcn CLI configuration file at project root

### Current CSS Custom Properties (to map to OKLCH)
- --bg-primary: #1a1a2e, --bg-secondary: #16213e, --bg-tertiary: #0f3460
- --bg-input: #1e2a4a
- --text-primary: #e0e0e0, --text-secondary: #a0a0b0, --text-muted: #6b6b80
- --accent: #5a9cf5, --accent-hover: #4a8ce5, --accent-disabled: #3a5a80
- --success: #4caf50, --warning: #ff9800, --error: #f44336
- --border: #2a3a5e, --border-focus: #5a9cf5
- --radius: 6px
- --font-mono: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace
- --sidebar-width: 220px

</code_context>

<specifics>
## Specific Ideas

- User explicitly requested: "No legacy code left, no dead code, full migration to shadcn, and write tests to validate"
- This overrides the original incremental migration approach (FOUN-03 @layer legacy coexistence)
- All 21 components must have their styles converted to Tailwind utilities
- App.css and both .module.css files deleted by end of phase

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
