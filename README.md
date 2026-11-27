# a11y-lint

A framework-agnostic WCAG 2.2 linter. It checks a repo's source (HTML, JSX/TSX, Vue, Svelte, Astro, Angular templates including inline `template:` strings, CSS/SCSS, design tokens) and, optionally, rendered pages, then maps every finding to a WCAG success criterion.

> **No tool can prove WCAG conformance.** Automated checks cover roughly a third of the success criteria. a11y-lint reports definite failures, flags what needs a human decision, and generates the manual checklist for everything else.

## How it works

```
.tsx  .vue  .svelte  .astro  .html  .component.html     tokens.json  *.css
  └────────── adapters ──────────┘                          │
                 ▼                                          ▼
       common element tree (IR)                  token / CSS / Tailwind contrast
                 ▼                                          │
      WCAG-mapped rules, written once                       │
                 └──────────────┬───────────────────────────┘
                                ▼            Playwright + axe + keyboard walk (optional)
                     findings: fail | review ◄──────────────┘
                                ▼
              text · JSON · SARIF · conformance report (Markdown)
```

- **One element tree, many frameworks.** Each adapter turns its template syntax into the same tree, so rules are written once.
- **Three-valued results.** `alt={caption}` or `{...props}` can't be judged until runtime. Those are reported as *review*, never as failures, which keeps false positives low.
- **Components are followed to what they render.** A usage like `<Input placeholder="Search" />` is checked as the element its definition returns, with the attributes that definition sets and the props it forwards. Imports are followed through:
  - relative paths
  - tsconfig/jsconfig `paths` aliases
  - barrel re-exports
  - Vue, Svelte and Astro single-root components

  This also covers shadcn's `asChild ? Slot : 'button'` and headless primitives such as Radix `Label`. A literal default for `children` (`function SkipLink({ children = 'Skip to main content' })`) counts as the content of a usage that passes none. `Link`, `RouterLink`, `NuxtLink` and `Image` map to `a[href]` and `img`, except when imported from React Native or react-pdf. Add your own mappings in `components`. Components that can't be resolved, such as package components, are skipped, but their children are still checked.
- **Runtime values it can still reason about.** `` aria-label={`Remove ${name}`} `` and `aria-label="Remove {name}"` always contain text. `<label for={id}>` matches `<input id={id}>`. `set:html`, `v-html`, `[innerHTML]` and `dangerouslySetInnerHTML` count as content.

## Install and run

```bash
npm i -D a11y-lint
npx a11y-lint                       # whole repo at AA
npx a11y-lint src --level AAA       # one folder at AAA
npx a11y-lint --report a11y.md      # plus the conformance report
```

Runtime scans need Playwright:

```bash
npm i -D playwright @axe-core/playwright && npx playwright install chromium
npx a11y-lint --url http://localhost:3000 --url http://localhost:3000/pricing
npx a11y-lint --storybook storybook-static
npx a11y-lint --storybook storybook-static --runtime-only --concurrency 4
```

`--url`, `--storybook` and `--runtime` add the runtime scan to the static lint. `--runtime-only` skips the static and contrast checks, so the report covers the rendered pages alone. `--concurrency <n>` (or `runtime.concurrency`) loads that many pages at once, each in its own tab; the default is 1.

Exit codes: `0` clean, `1` failures found (`--fail-on review|never` to change this), `2` usage or config error.

## What it checks

| Layer | Checks | WCAG |
| --- | --- | --- |
| Static rules | image alt and alt quality, button/link/iframe/dialog names, form labels, keyboard access for click handlers, widget roles, positive tabindex, ARIA attribute/role validity and required states, aria-hidden on focusable elements, label-in-name, empty headings, heading order, page lang and title, bypass blocks, autoplay, captions, marquee/blink, meta refresh and zoom, autocomplete, removed focus outlines, table headers | 1.1.1, 1.2.2, 1.3.1, 1.3.5, 1.4.2, 1.4.4, 2.1.1, 2.2.1, 2.2.2, 2.4.1–2.4.4, 2.4.6, 2.4.7, 2.4.9, 2.5.3, 3.1.1, 3.1.2, 3.3.2, 4.1.2 |
| Contrast | design tokens (DTCG and Style Dictionary, with aliases and themes), CSS custom properties per theme (`:root`, `.dark`, `[data-theme]`, `prefers-color-scheme`), CSS rules that set both colour and background, Tailwind `text-*`/`bg-*` pairs including `dark:` variants and opacity (v4 `@theme` or a v3 `tailwind.config`) | 1.4.3, 1.4.6, 1.4.11 |
| CSS | `:focus { outline: none }` without a replacement, animations without `prefers-reduced-motion` (AAA) | 2.4.7, 2.3.3 |
| Runtime | every axe-core WCAG rule for the target level (contrast after the cascade, target size, ARIA in the real DOM…), plus a keyboard walk for focus traps, invisible focus and obscured focus | 2.1.2, 2.4.7, 2.4.11, 2.5.8 and more |

**The keyboard walk** presses Tab through each page, up to `runtime.maxTabStops` stops (`"keyboard": false` turns it off):

- **Keyboard trap (2.1.2).** When focus cycles through fewer elements than the page has, the walk puts focus back into the cycle and presses Escape. If focus leaves the cycle or the container closes, that is a modal dialog or menu containing focus by design, and nothing is reported. Only a cycle Escape does not release is a failure. A trap with another documented way out still needs a person to judge it.
- **Focus visible (2.4.7).** A tab stop whose computed style doesn't change on focus fails. A container that holds focus without being a tab stop (`tabindex="-1"`, focused by script, as open menus and dialogs often are) is a review item: the focus position is usually shown on its items.
- **Focus not obscured (2.4.11).** A focused element covered by other content is a review item.

## Configuration

`npx a11y-lint --init` writes `a11y-lint.config.json`:

```json
{
  "level": "AA",
  "include": ["**/*.{html,htm,jsx,tsx,vue,svelte,astro,css,scss}"],
  "components": { "IconButton": "button", "AppLink": "a[href]" },
  "rules": { "heading-order": "off" },
  "contrast": {
    "tokens": { "light": "tokens/light.json", "dark": "tokens/dark.json" },
    "pairs": [
      { "fg": "color.text.muted", "bg": "color.bg.default" },
      { "fg": "brand-ring", "bg": "background", "size": "ui", "scope": { "theme": "pistacio", "mode": "light" }, "note": "only this theme draws the ring on the canvas" }
    ],
    "autoPair": true
  },
  "runtime": { "urls": ["http://localhost:3000"], "storybook": "storybook-static", "keyboard": true, "concurrency": 1 }
}
```

**Token pairing.** Without `pairs`, only pairs that are almost certainly used together are checked: `on-x` and `x-foreground` with `x`, and generic text (`text-*`, `fg`, `foreground`) and focus/ring tokens with the main page background (`bg`, `background`, `surface`, `canvas`, `bg.default`…). Anything else, like muted text on a subtle surface, needs an explicit pair. Declaring `pairs` switches automatic pairing off.

**Pairs.** Each entry in `pairs` takes:

| Field | Meaning |
| --- | --- |
| `fg`, `bg` | Token names: a custom property without the `--`, or the dotted path in a token file. |
| `size` | `normal` (default, 4.5:1 at AA), `large` (18pt, or 14pt bold: 3:1) or `ui` (non-text and focus indicators: 3:1). |
| `scope` | Optional. `{ "theme": "pistacio" }`, `{ "mode": "dark" }` or both. Without it the pair is checked in every theme and mode. |
| `note` | Optional free text for people reading the config. The linter ignores it. |

`scope.theme` is the name in the selector (`[data-theme="pistacio"]` is `pistacio`, `.theme-blue` is `theme-blue`); `default` means the blocks without a theme selector. `scope.mode` is `light`, `dark` or `high-contrast`; a block without a mode selector is `light`. For token files the key in `tokens` is read the same way: `"dark"` is the default theme in dark mode, `"pistacio dark"` is theme `pistacio` in dark mode. A pair whose scope matches nothing, like one whose tokens don't exist, is not checked, so check the spelling.

**Themes and modes.** Custom properties are collected per scope, and a scope is one combination of a theme selector and a mode selector:

| Selector | Scope |
| --- | --- |
| `:root`, `html`, `body`, `:host`, Tailwind `@theme` | `default` |
| `.dark`, `:root.dark`, `[data-theme="dark"]`, `[data-mode="dark"]`, `@media (prefers-color-scheme: dark)` | `dark` |
| `[data-theme="x"]` | `x` |
| `.theme-x`, `.x-theme` | `theme-x`, `x-theme` |
| `:root[data-theme="x"].dark`, `.dark [data-theme="x"]`, `[data-theme="x"]` inside a dark media query | `x dark` |

Theme and mode can come in any order, on one element or on an ancestor and a descendant, and through CSS nesting. Each scope is checked on its own, with the values the cascade would give it: its own block first, then the same theme's block without a mode, then the default theme in the same mode, then `:root`. So a status colour declared only in `:root` and `:root.dark` is checked against a theme's dark background with its dark value. Only scopes a stylesheet declares are checked; a theme without a dark block is not combined with the default dark block. Findings name the scope, as in `warn on bg [x dark]`.

**Variable scopes.** CSS custom properties are shared across a package's app code. Folders like `docs/`, `prototypes/` and `mocks/` get their own scope, and so does each standalone HTML page, so a prototype's `.light` theme never leaks into the app's.

## The conformance report

`--report a11y.md` gives each criterion at the target level one of five states:

- ❌ **Fails**: at least one definite violation.
- ⚠️ **Needs review**: findings that depend on runtime values or human judgement.
- 📝 **Manual check**: no automated coverage, with a note on what to verify.
- 🔍 **Automated checks passed**: a check actually ran (for example, at least one colour pair was resolved) and found nothing. You still need to verify it.
- ➖ **Likely not applicable**: for example, no `<video>` or `<audio>` in the source. A `--runtime-only` run has no source to judge by, so it never uses this state.

Element names in the report are written as code (`` `<input>` ``), so it renders the same in Markdown and MDX.

## CI (GitHub code scanning)

```yaml
- run: npx a11y-lint --format sarif --output a11y.sarif --fail-on never
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: a11y.sarif }
```

## Known limits

- Components from packages (other than the known headless primitives) and components with several possible root elements are skipped. Runtime scans fill this gap.
- Tailwind v3 support runs your `tailwind.config.*`, as Tailwind itself does. A TypeScript config needs a Node version with type stripping (22.18+).
- Contrast is checked only where colour and background are both known statically, for example in the same CSS rule or on the same element and its ancestors.
- Angular `templateUrl` files are linted only when they're named `*.component.html`. JSX in plain `.ts` files isn't parsed.
- When a theme sets a property in its light block only and the default dark block sets it too, the two rules tie in specificity and the browser picks the later one. The linter can't see the import order, so it takes the theme's value. Redeclare the property in the theme's dark block to make it explicit.
- A dark theme is recognised by name (`dark`, `light`, `high-contrast`). A theme called `midnight` is a theme in light mode as far as `scope.mode` goes.
- A modal that sets `aria-hidden` on the rest of the page while it is open still gets axe's `aria-hidden-focus` finding for the focusable elements behind it.
- Hyphenated tags are treated as custom elements, so SVG elements like `clip-path` are skipped.

## Development

```bash
npm install
npm test          # vitest; the runtime test needs `npx playwright install chromium`
npm run build
```

Adding a framework means adding one adapter in `src/adapters/` that outputs the tree in `src/ir.ts`. Rules live in `src/rules/index.ts`.

## License

MIT
