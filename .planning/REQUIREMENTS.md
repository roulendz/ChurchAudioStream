# Requirements: ChurchAudioStream

**Defined:** 2026-05-05
**Core Value:** Enable multilingual church members and hearing-impaired listeners to hear sermons in their language through their own phones, using the church's existing audio infrastructure — with near-zero latency and zero friction.

## v1.1 Requirements

Requirements for Admin Panel Improvements milestone. Each maps to roadmap phases.

### Foundation

- [ ] **FOUN-01**: Admin app builds with Tailwind CSS v4 via @tailwindcss/vite plugin (no PostCSS)
- [ ] **FOUN-02**: shadcn/ui CLI configured with components.json, cn() utility, and @/ path aliases
- [ ] **FOUN-03**: Existing App.css wrapped in @layer legacy to coexist with Tailwind utilities
- [ ] **FOUN-04**: Dark theme tokens mapped from existing palette to shadcn OKLCH variables
- [ ] **FOUN-05**: System font stack configured (no external CDN fonts)

### Sidebar

- [ ] **SIDE-01**: Each nav item displays a Lucide SVG icon alongside its label
- [ ] **SIDE-02**: Active nav item has a visible indicator bar (not just text color change)
- [ ] **SIDE-03**: Nav items grouped into logical sections with visual separators

### Channel Cards

- [ ] **CARD-01**: Each channel rendered as a shadcn Card component with consistent padding and elevation
- [ ] **CARD-02**: Channel status shown as a colored Badge (streaming=green, stopped=muted, error=red)
- [ ] **CARD-03**: Action buttons wrapped in Tooltips for accessibility
- [ ] **CARD-04**: Channel list supports drag-to-reorder with visual feedback (replaces arrow buttons)
- [ ] **CARD-05**: Each channel card shows an inline VU meter preview

### Header

- [ ] **HEAD-01**: Header displays a breadcrumb showing current navigation path
- [ ] **HEAD-02**: Connection status shown as an animated Badge with colored dot indicator
- [ ] **HEAD-03**: Listener count badge prominently visible in header area
- [ ] **HEAD-04**: Sidebar toggle trigger button in header

### Typography & Spacing

- [ ] **TYPO-01**: Consistent design token usage across all admin components (colors, radius, spacing)
- [ ] **TYPO-02**: Section headings visually prominent with proper hierarchy
- [ ] **TYPO-03**: Channel list overflow handled by ScrollArea component

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Sidebar Advanced

- **SIDE-04**: Collapsible sidebar mode (icon-only rail with SidebarProvider)
- **SIDE-05**: Sidebar badges showing listener counts per nav item
- **SIDE-06**: Sidebar collapsed state persisted to config.json

### Additional Polish

- **TYPO-04**: Full migration — delete App.css entirely, enable Tailwind Preflight
- **CARD-06**: Channel card expand/collapse with Collapsible component
- **HEAD-05**: Dark/light mode toggle (currently dark-only)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full App.css deletion | Risk of regressions; deferred to v2 when all components migrated |
| React Router | Desktop app with no URL bar; state-driven navigation is simpler |
| Storybook | <20 components; visual testing not justified |
| Mobile-responsive admin | Desktop-only Tauri app; no mobile breakpoint needed |
| Form library (react-hook-form) | Few simple fields; existing controlled inputs sufficient |
| framer-motion | CSS transitions + dnd-kit built-in animations sufficient |
| External fonts (Inter/Geist) | Desktop app, no CDN; system font stack works offline |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUN-01 | Phase 11 | Pending |
| FOUN-02 | Phase 11 | Pending |
| FOUN-03 | Phase 11 | Pending |
| FOUN-04 | Phase 11 | Pending |
| FOUN-05 | Phase 11 | Pending |
| SIDE-01 | Phase 12 | Pending |
| SIDE-02 | Phase 12 | Pending |
| SIDE-03 | Phase 12 | Pending |
| CARD-01 | Phase 13 | Pending |
| CARD-02 | Phase 13 | Pending |
| CARD-03 | Phase 13 | Pending |
| CARD-04 | Phase 14 | Pending |
| CARD-05 | Phase 13 | Pending |
| HEAD-01 | Phase 12 | Pending |
| HEAD-02 | Phase 12 | Pending |
| HEAD-03 | Phase 12 | Pending |
| HEAD-04 | Phase 12 | Pending |
| TYPO-01 | Phase 11 | Pending |
| TYPO-02 | Phase 12 | Pending |
| TYPO-03 | Phase 13 | Pending |

**Coverage:**
- v1.1 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-05*
*Last updated: 2026-05-05 after initial definition*
