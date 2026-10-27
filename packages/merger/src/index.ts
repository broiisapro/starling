/**
 * `@starling/merger` — land audited task branches on the run's integration branch.
 *
 * The merge queue merges one task branch at a time into a dedicated, reused integration worktree,
 * runs the regression suite after each merge, and rolls back a red merge so the integration branch
 * is always green.
 */
export const PACKAGE = '@starling/merger' as const;

export { createGit, type Git, outputTail, tailText } from './git.ts';
export { DEFAULT_TEST_TIMEOUT_MS, type MergeDeps, mergeTask } from './merge.ts';
export { createMerger } from './merger.ts';
export { parseMergeTree, runPreflight } from './preflight.ts';
export { createMergeQueue, type MergeFn, type MergeQueueDeps } from './queue.ts';
export type {
  ExecFn,
  MergeOptions,
  MergeQueue,
  MergeQueueEntry,
  MergerOptions,
  MergerService,
  PreflightResult,
} from './types.ts';
export {
  canonicalPath,
  type EnsureWorktreeInput,
  ensureIntegrationWorktree,
  INTEGRATION_DIR,
  integrationWorktreePath,
  listWorktrees,
  sanitizeBranchName,
  type WorktreeEntry,
} from './worktree.ts';
