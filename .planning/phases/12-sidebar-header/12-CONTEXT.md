# Phase 12: Sidebar & Header - Context

**Gathered:** 2026-05-05
**Status:** Ready for planning
**Source:** Autonomous workflow (requirements from ROADMAP.md + REQUIREMENTS.md)

<domain>
## Phase Boundary

Navigation gets professional polish — Lucide icons on each nav item, colored active indicators, section grouping with separators, breadcrumb trail in header, live connection status badge, listener count display, and sidebar toggle. All using shadcn/ui components on the Tailwind CSS v4 foundation from Phase 11.

</domain>

<decisions>
## Implementation Decisions

### Sidebar Navigation
- Each nav item displays a Lucide SVG icon alongside its label (SIDE-01)
- Active nav item has a visible colored indicator bar — not just text color change (SIDE-02)
- Nav items grouped into logical sections with visual separators between groups (SIDE-03)

### Header Components
- Header displays a breadcrumb showing current navigation path (HEAD-01)
- Connection status shown as an animated Badge with colored dot indicator (HEAD-02)
- Listener count badge prominently visible in header area (HEAD-03)
- Sidebar toggle trigger button in header (HEAD-04)

### Typography
- Section headings visually prominent with proper hierarchy (TYPO-02)

### Claude's Discretion
- Exact Lucide icon choices for each nav item
- Breadcrumb implementation approach (simple text vs shadcn Breadcrumb component)
- Sidebar toggle animation and behavior
- Badge component styling details
- Component file organization (new files vs extending existing)

</decisions>

<code_context>
## Existing Code Insights

### Phase 11 Foundation (completed)
- All components already use Tailwind utility classes
- cn() utility available at @/lib/utils
- OKLCH design tokens in src/index.css
- shadcn CLI configured (components.json)
- lucide-react already installed (bundled with shadcn)
- @/ path alias configured in tsconfig + vite + vitest

### Current Navigation
- Sidebar in src/components/layout/Sidebar.tsx — 4 nav items (overview, channels, monitoring, settings)
- DashboardShell in src/components/layout/DashboardShell.tsx — grid layout with header + sidebar + main
- ConnectionStatus in src/components/ConnectionStatus.tsx — status dot with label
- ListenerCountBadge in src/components/monitoring/ListenerCountBadge.tsx

### shadcn Components to Install
- Badge (for status indicators, listener count)
- Breadcrumb (for navigation path)
- Separator (for section dividers)
- Button (already may be installed from Phase 11)
- Tooltip (may be needed for toggle button)

</code_context>

<specifics>
## Specific Ideas

- Use `npx shadcn add` to install needed components
- Lucide icons are already available (lucide-react installed in Phase 11)
- Current DashboardSection type: "overview" | "channels" | "monitoring" | "settings"
- Sidebar currently has no icons, no section grouping, no active indicator bar

</specifics>

<deferred>
## Deferred Ideas

- SIDE-04: Collapsible sidebar mode (icon-only rail) — v2
- SIDE-05: Sidebar badges showing listener counts per nav item — v2
- SIDE-06: Sidebar collapsed state persisted to config.json — v2

</deferred>
