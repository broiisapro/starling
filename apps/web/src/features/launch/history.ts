import type { Run } from '@starling/core';
import type { BadgeTone } from '../../components';

/**
 * Run-history presentation.
 *
 * The panel receives whole `Run`s, so everything the table shows is derived here: status label and
 * tone, merged/failed counts, cost from `run.metrics`, duration from `startedAt` → `finishedAt`
 * (or "now" while a run is still going). Pure, so the history tests need no DOM.
 */

export interface RunSummary {
  id: string;
  goal: string;
  repoPath: string;
  repoName: string;
  status: Run['status'];
  statusLabel: string;
  tone: BadgeTone;
  total: number;
  merged: number;
  failed: number;
  active: number;
  planSummary?: string;
  costUsd: number;
  savedUsd: number;
  durationMs: number;
  startedAt: number;
  finishedAt?: number;
}

const RUN_STATUS: Record<Run['status'], { label: string; tone: BadgeTone }> = {
  mapping: { label: 'Mapping the repo', tone: 'accent' },
  planning: { label: 'Planning', tone: 'accent' },
  planned: { label: 'Planned', tone: 'info' },
  running: { label: 'Flying', tone: 'info' },
  finished: { label: 'Finished', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function runStatusLabel(status: Run['status']): string {
  return RUN_STATUS[status].label;
}

export function runTone(status: Run['status']): BadgeTone {
  return RUN_STATUS[status].tone;
}

/** Last path segment, for a one-glance repo label (`/Users/m/Code/sky-todo` → `sky-todo`). */
export function repoName(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, '');
  if (trimmed.length === 0) return path;
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] ?? trimmed;
}

/** Pure summary. `now` only matters for a run without `finishedAt`; tests pass a fixed clock. */
export function summarizeRun(run: Run, now: number): RunSummary {
  const tasks = Object.values(run.tasks);
  const merged = tasks.filter((task) => task.status === 'merged').length;
  const failed = tasks.filter((task) => task.status === 'failed' || task.status === 'conflict').length;
  const end = run.finishedAt ?? now;
  const durationMs = Math.max(0, end - run.startedAt);
  const summary: RunSummary = {
    id: run.id,
    goal: run.goal.text,
    repoPath: run.goal.repoPath,
    repoName: repoName(run.goal.repoPath),
    status: run.status,
    statusLabel: runStatusLabel(run.status),
    tone: runTone(run.status),
    total: tasks.length,
    merged,
    failed,
    active: tasks.length - merged - failed,
    costUsd: run.metrics.apiCostUsd,
    savedUsd: run.metrics.estSavedUsd,
    durationMs,
    startedAt: run.startedAt,
  };
  if (run.finishedAt !== undefined) summary.finishedAt = run.finishedAt;
  if (run.plan !== undefined) summary.planSummary = run.plan.summary;

  // The plan is authoritative for task count before any `task.status` event lands.
  if (summary.total === 0 && run.plan !== undefined) summary.total = run.plan.tasks.length;
  return summary;
}

/** Newest first, exactly what the history list renders. */
export function runHistory(runs: readonly Run[], now: number): RunSummary[] {
  return runs
    .map((run) => summarizeRun(run, now))
    .sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id));
}
