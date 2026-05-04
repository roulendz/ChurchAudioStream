---
phase: 7
slug: listener-advanced-features
status: draft
shadcn_initialized: false
preset: none
created: 2026-05-05
---

# Phase 7 — UI Design Contract

> Visual and interaction contract for Listener Advanced Features: mix balance slider, processing toggle, localization (i18n), and light/dark theme.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (plain CSS custom properties) |
| Preset | not applicable |
| Component library | none (hand-rolled mobile-first components) |
| Icon library | inline SVG (existing pattern from VolumeSlider, ConnectionQuality) |
| Font | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` (system stack, existing) |

---

## Spacing Scale

Declared values (multiples of 4, extracted from existing codebase):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, inline padding, bar gaps |
| sm | 8px | Compact element spacing, chip padding |
| md | 12px | Card gaps, intra-component padding, component internal spacing |
| lg | 16px | Section padding, standard gap |
| xl | 20px | View horizontal padding |
| 2xl | 24px | Major section padding, modal padding, SettingsPanel horizontal padding |
| 3xl | 32px | Page-level spacing, modal outer padding |

Exceptions: 44px minimum touch targets on all interactive controls (existing pattern: icon buttons, share button). Mix balance slider thumb: 28px diameter (matches volume slider).

---

## Typography

| Role | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| Eyebrow | 11px (0.6875rem) | 700 | 1.15 | Eyebrow labels, chips, badges; uppercase + letter-spacing 0.12em for chip variant |
| Label | 13px (0.8125rem) | 400 | 1.4 | Form labels, hint text, secondary captions |
| Body | 16px (1rem) | 400 | 1.5 | Body text, card names, descriptions |
| Heading | 22px (1.375rem) | 700 | 1.15 | Section headings, page titles |

Two weights only: **400** (regular) for body/label text, **700** (bold) for headings/eyebrows/chips.

Eyebrow differentiation from body achieved via: smaller size (11px) + `text-transform: uppercase` + `letter-spacing: 0.12em` + weight 700. No intermediate weights needed.

---

## Color

### Dark Theme (default, existing)

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#0b0b18` / `#050510` | Page background, gradient base |
| Secondary (30%) | `#14142a` / `#1f1f3d` | Cards, modals, panels, footer pill |
| Accent (10%) | `#7c5cff` | CTA buttons, slider fill, active toggle, pulsing ring glow |
| Accent strong | `#9d82ff` | Slider track fill, active state text |
| Accent soft | `rgba(124, 92, 255, 0.18)` | Active toggle background, card gradient highlight |
| Success | `#2af2c8` | Live indicator dots, level meter green bars |
| Warn | `#ffb547` | Reconnecting banner, connection quality warnings |
| Destructive | `#ff5b6f` | Clipping indicator only |
| Text primary | `#ffffff` | Headings, names, primary content |
| Text secondary | `rgba(255, 255, 255, 0.68)` | Body text, descriptions, labels |
| Text muted | `rgba(255, 255, 255, 0.42)` | Eyebrows, hints, disabled text |
| Hairline | `rgba(255, 255, 255, 0.08)` | Borders, dividers |

### Light Theme (new)

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#f8f9fc` | Page background |
| Secondary (30%) | `#ffffff` | Cards, modals, panels |
| Accent (10%) | `#6c4edb` | CTA buttons, slider fill, active toggle |
| Accent strong | `#5a3cc8` | Slider track fill, active state text |
| Accent soft | `rgba(108, 78, 219, 0.12)` | Active toggle background |
| Success | `#0d9b7a` | Live indicator dots, level meter green bars |
| Warn | `#d4860a` | Reconnecting banner, warnings |
| Destructive | `#dc2626` | Clipping indicator only |
| Text primary | `#1a1a2e` | Headings, names, primary content |
| Text secondary | `rgba(26, 26, 46, 0.68)` | Body text, descriptions, labels |
| Text muted | `rgba(26, 26, 46, 0.42)` | Eyebrows, hints, disabled text |
| Hairline | `rgba(26, 26, 46, 0.10)` | Borders, dividers |

Accent reserved for: CTA buttons (Start Listening, Install), volume slider fill + thumb glow, mix balance slider fill, active state toggle highlights, play/pause button gradient, pulsing ring animation. NOT used for: body text, borders, neutral cards, labels.

---

## CSS Custom Properties Contract

All components MUST reference these variables (refactored from hardcoded values):

```css
:root {
  /* Surfaces */
  --surface-0: #0b0b18;
  --surface-1: #14142a;
  --surface-2: #1f1f3d;
  --surface-glass: rgba(255, 255, 255, 0.04);
  --surface-glass-border: rgba(255, 255, 255, 0.08);

  /* Text */
  --text-primary: #ffffff;
  --text-secondary: rgba(255, 255, 255, 0.68);
  --text-muted: rgba(255, 255, 255, 0.42);

  /* Accent */
  --accent: #7c5cff;
  --accent-strong: #9d82ff;
  --accent-soft: rgba(124, 92, 255, 0.18);
  --accent-glow: rgba(124, 92, 255, 0.45);

  /* Semantic */
  --success: #2af2c8;
  --success-glow: rgba(42, 242, 200, 0.6);
  --warn: #ffb547;
  --destructive: #ff5b6f;
  --hairline: rgba(255, 255, 255, 0.08);

  /* Gradients */
  --gradient-cta: linear-gradient(135deg, #b29eff 0%, #7c5cff 100%);
  --gradient-surface: linear-gradient(180deg, var(--surface-2) 0%, var(--surface-1) 100%);
}

[data-theme="light"] {
  --surface-0: #f8f9fc;
  --surface-1: #ffffff;
  --surface-2: #f0f1f5;
  --surface-glass: rgba(26, 26, 46, 0.03);
  --surface-glass-border: rgba(26, 26, 46, 0.10);

  --text-primary: #1a1a2e;
  --text-secondary: rgba(26, 26, 46, 0.68);
  --text-muted: rgba(26, 26, 46, 0.42);

  --accent: #6c4edb;
  --accent-strong: #5a3cc8;
  --accent-soft: rgba(108, 78, 219, 0.12);
  --accent-glow: rgba(108, 78, 219, 0.35);

  --success: #0d9b7a;
  --success-glow: rgba(13, 155, 122, 0.4);
  --warn: #d4860a;
  --destructive: #dc2626;
  --hairline: rgba(26, 26, 46, 0.10);

  --gradient-cta: linear-gradient(135deg, #8b6cff 0%, #6c4edb 100%);
  --gradient-surface: linear-gradient(180deg, var(--surface-2) 0%, var(--surface-1) 100%);
}

/* System auto-detection (no explicit override set) */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    /* Same values as [data-theme="light"] */
  }
}
```

---

## Component Inventory

### New Components (Phase 7)

| Component | File | Purpose |
|-----------|------|---------|
| `MixBalanceSlider` | `listener/src/components/MixBalanceSlider.tsx` | Horizontal slider blending primary/secondary channel audio (0=primary only, 1=secondary only) |
| `MixChannelPicker` | `listener/src/components/MixChannelPicker.tsx` | Bottom sheet listing available channels to select as secondary mix source |
| `ProcessingToggle` | `listener/src/components/ProcessingToggle.tsx` | Pill-shaped toggle button for server-side AGC on/off |
| `LanguagePicker` | `listener/src/components/LanguagePicker.tsx` | Dropdown/bottom-sheet for selecting UI language |
| `ThemeToggle` | `listener/src/components/ThemeToggle.tsx` | 3-state toggle: system / light / dark |
| `SettingsPanel` | `listener/src/components/SettingsPanel.tsx` | Bottom sheet containing LanguagePicker + ThemeToggle + processing toggle |

### Modified Components

| Component | Changes |
|-----------|---------|
| `PlayerView` | Add mix balance section in footer (below volume), add settings gear icon in header |
| `App.tsx` | Wrap with i18n provider, add theme initialization |
| `ChannelListView` | Add settings gear icon in header, wrap all strings with `t()` |
| `OfflineScreen` | Wrap all strings with `t()` |
| All CSS files | Replace hardcoded color values with CSS custom properties |

---

## Visual Hierarchy

### PlayerView Focal Point

**Primary focal point:** Play/pause button centered vertically in viewport. Largest interactive element (64px), accent gradient fill, pulsing ring animation when live. Eye lands here first.

**Visual reading order (top to bottom):**
1. Header: channel name (22px heading) + live badge (accent dot + eyebrow) — establishes context
2. Center: play/pause CTA — primary action, anchors attention
3. Footer stack: volume slider > mix balance slider (when active) — secondary controls, diminishing prominence via position
4. Settings gear (top-right, 24px, text-muted color) — tertiary, discovered not demanded

**Hierarchy enforcement:**
- Only ONE accent-colored element dominates at a time (play button OR active slider thumb, never competing)
- Footer controls use `text-secondary` / `hairline` colors until actively manipulated
- Mix balance slider fades in below volume (same glass card, 8px gap) — spatial grouping signals relatedness without visual competition

---

## Interaction Contracts

### Mix Balance Slider (STRM-03)

**Layout:** Appears below volume slider in player footer, inside the same glass-card container. Only visible when a secondary channel is actively selected.

**Activation flow:**
1. User taps "Mix" button (appears next to settings gear in player header tools)
2. Bottom sheet opens showing available channels (excluding current primary)
3. User taps a secondary channel card
4. Mix balance slider appears in footer
5. Default position: center (0.5 = equal blend)

**Slider behavior:**
- Range: 0.0 (primary only) to 1.0 (secondary only)
- Visual: identical styling to volume slider (6px track, 22px thumb, accent fill)
- Labels: primary channel flag emoji on left, secondary channel flag emoji on right
- Crossfade: equal-power (cosine law) applied in Web Audio GainNodes
- Removing secondary channel: tap "X" button next to the slider or re-tap "Mix" in header

**Visual spec:**
```
[flag-A]  ====O================  [flag-B]
           ^accent fill left     ^unfilled right
```

Track height: 6px. Thumb: 22px white circle with accent glow shadow. Same CSS as `.volume-slider__range`.

### Processing Toggle (STRM-04)

**Layout:** Inside SettingsPanel bottom sheet. Single row: label + toggle.

**Behavior:**
- Label: "Audio Enhancement" (localized via i18n key `settings.audioEnhancement`)
- Subtext: "Affects all listeners on this channel" (key: `settings.audioEnhancementHint`)
- Toggle style: pill shape, 48px wide x 28px tall, accent color when ON, hairline border when OFF
- On toggle: sends protoo request `toggleProcessing` to server
- Feedback: 1.5s debounced pipeline restart (audible change confirms)
- Disabled state: when not playing (greyed out, pointer-events: none)

### Language Picker (LWEB-06)

**Layout:** Inside SettingsPanel. Row with current language displayed, taps to expand dropdown.

**Behavior:**
- Shows available languages as a list: English, Espanol, Latviesu
- Each row: flag emoji + native language name
- Active language: accent background highlight
- On select: i18next changes language, all UI text re-renders, preference saved to localStorage key `cas_language`
- Default: detected from browser `navigator.language`, fallback to `en`

**Languages for v1:**
| Code | Native Name | Flag |
|------|-------------|------|
| en | English | (none, neutral globe icon) |
| es | Espanol | (none) |
| lv | Latviesu | (none) |

### Theme Toggle (LWEB-07)

**Layout:** Inside SettingsPanel. Row with 3-segment toggle.

**Visual:**
- 3 segments: sun icon (light) | system icon (auto) | moon icon (dark)
- Active segment: accent background, accent-strong text
- Inactive segments: surface-glass background, text-muted icons
- Pill container: 40px tall, rounded-full, surface-glass background + hairline border

**Behavior:**
- On select: sets `data-theme` attribute on `<html>`, saves to localStorage key `cas_theme`
- "System" removes `data-theme` attribute, letting `@media (prefers-color-scheme)` rule apply
- FOUC prevention: blocking `<script>` in `index.html` `<head>` reads localStorage before CSS paints

### Settings Panel (bottom sheet)

**Layout:** slides up from bottom (same animation as StatsPanel: `stats-slide-up` keyframes). Contains:
1. Language picker row
2. Theme toggle row
3. Audio Enhancement toggle row (only visible when on player view and playing)

**Visual:**
- Background: `var(--gradient-surface)` with `var(--surface-glass-border)` top border
- Border radius: 28px top-left/right (matches StatsPanel)
- Padding: 24px horizontal, 28px + safe-area bottom
- Close button: 36px circle, top-right (matches StatsPanel pattern)
- z-index: 600 (same as StatsPanel)

**Access:** Gear icon (SVG cog, 24x24) in header tools area of both ChannelListView and PlayerView.

---

## Copywriting Contract

| Element | Copy (en) | i18n Key |
|---------|-----------|----------|
| Primary CTA | Start Listening | `player.startListening` |
| Channel list title | Channels | `channelList.title` |
| Channel list eyebrow | Church Audio Stream | `channelList.eyebrow` |
| Empty state heading | No channels available | `channelList.emptyTitle` |
| Empty state body | The sound team hasn't started streaming yet. Check back during the service. | `channelList.emptyBody` |
| Error state (player) | Something went wrong. Try going back and selecting the channel again. | `player.error` |
| Reconnecting banner | Reconnecting... | `status.reconnecting` |
| Connecting | Connecting... | `status.connecting` |
| Disconnected message | Can't reach the audio server. Make sure you're on the church WiFi. | `status.disconnected` |
| Offline screen title | Connection Lost | `offline.title` |
| Offline screen message | Unable to reach the audio server. Check your WiFi connection and try again. | `offline.message` |
| Offline retry button | Try Again | `offline.retry` |
| Mix button label | Mix | `player.mix` |
| Mix picker title | Select Channel to Mix | `mix.selectChannel` |
| Mix balance label (left) | Primary | `mix.primary` |
| Mix balance label (right) | Secondary | `mix.secondary` |
| Settings panel title | Settings | `settings.title` |
| Language label | Language | `settings.language` |
| Theme label | Appearance | `settings.appearance` |
| Theme: Light | Light | `settings.themeLight` |
| Theme: System | System | `settings.themeSystem` |
| Theme: Dark | Dark | `settings.themeDark` |
| Audio Enhancement label | Audio Enhancement | `settings.audioEnhancement` |
| Audio Enhancement hint | Affects all listeners on this channel | `settings.audioEnhancementHint` |
| Keep awake label | Keep Awake | `player.keepAwake` |
| Volume label | Volume | `player.volume` |
| Mute | Mute | `player.mute` |
| Unmute | Unmute | `player.unmute` |
| Channel offline | Channel offline | `player.channelOffline` |
| Live badge | Live | `channel.live` |
| Offline badge | Offline | `channel.offline` |
| Listeners count | {count} listening | `channel.listeningCount` |
| Install banner text | Add to your home screen for quick access | `install.bannerText` |
| Install button | Install | `install.button` |
| Dismiss | Dismiss | `install.dismiss` |
| Share modal title | Share this link | `share.title` |
| Share modal close | Close | `share.close` |
| Stats panel title | Connection Stats | `stats.title` |

---

## FOUC Prevention Script

Inject in `listener/index.html` `<head>` before any CSS loads:

```html
<script>
  (function() {
    var t = localStorage.getItem('cas_theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    }
  })();
</script>
```

---

## Animation Tokens

| Animation | Duration | Easing | Usage |
|-----------|----------|--------|-------|
| View transition | 220ms | ease-in-out | Opacity fade between channel list and player |
| Bottom sheet slide | 220ms | cubic-bezier(0.2, 0.8, 0.2, 1) | SettingsPanel, MixChannelPicker entry |
| Button press | 100ms | ease | scale(0.94-0.97) on :active |
| Toggle state | 150ms | ease | Background/color transitions on toggles |
| Theme transition | 0ms | none | No transition on theme change (prevents jarring whole-page animation) |

---

## Accessibility

| Element | Requirement |
|---------|-------------|
| Mix balance slider | `role="slider"`, `aria-label="Mix balance"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow={value}` |
| Processing toggle | `role="switch"`, `aria-checked={enabled}`, `aria-label="Audio enhancement"` |
| Theme toggle | `role="radiogroup"` with `role="radio"` per segment, `aria-checked` on active |
| Language picker | `role="listbox"` with `role="option"` per language, `aria-selected` on active |
| Settings panel | `role="dialog"`, `aria-modal="true"`, `aria-label="Settings"` |
| Mix channel picker | `role="dialog"`, `aria-modal="true"`, `aria-label="Select channel to mix"` |
| All icon buttons | `aria-label` with translated string |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| (none) | (none) | not applicable |

No shadcn. No third-party registries. All components hand-rolled with plain CSS + React (matching existing codebase pattern).

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
