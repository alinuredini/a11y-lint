import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import { lintStatic } from '../src/engine.js';
import { stripJsonComments } from '../src/resolve.js';

const fixtures = resolve(import.meta.dirname, 'fixtures/imports');

async function findings(path: string) {
  const { findings, errors } = await lintStatic(fixtures, { ...DEFAULT_CONFIG }, [path]);
  expect(errors).toEqual([]);
  return findings.map((f) => `${f.line} ${f.status} ${f.ruleId}`);
}

describe('components imported from other files', () => {
  it('resolves tsconfig aliases, shadcn Comp roots and barrel re-exports in JSX', async () => {
    // Only Page.tsx is scanned: the imported files are parsed on demand.
    expect(await findings('src/pages/Page.tsx')).toEqual([
      '9 unknown button-name', // IconButton → <button> with only an icon component inside
      '11 unknown click-needs-keyboard', // the div contains a resolved <button>
    ]);
  });

  it('resolves Vue SFC imports in PascalCase and kebab-case', async () => {
    expect(await findings('src/pages/Page.vue')).toEqual([]);
  });

  it('resolves Svelte component imports', async () => {
    expect(await findings('src/pages/Page.svelte')).toEqual(['4 unknown button-name']); // the wrapper may add a label itself
  });

  it('keeps comment-like text inside strings when reading tsconfig', () => {
    expect(JSON.parse(stripJsonComments('{ "paths": { "@/*": ["./src/*"], }, // x\n }'))).toEqual({ paths: { '@/*': ['./src/*'] } });
  });
});
