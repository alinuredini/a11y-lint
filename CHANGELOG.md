# Changelog

## Unreleased (0.2.0)

Found while integrating the linter into a component registry with three themes, each with a light and a dark block.

### Fixed

- **Theme scoping.** `:root[data-theme="x"].dark` was filed under theme `x`, so a theme's dark values overwrote its light ones. Light blocks of non-default themes were never evaluated, and dark values were checked against light defaults. Every combination of theme and mode is now its own scope (`default`, `dark`, `x`, `x dark`), read from classes, attributes, `prefers-color-scheme` and nested rules in any order. A scope takes missing values from its theme's block without a mode, then from the default theme in the same mode, then from `:root`.
- **Default `children`.** A component declared with `children = 'Skip to main content'` and used without children was reported as having no accessible name. A literal default now counts as content; an element default (`children = <Icon />`) is checked as that element; any other default is unknown text, like `{label}`.
- **Keyboard trap.** The keyboard walk reported the focus containment of modal dialogs and open menus as a 2.1.2 failure. It now presses Escape first and reports a trap only if focus stays in the cycle.
- **Focus visible on overlays.** A container that holds focus without being a tab stop (`tabindex="-1"`, focused by script) is a review item instead of a failure.
- **Conformance report.** Element names such as `<input>` are written as code, and stray `<` and `{` are escaped, so the report renders in MDX and strict Markdown viewers.
- **Runtime scan robustness.** A page that is already running axe itself (Storybook's a11y addon) no longer aborts the whole scan: the run waits and retries, and a page that still can't be scanned is a `page-load` review item.
- A run that scanned no source files no longer marks media and form criteria as "likely not applicable".

### Added

- `contrast.pairs[].scope` (`{ "theme": "...", "mode": "..." }`) limits a pair to one theme and/or mode. `contrast.pairs[].note` is free text the linter ignores. Existing configs work unchanged.
- `--runtime-only` runs the runtime scan without the static and contrast checks.
- `runtime.concurrency` and `--concurrency <n>` scan several pages at once. The default is 1.

### Changed

- Contrast findings for a theme's dark block now name it (`[x dark]`, `(x dark theme)`) where they used to say `[x]`.
- A selector list such as `:root, [data-theme="light"]` now adds its properties to every scope it names, not only the first named one.
- The `keyboard-trap` message says that Escape did not release focus.

## 0.1.0

First release.

- **Frameworks:** HTML, JSX/TSX, Vue, Svelte, Astro, and Angular (`*.component.html` and inline `template:` strings), all converted to one shared element tree.
- **Static rules:** 30 rules mapped to WCAG 2.2 success criteria. Values only known at runtime are reported for review instead of as failures.
- **Components:** usages are checked as the element their definition renders. Imports are followed through relative paths, tsconfig `paths` aliases, barrel files and single-root SFCs. Headless primitives such as Radix `Label` are recognised.
- **Contrast:**
  - design tokens (DTCG and Style Dictionary)
  - CSS custom properties with light/dark themes
  - CSS rules that set both colour and background
  - Tailwind v4 `@theme` and v3 `tailwind.config`, including `dark:` variants and opacity
- **Runtime:** Playwright + axe-core scans of URLs or a built Storybook, plus a keyboard walk that checks for focus traps, focus that isn't visible, and focus hidden behind other content.
- **Output:** text, JSON, SARIF, and a WCAG conformance report that includes a manual checklist.
