# Phase 13: Channel Cards - Pattern Map

**Mapped:** 2026-05-05
**Files analyzed:** 7 (3 new, 3 modified, 1 new test)
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/components/channels/ChannelCard.tsx` | component | request-response | `src/components/channels/ChannelList.tsx` (lines 76-168) | exact |
| `src/components/channels/ChannelStatusBadge.tsx` | component | transform | `src/components/ConnectionStatus.tsx` | exact |
| `src/components/channels/ChannelList.tsx` | component | request-response | `src/components/monitoring/VuMeterBank.tsx` | role-match |
| `src/components/ui/card.tsx` | config | — | `src/components/ui/badge.tsx` | role-match |
| `src/components/ui/scroll-area.tsx` | config | — | `src/components/ui/tooltip.tsx` | role-match |
| `src/App.tsx` | controller | request-response | self (lines 117-125) | exact |
| `src/__tests__/channel-cards.test.tsx` | test | — | `src/__tests__/sidebar.test.tsx` | exact |

## Pattern Assignments

### `src/components/channels/ChannelCard.tsx` (NEW — component, request-response)

**Analog:** `src/components/channels/ChannelList.tsx` — single `<li>` item block (lines 76-168) is extracted into standalone card.

**Imports pattern** — combine ChannelList imports with shadcn + Lucide additions:
```tsx
// Source: ChannelList.tsx line 1-2, ConnectionStatus.tsx line 1-3, ListenerCountBadge.tsx line 1
import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardAction, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Play, Square, Settings, Trash2, ChevronUp, ChevronDown, EyeOff } from "lucide-react";
import { ChannelStatusBadge } from "./ChannelStatusBadge";
import { VuMeter } from "@/components/monitoring/VuMeter";
import type { AdminChannel, ChannelStatus } from "@/hooks/useChannels";
import type { ChannelLevelData } from "@/hooks/useAudioLevels";
```

**Props interface pattern** — derived from ChannelList.tsx lines 3-12, extract per-card callbacks:
```tsx
// Source: ChannelList.tsx lines 3-12 (decomposed per-card)
interface ChannelCardProps {
  channel: AdminChannel;
  index: number;
  totalChannels: number;
  getLevels: (channelId: string) => ChannelLevelData | null;
  onStart: (channelId: string) => void;
  onStop: (channelId: string) => void;
  onConfigure: (channelId: string) => void;
  onRemove: (channelId: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}
```

**Core rendering pattern** — from ChannelList.tsx lines 76-168 (current `<li>` layout → Card):
```tsx
// Source: ChannelList.tsx lines 52-54 (isRunning helper)
const isRunning = channel.status === "streaming" || channel.status === "starting";

// Source: ChannelList.tsx lines 80-106 (left side: name + badge + metadata)
// Becomes CardHeader + CardContent
<Card>
  <CardHeader>
    <CardTitle className="text-sm font-semibold">{channel.name}</CardTitle>
    <CardAction>
      <ChannelStatusBadge status={channel.status} />
    </CardAction>
  </CardHeader>
  <CardContent>
    {/* ... content ... */}
  </CardContent>
</Card>
```

**VuMeter integration pattern** — from VuMeterBank.tsx lines 54-74 (useCallback binding):
```tsx
// Source: VuMeterBank.tsx lines 63-66 (bind getLevels to specific channelId)
const getChannelLevels = useCallback(
  () => getLevels(channel.id),
  [getLevels, channel.id],
);

// Source: VuMeter.tsx line 59 (accepts width/height, use smaller for inline)
<VuMeter
  channelName={channel.name}
  getLevels={getChannelLevels}
  width={24}
  height={56}
/>
```

**Tooltip-wrapped button pattern** — from existing tooltip.tsx + button.tsx:
```tsx
// Source: tooltip.tsx lines 21-25 (Root), lines 27-30 (Trigger), lines 33-55 (Content)
// Source: button.tsx line 29 (icon-xs size: "size-6 rounded-md")
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="ghost" size="icon-xs" onClick={handler}>
      <Settings className="size-3" />
    </Button>
  </TooltipTrigger>
  <TooltipContent>Configure channel</TooltipContent>
</Tooltip>
```

**Hidden indicator pattern** — from ChannelList.tsx lines 91-98:
```tsx
// Source: ChannelList.tsx lines 91-98 (visibility indicator — convert title → Tooltip)
{!channel.visible && (
  <Tooltip>
    <TooltipTrigger asChild>
      <span><EyeOff className="size-3 text-muted-foreground" /></span>
    </TooltipTrigger>
    <TooltipContent>Hidden from listeners</TooltipContent>
  </Tooltip>
)}
```

**Reorder buttons pattern** — from ChannelList.tsx lines 109-127 (keep for Phase 13, Phase 14 replaces):
```tsx
// Source: ChannelList.tsx lines 110-127 (convert raw <button> to Button + Tooltip)
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="outline" size="icon-xs" disabled={index === 0} onClick={() => onMoveUp(index)}>
      <ChevronUp className="size-3" />
    </Button>
  </TooltipTrigger>
  <TooltipContent>Move up</TooltipContent>
</Tooltip>
```

---

### `src/components/channels/ChannelStatusBadge.tsx` (NEW — component, transform)

**Analog:** `src/components/ConnectionStatus.tsx`

**Imports pattern** (lines 1-3):
```tsx
// Source: ConnectionStatus.tsx lines 1-3
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { ChannelStatus } from "@/hooks/useChannels";
```

**Core status-map pattern** (ConnectionStatus.tsx lines 10-30):
```tsx
// Source: ConnectionStatus.tsx lines 10-30 (Record<StatusType, {label, className}> map)
// + ChannelList.tsx lines 15-27 (statusBadgeClass color values)
const STATUS_CONFIG: Record<ChannelStatus, { label: string; className: string }> = {
  streaming: { label: "Streaming", className: "bg-success/20 text-success border-success/30" },
  starting:  { label: "Starting",  className: "bg-warning/20 text-warning border-warning/30" },
  stopped:   { label: "Stopped",   className: "bg-muted text-muted-foreground border-border" },
  error:     { label: "Error",     className: "bg-destructive/20 text-destructive border-destructive/30" },
  crashed:   { label: "Crashed",   className: "bg-destructive/20 text-destructive border-destructive/30" },
};
```

**Badge rendering pattern** (ConnectionStatus.tsx lines 43-57):
```tsx
// Source: ConnectionStatus.tsx lines 43-57 (Badge with variant="outline" + dynamic className)
export function ChannelStatusBadge({ status }: { status: ChannelStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <Badge variant="outline" className={cn("text-[0.65rem] uppercase tracking-wide", config.className)}>
      {config.label}
    </Badge>
  );
}
```

---

### `src/components/channels/ChannelList.tsx` (MODIFIED — component, request-response)

**Analog:** `src/components/monitoring/VuMeterBank.tsx` (list wrapper that maps items)

**Extended props pattern** — add getLevels to existing interface (ChannelList.tsx lines 3-12):
```tsx
// Source: ChannelList.tsx lines 3-12 (existing) + useAudioLevels.ts line 48 (return type)
interface ChannelListProps {
  channels: AdminChannel[];
  onStartChannel: (channelId: string) => void;
  onStopChannel: (channelId: string) => void;
  onRemoveChannel: (channelId: string) => void;
  onConfigureChannel: (channelId: string) => void;
  onReorderChannels: (channelIds: string[]) => void;
  onCreateClick: () => void;
  // NEW: for inline VU meters
  getLevels: (channelId: string) => ChannelLevelData | null;
}
```

**ScrollArea wrapper pattern** — wraps list content:
```tsx
// Source: VuMeterBank.tsx lines 39-51 (container wrapping mapped items)
// + shadcn ScrollArea pattern from RESEARCH.md
import { ScrollArea } from "@/components/ui/scroll-area";

<ScrollArea className="h-[calc(100vh-12rem)]">
  <div className="flex flex-col gap-3 pr-4">
    {channels.map((channel, index) => (
      <ChannelCard key={channel.id} channel={channel} index={index} ... />
    ))}
  </div>
</ScrollArea>
```

**Empty state pattern** — from ChannelList.tsx lines 68-72 (keep as-is):
```tsx
// Source: ChannelList.tsx lines 68-72
{channels.length === 0 && (
  <p className="text-muted-foreground italic py-8 text-center">
    No channels yet. Create one to get started.
  </p>
)}
```

**Move handler pattern** — from ChannelList.tsx lines 38-50 (keep, pass to ChannelCard):
```tsx
// Source: ChannelList.tsx lines 38-50 (stays in ChannelList, passed as callbacks)
function handleMoveUp(index: number) {
  if (index === 0) return;
  const ids = channels.map((ch) => ch.id);
  [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
  onReorderChannels(ids);
}
```

---

### `src/components/ui/card.tsx` (NEW — shadcn CLI install)

**Analog:** `src/components/ui/badge.tsx`

**Installation:** `npx shadcn@latest add card` — generates file automatically.

**Expected pattern** (based on badge.tsx structure lines 1-48):
```tsx
// Source: badge.tsx line 1-6 (shadcn import pattern — same for all ui/ components)
import * as React from "react"
import { cn } from "@/lib/utils"

// Exports: Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter
// Each uses data-slot attribute (e.g., data-slot="card")
```

---

### `src/components/ui/scroll-area.tsx` (NEW — shadcn CLI install)

**Analog:** `src/components/ui/tooltip.tsx`

**Installation:** `npx shadcn@latest add scroll-area` — generates file automatically.

**Expected pattern** (based on tooltip.tsx structure lines 1-57):
```tsx
// Source: tooltip.tsx lines 1-5 (radix primitive import pattern)
"use client"
import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

// Exports: ScrollArea, ScrollBar
```

---

### `src/App.tsx` (MODIFIED — controller, request-response)

**Analog:** self — lines 117-125

**Current ChannelList usage** (lines 117-125):
```tsx
// Source: App.tsx lines 117-125 (add getLevels prop)
<ChannelList
  channels={channels}
  onStartChannel={startChannel}
  onStopChannel={stopChannel}
  onRemoveChannel={removeChannel}
  onConfigureChannel={setSelectedChannelId}
  onReorderChannels={reorderChannels}
  onCreateClick={() => setShowCreateDialog(true)}
/>
```

**Required change** — add audioLevels prop (follows VuMeterBank pattern at App.tsx line 134):
```tsx
// Source: App.tsx line 134 (VuMeterBank already receives audioLevels)
// Pattern: <VuMeterBank channels={channels} audioLevels={audioLevels} />
// Apply same: pass getLevels to ChannelList
<ChannelList
  channels={channels}
  onStartChannel={startChannel}
  onStopChannel={stopChannel}
  onRemoveChannel={removeChannel}
  onConfigureChannel={setSelectedChannelId}
  onReorderChannels={reorderChannels}
  onCreateClick={() => setShowCreateDialog(true)}
  getLevels={audioLevels.getLevels}
/>
```

---

### `src/__tests__/channel-cards.test.tsx` (NEW — test)

**Analog:** `src/__tests__/sidebar.test.tsx`

**Test structure pattern** (sidebar.test.tsx lines 1-5):
```tsx
// Source: sidebar.test.tsx lines 1-5
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
```

**Async dynamic import pattern** (sidebar.test.tsx lines 6-11):
```tsx
// Source: sidebar.test.tsx lines 6-11 (async renderX helper with dynamic import)
async function renderChannelList() {
  const { ChannelList } = await import("@/components/channels/ChannelList");
  const { TooltipProvider } = await import("@/components/ui/tooltip");
  // ... render with TooltipProvider wrapper (required for Tooltip components)
}
```

**TooltipProvider wrapper requirement** (header.test.tsx lines 8-12):
```tsx
// Source: header.test.tsx lines 8-12 (TooltipProvider must wrap components using Tooltip)
const { TooltipProvider } = await import("@/components/ui/tooltip");
return render(
  <TooltipProvider>
    {/* Component under test */}
  </TooltipProvider>
);
```

**data-slot assertion pattern** (header.test.tsx line 31):
```tsx
// Source: header.test.tsx line 31 (query by shadcn data-slot attribute)
const card = container.querySelector('[data-slot="card"]');
expect(card).toBeTruthy();
```

**Class assertion pattern** (sidebar.test.tsx lines 27-28):
```tsx
// Source: sidebar.test.tsx lines 27-28 (assert className contains expected token)
expect(element.className).toContain("bg-success");
```

**Mock channel data shape** — from useChannels.ts lines 26-37:
```tsx
// Source: useChannels.ts lines 26-37 (AdminChannel interface)
const mockChannel: AdminChannel = {
  id: "ch-1",
  name: "English",
  sources: [],
  outputFormat: "mono",
  autoStart: false,
  visible: true,
  sortOrder: 0,
  status: "streaming",
  processing: {},
  createdAt: Date.now(),
};
```

**Mock getLevels callback:**
```tsx
// Source: useAudioLevels.ts lines 135-139 (getLevels signature)
const mockGetLevels = (_channelId: string) => null;
```

---

## Shared Patterns

### Import Path Aliases
**Source:** All components use `@/` alias
**Apply to:** All new files
```tsx
// Source: ConnectionStatus.tsx line 1, ListenerCountBadge.tsx line 2
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
```
Note: Hooks use relative `../../hooks/` path (ChannelList.tsx line 2). New files under `src/components/channels/` should use `@/hooks/` for consistency.

### Tailwind Design Tokens (Status Colors)
**Source:** `src/index.css` (verified in RESEARCH.md)
**Apply to:** ChannelStatusBadge, ChannelCard
```css
/* Available as Tailwind classes: */
/* text-success, bg-success, bg-success/20 */
/* text-warning, bg-warning, bg-warning/20 */
/* text-destructive, bg-destructive, bg-destructive/20 */
/* text-muted-foreground, bg-muted */
```

### shadcn Button Sizes
**Source:** `src/components/ui/button.tsx` lines 25-32
**Apply to:** All action buttons in ChannelCard
```tsx
// Source: button.tsx line 29 — ideal for card action buttons
// "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3"
<Button variant="ghost" size="icon-xs">
  <Play className="size-3" />
</Button>
```

### cn() Utility
**Source:** `src/lib/utils.ts` lines 1-5
**Apply to:** All components needing conditional classes
```tsx
// Source: utils.ts lines 1-5
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### VuMeter Callback Binding
**Source:** `src/components/monitoring/VuMeterBank.tsx` lines 63-66
**Apply to:** ChannelCard (each card binds getLevels to its channel ID)
```tsx
// Source: VuMeterBank.tsx lines 63-66
const getChannelLevels = useCallback(
  () => getLevels(channelId),
  [getLevels, channelId],
);
```

### Test File Location Convention
**Source:** `src/__tests__/` directory
**Apply to:** New test file
```
src/__tests__/sidebar.test.tsx    — Phase 12 sidebar tests
src/__tests__/header.test.tsx     — Phase 12 header tests
src/__tests__/channel-cards.test.tsx  — Phase 13 (new)
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | All files have strong analogs in codebase |

## Metadata

**Analog search scope:** `src/components/`, `src/hooks/`, `src/__tests__/`, `src/lib/`
**Files scanned:** 18
**Pattern extraction date:** 2026-05-05
