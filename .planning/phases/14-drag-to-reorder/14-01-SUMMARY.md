---
phase: 14-drag-to-reorder
plan: 01
status: done
commits:
  - ea1dade: "feat(14-01): replace move buttons with drag-to-reorder using @dnd-kit/react"
  - 2306c62: "test(14-01): update channel-cards tests for drag-to-reorder (CARD-04)"
---

# Plan 14-01 Summary: Drag-to-Reorder Implementation

## What Changed

**ChannelCard.tsx** — Replaced ChevronUp/ChevronDown move buttons with `useSortable` hook from `@dnd-kit/react`. GripVertical drag handle with `handleRef` restriction. Visual feedback via `isDragSource` (opacity-50 + ring-2). Removed `totalChannels`, `onMoveUp`, `onMoveDown` props.

**ChannelList.tsx** — Wrapped ScrollArea in `DragDropProvider`. Replaced `handleMoveUp`/`handleMoveDown` with `handleDragEnd` using `isSortable` guard + array splice to compute new order. Calls existing `onReorderChannels` prop.

**channel-cards.test.tsx** — Wrapped `renderChannelCard` in `DragDropProvider` (required by `useSortable`). Removed old props from render helper. Lowered tooltip/button count assertions from 5 to 3. Added 2 new CARD-04 tests: drag handle presence, move buttons removed.

**test-setup.ts** — Added `ResizeObserver` stub for jsdom (`@dnd-kit/dom` uses it at import time).

**package.json** — Added `@dnd-kit/react: ^0.4.0`.

## Test Results

17/17 channel-cards tests pass. 150/150 total tests pass (1 pre-existing script test has SyntaxError — out of scope).

## Deviations

- ResizeObserver stub in test-setup.ts not in original plan — required because @dnd-kit/dom accesses ResizeObserver at module load time in jsdom.
- Execution split across two commits due to rate limit interruption mid-task. Task 1 via worktree agent, Task 2 inline.
