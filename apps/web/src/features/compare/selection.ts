import type { Run } from '@starling/core/browser';
import { serialBaseline } from './derive';

/**
 * Which two runs the page is showing.
 *
 * Preference order, exactly as the assignment asks:
 * 1. `?a=` / `?b=` from the URL (b may be the literal `baseline`);
 * 2. the active run against the previous (next-newest) run;
 * 3. the active run against its own serial baseline.
 *
 * The selection stays pure: the page passes `sortedRuns(state)`, the store's active id and the
 * parsed URL. The baseline run is only built when the page renders, because it needs the current
 * clock for a run that is still flying.
 */

export const BASELINE_VALUE = 'baseline';

export interface CompareParams {
  a?: string;
  b?: string;
}

export type SelectionSource = 'url' | 'default' | 'baseline' | 'same-run';

export interface CompareSelection {
  a: Run;
  /** Absent exactly when `baseline` is true. */
  b?: Run;
  baseline: boolean;
  source: SelectionSource;
  notice?: string;
}

export const SAME_RUN_NOTICE = 'Both pickers point at the same run, so every delta is zero.';

function validParam(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function nextRun(runs: readonly Run[], current: Run): Run | undefined {
  return runs.find((run) => run.id !== current.id);
}

/** Build the baseline side for a selection (used by the page, and by the tests). */
export function baselineFor(selection: CompareSelection, now: number = Date.now()): Run | undefined {
  return selection.baseline ? serialBaseline(selection.a, now) : selection.b;
}

export function defaultSelection(
  runs: readonly Run[],
  activeRunId: string | undefined,
  params: CompareParams = {},
): CompareSelection | undefined {
  const first = runs[0];
  if (first === undefined) return undefined;

  const aId = validParam(params.a);
  const bParam = validParam(params.b);
  const requestedA = aId === undefined ? undefined : runs.find((run) => run.id === aId);

  if (requestedA !== undefined) {
    if (bParam === BASELINE_VALUE) {
      return { a: requestedA, baseline: true, source: 'baseline' };
    }
    const requestedB = bParam === undefined ? undefined : runs.find((run) => run.id === bParam);
    if (requestedB !== undefined) {
      if (requestedB.id === requestedA.id) {
        return { a: requestedA, b: requestedB, baseline: false, source: 'same-run', notice: SAME_RUN_NOTICE };
      }
      return { a: requestedA, b: requestedB, baseline: false, source: 'url' };
    }
    const other = nextRun(runs, requestedA);
    return other === undefined
      ? { a: requestedA, baseline: true, source: 'baseline' }
      : { a: requestedA, b: other, baseline: false, source: 'url' };
  }

  const active = runs.find((run) => run.id === activeRunId) ?? first;
  const other = nextRun(runs, active);
  return other === undefined
    ? { a: active, baseline: true, source: 'baseline' }
    : { a: active, b: other, baseline: false, source: 'default' };
}

/** One-line name for a picker/legend: the goal, clipped, never the raw ULID. */
export function runLabel(run: Run, max = 58): string {
  const goal = run.goal.text.trim().replace(/\s+/g, ' ');
  return goal.length > max ? `${goal.slice(0, max - 1)}…` : goal;
}

/** Is this run still moving? Its numbers tick and the page says so. */
export function isLiveRun(run: Run): boolean {
  return (
    run.status === 'mapping' ||
    run.status === 'planning' ||
    run.status === 'planned' ||
    run.status === 'running'
  );
}
