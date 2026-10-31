import { parse } from 'svelte/compiler';
import { appendChild, DYNAMIC, element, extractStyles, lineIndex, staticAttr, type IRDocument, type IRElement } from '../ir.js';
import { setAttr } from './common.js';

type SvelteNode = { type: string; start: number; [key: string]: any };

export function parseSvelte(file: string, source: string): IRDocument {
  const ast = parse(source, { modern: true }) as unknown as { fragment: { nodes: SvelteNode[] } };
  const toLoc = lineIndex(source);
  const root = element('#root', { line: 1, column: 1 });
  convertNodes(ast.fragment.nodes, root, toLoc);
  return { file, framework: 'svelte', isDocument: false, root, styles: extractStyles(source) };
}

/** Block fragments (`{#if}`, `{#each}`, ...) are flattened into the parent: every branch may render. */
const BLOCK_FRAGMENTS = ['consequent', 'alternate', 'body', 'fallback', 'pending', 'then', 'catch', 'fragment'];

function convertNodes(nodes: SvelteNode[], parent: IRElement, toLoc: ReturnType<typeof lineIndex>): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'Text':
        appendChild(parent, { type: 'text', value: node.data, dynamic: false });
        break;
      case 'ExpressionTag':
      case 'HtmlTag':
      case 'RenderTag':
        appendChild(parent, { type: 'text', value: '', dynamic: true });
        break;
      case 'RegularElement':
      case 'Component':
      case 'SvelteElement':
      case 'SvelteComponent':
      case 'SlotElement':
      case 'TitleElement':
        appendChild(parent, convertElement(node, toLoc));
        break;
      case 'SnippetBlock':
        break; // rendered where {@render} is called, which we can't follow
      default:
        for (const key of BLOCK_FRAGMENTS) if (node[key]?.nodes) convertNodes(node[key].nodes, parent, toLoc);
    }
  }
}

function convertElement(node: SvelteNode, toLoc: ReturnType<typeof lineIndex>): IRElement {
  const el = element(node.name, toLoc(node.start));
  el.isComponent = node.type !== 'RegularElement' && node.type !== 'TitleElement';
  if (node.type === 'TitleElement') el.tag = 'title';
  for (const attr of node.attributes) {
    if (attr.type === 'SpreadAttribute') el.hasSpread = true;
    else if (attr.type === 'OnDirective') el.events.add(attr.name.toLowerCase());
    else if (attr.type === 'BindDirective') setAttr(el, attr.name, DYNAMIC);
    else if (attr.type === 'Attribute') {
      const v = attr.value;
      if (v === true) setAttr(el, attr.name, staticAttr(''));
      else if (Array.isArray(v) && v.every((p: SvelteNode) => p.type === 'Text')) {
        setAttr(el, attr.name, staticAttr(v.map((p: SvelteNode) => p.data).join('')));
      } else setAttr(el, attr.name, DYNAMIC);
    }
  }
  convertNodes(node.fragment.nodes, el, toLoc);
  return el;
}
