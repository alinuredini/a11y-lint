import { getStatic, walk, type IRElement } from '../ir.js';
import type { Rule } from '../types.js';
import {
  ARIA_ATTRS,
  AUTOCOMPLETE_MODIFIERS,
  AUTOCOMPLETE_TOKENS,
  INTERACTIVE_ROLES,
  isValidRole,
  NAME_FROM_AUTHOR_ROLES,
  REQUIRED_ARIA,
} from './aria.js';
import {
  accessibleName,
  ancestors,
  authorName,
  classes,
  hasValue,
  isHidden,
  isNativelyFocusable,
  or,
  roleOf,
  staticText,
  svgName,
  tabindex,
  type Tri,
} from './helpers.js';

const POINTER_EVENTS = ['click', 'mousedown', 'mouseup', 'dblclick', 'pointerdown', 'pointerup'];
const KEY_EVENTS = ['keydown', 'keyup', 'keypress'];
const GENERIC_LINK_TEXT = /^(click here|here|read more|more|learn more|link|this|details|continue|mehr|hier|weiterlesen|mehr erfahren)$/i;
const GENERIC_ALT = /^(image|picture|photo|img|graphic|bild|foto|icon)$/i;
const FILENAME_ALT = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;
const LABELLABLE = new Set(['input', 'select', 'textarea']);
const NO_LABEL_INPUT_TYPES = new Set(['hidden', 'submit', 'reset', 'button', 'image']);

function describe(el: IRElement): string {
  return `<${el.rawName}>`;
}

export const rules: Rule[] = [
  {
    id: 'image-alt',
    description: 'Images need a text alternative (alt="" for decorative ones).',
    criteria: ['1.1.1'],
    check(el, ctx) {
      const isImage = el.tag === 'img' || el.tag === 'area' || (el.tag === 'input' && getStatic(el, 'type') === 'image');
      if (!isImage) return;
      const role = roleOf(el);
      if (el.tag === 'img' && (role === 'presentation' || role === 'none' || getStatic(el, 'aria-hidden') === 'true')) return;
      const alt = el.attrs.get('alt');
      if (alt || authorName(el) === 'yes') return;
      if (el.hasSpread || authorName(el) === 'unknown') ctx.report(el, 'unknown', `${describe(el)} has no alt; check the spread props provide one.`);
      else ctx.report(el, 'fail', `${describe(el)} is missing an alt attribute. Use alt="" if it is decorative.`);
    },
  },
  {
    id: 'image-alt-quality',
    description: 'Alt text must describe the image, not repeat its file name or type.',
    criteria: ['1.1.1'],
    check(el, ctx) {
      if (el.tag !== 'img') return;
      const alt = getStatic(el, 'alt')?.trim();
      if (alt && (FILENAME_ALT.test(alt) || GENERIC_ALT.test(alt))) {
        ctx.report(el, 'fail', `alt="${alt}" does not describe the image.`);
      }
    },
  },
  {
    id: 'svg-img-name',
    description: 'SVGs with role="img" need an accessible name.',
    criteria: ['1.1.1'],
    check(el, ctx) {
      if (el.tag !== 'svg' || roleOf(el) !== 'img') return;
      const name = svgName(el);
      if (name === 'no') ctx.report(el, 'fail', '<svg role="img"> needs aria-label, aria-labelledby or a <title>.');
    },
  },
  {
    id: 'button-name',
    description: 'Buttons need an accessible name.',
    criteria: ['4.1.2'],
    check(el, ctx) {
      let name: Tri;
      if (el.tag === 'button' || (roleOf(el) === 'button' && el.tag !== 'input')) name = accessibleName(el);
      else if (el.tag === 'input' && getStatic(el, 'type') === 'button') name = or(hasValue(el.attrs.get('value')), authorName(el));
      else return;
      if (name === 'no') ctx.report(el, 'fail', `${describe(el)} has no accessible name. Add text or aria-label.`);
      else if (name === 'unknown' && hasOnlyComponentContent(el)) ctx.report(el, 'unknown', `${describe(el)} contains only components (an icon?); verify they render text or add aria-label.`);
    },
  },
  {
    id: 'link-name',
    description: 'Links need an accessible name.',
    criteria: ['2.4.4', '4.1.2'],
    check(el, ctx) {
      if (!((el.tag === 'a' && el.attrs.has('href')) || roleOf(el) === 'link')) return;
      const name = accessibleName(el);
      if (name === 'no') ctx.report(el, 'fail', `${describe(el)} has no accessible name. Add text or aria-label.`);
      else if (name === 'unknown' && hasOnlyComponentContent(el)) ctx.report(el, 'unknown', `${describe(el)} contains only components (an icon?); verify they render text or add aria-label.`);
    },
  },
  {
    id: 'link-text-generic',
    description: 'Link text should make sense out of context.',
    criteria: ['2.4.4', '2.4.9'],
    check(el, ctx) {
      if (!(el.tag === 'a' && el.attrs.has('href'))) return;
      if (authorName(el) !== 'no') return;
      const text = staticText(el);
      if (!text || !GENERIC_LINK_TEXT.test(text)) return;
      // In context (2.4.4, A) surrounding text may explain the link; link-only purpose (2.4.9, AAA) is a hard fail.
      if (ctx.target === 'AAA') ctx.report(el, 'fail', `Link text "${text}" does not describe its destination.`, ['2.4.9']);
      else ctx.report(el, 'unknown', `Link text "${text}" is generic; make sure the surrounding text explains it.`, ['2.4.4']);
    },
  },
  {
    id: 'form-label',
    description: 'Form fields need a programmatic label.',
    criteria: ['1.3.1', '3.3.2', '4.1.2'],
    checkDocument(ctx) {
      const labelFor = new Set<string>();
      let dynamicFor = false;
      for (const el of walk(ctx.doc.root)) {
        if (el.tag !== 'label') continue;
        const f = el.attrs.get('for');
        if (f?.kind === 'static') labelFor.add(f.value);
        else if (f) dynamicFor = true;
      }
      for (const el of walk(ctx.doc.root)) {
        if (el.isComponent || !LABELLABLE.has(el.tag)) continue;
        if (el.tag === 'input' && NO_LABEL_INPUT_TYPES.has(getStatic(el, 'type') ?? '')) continue;
        if (isHidden(el)) continue;
        let name = authorName(el);
        if ([...ancestors(el)].some((a) => a.tag === 'label')) name = 'yes';
        const id = el.attrs.get('id');
        if (id?.kind === 'static' && labelFor.has(id.value)) name = 'yes';
        if (name === 'no' && ((id?.kind === 'dynamic' && labelFor.size + Number(dynamicFor) > 0) || (id && dynamicFor))) name = 'unknown';
        if (name === 'no' && (el.hasSpread || el.parent?.isComponent)) name = 'unknown';
        if (name === 'yes') continue;
        const hint = el.attrs.has('placeholder') ? ' A placeholder is not a label.' : '';
        if (name === 'no') ctx.report(el, 'fail', `${describe(el)} has no label. Use <label for>, a wrapping <label> or aria-label.${hint}`);
        else ctx.report(el, 'unknown', `${describe(el)} label depends on runtime values or a wrapper component; verify it.`);
      }
    },
  },
  {
    id: 'click-needs-keyboard',
    description: 'Elements with pointer handlers must be focusable and keyboard operable.',
    criteria: ['2.1.1'],
    check(el, ctx) {
      if (isNativelyFocusable(el) || ['label', 'form', 'html', 'body', 'dialog'].includes(el.tag)) return;
      const role = roleOf(el);
      const hasPointer = POINTER_EVENTS.some((e) => el.events.has(e));
      const interactiveRole = role !== undefined && INTERACTIVE_ROLES.has(role) && !['textbox', 'searchbox'].includes(role);
      if (!hasPointer && !interactiveRole) return;
      if (role === 'presentation' || role === 'none') return;
      const ti = tabindex(el);
      if (ti === undefined || (typeof ti === 'number' && ti < 0)) {
        ctx.report(el, el.hasSpread ? 'unknown' : 'fail', `${describe(el)} ${hasPointer ? 'has a click handler' : `has role="${role}"`} but is not keyboard focusable. Use a <button>, or add tabindex="0".`);
        return;
      }
      if (!KEY_EVENTS.some((e) => el.events.has(e)) && hasPointer) {
        ctx.report(el, el.hasSpread ? 'unknown' : 'fail', `${describe(el)} handles clicks but not Enter/Space. Use a <button>, or add a keydown handler.`);
      }
    },
  },
  {
    id: 'click-needs-role',
    description: 'Clickable non-interactive elements must expose a widget role.',
    criteria: ['4.1.2'],
    check(el, ctx) {
      if (isNativelyFocusable(el) || ['label', 'form', 'html', 'body', 'dialog', 'img'].includes(el.tag)) return;
      if (!POINTER_EVENTS.some((e) => el.events.has(e))) return;
      const role = roleOf(el);
      if (role && INTERACTIVE_ROLES.has(role)) return;
      if (el.attrs.get('role')?.kind === 'dynamic' || el.hasSpread) return;
      ctx.report(el, 'fail', `Clickable ${describe(el)} has no widget role, so assistive tech does not announce it as interactive.`);
    },
  },
  {
    id: 'no-positive-tabindex',
    description: 'tabindex greater than 0 breaks the natural focus order.',
    criteria: ['2.4.3'],
    check(el, ctx) {
      const ti = tabindex(el);
      if (typeof ti === 'number' && ti > 0) ctx.report(el, 'fail', `tabindex="${ti}" overrides the focus order. Use 0 or -1.`);
    },
  },
  {
    id: 'aria-hidden-focusable',
    description: 'aria-hidden elements must not be focusable.',
    criteria: ['4.1.2'],
    check(el, ctx) {
      if (getStatic(el, 'aria-hidden') !== 'true') return;
      const ti = tabindex(el);
      if ((isNativelyFocusable(el) && ti !== -1) || (typeof ti === 'number' && ti >= 0)) {
        ctx.report(el, 'fail', `${describe(el)} is aria-hidden but still focusable.`);
      }
    },
  },
  {
    id: 'aria-valid-attr',
    description: 'aria-* attributes must exist in the ARIA spec.',
    criteria: ['4.1.2'],
    check(el, ctx) {
      for (const name of el.attrs.keys()) {
        if (name.startsWith('aria-') && !ARIA_ATTRS.has(name)) ctx.report(el, 'fail', `${name} is not a valid ARIA attribute.`);
      }
    },
  },
  {
    id: 'aria-valid-role',
    description: 'role must be a valid ARIA role.',
    criteria: ['4.1.2'],
    check(el, ctx) {
      const role = getStatic(el, 'role');
      if (role === undefined) return;
      const tokens = role.trim().split(/\s+/).filter(Boolean);
      if (!tokens.some(isValidRole)) ctx.report(el, 'fail', `role="${role}" is not a valid ARIA role.`);
    },
  },
  {
    id: 'aria-required-attr',
    description: 'Custom widgets must expose their required ARIA states.',
    criteria: ['4.1.2'],
    check(el, ctx) {
      const role = roleOf(el);
      if (!role || el.tag === 'input' || el.hasSpread) return;
      if (role === 'heading' && /^h[1-6]$/.test(el.tag)) return;
      const missing = (REQUIRED_ARIA[role] ?? []).filter((a) => !el.attrs.has(a));
      if (missing.length) ctx.report(el, 'fail', `role="${role}" requires ${missing.join(', ')}.`);
    },
  },
  {
    id: 'aria-name',
    description: 'Dialogs, sliders, listboxes and similar widgets need an author-provided name.',
    criteria: ['4.1.2'],
    check(el, ctx) {
      const role = el.tag === 'dialog' ? 'dialog' : roleOf(el);
      if (!role || !NAME_FROM_AUTHOR_ROLES.has(role) || LABELLABLE.has(el.tag) || el.tag === 'svg' || el.tag === 'img') return;
      const name = authorName(el);
      if (name === 'no' && !el.hasSpread) ctx.report(el, 'fail', `${describe(el)} with role "${role}" needs aria-label or aria-labelledby.`);
    },
  },
  {
    id: 'label-in-name',
    description: 'The accessible name must contain the visible label.',
    criteria: ['2.5.3'],
    check(el, ctx) {
      const label = getStatic(el, 'aria-label')?.trim().toLowerCase();
      if (!label) return;
      const interactive = isNativelyFocusable(el) || INTERACTIVE_ROLES.has(roleOf(el) ?? '');
      if (!interactive) return;
      const text = staticText(el)?.toLowerCase();
      if (text && /[a-z0-9]/i.test(text) && !label.includes(text)) {
        ctx.report(el, 'fail', `aria-label "${getStatic(el, 'aria-label')}" does not contain the visible text "${text}". Voice control users say what they see.`);
      }
    },
  },
  {
    id: 'heading-empty',
    description: 'Headings must have content.',
    criteria: ['1.3.1', '2.4.6'],
    check(el, ctx) {
      if (!/^h[1-6]$/.test(el.tag)) return;
      if (accessibleName(el) === 'no') ctx.report(el, 'fail', `${describe(el)} is empty.`);
    },
  },
  {
    id: 'heading-order',
    description: 'Heading levels should only increase by one.',
    criteria: ['1.3.1'],
    checkDocument(ctx) {
      if (!ctx.doc.isDocument) return; // components can't know their surrounding heading level
      let prev = 0;
      for (const el of walk(ctx.doc.root)) {
        const m = /^h([1-6])$/.exec(el.tag);
        if (!m) continue;
        const level = Number(m[1]);
        if (prev && level > prev + 1) ctx.report(el, 'unknown', `Heading jumps from h${prev} to h${level}.`);
        prev = level;
      }
    },
  },
  {
    id: 'html-lang',
    description: 'The page must declare its language.',
    criteria: ['3.1.1'],
    check(el, ctx) {
      if (el.tag !== 'html' || !ctx.doc.isDocument) return;
      const lang = hasValue(el.attrs.get('lang'));
      if (lang === 'no' && !el.hasSpread) ctx.report(el, 'fail', '<html> is missing a lang attribute.');
    },
  },
  {
    id: 'valid-lang',
    description: 'lang attributes must be valid BCP 47 tags.',
    criteria: ['3.1.1', '3.1.2'],
    check(el, ctx) {
      const lang = getStatic(el, 'lang');
      if (lang === undefined || lang === '' ) return;
      if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(lang.trim())) {
        ctx.report(el, 'fail', `lang="${lang}" is not a valid language tag.`, el.tag === 'html' ? ['3.1.1'] : ['3.1.2']);
      }
    },
  },
  {
    id: 'page-title',
    description: 'Pages need a non-empty <title>.',
    criteria: ['2.4.2'],
    checkDocument(ctx) {
      if (!ctx.doc.isDocument) return;
      const titles = [...walk(ctx.doc.root)].filter((e) => e.tag === 'title' && !e.parent?.tag.startsWith('svg'));
      const html = [...walk(ctx.doc.root)].find((e) => e.tag === 'html') ?? ctx.doc.root;
      const name = titles.reduce<Tri>((acc, t) => or(acc, t.children.some((c) => c.type === 'text' && (c.dynamic || c.value.trim())) ? 'yes' : t.children.some((c) => c.type === 'element' && c.isComponent) ? 'unknown' : 'no'), 'no');
      const hasHeadComponent = [...walk(ctx.doc.root)].some((e) => e.isComponent && /head|seo|meta/i.test(e.rawName));
      if (name === 'no' && !hasHeadComponent) ctx.report(html, 'fail', 'The page has no <title>.');
    },
  },
  {
    id: 'bypass-blocks',
    description: 'Pages need a way to skip repeated content: a <main> landmark or a skip link.',
    criteria: ['2.4.1'],
    checkDocument(ctx) {
      if (!ctx.doc.isDocument) return;
      const all = [...walk(ctx.doc.root)];
      if (all.some((e) => e.isComponent)) return; // layout components may render <main>
      const hasMain = all.some((e) => e.tag === 'main' || roleOf(e) === 'main');
      const hasSkip = all.some((e) => e.tag === 'a' && getStatic(e, 'href')?.startsWith('#'));
      if (!hasMain && !hasSkip) {
        const html = all.find((e) => e.tag === 'html') ?? ctx.doc.root;
        ctx.report(html, 'fail', 'No <main> landmark or skip link found.');
      }
    },
  },
  {
    id: 'no-autoplay-audio',
    description: 'Media must not autoplay with sound.',
    criteria: ['1.4.2'],
    check(el, ctx) {
      if ((el.tag === 'video' || el.tag === 'audio') && el.attrs.has('autoplay') && !el.attrs.has('muted')) {
        ctx.report(el, 'fail', `${describe(el)} autoplays with sound. Add muted, or don't autoplay.`);
      }
    },
  },
  {
    id: 'media-captions',
    description: 'Videos with audio need captions.',
    criteria: ['1.2.2'],
    check(el, ctx) {
      if (el.tag !== 'video' || el.attrs.has('muted')) return;
      const tracks = el.children.filter((c): c is IRElement => c.type === 'element' && c.tag === 'track');
      const kinds = tracks.map((t) => t.attrs.get('kind'));
      if (kinds.some((k) => k?.kind === 'static' && /^(captions|subtitles)$/.test(k.value))) return;
      if (kinds.some((k) => k?.kind === 'dynamic') || el.children.some((c) => c.type === 'element' && c.isComponent)) return;
      ctx.report(el, 'fail', '<video> has no <track kind="captions">.');
    },
  },
  {
    id: 'iframe-title',
    description: 'iframes need a title.',
    criteria: ['4.1.2'],
    check(el, ctx) {
      if (el.tag !== 'iframe' || getStatic(el, 'aria-hidden') === 'true' || tabindex(el) === -1) return;
      const name = authorName(el);
      if (name === 'no' && !el.hasSpread) ctx.report(el, 'fail', '<iframe> needs a title describing its content.');
    },
  },
  {
    id: 'no-distracting-elements',
    description: '<marquee> and <blink> cannot be paused.',
    criteria: ['2.2.2'],
    check(el, ctx) {
      if (el.tag === 'marquee' || el.tag === 'blink') ctx.report(el, 'fail', `${describe(el)} moves without a way to pause it.`);
    },
  },
  {
    id: 'meta-refresh',
    description: 'Pages must not refresh or redirect on a timer.',
    criteria: ['2.2.1'],
    check(el, ctx) {
      if (el.tag !== 'meta' || getStatic(el, 'http-equiv')?.toLowerCase() !== 'refresh') return;
      const delay = Number.parseFloat(getStatic(el, 'content') ?? '');
      if (delay > 0) ctx.report(el, 'fail', `<meta http-equiv="refresh"> reloads after ${delay}s.`);
    },
  },
  {
    id: 'meta-viewport-zoom',
    description: 'The viewport must allow zooming.',
    criteria: ['1.4.4'],
    check(el, ctx) {
      if (el.tag !== 'meta' || getStatic(el, 'name') !== 'viewport') return;
      const content = (getStatic(el, 'content') ?? '').toLowerCase();
      const maxScale = /maximum-scale\s*=\s*([\d.]+)/.exec(content);
      if (/user-scalable\s*=\s*(no|0)/.test(content) || (maxScale && Number(maxScale[1]) < 2)) {
        ctx.report(el, 'fail', 'The viewport meta tag blocks zooming.');
      }
    },
  },
  {
    id: 'autocomplete-valid',
    description: 'autocomplete values must be valid tokens.',
    criteria: ['1.3.5'],
    check(el, ctx) {
      if (!LABELLABLE.has(el.tag)) return;
      const value = getStatic(el, 'autocomplete')?.trim().toLowerCase();
      if (!value) return;
      const tokens = value.split(/\s+/);
      const field = tokens.at(-1)!;
      if (!AUTOCOMPLETE_TOKENS.has(field) || !tokens.slice(0, -1).every((t) => AUTOCOMPLETE_MODIFIERS.test(t))) {
        ctx.report(el, 'fail', `autocomplete="${value}" is not a valid value.`);
      }
    },
  },
  {
    id: 'autocomplete-missing',
    description: 'Fields collecting personal data should declare their purpose.',
    criteria: ['1.3.5'],
    check(el, ctx) {
      if (el.tag !== 'input' || el.attrs.has('autocomplete') || el.hasSpread) return;
      const type = getStatic(el, 'type') ?? 'text';
      const hint = `${getStatic(el, 'name') ?? ''} ${getStatic(el, 'id') ?? ''}`;
      if (type === 'email' || type === 'tel' || /e-?mail|phone|tel\b|first.?name|last.?name|full.?name|street|address|zip|postal|city|country|birthday|bday/i.test(hint)) {
        ctx.report(el, 'unknown', `${describe(el)} looks like it collects personal data but has no autocomplete attribute.`);
      }
    },
  },
  {
    id: 'focus-outline-removed',
    description: 'Removing the focus outline needs a visible replacement.',
    criteria: ['2.4.7'],
    check(el, ctx) {
      const cls = classes(el);
      const style = getStatic(el, 'style') ?? '';
      const removesViaClass = cls?.some((c) => /^(focus:|focus-visible:)?outline-none$/.test(c));
      const removesViaStyle = /outline\s*:\s*(none|0)\b/.test(style);
      if (!removesViaClass && !removesViaStyle) return;
      const replaced = cls?.some((c) => /^(focus|focus-visible|focus-within):(ring|outline|border|shadow|underline|bg-)/.test(c) && !/outline-none$/.test(c));
      if (!replaced) ctx.report(el, 'fail', `${describe(el)} removes the focus outline without a focus style to replace it.`);
    },
  },
  {
    id: 'table-headers',
    description: 'Data tables need header cells.',
    criteria: ['1.3.1'],
    check(el, ctx) {
      if (el.tag !== 'table' || ['presentation', 'none'].includes(roleOf(el) ?? '')) return;
      const cells = [...walk(el)];
      if (cells.some((c) => c.isComponent)) return;
      if (cells.some((c) => c.tag === 'td') && !cells.some((c) => c.tag === 'th' || roleOf(c) === 'columnheader' || roleOf(c) === 'rowheader')) {
        ctx.report(el, 'unknown', '<table> has no <th> cells. If it holds data, add headers; if it is for layout, add role="presentation".');
      }
    },
  },
];

function hasOnlyComponentContent(el: IRElement): boolean {
  return el.children.length > 0 && el.children.every((c) => (c.type === 'element' && c.isComponent) || (c.type === 'text' && !c.dynamic && !c.value.trim()));
}
