# Domain Pitfalls: Admin Panel UI Migration

**Domain:** Adding shadcn/ui + Tailwind CSS v4 to existing Tauri 2.x + Vite 7 + React 19 admin panel
**Researched:** 2026-05-05
**Confidence:** HIGH (verified against official shadcn/ui docs, Tailwind v4 docs, and project source)

---

## Critical Pitfalls

Mistakes that cause broken UI across entire app or require rearchitecting the approach.

### Pitfall 1: Unlayered Legacy CSS Overrides All Tailwind Utilities

**What goes wrong:** Existing `App.css` (~1350 lines) is plain CSS with no `@layer` declarations. Tailwind v4 places utilities inside `@layer utilities`. Browser cascade rule: unlayered CSS ALWAYS wins over layered CSS regardless of specificity or source order. Result: existing `.btn-primary`, `.form-field input`, `.channel-card` styles silently override any Tailwind utility classes. `className="bg-red-500"` has zero effect on elements that match existing selectors.

**Why it happens:** Tailwind v4 uses native CSS `@layer` (theme, base, components, utilities). Anything NOT inside `@layer` sits in implicit top layer, always wins cascade. Entire App.css is unlayered.

**Consequences:** Every existing styled element ignores Tailwind classes. Developers think Tailwind is broken. `!important` hacks accumulate. Full migration stalls.

**Prevention:**
1. Wrap ALL existing CSS inside `@layer legacy` or `@layer base`:
   ```css
   @layer legacy {
     /* entire existing App.css content */
   }
   ```
2. Declare layer order at top of main CSS entry point:
   ```css
   @layer legacy, theme, base, components, utilities;
   @import "tailwindcss/theme.css" layer(theme);
   @import "tailwindcss/utilities.css" layer(utilities);
   ```
3. Tailwind utilities now beat legacy styles. Migrate components one-by-one.

**Detection:** Apply any Tailwind utility to element with existing CSS class. If no visual effect, cascade layer conflict.

**Phase:** FIRST action during Tailwind integration. Cannot proceed without this.

---

### Pitfall 2: Tailwind Preflight Nukes Existing Component Styling

**What goes wrong:** `@import "tailwindcss"` includes Preflight reset. App.css already defines its own reset (`* { box-sizing: border-box; margin: 0; padding: 0; }`). Preflight additionally resets ALL buttons to transparent background, all headings to unstyled, all images/canvas to `display: block`. Existing `.btn-primary`, `.btn-icon`, `.sidebar-nav-item` (button elements) lose background colors. `h2` elements in sections lose font-size.

**Why it happens:** Preflight targets `button { background: transparent; }`, `h1-h6 { font-size: inherit; font-weight: inherit; }`. Your buttons rely on CSS classes adding color BACK onto reset buttons -- but Preflight's reset is different from yours, causing doubled/conflicting normalization.

**Consequences:** Immediate visual breakage across 30+ button instances. Headings collapse. Layout shifts throughout UI. Debugging is hard because both resets are "correct" individually.

**Prevention:** Do NOT use bare `@import "tailwindcss"`. Use selective imports that SKIP Preflight:
```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
/* NO preflight import -- existing App.css reset is sufficient */
```
Your existing `* { box-sizing; margin: 0; padding: 0 }` plus element-level styles serve same purpose as Preflight. No need for both.

**Detection:** After adding Tailwind, buttons appear unstyled (transparent). Headings shrink. Any element-level styling breaks.

**Phase:** Initial integration. Decide Preflight strategy before any component work.

---

### Pitfall 3: CSS Variable Name Collision (--accent, --border, --radius)

**What goes wrong:** App.css defines: `--accent`, `--border`, `--radius`, `--bg-primary`, `--bg-secondary`, `--success`, `--warning`, `--error`. shadcn/ui theming defines: `--accent`, `--border`, `--radius`, `--background`, `--foreground`, `--primary`, `--secondary`, `--destructive`. Direct collisions on `--accent`, `--border`, `--radius`.

**Why it happens:** Both systems independently chose common design token names. shadcn registers vars via `@theme inline` making them Tailwind utilities. Your vars are referenced 50+ times in App.css.

**Consequences:** Whichever `:root` block loads last wins. Either shadcn components get your `--accent: #5a9cf5` (possibly fine) or your UI gets shadcn default `--accent` (breaks everything). `--border` in your system is a color (`#2a3a5e`); in shadcn it's also a color but different value. `--radius` yours is `6px`, shadcn default is `0.625rem`.

**Prevention:** Two strategies (pick ONE):

**Strategy A -- Rename legacy vars (safer, less work upfront):**
- Prefix all App.css vars: `--cas-accent`, `--cas-border`, `--cas-radius`, etc.
- Find-replace across App.css and 2 module.css files.
- shadcn vars coexist without collision.

**Strategy B -- Map legacy to shadcn naming (better long-term):**
- Your `--bg-primary: #1a1a2e` becomes shadcn `--background`
- Your `--accent: #5a9cf5` becomes shadcn `--primary`
- Your `--border: #2a3a5e` becomes shadcn `--border`
- Requires updating all App.css references to new names. More work but single design system.

**Recommended:** Strategy B. This project is dark-only; map your existing palette directly into shadcn's OKLCH token names. One-time effort, eliminates dual systems.

**Detection:** After shadcn init, inspect `:root` in DevTools. Duplicate variable names with different values = collision.

**Phase:** Must resolve BEFORE `shadcn init`. Prerequisite step.

---

### Pitfall 4: Path Alias Missing -- shadcn CLI Fails Immediately

**What goes wrong:** `npx shadcn@latest init` requires `@/*` path alias in tsconfig.json. Current `tsconfig.json` is references-only (no `compilerOptions`). Current `tsconfig.app.json` has no `baseUrl` or `paths`. Current `vite.config.ts` has no `resolve.alias`. CLI throws "No import alias found."

**Why it happens:** Vite scaffolding with multi-tsconfig split (app/node) doesn't include path aliases by default. shadcn CLI reads root tsconfig.json specifically.

**Consequences:** Cannot use shadcn CLI at all. Manual component installation misses dependency resolution.

**Prevention:** Before running `shadcn init`, add to ALL THREE files:

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "files": [],
  "references": [...]
}
```

`tsconfig.app.json` -- add to existing compilerOptions:
```json
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

`vite.config.ts`:
```typescript
import path from "path";
// in defineConfig:
resolve: {
  alias: { "@": path.resolve(__dirname, "./src") }
}
```

Note: `@types/node` already in devDependencies. No extra install needed.

**Detection:** `shadcn init` immediately errors about missing import alias.

**Phase:** Very first step. 2-minute fix but blocks everything if forgotten.

---

### Pitfall 5: Dark Mode Mismatch -- shadcn Components Render Light

**What goes wrong:** App is permanently dark-themed (desktop control panel). shadcn expects `.dark` class on `<html>` for dark mode. Without it, shadcn components render with light backgrounds (white cards, light inputs) inside your dark dashboard. Jarring visual mismatch.

**Why it happens:** shadcn uses `:root` for light theme vars and `.dark` selector for dark theme vars. Your app has NO `.dark` class anywhere -- dark colors are directly in `:root`.

**Consequences:** First shadcn component added (Button, Card, Dialog) looks completely wrong. White on dark.

**Prevention:**
- During `shadcn init`, when prompted for base color, choose one that matches your existing palette.
- Add `class="dark"` to `<html>` in `index.html`.
- OR (better for dark-only app): Put shadcn dark mode values directly in `:root` in your CSS, skip the `.dark` class entirely. Configure components.json with `cssVariables: true` and populate your CSS with dark values at root level.
- Map existing palette to shadcn tokens during setup:
  ```css
  :root {
    --background: oklch(0.15 0.02 260); /* maps to your #1a1a2e */
    --foreground: oklch(0.9 0.01 260);  /* maps to your #e0e0e0 */
    --primary: oklch(0.65 0.15 250);    /* maps to your #5a9cf5 */
    /* etc. */
  }
  ```

**Detection:** Add any shadcn component -- if it's light-colored against dark background, dark mode not configured.

**Phase:** During `shadcn init`. Must get right before adding components.

---

## Moderate Pitfalls

### Pitfall 6: Canvas VU Meters Affected by Tailwind Replaced Element Rules

**What goes wrong:** If Preflight is enabled, it sets `img, svg, video, canvas, audio { display: block; }` and potentially `max-width: 100%; height: auto;`. VuMeter component uses `<canvas>` with explicit inline `style={{ width: "40px", height: "160px" }}` and JavaScript-controlled dimensions. `height: auto` from Preflight conflicts with programmatic canvas sizing.

**Why it happens:** Preflight groups all "replaced elements" for uniform baseline. Canvas gets caught in the net.

**Prevention:**
1. If Preflight disabled (recommended path), this is non-issue.
2. If Preflight kept for any reason, add to CSS:
   ```css
   .vu-meter canvas {
     max-width: none;
     height: initial;
   }
   ```
3. Or add Tailwind classes directly: `className="max-w-none h-auto!"`

**Detection:** VU meters render wrong size (squished/stretched) after Tailwind integration.

**Phase:** Integration testing. Quick fix once detected.

---

### Pitfall 7: Vite Plugin Order Matters

**What goes wrong:** `@tailwindcss/vite` plugin placed after `@vitejs/plugin-react` in plugins array. CSS processing happens in wrong order. Tailwind utilities not generated for classes found in JSX. Works sometimes (cached) but fails on cold start or production build.

**Why it happens:** Vite plugins execute in array order for transform hooks. Tailwind needs to see all source files to extract class names before final CSS is emitted.

**Prevention:**
```typescript
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  // tailwindcss() FIRST, react() SECOND
});
```

**Detection:** Tailwind class visible in DOM inspector but no corresponding CSS rule generated. Or: works in dev, some classes missing in production build.

**Phase:** Initial setup. One-line fix.

---

### Pitfall 8: Module CSS Files Override Tailwind During Migration

**What goes wrong:** Two existing `.module.css` files (CheckForUpdatesButton, UpdateToast) use CSS Modules. These generate scoped but UNLAYERED styles. During gradual migration, if you mix Tailwind utilities and CSS Module classes on same element, Module styles always win (unlayered > layered).

**Why it happens:** CSS Modules inject styles without `@layer` wrapping. They sit in implicit top cascade layer.

**Prevention:**
- Both module files are small (~75 lines each). Migrate them fully to Tailwind in same phase.
- Until migrated, keep them pure CSS Module -- no Tailwind mixing on same elements.
- If partial migration needed, wrap module CSS content in `@layer components { }`.

**Detection:** Tailwind classes on CheckForUpdatesButton or UpdateToast elements have no effect.

**Phase:** Early in component migration. Low effort (small files).

---

### Pitfall 9: dnd-kit Package Version Confusion

**What goes wrong:** Channel list needs drag-to-reorder. Developer installs `@dnd-kit/core` (v6.x, legacy, last updated 2024) instead of `@dnd-kit/react` (v0.4.x, actively maintained, React 19 compatible). Legacy API uses `DndContext`; new API uses `DragDropProvider`. Most online tutorials/examples reference legacy API.

**Why it happens:** `@dnd-kit/core` has 2M+ weekly downloads, higher name recognition. `@dnd-kit/react` is v0.x which looks "unstable" but is actually the maintained path forward. Existing shadcn sortable examples (sadmann7/sortable) may reference legacy API.

**Prevention:**
- Install `@dnd-kit/react` (NOT `@dnd-kit/core`). It's the React 19 compatible adapter.
- Follow docs at dndkit.com/react/ not legacy docs.dndkit.com.
- Reference Dice UI's sortable component for shadcn-compatible implementation.

**Detection:** Importing from `@dnd-kit/core` or using `DndContext` = legacy API.

**Phase:** Channel reordering implementation.

---

### Pitfall 10: React 19 Peer Dependency Conflicts on npm install

**What goes wrong:** Some shadcn sub-dependencies (react-day-picker, cmdk, recharts) declare `peerDependencies: { "react": "^18" }`. npm strict mode rejects install with ERESOLVE. Can't add Calendar, Command, or Chart components.

**Why it happens:** Package authors haven't updated peer dep ranges. Packages work fine with React 19 but npm enforces declared ranges.

**Prevention:**
- shadcn CLI will prompt for install flag when conflict detected. Select `--legacy-peer-deps`.
- OR add `.npmrc` at project root: `legacy-peer-deps=true`
- Core components this project needs (Button, Card, Dialog, Input, Select, Table, DropdownMenu) have NO peer dep conflicts. Only niche components affected.
- This project unlikely needs Calendar/Chart.

**Detection:** ERESOLVE error during `shadcn add <component>`.

**Phase:** Only when adding specific conflicting components. Non-blocking for initial work.

---

### Pitfall 11: Desktop App -- No Google Fonts CDN Access

**What goes wrong:** shadcn defaults/tutorials reference Google Fonts (Inter, Geist). Tauri WebView2 runs locally; depending on CSP and network, external font CDN may not load. Text renders in wrong font.

**Why it happens:** shadcn docs assume web deployment with CDN access. Desktop apps must bundle all assets.

**Prevention:**
- Keep existing system font stack: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Already works offline.
- Configure shadcn theme to NOT reference external fonts.
- Override Tailwind's `font-sans` in `@theme` to use system stack:
  ```css
  @theme {
    --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  ```
- If custom font wanted later: download .woff2, place in `src/assets/fonts/`, reference with local `@font-face`. No spaces in filename (Tauri dev mode bug).

**Detection:** Text looks different after migration. Missing/wrong font in Tauri window.

**Phase:** Initial theme configuration.

---

## Minor Pitfalls

### Pitfall 12: No tailwind.config.js Needed (v4) -- Don't Create One

**What goes wrong:** Developer familiar with Tailwind v3 creates `tailwind.config.js`. Tailwind v4 + `@tailwindcss/vite` does NOT use config files. Config file is ignored or causes confusing behavior. Theme customization happens in CSS via `@theme` directive.

**Prevention:** Do NOT create tailwind.config.js. All configuration via CSS:
```css
@theme {
  --color-primary: oklch(...);
  --radius-lg: 0.5rem;
}
```

**Phase:** Initial setup. Knowledge issue, not technical.

---

### Pitfall 13: No PostCSS Config Needed -- Remove if Exists

**What goes wrong:** `postcss.config.js` from earlier tooling (or autocreated by editor plugins) conflicts with `@tailwindcss/vite`. Double CSS processing, unexpected transforms.

**Prevention:** `@tailwindcss/vite` handles ALL CSS processing including vendor prefixing (via Lightning CSS). Delete any postcss.config.js. Do not install `autoprefixer`.

**Detection:** CSS warnings about duplicate processing. Currently no postcss.config.js in project (verified).

**Phase:** Initial setup check.

---

### Pitfall 14: Gradual Migration -- BEM + Tailwind on Same Element

**What goes wrong:** During transition, developer applies both `className="channel-card bg-card"` mixing legacy BEM class with Tailwind utility. Specificity unpredictable. Hard to debug.

**Prevention:** Strict rule: each component is EITHER fully legacy CSS OR fully Tailwind/shadcn. Never both class systems on same element. Migrate component-by-component atomically.

**Phase:** Throughout migration. Code review enforcement.

---

### Pitfall 15: shadcn components.json Points to Wrong CSS File

**What goes wrong:** `shadcn init` asks for CSS file path. If pointed to `src/App.css` (existing styles), shadcn appends its theme variables there, mixing with legacy code. If pointed to non-existent file, components can't find theme vars.

**Prevention:** Create `src/index.css` as new Tailwind entry point. Keep `src/App.css` as legacy (wrapped in `@layer`). Import both in `src/main.tsx`:
```typescript
import "./index.css";  // Tailwind + shadcn theme (new)
import "./App.css";    // Legacy styles in @layer legacy (existing)
```
Point shadcn init at `src/index.css`.

**Detection:** shadcn components unstyled (vars undefined) or legacy styles corrupted.

**Phase:** Initial setup architecture decision.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Initial Tailwind + shadcn setup | Layer conflict (#1), Preflight (#2), Path alias (#4), Plugin order (#7) | Selective Tailwind imports, configure aliases first |
| CSS variable mapping | Name collision (#3), Dark mode (#5) | Map palette to shadcn tokens, set dark-only theme |
| First component additions | Dark mode mismatch (#5), Font (#11), components.json path (#15) | Verify dark theme renders before adding more |
| Module CSS migration | Specificity conflict (#8) | Migrate small files completely, don't mix |
| Channel list drag-drop | dnd-kit version (#6) | Use `@dnd-kit/react` v0.4+ |
| VU meter preservation | Canvas sizing (#6) | Verify dimensions post-integration |
| Ongoing migration | BEM + Tailwind mixing (#14) | Atomic per-component migration |

---

## Integration Order Recommendation (Pitfall-Informed)

Based on pitfall dependencies, execute in this order:

1. **Path aliases** (Pitfall #4) -- unblocks CLI
2. **Create index.css entry point** (Pitfall #15) -- separates concerns
3. **Wrap App.css in @layer legacy** (Pitfall #1) -- prevents cascade disasters
4. **Install Tailwind v4 + @tailwindcss/vite** (Pitfall #2, #7, #12, #13) -- skip Preflight, correct plugin order
5. **Resolve CSS variable collisions** (Pitfall #3) -- rename or map
6. **Run shadcn init with dark theme** (Pitfall #5, #11) -- configure dark-only
7. **Verify VU meters unchanged** (Pitfall #6) -- sanity check
8. **Add first shadcn component** -- verify entire stack works
9. **Migrate module CSS files** (Pitfall #8) -- small, do early
10. **Add dnd-kit for channel reorder** (Pitfall #9) -- use correct package

---

## Sources

- [shadcn/ui Tailwind v4 docs](https://ui.shadcn.com/docs/tailwind-v4) -- HIGH confidence
- [shadcn/ui Vite installation](https://ui.shadcn.com/docs/installation/vite) -- HIGH confidence
- [Tailwind CSS v4 Preflight](https://tailwindcss.com/docs/preflight) -- HIGH confidence
- [Tailwind v4 no important option - GitHub](https://github.com/tailwindlabs/tailwindcss/discussions/15866) -- HIGH confidence
- [Tailwind v4 unlayered CSS overrides - Discussion](https://github.com/tailwindlabs/tailwindcss/discussions/16578) -- HIGH confidence
- [Cannot disable preflight v4 - Issue](https://github.com/tailwindlabs/tailwindcss/issues/15723) -- HIGH confidence
- [shadcn/ui React 19 support](https://ui.shadcn.com/docs/react-19) -- HIGH confidence
- [@tailwindcss/vite npm](https://www.npmjs.com/package/@tailwindcss/vite) -- HIGH confidence
- [@dnd-kit/react npm](https://www.npmjs.com/package/@dnd-kit/react) -- HIGH confidence
- [dnd-kit migration guide](https://dndkit.com/react/guides/migration/) -- HIGH confidence
- [Tauri font loading issues](https://github.com/tauri-apps/tauri/issues/6815) -- MEDIUM confidence
- [Tauri font name spaces bug](https://github.com/tauri-apps/tauri/issues/12763) -- MEDIUM confidence
