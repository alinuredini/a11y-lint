import type { Config } from '../config.js';
import type { StaticResult } from '../engine.js';
import type { Finding } from '../types.js';
import { inScope } from '../wcag.js';
import { checkReducedMotion, checkStylesheet, collectVars, type Stylesheet } from './css.js';
import { checkTailwind, hasMotionGuardClasses, tailwindTheme, usesTailwind } from './tailwind.js';
import { checkTokens, loadTokens, varsAsTokens } from './tokens.js';

/** Design-token, stylesheet and Tailwind contrast plus CSS focus/motion checks. */
export function checkContrast(cwd: string, config: Config, result: StaticResult): Finding[] {
  const sheets: Stylesheet[] = [
    ...result.stylesheets,
    ...result.docs.flatMap((d) => d.styles.map((s) => ({ file: d.file, css: s.css, lang: s.lang, line: s.line }))),
  ];
  const projectVars = collectVars(sheets);
  const twTheme = usesTailwind(cwd) ? tailwindTheme(cwd) : undefined;
  const vars = twTheme ? collectVars([twTheme, ...sheets]) : projectVars;
  const target = config.level;
  const { tokens, pairs, autoPair } = config.contrast;

  const tokenSets = [varsAsTokens(projectVars)];
  if (Array.isArray(tokens) ? tokens.length : Object.keys(tokens).length) tokenSets.push(loadTokens(cwd, tokens));

  const findings = [
    ...sheets.flatMap((sheet) => checkStylesheet(sheet, { target, vars })),
    ...tokenSets.flatMap((set) => checkTokens(set, { target, pairs, autoPair })),
    ...(twTheme ? checkTailwind(result.docs, vars, target) : []),
    ...(target === 'AAA' ? checkReducedMotion(sheets, hasMotionGuardClasses(result.docs)) : []),
  ];
  return findings.filter((f) => inScope(f.level, target) && config.rules[f.ruleId] !== 'off');
}
