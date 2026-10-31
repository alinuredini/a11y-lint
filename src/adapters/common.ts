import type { AttrValue, IRElement } from '../ir.js';

const RENAMES: Record<string, string> = { classname: 'class', htmlfor: 'for' };

/** Components (`Button`, `Foo.Bar`) and custom elements (`app-card`) are opaque to rules. */
export function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) || name.includes('-') || name.includes('.') || name.includes(':');
}

/**
 * Sets an attribute using DOM semantics: `onClick`/`onclick` become events,
 * `className`/`htmlFor` are renamed, everything else is lowercased.
 */
export function setAttr(el: IRElement, rawName: string, value: AttrValue): void {
  if (/^on[a-z]/i.test(rawName) && rawName.length > 2) {
    el.events.add(rawName.slice(2).toLowerCase());
    return;
  }
  const lower = rawName.toLowerCase();
  el.attrs.set(RENAMES[lower] ?? lower, value);
}
