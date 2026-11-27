import type { JSHandle, Page } from 'playwright';
import type { Finding } from '../types.js';

const STYLE_PROPS = ['outlineStyle', 'outlineWidth', 'outlineColor', 'boxShadow', 'borderColor', 'backgroundColor', 'color', 'textDecorationLine'] as const;

/** How long a closing overlay may take to move focus (exit animations). */
const ESCAPE_TIMEOUT = 1500;

interface Stop {
  selector: string;
  styles: string[];
  obscured: boolean;
  /** Reachable with Tab; false for a container that was focused by script (`tabindex="-1"`). */
  tabStop: boolean;
}

/**
 * Tabs through the page like a keyboard user. Flags focus traps (2.1.2), elements whose
 * style doesn't change on focus (2.4.7) and focused elements covered by other content (2.4.11).
 * A cycle that Escape releases (a modal dialog, an open menu) is focus containment, not a trap.
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
  let cycleAt: Stop | undefined;
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
        tabStop: el.tabIndex >= 0,
      };
    }, STYLE_PROPS as unknown as string[]);
    if (!stop) {
      if (stops.length) break; // focus left the document: the full cycle is done
      continue;
    }
    if (seen.has(stop.selector)) {
      if (seen.size < tabbable) cycleAt = stop;
      break;
    }
    seen.add(stop.selector);
    stops.push(stop);
  }

  // Handles to the cycle's elements, taken before anything closes and the selectors stop matching.
  const cycle = cycleAt && (await page.evaluateHandle((selectors) => selectors.map((s) => document.querySelector<HTMLElement>(s)), [cycleAt.selector, ...seen]));

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
      findings.push(
        stop.tabStop
          ? { ...base, ruleId: 'focus-visible', criteria: ['2.4.7'], level: 'AA', status: 'fail', message: `No visible style change when ${stop.selector} receives focus.` }
          : // A dialog or menu container focused by script usually marks the focus position on its items instead.
            { ...base, ruleId: 'focus-visible', criteria: ['2.4.7'], level: 'AA', status: 'unknown', message: `${stop.selector} holds focus without a visible style change, but is not a tab stop (focused by script); verify the focus position is visible inside it.` },
      );
    }
    if (stop.obscured) {
      findings.push({ ...base, ruleId: 'focus-obscured', criteria: ['2.4.11'], level: 'AA', status: 'unknown', message: `${stop.selector} may be hidden behind other content when focused (sticky header, banner?).` });
    }
  }

  if (cycleAt && cycle && !(await escapeReleases(page, cycle))) {
    findings.unshift({ ...base, ruleId: 'keyboard-trap', criteria: ['2.1.2'], level: 'A', status: 'fail', message: `Focus cycles back to ${cycleAt.selector} after ${seen.size} of ${tabbable} focusable elements and Escape does not release it; keyboard users may be trapped.` });
  }
  return findings;
}

/** Puts focus back into the cycle and presses Escape: true when focus leaves the cycle or its container closes. */
async function escapeReleases(page: Page, cycle: JSHandle<(HTMLElement | null)[]>): Promise<boolean> {
  const present = await page.evaluate(([first]) => {
    first?.focus();
    return !!first && document.activeElement === first;
  }, cycle);
  if (!present) return true; // already gone
  await page.keyboard.press('Escape');
  return page
    .waitForFunction(
      (els) => {
        const active = document.activeElement as HTMLElement | null;
        return !active || !els.includes(active) || active.getClientRects().length === 0;
      },
      cycle,
      { timeout: ESCAPE_TIMEOUT },
    )
    .then(() => true, () => false);
}
