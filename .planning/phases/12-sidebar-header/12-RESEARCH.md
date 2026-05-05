# Phase 12: Sidebar & Header - Research

**Researched:** 2026-05-05
**Domain:** React UI components (shadcn/ui sidebar navigation + header widgets)
**Confidence:** HIGH

## Summary

Phase 12 upgrades the admin panel's navigation from plain text buttons to a polished sidebar with Lucide icons, active indicator bars, section grouping, and a header with breadcrumb, animated connection status badge, listener count, and sidebar toggle. All building blocks exist: shadcn/ui is configured, lucide-react installed, OKLCH design tokens in place, cn() utility ready.

The existing `Sidebar.tsx` already has a `border-l-primary` active indicator and basic nav structure. Work is additive -- extend current components with icons, grouping separators, and install 3-4 shadcn primitives (Badge, Breadcrumb, Separator, Tooltip). No architectural changes needed; `DashboardShell` gains new props (totalListeners, sidebar toggle state) and the header section gets richer content.

**Primary recommendation:** Use shadcn's individual primitives (Badge, Breadcrumb, Separator, Tooltip, Button) -- NOT the full shadcn Sidebar component (SidebarProvider/SidebarMenu). Full Sidebar is designed for collapsible/responsive sidebars (deferred to v2 SIDE-04). Current simple nav structure is cleaner and avoids pulling in SidebarProvider context machinery that won't be used.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Each nav item displays a Lucide SVG icon alongside its label (SIDE-01)
- Active nav item has a visible colored indicator bar -- not just text color change (SIDE-02)
- Nav items grouped into logical sections with visual separators between groups (SIDE-03)
- Header displays a breadcrumb showing current navigation path (HEAD-01)
- Connection status shown as an animated Badge with colored dot indicator (HEAD-02)
- Listener count badge prominently visible in header area (HEAD-03)
- Sidebar toggle trigger button in header (HEAD-04)
- Section headings visually prominent with proper hierarchy (TYPO-02)

### Claude's Discretion
- Exact Lucide icon choices for each nav item
- Breadcrumb implementation approach (simple text vs shadcn Breadcrumb component)
- Sidebar toggle animation and behavior
- Badge component styling details
- Component file organization (new files vs extending existing)

### Deferred Ideas (OUT OF SCOPE)
- SIDE-04: Collapsible sidebar mode (icon-only rail) -- v2
- SIDE-05: Sidebar badges showing listener counts per nav item -- v2
- SIDE-06: Sidebar collapsed state persisted to config.json -- v2
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SIDE-01 | Each nav item displays Lucide SVG icon alongside label | lucide-react already installed; icon map in NAV_ITEMS config |
| SIDE-02 | Active nav item has visible indicator bar | Existing `border-l-primary` pattern; enhance with thicker bar + bg highlight |
| SIDE-03 | Nav items grouped into sections with visual separators | shadcn Separator component between nav groups |
| HEAD-01 | Header displays breadcrumb showing current nav path | shadcn Breadcrumb component installed via CLI |
| HEAD-02 | Connection status as animated Badge with colored dot | shadcn Badge component wrapping existing ConnectionStatus dot logic |
| HEAD-03 | Listener count badge in header | Move/integrate ListenerCountBadge into header, pass totalListeners to DashboardShell |
| HEAD-04 | Sidebar toggle trigger button in header | Button (ghost variant, icon-only) with PanelLeft icon from lucide-react |
| TYPO-02 | Section headings visually prominent with proper hierarchy | Standardize h2/h3 classes across sections |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Sidebar navigation | Browser / Client | -- | Pure React state-driven nav, no routing |
| Active indicator | Browser / Client | -- | CSS styling based on currentSection state |
| Breadcrumb | Browser / Client | -- | Derives from currentSection state |
| Connection status | Browser / Client | API / Backend | Display in client; data from WebSocket hook |
| Listener count | Browser / Client | API / Backend | Display in client; data from WebSocket hook |
| Sidebar toggle | Browser / Client | -- | Local UI state (show/hide) |

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| shadcn | 4.7.0 | Component CLI + base system | Installed [VERIFIED: package.json] |
| radix-ui | 1.4.3 | Headless primitives (unified) | Installed [VERIFIED: package.json] |
| lucide-react | ^1.14.0 | SVG icon library | Installed [VERIFIED: package.json] |
| class-variance-authority | ^0.7.1 | Variant styling (CVA) | Installed [VERIFIED: package.json] |
| tailwind-merge | ^3.5.0 | Tailwind class dedup | Installed [VERIFIED: package.json] |

### shadcn Components to Install
| Component | Install Command | Purpose |
|-----------|----------------|---------|
| Badge | `npx shadcn@latest add badge` | Connection status, listener count display |
| Breadcrumb | `npx shadcn@latest add breadcrumb` | Navigation path in header |
| Separator | `npx shadcn@latest add separator` | Visual dividers between nav groups |
| Tooltip | `npx shadcn@latest add tooltip` | Sidebar toggle button tooltip |

[VERIFIED: Context7 /shadcn-ui/ui] -- all 4 components exist in shadcn v4 and install via CLI.

### Already Installed shadcn Components
| Component | File |
|-----------|------|
| Button | `src/components/ui/button.tsx` |

[VERIFIED: filesystem glob]

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Individual primitives | Full shadcn Sidebar (SidebarProvider) | Overkill -- pulls in SidebarProvider context, collapsible machinery, mobile sheet. All deferred to v2. |
| shadcn Breadcrumb | Manual span/chevron | shadcn Breadcrumb is 0-dep, accessible, already styled. No reason to hand-roll. |

**Installation:**
```bash
npx shadcn@latest add badge breadcrumb separator tooltip
```

## Architecture Patterns

### System Architecture Diagram

```
App.tsx (state owner)
  |
  +-- DashboardShell (layout grid)
  |     |
  |     +-- <header>
  |     |     +-- Breadcrumb (derives from currentSection)
  |     |     +-- ConnectionStatusBadge (animated dot + label)
  |     |     +-- ListenerCountBadge (totalListeners)
  |     |     +-- SidebarToggle (Button ghost, toggles sidebar visibility)
  |     |
  |     +-- Sidebar (nav)
  |     |     +-- NavGroup "Main" (Overview, Channels)
  |     |     +-- Separator
  |     |     +-- NavGroup "System" (Monitoring, Settings)
  |     |     +-- Each NavItem: Icon + Label + active indicator bar
  |     |
  |     +-- <main> (children)
```

### Component Responsibilities

| Component | File | Responsibility |
|-----------|------|----------------|
| Sidebar | `src/components/layout/Sidebar.tsx` | Nav items with icons, groups, separators, active indicator |
| DashboardShell | `src/components/layout/DashboardShell.tsx` | Grid layout, header content, sidebar toggle state |
| ConnectionStatus | `src/components/ConnectionStatus.tsx` | Refactor to use shadcn Badge with animated dot |
| ListenerCountBadge | `src/components/monitoring/ListenerCountBadge.tsx` | Refactor to use shadcn Badge |
| Header breadcrumb | New (inline in DashboardShell or extracted) | Breadcrumb from currentSection |

### Recommended Project Structure (no new folders needed)
```
src/components/
  layout/
    Sidebar.tsx           # Modified: add icons, groups, separators
    DashboardShell.tsx     # Modified: add breadcrumb, toggle, richer header
  ui/
    badge.tsx             # NEW: installed via shadcn CLI
    breadcrumb.tsx        # NEW: installed via shadcn CLI
    separator.tsx         # NEW: installed via shadcn CLI
    tooltip.tsx           # NEW: installed via shadcn CLI
    button.tsx            # EXISTS
  ConnectionStatus.tsx    # Modified: wrap in shadcn Badge
  monitoring/
    ListenerCountBadge.tsx # Modified: use shadcn Badge
```

### Pattern 1: Lucide Icon Map for Navigation
**What:** Define icon mapping alongside nav items using lucide-react components
**When to use:** Nav items need consistent icon + label rendering

```typescript
// Source: lucide-react + existing NAV_ITEMS pattern
import { LayoutDashboard, Radio, Activity, Settings, type LucideIcon } from "lucide-react";

interface NavItem {
  section: DashboardSection;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { section: "overview", label: "Overview", icon: LayoutDashboard },
  { section: "channels", label: "Channels", icon: Radio },
  { section: "monitoring", label: "Monitoring", icon: Activity },
  { section: "settings", label: "Settings", icon: Settings },
];
```

[VERIFIED: Context7 /shadcn-ui/ui -- SidebarMenuButton pattern uses same icon-as-component approach]

### Pattern 2: Nav Item Groups with Separators
**What:** Split NAV_ITEMS into logical groups, render Separator between them
**When to use:** SIDE-03 requirement

```typescript
// Source: shadcn Separator + SidebarGroup pattern
import { Separator } from "@/components/ui/separator";

const NAV_GROUPS = [
  {
    label: "Main",
    items: [
      { section: "overview", label: "Overview", icon: LayoutDashboard },
      { section: "channels", label: "Channels", icon: Radio },
    ],
  },
  {
    label: "System",
    items: [
      { section: "monitoring", label: "Monitoring", icon: Activity },
      { section: "settings", label: "Settings", icon: Settings },
    ],
  },
] as const;

// Render with Separator between groups
{NAV_GROUPS.map((group, gi) => (
  <div key={group.label}>
    {gi > 0 && <Separator className="my-2" />}
    <p className="px-5 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
      {group.label}
    </p>
    {group.items.map((item) => (
      <NavButton key={item.section} {...item} />
    ))}
  </div>
))}
```

### Pattern 3: shadcn Breadcrumb for Navigation Path
**What:** Use shadcn Breadcrumb to show "Admin > Current Section"
**When to use:** HEAD-01 requirement

```typescript
// Source: Context7 /shadcn-ui/ui - breadcrumb component
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

// In header:
<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem>
      <BreadcrumbLink>Admin</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbPage>{sectionLabel}</BreadcrumbPage>
    </BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```

Note: BreadcrumbLink uses `asChild` for custom elements. Since this app has no router (state-driven nav), BreadcrumbLink can be a button or just styled text. The "Admin" root is always visible; current section is the `<BreadcrumbPage>`.

### Pattern 4: Animated Connection Status Badge
**What:** Wrap connection dot in shadcn Badge with pulse animation
**When to use:** HEAD-02 requirement

```typescript
// Source: Context7 /shadcn-ui/ui - badge variants
import { Badge } from "@/components/ui/badge";

<Badge variant="outline" className="gap-1.5">
  <span
    className={cn(
      "size-2 rounded-full",
      status === "connected" && "bg-success animate-pulse",
      status === "connecting" && "bg-warning animate-pulse",
      status === "reconnecting" && "bg-warning animate-pulse",
      status === "disconnected" && "bg-destructive",
    )}
  />
  {displayLabel}
</Badge>
```

Current `ConnectionStatus` already has this dot + label pattern. Refactor wraps it in `Badge variant="outline"` instead of custom div.

### Pattern 5: Sidebar Toggle
**What:** Ghost button in header toggles sidebar visibility
**When to use:** HEAD-04 requirement

```typescript
// Source: lucide-react PanelLeft icon + shadcn Button
import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

<Button variant="ghost" size="icon" onClick={onToggleSidebar} aria-label="Toggle sidebar">
  <PanelLeft className="size-5" />
</Button>
```

Toggle state lives in DashboardShell (or App.tsx). When sidebar hidden, grid changes from `grid-cols-[220px_1fr]` to `grid-cols-[1fr]`. Sidebar gets `hidden` class or conditional render.

### Anti-Patterns to Avoid
- **Full shadcn Sidebar for 4 items:** Massive component with provider, mobile sheet, rail, keyboard shortcuts. Overkill for 4 static nav items. Only justified at SIDE-04 (v2).
- **React Router for breadcrumb:** App has no URL bar (Tauri desktop). State-driven nav is simpler. Out of scope per REQUIREMENTS.md.
- **Inline SVG icons:** ListenerCountBadge currently has inline SVG for user icon. Replace with `Users` from lucide-react for consistency.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Badge styling | Custom span with rounded-full | `shadcn Badge` | Handles variants, accessibility, consistent with design system |
| Breadcrumb nav | Manual span + "/" separator | `shadcn Breadcrumb` | Proper `<nav>` + `<ol>` semantics, aria-current, separator styling |
| Visual dividers | `<hr>` or border-b divs | `shadcn Separator` | Radix primitive with orientation support, proper role="separator" |
| Icon rendering | Inline `<svg>` paths | lucide-react components | Tree-shakeable, consistent sizing, TypeScript typed |
| Tooltip | title attribute | `shadcn Tooltip` | Accessible, styled, keyboard-compatible (needed for Phase 13 CARD-03) |

**Key insight:** All 5 primitives are <50 lines each after shadcn install. Installing them now sets up foundation for Phase 13 (Card tooltips, scroll area) and Phase 14 (drag handle tooltips).

## Common Pitfalls

### Pitfall 1: TooltipProvider Missing
**What goes wrong:** Tooltip renders nothing or crashes with "useContext" error
**Why it happens:** shadcn Tooltip requires `TooltipProvider` wrapping the app
**How to avoid:** Add `<TooltipProvider>` in App.tsx wrapping DashboardShell (or in main.tsx)
**Warning signs:** Console error about missing context

### Pitfall 2: Breadcrumb Link Click Behavior
**What goes wrong:** BreadcrumbLink renders as `<a>` which causes page navigation in Tauri
**Why it happens:** Default BreadcrumbLink uses `<a href>`. No router in this app.
**How to avoid:** Use `asChild` with a `<button>` for clickable breadcrumb items, or make root "Admin" non-interactive (just text)
**Warning signs:** Clicking breadcrumb causes blank page or navigation error

### Pitfall 3: Badge Import Collision
**What goes wrong:** Name collision between new shadcn `Badge` and existing custom badge components
**Why it happens:** ListenerCountBadge has its own inline badge styling
**How to avoid:** Refactor ListenerCountBadge to use shadcn Badge internally. Clear import paths.
**Warning signs:** Wrong component rendered, missing styles

### Pitfall 4: Sidebar Toggle Breaking Grid Layout
**What goes wrong:** Hiding sidebar leaves empty column space or causes content to not fill width
**Why it happens:** CSS Grid `grid-cols-[220px_1fr]` still reserves 220px even if sidebar has `display:none`
**How to avoid:** Toggle grid template itself: `grid-cols-[220px_1fr]` vs `grid-cols-[1fr]` based on sidebar state
**Warning signs:** Blank gap on left when sidebar hidden

### Pitfall 5: totalListeners Not Passed to Header
**What goes wrong:** ListenerCountBadge in header shows 0 or undefined
**Why it happens:** DashboardShell currently doesn't receive totalListeners prop. Must be added.
**How to avoid:** Add `totalListeners: number` to DashboardShellProps, thread from App.tsx
**Warning signs:** Always shows 0 listeners in header badge

### Pitfall 6: Pulse Animation on Connected Status
**What goes wrong:** Pulse animation is jarring or missing
**Why it happens:** Tailwind `animate-pulse` uses opacity oscillation. Success color with glow shadow may conflict.
**How to avoid:** Test `animate-pulse` on the dot only (not entire badge). Current ConnectionStatus uses `shadow-[0_0_6px] shadow-success` for connected glow -- may want to keep that approach instead of or alongside pulse.
**Warning signs:** Entire badge label text pulsing, or glow disappearing

## Code Examples

### shadcn Badge with Variants
```typescript
// Source: Context7 /shadcn-ui/ui - badge component
// Variants: default, outline, secondary, destructive
import { Badge } from "@/components/ui/badge";

// Connection status
<Badge variant="outline" className="gap-1.5">
  <span className="size-2 rounded-full bg-success animate-pulse" />
  Connected
</Badge>

// Listener count
<Badge variant="secondary">
  <Users className="size-3.5" />
  {totalListeners}
</Badge>
```

### shadcn Breadcrumb Composition
```typescript
// Source: Context7 /shadcn-ui/ui - breadcrumb component
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

// Non-interactive root + current page (no router, state-driven)
<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem>
      <span className="text-muted-foreground">Admin</span>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbPage>{sectionLabels[currentSection]}</BreadcrumbPage>
    </BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```

### Lucide Icon Usage
```typescript
// Source: lucide-react library (already installed)
import { LayoutDashboard, Radio, Activity, Settings, PanelLeft, Users } from "lucide-react";

// In nav button:
<Icon className="size-4 shrink-0" />
<span>{label}</span>

// In toggle button:
<Button variant="ghost" size="icon">
  <PanelLeft className="size-5" />
</Button>
```

### Active Indicator Bar (Enhanced)
```typescript
// Source: existing Sidebar.tsx pattern, enhanced for SIDE-02
// Current: border-l-[3px] border-l-primary (thin, subtle)
// Enhanced: border-l-[3px] with stronger bg highlight
<button
  className={cn(
    "flex items-center gap-3 w-full px-5 py-2.5",
    "border-l-[3px] border-l-transparent",
    "text-muted-foreground text-sm text-left cursor-pointer",
    "transition-all duration-150",
    "hover:bg-accent/50 hover:text-foreground",
    isActive && "border-l-primary text-primary bg-primary/10 font-medium"
  )}
>
  <Icon className="size-4 shrink-0" />
  <span>{label}</span>
</button>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Individual @radix-ui/react-* | Unified `radix-ui` package | 2024 | Single import: `import { Slot } from "radix-ui"` |
| shadcn/ui v0 (copy-paste) | shadcn CLI v4.7 (`npx shadcn add`) | 2025 | CLI auto-installs to `src/components/ui/` |
| Heroicons / FontAwesome | lucide-react | 2024+ | Tree-shakeable, shadcn default icon library |
| `@tailwindcss/postcss` | `@tailwindcss/vite` plugin | Tailwind v4 | Direct Vite integration, no PostCSS |

[VERIFIED: package.json versions, Context7 docs]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `npx shadcn@latest add badge breadcrumb separator tooltip` will work with existing components.json config | Standard Stack | LOW -- shadcn CLI is already proven (Button installed successfully in Phase 11) |
| A2 | Grouping nav into "Main" (Overview, Channels) and "System" (Monitoring, Settings) is the right split | Architecture Patterns | LOW -- discretion area, easily changed |
| A3 | Lucide icons: LayoutDashboard, Radio, Activity, Settings are good choices | Code Examples | LOW -- discretion area, easily swapped |
| A4 | Sidebar toggle should hide/show sidebar (not collapse to icon rail) | Architecture Patterns | LOW -- SIDE-04 (icon rail) explicitly deferred to v2 |

## Open Questions

1. **Section heading hierarchy (TYPO-02)**
   - What we know: Current headings use inconsistent sizes (text-xl, text-lg, text-base) across sections
   - What's unclear: Exact standardization desired (e.g., all section titles = text-xl, subsection = text-lg)
   - Recommendation: Standardize to h2=text-xl for section titles, h3=text-base for subsections. Apply as part of heading audit task.

2. **Sidebar toggle persistence**
   - What we know: HEAD-04 requires toggle button. SIDE-06 (persist state) is deferred.
   - What's unclear: Should toggle state survive section changes (session-only state)?
   - Recommendation: Use React useState in DashboardShell. Resets on refresh. No persistence needed (SIDE-06 is v2).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.5 + @testing-library/react 16.3.2 |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements --> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SIDE-01 | Nav items render Lucide icons | unit | `npx vitest run src/__tests__/sidebar.test.tsx -t "icon"` | Wave 0 |
| SIDE-02 | Active item has indicator bar class | unit | `npx vitest run src/__tests__/sidebar.test.tsx -t "active"` | Wave 0 |
| SIDE-03 | Groups separated by Separator | unit | `npx vitest run src/__tests__/sidebar.test.tsx -t "separator"` | Wave 0 |
| HEAD-01 | Breadcrumb shows current section | unit | `npx vitest run src/__tests__/header.test.tsx -t "breadcrumb"` | Wave 0 |
| HEAD-02 | Connection status renders as Badge with dot | unit | `npx vitest run src/__tests__/header.test.tsx -t "connection"` | Wave 0 |
| HEAD-03 | Listener count visible in header | unit | `npx vitest run src/__tests__/header.test.tsx -t "listener"` | Wave 0 |
| HEAD-04 | Toggle button toggles sidebar visibility | unit | `npx vitest run src/__tests__/header.test.tsx -t "toggle"` | Wave 0 |
| TYPO-02 | Section headings have proper hierarchy | unit | `npx vitest run src/__tests__/sidebar.test.tsx -t "heading"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/sidebar.test.tsx` -- covers SIDE-01, SIDE-02, SIDE-03
- [ ] `src/__tests__/header.test.tsx` -- covers HEAD-01, HEAD-02, HEAD-03, HEAD-04, TYPO-02

## Project Constraints (from CLAUDE.md)

- DRY: Extract shared logic (nav group rendering, badge composition)
- SRP: Each component does one thing (Sidebar = nav, Header breadcrumb/badges = status display)
- Self-explanatory naming: `sidebarVisible` not `open`, `navGroups` not `groups`
- Tiger-Style: Fail fast -- assert valid section values, no silent fallbacks
- No spaghetti: Clean render flow, no nested ternaries in JSX
- Tests: Each function tested
- Windows + bash: PATH export for cargo (not relevant for this UI-only phase)
- Agent runs commands, never asks user

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | -- |
| V3 Session Management | no | -- |
| V4 Access Control | no | -- |
| V5 Input Validation | no | Nav state is internal enum, not user input |
| V6 Cryptography | no | -- |

This phase is purely UI cosmetic. No user input, no network calls, no auth. No security controls needed.

## Sources

### Primary (HIGH confidence)
- Context7 `/shadcn-ui/ui` -- Badge, Breadcrumb, Separator, Tooltip, Sidebar component docs
- Filesystem verification -- `package.json` (installed versions), `components.json` (shadcn config), existing component source code

### Secondary (MEDIUM confidence)
- shadcn GitHub `apps/v4/content/docs/components/` -- component API docs (via Context7)

### Tertiary (LOW confidence)
- None. All claims verified via code or Context7.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libs already installed, versions confirmed from package.json
- Architecture: HIGH -- existing code examined, small additive changes
- Pitfalls: HIGH -- based on verified API patterns (TooltipProvider, BreadcrumbLink behavior)

**Research date:** 2026-05-05
**Valid until:** 2026-06-05 (stable UI components, no breaking changes expected)
