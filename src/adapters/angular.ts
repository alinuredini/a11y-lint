import { parseTemplate } from '@angular/compiler';
import { appendChild, element, setDynamicContent, staticAttr, type IRDocument, type IRElement } from '../ir.js';
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
