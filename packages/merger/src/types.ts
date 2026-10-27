import type { Clock, ExecOptions, ExecResult, MergeResult, Merger, TaskRun } from '@starling/core';

/** The exact `exec` shape from core, injectable so tests and the engine can fake process spawns. */
export type ExecFn = (cmd: string[], opts: ExecOptions) => Promise<ExecResult>;

/**
 * Extra knobs for a single merge.
 *
 * `testCommand` is the only field the core `Merger` port defines; `title` is additive sugar so the
 * merge commit can read `merge(t03-csv-export): CSV export` instead of repeating the branch name.
 */
export interface MergeOptions {
  testCommand?: string;
  title?: string;
}

/** One task waiting in (or holding) the queue for a given repo + integration branch. */
export interface MergeQueueEntry {
  id: string;
  repo: string;
  integrationBranch: string;
  taskKey: string;
  branch?: string;
  enqueuedAt: number;
  state: 'queued' | 'running';
}

/**
 * Serial merge queue.
 *
 * FIFO within one repo + integration branch; independent branches merge concurrently because they
 * live in separate worktrees. A failed merge (a rejected promise) does not poison the queue: the
 * next task for that branch still runs.
 */
export interface MergeQueue {
  enqueue(repo: string, integrationBranch: string, task: TaskRun, opts?: MergeOptions): Promise<MergeResult>;
  /** Queued + running entries, oldest first. */
  pending(): MergeQueueEntry[];
  /** Results in the order they landed (most recent last). */
  results(): MergeResult[];
  /** Subscribe to results. Returns an unsubscribe function. */
  onResult(fn: (result: MergeResult) => void): () => void;
}

/**
 * Conflict prediction produced by `git merge-tree --write-tree --name-only`.
 *
 * `alreadyMerged` means the engine can skip the merge entirely; `clean` means merge-tree found no
 * conflicts (the real merge can still fail on a dirty worktree or failing tests).
 */
export interface PreflightResult {
  repo: string;
  integrationBranch: string;
  branch: string;
  clean: boolean;
  conflictedFiles: string[];
  alreadyMerged: boolean;
  detail: string;
}

export interface MergerOptions {
  /**
   * Root for Starling's worktrees. The integration worktree lives at
   * `<worktreeRoot>/_integration/<branch-sanitised>` and is reused for every merge on that branch.
   */
  worktreeRoot: string;
  exec?: ExecFn;
  clock?: Clock;
  /** Kill the regression suite and treat it as failed after this long. Default: 10 minutes. */
  testTimeoutMs?: number;
}

/** `createMerger()`'s return value: the core port plus the queue, preflight and cleanup. */
export interface MergerService extends Omit<Merger, 'merge'> {
  merge(repo: string, integrationBranch: string, task: TaskRun, opts?: MergeOptions): Promise<MergeResult>;
  queue(): MergeQueue;
  /** Predict conflicts without touching a worktree or moving a ref. */
  preflight(repo: string, integrationBranch: string, branch: string): Promise<PreflightResult>;
  /** The path the integration worktree will use for `integrationBranch` (no side effects). */
  integrationWorktreePath(integrationBranch: string): string;
  /** Remove every integration worktree this merger created. Call at the end of a run. */
  dispose(): Promise<void>;
}
