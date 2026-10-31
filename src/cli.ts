#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { CONFIG_FILE, DEFAULT_CONFIG, loadConfig } from './config.js';
import { run } from './index.js';
import { renderMarkdown } from './report/conformance.js';
import { toSarif } from './report/sarif.js';
import { formatText } from './report/text.js';
import type { Level } from './wcag.js';

const HELP = `a11y-lint [paths...] [options]

Checks source files (HTML, JSX/TSX, Vue, Svelte, Astro, Angular templates, CSS) against WCAG 2.2.

Options
  --level <A|AA|AAA>        Target conformance level (default: AA, or "level" in config)
  --config <file>           Config file (default: ${CONFIG_FILE})
  --format <text|json|sarif>
  --output <file>           Write the formatted findings to a file instead of stdout
  --report <file.md>        Write a WCAG conformance report with the manual checklist
  --url <url>               Scan a rendered page with Playwright + axe (repeatable)
  --storybook <dir>         Scan every story in a built Storybook
  --runtime                 Run the runtime scan with urls from the config file
  --fail-on <fail|review|never>  When to exit with code 1 (default: fail)
  --init                    Write a starter ${CONFIG_FILE}
  -h, --help
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      level: { type: 'string' },
      config: { type: 'string' },
      format: { type: 'string', default: 'text' },
      output: { type: 'string' },
      report: { type: 'string' },
      url: { type: 'string', multiple: true },
      storybook: { type: 'string' },
      runtime: { type: 'boolean' },
      'fail-on': { type: 'string', default: 'fail' },
      init: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const cwd = process.cwd();
  if (values.init) {
    if (existsSync(CONFIG_FILE)) throw new Error(`${CONFIG_FILE} already exists`);
    // Built-in component mappings stay active; the starter lists only project-specific ones.
    writeFileSync(CONFIG_FILE, JSON.stringify({ ...DEFAULT_CONFIG, components: {} }, null, 2) + '\n');
    console.log(`Wrote ${CONFIG_FILE}`);
    return 0;
  }

  const config = loadConfig(cwd, values.config);
  if (values.level) {
    if (!['A', 'AA', 'AAA'].includes(values.level)) throw new Error('--level must be A, AA or AAA');
    config.level = values.level as Level;
  }
  if (values.url) config.runtime.urls.push(...values.url);
  if (values.storybook) config.runtime.storybook = values.storybook;
  const runtime = Boolean(values.runtime || values.url || values.storybook);

  const result = await run(cwd, config, { paths: positionals, runtime });
  for (const e of result.parseErrors) console.error(`Could not parse ${e.file}: ${e.message}`);

  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
  const body =
    values.format === 'json'
      ? JSON.stringify(result.findings, null, 2)
      : values.format === 'sarif'
        ? JSON.stringify(toSarif(result.findings, version), null, 2)
        : formatText(result.findings);
  if (values.output) writeFileSync(values.output, body + '\n');
  else console.log(body);

  if (values.report) {
    writeFileSync(values.report, renderMarkdown(result.conformanceInput, result.conformance) + '\n');
    console.error(`Conformance report written to ${values.report}`);
  }

  const failOn = values['fail-on'];
  if (failOn === 'never') return 0;
  const failing = result.findings.filter((f) => f.status === 'fail' || failOn === 'review');
  return failing.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(err.message);
    process.exit(2);
  },
);
