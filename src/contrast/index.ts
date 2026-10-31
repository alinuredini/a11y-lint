import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config } from '../config.js';
import type { StaticResult } from '../engine.js';
import type { IRDocument } from '../ir.js';
import type { Finding } from '../types.js';
import { inScope } from '../wcag.js';
import { checkReducedMotion, checkStylesheet, collectVars, type Stylesheet } from './css.js';
import { checkTailwind, hasMotionGuardClasses, tailwindTheme, usesTailwind } from './tailwind.js';
import { checkTokens, loadTokens, varsAsTokens } from './tokens.js';

/** Standalone HTML pages (prototypes, mocks) define their own variables; they must not leak into the app's. */
const isPage = (file: string) => /\.html?$/.test(file) && !/\.component\.html$/.test(file);

/** Top-level folders that hold design explorations rather than the app. */
const NON_APP = /^(docs?|documentation|prototypes?|mocks?|mockups?|design|specs?|examples?|playground|sandbox)$/i;

/**
 * Variables are shared across one package's app code (`styles/` reaches `components/`), but not
 * with its docs or prototypes, and `apps/web` doesn't see `apps/admin`.
 */
function scopeKey(cwd: string, file: string): string {
  if (isPage(file)) return file;
  let dir = dirname(file);
  while (dir !== '.' && !existsSync(join(cwd, dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const rel = dir === '.' ? file : file.slice(dir.length + 1);
  const top = rel.includes('/') ? rel.split('/')[0] : '';
  return `${dir}::${NON_APP.test(top) ? top : 'app'}`;
}

/**
 * Design-token, stylesheet and Tailwind contrast plus CSS focus/motion checks.
 * `covered` lists only criteria for which at least one pair or rule was evaluated.
 */
export async function checkContrast(cwd: string, config: Config, result: StaticResult): Promise<{ findings: Finding[]; covered: Set<string> }> {
  const sheets: Stylesheet[] = [
    ...result.stylesheets,
    ...result.docs.flatMap((d) => d.styles.map((s) => ({ file: d.file, css: s.css, lang: s.lang, line: s.line }))),
  ];
  const twTheme = usesTailwind(cwd) ? await tailwindTheme(cwd) : undefined;
  const target = config.level;
  const { tokens, pairs, autoPair } = config.contrast;
  const covered = new Set<string>(target === 'AAA' ? ['2.3.3'] : []);
  const findings: Finding[] = [];

  const scopes = new Map<string, { sheets: Stylesheet[]; docs: IRDocument[] }>();
  const scopeOf = (file: string) => {
    const key = scopeKey(cwd, file);
    if (!scopes.has(key)) scopes.set(key, { sheets: [], docs: [] });
    return scopes.get(key)!;
  };
  for (const sheet of sheets) scopeOf(sheet.file).sheets.push(sheet);
  for (const doc of result.docs) scopeOf(doc.file).docs.push(doc);

  for (const scope of scopes.values()) {
    const ownVars = collectVars(scope.sheets);
    const vars = twTheme ? collectVars([twTheme, ...scope.sheets]) : ownVars;
    for (const sheet of scope.sheets) findings.push(...checkStylesheet(sheet, { target, vars, covered }));
    findings.push(...checkTokens(varsAsTokens(ownVars), { target, pairs, autoPair, covered }));
    if (twTheme) findings.push(...checkTailwind(scope.docs, vars, target, covered));
  }
  if (Array.isArray(tokens) ? tokens.length : Object.keys(tokens).length) {
    findings.push(...checkTokens(loadTokens(cwd, tokens), { target, pairs, autoPair, covered }));
  }
  if (target === 'AAA') findings.push(...checkReducedMotion(sheets, hasMotionGuardClasses(result.docs)));
  return { findings: findings.filter((f) => inScope(f.level, target) && config.rules[f.ruleId] !== 'off'), covered };
}
