import { parse } from '@vue/compiler-sfc';
import { appendChild, DYNAMIC, element, extractStyles, staticAttr, type IRDocument, type IRElement } from '../ir.js';
import { isComponentName, setAttr } from './common.js';

// @vue/compiler-core NodeTypes / ElementTypes
const ELEMENT = 1;
const TEXT = 2;
const INTERPOLATION = 5;
const ATTRIBUTE = 6;
const COMPONENT = 1;

type VueNode = { type: number; [key: string]: any };

export function parseVue(file: string, source: string): IRDocument {
  const { descriptor } = parse(source, { filename: file });
  const root = element('#root', { line: 1, column: 1 });
  if (descriptor.template?.ast) convertChildren(descriptor.template.ast.children, root);
  return { file, framework: 'vue', isDocument: false, root, styles: extractStyles(source) };
}

function convertChildren(children: VueNode[], parent: IRElement): void {
  for (const child of children) {
    if (child.type === TEXT) appendChild(parent, { type: 'text', value: child.content, dynamic: false });
    else if (child.type === INTERPOLATION) appendChild(parent, { type: 'text', value: '', dynamic: true });
    else if (child.type === ELEMENT) {
      // <template v-if> and <slot> are wrappers, not rendered elements.
      if (child.tag === 'template') convertChildren(child.children, parent);
      else appendChild(parent, convertElement(child));
    }
  }
}

function convertElement(node: VueNode): IRElement {
  const el = element(node.tag, { line: node.loc.start.line, column: node.loc.start.column });
  el.isComponent = node.tagType === COMPONENT || isComponentName(node.tag) || node.tag === 'slot';
  for (const prop of node.props) {
    if (prop.type === ATTRIBUTE) {
      setAttr(el, prop.name, staticAttr(prop.value?.content ?? ''));
      continue;
    }
    const arg: string | undefined = prop.arg?.isStatic ? prop.arg.content : undefined;
    if (prop.name === 'bind') {
      if (!prop.arg) el.hasSpread = true;
      else if (arg) setAttr(el, arg.replace(/^attr\./, ''), DYNAMIC);
    } else if (prop.name === 'on' && arg) el.events.add(arg.toLowerCase());
    else if (prop.name === 'text' || prop.name === 'html') appendChild(el, { type: 'text', value: '', dynamic: true });
  }
  convertChildren(node.children, el);
  return el;
}
