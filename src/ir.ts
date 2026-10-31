// The common element tree every framework adapter produces. Rules only ever see this.

export interface Loc {
  line: number; // 1-based
  column: number; // 1-based
}

/** A value known at lint time, or one that only exists at runtime (`alt={caption}`). */
export type AttrValue = { kind: 'static'; value: string } | { kind: 'dynamic' };

export interface IRElement {
  type: 'element';
  /** Lowercase HTML tag, or the mapped tag for a configured component. */
  tag: string;
  /** Original name as written (`Button`, `app-card`, `img`). */
  rawName: string;
  /** Unmapped component or custom element: rules skip it, children are still walked. */
  isComponent: boolean;
  attrs: Map<string, AttrValue>;
  /** `{...props}`, `v-bind="obj"`: any attribute may be set at runtime. */
  hasSpread: boolean;
  /** DOM event names with a handler attached (`click`, `keydown`). */
  events: Set<string>;
  children: IRNode[];
  parent?: IRElement;
  loc: Loc;
}

export interface IRText {
  type: 'text';
  value: string;
  /** Expression output (`{label}`), content unknown until runtime. */
  dynamic: boolean;
}

export type IRNode = IRElement | IRText;

export interface IRStyle {
  /** CSS (or SCSS) source. */
  css: string;
  lang: 'css' | 'scss';
  /** Line in the host file where the style text starts. */
  line: number;
}

export interface IRDocument {
  file: string;
  framework: string;
  /** True when the file is a full HTML document (has an `<html>` element). */
  isDocument: boolean;
  root: IRElement;
  styles: IRStyle[];
}

export function element(rawName: string, loc: Loc): IRElement {
  return {
    type: 'element',
    tag: rawName.toLowerCase(),
    rawName,
    isComponent: false,
    attrs: new Map(),
    hasSpread: false,
    events: new Set(),
    children: [],
    loc,
  };
}

export function staticAttr(value: string): AttrValue {
  return { kind: 'static', value };
}

export const DYNAMIC: AttrValue = { kind: 'dynamic' };

export function appendChild(parent: IRElement, child: IRNode): void {
  if (child.type === 'element') child.parent = parent;
  parent.children.push(child);
}

export function* walk(node: IRElement): Generator<IRElement> {
  yield node;
  for (const child of node.children) if (child.type === 'element') yield* walk(child);
}

export function getStatic(el: IRElement, name: string): string | undefined {
  const v = el.attrs.get(name);
  return v?.kind === 'static' ? v.value : undefined;
}

/** Converts 0-based offsets into 1-based line/column positions. */
export function lineIndex(source: string): (offset: number) => Loc {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo] + 1 };
  };
}

/** Pulls `<style>` blocks out of SFC-style sources (Vue, Svelte, Astro, HTML). */
export function extractStyles(source: string): IRStyle[] {
  const styles: IRStyle[] = [];
  const re = /<style([^>]*)>([\s\S]*?)<\/style>/gi;
  for (const m of source.matchAll(re)) {
    const attrs = m[1];
    const lang = /lang=["']?(scss|sass)/.test(attrs) ? 'scss' : 'css';
    const contentStart = m.index! + m[0].indexOf('>') + 1;
    const line = source.slice(0, contentStart).split('\n').length;
    styles.push({ css: m[2], lang, line });
  }
  return styles;
}
