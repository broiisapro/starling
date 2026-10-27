/**
 * Queue board selectors: status → column, dependency gating, merge order, elapsed time.
 *
 * Pure functions, no React. `MergeQueue` is a thin renderer over `buildQueueBoard`, and every
 * awkward case (a task that was cancelled, a merged task with no merge event, a plan task with no
 * run yet) is decided here so it can be unit-tested.
 */
import type { MergeResult, Plan, TaskRun, TaskSpec, TaskStatus } from '@starling/core';

import { shortSha } from '../metrics/format';

export type QueueColumnId = 'waiting' | 'flying' | 'audit' | 'landing' | 'wire' | 'grounded';

/** Left → right board order; also the animation direction reference. */
export const QUEUE_COLUMNS: readonly QueueColumnId[] = [
  'waiting',
  'flying',
  'audit',
  'landing',
  'wire',
  'grounded',
] as const;

export interface QueueColumnMeta {
  id: QueueColumnId;
  title: string;
  /** One-liner under the title, useful for screen readers and first-time viewers. */
  hint: string;
  /** Tailwind class for the column's accent bar + dot. */
  dot: string;
  /** Tailwind class for the column heading text. */
  text: string;
  /** Empty-state copy. Kept dry with one bird pun per board. */
  empty: string;
}

export const QUEUE_COLUMN_META: Record<QueueColumnId, QueueColumnMeta> = {
  waiting: {
    id: 'waiting',
    title: 'Waiting',
    hint: 'Queued for a slot, or blocked on an unmerged dependency',
    dot: 'bg-slate-500',
    text: 'text-slate-300',
    empty: 'No birds waiting',
  },
  flying: {
    id: 'flying',
    title: 'Flying',
    hint: 'An agent is writing code in a worktree',
    dot: 'bg-sky-400',
    text: 'text-sky-200',
    empty: 'Nobody in the air',
  },
  audit: {
    id: 'audit',
    title: 'Audit',
    hint: 'Tests, lane check and the local auditor — then the fixer if needed',
    dot: 'bg-amber-400',
    text: 'text-amber-200',
    empty: 'Nothing under review',
  },
  landing: {
    id: 'landing',
    title: 'Landing',
    hint: 'Merging into the integration branch',
    dot: 'bg-fuchsia-400',
    text: 'text-fuchsia-200',
    empty: 'Nothing landing',
  },
  wire: {
    id: 'wire',
    title: 'On the wire',
    hint: 'Merged, in merge order',
    dot: 'bg-emerald-400',
    text: 'text-emerald-200',
    empty: 'Nothing on the wire yet',
  },
  grounded: {
    id: 'grounded',
    title: 'Grounded',
    hint: 'Failed, conflicted or cancelled',
    dot: 'bg-rose-500',
    text: 'text-rose-200',
    empty: 'All clear',
  },
};

/**
 * Every `TaskStatus` has exactly one home. `ready` sits in Waiting even when its dependencies are
 * merged because the dispatch loop has not picked it up yet — the card says "queued" instead of
 * "blocked" so the distinction is visible without adding a seventh column.
 */
export const COLUMN_BY_STATUS: Record<TaskStatus, QueueColumnId> = {
  pending: 'waiting',
  ready: 'waiting',
  running: 'flying',
  auditing: 'audit',
  fixing: 'audit',
  merging: 'landing',
  merged: 'wire',
  failed: 'grounded',
  conflict: 'grounded',
  cancelled: 'grounded',
};

export function assignColumn(status: TaskStatus): QueueColumnId {
  return COLUMN_BY_STATUS[status];
}

export type WaitingReason = 'blocked' | 'queued';

export interface WireEntry {
  taskKey: string;
  ts?: number;
  commit?: string;
}

export interface QueueCard {
  taskKey: string;
  title: string;
  run: TaskRun;
  column: QueueColumnId;
  /** Only for `waiting`: blocked on dependencies, or ready and waiting for a free slot. */
  waitingReason?: WaitingReason;
  /** Dependencies that have not reached `merged` yet. */
  unmetDeps: string[];
  /** 1-based position on the wire (merge order). */
  wireIndex?: number;
  /** Short merge commit sha, from the `merge.result` event. */
  commit?: string;
  /** The merge that put this task on the wire. */
  merge?: MergeResult;
  /** The most recent failed merge attempt (conflict / tests-failed) — shown on hover. */
  problem?: MergeResult;
}

export interface QueueBoard {
  columns: Record<QueueColumnId, QueueCard[]>;
  total: number;
  landed: number;
  grounded: number;
}

/** A plan task that has no `TaskRun` yet: it is planned and pending, nothing more. */
export function pendingRun(taskKey: string): TaskRun {
  return {
    runId: 'unstarted',
    taskKey,
    status: 'pending',
    attempts: 0,
    usage: { input: 0, output: 0, cached: 0 },
    costUsd: 0,
  };
}

/** Dependencies that are not `merged`. A dependency missing from `tasks` counts as unmet. */
export function unmetDependencies(spec: TaskSpec | undefined, tasks: Record<string, TaskRun>): string[] {
  if (spec === undefined) return [];
  return spec.dependsOn.filter((dep) => tasks[dep]?.status !== 'merged');
}

/**
 * Merge order for the wire column: `merge.result` events with status `merged`, ascending by `ts`,
 * deduped by task (a task that merged once keeps its first commit). Merged tasks without a merge
 * event are appended by finish time so the board never loses a task.
 */
export function wireOrder(merges: readonly MergeResult[], tasks: Record<string, TaskRun>): WireEntry[] {
  const merged = merges
    .filter((result) => result.status === 'merged')
    .slice()
    .sort((a, b) => a.ts - b.ts);

  const seen = new Set<string>();
  const entries: WireEntry[] = [];
  for (const result of merged) {
    if (seen.has(result.taskKey)) continue;
    seen.add(result.taskKey);
    entries.push({ taskKey: result.taskKey, ts: result.ts, commit: shortSha(result.commit) });
  }

  const fallback = Object.values(tasks)
    .filter((run) => run.status === 'merged' && !seen.has(run.taskKey))
    .sort((a, b) => timeOf(a) - timeOf(b) || a.taskKey.localeCompare(b.taskKey));
  for (const run of fallback) {
    entries.push({ taskKey: run.taskKey, ts: run.finishedAt, commit: undefined });
  }
  return entries;
}

function timeOf(run: TaskRun): number {
  return run.finishedAt ?? run.startedAt ?? Number.MAX_SAFE_INTEGER;
}

/** Newest merge result for a task, optionally filtered to the statuses that need explaining. */
export function latestMergeResult(
  merges: readonly MergeResult[],
  taskKey: string,
  statuses?: readonly MergeResult['status'][],
): MergeResult | undefined {
  let latest: MergeResult | undefined;
  for (const result of merges) {
    if (result.taskKey !== taskKey) continue;
    if (statuses !== undefined && !statuses.includes(result.status)) continue;
    if (latest === undefined || result.ts >= latest.ts) latest = result;
  }
  return latest;
}

const FAILURE_STATUSES: readonly MergeResult['status'][] = ['conflict', 'tests-failed'];

function sortColumn(column: QueueColumnId, cards: IndexedCard[]): IndexedCard[] {
  switch (column) {
    case 'flying':
    case 'audit':
    case 'landing':
      return cards.sort((a, b) => startOf(a.run) - startOf(b.run) || a.taskKey.localeCompare(b.taskKey));
    case 'grounded':
      return cards.sort((a, b) => timeOf(b.run) - timeOf(a.run) || a.taskKey.localeCompare(b.taskKey));
    case 'wire':
      return cards.sort((a, b) => (a.wireIndex ?? 0) - (b.wireIndex ?? 0));
    case 'waiting':
      return cards.sort(
        (a, b) =>
          Number(a.waitingReason === 'blocked') - Number(b.waitingReason === 'blocked') ||
          a.planIndex - b.planIndex ||
          a.taskKey.localeCompare(b.taskKey),
      );
  }
}

function startOf(run: TaskRun): number {
  return run.startedAt ?? Number.MAX_SAFE_INTEGER;
}

interface IndexedCard extends QueueCard {
  planIndex: number;
}

export function buildQueueBoard(
  plan: Plan | undefined,
  tasks: Record<string, TaskRun>,
  merges: readonly MergeResult[],
): QueueBoard {
  const specs = new Map<string, TaskSpec>();
  const planOrder = new Map<string, number>();
  plan?.tasks.forEach((spec, index) => {
    specs.set(spec.key, spec);
    planOrder.set(spec.key, index);
  });

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const spec of plan?.tasks ?? []) {
    keys.push(spec.key);
    seen.add(spec.key);
  }
  for (const key of Object.keys(tasks)) {
    if (!seen.has(key)) {
      keys.push(key);
      seen.add(key);
    }
  }

  const wire = wireOrder(merges, tasks);
  const wireIndex = new Map(wire.map((entry, index) => [entry.taskKey, index + 1] as const));

  const cards: IndexedCard[] = keys.map((taskKey, fallbackIndex) => {
    const run = tasks[taskKey] ?? pendingRun(taskKey);
    const spec = specs.get(taskKey);
    const column = assignColumn(run.status);
    const unmetDeps = unmetDependencies(spec, tasks);
    const entry = wire.find((candidate) => candidate.taskKey === taskKey);
    return {
      taskKey,
      title: spec?.title ?? taskKey,
      run,
      column,
      waitingReason: column === 'waiting' ? (unmetDeps.length > 0 ? 'blocked' : 'queued') : undefined,
      unmetDeps,
      wireIndex: column === 'wire' ? wireIndex.get(taskKey) : undefined,
      commit: entry?.commit,
      merge: column === 'wire' ? latestMergeResult(merges, taskKey, ['merged']) : undefined,
      problem: latestMergeResult(merges, taskKey, FAILURE_STATUSES),
      planIndex: planOrder.get(taskKey) ?? planOrder.size + fallbackIndex,
    } satisfies IndexedCard;
  });

  const columns: Record<QueueColumnId, IndexedCard[]> = {
    waiting: [],
    flying: [],
    audit: [],
    landing: [],
    wire: [],
    grounded: [],
  };
  for (const card of cards) columns[card.column].push(card);
  for (const id of QUEUE_COLUMNS) columns[id] = sortColumn(id, columns[id]);

  return {
    columns,
    total: cards.length,
    landed: columns.wire.length,
    grounded: columns.grounded.length,
  };
}

/** Elapsed time for one card: frozen once finished, live while running. */
export function taskElapsedMs(run: TaskRun, now: number): number {
  if (run.finishedAt !== undefined) {
    if (run.startedAt === undefined) return 0;
    return Math.max(0, run.finishedAt - run.startedAt);
  }
  if (run.startedAt === undefined) return 0;
  return Math.max(0, now - run.startedAt);
}

/**
 * Horizontal offset (px) a card travels when it changes column, used as the from-transform of the
 * arrival animation. Moving right starts the card slightly to the left, and vice versa.
 */
export function transitionOffset(from: QueueColumnId, to: QueueColumnId, step = 18, max = 72): number {
  const fromIndex = QUEUE_COLUMNS.indexOf(from);
  const toIndex = QUEUE_COLUMNS.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) return 0;
  const delta = (fromIndex - toIndex) * step;
  return Math.max(-max, Math.min(max, delta));
}

/** Short human label for a blocked/queued waiting card. */
export function waitingLabel(card: QueueCard): string {
  if (card.waitingReason === 'blocked' && card.unmetDeps.length > 0) {
    return `waiting on ${card.unmetDeps.join(', ')}`;
  }
  return 'queued for a slot';
}
