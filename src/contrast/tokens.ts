import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ContrastPair } from '../config.js';
import type { Finding } from '../types.js';
import type { Level } from '../wcag.js';
import { contrast, failedThreshold, parseColor, type TextSize } from './color.js';
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
// Backgrounds that only pair with their own `on-*` text, never with general body text.
const SKIP_BG = /disabled|inverse|inverted|brand|accent|emphasis|strong|danger|error|success|warning|info|overlay|hover|active|pressed|selected|scrim/i;

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
  const all = [...tokens.values()];
  const bgs = all.filter((t) => BG.test(t.name) && !SKIP_BG.test(t.name) && !ON.test(t.name));
  const pairs: PairCandidate[] = [];
  for (const t of all) {
    const on = ON.exec(t.name);
    if (on) {
      // Material-style `on-primary` text sits on `primary`.
      const base = t.name.slice(0, on.index + on[1].length) + on[2];
      const bg = tokens.get(base) ?? all.find((b) => b !== t && b.name.endsWith(on[2]) && !ON.test(b.name));
      if (bg) pairs.push({ fg: t, bg, size: 'normal', explicit: false });
      continue;
    }
    if (FG.test(t.name) && !SKIP_FG.test(t.name) && !BG.test(t.name)) {
      for (const bg of bgs) pairs.push({ fg: t, bg, size: 'normal', explicit: false });
    } else if (FOCUS.test(t.name) && !BG.test(t.name)) {
      for (const bg of bgs) pairs.push({ fg: t, bg, size: 'ui', explicit: false });
    }
  }
  return pairs;
}

export function checkTokens(set: TokenSet, opts: { target: Level; pairs: ContrastPair[]; autoPair: boolean }): Finding[] {
  const findings: Finding[] = [];
  for (const [theme, tokens] of set) {
    for (const pair of pairTokens(tokens, opts.pairs, opts.autoPair)) {
      const fg = parseColor(pair.fg.value)!;
      const bg = parseColor(pair.bg.value)!;
      const { ratio, uncertain } = contrast(fg, bg);
      const failed = failedThreshold(ratio, pair.size, opts.target);
      if (!failed) continue;
      const themeNote = set.size > 1 ? ` [${theme}]` : '';
      const autoNote = pair.explicit ? '' : ' (auto-paired; set contrast.pairs to declare real pairs)';
      findings.push({
        ruleId: pair.size === 'ui' ? 'token-focus-contrast' : 'token-contrast',
        criteria: [failed.criterion],
        level: failed.level,
        status: uncertain ? 'unknown' : 'fail',
        message: `${pair.fg.name} on ${pair.bg.name}${themeNote}: ${ratio.toFixed(2)}:1, needs ${failed.min}:1${autoNote}.`,
        file: pair.fg.file,
        line: pair.fg.line,
        column: 1,
        source: 'contrast',
      });
    }
  }
  return findings;
}
