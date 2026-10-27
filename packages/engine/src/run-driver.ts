/**
 * One run's orchestration state machine: map → plan → dispatch → audit → fix → merge → finish.
 *
 * ARCHITECTURE §4 is implemented literally here. The driver only talks to ports (all injected), so
 * every behaviour is reproducible with the doubles in `@starling/core/testing`.
 */

import type {
  AgentEvent,
  ExecutionNode,
  Goal,
  ModelRef,
  NodeInfo,
  PromptContext,
  RepoMap,
  Run,
  RunStatus,
  StarlingConfig,
  StarlingEvent,
  StartTaskOptions,
  TaskRun,
  TaskSpec,
  TaskStatus,
} from '@starling/core';
import {
  addUsage,
  emptyMetrics,
  isStarlingError,
  modelFor,
  newId,
  StarlingError,
  shortId,
  usageCostUsd,
} from '@starling/core';
import { isLocalProvider, parseModel, parseUsage, pricingKey } from './agent-event';
import type { StartRunInput } from './handshake';
import type { LiveTask } from './live-task';
import {
  computeRunMetrics,
  emptyLedger,
  MetricsPublisher,
  recordCall,
  systemTimers,
  type UsageLedger,
} from './metrics';
import { availableSlots, dispatchableNodes } from './nodes';
import { type PipelineHost, TaskPipeline } from './pipeline';
import { BudgetGuard } from './policies/budget';
import { type LogLevel, type PolicyCode, policyLogPayload, policyMessage } from './policies/log';
import { AimdLimit } from './policies/parallelism';
import { rateLimitSignal } from './policies/rate-limit';
import { type StallDecision, StallWatchdog, stallAfterMsFrom, stallDecision } from './policies/stall';
import { fromRefFor, nodeNamePatch, runStatusEvent } from './run-status';
import {
  activeByNode,
  activeCount,
  allTasksTerminal,
  countStatus,
  createTaskRuns,
  dependentsToCancel,
  promotableTaskKeys,
  unfinishedTaskKeys,
} from './state';
import { renderRunSummary, type SummaryOptions, writerPrompt } from './summary';
import { assertTaskTransition, isTerminalStatus } from './transitions';
import type { EngineDeps } from './types';

const WRITER_SYSTEM =
  'You write a terse, factual release note for a coding run. One short paragraph, plain text.';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `--budget` reaches the engine as an additive `StartRunInput` field until Epic 40 wires core. */
function inputBudgetUsd(input: StartRunInput): number | undefined {
  const value = (input as unknown as Record<string, unknown>).budgetUsd;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** A node may report its worktree on the handle; the locked `TaskHandle` does not have the field. */
function handleWorktreePath(handle: { worktreePath?: unknown }): string | undefined {
  const value = handle.worktreePath;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export class RunDriver implements PipelineHost {
  readonly runId: string;
  readonly done: Promise<Run>;
  readonly #deps: EngineDeps;
  readonly #input: StartRunInput;
  readonly #run: Run;
  readonly #strict: boolean;
  readonly #maxParallel: number;
  readonly #runShort: string;
  readonly #integrationBranchName: string;
  readonly #ledger: UsageLedger = emptyLedger();
  readonly #live = new Map<string, LiveTask>();
  readonly #unsubs = new Map<string, () => void>();
  readonly #offline = new Set<string>();
  readonly #noBundle = new Set<string>();
  /** Model announced by `session.started`, used to classify usage events that omit it. */
  readonly #sessionModels = new Map<string, ModelRef>();
  readonly #publisher: MetricsPublisher;
  readonly #pipeline: TaskPipeline;
  readonly #parallelism: AimdLimit;
  readonly #budget: BudgetGuard;
  readonly #watchdog: StallWatchdog | undefined;
  readonly #stallAfterMs: number;
  readonly #maxStallRetries: number;
  #resolveDone!: (run: Run) => void;
  #map?: RepoMap;
  #unsubRegistry?: () => void;
  #pumping = false;
  #finishScheduled = false;
  #finishing = false;
  #done = false;
  #stopped = false;
  #cancelled = false;
  #cancelling = false;
  /** Tasks that never got a session because the budget cap was reached. */
  readonly #budgetSkipped = new Set<string>();

  constructor(deps: EngineDeps, input: StartRunInput) {
    this.#deps = deps;
    this.#input = input;
    this.runId = newId();
    this.#runShort = shortId(this.runId);
    this.#strict = deps.strictTransitions ?? process.env.NODE_ENV === 'test';
    this.#maxParallel = Math.max(1, input.maxParallel ?? deps.config.maxParallel);
    this.#integrationBranchName =
      deps.config.integrationBranch === 'auto'
        ? `starling/${this.#runShort}/integration`
        : deps.config.integrationBranch;

    const policies = deps.policies ?? {};
    this.#stallAfterMs = policies.stallAfterMs ?? stallAfterMsFrom(deps.config);
    this.#maxStallRetries = Math.max(0, policies.maxStallRetries ?? 1);
    this.#budget = new BudgetGuard({
      maxUsd: inputBudgetUsd(input) ?? policies.budgetUsd ?? deps.config.budget.maxUsd,
      ...(policies.budgetWarnRatio === undefined ? {} : { warnRatio: policies.budgetWarnRatio }),
    });
    this.#parallelism = new AimdLimit({
      max: this.#maxParallel,
      now: () => deps.clock.now(),
      ...(policies.rateLimitRecoverMs === undefined ? {} : { recoverAfterMs: policies.rateLimitRecoverMs }),
    });
    this.#watchdog =
      this.#stallAfterMs > 0
        ? new StallWatchdog({
            stallAfterMs: this.#stallAfterMs,
            timers: deps.timers ?? systemTimers,
            onStall: (key) => this.#onStall(key),
          })
        : undefined;

    const goal: Goal = {
      id: newId(),
      text: input.goal,
      repoPath: input.repoPath,
      baseBranch: input.baseBranch ?? deps.config.baseBranch,
      createdAt: deps.clock.now(),
      constraints: [],
    };
    this.#run = {
      id: this.runId,
      goal,
      tasks: {},
      status: 'mapping',
      startedAt: deps.clock.now(),
      metrics: emptyMetrics(),
    };
    this.done = new Promise<Run>((resolve) => {
      this.#resolveDone = resolve;
    });
    this.#publisher = new MetricsPublisher({
      clock: deps.clock,
      compute: () => computeRunMetrics(this.#run, this.#ledger, deps.clock.now()),
      publish: (metrics) => {
        this.#run.metrics = metrics;
        this.save();
        this.publish({
          type: 'metrics',
          runId: this.runId,
          ts: this.now(),
          payload: metrics,
        });
      },
      timers: deps.timers,
    });
    this.#pipeline = new TaskPipeline(deps, this.#integrationBranchName, this);
  }

  // ── PipelineHost: the narrow surface the task pipeline may touch ────────────────────────────

  get run(): Run {
    return this.#run;
  }

  get config(): StarlingConfig {
    return this.#deps.config;
  }

  get integrationBranch(): string {
    return this.#integrationBranchName;
  }

  get isDone(): boolean {
    return this.#done;
  }

  get isStopped(): boolean {
    return this.#stopped;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────────────────────────

  async begin(): Promise<void> {
    this.save();
    this.publish({
      type: 'run.created',
      runId: this.runId,
      ts: this.now(),
      payload: { run: this.#snapshot() },
    });
    this.touchMetrics();
    this.#unsubRegistry = this.#deps.registry.onChange((event) => {
      this.#onRegistryChange(event);
    });
    this.#publisher.start();
    try {
      await this.#mapAndPlan();
    } catch (err) {
      this.#failRun(err);
    }
  }

  async cancel(): Promise<void> {
    if (this.#done) return;
    if (this.#cancelling) {
      // A second Ctrl-C: the presenter wants out now. Keep the store consistent, skip the graceful
      // filesystem cleanup that may be blocked, and let the CLI force-exit if this still hangs.
      this.logPolicy('cancel.forced', 'warn', 'Second cancellation: skipping graceful cleanup.');
      for (const key of unfinishedTaskKeys(this.#run)) this.transition(key, 'cancelled');
      await this.#maybeFinish();
      return;
    }
    this.#cancelling = true;
    this.#cancelled = true;
    this.#stopped = true;
    this.log('warn', 'Cancellation requested: aborting every active session.');
    for (const live of [...this.#live.values()]) {
      live.generation += 1;
      const node = live.node;
      const handle = live.handle;
      live.handle = undefined;
      if (node === undefined || handle === undefined) continue;
      try {
        await node.abort(handle);
      } catch (err) {
        this.log('debug', `abort failed on ${node.id}: ${messageOf(err)}`, live.key);
      }
      // Abort stops the agent; cleanup releases the worktree but leaves the branch in the repo.
      try {
        await node.cleanup(handle);
      } catch (err) {
        this.log('debug', `cleanup failed on ${node.id}: ${messageOf(err)}`, live.key);
      }
    }
    const before = unfinishedTaskKeys(this.#run);
    const removed = await this.#removeWorktrees(before);
    for (const key of before) this.transition(key, 'cancelled');
    this.logPolicy(
      'cancel.cleanup',
      'info',
      `Cancelled the run: aborted every session, removed ${removed} worktree(s), kept every branch.`,
    );
    await this.#maybeFinish();
  }

  /** Best-effort worktree removal for the given tasks. Branches are never touched. */
  async #removeWorktrees(taskKeys: readonly string[]): Promise<number> {
    const removed = new Set<string>();
    for (const key of taskKeys) {
      const task = this.#run.tasks[key];
      if (task === undefined || isTerminalStatus(task.status)) continue;
      const path = task.worktreePath ?? this.#expectedWorktree(task.branch);
      if (path === undefined || removed.has(path)) continue;
      removed.add(path);
      try {
        await this.#deps.workspace.remove(path);
        task.worktreePath = undefined;
        this.save();
      } catch (err) {
        this.log('warn', `could not remove worktree ${path}: ${messageOf(err)}`, key);
      }
    }
    return removed.size;
  }

  #expectedWorktree(branch: string | undefined): string | undefined {
    if (branch === undefined) return undefined;
    return this.#deps.worktreePathFor?.(branch);
  }

  async abortTask(taskKey: string): Promise<void> {
    const task = this.#run.tasks[taskKey];
    if (task === undefined) {
      throw new StarlingError('INVALID_ARGUMENT', `Cannot abort unknown task "${taskKey}"`, {
        details: { runId: this.runId, taskKey },
      });
    }
    if (this.#done) return;
    if (isTerminalStatus(task.status)) return;
    const live = this.#live.get(taskKey);
    if (live !== undefined) {
      live.generation += 1;
      const node = live.node;
      const handle = live.handle;
      live.handle = undefined;
      if (node !== undefined && handle !== undefined) {
        try {
          await node.abort(handle);
        } catch (err) {
          this.log('debug', `abort failed on ${node.id}: ${messageOf(err)}`, taskKey);
        }
      }
    }
    this.transition(taskKey, 'cancelled');
    this.#scheduleFinishCheck();
  }

  // ── map + plan ───────────────────────────────────────────────────────────────────────────────

  async #mapAndPlan(): Promise<void> {
    const map = await this.#deps.repoMapper.map(this.#run.goal.repoPath);
    this.#map = map;
    this.publish({
      type: 'repomap.ready',
      runId: this.runId,
      ts: this.now(),
      payload: { files: map.files.length, tokenEstimate: map.tokenEstimate },
    });
    this.touchMetrics();

    this.#setRunStatus('planning');
    const { plan, issues } = await this.#deps.planner.plan(this.#run.goal, map);
    this.#run.plan = plan;
    this.#run.tasks = createTaskRuns(this.runId, plan);
    this.#setRunStatus('planned');
    this.publish({
      type: 'plan.created',
      runId: this.runId,
      ts: this.now(),
      payload: { plan, issues },
    });
    this.touchMetrics();

    if (this.#input.dryRun === true) {
      this.log('info', `Dry run: ${plan.tasks.length} task(s) planned; nothing dispatched.`);
      this.#completePlanned();
      return;
    }
    if (this.#stopped) {
      // Cancellation arrived while the mapper/planner was thinking: the plan exists now, so close
      // the run out instead of leaving freshly-created pending tasks with no dispatcher.
      for (const key of unfinishedTaskKeys(this.#run)) this.transition(key, 'cancelled');
      await this.#maybeFinish();
      return;
    }
    const blocking = issues.filter((issue) => issue.severity === 'error');
    if (blocking.length > 0) {
      const first = blocking[0];
      throw new StarlingError(
        'PLAN_INVALID',
        `Plan has ${blocking.length} error-level issue(s); refusing to dispatch. ${first?.message ?? ''}`.trim(),
        { details: { codes: blocking.map((issue) => issue.code) } },
      );
    }

    this.#run.integrationBranch = this.#integrationBranchName;
    await this.#deps.workspace.ensureIntegrationBranch(
      this.#run.goal.repoPath,
      this.#run.goal.baseBranch,
      this.#integrationBranchName,
    );
    await this.#syncTracker();
    this.#setRunStatus('running');
    this.#publishMetricsNow();
    this.#pump();
  }

  async #syncTracker(): Promise<void> {
    try {
      const issueNumbers = await this.#deps.tracker.syncPlan(this.#run);
      for (const [key, issueNumber] of Object.entries(issueNumbers)) {
        const task = this.#run.tasks[key];
        if (task !== undefined) task.issueNumber = issueNumber;
      }
      this.save();
    } catch (err) {
      this.log('warn', `Tracker.syncPlan failed; continuing without issue links: ${messageOf(err)}`);
    }
  }

  #completePlanned(): void {
    this.#done = true;
    this.#run.metrics = computeRunMetrics(this.#run, this.#ledger, this.now());
    this.save();
    this.#publishMetricsNow();
    this.#dispose();
    this.#resolveDone(this.#snapshot());
  }

  // ── dispatch ─────────────────────────────────────────────────────────────────────────────────

  #pump(): void {
    if (this.#pumping || this.#done || this.#stopped) return;
    if (this.#run.status !== 'running') return;
    const plan = this.#run.plan;
    if (plan === undefined) return;
    this.#pumping = true;
    try {
      for (const key of promotableTaskKeys(this.#run)) this.transition(key, 'ready');

      for (const spec of plan.tasks) {
        if (this.#done || this.#stopped) return;
        const task = this.#run.tasks[spec.key];
        if (task === undefined || task.status !== 'ready') continue;
        // AIMD: a rate-limited provider temporarily shrinks the effective parallelism.
        if (activeCount(this.#run) >= Math.min(this.#maxParallel, this.#parallelism.limit)) return;
        if (this.#budgetExhausted()) return;
        const nodes = this.#nodesForDispatch();
        if (nodes.length === 0) return;
        if (availableSlots(nodes, activeByNode(this.#run)) <= 0) return;
        const nodeId = this.#deps.scheduler.pick(nodes, spec);
        if (nodeId === undefined) return;
        const info = nodes.find((node) => node.id === nodeId);
        const node = this.#deps.registry.get(nodeId);
        if (info === undefined || node === undefined) {
          // A scheduler must answer with an id from the list it was given. Fail the task loudly
          // rather than leave it `ready` forever, which would wedge the whole run.
          this.log(
            'error',
            `Scheduler picked node "${nodeId}" outside the dispatchable set; failing ${spec.key}`,
            spec.key,
          );
          this.transition(spec.key, 'failed');
          continue;
        }
        this.#dispatch(spec, info, node);
      }
    } finally {
      this.#pumping = false;
      this.#scheduleFinishCheck();
    }
  }

  #nodesForDispatch(): NodeInfo[] {
    const nodes = dispatchableNodes(this.#deps.registry.list(), activeByNode(this.#run), this.#offline);
    const usable: NodeInfo[] = [];
    for (const node of nodes) {
      if (node.kind === 'remote' && this.#deps.bundleUrlFor === undefined) {
        if (!this.#noBundle.has(node.id)) {
          this.#noBundle.add(node.id);
          this.log('warn', `Remote node "${node.id}" ignored: no bundleUrlFor configured for this hub.`);
        }
        continue;
      }
      usable.push(node);
    }
    return usable;
  }

  #dispatch(spec: TaskSpec, info: NodeInfo, node: ExecutionNode): void {
    const branch = `starling/${this.#runShort}/${spec.key}`;
    const existing = this.#run.tasks[spec.key];
    const live = this.#liveFor(spec.key, spec);
    const patch: Partial<TaskRun> & { nodeName: string } = {
      branch,
      nodeId: node.id,
      startedAt: existing?.startedAt ?? this.now(),
      ...nodeNamePatch(info),
    };
    if (!this.transition(spec.key, 'running', patch)) {
      return;
    }
    live.generation += 1;
    const generation = live.generation;
    live.node = node;
    live.nodeId = node.id;
    live.handle = undefined;
    this.#ensureSubscribed(node);

    if (live.migrationFrom !== undefined && live.migrationFrom !== node.id) {
      this.publish({
        type: 'task.migrated',
        runId: this.runId,
        ts: this.now(),
        payload: {
          taskKey: spec.key,
          fromNode: live.migrationFrom,
          toNode: node.id,
          reason: live.migrationReason ?? 'rescheduled',
        },
      });
    }
    live.migrationFrom = undefined;
    live.migrationReason = undefined;

    // A task whose perch vanished after a collect resumes from its own branch, so the commit that
    // was already imported into the hub is kept instead of redone.
    const fromRef = fromRefFor({ commit: live.lastCommit, branch }, this.#integrationBranchName);
    if (live.lastCommit !== undefined) {
      this.logPolicy(
        'perch.resume',
        'info',
        `${spec.key} resumes from ${branch} at ${live.lastCommit.slice(0, 12)}.`,
        spec.key,
      );
    }

    const options = this.#startOptions(spec, info, branch, fromRef);
    live.prompt = options.prompt;
    this.enqueue(live, generation, async () => {
      try {
        const handle = await node.startTask(options);
        if (generation !== live.generation) return;
        live.handle = handle;
        const task = this.#run.tasks[spec.key];
        if (task !== undefined) {
          task.sessionId = handle.sessionId;
          const worktreePath = handleWorktreePath(handle as { worktreePath?: unknown });
          if (worktreePath !== undefined) task.worktreePath = worktreePath;
          this.save();
        }
      } catch (err) {
        this.onStepError(live, generation, err, 'startTask');
      }
    });
  }

  #startOptions(spec: TaskSpec, info: NodeInfo, branch: string, fromRef: string): StartTaskOptions {
    const repo =
      info.kind === 'local'
        ? ({ kind: 'local', path: this.#run.goal.repoPath } as const)
        : this.#bundleRepo(fromRef);
    return {
      runId: this.runId,
      taskKey: spec.key,
      title: spec.title,
      repo,
      fromRef,
      branch,
      prompt: this.#deps.prompts.worker(this.promptContext(spec, branch)),
      model: modelFor(this.#deps.config, 'worker'),
    };
  }

  #bundleRepo(ref: string): { kind: 'bundle'; url: string; token: string } {
    const bundleUrlFor = this.#deps.bundleUrlFor;
    if (bundleUrlFor === undefined) {
      throw new StarlingError('INVALID_ARGUMENT', 'No bundleUrlFor configured for a remote node');
    }
    const { url, token } = bundleUrlFor(ref);
    return { kind: 'bundle', url, token };
  }

  promptContext(spec: TaskSpec, branch: string): PromptContext {
    const plan = this.#run.plan;
    if (plan === undefined)
      throw new StarlingError('INVALID_ARGUMENT', 'Prompt context before the plan exists');
    const configured = this.#deps.config.testCommand;
    return {
      goal: this.#run.goal,
      plan,
      map: this.#map ?? {
        root: this.#run.goal.repoPath,
        tree: '',
        files: [],
        languages: {},
        tokenEstimate: 0,
        createdAt: this.now(),
      },
      task: spec,
      branch,
      testCommand: this.#map?.testCommand ?? (configured === 'auto' ? undefined : configured),
    };
  }

  #ensureSubscribed(node: ExecutionNode): void {
    if (this.#unsubs.has(node.id)) return;
    this.#unsubs.set(
      node.id,
      node.onEvent((event) => {
        if (event.runId === this.runId) this.#onAgentEvent(event);
      }),
    );
  }

  // ── agent events ─────────────────────────────────────────────────────────────────────────────

  #onAgentEvent(event: AgentEvent): void {
    if (this.#done) return;
    this.publish({ type: 'agent.event', runId: this.runId, ts: event.ts, payload: event });
    const task = this.#run.tasks[event.taskKey];
    if (task === undefined) return;

    if (event.kind === 'session.idle') {
      this.#watchdog?.untrack(event.taskKey);
    } else {
      // Any event is proof of life: push the stall deadline out.
      this.#watchdog?.touch(event.taskKey);
    }

    if (event.kind === 'usage') {
      this.#recordAgentUsage(task, event);
      return;
    }
    if (event.kind === 'session.started') {
      const announced = parseModel(event.data.model);
      if (announced !== undefined) this.#sessionModels.set(event.taskKey, announced);
      return;
    }
    if (event.kind === 'session.error') {
      this.log(
        'warn',
        `agent error on ${event.taskKey}: ${String(event.data.reason ?? 'unknown')}`,
        event.taskKey,
      );
      const signal = rateLimitSignal(event);
      if (signal !== undefined) this.#onRateLimit(event.taskKey, signal);
      return;
    }
    if (event.kind !== 'session.idle') return;
    const live = this.#live.get(event.taskKey);
    if (live === undefined) return;
    const generation = live.generation;
    this.enqueue(live, generation, () => this.#pipeline.onIdle(live, generation));
  }

  #recordAgentUsage(task: TaskRun, event: AgentEvent): void {
    const usage = parseUsage(event.data);
    if (usage === undefined) return;
    const model =
      parseModel(event.data.model) ??
      this.#sessionModels.get(task.taskKey) ??
      modelFor(this.#deps.config, 'worker');
    const local = isLocalProvider(this.#deps.config, model.provider);
    const priced = usageCostUsd(pricingKey(model), usage);
    const costUsd = local ? 0 : priced !== 0 ? priced : usageCostUsd(model.model, usage);
    task.usage = addUsage(task.usage, usage);
    task.costUsd += costUsd;
    recordCall(this.#ledger, { usage, model: pricingKey(model), local, costUsd });
    this.save();
    this.touchMetrics();
  }

  // ── flock: registry changes ──────────────────────────────────────────────────────────────────

  #onRegistryChange(event: { type: 'joined' | 'left' | 'stats'; node: NodeInfo }): void {
    if (this.#done) return;
    const node = event.node;
    if (event.type === 'left') {
      this.publish({
        type: 'node.left',
        runId: this.runId,
        ts: this.now(),
        payload: { nodeId: node.id, reason: 'left the flock' },
      });
      this.#offline.add(node.id);
      for (const live of [...this.#live.values()]) {
        if (live.nodeId !== node.id) continue;
        this.#requeueAfterLoss(live, node.id, `${node.id} went offline`);
      }
      this.#pump();
      this.#scheduleFinishCheck();
      return;
    }

    this.publish({
      type: event.type === 'joined' ? 'node.joined' : 'node.stats',
      runId: this.runId,
      ts: this.now(),
      payload: { node },
    });
    if (node.status === 'offline') this.#offline.add(node.id);
    else this.#offline.delete(node.id);
    this.#pump();
  }

  #requeueAfterLoss(live: LiveTask, nodeId: string, reason: string): void {
    const task = this.#run.tasks[live.key];
    if (task === undefined) return;
    if (task.status !== 'running' && task.status !== 'fixing' && task.status !== 'auditing') return;
    // Any pipeline step still in flight belongs to the dead session; invalidate it.
    live.generation += 1;
    live.handle = undefined;
    live.node = undefined;
    live.nodeId = undefined;
    live.migrationFrom = nodeId;
    live.migrationReason = reason;
    this.logPolicy(
      'perch.loss',
      'warn',
      `${live.key} will be rescheduled after ${reason}` +
        (live.lastCommit === undefined
          ? '; no commit had been collected yet'
          : `; keeping commit ${live.lastCommit.slice(0, 12)}`) +
        ` and its ${task.attempts} attempt(s).`,
      live.key,
    );
    // Attempts stay untouched (a migration must not burn the retry budget) and `lastCommit` stays
    // on the live task so the next dispatch can resume from the task branch.
    const patch: Partial<TaskRun> & { nodeName?: string } = {
      nodeId: undefined,
      sessionId: undefined,
      nodeName: undefined,
    };
    this.transition(live.key, 'ready', patch);
  }

  // ── policies: stall, rate limit, budget, run status ─────────────────────────────────────────

  #onRateLimit(taskKey: string, signal: { provider?: string; retryAfterMs?: number; detail: string }): void {
    const change = this.#parallelism.onRateLimit();
    this.logPolicy(
      'rate-limit.backoff',
      'warn',
      `provider ${signal.provider ?? 'unknown'} rate limited ${taskKey}: ${signal.detail}` +
        (signal.retryAfterMs === undefined ? '' : `; retry after ${signal.retryAfterMs} ms`),
      taskKey,
    );
    if (change !== undefined) {
      this.logPolicy(
        'parallelism.reduced',
        'warn',
        `effective parallelism ${change.from} → ${change.to} (${change.reason}).`,
      );
    }
  }

  /** The watchdog fired: no agent event for `stallAfterMs`. */
  #onStall(taskKey: string): void {
    if (this.#done || this.#stopped) return;
    const task = this.#run.tasks[taskKey];
    const live = this.#live.get(taskKey);
    if (task === undefined || live === undefined) return;
    if (task.status !== 'running' && task.status !== 'fixing') return;

    const decision: StallDecision = stallDecision({
      stallRetries: live.stallRetries,
      attempts: task.attempts,
      maxAttempts: this.#deps.config.maxAttempts,
      maxStallRetries: this.#maxStallRetries,
    });
    const seconds = Math.round(this.#stallAfterMs / 1000);

    if (decision === 'fail') {
      this.logPolicy(
        'stall.failed',
        'error',
        `${taskKey} produced no agent event for ${seconds}s and has no recovery left; failing it.`,
        taskKey,
      );
      const node = live.node;
      const handle = live.handle;
      live.handle = undefined;
      live.generation += 1;
      if (node !== undefined && handle !== undefined) {
        void node.abort(handle).catch((err) => {
          this.log('debug', `abort after stall failed on ${node.id}: ${messageOf(err)}`, taskKey);
        });
      }
      this.transition(taskKey, 'failed');
      return;
    }

    this.logPolicy(
      'stall.detected',
      'warn',
      `${taskKey} produced no agent event for ${seconds}s; aborting the turn and resending the prompt.`,
      taskKey,
    );
    live.stallRetries += 1;
    // A recovery spends an attempt, so a stalled session cannot out-live the audit budget.
    task.attempts += 1;
    this.save();
    live.generation += 1;
    const generation = live.generation;
    this.#watchdog?.untrack(taskKey);
    this.enqueue(live, generation, () => this.#resendAfterStall(live, generation));
  }

  async #resendAfterStall(live: LiveTask, generation: number): Promise<void> {
    if (this.#done || this.#stopped || generation !== live.generation) return;
    const node = live.node;
    const handle = live.handle;
    const prompt =
      live.prompt ?? this.#deps.prompts.worker(this.promptContext(live.spec, this.branchOf(live.key)));

    if (node !== undefined && handle !== undefined) {
      try {
        await node.abort(handle);
      } catch (err) {
        this.log('debug', `abort after stall failed on ${node.id}: ${messageOf(err)}`, live.key);
      }
      if (generation !== live.generation) return;
      try {
        await node.sendPrompt(handle, prompt);
        const attempts = this.#run.tasks[live.key]?.attempts ?? 0;
        this.logPolicy(
          'stall.retry',
          'warn',
          `${live.key} resumed after a stall on the same session (attempt ${attempts}).`,
          live.key,
        );
        this.#watchdog?.track(live.key);
        this.touchMetrics();
        return;
      } catch (err) {
        this.logPolicy(
          'stall.redispatch',
          'warn',
          `could not resend to the stalled session (${messageOf(err)}); starting a fresh one.`,
          live.key,
        );
      }
    }

    // No live session (or the resend was rejected): go back through the queue with a fresh session.
    live.handle = undefined;
    live.generation += 1;
    if (this.transition(live.key, 'ready')) this.#pump();
  }

  #setRunStatus(status: RunStatus): void {
    const from = this.#run.status;
    this.#run.status = status;
    this.save();
    if (from === status) return;
    this.touchMetrics();
    const event = runStatusEvent(this.runId, this.now(), from, this.#snapshot());
    if (event !== undefined) this.publish(event);
  }

  /** A model call landed: let AIMD grow the cap back when the provider has been quiet. */
  #onProgress(): void {
    const change = this.#parallelism.onProgress();
    if (change === undefined) return;
    this.logPolicy(
      'parallelism.increased',
      'info',
      `effective parallelism ${change.from} → ${change.to} (${change.reason}).`,
    );
  }

  recordCollect(taskKey: string, commit: string): void {
    const live = this.#live.get(taskKey);
    if (live === undefined) return;
    live.lastCommit = commit;
  }

  logPolicy(code: PolicyCode, level: LogLevel, msg: string, taskKey?: string): void {
    const payload = policyLogPayload(code, level, policyMessage(code, msg), taskKey);
    // `code` is additive: core's log payload is frozen until Epic 40 lands the field (FIX REQUEST).
    this.publish({ type: 'log', runId: this.runId, ts: this.now(), payload } as StarlingEvent);
  }

  // ── transitions and events ───────────────────────────────────────────────────────────────────

  transition(key: string, to: TaskStatus, patch: Partial<TaskRun> = {}): boolean {
    if (this.#done) return false;
    const task = this.#run.tasks[key];
    if (task === undefined) {
      this.log('error', `transition requested for unknown task "${key}"`);
      return false;
    }
    const from = task.status;
    if (from === to) return false;
    if (!assertTaskTransition(from, to, { strict: this.#strict, taskKey: key })) {
      this.log('error', `Illegal task transition ${from} → ${to} for ${key}; ignored`, key);
      return false;
    }
    task.status = to;
    Object.assign(task, patch);
    if (isTerminalStatus(to)) task.finishedAt = task.finishedAt ?? this.now();
    if (to === 'running' || to === 'fixing') this.#watchdog?.track(key);
    else this.#watchdog?.untrack(key);
    this.save();
    this.publish({
      type: 'task.status',
      runId: this.runId,
      ts: this.now(),
      payload: { taskKey: key, from, to, run: structuredClone(task) },
    });
    this.touchMetrics();
    if (isTerminalStatus(to) && to !== 'merged') this.#cancelDependents(key);
    if (to === 'merged') this.#onProgress();
    if (isTerminalStatus(to)) this.#scheduleFinishCheck();
    this.#pump();
    return true;
  }

  #cancelDependents(rootKey: string): void {
    for (const key of dependentsToCancel(this.#run, rootKey)) {
      const task = this.#run.tasks[key];
      if (task === undefined || isTerminalStatus(task.status)) continue;
      if (this.transition(key, 'cancelled')) {
        this.log('warn', `${key} cancelled because ${rootKey} will not merge`, key);
      }
    }
  }

  publish(event: StarlingEvent): void {
    this.#deps.store.appendEvent(event);
    this.#deps.bus.publish(event);
  }

  #publishMetricsNow(): void {
    this.#publisher.publishNow();
  }

  log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, taskKey?: string): void {
    this.publish({
      type: 'log',
      runId: this.runId,
      ts: this.now(),
      payload: taskKey === undefined ? { level, msg } : { level, msg, taskKey },
    });
  }

  save(): void {
    this.#deps.store.saveRun(structuredClone(this.#run));
  }

  #snapshot(): Run {
    return structuredClone(this.#run);
  }

  now(): number {
    return this.#deps.clock.now();
  }

  touchMetrics(): void {
    this.#publisher.touch();
  }

  branchOf(taskKey: string): string {
    return this.#run.tasks[taskKey]?.branch ?? `starling/${this.#runShort}/${taskKey}`;
  }

  #liveFor(taskKey: string, spec: TaskSpec): LiveTask {
    const existing = this.#live.get(taskKey);
    if (existing !== undefined) return existing;
    const live: LiveTask = { key: taskKey, spec, generation: 0, chain: Promise.resolve(), stallRetries: 0 };
    this.#live.set(taskKey, live);
    return live;
  }

  enqueue(live: LiveTask, generation: number, step: () => Promise<void>): void {
    live.chain = live.chain
      .then(async () => {
        if (this.#done || this.#stopped || generation !== live.generation) return;
        await step();
      })
      .catch((err) => {
        this.onStepError(live, live.generation, err, 'pipeline');
      });
  }

  onStepError(live: LiveTask, generation: number, err: unknown, phase: string): void {
    if (this.#done || generation !== live.generation) return;
    const detail = messageOf(err);
    this.log('error', `${phase} failed for ${live.key}: ${detail}`, live.key);
    const nodeId = live.nodeId;
    const nodeLost =
      isStarlingError(err, 'NODE_OFFLINE') || (nodeId !== undefined && this.#offline.has(nodeId));
    if (nodeLost) {
      if (nodeId !== undefined) this.#offline.add(nodeId);
      this.#requeueAfterLoss(live, nodeId ?? 'unknown', 'the node went offline mid-task');
      this.#pump();
      this.#scheduleFinishCheck();
      return;
    }
    const task = this.#run.tasks[live.key];
    if (task !== undefined && !isTerminalStatus(task.status)) this.transition(live.key, 'failed');
  }

  // ── budget + finish ──────────────────────────────────────────────────────────────────────────

  #budgetExhausted(): boolean {
    const costUsd = computeRunMetrics(this.#run, this.#ledger, this.now()).apiCostUsd;
    const action = this.#budget.observe(costUsd);
    if (action.warn) {
      const percent = Math.round((this.#budget.warnUsd / this.#budget.maxUsd) * 100);
      this.logPolicy(
        'budget.warn',
        'warn',
        `API spend $${costUsd.toFixed(4)} reached ${percent}% of the $${this.#budget.maxUsd} budget cap.`,
      );
    }
    if (action.stop) {
      this.logPolicy(
        'budget.stop',
        'warn',
        `API budget of $${this.#budget.maxUsd} reached; running tasks may finish and the rest will be skipped.`,
      );
    }
    return this.#budget.stopped;
  }

  #scheduleFinishCheck(): void {
    if (this.#done || this.#finishScheduled) return;
    this.#finishScheduled = true;
    queueMicrotask(() => {
      this.#finishScheduled = false;
      void this.#maybeFinish();
    });
  }

  async #maybeFinish(): Promise<void> {
    if (this.#done) return;
    if (this.#run.plan === undefined) return;
    if (this.#budgetExhausted() && activeCount(this.#run) === 0) {
      this.#cancelUndispatched('the API budget cap was reached');
    }
    if (!allTasksTerminal(this.#run)) return;
    await this.#finish();
  }

  #cancelUndispatched(reason: string): void {
    const keys = unfinishedTaskKeys(this.#run).filter((key) => {
      const status = this.#run.tasks[key]?.status;
      return status !== 'running' && status !== 'fixing' && status !== 'auditing' && status !== 'merging';
    });
    if (keys.length === 0) return;
    for (const key of keys) this.#budgetSkipped.add(key);
    this.log('warn', `Cancelling ${keys.length} undispatched task(s): ${reason}`);
    for (const key of keys) this.transition(key, 'cancelled');
  }

  async #finish(): Promise<void> {
    if (this.#done || this.#finishing) return;
    this.#finishing = true;
    const run = this.#run;
    const merged = countStatus(run, 'merged');
    const status: RunStatus = this.#cancelled
      ? 'cancelled'
      : merged > 0 || Object.keys(run.tasks).length === 0
        ? 'finished'
        : 'failed';
    run.finishedAt = this.now();
    this.#setRunStatus(status);

    const summaryOptions = this.#summaryOptions();
    const summary = await this.#writeSummary(summaryOptions);
    run.metrics = computeRunMetrics(run, this.#ledger, this.now());
    this.save();
    this.#publishMetricsNow();
    this.#done = true;
    this.publish({
      type: 'run.finished',
      runId: this.runId,
      ts: this.now(),
      payload: { run: this.#snapshot(), summary },
    });
    if (status !== 'cancelled' && merged > 0) {
      try {
        await this.#deps.tracker.openFinalPR(run, summary);
      } catch (err) {
        this.log('warn', `Tracker.openFinalPR failed: ${messageOf(err)}`);
      }
    }
    this.#dispose();
    this.#resolveDone(this.#snapshot());
  }

  #summaryOptions(): SummaryOptions {
    if (this.#budgetSkipped.size === 0) return {};
    return { budget: { maxUsd: this.#budget.maxUsd, skipped: this.#budgetSkipped.size } };
  }

  async #writeSummary(options: SummaryOptions = {}): Promise<string> {
    const fallback = renderRunSummary(this.#run, options);
    const writer = this.#deps.writer;
    if (writer === undefined) return fallback;
    try {
      const response = await writer.complete({
        role: 'writer',
        system: WRITER_SYSTEM,
        messages: [{ role: 'user', content: writerPrompt(this.#run, options) }],
        maxTokens: 200,
        temperature: 0.2,
      });
      recordCall(this.#ledger, {
        usage: response.usage,
        model: pricingKey(response.model),
        local: isLocalProvider(this.#deps.config, response.model.provider),
        costUsd: response.costUsd,
      });
      const text = response.text.trim();
      return text.length > 0 ? text : fallback;
    } catch (err) {
      this.log('warn', `writer model failed; using the template summary: ${messageOf(err)}`);
      return fallback;
    }
  }

  #failRun(err: unknown): void {
    if (this.#done) return;
    const detail = messageOf(err);
    this.log('error', `run failed: ${detail}`);
    // A run that never starts must not leave fresh tasks looking schedulable.
    for (const key of unfinishedTaskKeys(this.#run)) this.transition(key, 'cancelled');
    this.#run.finishedAt = this.now();
    this.#setRunStatus('failed');
    this.#run.metrics = computeRunMetrics(this.#run, this.#ledger, this.now());
    this.save();
    this.publish({
      type: 'run.finished',
      runId: this.runId,
      ts: this.now(),
      payload: { run: this.#snapshot(), summary: renderRunSummary(this.#run, { reason: detail }) },
    });
    this.#done = true;
    this.#dispose();
    this.#resolveDone(this.#snapshot());
  }

  #dispose(): void {
    this.#watchdog?.stop();
    this.#unsubRegistry?.();
    this.#unsubRegistry = undefined;
    for (const off of this.#unsubs.values()) off();
    this.#unsubs.clear();
    this.#publisher.stop();
  }
}

/** True once `waitForFinish` has something to return: a run in a settled status. */
export function isRunSettled(status: RunStatus): boolean {
  return status === 'finished' || status === 'failed' || status === 'cancelled' || status === 'planned';
}
