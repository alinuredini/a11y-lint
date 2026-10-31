import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { basename, join } from 'node:path';
import { walk, type IRDocument, type IRElement } from '../ir.js';
import { classes, isAriaHidden } from '../rules/helpers.js';
import type { Finding } from '../types.js';
import type { Level } from '../wcag.js';
import type { Rgb } from 'culori';
import { contrast, failedThreshold, markCovered, parseColor } from './color.js';
import { resolveVars, type Stylesheet, type ThemeVars } from './css.js';

/** True when the project depends on Tailwind CSS. */
export function usesTailwind(cwd: string): boolean {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return false;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return Boolean(pkg.dependencies?.tailwindcss ?? pkg.devDependencies?.tailwindcss);
}

const V3_CONFIGS = ['tailwind.config.ts', 'tailwind.config.mts', 'tailwind.config.cts', 'tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs'];

/**
 * The project's Tailwind colours as `--color-*` variables: v3 from `tailwind.config.*`,
 * v4 from the installed `tailwindcss/theme.css` (the project's own `@theme` blocks are read with its CSS).
 */
export async function tailwindTheme(cwd: string): Promise<Stylesheet | undefined> {
  const require = createRequire(join(cwd, 'package.json'));
  const config = V3_CONFIGS.map((f) => join(cwd, f)).find(existsSync);
  if (config && tailwindMajor(cwd, require) !== 4) return tailwindV3Theme(config, require);
  return tailwindV4Theme(cwd);
}

/** Major version from the project's declared range (`^3.4.0`), else from the installed package. */
function tailwindMajor(cwd: string, require: NodeJS.Require): number | undefined {
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  const range: string | undefined = pkg.dependencies?.tailwindcss ?? pkg.devDependencies?.tailwindcss;
  const declared = range && /(\d+)/.exec(range);
  if (declared) return Number(declared[1]);
  try {
    return Number(JSON.parse(readFileSync(require.resolve('tailwindcss/package.json'), 'utf8')).version.split('.')[0]);
  } catch {
    return undefined;
  }
}

/** Runs the project's tailwind.config like Tailwind itself does, then flattens `theme.colors`. */
async function tailwindV3Theme(configFile: string, require: NodeJS.Require): Promise<Stylesheet | undefined> {
  let config: Record<string, any>;
  try {
    const mod = await import(pathToFileURL(configFile).href);
    config = mod.default ?? mod;
  } catch {
    return undefined; // e.g. a TypeScript config on a Node without type stripping
  }
  let colors: Record<string, unknown> = { white: '#ffffff', black: '#000000', transparent: 'transparent' };
  try {
    const resolveConfig = require('tailwindcss/resolveConfig');
    const theme = (resolveConfig.default ?? resolveConfig)(config).theme;
    colors = { ...colors, ...theme.colors, ...theme.textColor, ...theme.backgroundColor };
  } catch {
    // tailwindcss not installed: only the colours the config spells out
    const theme = config.theme ?? {};
    const resolved = (v: unknown) => (typeof v === 'function' ? {} : (v ?? {}));
    colors = { ...colors, ...resolved(theme.colors), ...resolved(theme.extend?.colors), ...resolved(theme.extend?.textColor), ...resolved(theme.extend?.backgroundColor) };
  }
  const decls: string[] = [];
  const flatten = (prefix: string, value: unknown) => {
    if (typeof value === 'function') value = value({ opacityValue: '1', opacityVariable: '' });
    if (typeof value === 'string') {
      decls.push(`  --color-${prefix}: ${value.replace(/<alpha-value>/g, '1')};`);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) flatten(k === 'DEFAULT' ? prefix : `${prefix}-${k}`, v);
    }
  };
  for (const [name, value] of Object.entries(colors)) flatten(name, value);
  return { file: basename(configFile), css: `:root {\n${decls.join('\n')}\n}`, lang: 'css' };
}

function tailwindV4Theme(cwd: string): Stylesheet | undefined {
  for (const base of [join(cwd, 'package.json'), import.meta.url]) {
    try {
      const file = createRequire(base).resolve('tailwindcss/theme.css');
      return { file: 'tailwindcss/theme.css', css: readFileSync(file, 'utf8'), lang: 'css' };
    } catch {
      // try the next location
    }
  }
  return undefined;
}

interface Paint {
  fg?: Rgb;
  bg?: Rgb;
}

const SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];

/** Resolves `gray-400`, `white/50`, `[#333]` to a colour via the theme's `--color-*` vars. */
function utilityColor(name: string, vars: ThemeVars, theme: string): Rgb | undefined {
  const [base, opacity] = name.split('/');
  let color: string | undefined;
  if (base.startsWith('[') && base.endsWith(']')) color = base.slice(1, -1).replace(/_/g, ' ');
  else if (SIZES.includes(base)) return undefined;
  else color = resolveVars(`var(--color-${base})`, vars, theme);
  const rgb = color ? parseColor(color) : undefined;
  if (!rgb || !opacity) return rgb;
  const alpha = opacity.startsWith('[') ? Number.parseFloat(opacity.slice(1)) : Number(opacity) / 100;
  return { ...rgb, alpha: (rgb.alpha ?? 1) * alpha };
}

/** Text colour and background set on this element. Classes that aren't colours (`text-sm`, `bg-cover`) are skipped. */
function paintOf(el: IRElement, theme: string, vars: ThemeVars): Paint {
  const paint: Paint = {};
  const fromVariant: Paint = {};
  for (const cls of classes(el) ?? []) {
    const m = /^(?:(dark):)?(text|bg)-(.+)$/.exec(cls);
    if (!m) continue;
    const [, variant, kind, value] = m;
    if (variant && variant !== theme) continue;
    const color = utilityColor(value, vars, theme);
    if (!color) continue;
    const key = kind === 'text' ? 'fg' : 'bg';
    // `dark:` classes override base classes in the dark theme, whatever their order.
    if (variant) fromVariant[key] = color;
    else paint[key] = color;
  }
  return { fg: fromVariant.fg ?? paint.fg, bg: fromVariant.bg ?? paint.bg };
}

function textSize(el: IRElement): 'normal' | 'large' {
  const cls = [el, ...ancestorsOf(el)].flatMap((e) => classes(e) ?? []);
  const size = cls.map((c) => /^text-(xs|sm|base|lg|xl|[2-9]xl)$/.exec(c)?.[1]).find(Boolean);
  const bold = cls.some((c) => /^font-(bold|extrabold|black)$/.test(c));
  if (!size) return 'normal';
  const idx = SIZES.indexOf(size);
  return idx >= SIZES.indexOf('2xl') || (size === 'xl' && bold) ? 'large' : 'normal';
}

function* ancestorsOf(el: IRElement): Generator<IRElement> {
  for (let p = el.parent; p; p = p.parent) yield p;
}

function hasOwnText(el: IRElement): boolean {
  return el.children.some((c) => c.type === 'text' && (c.dynamic || c.value.trim() !== ''));
}

/** The theme's page background, for compositing translucent backgrounds like `bg-primary/10`. */
function pageColor(vars: ThemeVars, theme: string): Rgb | undefined {
  for (const name of ['--color-background', '--background', '--color-bg', '--bg']) {
    const value = resolveVars(`var(${name})`, vars, theme);
    const rgb = value && parseColor(value);
    if (rgb && (rgb.alpha ?? 1) === 1) return rgb;
  }
  return theme === 'dark' ? { mode: 'rgb', r: 0, g: 0, b: 0 } : undefined;
}

/** Checks text elements whose colour and background both come from Tailwind classes in the same file. */
export function checkTailwind(docs: IRDocument[], vars: ThemeVars, target: Level, covered?: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const usesDarkClasses = docs.some((doc) => [...walk(doc.root)].some((el) => (classes(el) ?? []).some((c) => c.startsWith('dark:'))));
  const themes = vars.has('dark') || usesDarkClasses ? ['default', 'dark'] : ['default'];
  for (const doc of docs) {
    for (const el of walk(doc.root)) {
      if (el.isComponent || !hasOwnText(el)) continue;
      // Decorative (aria-hidden) subtrees are exempt.
      if ([el, ...ancestorsOf(el)].some(isAriaHidden)) continue;
      let defaultRatio: number | undefined;
      for (const theme of themes) {
        // Text colour and background inherit independently: nearest ancestor that sets each wins.
        let fgc: Rgb | undefined;
        let bgc: Rgb | undefined;
        for (const node of [el, ...ancestorsOf(el)]) {
          const paint = paintOf(node, theme, vars);
          fgc ??= paint.fg;
          bgc ??= paint.bg;
          if (fgc && bgc) break;
        }
        if (!fgc || !bgc || (bgc.alpha ?? 1) === 0) continue;
        const size = textSize(el);
        const { ratio, uncertain } = contrast(fgc, bgc, pageColor(vars, theme));
        markCovered(covered, size, target);
        if (theme === 'default') defaultRatio = ratio;
        else if (ratio === defaultRatio) continue; // same colours in both themes: already reported
        const failed = failedThreshold(ratio, size, target);
        if (!failed) continue;
        const cls = (classes(el) ?? []).filter((c) => /^(dark:)?(text|bg)-/.test(c)).join(' ');
        findings.push({
          ruleId: 'tailwind-contrast',
          criteria: [failed.criterion],
          level: failed.level,
          status: uncertain ? 'unknown' : 'fail',
          message: `<${el.rawName} class="${cls}">${theme === 'dark' ? ' (dark)' : ''}: ${ratio.toFixed(2)}:1, needs ${failed.min}:1.`,
          file: doc.file,
          line: el.loc.line,
          column: el.loc.column,
          source: 'contrast',
        });
      }
    }
  }
  return findings;
}

/** `motion-safe:` / `motion-reduce:` utilities count as handling prefers-reduced-motion. */
export function hasMotionGuardClasses(docs: IRDocument[]): boolean {
  return docs.some((doc) => [...walk(doc.root)].some((el) => (classes(el) ?? []).some((c) => /^motion-(safe|reduce):/.test(c))));
}
