# Roadmap: ChurchAudioStream

## Overview

This roadmap covers the full project lifecycle. v1.0 (Phases 1-10) delivered the working audio streaming app with admin panel, listener PWA, WebRTC pipeline, and real-time monitoring. v1.1 (Phases 11-14) elevates the admin panel from hand-rolled CSS to a polished component-library-driven UI using shadcn/ui + Tailwind CSS v4 — adding visual hierarchy, real-time feedback, and mixing-console feel.

## Milestones

- [x] **v1.0 MVP** - Phases 1-10 (shipped)
- [ ] **v1.1 Admin Panel Improvements** - Phases 11-14 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>v1.0 MVP (Phases 1-10) - SHIPPED</summary>

- [x] **Phase 1: Project Foundation & Configuration** - Tauri 2.x app shell with Node.js sidecar, Express web server, and JSON config persistence
- [x] **Phase 2: Audio Capture Pipeline** - GStreamer-based capture from AES67 multicast and local audio devices with stream discovery
- [x] **Phase 3: Audio Processing** - Per-channel normalization, Speech/Music mode, and Opus encoding via GStreamer
- [x] **Phase 4: WebRTC Streaming Core** - mediasoup SFU distributing Opus audio to browser listeners with sub-100ms latency
- [x] **Phase 5: Listener Web UI** - Mobile-first PWA with channel selection, volume control, and QR code access
- [x] **Phase 6: Admin Dashboard** - Channel configuration, real-time VU meters, listener counts, and server status monitoring
- [x] **Phase 7: Listener UX & Audio Latency** - i18n (en/es/lv), light/dark theme, audio latency fix (4s to sub-150ms)
- [x] **Phase 8: Reliability & Self-Healing** - Auto-reconnection, pipeline crash recovery, worker rotation, health indicators
- [x] **Phase 9: Monitoring & Admin Polish** - Latency dashboard, stream health, engagement graphs, admin theming, settings export/import
- [x] **Phase 10: Distribution & Deployment** - Cross-platform installers, portable builds, auto-start, and update notifications

</details>

### v1.1 Admin Panel Improvements

- [ ] **Phase 11: Foundation** - Full Tailwind CSS v4 + shadcn/ui migration: all components converted, App.css deleted, OKLCH tokens, tests
- [ ] **Phase 12: Sidebar & Header** - Navigation with Lucide icons, active indicators, breadcrumb, connection status, listener badge
- [ ] **Phase 13: Channel Cards** - Card components with status badges, inline VU previews, tooltips, and scroll handling
- [ ] **Phase 14: Drag-to-Reorder** - dnd-kit drag-and-drop channel reordering with visual feedback and persistence

## Phase Details

### Phase 11: Foundation
**Goal**: Admin app fully migrated from hand-rolled CSS to Tailwind CSS v4 + shadcn/ui design system. All components converted. App.css deleted. OKLCH tokens. Tests validate migration.
**Depends on**: Phase 10 (v1.0 complete)
**Requirements**: FOUN-01, FOUN-02, FOUN-03, FOUN-04, FOUN-05, TYPO-01
**Success Criteria** (what must be TRUE):
  1. Admin app builds and renders without visual regressions — existing UI looks identical to before migration
  2. A new test component using Tailwind utility classes (e.g. `bg-primary text-primary-foreground rounded-md p-4`) renders correctly
  3. shadcn cn() utility resolves classes and `npx shadcn add` installs components without errors
  4. Dark theme OKLCH variables produce correct colors matching existing palette (no color drift)
  5. Font rendering uses system stack with no network requests for fonts
**Plans:** 5 plans
Plans:
**Wave 1**
- [ ] 11-01-PLAN.md — Install deps, configure Vite/TS/Vitest, create index.css with OKLCH tokens, cn() utility + tests

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 11-02-PLAN.md — Convert layout + small components (DashboardShell, Sidebar, ConnectionStatus, App.tsx, ListenerCountBadge, VuMeterBank, QrCodeDisplay)
- [ ] 11-03-PLAN.md — Convert channel components (ChannelList, ChannelConfigPanel, ChannelCreateDialog, ProcessingControls, SourceSelector)
- [ ] 11-04-PLAN.md — Convert settings/monitoring + CSS module components (ServerStatus, SettingsPanel + DesignTokensSection, LogViewer, CheckForUpdatesButton, UpdateToast)

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 11-05-PLAN.md — Delete legacy CSS, VuMeter container, design token tests, build validation, visual checkpoint
**UI hint**: yes

### Phase 12: Sidebar & Header
**Goal**: Navigation has professional polish — icons, active indicators, section grouping, breadcrumb trail, and live status display in header
**Depends on**: Phase 11
**Requirements**: SIDE-01, SIDE-02, SIDE-03, HEAD-01, HEAD-02, HEAD-03, HEAD-04, TYPO-02
**Success Criteria** (what must be TRUE):
  1. Each sidebar nav item shows a recognizable Lucide icon next to its label
  2. Currently active nav item has a colored vertical indicator bar visible at a glance (not just text color)
  3. Nav items grouped into logical sections with visual separators between groups
  4. Header displays breadcrumb trail reflecting current navigation path and section headings are visually prominent
  5. Connection status dot animates (pulse when connected), listener count badge visible in header, and sidebar toggle button works
**Plans**: TBD
**UI hint**: yes

### Phase 13: Channel Cards
**Goal**: Channel list uses card-based layout with real-time status feedback, inline VU previews, accessible action controls, and proper overflow handling
**Depends on**: Phase 12
**Requirements**: CARD-01, CARD-02, CARD-03, CARD-05, TYPO-03
**Success Criteria** (what must be TRUE):
  1. Each channel displays as a shadcn Card with consistent padding, border radius, and subtle elevation
  2. Channel streaming state shown as colored Badge — green for streaming, muted for stopped, red for error
  3. Hovering action buttons shows tooltip text describing the action (accessibility)
  4. Each card shows inline VU meter preview reflecting live audio level
  5. Channel list scrolls smoothly via ScrollArea component when content exceeds viewport
**Plans**: TBD
**UI hint**: yes

### Phase 14: Drag-to-Reorder
**Goal**: Admin can reorder channels by dragging cards, replacing arrow-button navigation with intuitive drag-and-drop
**Depends on**: Phase 13
**Requirements**: CARD-04
**Success Criteria** (what must be TRUE):
  1. User can grab a channel card and drag it to a new position in the list
  2. Visual feedback shows drop target location during drag (placeholder or highlight)
  3. New order persists after drop — saved to config, survives app restart
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 11 → 12 → 13 → 14

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Project Foundation | v1.0 | 8/8 | Complete | 2026-02-07 |
| 2. Audio Capture | v1.0 | 9/9 | Complete | 2026-02-07 |
| 3. Audio Processing | v1.0 | 3/3 | Complete | 2026-02-07 |
| 4. WebRTC Streaming | v1.0 | 9/9 | Complete | 2026-02-10 |
| 5. Listener Web UI | v1.0 | 5/5 | Complete | 2026-02-10 |
| 6. Admin Dashboard | v1.0 | 4/4 | Complete | 2026-02-10 |
| 7. Listener UX & Latency | v1.0 | 5/5 | Complete | 2026-05-05 |
| 8. Reliability | v1.0 | 5/5 | Complete | 2026-05-05 |
| 9. Monitoring & Polish | v1.0 | 4/4 | Complete | 2026-05-05 |
| 10. Distribution | v1.0 | 3/3 | Complete | 2026-05-05 |
| 11. Foundation | v1.1 | 1/5 | In progress | - |
| 12. Sidebar & Header | v1.1 | 0/? | Not started | - |
| 13. Channel Cards | v1.1 | 0/? | Not started | - |
| 14. Drag-to-Reorder | v1.1 | 0/? | Not started | - |
