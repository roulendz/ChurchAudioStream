# Feature Landscape: Admin Panel UI Polish (shadcn/ui)

**Domain:** Admin dashboard UI upgrade (shadcn/ui integration for existing Tauri desktop app)
**Researched:** 2026-05-05
**Confidence:** HIGH (Context7 verified + official shadcn docs)

## Table Stakes

Features users expect from polished admin dashboards. Missing = product feels amateur.

| Feature | Why Expected | Complexity | shadcn Components | Notes |
|---------|--------------|------------|-------------------|-------|
| Sidebar with icons | Visual scanning speed; every modern admin has icons next to labels | Low | `Sidebar`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton` + `lucide-react` icons | Already have 4 nav items, just add icon prop per item |
| Collapsible sidebar (icon mode) | Screen real estate on smaller displays; standard UX pattern | Medium | `SidebarProvider`, `Sidebar collapsible="icon"`, `SidebarTrigger`, `useSidebar` hook | Provider manages expanded/collapsed state; icon mode shows only icons when collapsed |
| Status badges (colored, semantic) | Instant channel state recognition without reading text | Low | `Badge variant="default|secondary|destructive|outline"` | Replace plain text status spans with semantic colored badges |
| Card-based channel layout | Visual grouping of channel info + actions; consistent spacing | Low | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter` | Wrap existing channel-card DOM structure |
| Tooltips on icon-only buttons | Discoverability when sidebar collapsed or action buttons are icon-only | Low | `Tooltip`, `TooltipTrigger`, `TooltipContent` | Wrap reorder/remove/configure buttons |
| Scroll area for long channel lists | Graceful overflow; custom scrollbar matches design | Low | `ScrollArea`, `ScrollBar` | Wrap channel card `<ul>` element |
| Visual separators between sections | Hierarchy in sidebar, between card groups | Low | `Separator` (horizontal/vertical) | Between nav groups or sidebar footer |
| Consistent icon system | No more HTML entities (&#9650;) or raw SVG inlines | Low | `lucide-react` icons throughout | Replace all ad-hoc icon approaches |

## Differentiators

Features that elevate UX beyond basic. Not expected in MVP polish but high value.

| Feature | Value Proposition | Complexity | shadcn Components | Notes |
|---------|-------------------|------------|-------------------|-------|
| Drag-to-reorder channels | Natural reordering; replaces clunky up/down arrow buttons | Medium | `@diceui/sortable` (shadcn-compatible, dnd-kit under hood): `Sortable`, `SortableItem`, `SortableContent`, `SortableItemHandle` | OR raw `@dnd-kit/core` + `@dnd-kit/sortable` with custom styling |
| Breadcrumb navigation in header | Orientation when drilling into channel config or settings sub-pages | Low | `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator` | Useful for: Overview > Channel > Config depth |
| Collapsible config panels (per-channel) | Inline expand/collapse avoids full navigation away from channel list | Medium | `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` | Alternative to separate config page |
| Sheet (slide-in panel) for config | Slide-in from right for channel settings; keeps channel list visible | Medium | `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetFooter` | Better spatial context than full-page nav |
| Dark mode toggle | Eye comfort for AV booth operators in dark environments | Low | `Button` + `DropdownMenu` + CSS theme variables | shadcn has official Vite dark-mode guide with theme provider |
| Sidebar badges (live counts) | Listener count visible without navigating to monitoring | Low | `SidebarMenuBadge` | Shows "24" next to Channels nav item |
| Animated connection indicator | Pulsing dot for "connecting", solid for "connected", red for error | Low | `Badge` with custom Tailwind animation class | `animate-pulse` on connecting state |

## Anti-Features

Features to explicitly NOT build during this polish milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Full routing (react-router) | Desktop app with no URL bar; adds bundle + complexity for zero user benefit | Keep state-driven section switching (`currentSection` state) |
| shadcn Table for channels | Channels are rich cards with live VU meters, not tabular data | Use Card composition with embedded Canvas VU |
| Radix Themes (full design system) | Over-engineering for 4-section admin app | Use shadcn primitives + Tailwind utility classes directly |
| Mobile-responsive sidebar (offcanvas) | Desktop-only Tauri app; no mobile breakpoint needed | Use `collapsible="icon"` for compact mode (not offcanvas) |
| Form library (react-hook-form) | Settings are few simple fields; existing controlled inputs are fine | Keep direct useState for settings |
| framer-motion animations | CSS transitions + dnd-kit built-in animations sufficient for this scope | Tailwind `transition-*` utilities + dnd-kit `transform` |
| Component library beyond shadcn | No need for Chakra/Mantine/etc alongside shadcn | Single system: shadcn + Tailwind |
| Storybook | 4-section app with <20 components; visual testing not justified | Test with Vitest + Testing Library (already set up) |

## Feature Dependencies

```
Tailwind CSS v4 + @tailwindcss/vite + shadcn init
    --> ALL shadcn components require this foundation
    --> Creates: components.json, lib/utils.ts (cn function), CSS variables

lucide-react
    --> Sidebar icons (LayoutDashboard, Radio, Activity, Settings)
    --> Button icons (Play, Square, GripVertical, X, ChevronDown)
    --> Header icons (PanelLeft for SidebarTrigger)
    --> data-icon="inline-start|inline-end" attribute pattern

SidebarProvider (context wrapper)
    --> Sidebar component (collapsible="icon")
    --> SidebarTrigger (toggle button in header)
    --> useSidebar hook (state: expanded|collapsed, toggleSidebar)
    --> SidebarInset (main content wrapper)

Card + Badge + Tooltip
    --> Channel cards visual upgrade
    --> Status badges (streaming=default, stopped=secondary, error=destructive)
    --> Icon button accessibility

ScrollArea
    --> Channel list overflow handling
    --> Requires Card components already in place

Breadcrumb
    --> Header redesign
    --> Requires SidebarTrigger already placed

@diceui/sortable (or @dnd-kit/sortable)
    --> Drag-to-reorder channels
    --> Requires Card components (items to drag)
    --> Replaces move-up/move-down buttons
    --> Consumes existing onReorderChannels callback
```

## Implementation Order (dependency-driven)

### Phase 1: Foundation (MUST come first, blocks everything)
- Install `tailwindcss` + `@tailwindcss/vite`
- Run `npx shadcn@latest init` (generates config, utils, CSS vars)
- Install `lucide-react`
- Configure `@` path alias in `tsconfig.json` + `tsconfig.app.json` + `vite.config.ts`
- Migrate existing CSS to coexist with Tailwind (add `@import "tailwindcss"` to index.css)

### Phase 2: Sidebar Refactor (biggest visual impact)
- `npx shadcn@latest add sidebar`
- Refactor `DashboardShell` to `SidebarProvider` > `Sidebar` + `SidebarInset`
- Replace `<nav>` + `<button>` items with `SidebarMenu` > `SidebarMenuItem` > `SidebarMenuButton`
- Add lucide icons: `LayoutDashboard`, `Radio`, `Activity`, `Settings`
- Set `collapsible="icon"` prop
- Add `SidebarTrigger` in header area

### Phase 3: Cards + Badges + Polish
- `npx shadcn@latest add card badge tooltip scroll-area separator`
- Refactor `ChannelList` items: each `<li>` becomes `<Card>` composition
- Status badges: `streaming` -> `Badge variant="default"`, `stopped` -> `Badge variant="secondary"`, `error` -> `Badge variant="destructive"`
- Replace HTML entity arrows with lucide `ChevronUp`/`ChevronDown` or `GripVertical`
- Wrap action buttons in `Tooltip` for accessibility
- Wrap channel list in `ScrollArea`

### Phase 4: Header Redesign
- `npx shadcn@latest add breadcrumb`
- Header layout: `SidebarTrigger` | `Breadcrumb` | spacer | `ConnectionStatus Badge`
- Connection status as Badge with dot indicator (custom `before:` pseudo-element)
- Breadcrumb shows: Dashboard > [Current Section] > [Sub-page if any]

### Phase 5: Drag Reorder (optional, highest complexity)
- `pnpm dlx shadcn@latest add @diceui/sortable` OR `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
- Wrap channel card list in `<Sortable value={channelIds} onValueChange={handleReorder}>`
- Each Card becomes `<SortableItem value={channel.id}>`
- Add `<SortableItemHandle>` with `GripVertical` icon
- Remove old up/down arrow buttons
- Connect `onValueChange` to existing `onReorderChannels(newIds)` callback

## MVP Recommendation

**Prioritize (Phases 1-3) -- delivers 80% of visual polish:**
1. Tailwind + shadcn foundation (unlocks everything else)
2. Sidebar with icons + collapsible (single biggest visual upgrade, low effort once foundation exists)
3. Card-based channels + Badge status (polished, consistent feel)

**Defer to later:**
- Drag-to-reorder: Functional equivalent exists (arrow buttons work). Ship polish first, add delight later.
- Breadcrumbs: Only valuable once deeper nested navigation exists beyond current 4 flat sections.
- Sheet panels: Current ChannelConfigPanel works fine inline.
- Dark mode: Nice-to-have for AV booth, not blocking shipping.

## Specific Install Commands

```bash
# Phase 1 - Foundation
npm install tailwindcss @tailwindcss/vite lucide-react
npx shadcn@latest init

# Phase 2 - Sidebar
npx shadcn@latest add sidebar

# Phase 3 - Cards + Polish
npx shadcn@latest add card badge tooltip scroll-area separator

# Phase 4 - Header
npx shadcn@latest add breadcrumb

# Phase 5 - Drag Reorder (pick ONE)
# Option A: Dice UI (shadcn-native, simpler API)
pnpm dlx shadcn@latest add @diceui/sortable
# Option B: Raw dnd-kit (more control, more boilerplate)
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

## Complexity & Effort Ratings

| Feature | Effort | Risk | Confidence |
|---------|--------|------|------------|
| Tailwind + shadcn init | 0.5 day | Low (well-documented Vite guide) | HIGH |
| Sidebar refactor | 1 day | Low (shadcn Sidebar is drop-in) | HIGH |
| Card refactor | 1 day | Low (wrapping existing DOM) | HIGH |
| Badge status colors | 0.25 day | None (trivial prop change) | HIGH |
| Tooltip on buttons | 0.25 day | None | HIGH |
| ScrollArea | 0.25 day | None | HIGH |
| Breadcrumb header | 0.5 day | Low | HIGH |
| Collapsible sidebar | 0.25 day | None (single prop on Sidebar) | HIGH |
| Drag-to-reorder | 1.5 days | Medium (state sync, testing) | MEDIUM |
| Dark mode | 0.5 day | Low (official guide) | HIGH |

**Total estimated: ~4 days for Phases 1-4, ~5.5 days including drag reorder**

## Key Component Mapping (Current -> shadcn)

| Current Code | shadcn Replacement | Key Props/Notes |
|---|---|---|
| `<div className="dashboard-shell">` | `<SidebarProvider>` wrapper | `defaultOpen={true}` |
| `<nav className="dashboard-sidebar">` | `<Sidebar side="left" collapsible="icon">` | Handles collapse animation |
| `<button className="sidebar-nav-item">` | `<SidebarMenuButton isActive={...}>` | Auto-styles active state |
| Plain text "Overview" | `<LayoutDashboard /><span>Overview</span>` | Icon auto-hides label in collapsed |
| `<div className="channel-card">` | `<Card>` with sub-components | Consistent padding/border |
| `<span className="channel-status-badge">` | `<Badge variant="...">` | Semantic color variants |
| `&#9650;` / `&#9660;` arrows | `<ChevronUp />` / `<ChevronDown />` from lucide | OR `<GripVertical />` for drag handle |
| `<h1>Church Audio Stream - Admin</h1>` | `<SidebarTrigger />` + `<Breadcrumb>` + title | Cleaner header composition |
| Connection status text | `<Badge variant="outline">` with dot | `animate-pulse` when connecting |

## shadcn Sidebar Component Hierarchy (reference)

```
SidebarProvider
  Sidebar (side, variant, collapsible)
    SidebarHeader
    SidebarContent
      SidebarGroup
        SidebarGroupLabel
        SidebarGroupContent
          SidebarMenu
            SidebarMenuItem
              SidebarMenuButton (isActive, asChild)
              SidebarMenuBadge (optional)
              SidebarMenuAction (optional)
    SidebarFooter
    SidebarRail (thin hover target for expand)
  SidebarInset
    main content area
```

## Drag-to-Reorder Technical Notes

### Option A: Dice UI Sortable (recommended for this project)
- Installed via shadcn registry: `pnpm dlx shadcn@latest add @diceui/sortable`
- Uses dnd-kit internally but provides shadcn-styled wrapper
- API: `<Sortable value={items} onValueChange={setItems}>`
- Keyboard accessible: Arrow keys to navigate, Enter/Space to pick up
- Built-in data attributes for styling: `[data-dragging]`, `[data-disabled]`

### Option B: Raw dnd-kit
- More boilerplate but full control
- Requires: `DndContext`, `SortableContext`, `useSortable` hook, `closestCenter` collision
- Use `verticalListSortingStrategy` for channel list
- `arrayMove()` utility for state update
- Must manually wire `onDragEnd` handler

### Integration with existing code:
```typescript
// Current: onReorderChannels(channelIds: string[])
// With Dice UI:
<Sortable
  value={channels.map(ch => ch.id)}
  onValueChange={(newIds) => onReorderChannels(newIds)}
>
  <SortableContent>
    {channels.map(channel => (
      <SortableItem key={channel.id} value={channel.id}>
        <Card>...</Card>
      </SortableItem>
    ))}
  </SortableContent>
</Sortable>
```

## Sources

- **Context7 (HIGH confidence):** shadcn-ui/ui official docs -- Sidebar, Card, Badge, Breadcrumb, Tooltip, ScrollArea, Sheet, Progress, Separator, ToggleGroup, Button icons, useSidebar hook, SidebarProvider
- [shadcn/ui Sidebar blocks](https://ui.shadcn.com/blocks/sidebar) -- Pre-built sidebar examples
- [shadcn/ui Vite installation](https://ui.shadcn.com/docs/installation/vite) -- Official Vite setup
- [shadcn/ui Tailwind v4 migration](https://ui.shadcn.com/docs/tailwind-v4) -- Tailwind CSS v4 guide
- [Dice UI Sortable](https://www.diceui.com/docs/components/radix/sortable) -- shadcn-compatible drag-and-drop
- [sadmann7/sortable](https://github.com/sadmann7/sortable) -- Community shadcn sortable
- [dnd-kit sortable docs](https://docs.dndkit.com/presets/sortable) -- dnd-kit official preset
- [Lucide icons](https://lucide.dev/icons/) -- Icon library used by shadcn/ui
- [freecodecamp shadcn sidebar guide](https://www.freecodecamp.org/news/build-an-admin-dashboard-sidebar-with-shadcn-ui-and-base-ui/) -- Community tutorial
