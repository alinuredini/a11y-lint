import { parse } from 'svelte/compiler';
import { appendChild, DYNAMIC, dynamicAttr, element, extractStyles, lineIndex, staticAttr, type IRDocument, type IRElement } from '../ir.js';
import { setAttr } from './common.js';

type SvelteNode = { type: string; start: number; [key: string]: any };

interface Ctx {
  toLoc: ReturnType<typeof lineIndex>;
  source: string;
}

export function parseSvelte(file: string, source: string): IRDocument {
  const ast = parse(source, { modern: true }) as unknown as { fragment: { nodes: SvelteNode[] } };
  const toLoc = lineIndex(source);
  const root = element('#root', { line: 1, column: 1 });
  convertNodes(ast.fragment.nodes, root, { toLoc, source });
  return { file, framework: 'svelte', isDocument: false, root, styles: extractStyles(source) };
}

/** Block fragments (`{#if}`, `{#each}`, ...) are flattened into the parent: every branch may render. */
const BLOCK_FRAGMENTS = ['consequent', 'alternate', 'body', 'fallback', 'pending', 'then', 'catch', 'fragment'];

function convertNodes(nodes: SvelteNode[], parent: IRElement, ctx: Ctx): void {
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
        appendChild(parent, convertElement(node, ctx));
        break;
      case 'SnippetBlock':
        break; // rendered where {@render} is called, which we can't follow
      default:
        for (const key of BLOCK_FRAGMENTS) if (node[key]?.nodes) convertNodes(node[key].nodes, parent, ctx);
    }
  }
}

function convertElement(node: SvelteNode, ctx: Ctx): IRElement {
  const el = element(node.name, ctx.toLoc(node.start));
  el.isComponent = node.type !== 'RegularElement' && node.type !== 'TitleElement';
  if (node.type === 'TitleElement') el.tag = 'title';
  for (const attr of node.attributes) {
    if (attr.type === 'SpreadAttribute') el.hasSpread = true;
    else if (attr.type === 'OnDirective') el.events.add(attr.name.toLowerCase());
    else if (attr.type === 'BindDirective') setAttr(el, attr.name, DYNAMIC);
    else if (attr.type === 'Attribute') {
      const v = attr.value;
      const parts: SvelteNode[] = v === true ? [] : Array.isArray(v) ? v : [v];
      if (v === true) setAttr(el, attr.name, staticAttr(''));
      else if (parts.every((p) => p.type === 'Text')) setAttr(el, attr.name, staticAttr(parts.map((p) => p.data).join('')));
      else {
        // `aria-label="Remove {name}"` always has text; `alt={x}` keeps its source for for/id matching.
        const expr = parts.length === 1 ? parts[0].expression : undefined;
        const nonEmpty = parts.some((p) => p.type === 'Text' && p.data.trim() !== '');
        setAttr(el, attr.name, dynamicAttr(expr ? ctx.source.slice(expr.start, expr.end) : undefined, nonEmpty));
      }
    }
  }
  convertNodes(node.fragment.nodes, el, ctx);
  return el;
}
