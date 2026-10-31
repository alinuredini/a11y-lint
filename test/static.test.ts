import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type Config } from '../src/config.js';
import { lintStatic } from '../src/engine.js';

const fixtures = resolve(import.meta.dirname, 'fixtures');
const config = (level: Config['level'] = 'AA'): Config => ({ ...DEFAULT_CONFIG, level });

async function rulesFor(path: string, level?: Config['level']) {
  const { findings, errors } = await lintStatic(fixtures, config(level), [path]);
  expect(errors).toEqual([]);
  return findings.map((f) => `${f.line} ${f.status} ${f.ruleId}`).sort();
}

// Every framework fixture renders the same card with the same seeded problems.
const SHARED = ['fail image-alt', 'fail click-needs-keyboard', 'fail click-needs-role', 'fail form-label', 'fail no-positive-tabindex', 'unknown link-text-generic'];

describe.each([
  ['jsx/Card.tsx', 'fail button-name'],
  ['vue/Card.vue', 'fail button-name'],
  ['svelte/Card.svelte', 'fail button-name'],
  ['astro/Card.astro', 'fail button-name'],
  ['angular/card.component.html', 'fail button-name'],
  ['html/index.html', 'fail button-name'],
])('%s', (file, buttonFinding) => {
  it('reports the seeded problems and nothing on the valid markup', async () => {
    const found = (await rulesFor(file)).map((f) => f.replace(/^\d+ /, ''));
    for (const expected of [...SHARED, buttonFinding]) expect(found).toContain(expected);
    // The labelled email input, the dynamic-label button and the looped images are valid.
    expect(found.filter((f) => f === 'fail form-label')).toHaveLength(1);
    expect(found.filter((f) => f === 'fail image-alt')).toHaveLength(1);
    expect(found).not.toContain('unknown button-name');
  });
});

describe('document-level rules', () => {
  it('flags lang, title, landmarks, zoom and media in full HTML documents', async () => {
    const found = await rulesFor('html/index.html');
    for (const id of ['html-lang', 'page-title', 'bypass-blocks', 'meta-viewport-zoom', 'no-autoplay-audio', 'media-captions']) {
      expect(found.some((f) => f.endsWith(`fail ${id}`))).toBe(true);
    }
  });

  it('does not apply document rules to components', async () => {
    const found = await rulesFor('vue/Card.vue');
    expect(found.some((f) => /html-lang|page-title|bypass-blocks/.test(f))).toBe(false);
  });
});

describe('component mapping', () => {
  it('treats Link and router-link as anchors with an href', async () => {
    expect(await rulesFor('jsx/Card.tsx')).toContain('17 fail link-name');
    expect(await rulesFor('vue/Card.vue')).toContain('14 fail link-name');
  });
});

describe('levels', () => {
  it('turns generic link text into a 2.4.9 failure at AAA', async () => {
    const { findings } = await lintStatic(fixtures, config('AAA'), ['jsx/Card.tsx']);
    const link = findings.find((f) => f.ruleId === 'link-text-generic')!;
    expect(link).toMatchObject({ status: 'fail', criteria: ['2.4.9'], level: 'AAA' });
  });
});
