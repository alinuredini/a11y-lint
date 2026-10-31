import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Config } from '../config.js';
import type { Finding } from '../types.js';
import { inScope, levelOf, type Level } from '../wcag.js';
import { keyboardWalk } from './keyboard.js';
import { serveStatic } from './serve.js';

export interface RuntimeResult {
  findings: Finding[];
  pages: string[];
  /** Criteria axe or the keyboard walk evaluated on at least one page. */
  covered: Set<string>;
}

const AXE_TAGS: Record<Level, string[]> = {
  A: ['wcag2a', 'wcag21a'],
  AA: ['wcag2a', 'wcag21a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
  AAA: ['wcag2a', 'wcag21a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'wcag2aaa', 'wcag21aaa', 'wcag22aaa'],
};

/** `wcag143` → `1.4.3` */
function criteriaFromTags(tags: string[]): string[] {
  return tags.flatMap((t) => {
    const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(t);
    return m ? [`${m[1]}.${m[2]}.${m[3]}`] : [];
  });
}

async function loadPlaywright() {
  try {
    const { chromium } = await import('playwright');
    const { AxeBuilder } = await import('@axe-core/playwright');
    return { chromium, AxeBuilder };
  } catch {
    throw new Error('Runtime scans need Playwright and axe: npm i -D playwright @axe-core/playwright && npx playwright install chromium');
  }
}

function storybookUrls(dir: string, base: string): string[] {
  const index = ['index.json', 'stories.json'].map((f) => resolve(dir, f)).find(existsSync);
  if (!index) throw new Error(`No index.json in ${dir}. Run "storybook build" first.`);
  const data = JSON.parse(readFileSync(index, 'utf8')) as { entries?: Record<string, { id: string; type?: string }>; stories?: Record<string, { id: string }> };
  const entries = Object.values(data.entries ?? data.stories ?? {}).filter((e) => !('type' in e) || e.type === 'story');
  return entries.map((e) => `${base}/iframe.html?id=${encodeURIComponent(e.id)}&viewMode=story`);
}

export async function scanRuntime(cwd: string, config: Config): Promise<RuntimeResult> {
  const { chromium, AxeBuilder } = await loadPlaywright();
  const urls = [...config.runtime.urls];
  let server: Awaited<ReturnType<typeof serveStatic>> | undefined;
  if (config.runtime.storybook) {
    server = await serveStatic(resolve(cwd, config.runtime.storybook));
    urls.push(...storybookUrls(resolve(cwd, config.runtime.storybook), server.url));
  }
  const result: RuntimeResult = { findings: [], pages: urls, covered: new Set() };
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    for (const url of urls) {
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      } catch (err) {
        result.findings.push({ ruleId: 'page-load', criteria: [], level: 'A', status: 'unknown', message: `Could not load: ${(err as Error).message.split('\n')[0]}`, file: url, line: 1, column: 1, source: 'runtime' });
        await page.close();
        continue;
      }
      const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS[config.level]).analyze();
      for (const group of [axe.violations, axe.incomplete, axe.passes, axe.inapplicable]) {
        for (const rule of group) for (const c of criteriaFromTags(rule.tags)) result.covered.add(c);
      }
      for (const [status, group] of [['fail', axe.violations], ['unknown', axe.incomplete]] as const) {
        for (const rule of group) {
          const criteria = criteriaFromTags(rule.tags);
          if (!criteria.length) continue;
          for (const node of rule.nodes) {
            result.findings.push({
              ruleId: `axe/${rule.id}`,
              criteria,
              level: levelOf(criteria),
              status,
              message: `${rule.help} → ${node.target.join(' ')}${node.failureSummary ? ` (${node.failureSummary.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim()})` : ''}`,
              file: url,
              line: 1,
              column: 1,
              source: 'runtime',
            });
          }
        }
      }
      if (config.runtime.keyboard) {
        for (const f of await keyboardWalk(page, url, config.runtime.maxTabStops)) result.findings.push(f);
        for (const c of ['2.1.2', '2.4.7', '2.4.11']) result.covered.add(c);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await server?.close();
  }
  result.findings = result.findings.filter((f) => f.ruleId === 'page-load' || (inScope(f.level, config.level) && config.rules[f.ruleId] !== 'off'));
  return result;
}
