import { getStatic, type AttrValue, type IRElement } from '../ir.js';

/** Three-valued answer: rules only fail on `no`, and report `unknown` for review. */
export type Tri = 'yes' | 'no' | 'unknown';

export function or(a: Tri, b: Tri): Tri {
  if (a === 'yes' || b === 'yes') return 'yes';
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  return 'no';
}

export function hasValue(v: AttrValue | undefined): Tri {
  if (!v) return 'no';
  if (v.kind === 'dynamic') return 'unknown';
  return v.value.trim() ? 'yes' : 'no';
}

/** Name from `aria-label`, `aria-labelledby` or `title`. */
export function authorName(el: IRElement): Tri {
  return or(or(hasValue(el.attrs.get('aria-label')), hasValue(el.attrs.get('aria-labelledby'))), hasValue(el.attrs.get('title')));
}

/** Approximates the accessible name computation for name-from-content elements. */
export function accessibleName(el: IRElement): Tri {
  let name = or(authorName(el), contentName(el));
  if (name === 'no' && el.hasSpread) name = 'unknown';
  return name;
}

function contentName(el: IRElement): Tri {
  let name: Tri = 'no';
  for (const child of el.children) {
    if (child.type === 'text') name = or(name, child.dynamic ? 'unknown' : child.value.trim() ? 'yes' : 'no');
    else if (child.isComponent) name = or(name, 'unknown');
    else if (getStatic(child, 'aria-hidden') === 'true') continue;
    else if (child.tag === 'img' || child.tag === 'area') name = or(name, or(hasValue(child.attrs.get('alt')), authorName(child)));
    else if (child.tag === 'svg') name = or(name, svgName(child));
    else name = or(name, accessibleName(child));
    if (name === 'yes') return 'yes';
  }
  return name;
}

export function svgName(svg: IRElement): Tri {
  const title = svg.children.find((c): c is IRElement => c.type === 'element' && c.tag === 'title');
  const titleName = title ? contentName(title) : 'no';
  return or(authorName(svg), svg.hasSpread ? or(titleName, 'unknown') : titleName);
}

/** Visible text when it is fully known at lint time, otherwise undefined. */
export function staticText(el: IRElement): string | undefined {
  let text = '';
  for (const child of el.children) {
    if (child.type === 'text') {
      if (child.dynamic) return undefined;
      text += child.value;
    } else {
      if (child.isComponent) return undefined;
      if (getStatic(child, 'aria-hidden') === 'true') continue;
      const inner = staticText(child);
      if (inner === undefined) return undefined;
      text += ' ' + inner;
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

export function roleOf(el: IRElement): string | undefined {
  return getStatic(el, 'role')?.trim().split(/\s+/)[0];
}

export function isHidden(el: IRElement): boolean {
  return el.attrs.get('type')?.kind === 'static' && getStatic(el, 'type') === 'hidden';
}

/** Natively keyboard-focusable elements. */
export function isNativelyFocusable(el: IRElement): boolean {
  switch (el.tag) {
    case 'a':
    case 'area':
      return el.attrs.has('href');
    case 'button':
    case 'select':
    case 'textarea':
    case 'summary':
    case 'iframe':
      return true;
    case 'input':
      return !isHidden(el);
    case 'audio':
    case 'video':
      return el.attrs.has('controls');
    default:
      return getStatic(el, 'contenteditable') !== undefined && getStatic(el, 'contenteditable') !== 'false';
  }
}

export function tabindex(el: IRElement): number | 'dynamic' | undefined {
  const v = el.attrs.get('tabindex');
  if (!v) return undefined;
  if (v.kind === 'dynamic') return 'dynamic';
  const n = Number.parseInt(v.value, 10);
  return Number.isNaN(n) ? undefined : n;
}

export function* ancestors(el: IRElement): Generator<IRElement> {
  for (let p = el.parent; p; p = p.parent) yield p;
}

export function classes(el: IRElement): string[] | undefined {
  const cls = getStatic(el, 'class');
  return cls === undefined ? undefined : cls.split(/\s+/).filter(Boolean);
}
