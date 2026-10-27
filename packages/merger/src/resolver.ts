/**
 * The conflict-resolver loop (ARCHITECTURE §4 step 4, `MergeResult.status === 'conflict'`).
 *
 * The merge queue gives up on a conflicted task branch. This service picks it up: it rebuilds the
 * conflict on a throwaway branch, commits the markers, hands the branch to a resolver agent through
 * the injected `ExecutionNode`, proves the result (no markers, suite green) and then asks the merge
 * queue to land it. It never merges into the integration branch itself.
 *
 * ```ts
 * const resolver = createConflictResolver({ node, prompts, workspace, merger });
 * const result = await resolver.resolve({
 *   run, integrationBranch: 'starling/9w0x1y/integration', taskA: task, taskB: sibling,
 *   conflict, prompt: host.promptContext(spec, task.branch!), model: modelFor(config, 'resolver'),
 *   testCommand: 'bun test',
 * });
 * if (!result.resolved) host.transition(task.taskKey, 'failed');
 * ```
 */
import {
  exec as coreExec,
  type MergeResult,
  type PromptContext,
  StarlingError,
  shortId,
  systemClock,
  type TaskHandle,
  type TaskRun,
} from '@starling/core';
import {
  type ConflictMergeOutcome,
  commitConflictedMerge,
  DEFAULT_HUNK_LINES,
  findConflictMarkers,
  resetBranch,
} from './conflict.ts';
import { createGit, type Git, tailText } from './git.ts';
import { DEFAULT_SESSION_TIMEOUT_MS, watchForIdle } from './idle.ts';
import type {
  ConflictResolver,
  ConflictResolverOptions,
  ResolveContext,
  ResolveResult,
  ResolverPromptCompiler,
  ResolverRepo,
} from './resolver-types.ts';
import { DEFAULT_TEST_TIMEOUT_MS, runSuite } from './suite.ts';
import type { ExecFn } from './types.ts';

/** The assignment's bound: one agent attempt, then one retry on a fresh copy of the conflict. */
export const DEFAULT_MAX_ATTEMPTS = 2;

/** Cap on one failure repeated in the retry prompt; the tail carries the useful part. */
const RETRY_DETAIL_CHARS = 600;

type FailureKind = 'session' | 'markers' | 'tests';

type AttemptOutcome = { ok: true; landed: MergeResult } | { ok: false; kind: FailureKind; detail: string };

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `tests-failed` and a red suite both mean "the resolution is not good enough"; markers mean conflict. */
function statusFor(kind: FailureKind): 'conflict' | 'tests-failed' {
  return kind === 'tests' ? 'tests-failed' : 'conflict';
}

function buildPromptContext(ctx: ResolveContext, branch: string, testCommand: string): PromptContext {
  return {
    ...ctx.prompt,
    branch,
    ...(testCommand.length > 0 ? { testCommand } : {}),
  };
}

/**
 * The resolver prompt for one attempt, plus what the previous attempt got wrong.
 *
 * The retry note lives here rather than in `@starling/prompts` because it describes this run's
 * attempt history, not the task; the compiler stays pure and reusable.
 */
function attemptPrompt(
  compiler: ResolverPromptCompiler,
  ctx: PromptContext,
  conflict: MergeResult,
  hunks: string[],
  attempt: number,
  maxAttempts: number,
  failures: string[],
): string {
  const base = compiler.resolver(ctx, conflict, { hunks });
  if (attempt === 1 || failures.length === 0) return base;

  const previous = failures
    .slice(-3)
    .map((failure) => `- ${tailText(failure, RETRY_DETAIL_CHARS)}`)
    .join('\n');
  return [
    base,
    '## Previous attempt did not land',
    previous,
    `The resolve branch was reset to the conflicted merge: the markers are back and nothing from that attempt is left. Fix the conflict for real this time — keep both behaviours and both sets of tests — and make the suite green. This is attempt ${attempt} of ${maxAttempts}.`,
  ].join('\n\n');
}

/**
 * Validate the engine's input before any branch or worktree is touched.
 *
 * These are programmer errors (the engine wired the wrong task or a stale merge result), so they
 * throw `INVALID_ARGUMENT` instead of burning two agent attempts on a question nobody can answer.
 */
function assertResolveInput(ctx: ResolveContext, taskKey: string, taskBranch: string): void {
  if (ctx.conflict.taskKey !== taskKey) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `The merge result is for task "${ctx.conflict.taskKey}" but taskA is "${taskKey}"`,
      { details: { conflictTask: ctx.conflict.taskKey, taskKey } },
    );
  }
  if (ctx.conflict.status !== 'conflict') {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `The resolver needs a conflict result, got "${ctx.conflict.status}"`,
      { details: { status: ctx.conflict.status } },
    );
  }
  if (taskBranch.length === 0) {
    throw new StarlingError('INVALID_ARGUMENT', `Task "${taskKey}" has no branch to resolve`, {
      details: { taskKey },
    });
  }
  if (ctx.prompt.task.key !== taskKey) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `The prompt context is for task "${ctx.prompt.task.key}" but taskA is "${taskKey}"`,
      { details: { promptTask: ctx.prompt.task.key, taskKey } },
    );
  }
  if (ctx.integrationBranch.trim().length === 0) {
    throw new StarlingError('INVALID_ARGUMENT', 'The resolver needs an integration branch');
  }
  if (ctx.run.goal.repoPath.trim().length === 0) {
    throw new StarlingError('INVALID_ARGUMENT', 'The run goal has no repoPath');
  }
}

export function createConflictResolver(options: ConflictResolverOptions): ConflictResolver {
  if (
    options.maxAttempts !== undefined &&
    (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1)
  ) {
    throw new StarlingError('INVALID_ARGUMENT', 'maxAttempts must be a positive integer', {
      details: { maxAttempts: options.maxAttempts },
    });
  }
  for (const [name, value] of [
    ['testTimeoutMs', options.testTimeoutMs],
    ['sessionTimeoutMs', options.sessionTimeoutMs],
    ['maxHunkLines', options.maxHunkLines],
  ] as const) {
    if (value !== undefined && value < 0) {
      throw new StarlingError('INVALID_ARGUMENT', `${name} cannot be negative`, {
        details: { [name]: value },
      });
    }
  }

  const clock = options.clock ?? systemClock;
  const execFn: ExecFn = options.exec ?? coreExec;
  const git: Git = createGit(execFn);
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const testTimeoutMs = options.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
  const sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  const maxHunkLines = options.maxHunkLines ?? DEFAULT_HUNK_LINES;
  // `PromptCompiler` (two args) is assignable here: the third argument is optional (see the type).
  const compiler: ResolverPromptCompiler = options.prompts;

  const branchFor = (runId: string, taskKey: string): string =>
    `starling/${shortId(runId)}/resolve-${taskKey}`;

  return {
    branchFor,

    async resolve(ctx: ResolveContext): Promise<ResolveResult> {
      const repo = ctx.run.goal.repoPath;
      const integration = ctx.integrationBranch.trim();
      const taskKey = ctx.taskA.taskKey;
      const taskBranch = (ctx.taskA.branch ?? '').trim();
      const resolveBranch = branchFor(ctx.run.id, taskKey);
      const testCommand = (ctx.testCommand ?? ctx.prompt.testCommand ?? '').trim();
      const promptCtx = buildPromptContext(ctx, resolveBranch, testCommand);

      assertResolveInput(ctx, taskKey, taskBranch);

      const sessions: string[] = [];
      const failures: string[] = [];
      const notes: string[] = [];
      const ts = (): number => clock.now();

      const removeWorktree = async (path: string, label: string): Promise<void> => {
        try {
          await options.workspace.remove(path);
        } catch (err) {
          notes.push(`could not remove the ${label} worktree at ${path}: ${messageOf(err)}`);
        }
      };

      const repoSpec = (ref: string): ResolverRepo => {
        if (options.bundleUrlFor === undefined) return { kind: 'local', path: repo };
        const { url, token } = options.bundleUrlFor(ref);
        return { kind: 'bundle', url, token };
      };

      /** Ask the merge queue to land the resolve branch; it runs the suite again on integration. */
      const land = (branch: string): Promise<MergeResult> => {
        const task: TaskRun = { ...ctx.taskA, branch, status: 'merging' };
        return options.merger.merge(repo, integration, task, testCommand.length > 0 ? { testCommand } : {});
      };

      /** No markers anywhere on the branch, and (when configured) a green suite on its own checkout. */
      const verify = async (attempt: number): Promise<AttemptOutcome> => {
        const markers = await findConflictMarkers(git, repo, resolveBranch);
        if (markers.length > 0) {
          const where = markers
            .slice(0, 5)
            .map((marker) => `${marker.path}:${marker.line}`)
            .join(', ');
          return {
            ok: false,
            kind: 'markers',
            detail: `attempt ${attempt}: ${markers.length} conflict marker(s) remain (${where}); the merge is not resolved`,
          };
        }
        if (testCommand.length === 0) return { ok: true, landed: await land(resolveBranch) };

        const scratch = await options.workspace.create(repo, resolveBranch, resolveBranch);
        let suite: { ok: boolean; detail: string };
        try {
          suite = await runSuite(execFn, scratch.path, testCommand, {
            timeoutMs: testTimeoutMs,
            taskKey,
          });
        } finally {
          await removeWorktree(scratch.path, 'verification');
        }
        if (!suite.ok) return { ok: false, kind: 'tests', detail: `attempt ${attempt}: ${suite.detail}` };
        return { ok: true, landed: await land(resolveBranch) };
      };

      const attemptOnce = async (attempt: number, prompt: string): Promise<AttemptOutcome> => {
        let handle: TaskHandle | undefined;
        try {
          handle = await options.node.startTask({
            runId: ctx.run.id,
            taskKey,
            title: `Resolve conflict: ${ctx.prompt.task.title}`,
            repo: repoSpec(resolveBranch),
            fromRef: resolveBranch,
            branch: resolveBranch,
            prompt,
            model: ctx.model,
          });
          sessions.push(handle.sessionId);
          const watch = watchForIdle(options.node, {
            runId: ctx.run.id,
            taskKey,
            timeoutMs: sessionTimeoutMs,
          });
          watch.attach(handle.sessionId);
          try {
            await watch.done;
          } finally {
            watch.stop();
          }
          await options.node.collect(handle, repo, integration);
        } catch (err) {
          return {
            ok: false,
            kind: 'session',
            detail: `attempt ${attempt}: the resolver session failed: ${messageOf(err)}`,
          };
        } finally {
          if (handle !== undefined) {
            try {
              await options.node.cleanup(handle);
            } catch (err) {
              notes.push(`node cleanup failed after attempt ${attempt}: ${messageOf(err)}`);
            }
          }
        }
        return verify(attempt);
      };

      // ── 1. Rebuild the conflict on the resolve branch and commit the markers. ──────────────────
      const sibling = ctx.taskB === undefined ? '' : ` with ${ctx.taskB.taskKey}`;
      const markerMessage = `merge(${taskKey}): conflict${sibling} left in place for the resolver`;

      let prepared: ConflictMergeOutcome;
      const conflictWorktree = await options.workspace.create(repo, resolveBranch, integration);
      try {
        prepared = await commitConflictedMerge({
          git,
          worktreePath: conflictWorktree.path,
          taskBranch,
          message: markerMessage,
          hunkOptions: { maxHunkLines },
        });
      } finally {
        await removeWorktree(conflictWorktree.path, 'conflict');
      }

      // ── 2. The conflict no longer reproduces: nothing for an agent to do, just land it. ────────
      if (prepared.clean) {
        const landed = await land(resolveBranch);
        return {
          ...landed,
          attempts: 0,
          resolveBranch,
          resolved: landed.status === 'merged' || landed.status === 'skipped',
          sessions,
          failures,
          notes,
        };
      }

      // ── 3. Up to `maxAttempts` resolver sessions, each starting from the marker commit. ────────
      let lastStatus: 'conflict' | 'tests-failed' = 'conflict';
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (attempt > 1) await resetBranch(git, repo, resolveBranch, prepared.commit);

        const prompt = attemptPrompt(
          compiler,
          promptCtx,
          ctx.conflict,
          prepared.hunks,
          attempt,
          maxAttempts,
          failures,
        );
        const outcome = await attemptOnce(attempt, prompt);

        if (outcome.ok) {
          const landed = outcome.landed;
          if (landed.status === 'merged' || landed.status === 'skipped') {
            return {
              ...landed,
              attempts: attempt,
              resolveBranch,
              resolved: true,
              sessions,
              failures,
              notes,
            };
          }
          lastStatus = landed.status === 'tests-failed' ? 'tests-failed' : 'conflict';
          failures.push(`attempt ${attempt}: the merge queue refused the resolution: ${landed.detail}`);
          continue;
        }

        lastStatus = statusFor(outcome.kind);
        failures.push(outcome.detail);
      }

      return {
        taskKey,
        status: lastStatus,
        conflictedFiles: ctx.conflict.conflictedFiles,
        detail: `Gave up resolving "${taskKey}" after ${maxAttempts} attempt(s): ${failures[failures.length - 1] ?? 'no attempt produced a usable branch'}`,
        ts: ts(),
        attempts: maxAttempts,
        resolveBranch,
        resolved: false,
        sessions,
        failures,
        notes,
      };
    },
  };
}
