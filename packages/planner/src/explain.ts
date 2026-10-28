/**
 * Human-readable rendering of validator output for the CLI (`starling plan --json` keeps the raw
 * issues; the default text view uses this).
 *
 * Grouping is by severity and then by code, in the order the issues arrive. That order is already
 * deterministic (`validatePlan` and `repairPlan` both build it deliberately), so two runs of the
 * same plan print byte-identical text.
 */
import type { PlanIssue } from '@starling/core';

const SEVERITIES: Array<PlanIssue['severity']> = ['error', 'warn'];

const HEADINGS: Record<PlanIssue['severity'], string> = {
  error: 'Errors',
  warn: 'Warnings',
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Render issues as grouped Markdown-ish text: counts, then one block per severity and code. */
export function explainIssues(issues: PlanIssue[]): string {
  if (issues.length === 0) return 'No plan issues.';

  const counts = {
    error: issues.filter((issue) => issue.severity === 'error').length,
    warn: issues.filter((issue) => issue.severity === 'warn').length,
  };
  const headline = [
    counts.error > 0 ? plural(counts.error, 'error') : '',
    counts.warn > 0 ? plural(counts.warn, 'warning') : '',
  ]
    .filter((part) => part !== '')
    .join(', ');

  const lines: string[] = [headline];

  for (const severity of SEVERITIES) {
    const group = issues.filter((issue) => issue.severity === severity);
    if (group.length === 0) continue;
    lines.push('', HEADINGS[severity]);

    const byCode = new Map<PlanIssue['code'], PlanIssue[]>();
    for (const issue of group) {
      const bucket = byCode.get(issue.code);
      if (bucket === undefined) byCode.set(issue.code, [issue]);
      else bucket.push(issue);
    }

    for (const [code, entries] of byCode) {
      lines.push(`  ${code} (${entries.length})`);
      for (const entry of entries) {
        const tasks = entry.taskKeys.length === 0 ? '' : ` [tasks: ${entry.taskKeys.join(', ')}]`;
        lines.push(`    - ${entry.message}${tasks}`);
      }
    }
  }

  return lines.join('\n');
}
