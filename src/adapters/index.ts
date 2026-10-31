import type { IRDocument } from '../ir.js';
import { parseAngular } from './angular.js';
import { parseAstro } from './astro.js';
import { parseHtml } from './html.js';
import { parseJsx } from './jsx.js';
import { parseSvelte } from './svelte.js';
import { parseVue } from './vue.js';

type Adapter = (file: string, source: string) => IRDocument | Promise<IRDocument>;

export function adapterFor(file: string): Adapter | undefined {
  if (/\.component\.html$/.test(file)) return parseAngular;
  if (/\.html?$/.test(file)) return parseHtml;
  if (/\.[jt]sx$/.test(file) || /\.js$/.test(file)) return parseJsx;
  if (file.endsWith('.vue')) return parseVue;
  if (file.endsWith('.svelte')) return parseSvelte;
  if (file.endsWith('.astro')) return parseAstro;
  return undefined;
}
