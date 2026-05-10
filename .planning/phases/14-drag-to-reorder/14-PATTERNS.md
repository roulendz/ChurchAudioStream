# Phase 14: Drag-to-Reorder - Pattern Map

**Mapped:** 2026-05-05
**Files analyzed:** 4 (2 modify, 1 modify test, 1 new test)
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/components/channels/ChannelList.tsx` | component (container) | event-driven | itself (current version) | exact-self |
| `src/components/channels/ChannelCard.tsx` | component (item) | event-driven | itself (current version) | exact-self |
| `src/__tests__/channel-cards.test.tsx` | test | N/A | itself (current version) | exact-self |
| `src/__tests__/drag-reorder.test.tsx` | test | N/A | `src/__tests__/channel-cards.test.tsx` | exact |

## Pattern Assignments

### `src/components/channels/ChannelList.tsx` (component, event-driven) -- MODIFY

**Analog:** itself -- modifying in-place. Wrap existing layout in DragDropProvider, replace handleMoveUp/handleMoveDown with handleDragEnd.

**Current imports** (lines 1-6):
```typescript
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus } from "lucide-react";
import { ChannelCard } from "./ChannelCard";
import type { AdminChannel } from "@/hooks/useChannels";
import type { ChannelLevelData } from "@/hooks/useAudioLevels";
```

**New imports to add:**
```typescript
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';
```

**Current reorder logic to REMOVE** (lines 29-41):
```typescript
function handleMoveUp(index: number) {
  if (index === 0) return;
  const ids = channels.map((ch) => ch.id);
  [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
  onReorderChannels(ids);
}

function handleMoveDown(index: number) {
  if (index === channels.length - 1) return;
  const ids = channels.map((ch) => ch.id);
  [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
  onReorderChannels(ids);
}
```

**Replacement -- onDragEnd handler (from RESEARCH.md Pattern 1):**
```typescript
function handleDragEnd(event: Parameters<NonNullable<React.ComponentProps<typeof DragDropProvider>['onDragEnd']>>[0]) {
  if (event.canceled) return;
  const { source } = event.operation;
  if (!isSortable(source)) return;

  const { initialIndex, index } = source.sortable;
  if (initialIndex === index) return;

  const ids = channels.map((ch) => ch.id);
  const [moved] = ids.splice(initialIndex, 1);
  ids.splice(index, 0, moved);
  onReorderChannels(ids);
}
```

**Current JSX structure** (lines 57-78) -- wrap ScrollArea in DragDropProvider:
```typescript
// BEFORE:
<ScrollArea className="h-[calc(100vh-12rem)]">
  <div className="flex flex-col gap-3 pr-4">
    {channels.map((channel, index) => (
      <ChannelCard key={channel.id} channel={channel} index={index} ... />
    ))}
  </div>
</ScrollArea>

// AFTER:
<DragDropProvider onDragEnd={handleDragEnd}>
  <ScrollArea className="h-[calc(100vh-12rem)]">
    <div className="flex flex-col gap-3 pr-4">
      {channels.map((channel, index) => (
        <ChannelCard key={channel.id} channel={channel} index={index} ... />
      ))}
    </div>
  </ScrollArea>
</DragDropProvider>
```

**Props to remove from ChannelCard render** (lines 61-73):
- Remove `totalChannels={channels.length}` -- no longer needed (no move up/down boundary checks)
- Remove `onMoveUp={handleMoveUp}` -- replaced by drag
- Remove `onMoveDown={handleMoveDown}` -- replaced by drag

**ChannelListProps interface** (lines 8-17) -- remove no props, interface stays same. `onReorderChannels` still needed (called from handleDragEnd now instead of handleMoveUp/Down).

---

### `src/components/channels/ChannelCard.tsx` (component, event-driven) -- MODIFY

**Analog:** itself -- modifying in-place. Add useSortable hook, drag handle, remove move buttons.

**Current imports** (lines 1-27):
```typescript
import { useCallback } from "react";
import {
  Card, CardHeader, CardTitle, CardAction, CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip, TooltipTrigger, TooltipContent,
} from "@/components/ui/tooltip";
import {
  Play, Square, Settings, Trash2,
  ChevronUp, ChevronDown, // REMOVE these
  EyeOff,
} from "lucide-react";
import { ChannelStatusBadge } from "./ChannelStatusBadge";
import { VuMeter } from "@/components/monitoring/VuMeter";
import type { AdminChannel } from "@/hooks/useChannels";
import type { ChannelLevelData } from "@/hooks/useAudioLevels";
```

**New imports to add:**
```typescript
import { useSortable } from '@dnd-kit/react/sortable';
import { GripVertical } from 'lucide-react'; // add to existing lucide import
```

**Imports to REMOVE from lucide-react:**
```typescript
ChevronUp, ChevronDown  // no longer used
```

**Current ChannelCardProps interface** (lines 29-40) -- remove move props:
```typescript
// REMOVE these props:
totalChannels: number;
onMoveUp: (index: number) => void;
onMoveDown: (index: number) => void;
```

**Current component signature** (lines 42-53) -- remove from destructuring:
```typescript
// REMOVE from destructuring:
totalChannels, onMoveUp, onMoveDown
```

**Add useSortable hook** after component signature, before isRunning:
```typescript
const { ref, handleRef, isDragSource } = useSortable({
  id: channel.id,
  index,
});
```

**Current Card element** (line 63) -- add ref and drag styles:
```typescript
// BEFORE:
<Card>

// AFTER:
<Card
  ref={ref}
  className={cn(
    "transition-shadow",
    isDragSource && "opacity-50 ring-2 ring-primary/50 shadow-lg"
  )}
>
```

**NOTE:** Need to import `cn` utility:
```typescript
import { cn } from "@/lib/utils";
```

**Add drag handle** in CardHeader, before CardTitle (line 65-68):
```typescript
<div className="flex items-center gap-2 min-w-0">
  {/* Drag handle */}
  <button
    ref={handleRef}
    className="cursor-grab active:cursor-grabbing touch-none p-0.5 rounded hover:bg-accent"
    aria-label="Drag to reorder"
  >
    <GripVertical className="size-4 text-muted-foreground" />
  </button>
  <CardTitle className="text-sm font-semibold truncate">
    {channel.name}
  </CardTitle>
  {/* ... EyeOff icon unchanged */}
</div>
```

**REMOVE Move Up/Down buttons** (lines 102-128):
```typescript
// DELETE this entire block:
{/* Reorder buttons -- Phase 14 replaces with drag handles */}
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="outline" size="icon-xs" disabled={index === 0} onClick={() => onMoveUp(index)}>
      <ChevronUp className="size-3" />
    </Button>
  </TooltipTrigger>
  <TooltipContent>Move up</TooltipContent>
</Tooltip>
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="outline" size="icon-xs" disabled={index === totalChannels - 1} onClick={() => onMoveDown(index)}>
      <ChevronDown className="size-3" />
    </Button>
  </TooltipTrigger>
  <TooltipContent>Move down</TooltipContent>
</Tooltip>
```

---

### `src/__tests__/channel-cards.test.tsx` (test) -- MODIFY

**Analog:** itself -- updating render helpers and assertions.

**Current render helper** (lines 24-44):
```typescript
async function renderChannelCard(overrides: Partial<AdminChannel> = {}) {
  const { ChannelCard } = await import("@/components/channels/ChannelCard");
  const { TooltipProvider } = await import("@/components/ui/tooltip");
  const channel = { ...mockChannel, ...overrides };
  return render(
    <TooltipProvider>
      <ChannelCard
        channel={channel}
        index={0}
        totalChannels={3}           // REMOVE
        getLevels={mockGetLevels}
        onStart={noopIdFn}
        onStop={noopIdFn}
        onConfigure={noopIdFn}
        onRemove={noopIdFn}
        onMoveUp={noopIdxFn}        // REMOVE
        onMoveDown={noopIdxFn}      // REMOVE
      />
    </TooltipProvider>
  );
}
```

**Updated render helper pattern -- wrap in DragDropProvider:**
```typescript
async function renderChannelCard(overrides: Partial<AdminChannel> = {}) {
  const { ChannelCard } = await import("@/components/channels/ChannelCard");
  const { TooltipProvider } = await import("@/components/ui/tooltip");
  const { DragDropProvider } = await import("@dnd-kit/react");
  const channel = { ...mockChannel, ...overrides };
  return render(
    <DragDropProvider>
      <TooltipProvider>
        <ChannelCard
          channel={channel}
          index={0}
          getLevels={mockGetLevels}
          onStart={noopIdFn}
          onStop={noopIdFn}
          onConfigure={noopIdFn}
          onRemove={noopIdFn}
        />
      </TooltipProvider>
    </DragDropProvider>
  );
}
```

**Remove unused noop** (line 23):
```typescript
const noopIdxFn = (_idx: number) => {};  // REMOVE -- no more onMoveUp/onMoveDown
```

**Tests to UPDATE:**

Line 117 -- tooltip trigger count changes (was 5+ for moveUp, moveDown, start/stop, configure, remove -- now 3+ for start/stop, configure, remove):
```typescript
// BEFORE:
expect(tooltipTriggers.length).toBeGreaterThanOrEqual(5);

// AFTER:
expect(tooltipTriggers.length).toBeGreaterThanOrEqual(3);
```

Line 124 -- button count changes (was 5+ -- now 3+ action buttons + 1 drag handle button):
```typescript
// BEFORE:
expect(buttons.length).toBeGreaterThanOrEqual(5);

// AFTER -- drag handle is a plain <button> without data-variant, action buttons are 3:
expect(buttons.length).toBeGreaterThanOrEqual(3);
```

**Test to ADD** -- drag handle presence:
```typescript
it("card has drag handle with GripVertical (CARD-04)", async () => {
  await renderChannelCard();
  const dragHandle = screen.getByRole("button", { name: /drag to reorder/i });
  expect(dragHandle).toBeInTheDocument();
});
```

**Test to ADD** -- no move buttons:
```typescript
it("move up/down buttons removed (CARD-04)", async () => {
  const { container } = await renderChannelCard();
  // ChevronUp and ChevronDown SVGs should not exist
  const buttons = container.querySelectorAll("button");
  const buttonLabels = Array.from(buttons).map(b => b.getAttribute("aria-label") ?? b.textContent);
  expect(buttonLabels).not.toContain("Move up");
  expect(buttonLabels).not.toContain("Move down");
});
```

---

### `src/__tests__/drag-reorder.test.tsx` (test) -- NEW

**Analog:** `src/__tests__/channel-cards.test.tsx` -- same test framework, same mock data, same dynamic import pattern.

**Test file structure pattern** (from channel-cards.test.tsx):
```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AdminChannel } from "@/hooks/useChannels";

// Same mockChannel as channel-cards.test.tsx
const mockChannel: AdminChannel = { /* ... */ };

// renderChannelList with DragDropProvider wrapper
async function renderChannelList(channels: AdminChannel[] = [/* ... */]) {
  const { ChannelList } = await import("@/components/channels/ChannelList");
  const { TooltipProvider } = await import("@/components/ui/tooltip");
  // NOTE: ChannelList adds DragDropProvider internally, no need to wrap here
  return render(
    <TooltipProvider>
      <ChannelList
        channels={channels}
        onStartChannel={noopIdFn}
        onStopChannel={noopIdFn}
        onRemoveChannel={noopIdFn}
        onConfigureChannel={noopIdFn}
        onReorderChannels={mockReorderFn}
        onCreateClick={noopFn}
        getLevels={mockGetLevels}
      />
    </TooltipProvider>
  );
}

describe("Drag-to-Reorder", () => {
  it("each card has a drag handle (CARD-04a)", async () => { /* ... */ });
  it("multiple cards each have drag handle (CARD-04a)", async () => { /* ... */ });
  // NOTE: Simulating actual drag events programmatically with @dnd-kit/react
  // is complex. Visual feedback and full reorder tests may need manual UAT.
});
```

**Vitest config** (vitest.config.ts) -- no changes needed, `src/**/*.test.tsx` already included.

---

## Shared Patterns

### Component Import Convention
**Source:** `src/components/channels/ChannelList.tsx` lines 1-6
**Apply to:** All modified component files
```typescript
// Path alias imports using @/
import { Component } from "@/components/ui/component";
import { Hook } from "@/hooks/hookName";
import type { Type } from "@/hooks/hookName";
```

### Lucide Icon Usage
**Source:** `src/components/channels/ChannelCard.tsx` lines 17-23
**Apply to:** ChannelCard (add GripVertical, remove ChevronUp/ChevronDown)
```typescript
import {
  Play, Square, Settings, Trash2,
  GripVertical,  // NEW for drag handle
  EyeOff,
} from "lucide-react";
```

### Tooltip Wrapping Pattern
**Source:** `src/components/channels/ChannelCard.tsx` lines 130-140
**Apply to:** NOT the drag handle -- drag handle is plain `<button>` with `aria-label`, no Tooltip wrapper (tooltip would conflict with drag interaction)
```typescript
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="ghost" size="icon-xs" onClick={...}>
      <Icon className="size-3" />
    </Button>
  </TooltipTrigger>
  <TooltipContent>Label</TooltipContent>
</Tooltip>
```

### Test Dynamic Import Pattern
**Source:** `src/__tests__/channel-cards.test.tsx` lines 24-44
**Apply to:** Both test files
```typescript
async function renderComponent(overrides = {}) {
  const { Component } = await import("@/components/path");
  const { DragDropProvider } = await import("@dnd-kit/react");
  return render(
    <DragDropProvider>
      {/* ... */}
    </DragDropProvider>
  );
}
```

### cn() Utility for Conditional Classes
**Source:** Used throughout shadcn components
**Apply to:** ChannelCard (new drag styles)
```typescript
import { cn } from "@/lib/utils";
// Usage:
className={cn("transition-shadow", isDragSource && "opacity-50 ring-2 ring-primary/50 shadow-lg")}
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | -- | -- | All files have exact analogs (self or sibling test file) |

## Files Requiring NO Changes

| File | Reason |
|------|--------|
| `src/App.tsx` | Already passes `reorderChannels` as `onReorderChannels` to ChannelList (line 123). No prop changes needed. |
| `src/hooks/useChannels.ts` | `reorderChannels()` already sends `channel:reorder` WS message (line 203-208). No changes. |
| `src/hooks/useWebSocket.ts` | Transport layer, unrelated to drag UI. No changes. |
| `src/components/channels/ChannelStatusBadge.tsx` | Unchanged per RESEARCH.md. |
| `package.json` | Only change: `npm install @dnd-kit/react` adds dependency. No manual edit needed. |

## Metadata

**Analog search scope:** `src/components/channels/`, `src/__tests__/`, `src/hooks/`, `src/App.tsx`
**Files scanned:** 8 (all required reading files)
**Pattern extraction date:** 2026-05-05
