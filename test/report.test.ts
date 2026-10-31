import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import { run } from '../src/index.js';
import { renderMarkdown } from '../src/report/conformance.js';
import { toSarif } from '../src/report/sarif.js';
import { criteriaFor } from '../src/wcag.js';

const fixtures = resolve(import.meta.dirname, 'fixtures');

describe('conformance report', () => {
  it('assigns every in-scope criterion exactly one state', async () => {
    const result = await run(fixtures, { ...DEFAULT_CONFIG, level: 'AA' }, { paths: ['jsx'] });
    expect(result.conformance).toHaveLength(criteriaFor('AA').length);
    const state = (id: string) => result.conformance.find((r) => r.criterion.id === id)!.state;
    expect(state('1.1.1')).toBe('fail');
    expect(state('2.4.4')).toBe('fail'); // the unnamed <Link>
    expect(state('1.2.2')).toBe('likely-na'); // no <video> in jsx/
    expect(state('1.3.5')).toBe('auto-pass'); // inputs exist, autocomplete is valid
    expect(state('3.2.3')).toBe('manual');
  });

  it('counts contrast and focus as covered only when something was evaluated', async () => {
    const plain = await run(fixtures, { ...DEFAULT_CONFIG, level: 'AA' }, { paths: ['plain'] });
    const state = (id: string) => plain.conformance.find((r) => r.criterion.id === id)!.state;
    expect(state('1.4.3')).toBe('manual'); // no colour pair to check
    expect(state('2.4.7')).toBe('manual'); // only the runtime keyboard walk can confirm focus visibility
    const jsx = await run(fixtures, { ...DEFAULT_CONFIG, level: 'AA' }, { paths: ['jsx'] });
    expect(jsx.conformance.find((r) => r.criterion.id === '1.4.3')!.state).toBe('fail');
  });

  it('includes AAA criteria only at AAA', async () => {
    const aa = await run(fixtures, { ...DEFAULT_CONFIG, level: 'AA' }, { paths: ['jsx'] });
    const aaa = await run(fixtures, { ...DEFAULT_CONFIG, level: 'AAA' }, { paths: ['jsx'] });
    expect(aa.conformance.some((r) => r.criterion.level === 'AAA')).toBe(false);
    // WCAG 2.2 without the obsolete 4.1.1: 31 A, 24 AA, 31 AAA.
    expect(aaa.conformance).toHaveLength(86);
    expect(aaa.conformance.filter((r) => r.criterion.level === 'AAA').length).toBe(31);
  });

  it('renders markdown with the honesty note and checklist', async () => {
    const result = await run(fixtures, { ...DEFAULT_CONFIG, level: 'AA' }, { paths: ['jsx'] });
    const md = renderMarkdown(result.conformanceInput, result.conformance);
    expect(md).toContain('Automated tools cannot prove conformance');
    expect(md).toContain('- [ ] [3.2.3 Consistent Navigation](https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation)');
  });
});

describe('SARIF', () => {
  it('maps fail to error and review to warning', async () => {
    const result = await run(fixtures, { ...DEFAULT_CONFIG, level: 'AA' }, { paths: ['jsx'] });
    const sarif = toSarif(result.findings, '0.0.0') as { runs: { results: { level: string; ruleId: string }[] }[] };
    const levels = new Set(sarif.runs[0].results.map((r) => `${r.ruleId}:${r.level}`));
    expect(levels.has('image-alt:error')).toBe(true);
    expect(levels.has('link-text-generic:warning')).toBe(true);
  });
});
