import { describe, expect, it } from 'vitest';
import { parseAngular } from '../src/adapters/angular.js';
import { parseAstro } from '../src/adapters/astro.js';
import { parseSvelte } from '../src/adapters/svelte.js';
import { parseVue } from '../src/adapters/vue.js';
import { walk, type IRDocument } from '../src/ir.js';
import { accessibleName } from '../src/rules/helpers.js';

const first = (doc: IRDocument, tag: string) => [...walk(doc.root)].find((e) => e.tag === tag)!;

describe('runtime content and names per framework', () => {
  it('Astro set:html counts as content', async () => {
    expect(accessibleName(first(await parseAstro('a.astro', '<h2 set:html={t} />'), 'h2'))).toBe('unknown');
  });

  it('Vue v-html and template-literal bindings', () => {
    const doc = parseVue('a.vue', '<template><h2 v-html="t" /><button :aria-label="`Remove ${n}`"></button></template>');
    expect(accessibleName(first(doc, 'h2'))).toBe('unknown');
    expect(accessibleName(first(doc, 'button'))).toBe('yes');
  });

  it('Svelte mixed text and expression attributes', () => {
    expect(accessibleName(first(parseSvelte('a.svelte', '<button aria-label="Remove {name}"></button>'), 'button'))).toBe('yes');
  });

  it('Angular [innerHTML] and ternary bindings', () => {
    const doc = parseAngular('a.component.html', `<h2 [innerHTML]="t"></h2><button [attr.aria-label]="open ? 'Close' : 'Open'"></button>`);
    expect(accessibleName(first(doc, 'h2'))).toBe('unknown');
    expect(accessibleName(first(doc, 'button'))).toBe('yes');
  });
});

describe('Angular inline templates', () => {
  it('lints template: strings and styles in .component.ts with real positions', async () => {
    const { lintStatic } = await import('../src/engine.js');
    const { checkContrast } = await import('../src/contrast/index.js');
    const { DEFAULT_CONFIG } = await import('../src/config.js');
    const { resolve } = await import('node:path');
    const cwd = resolve(import.meta.dirname, 'fixtures');
    const result = await lintStatic(cwd, DEFAULT_CONFIG, ['angular/inline.component.ts']);
    expect(result.errors).toEqual([]);
    const found = result.findings.map((f) => `${f.line}:${f.column} ${f.ruleId}`);
    expect(found).toEqual(['6:14 image-alt', '7:5 button-name', '9:7 click-needs-keyboard', '9:7 click-needs-role']);
    const css = (await checkContrast(cwd, DEFAULT_CONFIG, result)).findings.map((f) => `${f.line} ${f.ruleId}`);
    expect(css).toContain('12 focus-outline-removed');
  });
});
