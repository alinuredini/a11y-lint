import { rules } from '../rules/index.js';
import type { Finding } from '../types.js';
import { CRITERIA_BY_ID } from '../wcag.js';

/** SARIF 2.1.0, for GitHub code scanning and other CI viewers. */
export function toSarif(findings: Finding[], version: string): object {
  const ruleIds = [...new Set(findings.map((f) => f.ruleId))].sort();
  const describe = (id: string) => rules.find((r) => r.id === id)?.description ?? id;
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'a11y-lint',
            version,
            rules: ruleIds.map((id) => {
              const criteria = [...new Set(findings.filter((f) => f.ruleId === id).flatMap((f) => f.criteria))];
              return {
                id,
                shortDescription: { text: describe(id) },
                helpUri: criteria[0] ? `https://www.w3.org/WAI/WCAG22/Understanding/${slug(criteria[0])}` : undefined,
                properties: { tags: ['accessibility', ...criteria.map((c) => `WCAG ${c}`)] },
              };
            }),
          },
        },
        results: findings.map((f) => ({
          ruleId: f.ruleId,
          level: f.status === 'fail' ? 'error' : 'warning',
          message: { text: `[WCAG ${f.criteria.join(', ')} ${f.level}] ${f.message}` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file },
                region: { startLine: f.line, startColumn: f.column },
              },
            },
          ],
        })),
      },
    ],
  };
}

function slug(criterion: string): string {
  const title = CRITERIA_BY_ID.get(criterion)?.title ?? '';
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
