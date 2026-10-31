import { parse } from '@babel/parser';
import { appendChild, dynamicAttr, element, setDynamicContent, staticAttr, type IRDocument, type IRElement } from '../ir.js';
import { alwaysHasText, isComponentName, setAttr } from './common.js';

type Node = { type: string; start?: number; end?: number; loc?: { start: { line: number; column: number } }; [key: string]: any };

interface Context {
  source: string;
  /** Local binding → module, from import declarations. */
  imports: Map<string, string>;
  /** Components defined in this file → the HTML tag they render at their root. */
  localTags: Map<string, string>;
}

export function parseJsx(file: string, source: string): IRDocument {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: file.endsWith('.js') || file.endsWith('.jsx') ? ['jsx'] : ['jsx', 'typescript'],
    errorRecovery: true,
  });
  const ctx: Context = { source, imports: new Map(), localTags: localComponentTags(ast.program.body as unknown as Node[]) };
  for (const node of ast.program.body as Node[]) {
    if (node.type !== 'ImportDeclaration') continue;
    for (const s of node.specifiers) ctx.imports.set(s.local.name, node.source.value);
  }
  const root = element('#root', { line: 1, column: 1 });
  collectJsx(ast.program, root, ctx);
  return { file, framework: 'jsx', isDocument: false, root, styles: [] };
}

/** Finds JSX anywhere below `node` (returns, `.map()` callbacks, ternaries) and appends it to `parent`. */
function collectJsx(node: unknown, parent: IRElement, ctx: Context): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectJsx(n, parent, ctx);
    return;
  }
  const n = node as Node;
  if (n.type === 'JSXElement') {
    appendChild(parent, convertElement(n, ctx));
    return;
  }
  if (n.type === 'JSXFragment') {
    convertChildren(n.children, parent, ctx);
    return;
  }
  for (const key in n) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments') continue;
    collectJsx(n[key], parent, ctx);
  }
}

function convertElement(node: Node, ctx: Context): IRElement {
  const opening = node.openingElement;
  const rawName = jsxName(opening.name);
  const start = node.loc!.start;
  const el = element(rawName, { line: start.line, column: start.column + 1 });
  el.isComponent = isComponentName(rawName);
  if (el.isComponent) {
    el.importSource = ctx.imports.get(rawName.split('.')[0]);
    el.localTag = ctx.localTags.get(rawName);
  }

  for (const attr of opening.attributes) {
    if (attr.type === 'JSXSpreadAttribute') {
      el.hasSpread = true;
      continue;
    }
    const name = jsxName(attr.name);
    const value = attr.value;
    if (name === 'dangerouslySetInnerHTML') {
      setDynamicContent(el);
      continue;
    }
    if (value == null) setAttr(el, name, staticAttr(''));
    else if (value.type === 'StringLiteral') setAttr(el, name, staticAttr(value.value));
    else if (value.type === 'JSXExpressionContainer') {
      const expr = value.expression;
      if (expr.type === 'StringLiteral') setAttr(el, name, staticAttr(expr.value));
      else if (expr.type === 'NumericLiteral') setAttr(el, name, staticAttr(String(expr.value)));
      else if (expr.type === 'BooleanLiteral') {
        if (expr.value) setAttr(el, name, staticAttr(''));
      } else if (expr.type === 'TemplateLiteral' && expr.expressions.length === 0) {
        setAttr(el, name, staticAttr(expr.quasis[0].value.cooked ?? ''));
      } else setAttr(el, name, dynamicAttr(ctx.source.slice(expr.start, expr.end), alwaysHasText(expr)));
    } else setAttr(el, name, dynamicAttr());
  }
  convertChildren(node.children, el, ctx);
  return el;
}

function convertChildren(children: Node[], parent: IRElement, ctx: Context): void {
  for (const child of children) {
    if (child.type === 'JSXText') appendChild(parent, { type: 'text', value: child.value, dynamic: false });
    else if (child.type === 'JSXElement') appendChild(parent, convertElement(child, ctx));
    else if (child.type === 'JSXFragment') convertChildren(child.children, parent, ctx);
    else if (child.type === 'JSXExpressionContainer' || child.type === 'JSXSpreadChild') {
      const expr = child.expression;
      if (expr.type === 'JSXEmptyExpression') continue;
      if (expr.type === 'StringLiteral') {
        appendChild(parent, { type: 'text', value: expr.value, dynamic: false });
        continue;
      }
      // `{items.map(i => <li/>)}` renders elements, not text; anything else may render text.
      const before = parent.children.length;
      collectJsx(expr, parent, ctx);
      if (parent.children.length === before) appendChild(parent, { type: 'text', value: '', dynamic: true });
    }
  }
}

function jsxName(name: Node): string {
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXNamespacedName') return `${name.namespace.name}:${name.name.name}`;
  return `${jsxName(name.object)}.${name.property.name}`;
}

/**
 * Maps components declared at the top level of this file to the HTML tag of their
 * first returned JSX element, e.g. `function Field() { return <label>…</label> }` → `label`.
 */
function localComponentTags(body: Node[]): Map<string, string> {
  const tags = new Map<string, string>();
  for (let stmt of body) {
    if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') stmt = stmt.declaration;
    if (!stmt) continue;
    const candidates: [string, Node][] = [];
    if (stmt.type === 'FunctionDeclaration' && stmt.id) candidates.push([stmt.id.name, stmt]);
    if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations) {
        let init = d.init;
        // forwardRef(...), memo(...)
        while (init?.type === 'CallExpression' && init.arguments[0]) init = init.arguments[0];
        if (d.id.type === 'Identifier' && init && /Function/.test(init.type)) candidates.push([d.id.name, init]);
      }
    }
    for (const [name, fn] of candidates) {
      if (!/^[A-Z]/.test(name)) continue;
      const root = returnedJsx(fn.body);
      const tag = root && jsxName(root.openingElement.name);
      if (tag && !isComponentName(tag)) tags.set(name, tag.toLowerCase());
    }
  }
  return tags;
}

function returnedJsx(body: Node | undefined): Node | undefined {
  if (!body) return undefined;
  const unwrap = (n: Node | undefined): Node | undefined => (n?.type === 'JSXElement' ? n : n?.type === 'ParenthesizedExpression' ? unwrap(n.expression) : undefined);
  if (body.type !== 'BlockStatement') return unwrap(body);
  for (const stmt of body.body) if (stmt.type === 'ReturnStatement') return unwrap(stmt.argument);
  return undefined;
}
