import { parse } from '@babel/parser';
import { appendChild, DYNAMIC, element, staticAttr, type IRDocument, type IRElement } from '../ir.js';
import { isComponentName, setAttr } from './common.js';

type Node = { type: string; loc?: { start: { line: number; column: number } }; [key: string]: any };

export function parseJsx(file: string, source: string): IRDocument {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: file.endsWith('.js') || file.endsWith('.jsx') ? ['jsx'] : ['jsx', 'typescript'],
    errorRecovery: true,
  });
  const root = element('#root', { line: 1, column: 1 });
  collectJsx(ast.program, root);
  return { file, framework: 'jsx', isDocument: false, root, styles: [] };
}

/** Finds JSX anywhere below `node` (returns, `.map()` callbacks, ternaries) and appends it to `parent`. */
function collectJsx(node: unknown, parent: IRElement): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectJsx(n, parent);
    return;
  }
  const n = node as Node;
  if (n.type === 'JSXElement') {
    appendChild(parent, convertElement(n));
    return;
  }
  if (n.type === 'JSXFragment') {
    convertChildren(n.children, parent);
    return;
  }
  for (const key in n) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments') continue;
    collectJsx(n[key], parent);
  }
}

function convertElement(node: Node): IRElement {
  const opening = node.openingElement;
  const rawName = jsxName(opening.name);
  const start = node.loc!.start;
  const el = element(rawName, { line: start.line, column: start.column + 1 });
  el.isComponent = isComponentName(rawName);

  for (const attr of opening.attributes) {
    if (attr.type === 'JSXSpreadAttribute') {
      el.hasSpread = true;
      continue;
    }
    const name = jsxName(attr.name);
    const value = attr.value;
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
      } else setAttr(el, name, DYNAMIC);
    } else setAttr(el, name, DYNAMIC);
  }
  convertChildren(node.children, el);
  return el;
}

function convertChildren(children: Node[], parent: IRElement): void {
  for (const child of children) {
    if (child.type === 'JSXText') appendChild(parent, { type: 'text', value: child.value, dynamic: false });
    else if (child.type === 'JSXElement') appendChild(parent, convertElement(child));
    else if (child.type === 'JSXFragment') convertChildren(child.children, parent);
    else if (child.type === 'JSXExpressionContainer' || child.type === 'JSXSpreadChild') {
      const expr = child.expression;
      if (expr.type === 'JSXEmptyExpression') continue;
      if (expr.type === 'StringLiteral') {
        appendChild(parent, { type: 'text', value: expr.value, dynamic: false });
        continue;
      }
      appendChild(parent, { type: 'text', value: '', dynamic: true });
      collectJsx(expr, parent);
    }
  }
}

function jsxName(name: Node): string {
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXNamespacedName') return `${name.namespace.name}:${name.name.name}`;
  return `${jsxName(name.object)}.${name.property.name}`;
}
