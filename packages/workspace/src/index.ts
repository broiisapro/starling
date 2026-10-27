/**
 * `@starling/workspace` — the real `Workspace` port on the git CLI, plus git bundles for Flock mode.
 *
 * ```ts
 * import { createWorkspace, recoverWorkspace } from '@starling/workspace';
 *
 * const ws = createWorkspace({ worktreeRoot: '/tmp/starling-worktrees' });
 * await ws.ensureIntegrationBranch('/repo', 'main', 'starling/abc123/integration');
 * const { path } = await ws.create('/repo', 'starling/abc123/t01-api', 'starling/abc123/integration');
 * const summary = await ws.diff(path, 'starling/abc123/integration');
 * const conflicts = await ws.predictConflicts('/repo', 'starling/abc123/integration', 'starling/abc123/t01-api');
 *
 * // `starling gc`: collect what a dead run left behind (report only unless dryRun is false).
 * const report = await recoverWorkspace('/repo', '/tmp/starling-worktrees', { dryRun: true });
 * ```
 */
export const PACKAGE = '@starling/workspace' as const;

export { type BundleOps, type BundleOpsOptions, createBundleOps } from './bundle';
export {
  buildDiffSummary,
  countNewFileLines,
  type FileStat,
  isBinary,
  mergeStats,
  newFilePatch,
  PATCH_LIMIT_BYTES,
  parseNumstat,
  truncatePatch,
  UNTRACKED_MAX_BYTES,
} from './diff';
export { type DiskUsage, diskUsage, formatBytes } from './disk';
export {
  type ExecLike,
  Git,
  type GitCallOptions,
  type GitOptions,
  gitFailure,
  isLockContention,
} from './git';
export { KeyedMutex, sleep } from './mutex';
export {
  bundlePathFor,
  sanitizeBranch,
  sanitizeBranchInput,
  shortRef,
  worktreePathFor,
} from './paths';
export { boundedExec, defaultGitConcurrency, type ExecFn, Semaphore } from './pool';
export {
  DEFAULT_BRANCH_PREFIX,
  DEFAULT_OLDER_THAN_HOURS,
  isIntegrationBranch,
  type RecoverWorkspaceOptions,
  recoverWorkspace,
  type RecoveryAction,
  type RecoveryEntry,
  type RecoveryKind,
  type RecoveryReason,
  type RecoveryReport,
  runIdOf,
} from './recover';
export {
  branchesWithPrefix,
  isInside,
  isLinkedWorktree,
  listWorktrees,
  mtimeMs,
  normalizeKey,
  type RepoContext,
  type RepoStatus,
  pruneWorktrees,
  refCommitTime,
  refCreatedAt,
  refExists,
  repoRootForGitDir,
  repoStatus,
  resolveRepo,
  splitNul,
  untrackedFiles,
  worktreeAdminDir,
  type WorktreeEntry,
} from './repo';
export { applySparseCheckout, normalizeSparseDirs } from './sparse';
export {
  assertGitVersion,
  compareGitVersions,
  formatGitVersion,
  GIT_TOO_OLD_CODE,
  type GitVersion,
  MIN_MERGE_TREE_VERSION,
  parseGitVersion,
} from './version';
export { type CreateWorkspaceOptions, createWorkspace, type WorkspaceWithBundles } from './workspace';
