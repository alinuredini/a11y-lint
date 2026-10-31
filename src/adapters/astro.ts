import { parse } from '@astrojs/compiler';
import { appendChild, dynamicAttr, element, extractStyles, setDynamicContent, staticAttr, type IRDocument, type IRElement } from '../ir.js';
import { exprAttr, importsFromScript, linkImports, setAttr, sfcExports } from './common.js';

type AstroNode = {
  type: string;
  name?: string;
  value?: string;
  attributes?: { kind: string; name: string; value: string }[];
  children?: AstroNode[];
  position?: { start: { line: number; column: number } };
};

export async function parseAstro(file: string, source: string): Promise<IRDocument> {
  const { ast } = await parse(source, { position: true });
  const root = element('#root', { line: 1, column: 1 });
  convertChildren(ast.children as AstroNode[], root, false);
  const isDocument = root.children.some((c) => c.type === 'element' && c.tag === 'html');
  const frontmatter = (ast.children as AstroNode[]).find((c) => c.type === 'frontmatter')?.value;
  linkImports(root, importsFromScript(frontmatter));
  return { file, framework: 'astro', isDocument, root, styles: extractStyles(source), exports: sfcExports(root) };
}

function convertChildren(children: AstroNode[] = [], parent: IRElement, inExpression: boolean): void {
  for (const child of children) {
    switch (child.type) {
      case 'text':
        // Text inside `{ ... }` is JavaScript, i.e. runtime output.
        appendChild(parent, { type: 'text', value: inExpression ? '' : child.value ?? '', dynamic: inExpression });
        break;
      case 'expression':
        appendChild(parent, { type: 'text', value: '', dynamic: true });
        convertChildren(child.children, parent, true);
        break;
      case 'fragment':
        convertChildren(child.children, parent, inExpression);
        break;
      case 'element':
      case 'component':
      case 'custom-element':
        appendChild(parent, convertElement(child));
        break;
    }
  }
}

function convertElement(node: AstroNode): IRElement {
  const start = node.position?.start ?? { line: 1, column: 1 };
  const el = element(node.name!, { line: start.line, column: start.column });
  el.isComponent = node.type !== 'element';
  for (const attr of node.attributes ?? []) {
    if (attr.kind === 'spread') el.hasSpread = true;
    else if (attr.kind === 'quoted') setAttr(el, attr.name, staticAttr(attr.value));
    else if (attr.kind === 'empty') setAttr(el, attr.name, staticAttr(''));
    else if (attr.name === 'set:html' || attr.name === 'set:text') setDynamicContent(el);
    else if (attr.kind === 'template-literal') setAttr(el, attr.name, dynamicAttr(attr.value, attr.value.replace(/\$\{[^}]*\}/g, '').trim() !== ''));
    else setAttr(el, attr.name, attr.kind === 'expression' ? exprAttr(attr.value) : dynamicAttr());
  }
  convertChildren(node.children, el, false);
  return el;
}
