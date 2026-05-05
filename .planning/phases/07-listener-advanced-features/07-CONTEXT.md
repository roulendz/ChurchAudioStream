# Phase 7: Listener UX & Audio Latency - Context

**Gathered:** 2026-05-05
**Status:** Complete
**Mode:** Auto-generated + user-directed mid-UAT revision

<domain>
## Phase Boundary

Listeners get i18n (en/es/lv), light/dark theme, and sub-150ms audio latency (fixed from 4 seconds).

</domain>

<decisions>
## Implementation Decisions

### User-Directed Changes (mid-UAT)
- **REMOVED** STRM-03 (mix balance): moved to backlog — not needed, doesn't work
- **REMOVED** STRM-04 (processing toggle in PWA): bad design — one listener toggling AGC affects ALL listeners. Belongs in admin panel only.
- **ADDED** Audio latency fixes: bounded GStreamer queues, jitterBufferTarget, udpsink sync removal
- **ADDED** Jitter buffer metrics in StatsPanel for latency measurement
- **KEPT** i18n (en/es/lv), theme (light/dark/system), settings gear with ThemeToggle + LanguagePicker

</decisions>

<code_context>
## Key Changes

- `sidecar/src/audio/pipeline/pipeline-builder.ts`: bounded tee queues (50ms leaky), udpsink sync=false
- `listener/src/hooks/useMediasoup.ts`: setLowLatencyJitterBuffer() after consume
- `listener/src/lib/connection-stats.ts`: jitterBufferDelayMs + jitterBufferTargetMs metrics
- `listener/src/components/StatsPanel.tsx`: jitter buffer display with >100ms warning

</code_context>

<deferred>
## Deferred Ideas

- STRM-03 (mix balance) → backlog
- STRM-04 (processing toggle) → admin-only in Phase 9

</deferred>
