import postcss, { type AtRule, type Container, type Declaration, type Root, type Rule as CssRule } from 'postcss';
import scss from 'postcss-scss';
import type { Finding } from '../types.js';
import type { Level } from '../wcag.js';
import { contrast, failedThreshold, isLargeText, markCovered, parseColor } from './color.js';

export interface Stylesheet {
  file: string;
  css: string;
  lang: 'css' | 'scss';
  /** Line offset for `<style>` blocks inside a component. */
  line?: number;
}

export interface VarDef {
  value: string;
  file: string;
  line: number;
}

/** Custom properties per theme. `default` is `:root`; other themes override it. */
export type ThemeVars = Map<string, Map<string, VarDef>>;

export function parseSheet(sheet: Stylesheet): Root | undefined {
  try {
    return sheet.lang === 'scss' ? scss.parse(sheet.css, { from: sheet.file }) : postcss.parse(sheet.css, { from: sheet.file });
  } catch {
    return undefined;
  }
}

function lineOf(node: { source?: { start?: { line: number } } }, sheet: Stylesheet): number {
  return (node.source?.start?.line ?? 1) + (sheet.line ? sheet.line - 1 : 0);
}

/** Which theme a custom property declaration belongs to, or undefined for component-scoped vars. */
function themeOf(decl: Declaration): string | undefined {
  let theme: string | undefined;
  for (let node: Container | undefined = decl.parent as Container; node; node = node.parent as Container | undefined) {
    if (node.type === 'atrule') {
      const at = node as AtRule;
      if (at.name === 'theme') theme ??= 'default';
      if (at.name === 'media' && /prefers-color-scheme:\s*dark/.test(at.params)) return 'dark';
    } else if (node.type === 'rule') {
      const selectors = (node as CssRule).selectors;
      for (const sel of selectors) {
        const named = /\[data-[a-z-]*(?:theme|mode|scheme)[a-z-]*=["']?([\w-]+)/i.exec(sel) ?? /^(?::root|html|body)?\.(dark|light|high-contrast|theme-[\w-]+|[\w-]+-theme)$/.exec(sel.trim());
        if (named) return named[1];
        if (/^(:root|html|:host|body)$/.test(sel.trim())) theme ??= 'default';
      }
      if (theme === undefined) return undefined;
    }
  }
  return theme;
}

export function collectVars(sheets: Stylesheet[], vars: ThemeVars = new Map()): ThemeVars {
  for (const sheet of sheets) {
    const root = parseSheet(sheet);
    root?.walkDecls(/^--/, (decl) => {
      const theme = themeOf(decl);
      if (!theme) return;
      if (!vars.has(theme)) vars.set(theme, new Map());
      vars.get(theme)!.set(decl.prop, { value: decl.value, file: sheet.file, line: lineOf(decl, sheet) });
    });
  }
  if (!vars.has('default')) vars.set('default', new Map());
  return vars;
}

/** Substitutes `var(--x, fallback)` using the theme's values, falling back to `default`. */
export function resolveVars(value: string, vars: ThemeVars, theme: string, depth = 0): string | undefined {
  if (depth > 10) return undefined;
  if (!value.includes('var(')) return value;
  let failed = false;
  const out = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name: string, fallback?: string) => {
    const def = vars.get(theme)?.get(name) ?? vars.get('default')?.get(name);
    const raw = def?.value ?? fallback;
    const resolved = raw === undefined ? undefined : resolveVars(raw, vars, theme, depth + 1);
    if (resolved === undefined) failed = true;
    return resolved ?? '';
  });
  return failed ? undefined : resolveVars(out, vars, theme, depth + 1);
}

function fontPx(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^([\d.]+)(px|rem|em|pt)$/.exec(value.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'px' ? n : m[2] === 'pt' ? (n * 4) / 3 : n * 16;
}

function fontWeight(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (value === 'bold' || value === 'bolder') return 700;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

/** Background colour from `background` shorthand or `background-color`. */
function backgroundColor(value: string): string | undefined {
  if (/gradient|url\(/.test(value)) return undefined;
  return value.trim();
}

export interface CssCheckOptions {
  target: Level;
  vars: ThemeVars;
  /** Receives the criteria that were actually evaluated. */
  covered?: Set<string>;
}

/** Contrast for rules that set both color and background, plus removed focus outlines. */
export function checkStylesheet(sheet: Stylesheet, { target, vars, covered }: CssCheckOptions): Finding[] {
  const findings: Finding[] = [];
  const root = parseSheet(sheet);
  if (!root) return findings;
  const themes = [...vars.keys()];
  // A `:focus-within` rule that draws a ring or border can stand in for the removed outline.
  const focusWithinReplacement = /:focus-within\s*\{[^}]*(box-shadow|border|outline\s*:\s*(?!none|0))/.test(sheet.css);

  root.walkRules((rule) => {
    const decls = new Map<string, string>();
    rule.each((n) => {
      if (n.type === 'decl') decls.set(n.prop.toLowerCase(), n.value);
    });
    const line = lineOf(rule, sheet);
    const base = { file: sheet.file, line, column: 1, source: 'contrast' as const };

    // Contrast: only rules that set both, so we never guess what is behind the text.
    const fgRaw = decls.get('color');
    const bgRaw = decls.get('background-color') ?? (decls.get('background') && backgroundColor(decls.get('background')!));
    if (fgRaw && bgRaw) {
      const size = isLargeText(fontPx(decls.get('font-size')), fontWeight(decls.get('font-weight'))) ? 'large' : 'normal';
      const usesVars = fgRaw.includes('var(') || bgRaw.includes('var(');
      const seen = new Set<string>();
      for (const theme of usesVars ? themes : ['default']) {
        const fg = resolveVars(fgRaw, vars, theme);
        const bg = resolveVars(bgRaw, vars, theme);
        const fgc = fg && parseColor(fg);
        const bgc = bg && parseColor(bg);
        // A fully transparent background shows whatever is behind it, which we can't know here.
        if (!fgc || !bgc || (bgc.alpha ?? 1) === 0) continue;
        if (seen.has(`${fg}|${bg}`)) continue; // same colours in another theme
        seen.add(`${fg}|${bg}`);
        const { ratio, uncertain } = contrast(fgc, bgc);
        markCovered(covered, size, target);
        const failed = failedThreshold(ratio, size, target);
        if (!failed) continue;
        const where = usesVars && themes.length > 1 ? ` (${theme} theme)` : '';
        findings.push({
          ...base,
          ruleId: 'color-contrast',
          criteria: [failed.criterion],
          level: failed.level,
          status: uncertain ? 'unknown' : 'fail',
          message: `\`${rule.selector}\`${where}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${failed.min}:1.`,
        });
      }
    }

    // Focus: `outline: none` inside a :focus rule with nothing to replace it.
    if (/:focus(?!-within)/.test(rule.selector) && !/:not\(:focus-visible\)/.test(rule.selector)) {
      const outline = decls.get('outline') ?? decls.get('outline-style') ?? decls.get('outline-width');
      if (outline && /^(none|0(px)?)$/.test(outline.trim())) {
        const replaced = [...decls.keys()].some((p) => /^(box-shadow|border|background|text-decoration)/.test(p));
        if (!replaced) {
          findings.push({
            ...base,
            ruleId: 'focus-outline-removed',
            criteria: ['2.4.7'],
            level: 'AA',
            status: focusWithinReplacement ? 'unknown' : 'fail',
            message: focusWithinReplacement
              ? `\`${rule.selector}\` removes the focus outline; a :focus-within rule may replace it, verify.`
              : `\`${rule.selector}\` removes the focus outline without a replacement style.`,
          });
        }
      }
    }
  });
  return findings;
}

/** 2.3.3 (AAA): animations should respect prefers-reduced-motion somewhere in the project. */
export function checkReducedMotion(sheets: Stylesheet[], classGuard: boolean): Finding[] {
  let firstAnimation: { file: string; line: number } | undefined;
  let guarded = classGuard;
  for (const sheet of sheets) {
    if (/prefers-reduced-motion/.test(sheet.css)) guarded = true;
    if (firstAnimation) continue;
    const root = parseSheet(sheet);
    root?.walk((node) => {
      if (firstAnimation) return;
      if ((node.type === 'atrule' && node.name === 'keyframes') || (node.type === 'decl' && /^animation(-name)?$/.test(node.prop) && node.value !== 'none')) {
        firstAnimation = { file: sheet.file, line: lineOf(node, sheet) };
      }
    });
  }
  if (!firstAnimation || guarded) return [];
  return [
    {
      ruleId: 'reduced-motion',
      criteria: ['2.3.3'],
      level: 'AAA',
      status: 'fail',
      message: 'Animations are defined but no stylesheet respects prefers-reduced-motion.',
      ...firstAnimation,
      column: 1,
      source: 'contrast',
    },
  ];
}
