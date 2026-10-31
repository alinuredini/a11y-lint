import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { glob } from 'tinyglobby';
import { adapterFor } from './adapters/index.js';
import type { Config } from './config.js';
import { DYNAMIC, walk, type IRDocument } from './ir.js';
import { ImportResolver } from './resolve.js';
import { rules } from './rules/index.js';
import type { Finding, RuleContext } from './types.js';
import { inScope, levelOf } from './wcag.js';

export interface StaticResult {
  findings: Finding[];
  docs: IRDocument[];
  /** Standalone stylesheets found by the include globs. */
  stylesheets: { file: string; css: string; lang: 'css' | 'scss' }[];
  /** Element counts per tag across all files, for the manual checklist. */
  evidence: Map<string, Set<string>>;
  errors: { file: string; message: string }[];
}

export async function findFiles(cwd: string, config: Config, paths: string[] = []): Promise<string[]> {
  const patterns = paths.length
    ? paths.flatMap((p) => (/\.[a-z]+$/i.test(p) ? [p] : config.include.map((i) => `${p.replace(/\/$/, '')}/${i}`)))
    : config.include;
  return glob(patterns, { cwd, ignore: config.exclude, absolute: true });
}

export async function lintStatic(cwd: string, config: Config, paths: string[] = []): Promise<StaticResult> {
  const files = await findFiles(cwd, config, paths);
  const result: StaticResult = { findings: [], docs: [], stylesheets: [], evidence: new Map(), errors: [] };
  const activeRules = rules.filter((r) => config.rules[r.id] !== 'off');

  // Parse everything first so components imported from other files can be resolved.
  for (const abs of files.sort()) {
    const file = relative(cwd, abs);
    const source = await readFile(abs, 'utf8');
    if (/\.s?css$/.test(file)) {
      result.stylesheets.push({ file, css: source, lang: file.endsWith('.scss') ? 'scss' : 'css' });
      continue;
    }
    const adapter = adapterFor(file);
    if (!adapter) continue;
    try {
      result.docs.push(await adapter(file, source));
    } catch (err) {
      result.errors.push({ file, message: err instanceof Error ? err.message.split('\n')[0] : String(err) });
    }
  }
  await new ImportResolver(cwd, result.docs).link(result.docs);

  for (const doc of result.docs) {
    const file = doc.file;
    applyComponentMap(doc, config.components);
    for (const el of walk(doc.root)) {
      if (el === doc.root || el.isComponent) continue;
      if (!result.evidence.has(el.tag)) result.evidence.set(el.tag, new Set());
      result.evidence.get(el.tag)!.add(file);
    }

    for (const rule of activeRules) {
      const ctx: RuleContext = {
        doc,
        target: config.level,
        report(el, status, message, criteria = rule.criteria) {
          const level = levelOf(criteria);
          if (!inScope(level, config.level)) return;
          result.findings.push({ ruleId: rule.id, criteria, level, status, message, file, line: el.loc.line, column: el.loc.column, source: 'static' });
        },
      };
      rule.checkDocument?.(ctx);
      if (rule.check) for (const el of walk(doc.root)) if (el !== doc.root && !el.isComponent) rule.check(el, ctx);
    }
  }
  return result;
}

/** Renderers whose components are not DOM elements, so `Image` or `Link` there is not `<img>`/`<a>`. */
const NON_DOM_SOURCES = /^(react-native(-.*)?|@react-native\/.*|expo-.*|@react-pdf\/.*|@react-three\/.*|ink|@react-email\/.*)$/;

/**
 * Treats configured components as the element they render, e.g. `Link` → `a[href]`.
 * Other components fall back to the root tag of their definition (same file or resolved import);
 * their props may set any attribute, so they are marked as spread.
 */
export function applyComponentMap(doc: IRDocument, map: Record<string, string>): void {
  for (const el of walk(doc.root)) {
    if (!el.isComponent) continue;
    if (el.importSource && NON_DOM_SOURCES.test(el.importSource)) continue;
    const spec = map[el.rawName];
    if (!spec) {
      if (el.localTag) {
        el.tag = el.localTag;
        el.isComponent = false;
        el.hasSpread = true;
      }
      continue;
    }
    const m = /^([a-z][a-z0-9-]*)((?:\[[a-z-]+\])*)$/i.exec(spec);
    if (!m) continue;
    el.tag = m[1].toLowerCase();
    el.isComponent = false;
    for (const [, attr] of m[2].matchAll(/\[([a-z-]+)\]/gi)) if (!el.attrs.has(attr)) el.attrs.set(attr, DYNAMIC);
  }
}
