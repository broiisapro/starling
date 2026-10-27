/**
 * Crash recovery: find and (optionally) collect the git state a dead run left behind.
 *
 * A Starling run can die in ways no process can clean up after: the hub is killed, a laptop sleeps
 * through a run, an opencode session is orphaned. What remains is git state — task worktrees under
 * the worktree root, their `starling/<run>/<task>` branches, and occasionally a half-written
 * directory whose `worktree add` never finished. Left alone, each run leaks tens of thousands of
 * files, and the next run's `git worktree list` gets slower for no reason.
 *
 * `recoverWorkspace` is deliberately conservative, because deleting the wrong branch throws away a
 * whole agent session:
 *
 * - it only touches branches under `starling/` (configurable) and worktrees inside the given root;
 * - a run whose id is in `liveRunIds` is never touched;
 * - everything must be older than `olderThanHours` (default 12) *by every clock we can read*: branch
 *   reflog creation time, HEAD commit time, worktree directory mtime and the worktree's private git
 *   index mtime. No evidence at all means "keep", not "delete";
 * - `starling/<run>/integration` is a run's deliverable, so it is protected by default even when the
 *   run is dead — a human may still want to inspect or merge it;
 * - a directory is only removed when its `.git` pointer file provably points inside this repository;
 * - `dryRun: true` computes the exact same report and changes nothing, which is what `starling gc
 *   --dry-run` will show.
 *
 * Failures are collected in the report instead of thrown: one stuck worktree must not stop the rest
 * of a cleanup.
 */
import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Clock } from '@starling/core';
import { exec as coreExec, StarlingError, systemClock } from '@starling/core';
import type { ExecLike } from './git';
import { Git, gitFailure } from './git';
import { KeyedMutex } from './mutex';
import {
  branchesWithPrefix,
  isInside,
  isLinkedWorktree,
  listWorktrees,
  mtimeMs,
  normalizeKey,
  pruneWorktrees,
  refCommitTime,
  refCreatedAt,
  resolveRepo,
  worktreeAdminDir,
} from './repo';

/** Branch namespaces gc is allowed to consider. Everything else is somebody else's work. */
export const DEFAULT_BRANCH_PREFIX = 'starling/';

/** Nothing younger than this is collected: an agent may simply be slow, not dead. */
export const DEFAULT_OLDER_THAN_HOURS = 12;

export interface RecoverWorkspaceOptions {
  /** Compute the report without changing anything. Default false. */
  dryRun?: boolean;
  /** Minimum age, in hours, before a worktree or branch counts as abandoned. Default 12. */
  olderThanHours?: number;
  /** Run ids (the `<run>` segment of `starling/<run>/…`) with a live session. Never collected. */
  liveRunIds?: Iterable<string>;
  /** Branch namespace to consider. Default `starling/`. */
  branchPrefix?: string;
  /** Also collect `<prefix><run>/integration` branches/worktrees. Default false (they are deliverables). */
  includeIntegration?: boolean;
  /** Injectable clock, for deterministic tests. */
  clock?: Clock;
  /** Injectable exec, for tests. */
  exec?: ExecLike;
}

export type RecoveryKind = 'worktree' | 'branch' | 'directory';

export type RecoveryAction = 'remove-worktree' | 'delete-branch' | 'prune-registration' | 'remove-directory';

export type RecoveryReason = 'dead-run' | 'missing-directory' | 'unregistered-directory' | 'orphan-branch';

export interface RecoveryEntry {
  kind: RecoveryKind;
  reason: RecoveryReason;
  path?: string;
  branch?: string;
  /** `<run>` segment of the branch name, when there is one. */
  runId?: string;
  /** Newest sign of activity found (epoch ms), if any. */
  lastActivityTs?: number;
  ageHours?: number;
  actions: RecoveryAction[];
}

export interface RecoveryReport {
  repo: string;
  worktreeRoot: string;
  dryRun: boolean;
  /** Epoch ms: anything whose newest activity is older than this is collectable. */
  cutoffTs: number;
  scanned: { worktrees: number; branches: number; directories: number };
  entries: RecoveryEntry[];
  removed: { worktrees: string[]; branches: string[]; directories: string[]; registrations: number };
  kept: { live: string[]; young: string[]; protected: string[]; foreign: string[]; unknown: string[] };
  errors: { target: string; message: string }[];
}

const FULL_REF = /^refs\/heads\//;

/** `<run>` from `starling/<run>/<task…>`, or undefined when the branch is not in that shape. */
export function runIdOf(branch: string, prefix: string = DEFAULT_BRANCH_PREFIX): string | undefined {
  if (!branch.startsWith(prefix)) return undefined;
  const rest = branch.slice(prefix.length);
  const slash = rest.indexOf('/');
  const run = slash < 0 ? rest : rest.slice(0, slash);
  return run === '' ? undefined : run;
}

/** True for a run's integration branch (`starling/<run>/integration`, or a custom prefix). */
export function isIntegrationBranch(branch: string, prefix: string = DEFAULT_BRANCH_PREFIX): boolean {
  return branch.startsWith(prefix) && branch.endsWith('/integration');
}

/**
 * Newest evidence that something happened to this worktree/branch. Only ever called to *avoid*
 * deleting, so it errs towards recent: a stale reflog plus a fresh directory mtime means "alive".
 */
async function lastActivity(
  git: Git,
  repoRoot: string,
  path: string | undefined,
  branch: string | undefined,
): Promise<number | undefined> {
  const stamps: number[] = [];
  if (branch !== undefined) {
    const created = await refCreatedAt(git, repoRoot, branch);
    if (created !== undefined) stamps.push(created);
    const committed = await refCommitTime(git, repoRoot, branch);
    if (committed !== undefined) stamps.push(committed);
  }
  if (path !== undefined) {
    const dir = await mtimeMs(path);
    if (dir !== undefined) stamps.push(dir);
    const admin = await worktreeAdminDir(path);
    if (admin !== undefined) {
      // The worktree's private index is rewritten by any stage/commit/status refresh, so its mtime
      // is the best signal that an agent touched the worktree without committing.
      for (const file of ['index', 'gitdir']) {
        const stamp = await mtimeMs(join(admin, file));
        if (stamp !== undefined) stamps.push(stamp);
      }
    }
  }
  if (stamps.length === 0) return undefined;
  return Math.max(...stamps);
}

function ageHours(since: number | undefined, now: number): number | undefined {
  if (since === undefined) return undefined;
  return Math.round(((now - since) / 3_600_000) * 10) / 10;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Compute what a gc would do. Pure enough to be safe: only reads git state. */
export async function recoverWorkspace(
  repo: string,
  worktreeRoot: string,
  opts: RecoverWorkspaceOptions = {},
): Promise<RecoveryReport> {
  const clock = opts.clock ?? systemClock;
  const dryRun = opts.dryRun ?? false;
  const olderThanHours = opts.olderThanHours ?? DEFAULT_OLDER_THAN_HOURS;
  if (!Number.isFinite(olderThanHours) || olderThanHours < 0) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `olderThanHours must be a non-negative number, got ${olderThanHours}`,
    );
  }
  const prefix = opts.branchPrefix ?? DEFAULT_BRANCH_PREFIX;
  const includeIntegration = opts.includeIntegration ?? false;
  const live = new Set(opts.liveRunIds ?? []);

  const git = new Git(opts.exec ?? coreExec, new KeyedMutex());
  const ctx = await resolveRepo(git, repo);
  const root = normalizeKey(resolve(worktreeRoot));
  const now = clock.now();
  const cutoffTs = now - olderThanHours * 3_600_000;

  const report: RecoveryReport = {
    repo: ctx.root,
    worktreeRoot: root,
    dryRun,
    cutoffTs,
    scanned: { worktrees: 0, branches: 0, directories: 0 },
    entries: [],
    removed: { worktrees: [], branches: [], directories: [], registrations: 0 },
    kept: { live: [], young: [], protected: [], foreign: [], unknown: [] },
    errors: [],
  };

  const worktrees = await listWorktrees(git, ctx.root);
  report.scanned.worktrees = worktrees.length;
  const registered = new Set<string>();
  const checkedOut = new Set<string>();

  for (const entry of worktrees) {
    const path = resolve(entry.path);
    registered.add(path);
    registered.add(normalizeKey(path));
    const short = entry.branch?.replace(FULL_REF, '');
    if (short !== undefined) checkedOut.add(short);

    if (path === resolve(ctx.root)) continue; // the main checkout is never ours to remove
    if (short === undefined) {
      // A detached worktree is not something Starling creates; leave it to its owner.
      report.kept.foreign.push(path);
      continue;
    }
    if (!isInside(root, path) || !short.startsWith(prefix)) {
      report.kept.foreign.push(short);
      continue;
    }

    const runId = runIdOf(short, prefix);
    if (runId !== undefined && live.has(runId)) {
      report.kept.live.push(short);
      continue;
    }
    const integration = isIntegrationBranch(short, prefix);
    if (integration && !includeIntegration) {
      report.kept.protected.push(short);
      continue;
    }

    const exists = existsSync(path);
    const activity = await lastActivity(git, ctx.root, exists ? path : undefined, short);
    if (exists) {
      if (activity === undefined) {
        report.kept.unknown.push(short);
        continue;
      }
      if (activity > cutoffTs) {
        report.kept.young.push(short);
        continue;
      }
    }

    // Integration entries only get this far when the operator opted in, so every entry here is a
    // candidate for collection (their branch included).
    const actions: RecoveryAction[] = exists ? ['remove-worktree'] : ['prune-registration'];
    actions.push('delete-branch');
    report.entries.push({
      kind: 'worktree',
      reason: exists ? 'dead-run' : 'missing-directory',
      path,
      branch: short,
      runId,
      lastActivityTs: activity,
      ageHours: ageHours(activity, now),
      actions,
    });
  }

  // Directories under the worktree root that git no longer knows about (an add that died halfway).
  let names: string[] = [];
  try {
    for (const dirent of await readdir(root, { withFileTypes: true })) {
      if (dirent.isDirectory()) names.push(dirent.name);
    }
  } catch {
    names = [];
  }
  for (const name of names) {
    if (name === 'bundles') continue; // bundle transport files, not worktrees
    const path = join(root, name);
    const key = normalizeKey(path);
    if (registered.has(path) || registered.has(key)) continue;
    report.scanned.directories += 1;
    if (!(await isLinkedWorktree(path, ctx.gitDir))) {
      report.kept.foreign.push(path);
      continue;
    }
    const activity = await mtimeMs(path);
    if (activity !== undefined && activity > cutoffTs) {
      report.kept.young.push(path);
      continue;
    }
    report.entries.push({
      kind: 'directory',
      reason: 'unregistered-directory',
      path,
      lastActivityTs: activity,
      ageHours: ageHours(activity, now),
      actions: ['remove-directory'],
    });
  }

  // Branches in our namespace that no worktree has checked out: leftovers from a finished or killed
  // run, after `remove()` cleaned the worktree but the branch stayed (the merger decides merges).
  const branches = await branchesWithPrefix(git, ctx.root, prefix);
  report.scanned.branches = branches.length;
  for (const short of branches) {
    if (checkedOut.has(short)) continue;
    const runId = runIdOf(short, prefix);
    if (runId !== undefined && live.has(runId)) {
      report.kept.live.push(short);
      continue;
    }
    if (isIntegrationBranch(short, prefix) && !includeIntegration) {
      report.kept.protected.push(short);
      continue;
    }
    const created = await refCreatedAt(git, ctx.root, short);
    if (created === undefined) {
      // No reflog (trimmed or disabled): we cannot prove the branch is abandoned.
      report.kept.unknown.push(short);
      continue;
    }
    if (created > cutoffTs) {
      report.kept.young.push(short);
      continue;
    }
    report.entries.push({
      kind: 'branch',
      reason: 'orphan-branch',
      branch: short,
      runId,
      lastActivityTs: created,
      ageHours: ageHours(created, now),
      actions: ['delete-branch'],
    });
  }

  if (dryRun) return report;

  const record = (target: string, err: unknown): void => {
    report.errors.push({ target, message: messageOf(err) });
  };

  await git.lock(ctx.lockKey, async () => {
    // Prune missing registrations *first*: git refuses `branch -D` for a branch that a (broken)
    // worktree registration still claims, so the entry has to go before the branch can.
    const stale = report.entries.filter((entry) => entry.actions.includes('prune-registration'));
    if (stale.length > 0) {
      try {
        await pruneWorktrees(git, ctx.root);
        report.removed.registrations = stale.length;
      } catch (err) {
        record('worktree prune', err);
      }
    }

    for (const entry of report.entries) {
      const target = entry.path ?? entry.branch ?? '(unknown)';
      try {
        if (entry.kind === 'directory') {
          if (entry.path === undefined) continue;
          await rm(entry.path, { recursive: true, force: true });
          report.removed.directories.push(entry.path);
          continue;
        }
        if (entry.actions.includes('remove-worktree') && entry.path !== undefined) {
          const path = entry.path;
          const result = await git.attempt(['worktree', 'remove', '--force', path], { cwd: ctx.root });
          if (result.code !== 0) {
            // A pruned registration leaves the directory; clear it only when it is provably ours.
            if (!(await isLinkedWorktree(path, ctx.gitDir))) {
              throw gitFailure(['worktree', 'remove', '--force', path], result);
            }
            await rm(path, { recursive: true, force: true });
          }
          report.removed.worktrees.push(path);
        }
        if (entry.actions.includes('delete-branch') && entry.branch !== undefined) {
          const result = await git.attempt(['branch', '-D', entry.branch], { cwd: ctx.root });
          if (result.code !== 0) throw gitFailure(['branch', '-D', entry.branch], result);
          report.removed.branches.push(entry.branch);
        }
      } catch (err) {
        record(target, err);
      }
    }
  });

  return report;
}
