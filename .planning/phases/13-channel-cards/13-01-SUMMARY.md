---
phase: 13-channel-cards
plan: 01
subsystem: admin-ui
tags: [shadcn, card, scroll-area, channel-status, vu-meter, component]
dependency_graph:
  requires: []
  provides: [Card, CardHeader, CardTitle, CardAction, CardContent, CardFooter, ScrollArea, ScrollBar, ChannelStatusBadge, ChannelCard, ChannelCardProps]
  affects: [src/components/channels/ChannelList.tsx]
tech_stack:
  added: [shadcn-card, shadcn-scroll-area]
  patterns: [Record-status-map, useCallback-level-binding, tooltipped-actions]
key_files:
  created:
    - src/components/ui/card.tsx
    - src/components/ui/scroll-area.tsx
    - src/components/channels/ChannelStatusBadge.tsx
    - src/components/channels/ChannelCard.tsx
  modified: []
decisions:
  - "CardAction exported by shadcn card.tsx -- used directly (no fallback div needed)"
  - "VuMeter always rendered regardless of channel status (negligible rAF cost per RESEARCH.md)"
metrics:
  duration: 4m 33s
  completed: 2026-05-05T19:52:07Z
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 0
---

# Phase 13 Plan 01: Card & Status Badge Primitives Summary

shadcn Card + ScrollArea installed via CLI; ChannelStatusBadge maps 5 statuses to OKLCH-token colored badges; ChannelCard composes Card + StatusBadge + VuMeter(24x56) + 6 tooltipped action buttons.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install shadcn Card and ScrollArea | 06ccd52 | src/components/ui/card.tsx, src/components/ui/scroll-area.tsx |
| 2 | Create ChannelStatusBadge | 86e4994 | src/components/channels/ChannelStatusBadge.tsx |
| 3 | Create ChannelCard | c0d90ef | src/components/channels/ChannelCard.tsx |

## Implementation Details

### Task 1: shadcn Card + ScrollArea
- Card exports: Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter
- ScrollArea exports: ScrollArea, ScrollBar
- Both use data-slot attributes and radix-ui unified package

### Task 2: ChannelStatusBadge
- Record<ChannelStatus, {label, className}> map following ConnectionStatus.tsx pattern
- 5 statuses: streaming (green), starting (yellow), stopped (muted), error (red), crashed (red)
- Badge variant="outline" with OKLCH design token classes (bg-success/20, etc.)

### Task 3: ChannelCard
- Extracts per-channel rendering from ChannelList <li> into Card component
- CardHeader: channel name + EyeOff hidden indicator + CardAction with ChannelStatusBadge
- CardContent: VuMeter(24x56) + metadata + 6 tooltipped action buttons
- useCallback binds getLevels to channel.id (same pattern as VuMeterBank)
- Move up/down: variant="outline", disabled at list boundaries
- Start/stop: conditional Play/Square icon with conditional tooltip text
- Configure + Remove: ghost buttons, Trash2 has text-destructive

## Deviations from Plan

None -- plan executed exactly as written.

## Verification

- `npm run build` exits 0 (TypeScript compiles clean, no unused imports)
- All 4 files exist at specified paths
- All exports verified via automated node checks

## Threat Flags

None -- purely presentational UI components, no new trust boundaries.

## Self-Check: PASSED

- All 4 created files exist at expected paths
- All 3 task commits found in git log (06ccd52, 86e4994, c0d90ef)
