# a11y-lint

A framework-agnostic WCAG 2.2 linter. It checks a repo's source (HTML, JSX/TSX, Vue, Svelte, Astro and Angular templates, CSS/SCSS, design tokens) and, optionally, rendered pages, then maps every finding to a WCAG success criterion.

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
- **Components.** `Link`, `RouterLink`, `NuxtLink` and `Image` map to `a[href]` and `img` by default, except when imported from a non-DOM renderer such as React Native or react-pdf. A component defined in the same file is treated as its root element, so a local `Field` that renders `<label>` counts as a label. Add your own mappings in `components`. Other components are skipped, but their children are still checked.
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
```

Exit codes: `0` clean, `1` failures found (`--fail-on review|never` to change this), `2` usage or config error.

## What it checks

| Layer | Checks | WCAG |
| --- | --- | --- |
| Static rules | image alt and alt quality, button/link/iframe/dialog names, form labels, keyboard access for click handlers, widget roles, positive tabindex, ARIA attribute/role validity and required states, aria-hidden on focusable elements, label-in-name, empty headings, heading order, page lang and title, bypass blocks, autoplay, captions, marquee/blink, meta refresh and zoom, autocomplete, removed focus outlines, table headers | 1.1.1, 1.2.2, 1.3.1, 1.3.5, 1.4.2, 1.4.4, 2.1.1, 2.2.1, 2.2.2, 2.4.1–2.4.4, 2.4.6, 2.4.7, 2.4.9, 2.5.3, 3.1.1, 3.1.2, 3.3.2, 4.1.2 |
| Contrast | design tokens (DTCG and Style Dictionary, with aliases and themes), CSS custom properties per theme (`:root`, `.dark`, `[data-theme]`, `prefers-color-scheme`), CSS rules that set both colour and background, Tailwind v4 `text-*`/`bg-*` pairs including `dark:` variants and opacity | 1.4.3, 1.4.6, 1.4.11 |
| CSS | `:focus { outline: none }` without a replacement, animations without `prefers-reduced-motion` (AAA) | 2.4.7, 2.3.3 |
| Runtime | every axe-core WCAG rule for the target level (contrast after the cascade, target size, ARIA in the real DOM…), plus a keyboard walk for focus traps, invisible focus and obscured focus | 2.1.2, 2.4.7, 2.4.11, 2.5.8 and more |

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
    "pairs": [{ "fg": "color.text.muted", "bg": "color.bg.default" }],
    "autoPair": true
  },
  "runtime": { "urls": ["http://localhost:3000"], "storybook": "storybook-static", "keyboard": true }
}
```

**Token pairing.** Without `pairs`, only pairs that are almost certainly used together are checked: `on-x` and `x-foreground` with `x`, and generic text (`text-*`, `fg`, `foreground`) and focus/ring tokens with the main page background (`bg`, `background`, `surface`, `canvas`, `bg.default`…). Anything else, like muted text on a subtle surface, needs an explicit pair. Declaring `pairs` switches automatic pairing off.

**Variable scopes.** CSS custom properties are shared across a package's app code. Folders like `docs/`, `prototypes/` and `mocks/` get their own scope, and so does each standalone HTML page, so a prototype's `.light` theme never leaks into the app's.

## The conformance report

`--report a11y.md` gives each criterion at the target level one of five states:

- ❌ **Fails**: at least one definite violation.
- ⚠️ **Needs review**: findings that depend on runtime values or human judgement.
- 📝 **Manual check**: no automated coverage, with a note on what to verify.
- 🔍 **Automated checks passed**: a check actually ran (for example, at least one colour pair was resolved) and found nothing. You still need to verify it.
- ➖ **Likely not applicable**: for example, no `<video>` or `<audio>` in the source.

## CI (GitHub code scanning)

```yaml
- run: npx a11y-lint --format sarif --output a11y.sarif --fail-on never
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: a11y.sarif }
```

## Known limits

- Component boundaries: static rules can't see what a child component renders unless you map it. Runtime scans fill this gap.
- Tailwind v3 JS configs aren't resolved yet; v4 `@theme` and the default palette are.
- Contrast is checked only where colour and background are both known statically, for example in the same CSS rule or on the same element and its ancestors.
- Angular inline `template:` strings and JSX in `.ts` files aren't parsed yet.
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
