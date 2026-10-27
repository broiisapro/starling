import type {
  Clock,
  ExecutionNode,
  MergeResult,
  Merger,
  ModelRef,
  PromptCompiler,
  PromptContext,
  Run,
  StartTaskOptions,
  TaskRun,
  Workspace,
} from '@starling/core';
import type { ExecFn } from './types.ts';

/**
 * Additive extras the resolver hands to `prompts.resolver`.
 *
 * `PromptCompiler.resolver(ctx, conflict)` is LOCKED at two arguments, so the third one is
 * *optional*: `@starling/prompts` implements it, and a compiler that ignores it still type-checks
 * (a function with fewer parameters is assignable to this shape).
 */
export interface ResolverPromptExtras {
  hunks?: string[];
}

export interface ResolverPromptCompiler extends PromptCompiler {
  resolver(ctx: PromptContext, conflict: MergeResult, extras?: ResolverPromptExtras): string;
}

export interface ConflictResolverOptions {
  /** Where the resolver session runs. `LocalNode`/`RemoteNode` both work; see `bundleUrlFor`. */
  node: ExecutionNode;
  /** The prompt compiler. `createPromptCompiler()` in `@starling/prompts` understands the extras. */
  prompts: PromptCompiler;
  /** Worktrees: the conflicted merge, then a scratch checkout for the suite. */
  workspace: Workspace;
  /** The merge queue. The resolver never lands a branch itself. */
  merger: Merger;
  clock?: Clock;
  /** Injectable git runner (defaults to core's real `exec`), so tests can fake process spawns. */
  exec?: ExecFn;
  /** Agent attempts before giving up. Default 2 (the assignment's bound). */
  maxAttempts?: number;
  /** Suite timeout per verification. Default 10 minutes, same as the merge queue. */
  testTimeoutMs?: number;
  /** Idle watchdog per session. Default 20 minutes. 0 disables it. */
  sessionTimeoutMs?: number;
  /** Lines kept from each side of a hunk in the prompt. Default 8. */
  maxHunkLines?: number;
  /**
   * How to reach this run's repo from a remote perch. Without it the node is handed a local repo
   * path (`{ kind: 'local', path }`), which is right for the hub and for a `LocalNode`.
   */
  bundleUrlFor?: (ref: string) => { url: string; token: string };
}

export interface ResolveContext {
  run: Run;
  /** The branch the conflicted task could not merge into. */
  integrationBranch: string;
  /** The task whose merge conflicted (`conflict.taskKey` must match). */
  taskA: TaskRun;
  /** The already-landed sibling, when the engine knows which one. Context for prompts and history. */
  taskB?: TaskRun;
  conflict: MergeResult;
  /**
   * The engine's prompt context for the task. The resolver overrides `branch` with the resolve
   * branch and sends the third `hunks` argument; goal, plan, map and task spec are reused as-is.
   */
  prompt: PromptContext;
  /** The `resolver` model role from config (`modelFor(config, 'resolver')`). */
  model: ModelRef;
  /** Overrides `prompt.testCommand`. `auto`/empty means "no suite": verification is skipped. */
  testCommand?: string;
}

/**
 * A `MergeResult` plus resolver bookkeeping.
 *
 * `status` never leaves core's LOCKED enum. Exhausting every attempt is reported as the last
 * attempt's honest status (`conflict` when the markers/merge survived, `tests-failed` when the suite
 * stayed red) with `resolved: false`; the engine's hook maps that to `TaskStatus = 'failed'`.
 */
export interface ResolveResult extends MergeResult {
  /** Agent attempts that actually ran. 0 when the conflict no longer reproduced. */
  attempts: number;
  /** `starling/<runShort>/resolve-<taskKey>`. Kept after a give-up so a human can inspect it. */
  resolveBranch: string;
  /** False means the engine must fail the task; `detail` and `failure` say why. */
  resolved: boolean;
  /** Session ids per attempt, in order (for the dashboard and the event log). */
  sessions: string[];
  /** Why each failed attempt did not land, oldest first. */
  failures: string[];
  /** Non-fatal problems (a node cleanup that failed, a hunk that could not be read…). */
  notes: string[];
}

export interface ConflictResolver {
  resolve(ctx: ResolveContext): Promise<ResolveResult>;
  /** The branch name this resolver uses, without side effects. */
  branchFor(runId: string, taskKey: string): string;
}

/** The repo spec handed to `ExecutionNode.startTask`. */
export type ResolverRepo = StartTaskOptions['repo'];
