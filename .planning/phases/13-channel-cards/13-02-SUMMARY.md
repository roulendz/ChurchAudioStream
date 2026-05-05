---
phase: 13-channel-cards
plan: 02
subsystem: admin-ui
tags: [shadcn, channel-list, scroll-area, refactor, tests, vu-meter]
dependency_graph:
  requires: [ChannelCard, ChannelStatusBadge, ScrollArea, Card]
  provides: [ChannelList-refactored, getLevels-wiring, channel-cards-tests]
  affects: [src/App.tsx, src/components/channels/ChannelList.tsx]
tech_stack:
  added: []
  patterns: [ScrollArea-list-wrapper, prop-threading-getLevels, data-slot-test-assertions]
key_files:
  created:
    - src/__tests__/channel-cards.test.tsx
  modified:
    - src/components/channels/ChannelList.tsx
    - src/App.tsx
decisions:
  - "Button data-variant assertion instead of data-slot -- TooltipTrigger asChild overrides data-slot on Button children"
  - "CardTitle data-slot selector for name assertion -- VuMeter also renders channel name causing duplicate text"
metrics:
  duration: 4m 0s
  completed: 2026-05-05T20:01:08Z
  tasks_completed: 3
  tasks_total: 3
  files_created: 1
  files_modified: 2
---

# Phase 13 Plan 02: ChannelList Refactor + Wiring + Tests Summary

ChannelList gutted from 172-line monolith to 75-line thin wrapper: ScrollArea + ChannelCard map + shadcn Button. App.tsx threads audioLevels.getLevels. 15-test suite covers all 5 phase requirements.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Refactor ChannelList to ScrollArea + ChannelCard delegation | 5e3c284 | src/components/channels/ChannelList.tsx |
| 2 | Wire App.tsx to pass getLevels to ChannelList | 9ecbdc8 | src/App.tsx |
| 3 | Create channel-cards test suite | 7e1d38b | src/__tests__/channel-cards.test.tsx |

## Implementation Details

### Task 1: ChannelList refactor
- Deleted: statusBadgeClass function, isRunning helper, entire `<ul>/<li>` rendering block (93 lines removed)
- Added: getLevels prop to ChannelListProps, ScrollArea wrapper with calc-based height
- Upgraded: raw `<button>` to shadcn Button + Plus icon for New Channel
- Kept: handleMoveUp/handleMoveDown reorder logic passed as callbacks to ChannelCard
- Empty state preserved with ternary branching (not `&&`)

### Task 2: App.tsx wiring
- Single line addition: `getLevels={audioLevels.getLevels}` on ChannelList
- Mirrors existing VuMeterBank pattern at line 133
- `npm run build` exits 0 (TypeScript compiles clean)

### Task 3: Test suite
- 15 tests covering CARD-01 (4), CARD-02 (3), CARD-03 (3), CARD-05 (2), TYPO-03 (2), CARD-01 metadata (1)
- Async dynamic import pattern matching sidebar.test.tsx/header.test.tsx conventions
- TooltipProvider wrapper for all renders using Tooltip components
- data-slot assertions for card, card-header, card-content, badge, tooltip-trigger
- className assertions for status badge OKLCH color tokens

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed duplicate text query for channel name**
- **Found during:** Task 3
- **Issue:** `screen.getByText("English")` threw "found multiple elements" because VuMeter also renders channel name as label
- **Fix:** Changed to `container.querySelector('[data-slot="card-title"]')` + textContent assertion
- **Files modified:** src/__tests__/channel-cards.test.tsx
- **Commit:** 7e1d38b

**2. [Rule 1 - Bug] Fixed data-slot override on Button inside TooltipTrigger**
- **Found during:** Task 3
- **Issue:** `TooltipTrigger asChild` overrides `data-slot="button"` with `data-slot="tooltip-trigger"` on child Button elements, making `[data-slot="button"]` selector find 0 elements
- **Fix:** Changed to `button[data-variant]` selector (Button always sets data-variant attribute)
- **Files modified:** src/__tests__/channel-cards.test.tsx
- **Commit:** 7e1d38b

## Verification

- `npm run build` exits 0 (TypeScript clean)
- `npx vitest run` -- 148 tests pass, 12/13 test files pass (1 pre-existing failure in scripts/generate-update-manifest.test.mjs)
- ChannelList contains no `<li>` or `<ul>` elements
- ChannelList uses ScrollArea wrapper
- App.tsx passes `getLevels={audioLevels.getLevels}` to ChannelList

## Known Stubs

None -- all data paths wired through getLevels prop to live audio level source.

## Threat Flags

None -- purely presentational refactoring, no new trust boundaries.

## Self-Check: PASSED

- All 3 files exist at expected paths (ChannelList.tsx, App.tsx, channel-cards.test.tsx)
- All 3 task commits found in git log (5e3c284, 9ecbdc8, 7e1d38b)
