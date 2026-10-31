import type { Page } from 'playwright';
import type { Finding } from '../types.js';

const STYLE_PROPS = ['outlineStyle', 'outlineWidth', 'outlineColor', 'boxShadow', 'borderColor', 'backgroundColor', 'color', 'textDecorationLine'] as const;

interface Stop {
  selector: string;
  styles: string[];
  obscured: boolean;
}

/**
 * Tabs through the page like a keyboard user. Flags focus traps (2.1.2), elements whose
 * style doesn't change on focus (2.4.7) and focused elements covered by other content (2.4.11).
 */
export async function keyboardWalk(page: Page, url: string, maxStops: number): Promise<Finding[]> {
  const findings: Finding[] = [];
  const base = { file: url, line: 1, column: 1, source: 'runtime' as const };
  const tabbable = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]')].filter(
        (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
      ).length,
  );

  const stops: Stop[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate((props) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el.tagName === 'IFRAME') return null;
      const path: string[] = [];
      for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
        const idx = n.parentElement ? [...n.parentElement.children].indexOf(n) + 1 : 1;
        path.unshift(n.id ? `#${CSS.escape(n.id)}` : `${n.tagName.toLowerCase()}:nth-child(${idx})`);
        if (n.id) break;
      }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        selector: path.join(' > '),
        styles: props.map((p) => cs[p as keyof CSSStyleDeclaration] as string),
        obscured: r.width > 0 && !!top && !el.contains(top) && !top.contains(el),
      };
    }, STYLE_PROPS as unknown as string[]);
    if (!stop) {
      if (stops.length) break; // focus left the document: the full cycle is done
      continue;
    }
    if (seen.has(stop.selector)) {
      if (seen.size < tabbable) {
        findings.push({ ...base, ruleId: 'keyboard-trap', criteria: ['2.1.2'], level: 'A', status: 'fail', message: `Focus cycles back to ${stop.selector} after ${seen.size} of ${tabbable} focusable elements; keyboard users may be trapped.` });
      }
      break;
    }
    seen.add(stop.selector);
    stops.push(stop);
  }

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (const stop of stops) {
    const unfocused = await page.evaluate(
      ({ selector, props }) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return props.map((p) => cs[p as keyof CSSStyleDeclaration] as string);
      },
      { selector: stop.selector, props: STYLE_PROPS as unknown as string[] },
    );
    if (unfocused && unfocused.every((v, i) => v === stop.styles[i])) {
      findings.push({ ...base, ruleId: 'focus-visible', criteria: ['2.4.7'], level: 'AA', status: 'fail', message: `No visible style change when ${stop.selector} receives focus.` });
    }
    if (stop.obscured) {
      findings.push({ ...base, ruleId: 'focus-obscured', criteria: ['2.4.11'], level: 'AA', status: 'unknown', message: `${stop.selector} may be hidden behind other content when focused (sticky header, banner?).` });
    }
  }
  return findings;
}
