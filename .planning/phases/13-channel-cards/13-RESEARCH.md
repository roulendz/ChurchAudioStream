# Phase 13: Channel Cards - Research

**Researched:** 2026-05-05
**Domain:** React UI components (shadcn/ui Card, Badge, Tooltip, ScrollArea), real-time canvas VU meters
**Confidence:** HIGH

## Summary

Phase 13 converts ChannelList from flat `<li>` items to shadcn Card components, adds status Badges, wraps action buttons in Tooltips (already installed + provider mounted), embeds inline VU meter previews per card, and wraps overflow in ScrollArea. All five requirements (CARD-01, CARD-02, CARD-03, CARD-05, TYPO-03) are purely frontend admin UI changes.

Existing ChannelList at `src/components/channels/ChannelList.tsx` already has: status badge logic (hand-rolled spans), reorder buttons (up/down arrows — kept for now, Phase 14 replaces with drag), start/stop/configure/remove buttons, and proper props interface. Conversion is structural — replace `<li>` with Card, replace hand-rolled badge spans with shadcn Badge, wrap buttons in Tooltip, add VuMeter per card, wrap list in ScrollArea.

**Primary recommendation:** Install shadcn Card and ScrollArea via CLI. Refactor ChannelList to use Card layout. Extract ChannelCard as separate component (SRP). Reuse existing VuMeter component with smaller dimensions for inline preview.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CARD-01 | Each channel rendered as shadcn Card with consistent padding and elevation | Card component with CardHeader/CardContent; `size="sm"` or default with consistent padding |
| CARD-02 | Channel status shown as colored Badge (streaming=green, stopped=muted, error=red) | Existing Badge component already installed; use variant + className for color overrides |
| CARD-03 | Action buttons wrapped in Tooltips for accessibility | Tooltip already installed, TooltipProvider already wrapping App root |
| CARD-05 | Each channel card shows inline VU meter preview | Existing VuMeter component; render at smaller dimensions (e.g., width=24, height=60) |
| TYPO-03 | Channel list overflow handled by ScrollArea component | ScrollArea installed via CLI; wrap channel list with fixed height |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Card layout rendering | Frontend (React) | -- | Pure presentational component swap |
| Status badge coloring | Frontend (React) | -- | Maps `channel.status` string to Badge variant/color classes |
| Tooltip accessibility | Frontend (React) | -- | Radix Tooltip already mounted via TooltipProvider |
| Inline VU meter | Frontend (React canvas) | Sidecar (level data) | Canvas renders locally; level data arrives via WS `levels:update` |
| Scroll overflow | Frontend (React) | -- | ScrollArea wraps list container |

## Standard Stack

### Core (already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| shadcn/ui | 4.7.0 (CLI) | Card, ScrollArea component installation | [VERIFIED: npm registry] Project standard from Phase 11 |
| radix-ui | 1.4.3 | Primitives (ScrollArea.Root/Viewport/Scrollbar) | [VERIFIED: package.json] Unified package already installed |
| lucide-react | ^1.14.0 | Icons for action buttons (Play, Square, Settings, Trash2, etc.) | [VERIFIED: package.json] Project standard from Phase 12 |
| class-variance-authority | ^0.7.1 | Badge/Button variants | [VERIFIED: package.json] Already used by Badge, Button |

### New Components to Install

| Component | Install Command | What It Provides |
|-----------|----------------|------------------|
| Card | `npx shadcn@latest add card` | Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter |
| ScrollArea | `npx shadcn@latest add scroll-area` | ScrollArea, ScrollBar |

### Already Installed (no action needed)

| Component | File | Status |
|-----------|------|--------|
| Badge | `src/components/ui/badge.tsx` | [VERIFIED: file exists] Used by ConnectionStatus, ListenerCountBadge |
| Tooltip | `src/components/ui/tooltip.tsx` | [VERIFIED: file exists] TooltipProvider wrapping App root in App.tsx |
| Button | `src/components/ui/button.tsx` | [VERIFIED: file exists] Has `icon`, `icon-xs`, `icon-sm` size variants |

**Installation:**
```bash
npx shadcn@latest add card scroll-area
```

## Architecture Patterns

### System Architecture Diagram

```
App.tsx
  |
  +-- useChannels() -----> channels: AdminChannel[]
  +-- useAudioLevels() --> getLevels(channelId): ChannelLevelData | null
  +-- useListenerCounts() -> getChannelListenerCount(channelId): number
  |
  +-- [currentSection === "channels"]
       |
       +-- ChannelList
            |
            +-- ScrollArea (TYPO-03)
            |    |
            |    +-- ChannelCard[] (CARD-01)
            |         |
            |         +-- CardHeader
            |         |    +-- CardTitle: channel.name
            |         |    +-- CardAction: Badge status (CARD-02)
            |         |
            |         +-- CardContent
            |              +-- Metadata (format, source count, visibility)
            |              +-- Inline VuMeter (CARD-05, small canvas)
            |              +-- Action buttons with Tooltips (CARD-03)
            |                   +-- Start/Stop, Configure, Remove, MoveUp/MoveDown
```

### Recommended Project Structure

```
src/
├── components/
│   ├── channels/
│   │   ├── ChannelList.tsx        # Refactored: ScrollArea wrapper + maps ChannelCard
│   │   ├── ChannelCard.tsx        # NEW: Single card component (extracted from ChannelList)
│   │   ├── ChannelStatusBadge.tsx # NEW: Status Badge with color mapping
│   │   ├── ChannelConfigPanel.tsx # Unchanged
│   │   └── ChannelCreateDialog.tsx # Unchanged
│   ├── monitoring/
│   │   ├── VuMeter.tsx            # Unchanged (accepts width/height props already)
│   │   └── VuMeterBank.tsx        # Unchanged
│   └── ui/
│       ├── card.tsx               # NEW: installed via shadcn CLI
│       ├── scroll-area.tsx        # NEW: installed via shadcn CLI
│       ├── badge.tsx              # Existing
│       ├── tooltip.tsx            # Existing
│       └── button.tsx             # Existing
```

### Pattern 1: ChannelCard Composition

**What:** Each channel rendered as shadcn Card with header (name + status badge) and content (metadata + VU + actions).
**When to use:** Every channel in the list.
**Example:**
```tsx
// Source: shadcn Card composition + existing ChannelList patterns
import { Card, CardHeader, CardTitle, CardAction, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Play, Square, Settings, Trash2 } from "lucide-react";
import { VuMeter } from "@/components/monitoring/VuMeter";

function ChannelCard({ channel, getLevels, onStart, onStop, onConfigure, onRemove }: ChannelCardProps) {
  const isRunning = channel.status === "streaming" || channel.status === "starting";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{channel.name}</CardTitle>
        <CardAction>
          <ChannelStatusBadge status={channel.status} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Inline VU meter preview */}
            <VuMeter
              channelName={channel.name}
              getLevels={getChannelLevels}
              width={24}
              height={56}
            />
            {/* Metadata */}
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              <span>{channel.outputFormat}</span>
              <span>{channel.sources.length} source{channel.sources.length !== 1 ? "s" : ""}</span>
            </div>
          </div>
          {/* Action buttons with tooltips */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" onClick={() => isRunning ? onStop(channel.id) : onStart(channel.id)}>
                  {isRunning ? <Square className="size-3" /> : <Play className="size-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isRunning ? "Stop streaming" : "Start streaming"}</TooltipContent>
            </Tooltip>
            {/* ... more action buttons */}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

### Pattern 2: Status Badge Color Mapping

**What:** Map ChannelStatus to Badge variant + custom colors.
**When to use:** Every channel card.
**Example:**
```tsx
// Source: existing ConnectionStatus.tsx pattern + Badge component
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ChannelStatus } from "@/hooks/useChannels";

const STATUS_CONFIG: Record<ChannelStatus, { label: string; className: string }> = {
  streaming: { label: "Streaming", className: "bg-success/20 text-success border-success/30" },
  starting:  { label: "Starting",  className: "bg-warning/20 text-warning border-warning/30" },
  stopped:   { label: "Stopped",   className: "bg-muted text-muted-foreground border-border" },
  error:     { label: "Error",     className: "bg-destructive/20 text-destructive border-destructive/30" },
  crashed:   { label: "Crashed",   className: "bg-destructive/20 text-destructive border-destructive/30" },
};

export function ChannelStatusBadge({ status }: { status: ChannelStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <Badge variant="outline" className={cn("text-[0.65rem] uppercase tracking-wide", config.className)}>
      {config.label}
    </Badge>
  );
}
```

### Pattern 3: ScrollArea Wrapper

**What:** Wrap channel list in ScrollArea for overflow handling.
**When to use:** Channel list container.
**Example:**
```tsx
// Source: shadcn ScrollArea docs
import { ScrollArea } from "@/components/ui/scroll-area";

<ScrollArea className="h-[calc(100vh-12rem)]">
  <div className="flex flex-col gap-3 pr-4">
    {channels.map((channel) => (
      <ChannelCard key={channel.id} channel={channel} ... />
    ))}
  </div>
</ScrollArea>
```

### Pattern 4: Inline VU Meter Preview

**What:** Reuse existing VuMeter at smaller dimensions inside card.
**When to use:** Each ChannelCard, always rendered (shows empty track when not streaming).
**Example:**
```tsx
// Source: existing VuMeter.tsx — already accepts width/height props
const getChannelLevels = useCallback(
  () => getLevels(channel.id),
  [getLevels, channel.id],
);

<VuMeter
  channelName={channel.name}
  getLevels={getChannelLevels}
  width={24}
  height={56}
/>
```

### Pattern 5: Tooltip-Wrapped Action Buttons

**What:** Every action button gets Tooltip describing its purpose.
**When to use:** Start/Stop, Configure, Remove, Move Up/Down buttons.
**Example:**
```tsx
// Source: existing Tooltip component + Button component
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="ghost" size="icon-xs" onClick={handler}>
      <Settings className="size-3" />
    </Button>
  </TooltipTrigger>
  <TooltipContent>Configure channel</TooltipContent>
</Tooltip>
```

### Anti-Patterns to Avoid

- **Inline styles for card layout:** Use Card sub-components (CardHeader, CardContent) not raw divs with padding
- **Custom scroll implementation:** ScrollArea handles cross-browser custom scrollbar; never use `overflow-y: auto` directly on channel list
- **Re-implementing VuMeter:** VuMeter already accepts `width`/`height` props — pass smaller values, don't create separate "mini VU meter"
- **useState for VU levels in card:** VuMeter reads from ref via `getLevels` callback + rAF — zero React re-renders. Don't convert to useState
- **Hardcoded colors:** Use design token classes (`text-success`, `bg-destructive/20`) not hex values

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Card container with elevation | Custom div with box-shadow | shadcn Card | Consistent radius, padding, border, dark theme tokens |
| Status indicator badges | `<span>` with inline classes | shadcn Badge (outline variant + color classes) | Consistent sizing, focus states, accessibility |
| Tooltip on hover | title attribute or custom popup | shadcn Tooltip (Radix primitive) | Keyboard accessible, proper timing, portal rendering |
| Custom scrollbar | overflow-y: auto + ::-webkit-scrollbar | shadcn ScrollArea (Radix primitive) | Cross-browser consistent, styled scrollbar thumb |
| VU meter mini version | Separate mini canvas component | Existing VuMeter with smaller width/height | Same rendering logic, same rAF loop, same decay curves |

**Key insight:** Every UI primitive needed already exists in shadcn or in project code. Phase 13 is pure composition — no new rendering logic required.

## Common Pitfalls

### Pitfall 1: VuMeter rAF Running on Hidden/Stopped Channels
**What goes wrong:** Every ChannelCard renders VuMeter. Each starts rAF loop. 10 channels = 10 independent rAF callbacks at 60fps.
**Why it happens:** VuMeter always runs rAF in its useEffect regardless of whether channel is streaming.
**How to avoid:** VuMeter already handles this gracefully — when `getLevels()` returns null, it draws empty track. rAF cost per meter is negligible (simple canvas fills). For 10+ channels, consider conditionally rendering VuMeter only for streaming/starting channels.
**Warning signs:** Browser devtools showing many rAF callbacks.

### Pitfall 2: ScrollArea Needs Explicit Height
**What goes wrong:** ScrollArea renders but doesn't scroll — content overflows behind footer/other sections.
**Why it happens:** ScrollArea requires parent/self to have bounded height. Without explicit height, it expands to content height.
**How to avoid:** Set `className="h-[calc(100vh-Xrem)]"` where X accounts for header + section heading + spacing. Or use `flex-1 overflow-hidden` parent pattern.
**Warning signs:** Content overflows past visible area without scrollbar appearing.

### Pitfall 3: Tooltip Not Showing on Disabled Buttons
**What goes wrong:** Radix Tooltip doesn't fire on disabled elements (no pointer events).
**Why it happens:** HTML `disabled` attribute prevents mouse events including hover.
**How to avoid:** Use `aria-disabled` instead of `disabled` on TooltipTrigger, or wrap disabled button in a span as trigger.
**Warning signs:** Tooltip never appears on grayed-out buttons.

### Pitfall 4: Move Up/Down Buttons Still Present
**What goes wrong:** Phase 14 replaces these with drag-to-reorder. If Phase 13 removes them, channels can't be reordered until Phase 14.
**Why it happens:** Scope confusion between Phase 13 and 14.
**How to avoid:** Keep Move Up/Down buttons in Phase 13 cards. Phase 14 will replace them with drag handles.
**Warning signs:** Reorder functionality breaks between Phase 13 and 14 delivery.

### Pitfall 5: Card Size Variant Confusion
**What goes wrong:** Card `size="sm"` reduces internal padding. Wrong size for channel cards that have VU meters + multiple action buttons.
**Why it happens:** Assuming "sm" is appropriate for compact cards.
**How to avoid:** Use default size. Channel cards have enough content density to warrant default padding.
**Warning signs:** Content feels cramped, buttons too close together.

### Pitfall 6: Breaking ChannelList Props Interface
**What goes wrong:** Refactoring ChannelList changes its props, breaking App.tsx integration.
**Why it happens:** Extracting ChannelCard requires passing audioLevels data that ChannelList doesn't currently receive.
**How to avoid:** ChannelList props must be extended (add `audioLevels: UseAudioLevelsReturn` or `getLevels` callback). Update App.tsx to pass it.
**Warning signs:** TypeScript compile errors in App.tsx after ChannelList refactor.

## Code Examples

### ChannelList Props Extension (verified from existing code)

```tsx
// Source: existing ChannelList.tsx + useAudioLevels.ts
// Current props (from ChannelList.tsx line 3-11):
interface ChannelListProps {
  channels: AdminChannel[];
  onStartChannel: (channelId: string) => void;
  onStopChannel: (channelId: string) => void;
  onRemoveChannel: (channelId: string) => void;
  onConfigureChannel: (channelId: string) => void;
  onReorderChannels: (channelIds: string[]) => void;
  onCreateClick: () => void;
  // NEW: needed for inline VU meters
  getLevels: (channelId: string) => ChannelLevelData | null;
}
```

### App.tsx Integration Point (verified from App.tsx line 117-125)

```tsx
// Current usage in App.tsx:
<ChannelList
  channels={channels}
  onStartChannel={startChannel}
  onStopChannel={stopChannel}
  onRemoveChannel={removeChannel}
  onConfigureChannel={setSelectedChannelId}
  onReorderChannels={reorderChannels}
  onCreateClick={() => setShowCreateDialog(true)}
  // NEW: pass audio levels for inline VU previews
  getLevels={audioLevels.getLevels}
/>
```

### Available Design Tokens (verified from index.css)

```css
/* Status colors available as Tailwind classes: */
/* --success: oklch(0.673 0.162 144.2)  → text-success, bg-success */
/* --warning: oklch(0.770 0.174 64.0)   → text-warning, bg-warning */
/* --destructive: oklch(0.643 0.215 28.8) → text-destructive, bg-destructive */
/* --muted: oklch(0.292 0.061 267.1)    → bg-muted */
/* --muted-foreground: oklch(0.535 0.033 285.2) → text-muted-foreground */
```

### Existing Button Size Variants (verified from button.tsx)

```tsx
// Available size variants for action buttons:
// "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3"  -- perfect for card actions
// "icon-sm": "size-8"
// "icon":    "size-9"
// "xs":      "h-6 gap-1 rounded-md px-2 text-xs"
// "sm":      "h-8 gap-1.5 rounded-md px-3"
```

### Lucide Icons for Channel Actions

```tsx
// Source: lucide-react [ASSUMED — icon names from training data]
import {
  Play,        // Start streaming
  Square,      // Stop streaming
  Settings,    // Configure channel
  Trash2,      // Remove channel
  ChevronUp,   // Move up (Phase 13 keeps these)
  ChevronDown, // Move down (Phase 13 keeps these)
  EyeOff,      // Hidden from listeners indicator
} from "lucide-react";
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled `<li>` list items | shadcn Card composition | Phase 13 (now) | Consistent elevation, padding, border radius |
| `<span>` with inline badge classes | shadcn Badge with variant + token colors | Phase 13 (now) | Focus states, consistent sizing, semantic markup |
| `title` attribute on buttons | Radix Tooltip (keyboard accessible, portaled) | Phase 13 (now) | Screen reader support, configurable delay, animation |
| Native `overflow-y: auto` | Radix ScrollArea (custom scrollbar) | Phase 13 (now) | Cross-browser consistent scrollbar styling |
| VU meters only in Monitoring tab | Inline VU preview per card | Phase 13 (now) | At-a-glance audio status without switching tabs |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Lucide icon names: Play, Square, Settings, Trash2, ChevronUp, ChevronDown, EyeOff exist | Code Examples | LOW — can verify at import time; Lucide has extensive icon set |
| A2 | Card component has `size` prop with "default" and "sm" values | Standard Stack | LOW — Context7 docs confirmed, but exact implementation depends on shadcn version installed |
| A3 | CardAction sub-component available in latest shadcn Card | Architecture Patterns | LOW — Context7 confirmed; if missing, use div inside CardHeader instead |

## Open Questions

1. **VU Meter Dimensions for Card Inline Preview**
   - What we know: VuMeter accepts width/height props. Currently defaults to 40x160.
   - What's unclear: Exact pixel dimensions that look good in card context.
   - Recommendation: Start with 24x56 (compact vertical bar). Adjust during visual review.

2. **ScrollArea Height Calculation**
   - What we know: Header is ~49px (from Sidebar sticky offset). Main area has p-6 (24px padding).
   - What's unclear: Exact `calc()` value for ScrollArea height to fill available space.
   - Recommendation: Use `h-[calc(100vh-12rem)]` as starting point. Adjust in visual review. Alternative: flex-based layout where ScrollArea takes `flex-1 min-h-0`.

3. **Should VuMeter Render for Stopped Channels?**
   - What we know: VuMeter draws empty track when `getLevels()` returns null. Minimal rAF cost.
   - What's unclear: Whether empty VU bars add visual clutter to stopped channel cards.
   - Recommendation: Render for all channels — provides consistent card layout width. Shows activity instantly when channel starts without layout shift.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 + @testing-library/react 16.3.2 |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CARD-01 | Each channel renders inside Card component (data-slot="card") | unit | `npx vitest run src/__tests__/channel-cards.test.tsx -t "CARD-01"` | Wave 0 |
| CARD-02 | Status badge uses correct color class per status | unit | `npx vitest run src/__tests__/channel-cards.test.tsx -t "CARD-02"` | Wave 0 |
| CARD-03 | Action buttons wrapped in Tooltip (tooltip-trigger present) | unit | `npx vitest run src/__tests__/channel-cards.test.tsx -t "CARD-03"` | Wave 0 |
| CARD-05 | Each card contains canvas element (VuMeter) | unit | `npx vitest run src/__tests__/channel-cards.test.tsx -t "CARD-05"` | Wave 0 |
| TYPO-03 | Channel list wrapper uses ScrollArea (data-radix-scroll-area-viewport present) | unit | `npx vitest run src/__tests__/channel-cards.test.tsx -t "TYPO-03"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/channel-cards.test.tsx` — covers CARD-01, CARD-02, CARD-03, CARD-05, TYPO-03

## Security Domain

No security-relevant changes. Phase 13 is purely presentational UI refactoring of existing components. No new data flows, no user input handling changes, no auth/access control changes.

## Sources

### Primary (HIGH confidence)
- Context7 `/shadcn-ui/ui` — Card component composition, ScrollArea usage [VERIFIED]
- shadcn official docs (ui.shadcn.com) — Card props (size variant), ScrollArea container pattern [VERIFIED: WebFetch]
- Project source files — ChannelList.tsx, VuMeter.tsx, Badge.tsx, Tooltip.tsx, Button.tsx, App.tsx, useChannels.ts, useAudioLevels.ts, index.css [VERIFIED: file read]
- npm registry — shadcn@4.7.0 current version [VERIFIED: npm view]

### Secondary (MEDIUM confidence)
- radix-ui unified package v1.4.3 includes ScrollArea primitives [VERIFIED: package.json]

### Tertiary (LOW confidence)
- Lucide icon names (Play, Square, Settings, Trash2, ChevronUp, ChevronDown, EyeOff) [ASSUMED: training data]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in project, only Card + ScrollArea to install via CLI
- Architecture: HIGH — existing component patterns (ConnectionStatus Badge, VuMeter, Tooltip) directly transferable
- Pitfalls: HIGH — all based on verified code analysis of existing components

**Research date:** 2026-05-05
**Valid until:** 2026-06-05 (stable — shadcn/ui + Tailwind v4 mature)
