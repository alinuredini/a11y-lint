import type { Finding } from '../types.js';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);

export function formatText(findings: Finding[]): string {
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file)!.push(f);
  }
  const out: string[] = [];
  for (const [file, list] of byFile) {
    out.push(paint(4, file));
    for (const f of list) {
      const pos = f.source === 'runtime' ? '' : `${f.line}:${f.column}`.padEnd(8);
      const status = f.status === 'fail' ? paint(31, 'fail  ') : paint(33, 'review');
      out.push(`  ${paint(2, pos)}${status}  ${f.message}  ${paint(2, `${f.ruleId} · WCAG ${f.criteria.join(', ')} (${f.level})`)}`);
    }
    out.push('');
  }
  const fails = findings.filter((f) => f.status === 'fail').length;
  const reviews = findings.length - fails;
  out.push(
    findings.length
      ? `${paint(31, `${fails} failure${fails === 1 ? '' : 's'}`)}, ${paint(33, `${reviews} to review`)}`
      : paint(32, 'No automated failures. Manual checks are still required; run with --report for the checklist.'),
  );
  return out.join('\n');
}
