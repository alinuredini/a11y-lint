import { converter, parse, wcagContrast, type Rgb } from 'culori';
import type { Level } from '../wcag.js';

const toRgb = converter('rgb');

export function parseColor(value: string): Rgb | undefined {
  const parsed = parse(value.trim());
  return parsed ? toRgb(parsed) : undefined;
}

/** Composites a translucent foreground over an opaque background. */
function flatten(fg: Rgb, bg: Rgb): Rgb {
  const a = fg.alpha ?? 1;
  return { mode: 'rgb', r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
}

export interface ContrastResult {
  ratio: number;
  /** Background is translucent, so the real ratio depends on what is behind it. */
  uncertain: boolean;
}

const WHITE: Rgb = { mode: 'rgb', r: 1, g: 1, b: 1 };

/** `page` is what a translucent background is assumed to sit on (white unless the theme says otherwise). */
export function contrast(fg: Rgb, bg: Rgb, page: Rgb = WHITE): ContrastResult {
  const uncertain = (bg.alpha ?? 1) < 1;
  const solidBg = uncertain ? flatten(bg, { ...page, alpha: 1 }) : { ...bg, alpha: 1 };
  return { ratio: wcagContrast(flatten(fg, solidBg), solidBg), uncertain };
}

export type TextSize = 'normal' | 'large' | 'ui';

export interface Threshold {
  criterion: string;
  level: Level;
  min: number;
}

/** Thresholds a pair must meet at the target level, strictest last. */
export function thresholds(size: TextSize, target: Level): Threshold[] {
  if (size === 'ui') return [{ criterion: '1.4.11', level: 'AA', min: 3 }];
  const list: Threshold[] = [{ criterion: '1.4.3', level: 'AA', min: size === 'large' ? 3 : 4.5 }];
  if (target === 'AAA') list.push({ criterion: '1.4.6', level: 'AAA', min: size === 'large' ? 4.5 : 7 });
  return list;
}

/** Records the criteria an evaluated pair counts toward, for the conformance report. */
export function markCovered(covered: Set<string> | undefined, size: TextSize, target: Level): void {
  for (const t of thresholds(size, target)) covered?.add(t.criterion);
}

/** First threshold the ratio misses, if any. */
export function failedThreshold(ratio: number, size: TextSize, target: Level): Threshold | undefined {
  // Round down to 2 decimals as checkers do, so 4.499 does not pass as 4.5.
  const r = Math.floor(ratio * 100) / 100;
  return thresholds(size, target).find((t) => r < t.min);
}

/** 18pt (24px) or 14pt (18.66px) bold counts as large text. */
export function isLargeText(px: number | undefined, weight: number | undefined): boolean {
  if (px === undefined) return false;
  return px >= 24 || (px >= 18.66 && (weight ?? 400) >= 700);
}
