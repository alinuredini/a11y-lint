import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { failedThreshold, parseColor, contrast } from '../src/contrast/color.js';
import { checkContrast } from '../src/contrast/index.js';
import { collectVars } from '../src/contrast/css.js';
import { checkTokens, loadTokens, pairTokens, varsAsTokens } from '../src/contrast/tokens.js';
import { DEFAULT_CONFIG, type Config } from '../src/config.js';
import { lintStatic } from '../src/engine.js';

const fixtures = resolve(import.meta.dirname, 'fixtures');

describe('contrast maths', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast(parseColor('#000')!, parseColor('#fff')!).ratio).toBeCloseTo(21, 1);
    expect(contrast(parseColor('#767676')!, parseColor('#fff')!).ratio).toBeCloseTo(4.54, 2);
  });

  it('does not round 4.499 up to a pass', () => {
    expect(failedThreshold(4.499, 'normal', 'AA')?.criterion).toBe('1.4.3');
    expect(failedThreshold(4.5, 'normal', 'AA')).toBeUndefined();
    expect(failedThreshold(4.6, 'normal', 'AAA')?.criterion).toBe('1.4.6');
    expect(failedThreshold(3.1, 'large', 'AA')).toBeUndefined();
  });
});

describe('design tokens', () => {
  const set = loadTokens(fixtures, ['tokens/light.json']);

  it('resolves aliases', () => {
    expect(set.get('default')!.get('color.text.primary')!.value).toBe('#111827');
  });

  it('auto-pairs text with backgrounds and on-x with x', () => {
    const aa = checkTokens(set, { target: 'AA', pairs: [], autoPair: true }).map((f) => f.message.split(':')[0]);
    // Only the main background: text.muted on bg.subtle is plausible but not certain, so it needs an explicit pair.
    expect(aa).toEqual(['color.text.muted on color.bg.default', 'color.focus.ring on color.bg.default']);
    const aaa = checkTokens(set, { target: 'AAA', pairs: [], autoPair: true });
    expect(aaa.some((f) => f.message.startsWith('color.on-primary on color.primary') && f.criteria[0] === '1.4.6')).toBe(true);
  });

  it('pairs shadcn-style x-foreground with x', () => {
    const tokens = new Map(
      Object.entries({ background: '#ffffff', foreground: '#0a0a0a', muted: '#f4f4f5', 'muted-foreground': '#a1a1aa', card: '#fff', 'chart-tooltip-background': '#000' }).map(
        ([name, value]) => [name, { name, value, file: 'x.css', line: 1 }],
      ),
    );
    const names = pairTokens(tokens, [], true).map((p) => `${p.fg.name}/${p.bg.name}`);
    expect(names).toEqual(['foreground/background', 'muted-foreground/muted', 'muted-foreground/background']);
  });

  it('checks only explicit pairs when given', () => {
    const pairs = [
      { fg: 'color.text.primary', bg: 'color.bg.default' },
      { fg: 'color.text.muted', bg: 'color.bg.default', size: 'large' as const },
    ];
    const findings = checkTokens(set, { target: 'AA', pairs, autoPair: true });
    expect(findings.map((f) => f.message)).toEqual(['color.text.muted on color.bg.default: 2.54:1, needs 3:1.']);
  });
});

describe('stylesheets and Tailwind', () => {
  it('checks CSS rules per theme, focus outlines, and Tailwind classes', async () => {
    const config: Config = { ...DEFAULT_CONFIG, level: 'AA' };
    const result = await lintStatic(fixtures, config, ['theme.css', 'vue/Card.vue']);
    const found = (await checkContrast(fixtures, config, result)).findings.map((f) => `${f.file}:${f.line} ${f.ruleId}`);
    expect(found).toEqual(
      expect.arrayContaining([
        'theme.css:9 color-contrast', // .banner in the dark theme
        'theme.css:13 color-contrast', // .badge
        'theme.css:14 focus-outline-removed',
        'vue/Card.vue:24 focus-outline-removed', // scoped <style> block
        'vue/Card.vue:12 tailwind-contrast',
      ]),
    );
    // .banner passes in the light theme, and the identical Tailwind pair is not repeated for dark.
    expect(found.filter((f) => f === 'theme.css:9 color-contrast')).toHaveLength(1);
    expect(found.filter((f) => f === 'vue/Card.vue:12 tailwind-contrast')).toHaveLength(1);
  });

  it('keeps variables from docs/ prototypes out of the app', async () => {
    const config: Config = { ...DEFAULT_CONFIG, level: 'AA' };
    const result = await lintStatic(fixtures, config, ['theme.css', 'docs/proto.css']);
    const msgs = (await checkContrast(fixtures, config, result)).findings.map((f) => f.message);
    expect(msgs.some((m) => m.includes('light'))).toBe(false);
  });

  it('checks dark: variants without a CSS dark theme', async () => {
    const config: Config = { ...DEFAULT_CONFIG, level: 'AA' };
    const result = await lintStatic(fixtures, config, ['jsx/Dark.tsx']);
    const msgs = (await checkContrast(fixtures, config, result)).findings.map((f) => f.message);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('(dark)');
  });

  it('requires prefers-reduced-motion at AAA only', async () => {
    const aa: Config = { ...DEFAULT_CONFIG, level: 'AA' };
    const aaa: Config = { ...DEFAULT_CONFIG, level: 'AAA' };
    const result = await lintStatic(fixtures, aa, ['theme.css']);
    expect((await checkContrast(fixtures, aa, result)).findings.some((f) => f.ruleId === 'reduced-motion')).toBe(false);
    expect((await checkContrast(fixtures, aaa, result)).findings.some((f) => f.ruleId === 'reduced-motion')).toBe(true);
  });
});

describe('Tailwind v3 config', () => {
  it('reads colours from tailwind.config.js, including DEFAULT and <alpha-value>', async () => {
    const cwd = resolve(import.meta.dirname, 'fixtures/tw3');
    const config: Config = { ...DEFAULT_CONFIG, level: 'AA' };
    const result = await lintStatic(cwd, config);
    const found = (await checkContrast(cwd, config, result)).findings.map((f) => `${f.line} ${f.message}`);
    // tailwindcss v3 isn't installed here, so only the config's own colours (plus white/black) resolve.
    expect(found).toEqual(['3 <p class="bg-brand text-brand-fg">: 1.67:1, needs 4.5:1.']);
  });
});

describe('theme and mode scopes', () => {
  const sheet = (css: string) => [{ file: 't.css', css, lang: 'css' as const }];
  // The reproduction from the Kernel integration: status colours live in the default blocks only.
  const kernel = `
    :root { --bg: #fff; --fg: #000; --warn: #800000; }
    :root.dark { --bg: #000; --fg: #fff; --warn: #ff9a9a; }
    :root[data-theme='a'] { --bg: #fff; --fg: #000; }
    :root[data-theme='a'].dark { --bg: #000; --fg: #fff; }
  `;
  const value = (css: string, scope: string, name: string) => varsAsTokens(collectVars(sheet(css))).get(scope)?.get(name)?.value;

  it('keeps a theme and its dark block apart, inheriting from the default of the same mode', () => {
    const vars = collectVars(sheet(kernel));
    expect([...vars.keys()]).toEqual(['default', 'dark', 'a', 'a dark']);
    expect(value(kernel, 'a', 'bg')).toBe('#fff');
    expect(value(kernel, 'a', 'warn')).toBe('#800000');
    expect(value(kernel, 'a dark', 'bg')).toBe('#000');
    expect(value(kernel, 'a dark', 'warn')).toBe('#ff9a9a');
    const findings = checkTokens(varsAsTokens(vars), { target: 'AA', pairs: [{ fg: 'warn', bg: 'bg' }], autoPair: true });
    expect(findings).toEqual([]);
  });

  it('evaluates the light block of a non-default theme', () => {
    const css = kernel.replace("[data-theme='a'] { --bg: #fff;", "[data-theme='a'] { --bg: #7a0000;");
    const msgs = checkTokens(varsAsTokens(collectVars(sheet(css))), { target: 'AA', pairs: [{ fg: 'warn', bg: 'bg' }], autoPair: true }).map((f) => f.message);
    expect(msgs).toEqual(['warn on bg [a]: 1.05:1, needs 4.5:1.']);
  });

  it('reads theme and mode in any order, from classes, attributes and prefers-color-scheme', () => {
    const scopes = (css: string) => [...collectVars(sheet(css)).keys()].filter((k) => k !== 'default');
    expect(scopes(`[data-theme="x"].dark { --a: #000; }`)).toEqual(['x dark']);
    expect(scopes(`.dark[data-theme="x"] { --a: #000; }`)).toEqual(['x dark']);
    expect(scopes(`.dark [data-theme="x"] { --a: #000; }`)).toEqual(['x dark']);
    expect(scopes(`[data-theme="x"] .dark { --a: #000; }`)).toEqual(['x dark']);
    expect(scopes(`.theme-x.dark { --a: #000; }`)).toEqual(['theme-x dark']);
    expect(scopes(`[data-theme="x"][data-mode="dark"] { --a: #000; }`)).toEqual(['x dark']);
    expect(scopes(`[data-theme="dark"] { --a: #000; }`)).toEqual(['dark']);
    expect(scopes(`@media (prefers-color-scheme: dark) { :root { --a: #000; } [data-theme="x"] { --a: #111; } }`)).toEqual(['dark', 'x dark']);
    expect(scopes(`:root { &.dark { --a: #000; } }`)).toEqual(['dark']);
    // A component that happens to carry `.dark` is not a theme.
    expect(scopes(`.card.dark { --a: #000; }`)).toEqual([]);
  });

  it('lets a theme light value reach its dark mode only when neither dark block redeclares it', () => {
    const css = `
      :root { --bg: #fff; --ink: #111; --accent: #00f; }
      :root.dark { --bg: #000; --ink: #eee; }
      [data-theme='a'] { --ink: #222; --accent: #0a0; }
      [data-theme='a'].dark { --bg: #010101; }
    `;
    expect(value(css, 'a dark', 'bg')).toBe('#010101'); // own dark block
    expect(value(css, 'a dark', 'accent')).toBe('#0a0'); // theme light block, default never overrides it
    expect(value(css, 'dark', 'accent')).toBe('#00f');
  });
});
