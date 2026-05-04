# Phase 7: Listener Advanced Features - Pattern Map

**Mapped:** 2026-05-05
**Files analyzed:** 18 new/modified files
**Analogs found:** 16 / 18

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `listener/src/hooks/useMixBalance.ts` | hook | streaming | `listener/src/hooks/useAudioPlayback.ts` | exact |
| `listener/src/hooks/useTheme.ts` | hook | event-driven | `listener/src/hooks/useWakeLock.ts` | role-match |
| `listener/src/hooks/useProcessingToggle.ts` | hook | request-response | `listener/src/hooks/useMediasoup.ts` | role-match |
| `listener/src/components/MixBalanceSlider.tsx` | component | event-driven | `listener/src/components/VolumeSlider.tsx` | exact |
| `listener/src/components/LanguagePicker.tsx` | component | event-driven | `listener/src/components/VolumeSlider.tsx` | role-match |
| `listener/src/components/ThemeToggle.tsx` | component | event-driven | `listener/src/components/VolumeSlider.tsx` | role-match |
| `listener/src/components/SettingsPanel.tsx` | component | event-driven | `listener/src/components/StatsPanel.tsx` | exact |
| `listener/src/i18n/init.ts` | config | transform | `listener/src/main.tsx` | partial |
| `listener/src/i18n/locales/en.json` | config | -- | -- | no-analog |
| `listener/src/i18n/locales/es.json` | config | -- | -- | no-analog |
| `listener/src/i18n/locales/lv.json` | config | -- | -- | no-analog |
| `listener/src/styles/themes.css` | config | -- | `listener/src/styles/player.css` (lines 1-18) | exact |
| `listener/index.html` (modify) | config | -- | self | exact |
| `listener/src/main.tsx` (modify) | config | -- | self | exact |
| `listener/src/views/PlayerView.tsx` (modify) | component | streaming | self | exact |
| `listener/src/views/ChannelListView.tsx` (modify) | component | event-driven | self | exact |
| `listener/src/lib/audio-engine.ts` (modify) | service | streaming | self | exact |
| `sidecar/src/streaming/signaling-handler.ts` (modify) | controller | request-response | self | exact |

## Pattern Assignments

### `listener/src/hooks/useMixBalance.ts` (hook, streaming)

**Analog:** `listener/src/hooks/useAudioPlayback.ts`

**Imports pattern** (lines 9-10):
```typescript
import { useEffect, useRef, useCallback, useState } from "react";
import { createAudioEngine, type AudioEngine } from "../lib/audio-engine";
```

**Core hook pattern** (lines 25-89 shape):
```typescript
export function useAudioPlayback(): UseAudioPlaybackResult {
  const engineRef = useRef<AudioEngine | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const engine = createAudioEngine();
    engineRef.current = engine;
    return () => {
      engine.close();
      engineRef.current = null;
    };
  }, []);

  const startPlayback = useCallback(
    async (track: MediaStreamTrack): Promise<void> => {
      const engine = engineRef.current;
      if (!engine) return;
      await engine.resume();
      await engine.playTrack(track);
    },
    [],
  );

  return { startPlayback, stopPlayback, setVolume, mute, unmute, isMuted, getAnalyser, isSoftwareVolumeSupported };
}
```

**Key insight for mix balance:** Extends the existing AudioContext already created in `audio-engine.ts` (line 62). New hook needs access to same `audioContext` instance -- either export it from audio-engine or accept it as parameter.

---

### `listener/src/hooks/useTheme.ts` (hook, event-driven)

**Analog:** `listener/src/hooks/useWakeLock.ts`

**Imports pattern** (line 19):
```typescript
import { useCallback, useEffect, useRef, useState } from "react";
```

**Core hook pattern** (lines 46-126 shape -- useState + useEffect + useCallback):
```typescript
export function useWakeLock(): UseWakeLockResult {
  const [enabled, setEnabledState] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!isSupported) return;
    if (enabled) {
      void acquireLock();
    } else {
      void releaseLock();
    }
  }, [enabled, isSupported, acquireLock, releaseLock]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
  }, []);

  return { isSupported, isActive, enabled, setEnabled };
}
```

**localStorage pattern** from `usePreferences.ts` (lines 30-39):
```typescript
function readPreferences(): ListenerPreferences {
  const lastChannelId = localStorage.getItem(LAST_CHANNEL_KEY);
  const rawVisitCount = localStorage.getItem(VISIT_COUNT_KEY);
  return { lastChannelId, visitCount: ... };
}
```

---

### `listener/src/hooks/useProcessingToggle.ts` (hook, request-response)

**Analog:** `listener/src/hooks/useMediasoup.ts`

**protoo request pattern** (lines 79-127):
```typescript
const connectToChannel = useCallback(
  async (channelId: string, peer: Peer): Promise<MediaStreamTrack> => {
    const capResponse = (await peer.request(
      "getRouterRtpCapabilities",
    )) as RouterCapabilitiesResponse;
    // ...
    await peer.request("resumeConsumer");
    return consumer.track;
  },
  [disconnect],
);
```

**Apply to toggleProcessing:** Single `peer.request("toggleProcessing", { channelId, enabled })` call wrapped in useCallback.

---

### `listener/src/components/MixBalanceSlider.tsx` (component, event-driven)

**Analog:** `listener/src/components/VolumeSlider.tsx`

**Full component structure** (lines 81-128):
```typescript
interface VolumeSliderProps {
  readonly volume: number;
  readonly onVolumeChange: (value: number) => void;
  readonly isMuted: boolean;
  readonly onMuteToggle: () => void;
  readonly disabled: boolean;
}

export function VolumeSlider({ volume, onVolumeChange, isMuted, onMuteToggle, disabled }: VolumeSliderProps) {
  const displayVolume = isMuted ? 0 : Math.round(volume * 100);

  const handleSliderChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onVolumeChange(Number(event.target.value) / 100);
    },
    [onVolumeChange],
  );

  return (
    <div className={`volume-slider ${disabled ? "volume-slider--disabled" : ""}`}>
      <button className="volume-slider__mute-btn" onClick={onMuteToggle} ... />
      <input className="volume-slider__range" type="range" min="0" max="100" step="1"
        value={displayVolume} onChange={handleSliderChange}
        style={{ "--volume-fill": `${displayVolume}%` } as React.CSSProperties}
      />
    </div>
  );
}
```

**CSS slider styling** from `player.css` (lines 703-785):
```css
.volume-slider__range {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right,
    var(--accent-strong) 0%,
    var(--accent) var(--volume-fill, 70%),
    rgba(255, 255, 255, 0.12) var(--volume-fill, 70%),
    rgba(255, 255, 255, 0.12) 100%
  );
}
```

---

### `listener/src/components/SettingsPanel.tsx` (component, event-driven)

**Analog:** `listener/src/components/StatsPanel.tsx` (modal sheet pattern)

**Modal sheet CSS** from `player.css` (lines 813-878):
```css
.stats-panel {
  position: fixed;
  inset: 0;
  z-index: 600;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(5, 5, 16, 0.7);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  animation: stats-fade-in 180ms ease-out;
}

.stats-panel__sheet {
  width: 100%;
  max-width: 520px;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #1f1f3d 0%, #14142a 100%);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-top-left-radius: 28px;
  border-top-right-radius: 28px;
  padding: 22px 22px calc(28px + env(safe-area-inset-bottom, 0px));
  box-shadow: 0 -24px 64px rgba(0, 0, 0, 0.5);
  animation: stats-slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

**Component interface pattern** (StatsPanel):
```typescript
interface StatsPanelProps {
  open: boolean;
  onClose: () => void;
  // ... data props
}
```

---

### `listener/src/styles/themes.css` (config -- CSS custom properties)

**Analog:** `listener/src/styles/player.css` lines 1-18 (existing `:root` vars)

**Existing design tokens** (player.css lines 6-18):
```css
:root {
  --accent: #7c5cff;
  --accent-soft: rgba(124, 92, 255, 0.18);
  --accent-strong: #9d82ff;
  --warn: #ffb547;
  --surface-0: #0b0b18;
  --surface-1: #14142a;
  --surface-2: #1f1f3d;
  --text-primary: #ffffff;
  --text-secondary: rgba(255, 255, 255, 0.68);
  --text-muted: rgba(255, 255, 255, 0.42);
  --hairline: rgba(255, 255, 255, 0.08);
}
```

**Key requirement:** ALL hardcoded hex/rgba in `index.css`, `App.css`, and `player.css` must be refactored to use these CSS custom properties. Then `themes.css` overrides via `[data-theme="light"]`.

---

### `listener/src/i18n/init.ts` (config, transform)

**Analog:** `listener/src/main.tsx` (entry point import pattern)

**Entry point import** (lines 1-5):
```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/index.css";
```

**i18n init needs to be imported before `<App />` renders** -- add `import "./i18n/init"` to main.tsx.

---

### `sidecar/src/streaming/signaling-handler.ts` (modify -- add toggleProcessing)

**Request dispatch pattern** (lines 434-468):
```typescript
private async handleRequest(
  peer: ProtooPeer,
  request: ProtooRequest,
  accept: ProtooAcceptFn,
  reject: ProtooRejectFn,
): Promise<void> {
  switch (request.method) {
    case "getRouterRtpCapabilities":
      this.handleGetRouterRtpCapabilities(peer, accept);
      break;
    // ... other cases ...
    case "switchChannel":
      await this.handleSwitchChannel(peer, request, accept, reject);
      break;
    default:
      reject(400, `Unknown request method: ${request.method}`);
  }
}
```

**Handler method pattern** (lines 611-643):
```typescript
private async handleConsume(
  peer: ProtooPeer,
  request: ProtooRequest,
  accept: ProtooAcceptFn,
  reject: ProtooRejectFn,
): Promise<void> {
  const channelId = request.data?.channelId as string | undefined;
  if (!channelId) {
    reject(400, "Missing channelId");
    return;
  }
  // ... validation ...
  // ... delegate to subsystem ...
  accept({ /* response data */ });
}
```

**AudioSubsystem call pattern** (from audio-subsystem.ts line 209):
```typescript
updateProcessingConfig(
  channelId: string,
  updates: ProcessingConfigUpdate,
): AppChannel {
  return this.channelManager.updateProcessingConfig(channelId, updates);
}
```

---

### `listener/src/lib/audio-engine.ts` (modify -- expose AudioContext for mix)

**Current structure** (lines 61-180):
```typescript
export function createAudioEngine(): AudioEngine {
  const audioContext: AudioContext = new AudioContext();
  const analyser: AnalyserNode = audioContext.createAnalyser();
  // ...
  return { playTrack, setVolume, mute, unmute, isMuted, resume, getAnalyser, isSoftwareVolumeSupported, close };
}
```

**Modification needed:** Add `getAudioContext(): AudioContext` to the interface so `useMixBalance` can create secondary GainNodes on the same context.

---

### `listener/index.html` (modify -- theme flash prevention)

**Current structure** (lines 1-16):
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <!-- ... -->
    <title>Church Audio Stream</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Add blocking script in `<head>` before CSS loads:**
```html
<script>
  (function(){var t=localStorage.getItem("cas_theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);})();
</script>
```

---

## Shared Patterns

### Component Prop Convention
**Source:** `listener/src/components/VolumeSlider.tsx` lines 20-31
**Apply to:** MixBalanceSlider, LanguagePicker, ThemeToggle, SettingsPanel

All component props use `readonly` modifier:
```typescript
interface SomeProps {
  readonly value: number;
  readonly onChange: (val: number) => void;
  readonly disabled: boolean;
}
```

### Hook Return Interface Pattern
**Source:** `listener/src/hooks/useWakeLock.ts` lines 36-44
**Apply to:** useTheme, useMixBalance, useProcessingToggle

Export explicit result interface:
```typescript
export interface UseThemeResult {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export function useTheme(): UseThemeResult { ... }
```

### CSS Design Tokens
**Source:** `listener/src/styles/player.css` lines 6-18
**Apply to:** ALL CSS files (themes.css defines them, others consume them)

Every color in the codebase should reference `var(--token-name)`:
```css
color: var(--text-primary);
background: var(--surface-0);
border-color: var(--hairline);
```

### JSX Doc Comment Convention
**Source:** `listener/src/components/Toast.tsx` lines 1-6, `listener/src/hooks/useWakeLock.ts` lines 1-17
**Apply to:** All new files

Every file starts with a `/** ... */` block describing purpose, architecture notes, and caveats.

### Error Handling -- Protoo Reject
**Source:** `sidecar/src/streaming/signaling-handler.ts` lines 617-621
**Apply to:** New `toggleProcessing` handler

```typescript
const channelId = request.data?.channelId as string | undefined;
if (!channelId) {
  reject(400, "Missing channelId");
  return;
}
```

### i18n String Extraction Scope
**Apply to:** PlayerView, ChannelListView, OfflineScreen, Toast, SettingsPanel

All user-visible strings to wrap with `t()`:
- PlayerView: "Now listening", "Connecting", "Start Listening", "Listening", "Reconnecting", "Channel offline", "Retry", "Keep awake", "Use your phone's volume buttons"
- ChannelListView: "Live now", "Choose a channel", "listening", "Install", "Not now", "Add to Home Screen for quick access", "Please be patient while we connect translators", "This channel is not live right now", "Continue listening"
- OfflineScreen: title, message, retry button text

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `listener/src/i18n/locales/en.json` | config | -- | JSON translation files are new concept; no existing JSON config in listener |
| `listener/src/i18n/locales/es.json` | config | -- | Same as above |
| `listener/src/i18n/locales/lv.json` | config | -- | Same as above |

Planner should use RESEARCH.md Pattern 2 (i18next initialization) for these files. Structure: `{ "key.nested": "Translation string" }` flat namespace.

## Metadata

**Analog search scope:** `listener/src/`, `sidecar/src/streaming/`, `sidecar/src/audio/`
**Files scanned:** 34 source files
**Pattern extraction date:** 2026-05-05
