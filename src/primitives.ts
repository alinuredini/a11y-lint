import { DYNAMIC, type ComponentDef } from './ir.js';

/**
 * Headless-UI primitives that render a plain element and forward props. Their source lives in
 * node_modules, so it can't be resolved; shadcn's `Label` is a `LabelPrimitive.Root`, for example.
 */
const PRIMITIVES: Record<string, Record<string, string>> = {
  '@radix-ui/react-label': { Root: 'label', Label: 'label' },
  'radix-ui': { Label: 'label' },
  '@headlessui/react': { Label: 'label', Input: 'input', Textarea: 'textarea', Button: 'button', Select: 'select' },
  'react-aria-components': { Label: 'label', Input: 'input', TextArea: 'textarea', Button: 'button', Link: 'a[href]' },
};

export function primitiveDef(source: string | undefined, name: string | undefined): ComponentDef | undefined {
  const spec = source && name ? PRIMITIVES[source]?.[name] : undefined;
  if (!spec) return undefined;
  const [, tag, attr] = /^([a-z]+)(?:\[([a-z-]+)\])?$/.exec(spec)!;
  return { tag, attrs: new Map(attr ? [[attr, DYNAMIC]] : []), events: new Set(), forwardsProps: true, ownContent: false };
}
