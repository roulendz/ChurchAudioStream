---
phase: 06-admin-dashboard
plan: 02
subsystem: admin-ui
tags: [react, channels, websocket, crud, source-assignment, hooks]
depends_on:
  requires: ["06-01"]
  provides: ["channel-crud-ui", "source-assignment-ui", "useChannels-hook", "useSources-hook"]
  affects: ["06-03", "06-04"]
tech-stack:
  added: []
  patterns: ["custom-hooks-per-domain", "local-type-mirroring", "server-broadcast-driven-ui"]
key-files:
  created:
    - src/hooks/useChannels.ts
    - src/hooks/useSources.ts
    - src/components/channels/ChannelList.tsx
    - src/components/channels/ChannelCreateDialog.tsx
    - src/components/channels/ChannelConfigPanel.tsx
    - src/components/channels/SourceSelector.tsx
  modified:
    - src/App.tsx
    - src/App.css
decisions:
  - "Local AdminChannel/DiscoveredSource types mirror server interfaces (no cross-project import)"
  - "No optimistic updates: UI updates from server broadcast, ensuring consistency"
  - "Channel status derived from channel:state action field (started->starting, stopped->stopped)"
  - "Source selector groups by type (AES67/Local) with channel number toggle buttons"
  - "Reorder via move-up/move-down buttons, not drag-and-drop (simpler, accessible)"
metrics:
  duration: 7 minutes
  completed: 2026-02-10
---

# Phase 6 Plan 2: Channel Configuration UI Summary

**One-liner:** Channel CRUD UI with source assignment, reorder, visibility controls via WebSocket hooks

## What Was Built

### useChannels Hook (`src/hooks/useChannels.ts`)
- Subscribes to `channels:list`, `channel:created`, `channel:updated`, `channel:removed`, `channel:state`
- Provides 8 action functions: create, update, remove, start, stop, reorder, addSource, removeSource
- Local `AdminChannel` interface mirrors server `AppChannel` (id, name, sources, outputFormat, autoStart, visible, sortOrder, status, processing, createdAt)
- All actions use `useCallback` for stable references
- Channels auto-sorted by `sortOrder` on every update

### useSources Hook (`src/hooks/useSources.ts`)
- Subscribes to `sources:list` and `sources:changed`
- Re-requests full list on `sources:changed` notification
- Local `DiscoveredSource` union type (AES67Source | LocalDeviceSource) mirrors server types

### ChannelList Component
- Channel cards showing: name, color-coded status badge, hidden indicator, output format, source count
- Move up/down buttons for reorder (sends `channel:reorder` with reordered ID array)
- Start/Stop toggle per channel
- Configure button opens ChannelConfigPanel
- Remove button with inline "X" icon

### ChannelCreateDialog Component
- Inline form (not modal): name input with placeholder, output format select (mono/stereo)
- Create/Cancel buttons, submit disabled when name is empty

### ChannelConfigPanel Component
- Full property editing: name, output format, auto-start, visible toggle
- Save Changes button only appears when properties differ from server state
- Syncs local state from server broadcast (useEffect on channel prop changes)
- Embedded SourceSelector for input source management
- Back button to return to channel list

### SourceSelector Component
- Displays assigned sources with name lookup, channel numbers, remove button
- Add source dropdown grouped by type (AES67/Dante, Local Devices)
- Channel number toggle buttons (1..N based on source channelCount)
- Add Source button disabled until source and at least one channel selected

### App.tsx Integration
- useChannels and useSources hooks wired with sendMessage/subscribe from useServerStatus
- selectedChannelId state drives list vs config panel view
- showCreateDialog state toggles create form
- Channels section replaces placeholder with conditional rendering

### App.css Styles
- Channel list/card layout with hover states
- Status badge colors: streaming=green, starting=yellow, error=red, stopped=gray
- Hidden badge, meta info row
- Shared button styles (btn-primary, btn-secondary, btn-icon, btn-start, btn-stop, btn-back)
- Create dialog, config panel, source selector, channel picker styles

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create useChannels and useSources hooks | 8303eb5 | src/hooks/useChannels.ts, src/hooks/useSources.ts |
| 2 | Build channel UI components and wire into dashboard | d370040 | src/components/channels/*.tsx, src/App.tsx, src/App.css |

## Decisions Made

1. **Local type mirroring**: AdminChannel and DiscoveredSource defined locally in hook files, not imported from sidecar. Keeps frontend independent of backend build.
2. **No optimistic updates**: All state changes flow through server broadcasts. Simpler, avoids inconsistency between optimistic state and server rejection.
3. **Status from action**: `channel:state` broadcasts include `action` field ("started"/"stopped") which maps to ChannelStatus ("starting"/"stopped"). Server also broadcasts full `channel:updated` when status actually changes.
4. **Grouped source selector**: Sources grouped by type in dropdown optgroups for clarity when both AES67 and local devices are present.
5. **Button-based reorder**: Move up/down buttons instead of drag-and-drop. Simpler implementation, fully accessible, works identically on mobile.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- TypeScript: `npx tsc --noEmit` passes with zero errors
- Vite build: `npm run build` succeeds, 102 modules transformed
- All 4 component files exist in `src/components/channels/`
- Both hooks export their named functions

## Next Phase Readiness

No blockers. Channel UI is ready for:
- Plan 06-03 to add processing controls to ChannelConfigPanel
- Plan 06-04 to add overview dashboard with channel status

## Self-Check: PASSED
