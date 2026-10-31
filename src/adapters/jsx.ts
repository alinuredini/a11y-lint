import { parse } from '@babel/parser';
import { appendChild, dynamicAttr, element, setDynamicContent, staticAttr, type IRDocument, type IRElement } from '../ir.js';
import { alwaysHasText, collectImports, isComponentName, linkImport, setAttr, type ImportBinding } from './common.js';

type Node = { type: string; start?: number; end?: number; loc?: { start: { line: number; column: number } }; [key: string]: any };

interface Context {
  source: string;
  /** Local binding → module and export name, from import declarations. */
  imports: Map<string, ImportBinding>;
  /** Components defined in this file → the HTML tag they render at their root. */
  localTags: Map<string, string>;
}

export function parseJsx(file: string, source: string): IRDocument {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: file.endsWith('.js') || file.endsWith('.jsx') ? ['jsx'] : ['jsx', 'typescript'],
    errorRecovery: true,
  });
  const body = ast.program.body as unknown as Node[];
  const { locals, exports } = componentTags(body);
  const ctx: Context = { source, imports: collectImports(body), localTags: locals };
  const root = element('#root', { line: 1, column: 1 });
  collectJsx(ast.program, root, ctx);
  return { file, framework: 'jsx', isDocument: false, root, styles: [], exports };
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
    linkImport(el, ctx.imports);
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
 * Maps components declared at the top level of this file to the HTML tag of their returned
 * root element, e.g. `function Field() { return <label>…</label> }` → `label`, and records
 * which of them are exported under which name.
 */
function componentTags(body: Node[]): { locals: Map<string, string>; exports: Map<string, string> } {
  const locals = new Map<string, string>();
  const exports = new Map<string, string>();
  const exportedAs: [string, string][] = []; // [local, exported]
  for (const top of body) {
    let stmt = top;
    if (top.type === 'ExportNamedDeclaration') {
      if (!top.source) for (const s of top.specifiers ?? []) exportedAs.push([s.local.name, s.exported.name ?? s.exported.value]);
      stmt = top.declaration;
    }
    if (top.type === 'ExportDefaultDeclaration') {
      stmt = top.declaration;
      if (stmt?.type === 'Identifier') exportedAs.push([stmt.name, 'default']);
      else {
        const tag = componentTag(unwrapWrappers(stmt));
        if (tag) exports.set('default', tag);
        if (stmt?.id?.name) exportedAs.push([stmt.id.name, 'default']);
      }
    }
    if (!stmt) continue;
    const declared: [string, Node | undefined][] = [];
    if (stmt.type === 'FunctionDeclaration' && stmt.id) declared.push([stmt.id.name, stmt]);
    if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations) if (d.id.type === 'Identifier') declared.push([d.id.name, unwrapWrappers(d.init)]);
    }
    for (const [name, fn] of declared) {
      if (!/^[A-Z]/.test(name)) continue;
      const tag = componentTag(fn);
      if (tag) locals.set(name, tag);
      if (top.type === 'ExportNamedDeclaration') exportedAs.push([name, name]);
    }
  }
  for (const [local, exported] of exportedAs) {
    const tag = locals.get(local);
    if (tag) exports.set(exported, tag);
  }
  return { locals, exports };
}

/** `forwardRef(fn)`, `memo(fn)`, `React.forwardRef(fn)` → `fn`. */
function unwrapWrappers(node: Node | undefined): Node | undefined {
  while (node?.type === 'CallExpression' && node.arguments[0]) node = node.arguments[0];
  return node && /Function/.test(node.type) ? node : undefined;
}

/** HTML tag of the element a component function returns, including shadcn's `const Comp = asChild ? Slot : 'button'`. */
function componentTag(fn: Node | undefined): string | undefined {
  if (!fn?.body) return undefined;
  const root = returnedJsx(fn.body);
  if (!root) return undefined;
  const name = jsxName(root.openingElement.name);
  if (!isComponentName(name)) return name.toLowerCase();
  if (fn.body.type !== 'BlockStatement') return undefined;
  for (const stmt of fn.body.body) {
    if (stmt.type !== 'VariableDeclaration') continue;
    for (const d of stmt.declarations) {
      if (d.id.name !== name) continue;
      const options = d.init?.type === 'ConditionalExpression' ? [d.init.consequent, d.init.alternate] : [d.init];
      const literal = options.find((o: Node | undefined) => o?.type === 'StringLiteral');
      if (literal) return literal.value.toLowerCase();
    }
  }
  return undefined;
}

function returnedJsx(body: Node | undefined): Node | undefined {
  if (!body) return undefined;
  const unwrap = (n: Node | undefined): Node | undefined => (n?.type === 'JSXElement' ? n : n?.type === 'ParenthesizedExpression' ? unwrap(n.expression) : undefined);
  if (body.type !== 'BlockStatement') return unwrap(body);
  for (const stmt of body.body) if (stmt.type === 'ReturnStatement') return unwrap(stmt.argument);
  return undefined;
}
