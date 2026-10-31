import type { Config } from './config.js';
import { checkContrast } from './contrast/index.js';
import { lintStatic } from './engine.js';
import { evaluate, STATIC_CRITERIA, type ConformanceInput, type CriterionResult } from './report/conformance.js';
import { scanRuntime } from './runtime/index.js';
import type { Finding } from './types.js';

export interface RunOptions {
  paths?: string[];
  /** Run the Playwright + axe scan (needs urls or a Storybook build in config.runtime). */
  runtime?: boolean;
}

export interface RunResult {
  findings: Finding[];
  conformance: CriterionResult[];
  conformanceInput: ConformanceInput;
  parseErrors: { file: string; message: string }[];
}

export async function run(cwd: string, config: Config, options: RunOptions = {}): Promise<RunResult> {
  const result = await lintStatic(cwd, config, options.paths);
  const findings = [...result.findings, ...checkContrast(cwd, config, result)];
  const covered = new Set(STATIC_CRITERIA);
  let pages: string[] = [];
  if (options.runtime) {
    const runtime = await scanRuntime(cwd, config);
    findings.push(...runtime.findings);
    for (const c of runtime.covered) covered.add(c);
    pages = runtime.pages;
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  const conformanceInput: ConformanceInput = {
    level: config.level,
    findings,
    evidence: result.evidence,
    covered,
    filesScanned: result.docs.length + result.stylesheets.length,
    pagesScanned: pages,
  };
  return { findings, conformance: evaluate(conformanceInput), conformanceInput, parseErrors: result.errors };
}

export { DEFAULT_CONFIG, loadConfig, type Config } from './config.js';
export type { Finding, Rule } from './types.js';
export { rules } from './rules/index.js';
export { CRITERIA } from './wcag.js';
