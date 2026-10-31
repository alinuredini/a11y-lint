import { parse, parseExpression } from '@babel/parser';
import { dynamicAttr, walk, type AttrValue, type IRElement } from '../ir.js';

type Node = { type: string; [key: string]: any };

const GUARD_ONLY = /^\(?\w*(:[\w.<>]+)?\)?=>\{?(\w+\.(stopPropagation|preventDefault)\(\);?)+\}?$/;

const RENAMES: Record<string, string> = { classname: 'class', htmlfor: 'for' };

/** Components (`Button`, `Foo.Bar`) and custom elements (`app-card`) are opaque to rules. */
export function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) || name.includes('-') || name.includes('.') || name.includes(':');
}

/**
 * Sets an attribute using DOM semantics: `onClick`/`onclick` become events,
 * `className`/`htmlFor` are renamed, everything else is lowercased.
 */
export function setAttr(el: IRElement, rawName: string, value: AttrValue): void {
  if (/^on[a-z]/i.test(rawName) && rawName.length > 2) {
    // `(e) => e.stopPropagation()` only shields a parent's handler; it isn't an action.
    const guardOnly = value.kind === 'dynamic' && value.expr && GUARD_ONLY.test(value.expr);
    if (!guardOnly) el.events.add(rawName.slice(2).toLowerCase());
    return;
  }
  const lower = rawName.toLowerCase();
  el.attrs.set(RENAMES[lower] ?? lower, value);
}

/** Expressions that can never evaluate to an empty string: `` `Remove ${x}` ``, `a ? 'Open' : 'Close'`. */
export function alwaysHasText(expr: Node): boolean {
  switch (expr.type) {
    case 'StringLiteral':
      return expr.value.trim() !== '';
    case 'TemplateLiteral':
      return expr.quasis.some((q: Node) => (q.value.cooked ?? '').trim() !== '');
    case 'ConditionalExpression':
      return alwaysHasText(expr.consequent) && alwaysHasText(expr.alternate);
    case 'LogicalExpression':
      return (expr.operator === '??' || expr.operator === '||') && alwaysHasText(expr.right);
    default:
      return false;
  }
}

/** A dynamic attribute from expression source text, as written in Vue, Angular or Astro templates. */
export function exprAttr(source: string | undefined): AttrValue {
  if (!source) return dynamicAttr();
  let nonEmpty = false;
  try {
    nonEmpty = alwaysHasText(parseExpression(source, { plugins: ['typescript'] }) as Node);
  } catch {
    // not plain JS (Angular pipes etc.): leave it unknown
  }
  return dynamicAttr(source, nonEmpty);
}

export interface ImportBinding {
  source: string;
  /** `default`, a named export, or `*` for namespace imports. */
  imported: string;
}

/** Import bindings from an ESTree/Babel program body. */
export function collectImports(body: Node[]): Map<string, ImportBinding> {
  const imports = new Map<string, ImportBinding>();
  for (const node of body) {
    if (node.type !== 'ImportDeclaration' || node.importKind === 'type') continue;
    for (const s of node.specifiers) {
      const imported =
        s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*' : (s.imported.name ?? s.imported.value);
      imports.set(s.local.name, { source: node.source.value, imported });
    }
  }
  return imports;
}

/** Parses a `<script>` block or Astro frontmatter for its imports; invalid code yields none. */
export function importsFromScript(code: string | undefined): Map<string, ImportBinding> {
  if (!code) return new Map();
  try {
    return collectImports(parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true }).program.body as unknown as Node[]);
  } catch {
    return new Map();
  }
}

/** Sets `importSource`/`importName` on a component from the file's imports (`UI.Button`, `my-field` → `MyField`). */
export function linkImport(el: IRElement, imports: Map<string, ImportBinding>): void {
  const [head, member] = el.rawName.split('.');
  const pascal = head.includes('-') ? head.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase()) : head;
  const binding = imports.get(head) ?? imports.get(pascal);
  if (!binding) return;
  el.importSource = binding.source;
  el.importName = binding.imported === '*' ? member : binding.imported;
}

/** The single root element of a single-file component, if there is exactly one and it is plain HTML. */
export function singleRootTag(root: IRElement): string | undefined {
  const elements = root.children.filter((c): c is IRElement => c.type === 'element' && c.tag !== 'style' && c.tag !== 'script');
  const text = root.children.some((c) => c.type === 'text' && (c.dynamic || c.value.trim()));
  if (elements.length !== 1 || text || elements[0].isComponent) return undefined;
  return elements[0].tag;
}

export function linkImports(root: IRElement, imports: Map<string, ImportBinding>): void {
  if (!imports.size) return;
  for (const el of walk(root)) if (el.isComponent) linkImport(el, imports);
}

/** A Vue/Svelte/Astro component's default export renders its single root element. */
export function sfcExports(root: IRElement): Map<string, string> | undefined {
  const tag = singleRootTag(root);
  return tag ? new Map([['default', tag]]) : undefined;
}
