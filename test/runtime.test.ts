import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import { scanRuntime } from '../src/runtime/index.js';

const fixture = (name: string) => pathToFileURL(resolve(import.meta.dirname, 'fixtures/runtime', name)).href;
const page = fixture('page.html');
const scan = async (name: string) => {
  const result = await scanRuntime(process.cwd(), { ...DEFAULT_CONFIG, runtime: { ...DEFAULT_CONFIG.runtime, urls: [fixture(name)] } });
  return result.findings.filter((f) => !f.ruleId.startsWith('axe/')).map((f) => `${f.status} ${f.ruleId}`);
};

describe('runtime scan', () => {
  it('runs axe and the keyboard walk on a rendered page', async () => {
    const result = await scanRuntime(process.cwd(), { ...DEFAULT_CONFIG, runtime: { ...DEFAULT_CONFIG.runtime, urls: [page] } });
    const ids = result.findings.map((f) => `${f.status} ${f.ruleId}`);
    expect(ids).toEqual(expect.arrayContaining(['fail axe/color-contrast', 'fail axe/image-alt', 'fail focus-visible']));
    // The <button> keeps the browser's default focus ring.
    expect(result.findings.filter((f) => f.ruleId === 'focus-visible')).toHaveLength(1);
    expect(result.covered.has('2.5.8')).toBe(true); // axe target-size
  }, 60_000);

  it('does not call a modal that Escape closes a keyboard trap', async () => {
    // Focus cycles through 2 of 5 focusable elements, but Escape closes the dialog.
    expect(await scan('modal.html')).toEqual([]);
  }, 60_000);

  it('still reports a trap that Escape does not release', async () => {
    expect(await scan('trap.html')).toEqual(['fail keyboard-trap']);
  }, 60_000);

  it('reviews, rather than fails, a container that holds focus without being a tab stop', async () => {
    // The open menu (tabindex="-1") swallows Tab and shows no focus style of its own; Escape closes it.
    expect(await scan('menu.html')).toEqual(['unknown focus-visible']);
  }, 60_000);

  it('finds the same things when pages are scanned in parallel', async () => {
    const urls = ['page.html', 'modal.html', 'trap.html', 'menu.html'].map(fixture);
    const scanAll = async (concurrency: number) =>
      (await scanRuntime(process.cwd(), { ...DEFAULT_CONFIG, runtime: { ...DEFAULT_CONFIG.runtime, urls, concurrency } })).findings.map((f) => `${f.file} ${f.status} ${f.ruleId} ${f.message}`);
    const serial = await scanAll(1);
    expect(serial.length).toBeGreaterThan(4);
    expect(await scanAll(4)).toEqual(serial);
  }, 120_000);
});
