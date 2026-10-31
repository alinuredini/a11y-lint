import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ContrastPair } from '../config.js';
import type { Finding } from '../types.js';
import type { Level } from '../wcag.js';
import { contrast, failedThreshold, markCovered, parseColor, type TextSize } from './color.js';
import type { ThemeVars } from './css.js';
import { resolveVars } from './css.js';

export interface Token {
  name: string;
  value: string;
  file: string;
  line: number;
}

/** theme → token name → token */
export type TokenSet = Map<string, Map<string, Token>>;

/** Reads DTCG (`$value`) or Style Dictionary (`value`) JSON and resolves `{alias.paths}`. */
export function loadTokens(cwd: string, spec: string[] | Record<string, string | string[]>): TokenSet {
  const set: TokenSet = new Map();
  const entries: [string, string[]][] = Array.isArray(spec)
    ? [['default', spec]]
    : Object.entries(spec).map(([theme, files]) => [theme, Array.isArray(files) ? files : [files]]);
  for (const [theme, files] of entries) {
    const raw = new Map<string, Token>();
    for (const file of files) {
      const source = readFileSync(resolve(cwd, file), 'utf8');
      flatten(JSON.parse(source), [], undefined, (path, value) => {
        raw.set(path.join('.'), { name: path.join('.'), value, file, line: lineOfPath(source, path) });
      });
    }
    const resolved = new Map<string, Token>();
    for (const token of raw.values()) {
      const value = resolveAlias(token.value, raw);
      if (value && parseColor(value)) resolved.set(token.name, { ...token, value });
    }
    set.set(theme, resolved);
  }
  return set;
}

function flatten(node: unknown, path: string[], inheritedType: string | undefined, emit: (path: string[], value: string) => void): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const type = (obj.$type as string | undefined) ?? (obj.type as string | undefined) ?? inheritedType;
  const value = '$value' in obj ? obj.$value : 'value' in obj && typeof obj.value !== 'object' ? obj.value : undefined;
  if (value !== undefined) {
    const str = colorValue(value);
    if (str && (type === undefined || type === 'color')) emit(path, str);
    return;
  }
  for (const [key, child] of Object.entries(obj)) if (!key.startsWith('$')) flatten(child, [...path, key], type, emit);
}

/** DTCG 2025 colour objects (`{ colorSpace, components, alpha, hex }`) or plain strings. */
function colorValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { colorSpace?: string; components?: number[]; alpha?: number; hex?: string };
  if (v.hex) return v.hex;
  if (v.colorSpace === 'srgb' && v.components) {
    const [r, g, b] = v.components.map((c) => Math.round(c * 255));
    return `rgb(${r} ${g} ${b} / ${v.alpha ?? 1})`;
  }
  if (v.components && v.colorSpace) return `color(${v.colorSpace} ${v.components.join(' ')} / ${v.alpha ?? 1})`;
  return undefined;
}

function resolveAlias(value: string, tokens: Map<string, Token>, depth = 0): string | undefined {
  const m = /^\{([^}]+)\}$/.exec(value.trim());
  if (!m) return value;
  if (depth > 10) return undefined;
  const target = tokens.get(m[1]);
  return target ? resolveAlias(target.value, tokens, depth + 1) : undefined;
}

function lineOfPath(source: string, path: string[]): number {
  let offset = 0;
  for (const key of path) {
    const i = source.indexOf(`"${key}"`, offset);
    if (i === -1) break;
    offset = i;
  }
  return source.slice(0, offset).split('\n').length;
}

/** CSS custom properties as tokens, so `--color-text` / `--color-bg` get paired too. */
export function varsAsTokens(vars: ThemeVars): TokenSet {
  const set: TokenSet = new Map();
  for (const theme of vars.keys()) {
    const tokens = new Map<string, Token>();
    const names = new Set([...(vars.get('default')?.keys() ?? []), ...(vars.get(theme)?.keys() ?? [])]);
    for (const name of names) {
      const def = vars.get(theme)?.get(name) ?? vars.get('default')!.get(name)!;
      const value = resolveVars(def.value, vars, theme);
      if (value && parseColor(value)) tokens.set(name.slice(2), { name: name.slice(2), value, file: def.file, line: def.line });
    }
    set.set(theme, tokens);
  }
  return set;
}

const SEP = '(^|[-._/])';
const END = '([-._/]|$)';
const FG = new RegExp(`${SEP}(text|fg|foreground|content|ink)${END}`, 'i');
const BG = new RegExp(`${SEP}(bg|background|surface|canvas|backdrop|paper)${END}`, 'i');
const FOCUS = new RegExp(`${SEP}(focus|ring)${END}`, 'i');
const ON = new RegExp(`${SEP}on[-_]([\\w-]+)$`, 'i');
const SKIP_FG = /disabled|inverse|inverted/i;
// shadcn convention: `muted-foreground` sits on `muted`. (`x-text`/`x-fg` usually mean text on the page.)
const SUFFIX_FG = /^(.+?)[-._/]foreground$/i;
// Words that don't narrow a background down: `color.bg.default`, `--background`, `surface-base` are the page itself.
const NEUTRAL_WORDS = new Set(
  'color colors colour bg background surface canvas paper backdrop default base primary page body app main sys ref semantic theme'.split(' '),
);

/** The main page background(s): every part of the name is a neutral word. */
function isCoreBackground(name: string): boolean {
  if (!BG.test(name)) return false;
  return name
    .replace(/^--/, '')
    .split(/[-._/]/)
    .filter(Boolean)
    .every((part) => NEUTRAL_WORDS.has(part.toLowerCase()));
}

export interface PairCandidate {
  fg: Token;
  bg: Token;
  size: TextSize;
  explicit: boolean;
}

export function pairTokens(tokens: Map<string, Token>, explicit: ContrastPair[], autoPair: boolean): PairCandidate[] {
  if (explicit.length) {
    return explicit.flatMap((p) => {
      const fg = tokens.get(p.fg);
      const bg = tokens.get(p.bg);
      return fg && bg ? [{ fg, bg, size: p.size ?? 'normal', explicit: true }] : [];
    });
  }
  if (!autoPair) return [];
  // Only pairs that are almost certainly used together, so auto-paired failures are real:
  // `on-x` / `x-foreground` with `x`, and generic text and focus tokens with the main page background.
  const all = [...tokens.values()];
  const core = all.filter((t) => isCoreBackground(t.name));
  const pairs: PairCandidate[] = [];
  const add = (fg: Token, bg: Token | undefined, size: TextSize) => {
    if (bg && bg !== fg) pairs.push({ fg, bg, size, explicit: false });
  };
  for (const t of all) {
    if (SKIP_FG.test(t.name)) continue;
    const on = ON.exec(t.name);
    if (on) {
      add(t, tokens.get(t.name.slice(0, on.index + on[1].length) + on[2]), 'normal');
      continue;
    }
    if (t.name === 'foreground') {
      add(t, tokens.get('background'), 'normal');
      continue;
    }
    const suffix = SUFFIX_FG.exec(t.name);
    const own = suffix && tokens.get(suffix[1]);
    if (own && !BG.test(own.name)) {
      add(t, own, 'normal');
      // Muted/secondary text is also used straight on the page.
      if (/muted|secondary|subtle/i.test(suffix![1])) for (const bg of core) add(t, bg, 'normal');
      continue;
    }
    if (FG.test(t.name) && !BG.test(t.name)) for (const bg of core) add(t, bg, 'normal');
    else if (FOCUS.test(t.name) && !BG.test(t.name)) for (const bg of core) add(t, bg, 'ui');
  }
  return pairs;
}

export function checkTokens(set: TokenSet, opts: { target: Level; pairs: ContrastPair[]; autoPair: boolean; covered?: Set<string> }): Finding[] {
  // The same pair failing with the same colours in several themes is reported once.
  const failures = new Map<string, { finding: Finding; themes: string[] }>();
  for (const [theme, tokens] of set) {
    for (const pair of pairTokens(tokens, opts.pairs, opts.autoPair)) {
      const fg = parseColor(pair.fg.value)!;
      const bg = parseColor(pair.bg.value)!;
      const { ratio, uncertain } = contrast(fg, bg);
      markCovered(opts.covered, pair.size, opts.target);
      const failed = failedThreshold(ratio, pair.size, opts.target);
      if (!failed) continue;
      const key = `${pair.fg.name}|${pair.bg.name}|${pair.fg.value}|${pair.bg.value}`;
      const existing = failures.get(key);
      if (existing) {
        existing.themes.push(theme);
        continue;
      }
      const autoNote = pair.explicit ? '' : ' (auto-paired; set contrast.pairs to declare real pairs)';
      failures.set(key, {
        themes: [theme],
        finding: {
          ruleId: pair.size === 'ui' ? 'token-focus-contrast' : 'token-contrast',
          criteria: [failed.criterion],
          level: failed.level,
          status: uncertain ? 'unknown' : 'fail',
          message: `${pair.fg.name} on ${pair.bg.name}{themes}: ${ratio.toFixed(2)}:1, needs ${failed.min}:1${autoNote}.`,
          file: pair.fg.file,
          line: pair.fg.line,
          column: 1,
          source: 'contrast',
        },
      });
    }
  }
  return [...failures.values()].map(({ finding, themes }) => ({
    ...finding,
    message: finding.message.replace('{themes}', set.size > 1 ? ` [${themes.join(', ')}]` : ''),
  }));
}
