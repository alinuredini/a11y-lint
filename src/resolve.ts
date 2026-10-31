import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parse } from '@babel/parser';
import { adapterFor } from './adapters/index.js';
import { walk, type IRDocument } from './ir.js';

type Node = { type: string; [key: string]: any };

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.vue', '.svelte', '.astro'];
const MAX_DEPTH = 5;

interface Alias {
  /** `@/*` → prefix `@/`, or an exact specifier when there is no `*`. */
  prefix: string;
  wildcard: boolean;
  targets: string[];
}

/**
 * Gives components imported from other files the tag their definition renders:
 * `import { Button } from '@/components/ui/button'` → `button`. Follows relative paths,
 * tsconfig/jsconfig `paths` and barrel re-exports; files outside the scan are parsed on demand.
 */
export class ImportResolver {
  private docs = new Map<string, IRDocument | null>();
  private aliases = new Map<string, Alias[]>();

  constructor(
    private cwd: string,
    scanned: IRDocument[],
  ) {
    for (const doc of scanned) this.docs.set(resolve(cwd, doc.file), doc);
  }

  async link(docs: IRDocument[]): Promise<void> {
    for (const doc of docs) {
      for (const el of walk(doc.root)) {
        if (!el.isComponent || el.localTag || !el.importSource || !el.importName) continue;
        el.localTag = await this.exportTag(resolve(this.cwd, doc.file), el.importSource, el.importName, 0);
      }
    }
  }

  private async exportTag(fromFile: string, spec: string, name: string, depth: number): Promise<string | undefined> {
    if (depth > MAX_DEPTH) return undefined;
    const file = this.resolveModule(fromFile, spec);
    if (!file) return undefined;
    const doc = await this.load(file);
    const tag = doc?.exports?.get(name);
    if (tag) return tag;
    // Barrel files: `export { Button } from './button'`, `export * from './ui'`.
    for (const reexport of reexports(file)) {
      if (reexport.all || reexport.exported === name) {
        const found = await this.exportTag(file, reexport.source, reexport.all ? name : reexport.local, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  }

  private async load(file: string): Promise<IRDocument | null> {
    if (this.docs.has(file)) return this.docs.get(file)!;
    let doc: IRDocument | null = null;
    const adapter = adapterFor(file);
    if (adapter) {
      try {
        doc = await adapter(relative(this.cwd, file), readFileSync(file, 'utf8'));
      } catch {
        doc = null;
      }
    }
    this.docs.set(file, doc);
    return doc;
  }

  resolveModule(fromFile: string, spec: string): string | undefined {
    if (spec.startsWith('.')) return tryFile(resolve(dirname(fromFile), spec));
    for (const alias of this.aliasesFor(dirname(fromFile))) {
      const matches = alias.wildcard ? spec.startsWith(alias.prefix) : spec === alias.prefix;
      if (!matches) continue;
      const rest = alias.wildcard ? spec.slice(alias.prefix.length) : '';
      for (const target of alias.targets) {
        const found = tryFile(alias.wildcard ? join(target, rest) : target);
        if (found) return found;
      }
    }
    return undefined;
  }

  /** `paths` from the nearest tsconfig/jsconfig (including `tsconfig.app.json` style siblings and `extends`). */
  private aliasesFor(dir: string): Alias[] {
    const root = resolve(this.cwd);
    for (let d = dir; ; d = dirname(d)) {
      if (this.aliases.has(d)) return this.aliases.get(d)!;
      const configs = existsSync(d) ? readdirSync(d).filter((f) => /^(tsconfig|jsconfig)(\..+)?\.json$/.test(f)) : [];
      if (configs.length) {
        const aliases = configs.flatMap((f) => readAliases(join(d, f), 0));
        this.aliases.set(d, aliases);
        return aliases;
      }
      if (d === root || dirname(d) === d) {
        this.aliases.set(d, []);
        return [];
      }
    }
  }
}

function tryFile(base: string): string | undefined {
  const candidates = [base, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => join(base, `index${e}`))];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile());
}

function readAliases(configPath: string, depth: number): Alias[] {
  let config: { extends?: string | string[]; compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
  try {
    config = JSON.parse(stripJsonComments(readFileSync(configPath, 'utf8')));
  } catch {
    return [];
  }
  const dir = dirname(configPath);
  const inherited =
    depth < 3
      ? [config.extends ?? []].flat().flatMap((ext) => (ext.startsWith('.') ? readAliases(resolve(dir, ext.endsWith('.json') ? ext : `${ext}.json`), depth + 1) : []))
      : [];
  const base = resolve(dir, config.compilerOptions?.baseUrl ?? '.');
  const own = Object.entries(config.compilerOptions?.paths ?? {}).map(([pattern, targets]) => ({
    prefix: pattern.replace(/\*$/, ''),
    wildcard: pattern.endsWith('*'),
    targets: targets.map((t) => resolve(base, t.replace(/\*$/, ''))),
  }));
  return [...own, ...inherited];
}

/** tsconfig files allow comments and trailing commas; strings like `"@/*"` must survive. */
export function stripJsonComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && next === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl - 1;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

interface Reexport {
  source: string;
  exported?: string;
  local: string;
  all: boolean;
}

function reexports(file: string): Reexport[] {
  if (!/\.[cm]?[jt]sx?$/.test(file)) return [];
  let body: Node[];
  try {
    body = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true }).program.body as unknown as Node[];
  } catch {
    return [];
  }
  const out: Reexport[] = [];
  for (const node of body) {
    if (node.type === 'ExportAllDeclaration' && !node.exported) out.push({ source: node.source.value, local: '', all: true });
    if (node.type === 'ExportNamedDeclaration' && node.source) {
      for (const s of node.specifiers) {
        out.push({ source: node.source.value, exported: s.exported.name ?? s.exported.value, local: s.local?.name ?? 'default', all: false });
      }
    }
  }
  return out;
}
