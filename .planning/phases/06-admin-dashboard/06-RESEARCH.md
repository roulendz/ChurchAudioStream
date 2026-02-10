# Phase 6: Admin Dashboard - Research

**Researched:** 2026-02-10
**Domain:** React desktop admin UI (sidebar navigation, channel CRUD, real-time VU meters, server monitoring, QR codes)
**Confidence:** HIGH

## Summary

Phase 6 replaces the Phase 1 admin UI shell (header + SettingsPanel + LogViewer) with a full dashboard featuring sidebar navigation, channel CRUD, real-time VU meters, listener counts, server status, and QR code display. The admin GUI is architecturally just another WebSocket client connecting to the Node.js sidecar at `ws://127.0.0.1:7778`.

The codebase already has a mature WebSocket infrastructure (`useWebSocket` hook with reconnection, `useServerStatus` hook with config management, subscription-based message routing), a complete server-side API (channel CRUD, level broadcasting at 100ms, resource monitoring, streaming status), and established CSS patterns (dark theme with CSS custom properties, no external CSS framework). The admin UI is a Vite + React 19 app rendered inside Tauri's webview.

The primary work is purely frontend: restructuring the React component tree from a single-page settings panel to a multi-section dashboard with sidebar navigation, building new UI components (VU meters, channel config forms, monitoring panels), and wiring them to the existing WebSocket subscription API.

**Primary recommendation:** Build a pure CSS sidebar + content layout with React state-driven navigation (no router library needed). Use HTML5 Canvas for VU meters with requestAnimationFrame for smooth rendering. Reuse the existing `qrcode` npm package (already in listener dependencies) for QR generation in the admin UI.

## Standard Stack

The established libraries/tools for this domain:

### Core (Already in Project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.2.0 | UI framework | Already the project standard |
| react-dom | ^19.2.0 | DOM rendering | React companion |
| Vite | ^7.2.4 | Build tooling | Already configured for Tauri |
| TypeScript | ~5.9.3 | Type safety | Already project-wide |

### Supporting (To Add to Admin)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| qrcode | ^1.5.4 | QR code generation | Admin QR display (same lib as listener) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure CSS sidebar | react-sidebar, MUI drawer | Extra dependency for trivial layout; admin is desktop-only so no responsive sidebar needed |
| Canvas VU meters | SVG/DOM VU meters | Canvas with rAF gives 60fps without React re-renders; SVG works but updates 10x/sec cause DOM thrash |
| React state navigation | react-router | Overkill -- admin has ~4 sections, no URL routing needed (Tauri webview, no browser address bar) |
| Plain CSS | Tailwind CSS | Adding Tailwind to a project already using CSS custom properties would create inconsistency |
| qrcode (npm) | qrcode.react | qrcode is already a project dependency in listener; toDataURL works server-side and client-side |

**Installation (admin package.json only):**
```bash
npm install qrcode
npm install -D @types/qrcode
```

Note: `qrcode` is already in `listener/package.json`. It needs to be added to the root `package.json` (admin Tauri app). Alternatively, since both apps ship from the same monorepo, consider whether the admin and listener share dependencies. Currently they have separate `package.json` files.

## Architecture Patterns

### Current Admin UI Structure (Phase 1 Shell)
```
src/
  App.tsx              # Single-page layout: header + SettingsPanel + LogViewer
  App.css              # All styles in one file, dark theme CSS vars
  main.tsx             # React entry point
  hooks/
    useWebSocket.ts    # WebSocket with reconnection, subscription pattern
    useServerStatus.ts # Config management, admin identification
  components/
    ConnectionStatus.tsx
    SettingsPanel.tsx
    LogViewer.tsx
```

### Recommended Phase 6 Structure
```
src/
  App.tsx                    # Shell: sidebar + content area + connection status
  App.css                    # Global layout, CSS custom properties (extended)
  main.tsx                   # React entry point (unchanged)
  hooks/
    useWebSocket.ts          # Unchanged -- core infrastructure
    useServerStatus.ts       # Extended: expose sendMessage + subscribe to children
    useChannels.ts           # NEW: channel list state, CRUD operations
    useAudioLevels.ts        # NEW: subscribe to levels:update, store in ref (not state!)
    useListenerCounts.ts     # NEW: subscribe to streaming:listener-count
    useResourceStats.ts      # NEW: subscribe to stats:update, server:resource-update
    useSources.ts            # NEW: subscribe to sources:list, sources:changed
  components/
    layout/
      Sidebar.tsx            # Navigation sidebar with section links
      DashboardShell.tsx     # Sidebar + content area wrapper
    channels/
      ChannelList.tsx        # Channel cards with status, VU preview, actions
      ChannelCreateDialog.tsx # Create channel form (name, output format)
      ChannelConfigPanel.tsx  # Full channel config: name, source, visibility, ordering
      SourceSelector.tsx      # Source dropdown with discovered sources
      ProcessingControls.tsx  # AGC target, Speech/Music toggle per channel
    monitoring/
      VuMeter.tsx            # Canvas-based VU meter (single channel)
      VuMeterBank.tsx        # Grid of VU meters for all active channels
      ListenerCountBadge.tsx # Per-channel listener count display
      ServerStatus.tsx       # CPU, memory, uptime, connection counts
    settings/
      SettingsPanel.tsx      # Existing settings (port, interface, domain, mDNS, hosts)
      QrCodeDisplay.tsx      # QR code for listener URL with copy button
    shared/
      ConnectionStatus.tsx   # Existing component (moved)
      LogViewer.tsx          # Existing component (moved to sidebar-accessible section)
```

### Pattern 1: Sidebar Navigation via React State

**What:** Simple state-driven navigation using a `currentSection` state variable.
**When to use:** Desktop admin app with 4-5 sections, no URL routing needed.
**Why:** The admin runs inside Tauri's webview -- there is no browser address bar, no need for shareable URLs, no back/forward history. React Router would add complexity for zero benefit.

```typescript
type DashboardSection = "overview" | "channels" | "monitoring" | "settings";

function App() {
  const [currentSection, setCurrentSection] = useState<DashboardSection>("overview");
  const { connectionStatus, reconnectAttempts, sendMessage, subscribe } = useServerStatus();

  return (
    <DashboardShell
      currentSection={currentSection}
      onNavigate={setCurrentSection}
      connectionStatus={connectionStatus}
    >
      {currentSection === "overview" && <OverviewPanel />}
      {currentSection === "channels" && <ChannelConfigPanel />}
      {currentSection === "monitoring" && <MonitoringPanel />}
      {currentSection === "settings" && <SettingsPanel />}
    </DashboardShell>
  );
}
```

### Pattern 2: Canvas VU Meter with requestAnimationFrame

**What:** VU meters rendered on HTML5 Canvas, updated via rAF loop reading from a ref (not React state).
**When to use:** Real-time audio level display at 10+ updates/second.
**Why:** Level data arrives at 100ms intervals (10fps). Using React state would cause 10 re-renders/second per meter. Canvas + ref decouples rendering from React's reconciliation.

```typescript
interface VuMeterProps {
  channelId: string;
  width?: number;
  height?: number;
}

function VuMeter({ channelId, width = 24, height = 200 }: VuMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef({ peak: 0, rms: 0, clipping: false });

  // Subscribe to level data -- write to ref, not state
  useEffect(() => {
    const unsubscribe = subscribe("levels:update", (msg) => {
      const payload = msg.payload as { levels: Record<string, NormalizedLevels> };
      const levels = payload.levels[channelId];
      if (levels) {
        levelRef.current = {
          peak: Math.max(...levels.peak),
          rms: Math.max(...levels.rms),
          clipping: levels.clipping,
        };
      }
    });
    return unsubscribe;
  }, [channelId, subscribe]);

  // rAF render loop -- reads ref, draws canvas, never triggers React render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrameId: number;
    const draw = () => {
      const { peak, rms, clipping } = levelRef.current;
      // Clear and draw meter bars...
      ctx.clearRect(0, 0, width, height);
      // ... drawing logic ...
      animFrameId = requestAnimationFrame(draw);
    };
    animFrameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameId);
  }, [width, height]);

  return <canvas ref={canvasRef} width={width} height={height} />;
}
```

### Pattern 3: WebSocket Subscription Hook for Domain Data

**What:** Custom hooks that subscribe to specific WebSocket message types and manage domain-specific state.
**When to use:** Any data flowing from server to admin UI via WebSocket.
**Why:** Isolates domain concerns (SRP), prevents monolithic state in `useServerStatus`.

```typescript
function useChannels(sendMessage: SendFn, subscribe: SubscribeFn) {
  const [channels, setChannels] = useState<AppChannel[]>([]);

  useEffect(() => {
    // Request initial channel list
    sendMessage("channels:list");

    const unsubs = [
      subscribe("channels:list", (msg) => {
        setChannels((msg.payload as { channels: AppChannel[] }).channels);
      }),
      subscribe("channel:created", (msg) => {
        setChannels(prev => [...prev, msg.payload as AppChannel]);
      }),
      subscribe("channel:updated", (msg) => {
        const updated = msg.payload as AppChannel;
        setChannels(prev => prev.map(ch => ch.id === updated.id ? updated : ch));
      }),
      subscribe("channel:removed", (msg) => {
        const { channelId } = msg.payload as { channelId: string };
        setChannels(prev => prev.filter(ch => ch.id !== channelId));
      }),
    ];

    return () => unsubs.forEach(unsub => unsub());
  }, [sendMessage, subscribe]);

  return { channels };
}
```

### Pattern 4: Level Data Flow (High-Frequency Updates)

**What:** Level data (100ms interval) stored in refs, not React state, to avoid re-render storms.
**When to use:** Any data arriving more than 2-3 times per second that drives visual display.

```
Server (100ms) -> WebSocket -> useAudioLevels hook -> Ref (Map<channelId, levels>)
                                                            |
                                                     Canvas rAF loop reads ref
                                                            |
                                                     VU meter drawn at 60fps
```

Key insight: The WebSocket subscription writes to a `useRef`, not `useState`. The Canvas rAF loop reads from the same ref. React never re-renders -- the Canvas draws independently.

### Anti-Patterns to Avoid
- **Using useState for level data:** 10 state updates/sec x N channels = render storm. Use useRef + Canvas.
- **Putting all state in useServerStatus:** The existing hook already manages config + interfaces. Adding channels, levels, stats, and listeners would violate SRP. Create separate hooks.
- **Adding react-router:** Zero benefit in a Tauri webview with no address bar. Adds bundle size and complexity.
- **Polling for data already broadcast:** Levels, listener counts, and stats are already pushed via WebSocket events. Do not add HTTP polling.
- **Inline styles for VU meters:** CSS custom properties already define the color palette. Use them for consistency.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| QR code generation | Custom QR encoder | `qrcode` npm package (toDataURL) | Already used in listener/ShareButton.tsx; proven, small |
| WebSocket reconnection | Custom reconnect logic | Existing `useWebSocket` hook | Already handles reconnection, backoff, server restart |
| Config persistence | Custom file write | Existing `configStore.update()` via WS | Config changes go through WebSocket -> server -> disk |
| Level normalization | Custom dB-to-linear | Server already sends normalized 0-1 values | `NormalizedLevels` has both dB and 0-1 range values |
| Source discovery | Custom device enumeration | Existing `sources:list` + `sources:changed` WS events | Server handles GStreamer device monitor + SAP listener |

**Key insight:** The server side is feature-complete for Phase 6. Channel CRUD, level broadcasting, listener counts, resource stats, processing config, and source discovery are all implemented and exposed via WebSocket. Phase 6 is purely a frontend task: building React components that consume existing WebSocket APIs.

## Common Pitfalls

### Pitfall 1: Re-render Storm from High-Frequency Level Data
**What goes wrong:** Using `useState` to store audio levels causes React to re-render the entire component tree 10 times per second per channel.
**Why it happens:** Levels arrive at 100ms intervals. With 4 channels, that's 40 state updates/second.
**How to avoid:** Store level data in `useRef`. Use Canvas with `requestAnimationFrame` for VU meters. Only use `useState` for things that need React to re-render (channel list changes, config changes).
**Warning signs:** Visible lag when typing in input fields, sluggish sidebar navigation.

### Pitfall 2: Memory Leak from Uncleared Subscriptions
**What goes wrong:** WebSocket subscriptions created in `useEffect` are not cleaned up on unmount, leading to stale handlers processing data for removed components.
**Why it happens:** Forgetting the cleanup return in `useEffect`, or subscribing outside of effect.
**How to avoid:** Always return the unsubscribe function from `useEffect`. The existing `subscribe()` API returns a cleanup function by design -- use it.
**Warning signs:** Console warnings about setting state on unmounted components, growing memory usage.

### Pitfall 3: Canvas Blur on High-DPI Displays
**What goes wrong:** VU meters look fuzzy/blurry on Retina/HiDPI displays.
**Why it happens:** Canvas pixel ratio doesn't match device pixel ratio by default.
**How to avoid:** Scale canvas dimensions by `window.devicePixelRatio` and use CSS to constrain display size:
```typescript
const dpr = window.devicePixelRatio || 1;
canvas.width = displayWidth * dpr;
canvas.height = displayHeight * dpr;
canvas.style.width = `${displayWidth}px`;
canvas.style.height = `${displayHeight}px`;
ctx.scale(dpr, dpr);
```
**Warning signs:** Meters look soft/blurry compared to surrounding text.

### Pitfall 4: Channel Reorder/Visibility API Doesn't Exist Yet
**What goes wrong:** The roadmap says "Admin can reorder, show/hide channels" but the server-side API has NO reorder or visibility endpoint.
**Why it happens:** Phase 2 channel manager stores channels in a Map (unordered). The config schema's `audio.channels` is a Zod array (ordered), but `ChannelManager` doesn't expose reorder.
**How to avoid:** Phase 6 must add:
1. A `sortOrder` or `order` field to the channel config schema
2. A `visible` (or `hidden`) boolean field to the channel config
3. Server-side `channel:reorder` WebSocket handler
4. Server-side `channel:update` handler extended to accept `visible` field
**Warning signs:** Attempting to call `channel:reorder` and getting "Unknown message type" error.

### Pitfall 5: QR Code URL Must Use Server IP, Not 127.0.0.1
**What goes wrong:** QR code shows `https://127.0.0.1:7777` which is unreachable from phones.
**Why it happens:** The admin UI runs on loopback. If `window.location` is used for the QR URL, it will be a loopback address.
**How to avoid:** Build the listener URL from the config's `server.host` + `server.port` + `network.domain`, NOT from `window.location`. The config is already available via `useServerStatus`.
**Warning signs:** Phones scanning QR code get connection refused.

### Pitfall 6: Pipeline ID vs Channel ID Confusion in Level Data
**What goes wrong:** Level data is keyed by `pipelineId`, but the UI needs to display by channel. A channel may have multiple source assignments, each with its own pipeline.
**Why it happens:** The `levels:update` payload uses `pipelineId` as the key (see `wireAudioBroadcasts` in handler.ts). The mapping from pipelineId to channelId is internal to ChannelManager.
**How to avoid:** Either:
- (a) Add a `channelId` field to the level data payload on the server side, or
- (b) Add a `channel:pipeline-map` request to get the pipelineId-to-channelId mapping, or
- (c) Use the convention that pipelineId follows a pattern including channelId.
Recommendation: Option (a) is cleanest -- extend the level broadcast to include `channelId` in each entry.
**Warning signs:** VU meters show data but can't be matched to the right channel.

## Code Examples

### Existing WebSocket Message Types for Admin Dashboard

From `sidecar/src/ws/types.ts`, all message types already supported:

```typescript
// Channel CRUD
"channels:list"              // Request -> { channels: AppChannel[] }
"channel:create"             // { name, outputFormat? } -> channel:created
"channel:update"             // { channelId, name?, outputFormat?, autoStart? } -> channel:updated
"channel:remove"             // { channelId } -> channel:removed
"channel:start"              // { channelId } -> channel:state { channelId, action: "started" }
"channel:stop"               // { channelId } -> channel:state { channelId, action: "stopped" }

// Source assignment
"channel:source:add"         // { channelId, sourceId, selectedChannels, gain?, muted?, delayMs? }
"channel:source:remove"      // { channelId, sourceIndex }
"channel:source:update"      // { channelId, sourceIndex, gain?, muted?, delayMs?, selectedChannels? }

// Source discovery
"sources:list"               // Request -> { sources: DiscoveredSource[] }

// Processing config
"channel:processing:get"     // { channelId } -> { channelId, processing }
"channel:processing:update"  // { channelId, mode?, agc?, opus? } -> channel:updated
"channel:processing:reset"   // { channelId } -> channel:updated

// Level metering (server push, 100ms interval)
"levels:update"              // { levels: Record<pipelineId, NormalizedLevels> }

// Resource stats (server push, 5s interval)
"stats:update"               // { stats: Record<pipelineId, PipelineStats> }

// Streaming status
"streaming:status"           // Request -> { totalListeners, channels[], workers[] }
"streaming:listener-count"   // Server push -> { channelId, count, totalListeners }
"streaming:listeners"        // Request -> { sessions[], stats[], displayMode }
"streaming:workers"          // Request -> { workers[] }

// Server status
"server:status"              // Request -> { uptime, connections, config }
```

### NormalizedLevels Data Shape (from level-monitor.ts)

```typescript
interface NormalizedLevels {
  pipelineId: string;
  peak: number[];         // 0.0-1.0 per audio channel
  rms: number[];          // 0.0-1.0 per audio channel
  peakDb: number[];       // dB (0 = full scale)
  rmsDb: number[];        // dB (0 = full scale)
  clipping: boolean;      // true if any channel at/above clipping threshold
  timestamp: number;      // Unix ms
  gainReductionDb: number; // AGC activity indicator
}
```

### AppChannel Data Shape (from channel-types.ts)

```typescript
interface AppChannel {
  readonly id: string;        // UUID
  name: string;               // Display name ("English", "Spanish")
  sources: SourceAssignment[]; // Assigned audio sources
  outputFormat: "mono" | "stereo";
  autoStart: boolean;
  status: "stopped" | "starting" | "streaming" | "error" | "crashed";
  processing: ProcessingConfig; // AGC, Opus, RTP settings
  readonly createdAt: number;
}
```

### DiscoveredSource Data Shape (from source-types.ts)

```typescript
// Discriminated union
type DiscoveredSource = AES67Source | LocalDeviceSource;

interface AES67Source {
  id: string;
  type: "aes67";
  name: string;
  multicastAddress: string;
  port: number;
  channelCount: number;
  channelLabels: string[];
  status: "available" | "unavailable" | "in-use" | "verifying";
  // ... more fields
}

interface LocalDeviceSource {
  id: string;
  type: "local";
  name: string;
  api: "wasapi2" | "asio" | "directsound";
  deviceId: string;
  channelCount: number;
  isLoopback: boolean;
  status: "available" | "unavailable" | "in-use" | "verifying";
  // ... more fields
}
```

### QR Code Generation Pattern (from listener/ShareButton.tsx)

```typescript
import QRCode from "qrcode";

// Generate QR as data URL for <img> display
const dataUrl = await QRCode.toDataURL(listenerUrl, {
  width: 200,
  margin: 2,
  color: { dark: "#1a1a2e", light: "#ffffff" },
});
// Use in <img src={dataUrl} />
```

### Existing CSS Custom Properties (from App.css)

```css
:root {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --bg-tertiary: #0f3460;
  --bg-input: #1e2a4a;
  --text-primary: #e0e0e0;
  --text-secondary: #a0a0b0;
  --text-muted: #6b6b80;
  --accent: #5a9cf5;
  --accent-hover: #4a8ce5;
  --accent-disabled: #3a5a80;
  --success: #4caf50;
  --warning: #ff9800;
  --error: #f44336;
  --border: #2a3a5e;
  --border-focus: #5a9cf5;
  --radius: 6px;
  --font-mono: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
}
```

### Sidebar Layout CSS Pattern

```css
.dashboard-shell {
  display: grid;
  grid-template-columns: 220px 1fr;
  grid-template-rows: auto 1fr;
  min-height: 100vh;
}

.dashboard-header {
  grid-column: 1 / -1;
  /* spans full width */
}

.dashboard-sidebar {
  grid-row: 2;
  background-color: var(--bg-secondary);
  border-right: 1px solid var(--border);
  padding: 1rem 0;
  overflow-y: auto;
}

.dashboard-content {
  grid-row: 2;
  padding: 1.5rem;
  overflow-y: auto;
}
```

## Server-Side Gaps (Must Be Addressed)

These server-side features are required by the roadmap but do NOT exist in the current sidecar code:

### Gap 1: Channel Reorder API
**Current:** Channels stored in `Map<string, AppChannel>` (unordered). Config stores `audio.channels` as an array (ordered on disk) but `ChannelManager` doesn't expose reorder.
**Needed:** `channel:reorder` WebSocket handler that accepts an ordered array of channel IDs and persists the new order.
**Complexity:** LOW -- rewrite the channels array in config, re-populate the channels Map in order.

### Gap 2: Channel Visibility (Show/Hide)
**Current:** No `visible` or `hidden` field on `AppChannel` or the config schema.
**Needed:** A `visible: boolean` field on channels. When `visible=false`, the channel is hidden from the listener Web UI but still manageable in admin. The streaming subsystem already handles `displayToggles` but there is no top-level visibility toggle.
**Complexity:** LOW -- add field to schema + channel-types, update `channel:update` handler to accept it.

### Gap 3: Pipeline-to-Channel Mapping in Level Data
**Current:** `levels:update` broadcasts are keyed by `pipelineId`, not `channelId`. The admin UI has no way to map pipelineId -> channelId without internal knowledge.
**Needed:** Either add `channelId` to each level entry in the broadcast, or provide a `channels:pipeline-map` request.
**Complexity:** LOW -- the `wireAudioBroadcasts` function already has access to the audioSubsystem which knows the mapping.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| react-router for all SPAs | State-based navigation for simple apps | Always valid for simple cases | No router dependency for admin dashboard |
| DOM-based meters (div height) | Canvas + rAF for high-frequency display | HTML5 Canvas matured ~2015 | 60fps rendering without React re-renders |
| Polling for real-time data | WebSocket push (already implemented) | Project architecture decision | No additional polling needed |

**Deprecated/outdated:**
- CSS-in-JS (styled-components, emotion) for this project: The project uses plain CSS with custom properties. Do not introduce a CSS-in-JS library.
- Class components: The project uses function components with hooks exclusively. Do not introduce class components.

## Open Questions

Things that couldn't be fully resolved:

1. **PipelineId-to-ChannelId mapping strategy**
   - What we know: Level data is keyed by pipelineId. A channel can have multiple pipelines (one per source assignment).
   - What's unclear: Whether the VU meter should show combined levels (all sources mixed) or per-source levels.
   - Recommendation: Show combined peak/RMS per channel. The simplest approach is to add `channelId` to each level entry on the server side. For the VU meter, take the max peak across all pipelines belonging to the same channel.

2. **Channel reorder UI interaction**
   - What we know: Drag-and-drop reorder is the standard UX pattern.
   - What's unclear: Whether to use a drag-and-drop library or simple up/down arrow buttons.
   - Recommendation: Use up/down arrow buttons for simplicity. Drag-and-drop libraries (dnd-kit, react-beautiful-dnd) add significant complexity and bundle size. Arrow buttons are sufficient for the typical 3-8 channels a church would have.

3. **LogViewer placement in new layout**
   - What we know: Currently in the footer. The new dashboard has a sidebar.
   - What's unclear: Should logs be a sidebar section, a bottom panel, or a separate view?
   - Recommendation: Make logs a collapsible bottom panel (like browser DevTools) accessible from any section, OR a dedicated sidebar section. Bottom panel is more natural for log tailing.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/hooks/useWebSocket.ts`, `src/hooks/useServerStatus.ts` -- verified WebSocket patterns
- Existing codebase: `sidecar/src/ws/handler.ts`, `sidecar/src/ws/types.ts` -- verified all message types and payloads
- Existing codebase: `sidecar/src/audio/monitor/level-monitor.ts` -- verified NormalizedLevels shape
- Existing codebase: `sidecar/src/audio/channels/channel-types.ts` -- verified AppChannel shape
- Existing codebase: `sidecar/src/audio/sources/source-types.ts` -- verified DiscoveredSource union
- Existing codebase: `sidecar/src/config/schema.ts` -- verified config schema, confirmed no reorder/visibility fields
- Existing codebase: `listener/src/components/ShareButton.tsx` -- verified QR code generation pattern
- Existing codebase: `src/App.css` -- verified CSS custom properties and styling approach

### Secondary (MEDIUM confidence)
- MDN requestAnimationFrame docs -- Canvas animation patterns
- npm `qrcode` package -- toDataURL API confirmed via existing listener usage
- React 19 patterns -- useState/useRef/useEffect hooks for real-time data

### Tertiary (LOW confidence)
- None -- all findings verified against the actual codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- entirely based on libraries already in the project
- Architecture: HIGH -- patterns derived from existing codebase conventions
- Pitfalls: HIGH -- identified through code inspection of actual WebSocket API and data shapes
- Server-side gaps: HIGH -- confirmed through grep/search of actual source code

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (stable -- no external dependencies being added)
