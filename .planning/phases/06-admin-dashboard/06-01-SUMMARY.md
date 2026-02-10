---
phase: 06-admin-dashboard
plan: 01
subsystem: admin-ui
tags: [dashboard, sidebar, navigation, channel-reorder, channel-visibility, level-mapping, css-grid]
requires:
  - phase-05 (listener web UI complete)
provides:
  - Dashboard shell layout with sidebar navigation
  - Channel visibility and sortOrder fields
  - Channel reorder WebSocket API
  - Pipeline-to-channel level mapping
affects:
  - 06-02 (channel config panel plugs into channels section)
  - 06-03 (VU meters use channelId from level broadcast)
  - 06-04 (overview panel plugs into overview section)
tech-stack:
  added:
    - "@types/node (devDependency, root package)"
  patterns:
    - CSS grid dashboard layout (sidebar + content)
    - State-driven section navigation (no router)
    - Pipeline-to-channel reverse map for level enrichment
key-files:
  created:
    - src/components/layout/Sidebar.tsx
    - src/components/layout/DashboardShell.tsx
  modified:
    - sidecar/src/audio/channels/channel-types.ts
    - sidecar/src/config/schema.ts
    - sidecar/src/audio/channels/channel-manager.ts
    - sidecar/src/audio/audio-subsystem.ts
    - sidecar/src/ws/handler.ts
    - sidecar/src/ws/types.ts
    - src/App.tsx
    - src/App.css
    - package.json
    - package-lock.json
key-decisions:
  - "State-driven navigation via useState<DashboardSection> (no react-router)"
  - "CSS grid layout: 220px sidebar + 1fr content, sticky header spanning full width"
  - "Responsive mobile layout converts sidebar to horizontal tab bar"
  - "sortOrder field defaults to channel index on creation; reorder sets new indices"
  - "getPipelineToChannelMap() built on each level flush (low overhead, not per-frame)"
duration: 7 minutes
completed: 2026-02-10
---

# Phase 06 Plan 01: Dashboard Shell and API Gaps Summary

**One-liner:** CSS grid dashboard shell with sidebar navigation + server-side channel reorder/visibility/level-channelId APIs

## Performance

- Duration: 7 minutes
- Start: 2026-02-10T11:51:55Z
- End: 2026-02-10T11:58:35Z
- Tasks: 2/2
- Files created: 2
- Files modified: 10

## Accomplishments

### Task 1: Server-Side API Gaps
Fixed three gaps that blocked subsequent UI work:
1. **Channel visibility**: Added `visible: boolean` field to AppChannel and ChannelSchema with default `true`. Extended ChannelUpdatableFields and channel:update handler to accept visibility toggles.
2. **Channel reorder**: Added `sortOrder: number` field, `reorderChannels()` method with full validation (all IDs exist, array length matches), persistence, and channel-updated events. Added `channel:reorder` WebSocket handler returning reordered channels:list.
3. **Level channelId mapping**: Added `getPipelineToChannelMap()` reverse lookup on ChannelManager, exposed through AudioSubsystem. Level broadcast flush enriches each entry with `channelId` from the map. getAllChannels() now returns channels sorted by sortOrder.

### Task 2: Dashboard Shell Layout
Replaced the flat single-page admin layout with a full-width CSS grid dashboard:
- Created `Sidebar` component with 4 navigation items (Overview, Channels, Monitoring, Settings)
- Created `DashboardShell` wrapper with grid layout (220px sidebar + 1fr content, sticky header)
- Updated `App.tsx` with `useState<DashboardSection>` for state-driven navigation
- Settings section preserves existing SettingsPanel + LogViewer unchanged
- Other sections show placeholder content for Plans 02-04
- Responsive mobile layout converts sidebar to horizontal scrollable tab bar

## Task Commits

| # | Hash | Type | Description |
|---|------|------|-------------|
| 1 | 20c6ce4 | feat | fix server-side API gaps for channel reorder, visibility, level channelId |
| 2 | 46a612e | feat | build dashboard shell layout with sidebar navigation |

## Files Created

| File | Purpose |
|------|---------|
| src/components/layout/Sidebar.tsx | Navigation sidebar with DashboardSection type and 4 nav items |
| src/components/layout/DashboardShell.tsx | CSS grid layout wrapper (header + sidebar + content) |

## Files Modified

| File | Changes |
|------|---------|
| sidecar/src/audio/channels/channel-types.ts | Added visible and sortOrder fields to AppChannel interface |
| sidecar/src/config/schema.ts | Added visible and sortOrder to ChannelSchema with Zod defaults |
| sidecar/src/audio/channels/channel-manager.ts | Added reorderChannels(), getPipelineToChannelMap(), visible in CRUD, sortOrder in create/load/persist, sorted getAllChannels() |
| sidecar/src/audio/audio-subsystem.ts | Added reorderChannels() and getPipelineToChannelMap() passthroughs |
| sidecar/src/ws/handler.ts | Added channel:reorder handler, visible in channel:update, channelId enrichment in level broadcast |
| sidecar/src/ws/types.ts | Added ChannelReorderPayload, extended ChannelUpdatePayload with visible |
| src/App.tsx | Replaced flat layout with DashboardShell, state-driven section navigation |
| src/App.css | Replaced app-shell flex layout with dashboard-shell CSS grid, added sidebar styles, responsive mobile |
| package.json | Added @types/node devDependency |
| package-lock.json | Lock file updated for @types/node |

## Decisions Made

1. **State-driven navigation**: Used `useState<DashboardSection>` instead of react-router. The admin dashboard is a single-page app with 4 sections -- routing adds unnecessary complexity for internal state.
2. **CSS grid layout**: 220px sidebar + 1fr content area with sticky header spanning full width. Clean separation of navigation and content.
3. **Responsive mobile layout**: On screens <640px, sidebar converts to horizontal scrollable tab bar below the header. Border indicators switch from left to bottom.
4. **sortOrder defaults**: New channels get `sortOrder = this.channels.size` (appends at end). Reorder sets new indices from the provided array.
5. **Level enrichment timing**: `getPipelineToChannelMap()` is called once per level flush interval (100ms), not per-frame. Map iteration is O(pipelines) which is negligible.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing @types/node devDependency**
- **Found during:** Task 2 verification (npm run build)
- **Issue:** tsconfig.node.json references `"types": ["node"]` but @types/node was not installed at the root package level, causing TypeScript build to fail
- **Fix:** Installed @types/node as devDependency
- **Files modified:** package.json, package-lock.json

## Issues

None.

## Next Phase Readiness

Plan 06-01 provides the navigation skeleton and server APIs that Plans 02-04 plug into:
- **Plan 02** (Channel Config): Uses channels section, channel:reorder API, visible field
- **Plan 03** (VU Meters): Uses monitoring section, channelId in level broadcast data
- **Plan 04** (Overview): Uses overview section placeholder
- All server-side APIs compile and are ready for UI consumption

## Self-Check: PASSED
