import { describe, expect, it } from 'vitest';
import { parseHtml } from '../src/adapters/html.js';
import { parseJsx } from '../src/adapters/jsx.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { applyComponentMap } from '../src/engine.js';
import { walk, type IRDocument } from '../src/ir.js';
import { rules } from '../src/rules/index.js';
import type { Finding, RuleContext } from '../src/types.js';

function lint(doc: IRDocument): string[] {
  applyComponentMap(doc, DEFAULT_CONFIG.components);
  const out: Finding[] = [];
  for (const rule of rules) {
    const ctx: RuleContext = {
      doc,
      target: 'AA',
      report: (el, status, message, criteria = rule.criteria) =>
        out.push({ ruleId: rule.id, criteria, level: 'A', status, message, file: doc.file, line: el.loc.line, column: el.loc.column, source: 'static' }),
    };
    rule.checkDocument?.(ctx);
    for (const el of walk(doc.root)) if (el !== doc.root && !el.isComponent) rule.check?.(el, ctx);
  }
  return out.map((f) => `${f.status} ${f.ruleId}`);
}

const html = (src: string) => lint(parseHtml('t.html', src));
const jsx = (src: string) => lint(parseJsx('t.tsx', `const x = (${src});`));

describe('rules', () => {
  it('accepts decorative images and named icon buttons', () => {
    expect(html('<img src="a.png" alt=""><button aria-label="Close"><svg aria-hidden="true"></svg></button>')).toEqual([]);
  });

  it('flags filename and generic alt text', () => {
    expect(html('<img src="a.png" alt="hero.png"><img src="b.png" alt="image">')).toEqual(['fail image-alt-quality', 'fail image-alt-quality']);
  });

  it('treats spread props as unknown rather than failing', () => {
    expect(jsx('<img {...props} />')).toEqual(['unknown image-alt']);
    expect(jsx('<input {...register("email")} />')).toEqual(['unknown form-label']);
  });

  it('accepts inputs wrapped in a label or labelled by for/id', () => {
    expect(html('<label>Name <input></label><label for="e">E</label><input id="e">')).toEqual([]);
  });

  it('defers to wrapper components for labels', () => {
    expect(jsx('<Field label="Email"><input /></Field>')).toEqual(['unknown form-label']);
  });

  it('flags icon-only buttons built from components for review', () => {
    expect(jsx('<button><TrashIcon /></button>')).toEqual(['unknown button-name']);
    expect(jsx('<button>{label}</button>')).toEqual([]);
  });

  it('requires keyboard support on custom buttons', () => {
    expect(html('<div role="button" tabindex="0" onclick="go()">Go</div>')).toEqual(['fail click-needs-keyboard']);
    expect(html('<div role="button" tabindex="0" onclick="go()" onkeydown="k()">Go</div>')).toEqual([]);
  });

  it('validates ARIA attributes, roles and required states', () => {
    expect(html('<div aria-lable="x" role="buton"></div>')).toEqual(['fail aria-valid-attr', 'fail aria-valid-role']);
    expect(html('<div role="checkbox" tabindex="0" onkeydown="k()" onclick="t()">Opt</div>')).toEqual(['fail aria-required-attr']);
  });

  it('checks label-in-name', () => {
    expect(html('<button aria-label="Submit form">Send</button>')).toEqual(['fail label-in-name']);
    expect(html('<button aria-label="Send message">Send</button>')).toEqual([]);
  });

  it('validates autocomplete tokens and nudges personal-data fields', () => {
    expect(html('<label>E <input autocomplete="mail"></label>')).toEqual(['fail autocomplete-valid']);
    expect(html('<label>E <input autocomplete="shipping email"></label>')).toEqual([]);
    expect(html('<label>E <input type="email"></label>')).toEqual(['unknown autocomplete-missing']);
  });

  it('flags removed focus outlines without a replacement', () => {
    expect(html('<button class="outline-none">x</button>')).toEqual(['fail focus-outline-removed']);
    expect(html('<button class="outline-none focus-visible:ring-2">x</button>')).toEqual([]);
  });

  it('flags aria-hidden on focusable elements', () => {
    expect(html('<a href="/" aria-hidden="true">Home</a>')).toEqual(['fail aria-hidden-focusable']);
    expect(html('<a href="/" aria-hidden="true" tabindex="-1">Home</a>')).toEqual([]);
  });

  it('accepts a complete document', () => {
    expect(html('<!doctype html><html lang="en"><head><title>Home</title></head><body><main><h1>Hi</h1></main></body></html>')).toEqual([]);
  });
});
