import type { AuditCheck, AuditVerdict } from '@starling/core';

/**
 * `AuditCheck` in ARCHITECTURE §6 has no timing field, but the drawer's checks table wants one. Until
 * the contract grows `durationMs` (filed as a CONTRACT REQUEST in the epic handback) we read it
 * opportunistically and render an em dash when a producer does not supply it.
 */
export type AuditCheckWithDuration = AuditCheck & { durationMs?: number };

export function checkDuration(check: AuditCheck): number | undefined {
  const value = (check as AuditCheckWithDuration).durationMs;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Newest verdict first; attempts break ties when a producer reuses a timestamp. */
export function sortVerdicts(verdicts: AuditVerdict[]): AuditVerdict[] {
  return [...verdicts].sort((a, b) => b.ts - a.ts || b.attempt - a.attempt);
}

/**
 * The auditor's per-item DoD judgements, ready to render as a checklist.
 *
 * `AuditVerdict.dod` is optional (wave-1 verdicts and command-only audits have none), and its
 * `evidence` quote is optional too. Absent fields are dropped rather than rendered as "undefined";
 * an audit with no per-item judgement returns `[]` so the Audit tab can fall back to its summary.
 */
export interface DodEvidence {
  item: string;
  met: boolean;
  evidence?: string;
}

export function verdictDod(verdict: AuditVerdict | undefined): DodEvidence[] {
  const judgements = verdict?.dod;
  if (!Array.isArray(judgements)) return [];
  const items: DodEvidence[] = [];
  for (const judgement of judgements) {
    if (typeof judgement?.item !== 'string' || judgement.item.trim().length === 0) continue;
    const evidence = judgement.evidence?.trim();
    items.push({
      item: judgement.item.trim(),
      met: judgement.met === true,
      ...(evidence !== undefined && evidence.length > 0 ? { evidence } : {}),
    });
  }
  return items;
}

/** "3 of 4 met" — the line above a DoD checklist. */
export function dodTally(items: readonly DodEvidence[]): { met: number; total: number } {
  return { met: items.filter((item) => item.met).length, total: items.length };
}

/**
 * Fix instructions arrive as model prose: sometimes numbered, sometimes bulleted, often one
 * paragraph with two sentences. Split into steps on newlines, then sentence boundaries, and drop the
 * list marker so the UI can render its own ordered list.
 */
export function splitFixInstructions(text: string | undefined): string[] {
  if (!text) return [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const steps: string[] = [];
  for (const line of lines) {
    const stripped = line.replace(/^(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (stripped.length === 0) continue;
    const sentences = stripped.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [stripped];
    for (const sentence of sentences) {
      const step = sentence.trim();
      if (step.length > 0) steps.push(step);
    }
  }
  return steps;
}
