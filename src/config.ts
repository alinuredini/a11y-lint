import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Level } from './wcag.js';

export interface ContrastPair {
  fg: string;
  bg: string;
  /** `large`: 18pt / 14pt bold text. `ui`: non-text UI component or focus indicator (3:1). */
  size?: 'normal' | 'large' | 'ui';
}

export interface Config {
  level: Level;
  include: string[];
  exclude: string[];
  /** Maps components to the element they render: `{ "Link": "a[href]", "Image": "img" }`. */
  components: Record<string, string>;
  rules: Record<string, 'off' | 'on'>;
  contrast: {
    /** DTCG / Style Dictionary token files. An object maps theme names to files. */
    tokens: string[] | Record<string, string | string[]>;
    /** Explicit token pairs to check. When set, automatic pairing is skipped. */
    pairs: ContrastPair[];
    /** Pair `text-*`/`fg-*` tokens with `bg-*`/`surface-*` tokens, and `on-x` with `x`. */
    autoPair: boolean;
  };
  runtime: {
    urls: string[];
    /** Path to a built Storybook (`storybook-static`); every story is scanned. */
    storybook?: string;
    /** Tab through each page checking focus visibility and keyboard traps. */
    keyboard: boolean;
    maxTabStops: number;
  };
}

export const DEFAULT_CONFIG: Config = {
  level: 'AA',
  include: ['**/*.{html,htm,jsx,tsx,vue,svelte,astro,css,scss}', '**/*.component.ts'],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/.svelte-kit/**',
    '**/.astro/**',
    '**/storybook-static/**',
    '**/*.{test,spec}.*',
    '**/__tests__/**',
  ],
  components: {
    Link: 'a[href]',
    NuxtLink: 'a[href]',
    'nuxt-link': 'a[href]',
    RouterLink: 'a[href]',
    'router-link': 'a[href]',
    Image: 'img',
    NuxtImg: 'img',
    'nuxt-img': 'img',
  },
  rules: {},
  contrast: { tokens: [], pairs: [], autoPair: true },
  runtime: { urls: [], keyboard: true, maxTabStops: 100 },
};

export const CONFIG_FILE = 'a11y-lint.config.json';

export function loadConfig(cwd: string, path?: string): Config {
  const file = resolve(cwd, path ?? CONFIG_FILE);
  if (!existsSync(file)) {
    if (path) throw new Error(`Config file not found: ${file}`);
    return structuredClone(DEFAULT_CONFIG);
  }
  const user = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>;
  return {
    ...DEFAULT_CONFIG,
    ...user,
    components: { ...DEFAULT_CONFIG.components, ...user.components },
    contrast: { ...DEFAULT_CONFIG.contrast, ...user.contrast },
    runtime: { ...DEFAULT_CONFIG.runtime, ...user.runtime },
  };
}
