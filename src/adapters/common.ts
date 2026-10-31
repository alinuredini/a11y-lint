import { parseExpression } from '@babel/parser';
import { dynamicAttr, type AttrValue, type IRElement } from '../ir.js';

type Node = { type: string; [key: string]: any };

const GUARD_ONLY = /^\(?\w*(:[\w.<>]+)?\)?=>\{?(\w+\.(stopPropagation|preventDefault)\(\);?)+\}?$/;

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
    // `(e) => e.stopPropagation()` only shields a parent's handler; it isn't an action.
    const guardOnly = value.kind === 'dynamic' && value.expr && GUARD_ONLY.test(value.expr);
    if (!guardOnly) el.events.add(rawName.slice(2).toLowerCase());
    return;
  }
  const lower = rawName.toLowerCase();
  el.attrs.set(RENAMES[lower] ?? lower, value);
}

/** Expressions that can never evaluate to an empty string: `` `Remove ${x}` ``, `a ? 'Open' : 'Close'`. */
export function alwaysHasText(expr: Node): boolean {
  switch (expr.type) {
    case 'StringLiteral':
      return expr.value.trim() !== '';
    case 'TemplateLiteral':
      return expr.quasis.some((q: Node) => (q.value.cooked ?? '').trim() !== '');
    case 'ConditionalExpression':
      return alwaysHasText(expr.consequent) && alwaysHasText(expr.alternate);
    case 'LogicalExpression':
      return (expr.operator === '??' || expr.operator === '||') && alwaysHasText(expr.right);
    default:
      return false;
  }
}

/** A dynamic attribute from expression source text, as written in Vue, Angular or Astro templates. */
export function exprAttr(source: string | undefined): AttrValue {
  if (!source) return dynamicAttr();
  let nonEmpty = false;
  try {
    nonEmpty = alwaysHasText(parseExpression(source, { plugins: ['typescript'] }) as Node);
  } catch {
    // not plain JS (Angular pipes etc.): leave it unknown
  }
  return dynamicAttr(source, nonEmpty);
}
