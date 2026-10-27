/**
 * `@starling/merger` — land audited task branches on the run's integration branch.
 *
 * The merge queue merges one task branch at a time into a dedicated, reused integration worktree,
 * runs the regression suite after each merge, and rolls back a red merge so the integration branch
 * is always green. When two branches conflict anyway, `createConflictResolver()` rebuilds the
 * conflict on a throwaway branch, has a resolver agent repair it, proves the repair and asks the
 * same queue to land it.
 */
export const PACKAGE = '@starling/merger' as const;

export {
  type ConflictMarker,
  type ConflictMergeInput,
  type ConflictMergeOutcome,
  commitConflictedMerge,
  DEFAULT_HUNK_CHARS,
  DEFAULT_HUNK_LINES,
  DEFAULT_HUNKS_PER_FILE,
  findConflictMarkers,
  findHunks,
  type HunkOptions,
  readHunks,
  renderHunks,
  resetBranch,
} from './conflict.ts';
export { createGit, type Git, outputTail, tailText } from './git.ts';
export { DEFAULT_SESSION_TIMEOUT_MS, type IdleWatch, type IdleWatchOptions, watchForIdle } from './idle.ts';
export { type MergeDeps, mergeTask } from './merge.ts';
export { createMerger } from './merger.ts';
export { parseMergeTree, runPreflight } from './preflight.ts';
export { createMergeQueue, type MergeFn, type MergeQueueDeps } from './queue.ts';
export { createConflictResolver, DEFAULT_MAX_ATTEMPTS } from './resolver.ts';
export type {
  ConflictResolver,
  ConflictResolverOptions,
  ResolveContext,
  ResolveResult,
  ResolverPromptCompiler,
  ResolverPromptExtras,
  ResolverRepo,
} from './resolver-types.ts';
export {
  DEFAULT_TEST_TIMEOUT_MS,
  runSuite,
  type SuiteOptions,
  type SuiteOutcome,
} from './suite.ts';
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
