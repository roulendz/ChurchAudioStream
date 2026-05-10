---
phase: 14
slug: drag-to-reorder
created: 2026-05-05
---

# Phase 14: Drag-to-Reorder — Validation Strategy

## Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 + @testing-library/react 16.3.2 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run src/__tests__/channel-cards.test.tsx --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

## Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CARD-04a | Drag handle present on each card (GripVertical icon) | unit | `npx vitest run src/__tests__/channel-cards.test.tsx -t "drag handle"` | Update existing |
| CARD-04b | Move Up/Down buttons removed | unit | `npx vitest run src/__tests__/channel-cards.test.tsx -t "move button"` | Update existing |
| CARD-04c | Visual feedback on drag source (opacity/ring class) | unit | `npx vitest run src/__tests__/drag-reorder.test.tsx -t "visual feedback"` | Wave 0 |
| CARD-04d | onReorderChannels called with correct order after drag | unit | `npx vitest run src/__tests__/drag-reorder.test.tsx -t "reorder"` | Wave 0 |
| CARD-04e | Persistence survives restart | manual-only | N/A -- requires running app | N/A |

## Sampling Rate

- **Per task commit:** `npx vitest run src/__tests__/channel-cards.test.tsx src/__tests__/drag-reorder.test.tsx --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before /gsd-verify-work

## Wave 0 Gaps

- [ ] `src/__tests__/drag-reorder.test.tsx` -- covers CARD-04c, CARD-04d (DragDropProvider test wrapper needed)
- [ ] Update `src/__tests__/channel-cards.test.tsx` -- remove move button assertions, add drag handle assertions, update ChannelCard render helper
