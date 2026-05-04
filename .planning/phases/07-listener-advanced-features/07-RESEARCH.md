# Phase 7: Listener Advanced Features - Research

**Researched:** 2026-05-05
**Domain:** Listener PWA (React), Web Audio API, mediasoup multi-consumer, i18n, CSS theming
**Confidence:** HIGH

## Summary

Phase 7 adds four distinct features to the listener PWA: dual-channel mix balance via Web Audio API, server-side processing toggle via protoo signaling, i18n with react-i18next, and CSS custom property theming with prefers-color-scheme detection.

The most architecturally complex feature is dual-channel mixing (STRM-03). The current architecture assigns each channel its own mediasoup Router, meaning a listener wanting audio from two channels simultaneously needs either two WebRtcTransports (one per router) or a `pipeToRouter` call to pipe the secondary producer into the primary's router. The **two-transport approach** is recommended -- simpler server logic, avoids same-worker pipe constraints, and the secondary transport only exists while mixing is active.

The processing toggle (STRM-04) is straightforward: existing admin WS already supports `channel:processing:update` with `{ agc: { enabled: boolean } }`. The listener just needs a new protoo request type that forwards to the same audio subsystem method.

**Primary recommendation:** Implement as 4 independent plans (mix balance, processing toggle, i18n, theming) since they touch different files with minimal overlap.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Dual-channel mix balance | Browser (Web Audio API) | API (second consumer creation) | Mixing happens client-side via GainNode; server provides second audio stream |
| Processing toggle | API (audio subsystem) | Browser (UI toggle) | AGC enable/disable is server-side pipeline config; listener sends request |
| i18n / localization | Browser (react-i18next) | -- | Pure client-side string replacement, no server involvement |
| Light/dark theme | Browser (CSS + JS) | -- | Pure client-side CSS custom properties + localStorage preference |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STRM-03 | Listener can blend two channels (original + translation) with mix balance slider | Web Audio API dual-source GainNode mixing; second mediasoup consumer via secondary transport |
| STRM-04 | Listener can toggle audio processing (normalization) on/off from phone | New protoo request `toggleProcessing` -> existing `audioSubsystem.updateProcessingConfig()` |
| LWEB-06 | Web UI available in multiple languages (localization) | react-i18next 17.x + i18next 26.x; JSON namespace files; language detector |
| LWEB-07 | Light/dark theme with system-adaptive auto-detection and manual override | CSS custom properties on `:root` / `[data-theme="light"]`; `prefers-color-scheme` media query; localStorage override |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| i18next | 26.0.8 | i18n runtime | [VERIFIED: npm registry] Industry standard, React ecosystem blessed |
| react-i18next | 17.0.6 | React hooks/HOC for i18next | [VERIFIED: npm registry] Official React binding |
| i18next-browser-languagedetector | 8.2.1 | Auto-detect browser language | [VERIFIED: npm registry] Standard plugin, reads navigator.language |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | -- | Web Audio API is built-in | Dual-channel mixing uses native AudioContext/GainNode |
| (none) | -- | CSS custom properties are built-in | Theme system needs no runtime library |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| react-i18next | react-intl (FormatJS) | react-intl is heavier, better for complex pluralization rules; i18next simpler for small string sets like this PWA |
| CSS custom properties | CSS-in-JS (styled-components) | CSS vars are zero-runtime, already used in the codebase via `:root`, no bundle size hit |

**Installation:**
```bash
cd listener && npm install i18next react-i18next i18next-browser-languagedetector
```

**Version verification:** Versions confirmed via `npm view` on 2026-05-05.

## Architecture Patterns

### System Architecture Diagram

```
STRM-03 (Mix Balance):
  Phone Browser
    |-- protoo peer.request("consume", { channelId: PRIMARY })
    |     -> Consumer A (track A) -> MediaStreamSource A -> GainNode A --\
    |                                                                      \--> AudioContext.destination
    |-- protoo peer.request("consumeSecondary", { channelId: SECONDARY })    /
          -> Consumer B (track B) -> MediaStreamSource B -> GainNode B --/
          (secondary WebRtcTransport on secondary channel's Router)

STRM-04 (Processing Toggle):
  Phone Browser
    |-- protoo peer.request("toggleProcessing", { channelId, enabled })
    |     -> SignalingHandler -> AudioSubsystem.updateProcessingConfig({ agc: { enabled } })
    |     -> pipeline restart (1.5s debounce already in place)

LWEB-06 (i18n):
  listener/src/i18n/
    |-- init.ts          (i18next.init + plugins)
    |-- locales/en.json  (English strings)
    |-- locales/es.json  (Spanish strings)
    |-- locales/lv.json  (Latvian strings, etc.)
  Components use: const { t } = useTranslation()

LWEB-07 (Theme):
  listener/src/styles/themes.css
    |-- :root { --surface-0: ...; }              (dark = default)
    |-- [data-theme="light"] { --surface-0: ...; }
    |-- @media (prefers-color-scheme: light) { :root:not([data-theme]) { ... } }
  useTheme hook: reads system preference + localStorage override
```

### Recommended Project Structure
```
listener/src/
  i18n/
    init.ts              # i18next initialization
    locales/
      en.json            # English strings
      es.json            # Spanish strings
      lv.json            # Latvian strings
  hooks/
    useTheme.ts          # Theme preference hook
    useMixBalance.ts     # Dual-channel mixing hook
  components/
    MixBalanceSlider.tsx  # Balance slider UI
    LanguagePicker.tsx    # Language selection dropdown
    ThemeToggle.tsx       # Light/dark toggle button
    SettingsPanel.tsx     # Panel containing toggles + i18n + theme
  styles/
    themes.css           # CSS custom property definitions
```

### Pattern 1: Web Audio API Dual-Source Mixing
**What:** Connect two MediaStreamTracks to an AudioContext via separate GainNodes, cross-fade between them using complementary gain values
**When to use:** STRM-03 mix balance
**Example:**
```typescript
// Source: MDN Web Audio API documentation
const ctx = new AudioContext();
const gainA = ctx.createGain();
const gainB = ctx.createGain();

// balance: 0.0 = full A, 1.0 = full B, 0.5 = equal
function setMixBalance(balance: number): void {
  // Equal-power crossfade to avoid volume dip at center
  gainA.gain.setTargetAtTime(Math.cos(balance * Math.PI / 2), ctx.currentTime, 0.01);
  gainB.gain.setTargetAtTime(Math.sin(balance * Math.PI / 2), ctx.currentTime, 0.01);
}

const sourceA = ctx.createMediaStreamSource(new MediaStream([trackA]));
const sourceB = ctx.createMediaStreamSource(new MediaStream([trackB]));
sourceA.connect(gainA).connect(ctx.destination);
sourceB.connect(gainB).connect(ctx.destination);
```

### Pattern 2: i18next Initialization with Lazy Loading
**What:** Initialize i18next with bundled JSON namespaces and browser language detection
**When to use:** LWEB-06 localization
**Example:**
```typescript
// Source: i18next official docs
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import es from "./locales/es.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, es: { translation: es } },
    fallbackLng: "en",
    interpolation: { escapeValue: false }, // React already escapes
    detection: { order: ["localStorage", "navigator"], caches: ["localStorage"] },
  });

export default i18n;
```

### Pattern 3: CSS Custom Property Theming
**What:** Define color tokens as CSS custom properties, swap via data attribute
**When to use:** LWEB-07 light/dark theme
**Example:**
```css
/* Default: dark */
:root {
  --surface-0: #0b0b18;
  --surface-1: #14142a;
  --text-primary: #ffffff;
  --text-secondary: rgba(255, 255, 255, 0.68);
  --accent: #7c5cff;
}

/* Light theme override */
[data-theme="light"] {
  --surface-0: #f8f9fc;
  --surface-1: #ffffff;
  --text-primary: #1a1a2e;
  --text-secondary: rgba(26, 26, 46, 0.68);
  --accent: #6c4edb;
}

/* System auto-detection (only when no explicit override) */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --surface-0: #f8f9fc;
    --surface-1: #ffffff;
    --text-primary: #1a1a2e;
    --text-secondary: rgba(26, 26, 46, 0.68);
    --accent: #6c4edb;
  }
}
```

### Anti-Patterns to Avoid
- **Direct color values in component CSS:** All 3 CSS files (index.css, App.css, player.css) use hardcoded hex/rgba. Must refactor ALL to use CSS custom properties before theming works.
- **Two HTMLAudioElements for mixing:** Don't create a second `<audio>` element. Use Web Audio API GainNodes on the single AudioContext. The existing audio-engine.ts already has an AudioContext for the analyser -- extend it.
- **Global i18n state outside React:** Don't store language in a module-level variable. Use i18next's built-in state which triggers React re-renders via react-i18next.
- **Polling server for processing state:** Don't poll. The existing `channel:processing:updated` broadcast already pushes changes to admin clients. For listeners, the pipeline restart is audible within 1.5s.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Language detection | Custom navigator.language parser | i18next-browser-languagedetector | Handles locale variants, fallbacks, regional codes |
| Translation key management | Custom object lookup | i18next namespaces | Handles interpolation, pluralization, context, nested keys |
| Equal-power crossfade | Linear gain math | `Math.cos/sin(balance * PI/2)` formula | Linear crossfade has -3dB dip at center; cosine law maintains perceived loudness |
| System theme detection | `matchMedia` raw string | `window.matchMedia("(prefers-color-scheme: light)")` + `.addEventListener("change")` | Must handle live changes (user toggles OS dark mode while app is open) |

**Key insight:** Mixing (STRM-03) is the only feature requiring server-side changes. The other 3 are purely client-side additions. Keep server changes minimal.

## Common Pitfalls

### Pitfall 1: iOS AudioContext Restrictions with Multiple Sources
**What goes wrong:** Creating a second MediaStreamSource on iOS fails or produces silence if AudioContext was suspended
**Why it happens:** iOS aggressively suspends AudioContexts; adding a new source to a suspended context silently fails
**How to avoid:** Always `await audioContext.resume()` before connecting the secondary source. The existing `audio-engine.ts` already handles this for the first track -- ensure the mix-balance hook uses the same AudioContext instance
**Warning signs:** Secondary channel produces silence on iOS but works on Android/desktop

### Pitfall 2: Theme Flash on Page Load (FOUC)
**What goes wrong:** Page loads in dark theme, then flashes to light after JS reads localStorage
**Why it happens:** CSS loads before JS executes; if system is light but user previously chose dark (or vice versa), there's a visual flash
**How to avoid:** Inject a blocking `<script>` in `index.html` head that reads localStorage and sets `data-theme` before any CSS renders
**Warning signs:** Brief white/dark flash visible on page refresh

### Pitfall 3: mediasoup Router Isolation
**What goes wrong:** Trying to consume from a producer on a different router fails with "cannot consume"
**Why it happens:** Each channel has its own Router. Consumer must be on the same router as its producer.
**How to avoid:** For dual-channel mixing, create a secondary WebRtcTransport on the secondary channel's router. Don't try to consume both from one transport.
**Warning signs:** Error: "Cannot consume: producerId not found" when trying to subscribe to secondary channel

### Pitfall 4: i18n Key Extraction from Existing Hardcoded Strings
**What goes wrong:** Missing translations cause the app to show raw keys like "player.startListening"
**Why it happens:** Incomplete extraction of all hardcoded strings from components
**How to avoid:** Exhaustively grep all `.tsx` files for string literals in JSX (aria-labels, text content, title attributes). Use the `en.json` as the exhaustive key reference.
**Warning signs:** Any component rendering a string literal that isn't wrapped in `t()`

### Pitfall 5: Volume Slider Conflict with Mix Balance
**What goes wrong:** Main volume slider affects only the primary channel; secondary channel stays at full volume
**Why it happens:** Current `audio-engine.ts` uses `HTMLAudioElement.volume` for the main track. With dual mixing via Web Audio API GainNodes, the HTMLAudioElement path no longer applies.
**How to avoid:** When mix mode is active, route ALL audio through the Web Audio API graph (both sources -> gain nodes -> destination node -> MediaStreamDestination -> HTMLAudioElement). Master volume becomes a GainNode at the end of the chain.
**Warning signs:** Volume slider seems broken or only affects one channel during mixing

## Code Examples

### Dual-Channel Mixing Architecture (STRM-03)

```typescript
// New hook: useMixBalance.ts
// Uses the same AudioContext as audio-engine but adds a second source

interface MixBalanceEngine {
  /** Connect a secondary track for blending */
  connectSecondary(track: MediaStreamTrack): void;
  /** Disconnect secondary (back to single-channel mode) */
  disconnectSecondary(): void;
  /** Set mix balance: 0 = primary only, 1 = secondary only, 0.5 = equal */
  setBalance(value: number): void;
  /** Apply master volume (replaces HTMLAudioElement.volume when mixing) */
  setMasterVolume(value: number): void;
}
```

### Server-Side Processing Toggle Request (STRM-04)

```typescript
// New protoo request handler in signaling-handler.ts
case "toggleProcessing": {
  const { channelId, enabled } = request.data as {
    channelId: string;
    enabled: boolean;
  };
  // Delegate to audio subsystem (same path as admin WS "channel:processing:update")
  audioSubsystem.updateProcessingConfig(channelId, {
    agc: { enabled },
  });
  accept({ channelId, processingEnabled: enabled });
  break;
}
```

### Theme Hook

```typescript
// useTheme.ts -- localStorage + system preference
type ThemeMode = "light" | "dark" | "system";

function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem("cas_theme") as ThemeMode) ?? "system";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", mode);
    }
    localStorage.setItem("cas_theme", mode);
  }, [mode]);

  return { mode, setMode };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| react-intl (FormatJS) for i18n | i18next + react-i18next dominates React i18n | 2020+ | i18next has larger ecosystem, simpler API for key/value translations |
| Manual prefers-color-scheme polling | matchMedia.addEventListener("change") | Always available | Live system theme change detection without polling |
| Separate audio elements per stream | Web Audio API AudioContext mixing | Always available | Single pipeline, precise gain control, equal-power crossfade |

**Deprecated/outdated:**
- `window.matchMedia(...).addListener()`: Deprecated in favor of `.addEventListener("change", ...)`
- `i18next-xhr-backend`: Replaced by `i18next-http-backend` years ago (not needed here since we bundle JSON)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Church primarily needs English + Spanish + Latvian locales | Architecture Patterns | Low -- adding more locales is trivial (one JSON file each) |
| A2 | Equal-power crossfade (cosine law) is the desired mixing curve | Code Examples | Medium -- linear might be acceptable for speech, but cosine prevents center dip |
| A3 | Listener toggle of processing affects ALL listeners on that channel (per-channel toggle, not per-listener) | Architecture Patterns | High -- if per-listener processing is needed, architecture is fundamentally different (would need per-consumer pipelines). REQUIREMENTS say "toggle server-side audio processing" which implies channel-level. |
| A4 | Secondary channel for mixing is selected from the existing channel list (not a hardcoded "original" channel) | Architecture Patterns | Low -- UI will show channel picker for secondary |

## Open Questions (RESOLVED)

1. **Per-listener vs per-channel processing toggle**
   - What we know: STRM-04 says "listener can toggle audio processing on/off from their phone." The admin currently controls AGC per-channel. The GStreamer pipeline is shared for all listeners.
   - What's unclear: Does toggling processing affect just this listener's perception (impossible without per-listener pipeline) or ALL listeners on the channel?
   - Recommendation: Implement as per-channel toggle (same as admin functionality) since GStreamer pipeline is shared. Document limitation clearly: "You are changing the experience for all listeners on this channel."
   - RESOLVED: Per-channel toggle. GStreamer pipeline is shared; toggling affects all listeners. Plan 03 implements server handler forwarding to existing `audioSubsystem.updateProcessingConfig()`.

2. **How many locales for v1?**
   - What we know: Project is for churches. User is Latvian. Common church translation scenarios: English, Spanish, Latvian.
   - What's unclear: Exact locale list needed.
   - Recommendation: Ship with English (en) as base + 2-3 additional (es, lv). Structure allows trivial additions.
   - RESOLVED: en/es/lv. Plan 02 ships all three locale JSON files with full key coverage.

3. **Mix balance UI location**
   - What we know: PlayerView is already complex with volume slider, mute, wake lock, stats panel.
   - What's unclear: Where does the mix balance slider go? Footer alongside volume? Separate expandable panel?
   - Recommendation: Place in an expandable "Mix" section below the current volume slider in the player footer. Hidden by default; appears only when user enables mixing from a settings/channel picker within the player.
   - RESOLVED: Footer slider below volume. MixBalanceSlider appears inline when mixing active; MixChannelPicker opens as bottom sheet from a "Mix" button. Plan 04/05 implement this.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.5 (available via npm) |
| Config file | none for listener (Wave 0 gap) |
| Quick run command | `cd listener && npx vitest run --reporter=verbose` |
| Full suite command | `cd listener && npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STRM-03 | Mix balance crossfade gain calculation | unit | `npx vitest run src/hooks/useMixBalance.test.ts -t "crossfade"` | Wave 0 |
| STRM-04 | Processing toggle sends correct protoo request | unit | `npx vitest run src/hooks/useProcessingToggle.test.ts` | Wave 0 |
| LWEB-06 | i18n key resolution and language switch | unit | `npx vitest run src/i18n/i18n.test.ts` | Wave 0 |
| LWEB-07 | Theme hook reads/writes localStorage + sets data-theme | unit | `npx vitest run src/hooks/useTheme.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd listener && npx vitest run`
- **Per wave merge:** `cd listener && npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `listener/vitest.config.ts` -- vitest config for listener project (jsdom environment)
- [ ] `listener/src/hooks/useMixBalance.test.ts` -- STRM-03 gain math
- [ ] `listener/src/hooks/useProcessingToggle.test.ts` -- STRM-04 request format
- [ ] `listener/src/i18n/i18n.test.ts` -- LWEB-06 key resolution
- [ ] `listener/src/hooks/useTheme.test.ts` -- LWEB-07 localStorage persistence
- [ ] Framework install: `cd listener && npm install -D vitest @testing-library/react jsdom @testing-library/jest-dom`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | -- (anonymous listeners, per project decision) |
| V3 Session Management | no | -- (stateless protoo peers) |
| V4 Access Control | yes | Rate limiter already in SignalingHandler; new `toggleProcessing` must validate channelId exists |
| V5 Input Validation | yes | Validate `balance` is 0.0-1.0 (client-side); validate `channelId` exists (server-side) |
| V6 Cryptography | no | -- |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Listener toggles AGC off for entire channel without authorization | Elevation of privilege | Accept: any listener can toggle (requirement states "from their phone"). OR: Only allow if admin permits per-channel listener control (add config flag) |
| Malformed balance value crashes audio graph | Denial of service | Clamp value at UI layer: `Math.max(0, Math.min(1, value))` |
| XSS via i18n interpolation | Tampering | react-i18next escapes by default (`escapeValue: false` is safe because React's JSX escapes) |

## Sources

### Primary (HIGH confidence)
- [npm registry] -- i18next 26.0.8, react-i18next 17.0.6, i18next-browser-languagedetector 8.2.1 versions confirmed
- [Codebase] -- listener/src/lib/audio-engine.ts, sidecar/src/streaming/signaling-handler.ts, sidecar/src/ws/handler.ts examined directly
- [MDN Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) -- GainNode mixing, MediaStreamSource
- [mediasoup docs](https://mediasoup.org/documentation/v3/mediasoup/api/) -- Router isolation, pipeToRouter, multiple consumers

### Secondary (MEDIUM confidence)
- [mediasoup discourse](https://mediasoup.discourse.group/t/using-multiple-consumers-in-a-single-recvtransport/375) -- Multiple consumers on single transport confirmed possible (within same router)
- [mediasoup discourse](https://mediasoup.discourse.group/t/consumer-producer-management-with-pipetorouter/1789) -- pipeToRouter usage for cross-router consumption

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- i18next is de-facto React i18n standard, versions verified
- Architecture: HIGH -- Web Audio API mixing is well-documented; mediasoup multi-consumer confirmed via docs
- Pitfalls: HIGH -- iOS AudioContext and theme FOUC are well-known, documented in official sources
- Server changes (STRM-03 secondary transport): MEDIUM -- approach is sound but implementation details (transport lifecycle on disconnect, cleanup) need careful coding

**Research date:** 2026-05-05
**Valid until:** 2026-06-05 (stable domain, no fast-moving APIs)
