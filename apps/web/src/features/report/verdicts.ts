import type { AuditVerdict } from '@starling/core/browser';
import type { NotableVerdict } from './types';

/**
 * An audit worth showing on the report page. A clean pass is noise; a failure, a lane violation or
 * explicit fix instructions is the part a judge (and a future contributor) wants to read.
 */
export function isNotableVerdict(verdict: AuditVerdict): boolean {
  return !verdict.pass || verdict.laneViolations.length > 0 || (verdict.fixInstructions ?? '').trim() !== '';
}

/**
 * The run's pushbacks, oldest first. `state.verdicts` is keyed by task key only (not run), so the
 * caller passes the run's own keys and anything belonging to another run is ignored.
 */
export function notableVerdicts(
  verdicts: Record<string, AuditVerdict[]>,
  keys: Iterable<string>,
): NotableVerdict[] {
  const allowed = new Set(keys);
  const result: NotableVerdict[] = [];

  for (const taskKey of [...allowed].sort()) {
    const history = verdicts[taskKey] ?? [];
    for (const verdict of history) {
      if (!isNotableVerdict(verdict)) continue;
      const resolvedBy = history
        .filter((later) => later.attempt > verdict.attempt && later.pass && later.laneViolations.length === 0)
        .map((later) => later.attempt)
        .sort((a, b) => a - b)[0];
      result.push({ ...verdict, ...(resolvedBy === undefined ? {} : { resolvedBy }) });
    }
  }

  return result.sort((a, b) => a.ts - b.ts || a.taskKey.localeCompare(b.taskKey) || a.attempt - b.attempt);
}

/** The failed check names, in the auditor's order. */
export function failedChecks(verdict: NotableVerdict): string[] {
  return verdict.checks.filter((check) => !check.ok).map((check) => check.name);
}

/**
 * One-line headline: "theme failed attempt 1 (tests, definition-of-done), passed on attempt 2".
 * A pass that still carried a lane violation reads as a warning rather than a clean landing.
 */
export function verdictHeadline(verdict: NotableVerdict): string {
  const failed = failedChecks(verdict);
  const reasons: string[] = [...failed];
  if (verdict.laneViolations.length > 0) {
    const count = verdict.laneViolations.length;
    reasons.push(`${count} lane violation${count === 1 ? '' : 's'}`);
  }

  const outcome = verdict.pass ? 'passed' : 'failed';
  const base = `${verdict.taskKey} ${outcome} attempt ${verdict.attempt}`;
  const withReasons = reasons.length === 0 ? base : `${base} (${reasons.join(', ')})`;
  if (verdict.resolvedBy !== undefined) {
    return `${withReasons}, then passed on attempt ${verdict.resolvedBy}`;
  }
  if (!verdict.pass) return `${withReasons}, and never recovered`;
  return withReasons;
}

/** `ollama · qwen3.6:35b-a3b` — the reviewer that made the call. */
export function verdictModel(verdict: NotableVerdict): string {
  return `${verdict.model.provider} · ${verdict.model.model}`;
}
