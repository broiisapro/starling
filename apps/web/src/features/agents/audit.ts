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
