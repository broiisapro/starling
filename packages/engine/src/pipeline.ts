/**
 * The per-task lifecycle after a session goes idle: collect → audit → merge → fix.
 *
 * Kept apart from `RunDriver` so the orchestration loop and the task pipeline can be read (and
 * changed) independently. `PipelineHost` is the narrow slice of the driver this needs; everything
 * else — ports, config, integration branch — is injected directly.
 */

import type {
  AuditVerdict,
  ExecutionNode,
  MergeResult,
  PromptContext,
  Run,
  StarlingConfig,
  StarlingEvent,
  TaskHandle,
  TaskResult,
  TaskRun,
  TaskSpec,
  TaskStatus,
} from '@starling/core';
import { modelFor } from '@starling/core';
import type { LiveTask } from './live-task';
import type { EngineDeps } from './types';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** What the pipeline needs from the driver. Deliberately small and behaviour-oriented. */
export interface PipelineHost {
  readonly run: Run;
  readonly config: StarlingConfig;
  readonly integrationBranch: string;
  readonly isDone: boolean;
  readonly isStopped: boolean;
  now(): number;
  transition(taskKey: string, to: TaskStatus, patch?: Partial<TaskRun>): boolean;
  publish(event: StarlingEvent): void;
  save(): void;
  log(level: LogLevel, msg: string, taskKey?: string): void;
  touchMetrics(): void;
  promptContext(spec: TaskSpec, branch: string): PromptContext;
  branchOf(taskKey: string): string;
  /** A node collected a commit for this task: remember it so a perch loss does not discard the work. */
  recordCollect(taskKey: string, commit: string): void;
  /** Remember the prompt that is currently in flight, so a stall resends exactly that one. */
  recordPrompt(taskKey: string, prompt: string): void;
  /** The node released this task's worktree; stop treating the path as removable. */
  clearWorktree(taskKey: string): void;
  enqueue(live: LiveTask, generation: number, step: () => Promise<void>): void;
  onStepError(live: LiveTask, generation: number, err: unknown, phase: string): void;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class TaskPipeline {
  readonly #deps: EngineDeps;
  readonly #integrationBranch: string;
  readonly #host: PipelineHost;

  constructor(deps: EngineDeps, integrationBranch: string, host: PipelineHost) {
    this.#deps = deps;
    this.#integrationBranch = integrationBranch;
    this.#host = host;
  }

  /** Entry point: the agent has gone idle and its work is waiting to be collected. */
  async onIdle(live: LiveTask, generation: number): Promise<void> {
    if (this.#host.isDone || this.#host.isStopped || generation !== live.generation) return;
    const task = this.#host.run.tasks[live.key];
    if (task === undefined) return;
    if (task.status !== 'running' && task.status !== 'fixing') return;
    const node = live.node;
    const handle = live.handle;
    if (node === undefined || handle === undefined) {
      this.#host.log('warn', `session idle before its handle was registered for ${live.key}`, live.key);
      return;
    }
    await this.#auditThenMerge(live, generation, node, handle);
  }

  async #auditThenMerge(
    live: LiveTask,
    generation: number,
    node: ExecutionNode,
    handle: TaskHandle,
  ): Promise<void> {
    const key = live.key;
    if (!this.#host.transition(key, 'auditing')) return;
    const ctx = this.#host.promptContext(live.spec, this.#host.branchOf(key));

    let result: TaskResult;
    try {
      result = await node.collect(handle, this.#host.run.goal.repoPath, this.#integrationBranch);
    } catch (err) {
      this.#host.onStepError(live, generation, err, 'collect');
      return;
    }
    if (this.#stale(live, generation)) return;
    this.#host.recordCollect(key, result.commit);

    const task = this.#host.run.tasks[key];
    if (task === undefined) return;
    const attempt = task.attempts + 1;
    let verdict: AuditVerdict;
    try {
      verdict = await this.#deps.auditor.audit({
        ctx,
        run: structuredClone(task),
        diff: result.diff,
        changedFiles: result.changedFiles,
        attempt,
      });
    } catch (err) {
      if (this.#stale(live, generation)) return;
      this.#host.log('error', `auditor threw for ${key}: ${messageOf(err)}`, key);
      this.#host.transition(key, 'failed');
      return;
    }
    if (this.#stale(live, generation)) return;

    const fresh = this.#host.run.tasks[key];
    if (fresh === undefined) return;
    fresh.attempts = attempt;
    fresh.lastVerdict = verdict;
    this.#host.save();
    this.#host.publish({
      type: 'audit.verdict',
      runId: this.#host.run.id,
      ts: this.#host.now(),
      payload: verdict,
    });
    this.#host.touchMetrics();

    if (verdict.pass) {
      await this.#merge(live, generation, ctx);
      return;
    }
    if (attempt < this.#host.config.maxAttempts) {
      await this.#requestFix(live, generation, ctx, verdict);
      return;
    }
    this.#host.log('error', `${key} failed the audit after ${attempt} attempt(s)`, key);
    this.#host.transition(key, 'failed');
  }

  async #merge(live: LiveTask, generation: number, ctx: PromptContext): Promise<void> {
    const key = live.key;
    if (!this.#host.transition(key, 'merging')) return;
    const task = this.#host.run.tasks[key];
    if (task === undefined) return;

    let result: MergeResult;
    try {
      result = await this.#deps.merger.merge(
        this.#host.run.goal.repoPath,
        this.#integrationBranch,
        structuredClone(task),
        { testCommand: ctx.testCommand },
      );
    } catch (err) {
      if (this.#stale(live, generation)) return;
      this.#host.log('error', `merger threw for ${key}: ${messageOf(err)}`, key);
      this.#host.transition(key, 'failed');
      return;
    }
    if (this.#stale(live, generation)) return;
    this.#host.publish({ type: 'merge.result', runId: this.#host.run.id, ts: result.ts, payload: result });
    this.#host.touchMetrics();

    switch (result.status) {
      case 'merged':
      case 'skipped': {
        if (result.status === 'skipped') {
          this.#host.log('warn', `nothing to merge for ${key}: ${result.detail}`, key);
        }
        this.#host.transition(key, 'merged');
        const merged = this.#host.run.tasks[key];
        if (merged !== undefined) {
          try {
            await this.#deps.tracker.onMerged(this.#host.run, structuredClone(merged));
          } catch (err) {
            this.#host.log('warn', `Tracker.onMerged failed for ${key}: ${messageOf(err)}`, key);
          }
        }
        await this.#cleanup(live);
        return;
      }
      case 'conflict': {
        // ── RESOLVER HOOK (Epic 45) ────────────────────────────────────────────────────────────
        // Epic 45's PR was not on `main` when this epic finished, so `conflict` stays terminal.
        // When it lands, this is the only insertion point. The intended flow, matching the Epic 45
        // doc's `engine-hook.md` section and ARCHITECTURE §4:
        //
        //   const attempt = this.#host.run.tasks[key]?.attempts ?? 0;
        //   if (attempt < maxAttempts) {
        //     this.#host.transition(key, 'fixing');
        //     await node.sendPrompt(handle, this.#deps.prompts.resolver(ctx, result));
        //   } else {
        //     this.#host.transition(key, 'conflict');
        //   }
        //
        // The resolver reuses the live session (same node, same worktree); its next `session.idle`
        // re-enters `#auditThenMerge`, so no new state-machine edge is needed beyond the existing
        // `fixing → auditing`. Gate it on the same attempt budget so a resolver cannot loop.
        // ──────────────────────────────────────────────────────────────────────────────────────
        this.#host.transition(key, 'conflict');
        await this.#cleanup(live);
        return;
      }
      case 'tests-failed': {
        const attempt = this.#host.run.tasks[key]?.attempts ?? 0;
        if (attempt < this.#host.config.maxAttempts) {
          await this.#requestFix(live, generation, ctx, this.#mergeFailureVerdict(key, attempt, result));
        } else {
          this.#host.log(
            'error',
            `${key} still fails the integration tests after ${attempt} attempt(s)`,
            key,
          );
          this.#host.transition(key, 'failed');
          await this.#cleanup(live);
        }
        return;
      }
    }
  }

  async #requestFix(
    live: LiveTask,
    generation: number,
    ctx: PromptContext,
    verdict: AuditVerdict,
  ): Promise<void> {
    if (!this.#host.transition(live.key, 'fixing')) return;
    const node = live.node;
    const handle = live.handle;
    if (node === undefined || handle === undefined) {
      this.#host.log('warn', `cannot send a fix prompt for ${live.key}: no live session`, live.key);
      this.#host.transition(live.key, 'failed');
      return;
    }
    const prompt = this.#deps.prompts.fixer(ctx, verdict);
    this.#host.recordPrompt(live.key, prompt);
    try {
      await node.sendPrompt(handle, prompt);
    } catch (err) {
      this.#host.onStepError(live, generation, err, 'sendPrompt');
    }
  }

  /** The merge regression suite is an audit failure with merge evidence as its fix instructions. */
  #mergeFailureVerdict(taskKey: string, attempt: number, result: MergeResult): AuditVerdict {
    return {
      taskKey,
      attempt,
      pass: false,
      checks: [{ name: 'integration-tests', ok: false, detail: result.detail }],
      laneViolations: [],
      summary: `Merging into ${this.#integrationBranch} failed its tests.`,
      fixInstructions: `The merge regression suite failed: ${result.detail}\nFix the failure and make the suite green.`,
      model: modelFor(this.#host.config, 'auditor'),
      ts: this.#host.now(),
    };
  }

  async #cleanup(live: LiveTask): Promise<void> {
    const node = live.node;
    const handle = live.handle;
    live.handle = undefined;
    if (node === undefined || handle === undefined) return;
    try {
      await node.cleanup(handle);
      this.#host.clearWorktree(live.key);
    } catch (err) {
      this.#host.log('warn', `node cleanup failed for ${live.key}: ${messageOf(err)}`, live.key);
    }
  }

  #stale(live: LiveTask, generation: number): boolean {
    return generation !== live.generation || this.#host.isDone || this.#host.isStopped;
  }
}
