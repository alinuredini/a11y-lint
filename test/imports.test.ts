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

  it('checks usages as the definition renders: forwarded props, own attributes', async () => {
    // Unlabelled shadcn-style Input fails; aria-label on usage reaches it; SearchBox labels itself.
    expect(await findings('src/pages/Form.tsx')).toEqual(['8 fail form-label']);
  });

  it('matches shadcn Label (Radix primitive) and keeps spreads through nested wrappers', async () => {
    // PasswordInput's inner <Input {...props}> may get a label from its caller: review, not fail.
    expect(await findings('src/pages/Login.tsx')).toEqual(['5 unknown form-label']);
  });

  it('resolves Vue SFC imports in PascalCase and kebab-case', async () => {
    expect(await findings('src/pages/Page.vue')).toEqual([]);
  });

  it('resolves Svelte component imports', async () => {
    expect(await findings('src/pages/Page.svelte')).toEqual(['4 fail button-name']); // forwards props, adds no label
  });

  it('keeps comment-like text inside strings when reading tsconfig', () => {
    expect(JSON.parse(stripJsonComments('{ "paths": { "@/*": ["./src/*"], }, // x\n }'))).toEqual({ paths: { '@/*': ['./src/*'] } });
  });
});
