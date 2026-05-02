# Brief: Listener PWA Internationalization (en / lv / ru)

**Status:** Drafted 2026-05-02. Hand to next agent via:
`/gsd-quick --full implement listener PWA i18n per .planning/briefs/listener-i18n-en-lv-ru.md`

---

## Goal

Translate the **listener PWA** (`listener/`) — the phone-facing audio player — into 3 languages: **English (en)**, **Latvian (lv)**, **Russian (ru)**. Auto-detect on first visit from `navigator.language`, persist user choice to `localStorage`, expose a language switcher in the home view header. Industry-best React i18n stack (`react-i18next`).

**Out of scope:** Admin UI (`src/`), sidecar logs, src-tauri/* code, sermon audio content itself (i18n is for UI chrome only).

---

## Why react-i18next

Industry-standard React i18n library. Reasons over alternatives:

| Library | Verdict | Reason |
|---------|---------|--------|
| **react-i18next** | ✅ pick | Mature, ~1.5M weekly downloads, native React 19 hooks, plural rules via Intl.PluralRules (handles LV's 3 forms + RU's 4 forms automatically), no babel/compile step, Vite-friendly |
| lingui | ❌ skip | Requires babel macro + compile step — extra Vite plugin + CI step |
| formatjs/react-intl | ❌ skip | More verbose API (`<FormattedMessage>` everywhere) — heavier for small surface |
| next-intl | ❌ skip | Designed for Next.js, not vanilla React |

Companion packages (all from same maintainer):
- `i18next` — core engine
- `react-i18next` — React bindings (`useTranslation` hook)
- `i18next-browser-languagedetector` — auto-detect from `navigator.language` + persist to `localStorage`

Three packages, ~30 KB gzipped total. Acceptable for a PWA.

---

## Locked decisions

### D-01 — Library: `react-i18next` + `i18next` + `i18next-browser-languagedetector`
No `i18next-http-backend` — translation files are bundled directly via static JSON imports (avoids extra HTTP round-trip on phone, makes service worker caching trivial).

### D-02 — Locale file format: one JSON per locale, single `translation` namespace
Files at `listener/src/i18n/locales/{en,lv,ru}.json`. Flat or nested keys — nested per react-i18next convention (`channels.empty`, `player.connecting`, etc.).

```json
// listener/src/i18n/locales/en.json
{
  "app": {
    "name": "Church Audio Stream",
    "tagline": "Listen to the sermon"
  },
  "channels": {
    "title": "Channels",
    "empty": "No channels available right now",
    "listenerCount_one": "{{count}} listener",
    "listenerCount_other": "{{count}} listeners"
  },
  "player": {
    "connecting": "Connecting...",
    "playing": "Playing",
    "paused": "Paused",
    "offline": "Stream offline",
    "switchChannel": "Switch channel"
  },
  "language": {
    "label": "Language",
    "en": "English",
    "lv": "Latviešu",
    "ru": "Русский"
  }
}
```

Plural keys use i18next's `_one` / `_few` / `_many` / `_other` suffix convention — `Intl.PluralRules` selects automatically per locale (LV needs `_zero` `_one` `_other`; RU needs `_one` `_few` `_many` `_other`; EN needs `_one` `_other`).

### D-03 — Detection order
Per `i18next-browser-languagedetector` config:
1. `localStorage` (key `i18nextLng`) — user's previous explicit choice
2. `navigator.language` — first-visit auto-detect
3. Fallback: `en`

`localStorage` write happens automatically on language switch. No cookie path (PWA serves over HTTPS only — cookies add no value).

### D-04 — Language switcher placement
**On `ChannelListView` (home screen)**: small dropdown or 3-button group in the header row, top-right of the channel list. NOT in PlayerView (would distract from audio). Globe icon (🌐 or inline SVG) + current language code (e.g., "EN").

Switching:
- Updates `i18n.changeLanguage(code)` (re-renders all consumers)
- Persists to `localStorage` (handled automatically by `i18next-browser-languagedetector`)
- Updates `<html lang="...">` attribute (accessibility, search engines, browser spellcheck)

### D-05 — `<html lang>` synchronization
React effect in App.tsx: `useEffect(() => { document.documentElement.lang = i18n.language; }, [i18n.language])`. Required for screen readers + browser hyphenation.

### D-06 — Date / number formatting
Use platform `Intl.DateTimeFormat` + `Intl.NumberFormat` with locale string from `i18n.language`. NO `i18next-icu` (heavy, not needed for our minimal date/number usage). One helper file `listener/src/i18n/format.ts`:

```ts
export function formatRelativeTime(unixSeconds: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  // ... existing logic from src/lib/relative-time.ts but locale-aware
}
```

(Existing `src/lib/relative-time.ts` is admin UI only and stays English. Listener gets its own locale-aware version OR we extract a shared lib. Decision deferred to executor — see "Open question A1" below.)

### D-07 — Service worker + cached strings
PWA service worker (`vite-plugin-pwa`, generateSW) auto-caches the bundled JS (which includes the JSON locale imports). On translation update, bump app version → service worker reactivates → cache busts. No special config needed.

### D-08 — Translation source authority
Initial translations: **Claude generates ALL three** (en/lv/ru) for v1. User reviews lv + ru for accuracy + tone (Claude's Latvian is good but native review catches nuance). Each subsequent string add: en first, then Claude proposes lv/ru, user can override.

Document in `listener/src/i18n/README.md`: "Adding a new string" workflow.

### D-09 — RTL: not in scope
None of en/lv/ru are RTL. No `dir="rtl"` handling needed. If Arabic added later: also flip via `<html dir>` + a CSS pass.

---

## Deliverables

### New files

```
listener/src/i18n/
├── index.ts                     # i18next init + export configured instance
├── format.ts                    # locale-aware date/number/relative-time helpers
├── README.md                    # how to add a string + workflow for translators
└── locales/
    ├── en.json                  # English (source of truth for keys)
    ├── lv.json                  # Latvian
    └── ru.json                  # Russian

listener/src/components/
└── LanguageSwitcher.tsx         # globe + dropdown / button group
```

### Modified files

- `listener/src/main.tsx` — import `./i18n` for side-effect init before App renders
- `listener/src/App.tsx` — wrap in I18nextProvider (or just rely on hook); add `<html lang>` sync effect
- `listener/src/views/ChannelListView.tsx` — render `<LanguageSwitcher />` in header; replace hardcoded English strings with `t('channels.title')` etc.
- `listener/src/views/PlayerView.tsx` — replace strings
- `listener/src/components/ChannelCard.tsx` — replace strings
- `listener/src/components/ConnectionQuality.tsx` — replace strings
- `listener/src/components/StatsPanel.tsx` — replace strings
- `listener/src/components/StreamUptime.tsx` — replace strings (date format too)
- `listener/src/hooks/useMediaSession.ts` — translate notification metadata
- `listener/index.html` — `<meta name="description">` (English in HTML; React updates document.title from i18n at runtime)
- `listener/package.json` — add deps: `i18next`, `react-i18next`, `i18next-browser-languagedetector`

### Tests (vitest, in listener/)

Listener doesn't currently use vitest (only sidecar + admin UI do). This phase adds vitest to listener:

- `listener/vitest.config.ts` — minimal config matching admin UI's pattern
- `listener/src/i18n/index.test.ts` — language detection precedence (localStorage > navigator > fallback)
- `listener/src/i18n/format.test.ts` — date/number formatting per locale
- `listener/src/i18n/locales/integrity.test.ts` — assert all 3 locale files have identical key sets (catches missing translations on add)
- `listener/src/components/LanguageSwitcher.test.tsx` — click changes language, persists to localStorage, updates `<html lang>`

Coverage target: 90% on `listener/src/i18n/`, smoke-only on components (visual i18n correctness needs human eyes).

### CI

`.github/workflows/release.yml` already runs `npm ci` in `listener/` per fix `45adabe`. New listener test step needed:

```yaml
- name: Listener tests
  run: npm test
  working-directory: listener
```

Add BEFORE the `tauri-action` step. If tests fail, release aborts.

---

## Acceptance gates

1. `cd listener && npm test` green (new vitest cases pass)
2. `cd listener && npm run build` green (TS strict + Vite bundle)
3. Manual smoke (one human session):
   - Open listener PWA in browser with `Accept-Language: lv-LV` → UI renders in Latvian
   - Click language switcher → choose Russian → UI re-renders in Russian
   - Reload page → still Russian (localStorage persisted)
   - Inspect `<html lang="ru">` in DevTools
   - Lighthouse a11y audit on the home view: ≥ 90 (i18n shouldn't drop the score)
4. CI release workflow still passes end-to-end on a tag push

---

## Risk / pitfalls (numbered for executor)

1. **Pluralization for Latvian/Russian** — i18next handles via `Intl.PluralRules`, but executor MUST use the suffix convention (`_one`, `_few`, etc.) NOT the older v3 numbered form. Test plural cases for `0`, `1`, `2`, `5`, `21`, `22` per locale.
2. **String concatenation kills i18n** — never write `t('greeting') + ' ' + name`. Use interpolation: `t('greeting', { name })`.
3. **Date formatting in components** — banish all `new Date(x).toLocaleString()` without explicit locale. Pass `i18n.language` from `useTranslation()` hook.
4. **Service worker stale cache** — bump version (`package.json` listener version) so SW invalidates. `vite-plugin-pwa` handles this if `injectRegister: 'auto'` and `workbox.skipWaiting` already set (verify in `listener/vite.config.ts`).
5. **TypeScript strict + missing keys** — add a TS module declaration in `listener/src/i18n/index.ts` so `t('foo.bar')` autocompletes + errors on typo. Pattern: `declare module 'react-i18next' { interface CustomTypeOptions { resources: typeof resources } }`. Optional but high ROI.
6. **Translation key explosion** — single namespace `translation` is fine for v1. If listener grows to >200 keys, split namespaces (`channels`, `player`, `errors`).
7. **Latvian diacritics** — JSON UTF-8 handles ā/č/ē/ģ/ī/ķ/ļ/ņ/š/ū/ž natively. Verify file encoding is UTF-8 without BOM (Vite's default).
8. **Right-to-left assumption** — DON'T add RTL plumbing. If a future locale needs it, add `<html dir>` then.
9. **Browser language `lv-LV` vs `lv`** — i18next-browser-languagedetector matches by prefix (lv-LV → lv). No special handling needed.
10. **Suspense boundary** — `react-i18next` v15 doesn't need Suspense (translations bundled). Don't add `<Suspense>` wrapper "just in case" — it adds complexity.

---

## Open questions (resolve in discuss-phase)

- **A1**: Reuse `src/lib/relative-time.ts` (admin UI lib) for listener too via shared `packages/` workspace, OR keep separate listener-local copy? Suggest: **separate** — cross-project shared code introduces bundling complexity.
- **A2**: Translate `"Church Audio Stream"` app name itself? Suggest: **NO** — brand stays in English. (`{{appName}}` interpolation if church wants to override later.)
- **A3**: Translate sidecar log messages (developer-facing)? Suggest: **NO** — logs stay English.
- **A4**: User-controlled override of "Latvian as default in church X" by config? Suggest: **NO for v1** — let `navigator.language` decide; user can switch.

---

## Estimated scope

| Task | Files | Time est |
|------|-------|----------|
| 1. Add deps + i18n init + locales scaffold + 3 JSONs | 7 new + 1 modified | 30 min |
| 2. Locale-aware format helpers + tests | 2 new | 20 min |
| 3. LanguageSwitcher component + tests | 2 new | 30 min |
| 4. Replace hardcoded strings in 6+ components/views | 6 modified | 60 min |
| 5. Wire `<html lang>` + listener vitest config + CI step | 3 modified | 20 min |
| 6. Manual smoke + Lighthouse | — | 10 min |

**Total: ~3 hr** for executor (not counting plan + verify).

---

## Forward-compat notes

- Adding a 4th locale (e.g., Polish): drop `pl.json` in `locales/`, add 1 line to detector whitelist + LanguageSwitcher options. ~5 min.
- Adding a new string: add key to `en.json` + Claude proposes lv + ru per D-08 + commit.
- Translation contractor handoff: export `en.json` as the source-of-truth, contractor returns `lv.json` / `ru.json`, integrity test catches missing keys.
- Crowd-sourced translations (later): use Crowdin or Weblate, both support i18next JSON format directly.
