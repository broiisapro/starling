/**
 * Plain-English explanations of an `AuditVerdict` (Epic 103).
 *
 * The dashboard shows `AuditCheck.detail` strings, which are precise but terse ("2 file(s) outside
 * the lane", "exit 1; output tail:"). A judge or a user needs one sentence of *why* and a short
 * evidence tail. This module is a pure projection of `AuditVerdict` with **type-only** imports from
 * core, so a browser bundle can import it without pulling in Bun, zod or `node:path`.
 */

import type { AuditCheck, AuditVerdict } from '@starling/core';

/** Max characters kept from a check's `detail` in an explanation. */
export const DETAIL_TAIL_CHARS = 300;

export interface ExplainedCheck {
  /** The raw check name (`lane`, `tests`, `llm-review`, …), for links and test ids. */
  name: string;
  /** Human label for the dashboard (`Lane`, `Tests`, `Review`, …). */
  label: string;
  /** One plain sentence: what the check verifies and what went wrong when it did not. */
  why: string;
  /** `AuditCheck.detail`, trimmed and cut to `DETAIL_TAIL_CHARS` (≤ 300). */
  detailTail: string;
}

export interface VerdictExplanation {
  level: 'pass' | 'warn' | 'fail';
  headline: string;
  /** Checks that stop the merge (or a contradictory pass), in check order. */
  blocking: ExplainedCheck[];
  /** Non-blocking failures and informational notes (hub-repo fallback, skipped reviewer). */
  advisory: ExplainedCheck[];
  /** Labels of checks that passed without a note. */
  passed: string[];
  nextStep?: string;
}

/** Human labels for the checks the auditor emits; unknown names are title-cased. */
export const CHECK_LABELS: Readonly<Record<string, string>> = {
  lane: 'Lane',
  'non-empty': 'Diff',
  tests: 'Tests',
  'missing-tests': 'Tests added',
  lint: 'Lint',
  'llm-review': 'Review',
  'definition-of-done': 'Definition of done',
};

function labelFor(name: string): string {
  const known = CHECK_LABELS[name];
  if (known !== undefined) return known;
  const words = name
    .split(/[-_\s]+/)
    .filter((word) => word !== '')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  return words.length === 0 ? 'Check' : words.join(' ');
}

function detailTail(detail: string): string {
  const text = detail.trim();
  if (text.length <= DETAIL_TAIL_CHARS) return text;
  return `${text.slice(0, DETAIL_TAIL_CHARS - 1).trimEnd()}…`;
}

function whyFor(check: AuditCheck): string {
  const ok = check.ok;
  switch (check.name) {
    case 'lane':
      return ok
        ? 'Every changed file is inside the task lane.'
        : 'The change touches files outside the task lane.';
    case 'non-empty':
      return ok ? 'The task changed at least one file.' : 'The task produced no changes.';
    case 'tests':
      if (ok) {
        if (/^skipped:/i.test(check.detail.trim())) {
          return 'The test command was skipped by policy, so the test check did not run.';
        }
        if (/no task worktree/i.test(check.detail)) {
          return 'Tests passed, but they ran in the hub repo rather than the task worktree.';
        }
        return 'The repository test command passed.';
      }
      if (/blocked by command policy/i.test(check.detail)) {
        return 'The repository test command was blocked by the command policy.';
      }
      return 'The repository test command failed.';
    case 'missing-tests':
      return ok
        ? 'The tests the definition of done asked for are present.'
        : 'The definition of done asks for tests, but no test file changed.';
    case 'lint':
      if (ok) return 'The lint command is clean or was not configured.';
      if (/blocked by command policy/i.test(check.detail)) {
        return 'The lint command was blocked by the command policy.';
      }
      return 'The lint command reported problems; it is non-blocking unless lint blocking is on.';
    case 'llm-review':
      if (ok) {
        if (/^skipped:/i.test(check.detail.trim())) {
          return 'The reviewer model was not consulted, so the diff was judged by the deterministic checks only.';
        }
        return 'The reviewer model approved the work against the definition of done.';
      }
      if (/reviewer unavailable/i.test(check.detail)) {
        return 'The reviewer model did not answer, so the diff is un-reviewed and cannot pass.';
      }
      return 'The reviewer did not approve the work against the definition of done.';
    case 'definition-of-done':
      return ok
        ? 'The reviewer found every definition-of-done item met.'
        : 'The reviewer found at least one definition-of-done item unmet.';
    default:
      return ok ? `The ${labelFor(check.name)} check passed.` : `The ${labelFor(check.name)} check failed.`;
  }
}

function nextStepFor(check: ExplainedCheck): string {
  switch (check.name) {
    case 'lane':
      return 'Revert or move the out-of-lane files into the task lane.';
    case 'non-empty':
      return 'Implement the deliverables and commit them.';
    case 'tests':
      return /blocked by command policy/i.test(check.detailTail)
        ? 'Ask an operator to allow the test command; do not rewrite code to work around the policy.'
        : 'Make the test command pass in the task worktree.';
    case 'missing-tests':
      return 'Add the tests the definition of done asks for.';
    case 'lint':
      return 'Fix the lint findings, or leave them if they are advisory.';
    case 'llm-review':
      return 'Address the reviewer’s finding, or re-run the audit if the reviewer was unavailable.';
    case 'definition-of-done':
      return 'Meet every definition-of-done item and re-run the audit.';
    default:
      return `Address the failed ${labelFor(check.name)} check.`;
  }
}

function explainCheck(check: AuditCheck): ExplainedCheck {
  return {
    name: check.name,
    label: labelFor(check.name),
    why: whyFor(check),
    detailTail: detailTail(check.detail),
  };
}

/** A failed lint check is advisory unless the detail says otherwise (blocking lint omits it). */
function isAdvisoryFailure(check: AuditCheck, verdict: AuditVerdict): boolean {
  return /non-blocking/i.test(check.detail) || (verdict.pass && check.name === 'lint');
}

/** An ok check that still deserves a note: the hub-repo fallback and a skipped reviewer. */
function isAdvisoryNote(check: AuditCheck): boolean {
  if (check.name === 'tests') {
    const detail = check.detail.trim();
    if (/^skipped:/i.test(detail) || /no task worktree/i.test(detail)) return true;
  }
  if (check.name === 'llm-review' && /^skipped:/i.test(check.detail.trim())) return true;
  return false;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry !== '');
  return (line ?? '').replace(/^\d+[.)]\s+/, '').slice(0, 220);
}

/**
 * Explain one verdict. `level` is `fail` when the verdict failed, `warn` when it passed but carries
 * advisory failures or notes, and `pass` when every check is green without a caveat.
 */
export function explainVerdict(verdict: AuditVerdict): VerdictExplanation {
  const blocking: ExplainedCheck[] = [];
  const advisory: ExplainedCheck[] = [];
  const passed: string[] = [];

  for (const check of verdict.checks) {
    const explained = explainCheck(check);
    if (!check.ok) {
      if (isAdvisoryFailure(check, verdict)) advisory.push(explained);
      else blocking.push(explained);
    } else if (isAdvisoryNote(check)) {
      advisory.push(explained);
    } else {
      passed.push(explained.label);
    }
  }

  const level: VerdictExplanation['level'] = !verdict.pass
    ? 'fail'
    : blocking.length > 0 || advisory.length > 0
      ? 'warn'
      : 'pass';

  let headline: string;
  if (level === 'fail') {
    headline =
      blocking.length > 0
        ? `Failed: ${plural(blocking.length, 'blocking check')}.`
        : 'Failed: the audit did not pass.';
  } else if (level === 'warn') {
    headline = `Passed with warnings: ${plural(advisory.length + blocking.length, 'advisory check')}.`;
  } else {
    headline = 'Passed: every check is green.';
  }

  let nextStep: string | undefined;
  if (level === 'fail') {
    const fromReviewer = verdict.fixInstructions === undefined ? '' : firstLine(verdict.fixInstructions);
    const firstBlocker = blocking[0];
    nextStep =
      fromReviewer !== ''
        ? fromReviewer
        : firstBlocker === undefined
          ? 'Re-run the audit; see the failed checks above.'
          : nextStepFor(firstBlocker);
  } else if (level === 'warn') {
    nextStep = 'Nothing blocks the merge — the advisories are informational.';
  }

  return {
    level,
    headline,
    blocking,
    advisory,
    passed,
    ...(nextStep === undefined ? {} : { nextStep }),
  };
}

const GLYPHS: Readonly<Record<VerdictExplanation['level'], string>> = {
  pass: '✔',
  warn: '⚠',
  fail: '✘',
};

/** Plain text, at most six lines and one line per check. Safe for a `<pre>` or a CLI. */
export function formatVerdictExplanation(explanation: VerdictExplanation): string {
  const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
  const lines: string[] = [`${GLYPHS[explanation.level]} ${oneLine(explanation.headline)}`];
  const maxLines = 6;
  const budget = maxLines - lines.length - (explanation.nextStep === undefined ? 0 : 1);
  const checks = [...explanation.blocking, ...explanation.advisory];
  const render = (check: ExplainedCheck): string => {
    const tail = oneLine(check.detailTail);
    return `  ${check.label}: ${oneLine(check.why)}${tail === '' ? '' : ` ${tail}`}`;
  };
  if (checks.length <= budget) {
    lines.push(...checks.map(render));
  } else {
    const keep = Math.max(0, budget - 1);
    lines.push(...checks.slice(0, keep).map(render), `  (+${checks.length - keep} more)`);
  }
  if (explanation.nextStep !== undefined) {
    lines.push(`Next: ${oneLine(explanation.nextStep)}`);
  }
  return lines.slice(0, maxLines).join('\n');
}
