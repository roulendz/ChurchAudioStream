# Phase 14: Drag-to-Reorder - Research

**Researched:** 2026-05-05
**Domain:** React drag-and-drop, @dnd-kit/react sortable lists
**Confidence:** HIGH

## Summary

Phase 14 replaces arrow-button channel reordering with drag-and-drop using `@dnd-kit/react` v0.4.0 -- the new React-specific package (NOT legacy `@dnd-kit/core`). This is a focused UI-only change: the backend `channel:reorder` WebSocket message and config persistence already work. The existing `ChannelList` already accepts `onReorderChannels(channelIds: string[])` and the `useChannels` hook already has `reorderChannels()` wired up.

Key work: install `@dnd-kit/react`, wrap `ChannelList` in `DragDropProvider`, convert `ChannelCard` to use `useSortable` hook with a drag handle (GripVertical icon), handle `onDragEnd` to compute new order from `initialIndex`/`index`, remove Move Up/Down buttons, and update tests.

**Primary recommendation:** Use `@dnd-kit/react` v0.4.0 with `useSortable` hook, `DragDropProvider`, drag handle pattern via `handleRef`, and the manual splice pattern in `onDragEnd` (not `move()` helper -- overkill for single flat list).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CARD-04 | Channel list supports drag-to-reorder with visual feedback (replaces arrow buttons) | @dnd-kit/react v0.4.0 useSortable hook + DragDropProvider + OptimisticSortingPlugin (default) provides drag, visual feedback via isDragSource/isDropTarget booleans and CSS classes, handleRef for GripVertical drag handle. Backend persistence already works via channel:reorder WS message. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **DRY**: Extract reusable SortableChannelCard wrapper
- **SRP**: Drag logic separate from card rendering
- **Self-explanatory naming**: `handleRef`, `isDragging`, `containerRef` etc.
- **Tiger-Style**: Fail fast -- guard `isSortable(source)` before accessing sortable properties
- **No spaghetti**: Clean separation of DragDropProvider (ChannelList) and useSortable (ChannelCard)
- **Test each function**: Test drag reorder logic, test removal of move buttons
- **No framer-motion**: Explicitly out of scope per REQUIREMENTS.md -- dnd-kit built-in transitions sufficient

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Drag-to-reorder UI | Browser / Client | -- | Pure DOM interaction, pointer/touch events, visual feedback |
| Order persistence | API / Backend | -- | Already implemented: sidecar handles `channel:reorder` WS message, writes to config.json |
| State management | Browser / Client | -- | React state in useChannels hook, optimistic DOM reorder via dnd-kit plugin |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @dnd-kit/react | 0.4.0 | React drag-and-drop hooks + components | [VERIFIED: npm registry] Locked decision in STATE.md. New rewrite, NOT legacy @dnd-kit/core. Supports React 19. |

### Supporting (auto-installed as dependencies)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @dnd-kit/dom | 0.4.0 | DOM primitives for dnd-kit | [VERIFIED: npm registry] Auto-installed with @dnd-kit/react |
| @dnd-kit/state | 0.4.0 | Reactive state management | [VERIFIED: npm registry] Auto-installed with @dnd-kit/react |
| @dnd-kit/abstract | 0.4.0 | Core abstractions | [VERIFIED: npm registry] Auto-installed with @dnd-kit/react |
| lucide-react | ^1.14.0 | GripVertical icon for drag handle | [VERIFIED: already installed] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @dnd-kit/react | @hello-pangea/dnd | Higher-level but less flexible, no handle support OOTB |
| @dnd-kit/react | react-beautiful-dnd | Deprecated, no React 19 support |
| Manual splice in onDragEnd | @dnd-kit/helpers move() | move() adds unnecessary dependency for single flat list |

**Installation:**
```bash
npm install @dnd-kit/react
```

**Version verification:** @dnd-kit/react 0.4.0 confirmed on npm registry 2026-05-05. Beta 0.4.1-beta-20260504134343 available but not recommended for production. Peer dependencies: react ^18.0.0 || ^19.0.0 (project has React 19.2.0 -- compatible). [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```
User Pointer/Touch Input
        |
        v
  DragDropProvider (ChannelList)
        |
        +---> PointerSensor (default)
        +---> KeyboardSensor (default, accessibility)
        |
        v
  useSortable (per ChannelCard)
        |
        +---> handleRef -> GripVertical icon (drag handle)
        +---> ref -> Card wrapper element
        +---> isDragSource -> CSS classes (opacity, ring, shadow)
        |
        v
  OptimisticSortingPlugin (default, auto-registered)
        |  Moves DOM nodes during drag without React re-render
        |  Updates index/initialIndex on each sortable instance
        |
        v
  onDragEnd callback
        |
        +---> isSortable(source) type guard
        +---> source.sortable.initialIndex / source.sortable.index
        +---> splice to compute new channelIds array
        |
        v
  onReorderChannels(channelIds)  [existing prop]
        |
        v
  useChannels.reorderChannels()  [existing hook]
        |
        v
  WS "channel:reorder" message   [existing backend]
        |
        v
  config.json persistence        [existing backend]
```

### Recommended Project Structure
```
src/
  components/
    channels/
      ChannelList.tsx        # Add DragDropProvider wrapper, onDragEnd handler
      ChannelCard.tsx         # Add useSortable, handleRef, remove Move Up/Down
      ChannelStatusBadge.tsx  # Unchanged
  __tests__/
    channel-cards.test.tsx    # Update: remove move button tests, add drag tests
    drag-reorder.test.tsx     # New: dedicated drag reorder tests
```

### Pattern 1: DragDropProvider + onDragEnd in ChannelList
**What:** Wrap channel list in DragDropProvider, handle reorder in onDragEnd
**When to use:** Container component that manages sortable children
**Example:**
```typescript
// Source: https://dndkit.com/react/guides/sortable-state-management/
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';

function ChannelList({ channels, onReorderChannels, ...props }) {
  function handleDragEnd(event) {
    if (event.canceled) return;
    const { source } = event.operation;
    if (!isSortable(source)) return;

    const { initialIndex, index } = source.sortable;
    if (initialIndex === index) return;

    // Compute new order from current channels array
    const ids = channels.map(ch => ch.id);
    const [moved] = ids.splice(initialIndex, 1);
    ids.splice(index, 0, moved);
    onReorderChannels(ids);
  }

  return (
    <DragDropProvider onDragEnd={handleDragEnd}>
      {/* ... ScrollArea with ChannelCards */}
    </DragDropProvider>
  );
}
```

### Pattern 2: useSortable with Drag Handle in ChannelCard
**What:** Each card uses useSortable hook, GripVertical icon as drag handle
**When to use:** Individual sortable items
**Example:**
```typescript
// Source: https://dndkit.com/react/hooks/use-sortable/
// Source: https://medium.com/@ysuwansiri/drag-drop-sorting-with-dnd-kit-react-using-initialindex-and-index-9a80356e6649
import { useSortable } from '@dnd-kit/react/sortable';
import { GripVertical } from 'lucide-react';

function ChannelCard({ channel, index, ...props }) {
  const { ref, handleRef, isDragSource } = useSortable({
    id: channel.id,
    index,
  });

  return (
    <Card
      ref={ref}
      className={cn(
        isDragSource && "opacity-50 ring-2 ring-primary shadow-lg"
      )}
    >
      <CardHeader>
        {/* Drag handle */}
        <button
          ref={handleRef}
          className="cursor-grab active:cursor-grabbing touch-none"
          aria-label="Drag to reorder"
        >
          <GripVertical className="size-4 text-muted-foreground" />
        </button>
        {/* ... rest of header */}
      </CardHeader>
      {/* ... rest of card */}
    </Card>
  );
}
```

### Pattern 3: Visual Feedback During Drag
**What:** Style changes on drag source and implicit drop target
**When to use:** Always -- required by CARD-04
**Example:**
```typescript
// isDragSource: true on the card being dragged
// OptimisticSortingPlugin moves DOM elements automatically,
// creating visual feedback of the drop position without
// needing explicit drop indicator rendering.

// Source card styling:
className={cn(
  // Base card styles
  "transition-shadow",
  isDragSource && "opacity-50 ring-2 ring-primary/50 shadow-lg scale-[1.02]"
)}
```

### Anti-Patterns to Avoid
- **Using @dnd-kit/core or @dnd-kit/sortable (legacy):** These are the old API. @dnd-kit/react is the new rewrite with different hooks/components. Do NOT mix.
- **Comparing source.id === target.id in onDragEnd:** With OptimisticSortingPlugin (default), source and target refer to the SAME element during drag. Use `source.sortable.initialIndex` vs `source.sortable.index` instead. [CITED: https://dndkit.com/react/guides/sortable-state-management/]
- **Forgetting `touch-none` on drag handle:** Without it, mobile browsers intercept touch events for scroll instead of drag.
- **Wrapping entire Card as draggable without handle:** Makes buttons/links inside the card undraggable. Use `handleRef` on a dedicated grip icon.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-and-drop | Custom pointer event tracking + DOM manipulation | @dnd-kit/react useSortable | Touch/mouse/keyboard support, collision detection, auto-scroll, accessibility, optimistic DOM reorder |
| Array reorder | Custom array mutation logic | Standard splice pattern | Simple, well-understood -- `[moved] = arr.splice(from, 1); arr.splice(to, 0, moved)` |
| Auto-scroll during drag | Custom scroll-on-edge detection | @dnd-kit AutoScroller plugin (default) | Handles edge detection, acceleration, nested scroll containers |
| Keyboard reorder | Custom keydown handlers | @dnd-kit KeyboardSensor (default) | Accessibility built-in, arrow keys work OOTB for sortable |

**Key insight:** @dnd-kit/react v0.4 bundles OptimisticSortingPlugin (DOM element reordering during drag) and AutoScroller by default. No extra config needed for basic sortable list.

## Common Pitfalls

### Pitfall 1: Source === Target with OptimisticSortingPlugin
**What goes wrong:** Developer checks `source.id !== target.id` in onDragEnd to detect reorder. Always false because they're the same element.
**Why it happens:** OptimisticSortingPlugin physically moves DOM elements during drag, so the drop target IS the dragged element.
**How to avoid:** Use `isSortable(source)` type guard, then read `source.sortable.initialIndex` and `source.sortable.index`.
**Warning signs:** Reorder callback never fires despite visual drag working.

### Pitfall 2: Forgetting to Remove Move Up/Down Buttons
**What goes wrong:** Both drag handles AND arrow buttons exist, confusing UX and redundant functionality.
**Why it happens:** Phase 13 left comment `/* Phase 14 replaces with drag handles */` but developer only adds drag, forgets removal.
**How to avoid:** Explicitly delete ChevronUp/ChevronDown buttons from ChannelCard. Remove `onMoveUp`/`onMoveDown` props. Remove `handleMoveUp`/`handleMoveDown` from ChannelList. Update tests.
**Warning signs:** More than one way to reorder visible in UI.

### Pitfall 3: Canvas VuMeter Inside Dragged Card
**What goes wrong:** VuMeter uses requestAnimationFrame for 60fps rendering. During drag, the canvas element moves in the DOM. If the canvas ref is lost or re-mounted, animation loop breaks.
**Why it happens:** OptimisticSortingPlugin moves DOM nodes physically. Canvas element survives DOM moves (same node, different parent position) -- but verify.
**How to avoid:** VuMeter uses `useRef` for canvas -- DOM moves preserve the element reference. The `requestAnimationFrame` loop should survive because it references the same canvas node. Test by dragging a streaming channel and verifying VU meter continues animating.
**Warning signs:** VU meter freezes or goes blank during/after drag.

### Pitfall 4: ScrollArea Interference with Drag
**What goes wrong:** Radix ScrollArea uses `overflow: hidden` on viewport, potentially clipping dragged element that moves outside container bounds.
**Why it happens:** ScrollArea viewport has `size-full` class and scroll behavior that may conflict with drag overlay positioning.
**How to avoid:** @dnd-kit/react v0.4 handles overflow containers via AutoScroller plugin. The dragged element stays in-place (OptimisticSortingPlugin moves DOM nodes, doesn't create a floating overlay by default). If clipping occurs, add `overflow-visible` during drag or use DragOverlay component.
**Warning signs:** Dragged card visually clips at ScrollArea boundary.

### Pitfall 5: Test Environment Missing DragDropProvider
**What goes wrong:** Tests that render ChannelCard without wrapping in DragDropProvider crash because useSortable requires context.
**Why it happens:** useSortable needs DragDropProvider ancestor.
**How to avoid:** Update test render helpers to wrap in DragDropProvider. Or: if DragDropProvider is added inside ChannelList (recommended), test ChannelCard in isolation by conditionally using useSortable only when inside provider context.
**Warning signs:** "Cannot read property of null" or "useSortable must be used within DragDropProvider" errors in tests.

## Code Examples

### Complete ChannelList with DragDropProvider
```typescript
// Source: https://dndkit.com/react/guides/sortable-state-management/
// + https://dndkit.com/react/components/drag-drop-provider/
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';

export function ChannelList({
  channels,
  onReorderChannels,
  onCreateClick,
  getLevels,
  ...actionProps
}: ChannelListProps) {
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Channels</h3>
        <Button onClick={onCreateClick}>
          <Plus className="size-4" />
          New Channel
        </Button>
      </div>

      {channels.length === 0 ? (
        <p className="text-muted-foreground italic py-8 text-center">
          No channels yet. Create one to get started.
        </p>
      ) : (
        <DragDropProvider onDragEnd={handleDragEnd}>
          <ScrollArea className="h-[calc(100vh-12rem)]">
            <div className="flex flex-col gap-3 pr-4">
              {channels.map((channel, index) => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  index={index}
                  getLevels={getLevels}
                  {...actionProps}
                />
              ))}
            </div>
          </ScrollArea>
        </DragDropProvider>
      )}
    </div>
  );
}
```

### Complete ChannelCard with useSortable
```typescript
// Source: https://dndkit.com/react/hooks/use-sortable/
// Source: https://medium.com/@ysuwansiri/drag-drop-sorting-with-dnd-kit-react-using-initialindex-and-index-9a80356e6649
import { useSortable } from '@dnd-kit/react/sortable';
import { GripVertical } from 'lucide-react';

export function ChannelCard({
  channel,
  index,
  getLevels,
  onStart,
  onStop,
  onConfigure,
  onRemove,
}: ChannelCardProps) {
  const { ref, handleRef, isDragSource } = useSortable({
    id: channel.id,
    index,
  });

  return (
    <Card
      ref={ref}
      className={cn(
        "transition-shadow",
        isDragSource && "opacity-50 ring-2 ring-primary/50 shadow-lg"
      )}
    >
      <CardHeader>
        <div className="flex items-center gap-2 min-w-0">
          {/* Drag handle replaces Move Up/Down buttons */}
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
        </div>
        <CardAction>
          <ChannelStatusBadge status={channel.status} />
        </CardAction>
      </CardHeader>
      {/* ... CardContent with VuMeter and action buttons (no more ChevronUp/ChevronDown) */}
    </Card>
  );
}
```

### Import Map
```typescript
// New imports for Phase 14:
import { DragDropProvider } from '@dnd-kit/react';           // ChannelList
import { useSortable, isSortable } from '@dnd-kit/react/sortable'; // ChannelCard / ChannelList
import { GripVertical } from 'lucide-react';                 // ChannelCard (already installed)

// Removed imports:
// ChevronUp, ChevronDown from 'lucide-react'  -- no longer needed in ChannelCard
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| @dnd-kit/core + @dnd-kit/sortable | @dnd-kit/react v0.4+ | 2024-2025 | Complete API rewrite. useSortable, DragDropProvider replace DndContext, SortableContext, useSortable (legacy) |
| useSortable returns {attributes, listeners, setNodeRef, transform, transition} | useSortable returns {ref, handleRef, isDragSource, isDropTarget} | v0.4.0 | Simpler API. No manual transform/transition CSS needed. |
| SortableContext required wrapping items | DragDropProvider only | v0.4.0 | No SortableContext needed. OptimisticSortingPlugin handles sorting automatically. |
| arrayMove() from @dnd-kit/sortable | Manual splice or move() from @dnd-kit/helpers | v0.4.0 | arrayMove is legacy. New move() helper exists but manual splice is simpler for flat list. |

**Deprecated/outdated:**
- `@dnd-kit/core`: Legacy package. Do NOT install.
- `@dnd-kit/sortable`: Legacy package. Do NOT install.
- `SortableContext`: Legacy component. Replaced by DragDropProvider.
- `arrayMove()`: Legacy utility. Use splice pattern or `@dnd-kit/helpers` move().
- `CSS.Transform.toString()`: Legacy. New API handles transforms internally.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Canvas VuMeter survives DOM node repositioning by OptimisticSortingPlugin without breaking requestAnimationFrame loop | Pitfalls | VU meters freeze during/after drag. Mitigation: test visually. Worst case: pause/resume rAF on drag start/end. |
| A2 | DragDropProvider works without issues inside or alongside Radix ScrollArea | Pitfalls | Drag clipping or scroll interference. Mitigation: test with multiple channels that overflow. |
| A3 | `isSortable(source)` exposes `source.sortable.initialIndex` and `source.sortable.index` (not direct properties on source) | Code Examples | onDragEnd handler fails to read position. Easy to fix by checking actual TypeScript types after install. |

## Open Questions (RESOLVED)

1. **Exact TypeScript type for onDragEnd event parameter**
   - What we know: Event has `canceled` boolean and `operation.source` object
   - What's unclear: Exact generic type name for typing the handler parameter
   - Recommendation: Use `Parameters<NonNullable<...>>` pattern or let TypeScript infer from DragDropProvider props

2. **DragDropProvider placement relative to ScrollArea**
   - What we know: DragDropProvider needs to wrap sortable items
   - What's unclear: Should DragDropProvider wrap ScrollArea or be inside it?
   - Recommendation: Wrap ScrollArea inside DragDropProvider so drag context covers all items. If auto-scroll breaks, try the reverse.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 + @testing-library/react 16.3.2 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run src/__tests__/channel-cards.test.tsx --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CARD-04a | Drag handle present on each card (GripVertical icon) | unit | `npx vitest run src/__tests__/channel-cards.test.tsx -t "drag handle"` | Update existing |
| CARD-04b | Move Up/Down buttons removed | unit | `npx vitest run src/__tests__/channel-cards.test.tsx -t "move button"` | Update existing |
| CARD-04c | Visual feedback on drag source (opacity/ring class) | unit | `npx vitest run src/__tests__/drag-reorder.test.tsx -t "visual feedback"` | Wave 0 |
| CARD-04d | onReorderChannels called with correct order after drag | unit | `npx vitest run src/__tests__/drag-reorder.test.tsx -t "reorder"` | Wave 0 |
| CARD-04e | Persistence survives restart | manual-only | N/A -- requires running app | N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run src/__tests__/channel-cards.test.tsx src/__tests__/drag-reorder.test.tsx --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before /gsd-verify-work

### Wave 0 Gaps
- [ ] `src/__tests__/drag-reorder.test.tsx` -- covers CARD-04c, CARD-04d (DragDropProvider test wrapper needed)
- [ ] Update `src/__tests__/channel-cards.test.tsx` -- remove move button assertions, add drag handle assertions, update ChannelCard render helper (remove onMoveUp/onMoveDown props, add DragDropProvider wrapper)

## Security Domain

security_enforcement: not explicitly false in config. However, this phase is purely UI cosmetic -- drag-and-drop reordering of local channel list. No auth, no input validation, no crypto, no sessions.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | no | Reorder payload already validated server-side (channelIds array) |
| V6 Cryptography | no | N/A |

### Known Threat Patterns

None applicable. Drag-to-reorder is a local admin UI interaction. The `channel:reorder` WS message is already validated server-side (existing code).

## Sources

### Primary (HIGH confidence)
- [npm registry] @dnd-kit/react v0.4.0 -- version, peer deps, exports verified via `npm view`
- [npm registry] @dnd-kit/helpers v0.4.0 -- version verified
- [npm registry] @dnd-kit/dom v0.4.0 -- auto-dependency verified
- [Official docs: dndkit.com/react/hooks/use-sortable/] -- useSortable hook API, handleRef, return values
- [Official docs: dndkit.com/react/guides/sortable-state-management/] -- onDragEnd pattern, isSortable type guard, initialIndex/index, OptimisticSortingPlugin behavior
- [Official docs: dndkit.com/react/components/drag-drop-provider/] -- DragDropProvider props, event handlers
- [Official docs: dndkit.com/concepts/sortable/] -- Sortable core concepts, OptimisticSortingPlugin, transition config
- [Official docs: dndkit.com/react/quickstart/] -- Installation, basic setup

### Secondary (MEDIUM confidence)
- [Medium article: medium.com/@ysuwansiri, Mar 2026] -- Complete working example with source.sortable.initialIndex/index pattern, SortableItem wrapper with handleRef
- [GitHub issue #1664: clauderic/dnd-kit] -- Confirms source === target behavior with OptimisticSortingPlugin (closed/resolved)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- npm registry verified, official docs confirmed API
- Architecture: HIGH -- official sortable state management guide matches exactly this use case
- Pitfalls: MEDIUM -- ScrollArea + dnd-kit interaction and VuMeter canvas survival are ASSUMED, not verified in this specific project

**Research date:** 2026-05-05
**Valid until:** 2026-06-05 (stable -- @dnd-kit/react v0.4 is current stable release)
