import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { walk, type IRDocument, type IRElement } from '../ir.js';
import { classes } from '../rules/helpers.js';
import type { Finding } from '../types.js';
import type { Level } from '../wcag.js';
import type { Rgb } from 'culori';
import { contrast, failedThreshold, parseColor } from './color.js';
import { resolveVars, type Stylesheet, type ThemeVars } from './css.js';

/** True when the project depends on Tailwind CSS. */
export function usesTailwind(cwd: string): boolean {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return false;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return Boolean(pkg.dependencies?.tailwindcss ?? pkg.devDependencies?.tailwindcss);
}

/** Tailwind v4's default palette (`--color-red-500: oklch(...)`), from the project's install. */
export function tailwindTheme(cwd: string): Stylesheet | undefined {
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
  fg?: string;
  bg?: string;
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

function paintOf(el: IRElement, theme: string): Paint {
  const paint: Paint = {};
  for (const cls of classes(el) ?? []) {
    const m = /^(?:(dark):)?(text|bg)-(.+)$/.exec(cls);
    if (!m) continue;
    const [, variant, kind, value] = m;
    // Base classes apply in every theme; `dark:` ones override them in the dark theme.
    if (variant && variant !== theme) continue;
    if (!variant && (kind === 'text' ? paint.fg : paint.bg) && theme !== 'default') continue;
    if (kind === 'text') paint.fg = value;
    else paint.bg = value;
  }
  return paint;
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

/** Checks text elements whose colour and background both come from Tailwind classes in the same file. */
export function checkTailwind(docs: IRDocument[], vars: ThemeVars, target: Level): Finding[] {
  const findings: Finding[] = [];
  const themes = vars.has('dark') ? ['default', 'dark'] : ['default'];
  for (const doc of docs) {
    for (const el of walk(doc.root)) {
      if (el.isComponent || !hasOwnText(el)) continue;
      let defaultRatio: number | undefined;
      for (const theme of themes) {
        // Text colour and background inherit independently: nearest ancestor that sets each wins.
        let fgc: Rgb | undefined;
        let bgc: Rgb | undefined;
        for (const node of [el, ...ancestorsOf(el)]) {
          const paint = paintOf(node, theme);
          if (paint.fg) fgc ??= utilityColor(paint.fg, vars, theme);
          if (paint.bg) bgc ??= utilityColor(paint.bg, vars, theme);
          if (fgc && bgc) break;
        }
        if (!fgc || !bgc) continue;
        const size = textSize(el);
        const { ratio, uncertain } = contrast(fgc, bgc);
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
