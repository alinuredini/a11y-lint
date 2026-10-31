# Changelog

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
