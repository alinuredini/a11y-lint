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
