import { parse, parseFragment } from 'parse5';
import { appendChild, element, extractStyles, staticAttr, type IRDocument, type IRElement } from '../ir.js';
import { isComponentName, setAttr } from './common.js';

type P5Node = {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5Node[];
  content?: P5Node;
  sourceCodeLocation?: { startLine: number; startCol: number } | null;
};

export function parseHtml(file: string, source: string): IRDocument {
  // Only parse as a full document when one is written out, so fragments don't get a synthetic <html>.
  const isDocument = /<html[\s>]/i.test(source);
  const tree = (isDocument
    ? parse(source, { sourceCodeLocationInfo: true })
    : parseFragment(source, { sourceCodeLocationInfo: true })) as unknown as P5Node;
  const root = element('#root', { line: 1, column: 1 });
  convertChildren(tree, root);
  return { file, framework: 'html', isDocument, root, styles: extractStyles(source) };
}

function convertChildren(node: P5Node, parent: IRElement): void {
  for (const child of node.content?.childNodes ?? node.childNodes ?? []) {
    if (child.nodeName === '#text') appendChild(parent, { type: 'text', value: child.value ?? '', dynamic: false });
    else if (child.tagName) appendChild(parent, convertElement(child));
  }
}

function convertElement(node: P5Node): IRElement {
  const loc = node.sourceCodeLocation;
  const el = element(node.tagName!, loc ? { line: loc.startLine, column: loc.startCol } : { line: 1, column: 1 });
  el.isComponent = isComponentName(node.tagName!);
  for (const a of node.attrs ?? []) setAttr(el, a.name, staticAttr(a.value));
  convertChildren(node, el);
  return el;
}
