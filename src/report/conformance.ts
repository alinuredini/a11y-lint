import { rules } from '../rules/index.js';
import type { Finding } from '../types.js';
import { criteriaFor, type Criterion, type Level } from '../wcag.js';

export type CriterionState = 'fail' | 'review' | 'auto-pass' | 'manual' | 'likely-na';

export interface CriterionResult {
  criterion: Criterion;
  state: CriterionState;
  findings: Finding[];
  note?: string;
}

export interface ConformanceInput {
  level: Level;
  findings: Finding[];
  evidence: Map<string, Set<string>>;
  /** Criteria an automated check evaluated (static rules always; contrast and runtime when they ran). */
  covered: Set<string>;
  filesScanned: number;
  pagesScanned: string[];
}

/** Criteria a static rule evaluates on every element; contrast and runtime coverage are added per run. */
export const STATIC_CRITERIA = new Set(rules.filter((r) => !r.partial).flatMap((r) => r.criteria));

/** Criteria that don't apply when the source has none of these elements. */
const APPLIES_WHEN: Record<string, string[]> = {
  media: ['video', 'audio'],
  forms: ['input', 'select', 'textarea'],
};
const NA_GROUPS: Record<string, keyof typeof APPLIES_WHEN> = {
  '1.2.1': 'media', '1.2.2': 'media', '1.2.3': 'media', '1.2.4': 'media', '1.2.5': 'media', '1.2.6': 'media',
  '1.2.7': 'media', '1.2.8': 'media', '1.2.9': 'media', '1.4.2': 'media', '1.4.7': 'media',
  '1.3.5': 'forms', '3.3.1': 'forms', '3.3.3': 'forms', '3.3.4': 'forms', '3.3.6': 'forms', '3.3.7': 'forms',
  '3.3.8': 'forms', '3.3.9': 'forms',
};

/** What a person has to check, for criteria no tool can fully decide. */
const GUIDANCE: Record<string, string> = {
  '1.1.1': 'Alt text describes the purpose of each image; decorative images use alt="".',
  '1.2.2': 'Captions are accurate, synchronised and include relevant sounds.',
  '1.2.3': 'Videos have audio description or a full text alternative.',
  '1.2.5': 'Videos have audio description for visual-only information.',
  '1.3.1': 'Visual structure (headings, lists, tables, groups) is in the markup, not just styling.',
  '1.3.2': 'Reading order in the DOM matches the visual order.',
  '1.3.3': 'Instructions do not rely only on shape, size, position or sound ("click the round button").',
  '1.3.4': 'Content works in both portrait and landscape.',
  '1.4.1': 'Colour is never the only way to convey information (links, errors, chart series).',
  '1.4.4': 'Text zooms to 200% without loss of content or function.',
  '1.4.5': 'Text is real text, not images of text (logos excepted).',
  '1.4.10': 'At 320 CSS px wide (400% zoom) content reflows without horizontal scrolling.',
  '1.4.11': 'Input borders, icons and focus indicators reach 3:1 against their background.',
  '1.4.12': 'Content survives increased line-height, letter- and word-spacing.',
  '1.4.13': 'Tooltips and popovers are dismissible (Esc), hoverable and persistent.',
  '2.1.1': 'Every feature works with the keyboard alone, including custom widgets.',
  '2.1.4': 'Single-key shortcuts can be turned off or remapped.',
  '2.2.1': 'Time limits can be turned off, adjusted or extended.',
  '2.2.2': 'Carousels, auto-updating and animated content can be paused.',
  '2.3.1': 'Nothing flashes more than three times per second.',
  '2.4.1': 'A skip link or landmarks let users bypass repeated navigation.',
  '2.4.2': 'Each page title describes its topic or purpose.',
  '2.4.3': 'Focus order is logical, including after opening and closing dialogs.',
  '2.4.4': 'Each link\'s purpose is clear from its text or surrounding context.',
  '2.4.5': 'Pages can be reached more than one way (nav, search, sitemap).',
  '2.4.6': 'Headings and labels describe their topic or purpose.',
  '2.4.7': 'Every focusable element shows a visible focus indicator.',
  '2.4.11': 'Focused elements are not fully hidden by sticky headers, banners or chat widgets.',
  '2.5.1': 'Multipoint or path gestures (pinch, swipe) have a single-pointer alternative.',
  '2.5.2': 'Actions fire on pointer up and can be cancelled by moving away.',
  '2.5.3': 'Accessible names contain the visible label text.',
  '2.5.4': 'Shake or tilt features have a UI alternative and can be disabled.',
  '2.5.7': 'Drag-and-drop has a single-pointer alternative (buttons, menus).',
  '2.5.8': 'Pointer targets are at least 24×24 CSS px, or spaced so they don\'t overlap.',
  '3.1.2': 'Passages in another language have their own lang attribute.',
  '3.2.1': 'Focusing an element does not trigger a change of context.',
  '3.2.2': 'Changing a field does not submit or navigate without warning.',
  '3.2.3': 'Navigation appears in the same order across pages.',
  '3.2.4': 'Components with the same function are labelled consistently.',
  '3.2.6': 'Help links or contact details appear in the same place across pages.',
  '3.3.1': 'Errors are identified in text and tied to the field (aria-describedby / aria-invalid).',
  '3.3.2': 'Fields have visible labels or instructions, including required-field and format hints.',
  '3.3.3': 'Error messages suggest how to fix the input.',
  '3.3.4': 'Legal, financial and data submissions can be reviewed, corrected or reversed.',
  '3.3.7': 'Information already entered in a flow is not asked for again.',
  '3.3.8': 'Login doesn\'t require a cognitive test; paste and password managers work.',
  '4.1.2': 'Custom widgets expose correct name, role, state and value to assistive tech.',
  '4.1.3': 'Status messages (toasts, "saved", result counts) are announced via live regions.',
};

function understandingUrl(c: Criterion): string {
  const slug = c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `https://www.w3.org/WAI/WCAG22/Understanding/${slug}`;
}

export function evaluate(input: ConformanceInput): CriterionResult[] {
  return criteriaFor(input.level).map((criterion) => {
    const findings = input.findings.filter((f) => f.criteria.includes(criterion.id));
    let state: CriterionState;
    let note: string | undefined;
    const group = NA_GROUPS[criterion.id];
    const applies = group ? APPLIES_WHEN[group].some((tag) => input.evidence.has(tag)) : true;
    if (findings.some((f) => f.status === 'fail')) state = 'fail';
    else if (findings.length) state = 'review';
    else if (!applies) {
      state = 'likely-na';
      note = `No ${APPLIES_WHEN[group!].map((t) => `<${t}>`).join('/')} found in the scanned source.`;
    } else if (input.covered.has(criterion.id)) state = 'auto-pass';
    else state = 'manual';
    if (group && applies) {
      const files = APPLIES_WHEN[group].flatMap((t) => [...(input.evidence.get(t) ?? [])]);
      note = `Found in ${[...new Set(files)].slice(0, 5).join(', ')}${files.length > 5 ? ', …' : ''}.`;
    }
    return { criterion, state, findings, note };
  });
}

const STATE_LABEL: Record<CriterionState, string> = {
  fail: '❌ Fails',
  review: '⚠️ Needs review',
  'auto-pass': '🔍 Automated checks passed',
  manual: '📝 Manual check',
  'likely-na': '➖ Likely not applicable',
};

export function renderMarkdown(input: ConformanceInput, results: CriterionResult[]): string {
  const count = (s: CriterionState) => results.filter((r) => r.state === s).length;
  const lines: string[] = [
    `# WCAG 2.2 ${input.level} conformance report`,
    '',
    `Generated ${new Date().toISOString().slice(0, 10)} by a11y-lint · ${input.filesScanned} source files · ${input.pagesScanned.length} rendered pages`,
    '',
    '> Automated tools cannot prove conformance. This report lists definite failures, items that need a human decision,',
    '> and the manual checks still required. "Automated checks passed" means no tool found a problem, not that the criterion is met.',
    '',
    '| Status | Criteria |',
    '| --- | --- |',
    ...(['fail', 'review', 'manual', 'auto-pass', 'likely-na'] as const).map((s) => `| ${STATE_LABEL[s]} | ${count(s)} |`),
    '',
  ];

  const section = (title: string, state: CriterionState, body: (r: CriterionResult) => string[]) => {
    const items = results.filter((r) => r.state === state);
    if (!items.length) return;
    lines.push(`## ${title}`, '');
    for (const r of items) lines.push(...body(r));
    lines.push('');
  };
  const heading = (r: CriterionResult) => `[${r.criterion.id} ${r.criterion.title}](${understandingUrl(r.criterion)}) (${r.criterion.level})`;
  const findingLines = (r: CriterionResult) =>
    r.findings.slice(0, 50).map((f) => `- \`${f.file}${f.source === 'runtime' ? '' : `:${f.line}`}\` ${f.message}`).concat(r.findings.length > 50 ? [`- …and ${r.findings.length - 50} more`] : []);

  section('Failures', 'fail', (r) => [`### ${heading(r)}`, '', ...findingLines(r), '']);
  section('Needs review', 'review', (r) => [`### ${heading(r)}`, '', ...findingLines(r), '']);
  section('Manual checklist', 'manual', (r) => [`- [ ] ${heading(r)}: ${GUIDANCE[r.criterion.id] ?? 'Review against the Understanding document.'}${r.note ? ` ${r.note}` : ''}`]);
  section('Automated checks passed (still verify manually)', 'auto-pass', (r) => [`- [ ] ${heading(r)}${GUIDANCE[r.criterion.id] ? `: ${GUIDANCE[r.criterion.id]}` : ''}`]);
  section('Likely not applicable', 'likely-na', (r) => [`- ${heading(r)}: ${r.note}`]);
  return lines.join('\n');
}
