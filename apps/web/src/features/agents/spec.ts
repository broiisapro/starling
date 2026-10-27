import type { AuditVerdict } from '@starling/core';

export interface DodItem {
  item: string;
  done: boolean;
}

/**
 * Tick DoD items from the latest verdict's evidence. The contract carries no per-item evidence, so:
 * a passing definition-of-done check (or a passing verdict when no such check exists) ticks every
 * item; a failing one ticks none. Conservative on purpose — a green checkbox must mean an auditor
 * actually said so.
 */
export function dodChecklist(items: string[], verdict: AuditVerdict | undefined): DodItem[] {
  if (!verdict) return items.map((item) => ({ item, done: false }));
  const check = verdict.checks.find((entry) => /definition[-_ ]?of[-_ ]?done|dod/i.test(entry.name));
  const passed = check ? check.ok : verdict.pass;
  return items.map((item) => ({ item, done: passed }));
}

/** The audit's own words about the DoD, shown above the checklist. */
export function dodEvidence(verdict: AuditVerdict | undefined): string | undefined {
  if (!verdict) return undefined;
  const check = verdict.checks.find((entry) => /definition[-_ ]?of[-_ ]?done|dod/i.test(entry.name));
  return check?.detail;
}
