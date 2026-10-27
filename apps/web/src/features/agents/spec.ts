import type { AuditVerdict } from '@starling/core';

/**
 * Per-item DoD evidence on a verdict. C1's core consolidation adds `dod?: { item, met, evidence? }[]`
 * to `AuditVerdict`; this lane shipped before that field existed, so it is read **if present** and
 * the drawer falls back to the single `definition-of-done` check when it is not.
 */
export interface DodJudgement {
  item: string;
  met?: boolean;
  /** Some producers call it `ok`. Accepted so the drawer survives either spelling. */
  ok?: boolean;
  evidence?: string;
}

export type AuditVerdictWithDod = AuditVerdict & { dod?: DodJudgement[] };

export interface DodItem {
  item: string;
  done: boolean;
  /** The auditor's per-item sentence, when the producer supplied one. */
  evidence?: string;
}

/**
 * The optional per-item judgements, or `[]` when the verdict predates them. `dod` is not in this
 * worktree's `AuditVerdict` yet (the sibling C1 core epic adds it), so the read is a documented
 * cast: the field is feature-detected, never assumed.
 */
export function dodJudgements(verdict: AuditVerdict | undefined): DodJudgement[] {
  if (verdict === undefined) return [];
  const dod = (verdict as unknown as { dod?: DodJudgement[] }).dod;
  return Array.isArray(dod) ? dod.filter((entry) => typeof entry?.item === 'string') : [];
}

function metOf(judgement: DodJudgement): boolean {
  if (typeof judgement.met === 'boolean') return judgement.met;
  return judgement.ok === true;
}

function sameItem(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * Tick DoD items from the latest verdict's evidence.
 *
 * With per-item evidence (`verdict.dod`, added at C1) each plan item is matched to the auditor's
 * judgement; unmatched items fall back to the verdict's overall DoD check result. Without it, the
 * old conservative rule stands: a passing definition-of-done check (or a passing verdict when no
 * such check exists) ticks every item, a failing one ticks none. A green box must always mean an
 * auditor said so.
 */
export function dodChecklist(items: string[], verdict: AuditVerdict | undefined): DodItem[] {
  if (!verdict) return items.map((item) => ({ item, done: false }));
  const check = verdict.checks.find((entry) => /definition[-_ ]?of[-_ ]?done|dod/i.test(entry.name));
  const passed = check ? check.ok : verdict.pass;
  const judgements = dodJudgements(verdict);

  return items.map((item) => {
    const judgement = judgements.find((candidate) => sameItem(candidate.item, item));
    if (judgement === undefined) return { item, done: passed };
    const evidence = typeof judgement.evidence === 'string' ? judgement.evidence : undefined;
    return evidence === undefined
      ? { item, done: metOf(judgement) }
      : { item, done: metOf(judgement), evidence };
  });
}

/** The audit's own words about the DoD, shown above the checklist. */
export function dodEvidence(verdict: AuditVerdict | undefined): string | undefined {
  if (!verdict) return undefined;
  const judgements = dodJudgements(verdict);
  if (judgements.length > 0) {
    const met = judgements.filter(metOf).length;
    return `${met} of ${judgements.length} items met`;
  }
  const check = verdict.checks.find((entry) => /definition[-_ ]?of[-_ ]?done|dod/i.test(entry.name));
  return check?.detail;
}
