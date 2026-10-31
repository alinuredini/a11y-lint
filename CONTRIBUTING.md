# Contributing

```bash
npm install
npx playwright install chromium   # for the runtime test
npm test
```

**Adding a framework:** write one adapter in `src/adapters/` that turns the template into the tree in `src/ir.ts`. Register it in `src/adapters/index.ts`, then add a fixture under `test/fixtures/` that contains the same seeded problems as the others.

**Adding a rule:** add it to `src/rules/index.ts` with the WCAG criteria it checks. Only report `fail` when the problem is certain from the source. Anything that depends on runtime values is `unknown`. If finding nothing proves little, set `partial: true` so the conformance report doesn't count the criterion as covered.

**False positives** matter more than missed problems. When you report one, include the smallest snippet that reproduces it.

**Releasing:**
1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Tag `vX.Y.Z` and push the tag. The release workflow then publishes to npm (it needs an `NPM_TOKEN` secret or npm trusted publishing).
