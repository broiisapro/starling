import type { Plan, Run, TaskRun } from '@starling/core/browser';
import { summarizeRun } from '../launch';

/**
 * Pure comparison math for the compare page (Epic 122).
 *
 * Everything here works from the `Run` snapshot in `state.runs`, because `state.events` only holds
 * the active run's story (see `data/reducer.ts`). No DOM, no store, no network — the component and
 * the tests both call these functions.
 */

/**
 * A serial runner pays this once per task: dispatch, a fresh worktree, the audit gate and the merge.
 * A parallel run hides that tail behind other tasks. 16 s is the fixture's observed 14 s first
 * dispatch rounded up, and lands the launch-day baseline at 8m 32s against a 5m 56s wall (1.44×).
 */
export const SERIAL_STEP_OVERHEAD_MS = 16_000;

/** The caption every surface uses for a synthetic serial run. */
export const SERIAL_BASELINE_LABEL = 'estimated baseline: one agent, one task at a time';

export interface RunStats {
  id: string;
  goal: string;
  status: Run['status'];
  wallMs: number;
  serialMs: number;
  speedup: number;
  tasks: number;
  merged: number;
  failed: number;
  attempts: number;
  apiCostUsd: number;
  savedUsd: number;
  tokens: number;
  peakParallel: number;
  nodes: string[];
}

/** A synthetic run built by `serialBaseline`, tagged structurally so every label can find it. */
export type SerialBaselineRun = Run & { readonly synthetic: 'serial-baseline' };

export function isSerialBaseline(run: Run): run is SerialBaselineRun {
  return (run as Run & { synthetic?: string }).synthetic === 'serial-baseline';
}

function taskFlightMs(task: TaskRun, now: number): number | undefined {
  if (task.startedAt === undefined) return undefined;
  const end =
    task.finishedAt ?? (task.status === 'pending' || task.status === 'ready' ? task.startedAt : now);
  return Math.max(0, end - task.startedAt);
}

function planEstimateMs(plan: Plan | undefined, key: string): number {
  const estimate = plan?.tasks.find((task) => task.key === key)?.estimateMin ?? 0;
  return Math.max(0, estimate) * 60_000;
}

/**
 * Peak number of tasks whose `[startedAt, finishedAt]` intervals overlap. Open intervals end at
 * `now`, so a live run's number grows honestly. Ties count as closed-then-opened: a task that ends
 * exactly when another starts is not parallel with it.
 */
export function peakParallel(run: Run, now: number): number {
  const points: { ts: number; delta: number }[] = [];
  for (const task of Object.values(run.tasks)) {
    if (task.startedAt === undefined) continue;
    const end = Math.max(task.startedAt, task.finishedAt ?? now);
    points.push({ ts: task.startedAt, delta: 1 }, { ts: end, delta: -1 });
  }
  points.sort((a, b) => a.ts - b.ts || a.delta - b.delta);
  let active = 0;
  let peak = 0;
  for (const point of points) {
    active += point.delta;
    peak = Math.max(peak, active);
  }
  return peak;
}

/** Work each task would take on its own: its flight time, or the plan estimate when it has none. */
function serialFlights(run: Run, now: number): number[] {
  const flights: number[] = [];
  const seen = new Set<string>();
  for (const [key, task] of Object.entries(run.tasks)) {
    seen.add(key);
    flights.push(taskFlightMs(task, now) ?? planEstimateMs(run.plan, key));
  }
  // A plan known before its first `task.status` event still deserves a baseline.
  for (const spec of run.plan?.tasks ?? []) {
    if (seen.has(spec.key)) continue;
    flights.push(Math.max(0, spec.estimateMin) * 60_000);
  }
  return flights;
}

/** `serialFlights` + one dispatch/audit tail per task. */
export function serialMs(run: Run, now: number): number {
  const flights = serialFlights(run, now);
  return flights.reduce((total, flight) => total + flight, 0) + flights.length * SERIAL_STEP_OVERHEAD_MS;
}

/** Run-level numbers for one side of the table. `now` only matters while the run is still flying. */
export function runStats(run: Run, now: number): RunStats {
  const summary = summarizeRun(run, now);
  const tasks = Object.values(run.tasks);
  const attempts = tasks.reduce((total, task) => total + Math.max(0, task.attempts), 0);
  const nodes = [
    ...new Set(tasks.flatMap((task) => (task.nodeId === undefined ? [] : [task.nodeId]))),
  ].sort();
  const serial = serialMs(run, now);
  const wallMs = summary.durationMs;
  const tokens = run.metrics.apiUsage.input + run.metrics.apiUsage.output;

  return {
    id: run.id,
    goal: summary.goal,
    status: summary.status,
    wallMs,
    serialMs: serial,
    speedup: wallMs > 0 && serial > 0 ? serial / wallMs : 1,
    tasks: summary.total,
    merged: summary.merged,
    failed: summary.failed,
    attempts,
    apiCostUsd: summary.costUsd,
    savedUsd: summary.savedUsd,
    tokens,
    peakParallel: peakParallel(run, now),
    nodes,
  };
}

/**
 * The same task list laid end to end. Costs and usage are the run's own; only the schedule is
 * synthetic — each task keeps its flight time (or estimate) and is followed by one serial tail.
 * The result is a real `Run`, so every existing panel and formatter can render it.
 */
export function serialBaseline(run: Run, now: number = Date.now()): SerialBaselineRun {
  const ordered = Object.entries(run.tasks).sort(([keyA, a], [keyB, b]) => {
    const startA = a.startedAt ?? Number.POSITIVE_INFINITY;
    const startB = b.startedAt ?? Number.POSITIVE_INFINITY;
    return startA - startB || keyA.localeCompare(keyB);
  });
  const tasks: Record<string, TaskRun> = {};
  let cursor = run.startedAt;
  for (const [key, task] of ordered) {
    const flight = taskFlightMs(task, now) ?? planEstimateMs(run.plan, key);
    const next: TaskRun = { ...task };
    if (flight > 0) {
      next.startedAt = cursor;
      next.finishedAt = cursor + flight;
    } else {
      delete next.startedAt;
      delete next.finishedAt;
    }
    tasks[key] = next;
    cursor += flight + SERIAL_STEP_OVERHEAD_MS;
  }

  // Plan-only tasks (no TaskRun yet) still lengthen the serial schedule.
  for (const spec of run.plan?.tasks ?? []) {
    if (tasks[spec.key] !== undefined) continue;
    cursor += Math.max(0, spec.estimateMin) * 60_000 + SERIAL_STEP_OVERHEAD_MS;
  }

  const total = serialMs(run, now);
  const baseline: SerialBaselineRun = {
    ...run,
    id: `${run.id}:serial`,
    status: run.status === 'cancelled' ? 'cancelled' : 'finished',
    tasks,
    startedAt: run.startedAt,
    finishedAt: run.startedAt + total,
    metrics: { ...run.metrics, elapsedMs: total },
    synthetic: 'serial-baseline',
  };
  return baseline;
}

export type {
  CompareMetric,
  CompareRow,
  DeltaChip,
  MetricDirection,
  MetricFormat,
} from './metrics';
// Re-exported so `derive.ts` stays the one entry point for snapshots and tables.
export {
  compareStats,
  deltaChip,
  formatMetricValue,
} from './metrics';

// ── nodes ─────────────────────────────────────────────────────────────────────

export interface NodeCount {
  nodeId: string;
  name: string;
  count: number;
}

/** Tasks per node, for the "two laptops did this" half of the demo. Hub sorts first. */
export function nodeTaskCounts(run: Run, names: Record<string, string> = {}): NodeCount[] {
  const counts = new Map<string, number>();
  for (const task of Object.values(run.tasks)) {
    const id = task.nodeId ?? 'unassigned';
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([nodeId, count]) => ({ nodeId, name: names[nodeId] ?? nodeId, count }))
    .sort((a, b) => {
      if (a.nodeId === 'hub') return -1;
      if (b.nodeId === 'hub') return 1;
      return b.count - a.count || a.nodeId.localeCompare(b.nodeId);
    });
}

/** True when at least one task has a usable interval; otherwise the page says the numbers are estimates. */
export function hasTaskTimings(run: Run): boolean {
  return Object.values(run.tasks).some((task) => task.startedAt !== undefined);
}
