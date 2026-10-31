import { parseTemplate } from '@angular/compiler';
import { parse as babelParse } from '@babel/parser';
import { appendChild, element, setDynamicContent, staticAttr, walk, type IRDocument, type IRElement, type IRStyle } from '../ir.js';
import { exprAttr, isComponentName, setAttr } from './common.js';

type NgNode = { [key: string]: any };

// BindingType from @angular/compiler: Property = 0, Attribute = 1 (`[attr.x]`)
const BINDING_PROPERTY = 0;
const BINDING_ATTRIBUTE = 1;

export function parseAngular(file: string, source: string): IRDocument {
  const { nodes } = parseTemplate(source, file, { preserveWhitespaces: true });
  const root = element('#root', { line: 1, column: 1 });
  convertNodes(nodes, root);
  return { file, framework: 'angular', isDocument: false, root, styles: [] };
}

/** Children of control-flow blocks (`@if`, `@for`, `@switch`, `@defer`) and `<ng-template>`. */
const BLOCK_KEYS = ['children', 'branches', 'cases', 'empty', 'placeholder', 'loading', 'error'];

function convertNodes(nodes: NgNode[] = [], parent: IRElement): void {
  for (const node of nodes) {
    if (!node) continue;
    if (typeof node.name === 'string' && Array.isArray(node.outputs) && Array.isArray(node.children)) {
      appendChild(parent, convertElement(node));
    } else if (typeof node.value === 'string' && !node.children) {
      appendChild(parent, { type: 'text', value: node.value, dynamic: false });
    } else if (node.value && typeof node.value === 'object' && !node.children) {
      appendChild(parent, { type: 'text', value: '', dynamic: true }); // {{ interpolation }}
    } else {
      for (const key of BLOCK_KEYS) {
        const v = node[key];
        if (Array.isArray(v)) convertNodes(v, parent);
        else if (v?.children) convertNodes(v.children, parent);
      }
    }
  }
}

function convertElement(node: NgNode): IRElement {
  const start = node.sourceSpan.start;
  const name = node.name.replace(/^:[a-z]+:/, ''); // `:svg:path` → `path`
  const el = element(name, { line: start.line + 1, column: start.col + 1 });
  el.isComponent = isComponentName(name) || name.startsWith('ng-');
  for (const a of node.attributes) setAttr(el, a.name, staticAttr(a.value));
  for (const input of node.inputs) {
    if (input.type !== BINDING_PROPERTY && input.type !== BINDING_ATTRIBUTE) continue;
    if (['innerHTML', 'textContent', 'innerText'].includes(input.name)) setDynamicContent(el);
    else setAttr(el, input.name, exprAttr(input.value?.source ?? undefined));
  }
  for (const output of node.outputs) el.events.add(String(output.name).toLowerCase());
  convertNodes(node.children, el);
  return el;
}

/**
 * Inline templates and styles from `@Component({ template: `…`, styles: […] })` in a
 * `.component.ts` file, with positions mapped back into the TypeScript source.
 */
export function parseAngularComponent(file: string, source: string): IRDocument {
  const ast = babelParse(source, { sourceType: 'module', plugins: ['typescript', 'decorators'], errorRecovery: true });
  const root = element('#root', { line: 1, column: 1 });
  const styles: IRStyle[] = [];
  for (const node of ast.program.body as unknown as NgNode[]) {
    const cls = node.type === 'ClassDeclaration' ? node : node.declaration?.type === 'ClassDeclaration' ? node.declaration : undefined;
    const decorators: NgNode[] = [...(node.decorators ?? []), ...(cls?.decorators ?? [])];
    for (const decorator of decorators) {
      const call = decorator.expression;
      if (call?.type !== 'CallExpression' || call.callee.name !== 'Component') continue;
      for (const prop of call.arguments[0]?.properties ?? []) {
        const key = prop.key?.name ?? prop.key?.value;
        if (key === 'template') {
          const literal = stringLiteral(prop.value);
          if (!literal) continue;
          const template = parseAngular(file, literal.text);
          for (const el of walk(template.root)) {
            if (el === template.root) continue;
            el.loc = { line: literal.line + el.loc.line - 1, column: el.loc.line === 1 ? literal.column + el.loc.column - 1 : el.loc.column };
          }
          for (const child of template.root.children) appendChild(root, child);
        } else if (key === 'styles') {
          const values = prop.value.type === 'ArrayExpression' ? prop.value.elements : [prop.value];
          for (const v of values) {
            const literal = stringLiteral(v);
            if (literal) styles.push({ css: literal.text, lang: 'css', line: literal.line });
          }
        }
      }
    }
  }
  return { file, framework: 'angular', isDocument: false, root, styles };
}

/** Text and 1-based start position of a string or expression-free template literal. */
function stringLiteral(node: NgNode | undefined): { text: string; line: number; column: number } | undefined {
  if (!node) return undefined;
  const start = node.loc.start;
  // Content starts one character after the opening quote or backtick.
  if (node.type === 'StringLiteral') return { text: node.value, line: start.line, column: start.column + 2 };
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return { text: node.quasis[0].value.cooked ?? node.quasis[0].value.raw, line: start.line, column: start.column + 2 };
  }
  return undefined;
}
