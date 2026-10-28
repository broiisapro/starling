import type { Run, RunMetrics, TaskStatus } from '@starling/core/browser';
import type { SkyState } from '../../data/reducer';
import { activeRunOf } from '../../data/selectors';
import { taskFlightMs, taskKeys } from './math';
import { nodeContributions } from './nodes';
import { storyBeats } from './story';
import type { FlightOutcome, FlightReport, FlightTaskCounts } from './types';
import { ESTIMATED_PLANNER, ESTIMATED_SAVED, ESTIMATED_SERIAL, ESTIMATED_SPEEDUP } from './types';
import { notableVerdicts } from './verdicts';

/** Statuses that mean a task is still in the air (or waiting for a free session). */
const IN_FLIGHT_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'pending',
  'ready',
  'running',
  'auditing',
  'fixing',
  'merging',
]);

/** A run has stopped moving once one of these is its status. */
export function isRunOver(status: Run['status']): boolean {
  return status === 'finished' || status === 'failed' || status === 'cancelled';
}

export function taskCounts(run: Run): FlightTaskCounts {
  const keys = taskKeys(run);
  const counts: FlightTaskCounts = {
    total: keys.length,
    merged: 0,
    failed: 0,
    conflict: 0,
    cancelled: 0,
    inFlight: 0,
  };
  for (const key of keys) {
    const status = run.tasks[key]?.status;
    if (status === undefined) counts.inFlight += 1;
    else if (status === 'merged') counts.merged += 1;
    else if (status === 'failed') counts.failed += 1;
    else if (status === 'conflict') counts.conflict += 1;
    else if (status === 'cancelled') counts.cancelled += 1;
    else if (IN_FLIGHT_STATUSES.has(status)) counts.inFlight += 1;
  }
  return counts;
}

export function outcomeOf(run: Run, counts: FlightTaskCounts): FlightOutcome {
  if (run.status === 'cancelled') return 'cancelled';
  if (run.status === 'failed') return 'failed';
  if (run.status !== 'finished') return 'in-flight';
  if (counts.total > 0 && counts.merged === counts.total) return 'landed';
  return counts.merged > 0 ? 'partial' : 'failed';
}

interface Timings {
  measured: number;
  flightMs: number;
  windowMs: number;
}

/** Measured per-task flight: how many tasks have both timestamps, their sum and their span. */
export function taskTimings(run: Run): Timings {
  let measured = 0;
  let flightMs = 0;
  let earliest: number | undefined;
  let latest: number | undefined;

  for (const task of Object.values(run.tasks)) {
    const flight = taskFlightMs(task);
    if (flight !== undefined) {
      measured += 1;
      flightMs += flight;
    }
    if (task.startedAt !== undefined) {
      earliest = earliest === undefined ? task.startedAt : Math.min(earliest, task.startedAt);
    }
    if (task.finishedAt !== undefined) {
      latest = latest === undefined ? task.finishedAt : Math.max(latest, task.finishedAt);
    }
  }

  const windowMs = earliest === undefined || latest === undefined ? 0 : Math.max(0, latest - earliest);
  return { measured, flightMs, windowMs };
}

/** Σ the planner's `estimateMin` — the fallback when the run has no measured task timings yet. */
export function plannerEstimateMs(run: Run): number {
  return (run.plan?.tasks ?? []).reduce((sum, task) => sum + Math.max(0, task.estimateMin) * 60_000, 0);
}

/**
 * Money and tokens. While a run is in flight the newest `metrics` sample is fresher than the
 * snapshot attached to `run.created`; a finished run's own `metrics` is definitive. `metricsHistory`
 * is not per run (see the reducer), so it is only trusted for the active, unfinished run.
 */
export function moneyFor(state: SkyState, run: Run): RunMetrics {
  const active = state.activeRunId === run.id && !isRunOver(run.status);
  const latest = active ? state.metricsHistory.at(-1) : undefined;
  return latest?.metrics ?? run.metrics;
}

/** The writer's summary lives only on the `run.finished` event, never on `Run`. */
export function runSummary(state: SkyState, run: Run): string | undefined {
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index];
    if (event === undefined || event.type !== 'run.finished') continue;
    if (event.payload.run.id !== run.id) continue;
    const summary = event.payload.summary.trim();
    if (summary !== '') return summary;
  }
  return undefined;
}

/**
 * The flight report for one run (default: the active one).
 *
 * Sources, in order of trust:
 * - counts and timings from the `Run`/`TaskRun` snapshots in `state.runs` (always present, even
 *   after the 5,000-event cap has evicted the run's early events);
 * - money/tokens from the newest metrics sample while flying, else `run.metrics`;
 * - verdicts from `state.verdicts`, filtered to this run's task keys (the map is keyed by task only);
 * - story and summary from `state.events` (active run plus global flock events).
 *
 * `serialMs` is always an estimate: overhead (wall minus the overlapping window) plus the sum of
 * measured task time, or the planner's own estimates when no timings exist yet.
 */
export function buildFlightReport(
  state: SkyState,
  runId: string | undefined = state.activeRunId,
  now: number = Date.now(),
): FlightReport | undefined {
  const run = runId === undefined ? activeRunOf(state) : state.runs[runId];
  if (run === undefined) return undefined;

  const counts = taskCounts(run);
  const timings = taskTimings(run);
  const wallMs = Math.max(0, (run.finishedAt ?? now) - run.startedAt);
  const estimated: string[] = [ESTIMATED_SERIAL, ESTIMATED_SAVED, ESTIMATED_SPEEDUP];

  let serialMs: number;
  let flightWindowMs: number;
  if (timings.measured > 0) {
    flightWindowMs = timings.windowMs;
    serialMs = Math.max(0, wallMs - flightWindowMs) + timings.flightMs;
  } else {
    // No task has both timestamps: fall back to what the planner promised and say so.
    flightWindowMs = 0;
    serialMs = plannerEstimateMs(run);
    estimated.push(ESTIMATED_PLANNER);
  }

  const savedMs = serialMs - wallMs;
  const speedup = wallMs > 0 && serialMs > 0 ? serialMs / wallMs : 1;
  const money = moneyFor(state, run);
  const keys = taskKeys(run);
  const summary = runSummary(state, run);

  const report: FlightReport = {
    runId: run.id,
    goal: run.goal.text,
    status: run.status,
    outcome: outcomeOf(run, counts),
    tasks: counts,
    wallMs,
    flightWindowMs,
    serialMs,
    savedMs,
    speedup,
    costUsd: money.apiCostUsd,
    savedUsd: money.estSavedUsd,
    localCalls: money.localCallCount,
    tokens: { api: money.apiUsage, local: money.localUsage },
    nodes: nodeContributions(run, state.events, state.nodes),
    verdicts: notableVerdicts(state.verdicts, keys),
    story: storyBeats(state.events, run, state.nodes),
    estimated,
  };
  if (summary !== undefined) report.summary = summary;
  return report;
}
