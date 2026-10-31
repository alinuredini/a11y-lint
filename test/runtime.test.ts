import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import { scanRuntime } from '../src/runtime/index.js';

const page = pathToFileURL(resolve(import.meta.dirname, 'fixtures/runtime/page.html')).href;

describe('runtime scan', () => {
  it('runs axe and the keyboard walk on a rendered page', async () => {
    const result = await scanRuntime(process.cwd(), { ...DEFAULT_CONFIG, runtime: { ...DEFAULT_CONFIG.runtime, urls: [page] } });
    const ids = result.findings.map((f) => `${f.status} ${f.ruleId}`);
    expect(ids).toEqual(expect.arrayContaining(['fail axe/color-contrast', 'fail axe/image-alt', 'fail focus-visible']));
    // The <button> keeps the browser's default focus ring.
    expect(result.findings.filter((f) => f.ruleId === 'focus-visible')).toHaveLength(1);
    expect(result.covered.has('2.5.8')).toBe(true); // axe target-size
  }, 60_000);
});
