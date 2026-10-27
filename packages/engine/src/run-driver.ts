/**
 * One run's orchestration state machine: map → plan → dispatch → audit → fix → merge → finish.
 *
 * ARCHITECTURE §4 is implemented literally here. The driver only talks to ports (all injected), so
 * every behaviour is reproducible with the doubles in `@starling/core/testing`.
 */

import type {
  AgentEvent,
  AuditVerdict,
  ExecutionNode,
  Goal,
  MergeResult,
  NodeInfo,
  PromptContext,
  RepoMap,
  Run,
  RunStatus,
  StarlingEvent,
  StartTaskOptions,
  TaskHandle,
  TaskResult,
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
import { computeRunMetrics, emptyLedger, MetricsPublisher, recordCall, type UsageLedger } from './metrics';
import { availableSlots, dispatchableNodes } from './nodes';
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
import { renderRunSummary, writerPrompt } from './summary';
import { assertTaskTransition, isTerminalStatus } from './transitions';
import type { EngineDeps } from './types';

interface LiveTask {
  key: string;
  spec: TaskSpec;
  node?: ExecutionNode;
  nodeId?: string;
  handle?: TaskHandle;
  /** Bumped whenever a session is abandoned (migration, cancel): stale pipeline steps bail out. */
  generation: number;
  /** Serialises lifecycle steps for this task: start → audit → merge → fix → audit … */
  chain: Promise<void>;
  migrationFrom?: string;
  migrationReason?: string;
}

const WRITER_SYSTEM =
  'You write a terse, factual release note for a coding run. One short paragraph, plain text.';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class RunDriver {
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
  readonly #publisher: MetricsPublisher;
  #resolveDone!: (run: Run) => void;
  #map?: RepoMap;
  #unsubRegistry?: () => void;
  #pumping = false;
  #finishScheduled = false;
  #finishing = false;
  #done = false;
  #stopped = false;
  #cancelled = false;
  #budgetAnnounced = false;

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
        this.#save();
        this.#publish({
          type: 'metrics',
          runId: this.runId,
          ts: this.#now(),
          payload: metrics,
        });
      },
      timers: deps.timers,
    });
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────────────────────────

  async begin(): Promise<void> {
    this.#save();
    this.#publish({
      type: 'run.created',
      runId: this.runId,
      ts: this.#now(),
      payload: { run: this.#snapshot() },
    });
    this.#publisher.touch();
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
    this.#cancelled = true;
    this.#stopped = true;
    this.#log('warn', 'Cancellation requested: aborting every active session.');
    for (const live of [...this.#live.values()]) {
      live.generation += 1;
      const node = live.node;
      const handle = live.handle;
      live.handle = undefined;
      if (node === undefined || handle === undefined) continue;
      try {
        await node.abort(handle);
      } catch (err) {
        this.#log('debug', `abort failed on ${node.id}: ${messageOf(err)}`, live.key);
      }
    }
    for (const key of unfinishedTaskKeys(this.#run)) this.#transition(key, 'cancelled');
    await this.#maybeFinish();
  }

  async abortTask(taskKey: string): Promise<void> {
    if (this.#done) return;
    const task = this.#run.tasks[taskKey];
    if (task === undefined) {
      throw new StarlingError('INVALID_ARGUMENT', `Cannot abort unknown task "${taskKey}"`, {
        details: { runId: this.runId, taskKey },
      });
    }
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
          this.#log('debug', `abort failed on ${node.id}: ${messageOf(err)}`, taskKey);
        }
      }
    }
    this.#transition(taskKey, 'cancelled');
    this.#scheduleFinishCheck();
  }

  // ── map + plan ───────────────────────────────────────────────────────────────────────────────

  async #mapAndPlan(): Promise<void> {
    const map = await this.#deps.repoMapper.map(this.#run.goal.repoPath);
    this.#map = map;
    this.#publish({
      type: 'repomap.ready',
      runId: this.runId,
      ts: this.#now(),
      payload: { files: map.files.length, tokenEstimate: map.tokenEstimate },
    });
    this.#publisher.touch();

    const { plan, issues } = await this.#deps.planner.plan(this.#run.goal, map);
    this.#run.plan = plan;
    this.#run.tasks = createTaskRuns(this.runId, plan);
    this.#run.status = 'planned';
    this.#save();
    this.#publish({
      type: 'plan.created',
      runId: this.runId,
      ts: this.#now(),
      payload: { plan, issues },
    });
    this.#publisher.touch();

    if (this.#input.dryRun === true) {
      this.#log('info', `Dry run: ${plan.tasks.length} task(s) planned; nothing dispatched.`);
      this.#completePlanned();
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
    this.#run.status = 'running';
    this.#save();
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
      this.#save();
    } catch (err) {
      this.#log('warn', `Tracker.syncPlan failed; continuing without issue links: ${messageOf(err)}`);
    }
  }

  #completePlanned(): void {
    this.#done = true;
    this.#run.metrics = computeRunMetrics(this.#run, this.#ledger, this.#now());
    this.#save();
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
      for (const key of promotableTaskKeys(this.#run)) this.#transition(key, 'ready');

      for (const spec of plan.tasks) {
        if (this.#done || this.#stopped) return;
        const task = this.#run.tasks[spec.key];
        if (task === undefined || task.status !== 'ready') continue;
        if (activeCount(this.#run) >= this.#maxParallel) return;
        if (this.#budgetExhausted()) {
          if (!this.#budgetAnnounced) {
            this.#budgetAnnounced = true;
            this.#log(
              'warn',
              `API budget of $${this.#deps.config.budget.maxUsd} reached; no new tasks will be dispatched.`,
              spec.key,
            );
          }
          return;
        }
        const nodes = this.#nodesForDispatch();
        if (nodes.length === 0) return;
        if (availableSlots(nodes, activeByNode(this.#run)) <= 0) return;
        const nodeId = this.#deps.scheduler.pick(nodes, spec);
        if (nodeId === undefined) return;
        const info = nodes.find((node) => node.id === nodeId);
        const node = this.#deps.registry.get(nodeId);
        if (info === undefined || node === undefined) {
          this.#log('warn', `Scheduler picked node "${nodeId}" which is not in the registry; skipping`);
          continue;
        }
        this.#dispatch(spec, info, node);
      }
    } finally {
      this.#pumping = false;
    }
  }

  #nodesForDispatch(): NodeInfo[] {
    const nodes = dispatchableNodes(this.#deps.registry.list(), activeByNode(this.#run), this.#offline);
    const usable: NodeInfo[] = [];
    for (const node of nodes) {
      if (node.kind === 'remote' && this.#deps.bundleUrlFor === undefined) {
        if (!this.#noBundle.has(node.id)) {
          this.#noBundle.add(node.id);
          this.#log('warn', `Remote node "${node.id}" ignored: no bundleUrlFor configured for this hub.`);
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
    if (
      !this.#transition(spec.key, 'running', {
        branch,
        nodeId: node.id,
        startedAt: existing?.startedAt ?? this.#now(),
      })
    ) {
      return;
    }
    const live = this.#liveFor(spec.key, spec);
    live.generation += 1;
    const generation = live.generation;
    live.node = node;
    live.nodeId = node.id;
    live.handle = undefined;
    this.#ensureSubscribed(node);

    if (live.migrationFrom !== undefined && live.migrationFrom !== node.id) {
      this.#publish({
        type: 'task.migrated',
        runId: this.runId,
        ts: this.#now(),
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

    const options = this.#startOptions(spec, info, branch);
    this.#enqueue(live, generation, async () => {
      try {
        const handle = await node.startTask(options);
        if (generation !== live.generation) return;
        live.handle = handle;
        const task = this.#run.tasks[spec.key];
        if (task !== undefined) {
          task.sessionId = handle.sessionId;
          this.#save();
        }
      } catch (err) {
        this.#onStepError(live, generation, err, 'startTask');
      }
    });
  }

  #startOptions(spec: TaskSpec, info: NodeInfo, branch: string): StartTaskOptions {
    const repo =
      info.kind === 'local'
        ? ({ kind: 'local', path: this.#run.goal.repoPath } as const)
        : this.#bundleRepo();
    return {
      runId: this.runId,
      taskKey: spec.key,
      title: spec.title,
      repo,
      fromRef: this.#integrationBranchName,
      branch,
      prompt: this.#deps.prompts.worker(this.#promptContext(spec, branch)),
      model: modelFor(this.#deps.config, 'worker'),
    };
  }

  #bundleRepo(): { kind: 'bundle'; url: string; token: string } {
    const bundleUrlFor = this.#deps.bundleUrlFor;
    if (bundleUrlFor === undefined) {
      throw new StarlingError('INVALID_ARGUMENT', 'No bundleUrlFor configured for a remote node');
    }
    const { url, token } = bundleUrlFor(this.#integrationBranchName);
    return { kind: 'bundle', url, token };
  }

  #promptContext(spec: TaskSpec, branch: string): PromptContext {
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
        createdAt: this.#now(),
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
    this.#publish({ type: 'agent.event', runId: this.runId, ts: event.ts, payload: event });
    const task = this.#run.tasks[event.taskKey];
    if (task === undefined) return;

    if (event.kind === 'usage') {
      this.#recordAgentUsage(task, event);
      return;
    }
    if (event.kind === 'session.error') {
      this.#log(
        'warn',
        `agent error on ${event.taskKey}: ${String(event.data.reason ?? 'unknown')}`,
        event.taskKey,
      );
      return;
    }
    if (event.kind !== 'session.idle') return;
    const live = this.#live.get(event.taskKey);
    if (live === undefined) return;
    const generation = live.generation;
    this.#enqueue(live, generation, () => this.#onIdle(live, generation));
  }

  #recordAgentUsage(task: TaskRun, event: AgentEvent): void {
    const usage = parseUsage(event.data);
    if (usage === undefined) return;
    const model = parseModel(event.data.model) ?? modelFor(this.#deps.config, 'worker');
    const local = isLocalProvider(this.#deps.config, model.provider);
    const priced = usageCostUsd(pricingKey(model), usage);
    const costUsd = local ? 0 : priced !== 0 ? priced : usageCostUsd(model.model, usage);
    task.usage = addUsage(task.usage, usage);
    task.costUsd += costUsd;
    recordCall(this.#ledger, { usage, model: pricingKey(model), local, costUsd });
    this.#save();
    this.#publisher.touch();
  }

  async #onIdle(live: LiveTask, generation: number): Promise<void> {
    if (this.#done || this.#stopped || generation !== live.generation) return;
    const task = this.#run.tasks[live.key];
    if (task === undefined) return;
    if (task.status !== 'running' && task.status !== 'fixing') return;
    const node = live.node;
    const handle = live.handle;
    if (node === undefined || handle === undefined) {
      this.#log('warn', `session idle before its handle was registered for ${live.key}`, live.key);
      return;
    }
    await this.#auditThenMerge(live, generation, node, handle);
  }

  // ── audit → merge → fix ──────────────────────────────────────────────────────────────────────

  async #auditThenMerge(
    live: LiveTask,
    generation: number,
    node: ExecutionNode,
    handle: TaskHandle,
  ): Promise<void> {
    const key = live.key;
    if (!this.#transition(key, 'auditing')) return;
    const ctx = this.#promptContext(live.spec, this.#branchOf(key));

    let result: TaskResult;
    try {
      result = await node.collect(handle, this.#run.goal.repoPath, this.#integrationBranchName);
    } catch (err) {
      this.#onStepError(live, generation, err, 'collect');
      return;
    }
    if (generation !== live.generation || this.#done || this.#stopped) return;

    const task = this.#run.tasks[key];
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
      if (generation !== live.generation || this.#done) return;
      this.#log('error', `auditor threw for ${key}: ${messageOf(err)}`, key);
      this.#transition(key, 'failed');
      return;
    }
    if (generation !== live.generation || this.#done || this.#stopped) return;

    const fresh = this.#run.tasks[key];
    if (fresh === undefined) return;
    fresh.attempts = attempt;
    fresh.lastVerdict = verdict;
    this.#save();
    this.#publish({ type: 'audit.verdict', runId: this.runId, ts: this.#now(), payload: verdict });
    this.#publisher.touch();

    if (verdict.pass) {
      await this.#merge(live, generation, ctx);
      return;
    }
    if (attempt < this.#deps.config.maxAttempts) {
      await this.#requestFix(live, generation, ctx, verdict);
      return;
    }
    this.#log('error', `${key} failed the audit after ${attempt} attempt(s)`, key);
    this.#transition(key, 'failed');
  }

  async #merge(live: LiveTask, generation: number, ctx: PromptContext): Promise<void> {
    const key = live.key;
    if (!this.#transition(key, 'merging')) return;
    const task = this.#run.tasks[key];
    if (task === undefined) return;

    let result: MergeResult;
    try {
      result = await this.#deps.merger.merge(
        this.#run.goal.repoPath,
        this.#integrationBranchName,
        structuredClone(task),
        { testCommand: ctx.testCommand },
      );
    } catch (err) {
      if (generation !== live.generation || this.#done) return;
      this.#log('error', `merger threw for ${key}: ${messageOf(err)}`, key);
      this.#transition(key, 'failed');
      return;
    }
    if (generation !== live.generation || this.#done || this.#stopped) return;
    this.#publish({ type: 'merge.result', runId: this.runId, ts: result.ts, payload: result });
    this.#publisher.touch();

    switch (result.status) {
      case 'merged':
      case 'skipped': {
        if (result.status === 'skipped') {
          this.#log('warn', `nothing to merge for ${key}: ${result.detail}`, key);
        }
        this.#transition(key, 'merged');
        const merged = this.#run.tasks[key];
        if (merged !== undefined) {
          try {
            await this.#deps.tracker.onMerged(this.#run, structuredClone(merged));
          } catch (err) {
            this.#log('warn', `Tracker.onMerged failed for ${key}: ${messageOf(err)}`, key);
          }
        }
        await this.#cleanup(live);
        return;
      }
      case 'conflict': {
        this.#transition(key, 'conflict');
        await this.#cleanup(live);
        return;
      }
      case 'tests-failed': {
        const attempt = this.#run.tasks[key]?.attempts ?? 0;
        if (attempt < this.#deps.config.maxAttempts) {
          await this.#requestFix(live, generation, ctx, this.#mergeFailureVerdict(key, attempt, result));
        } else {
          this.#log('error', `${key} still fails the integration tests after ${attempt} attempt(s)`, key);
          this.#transition(key, 'failed');
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
    if (!this.#transition(live.key, 'fixing')) return;
    const node = live.node;
    const handle = live.handle;
    if (node === undefined || handle === undefined) {
      this.#log('warn', `cannot send a fix prompt for ${live.key}: no live session`, live.key);
      this.#transition(live.key, 'failed');
      return;
    }
    const prompt = this.#deps.prompts.fixer(ctx, verdict);
    try {
      await node.sendPrompt(handle, prompt);
    } catch (err) {
      this.#onStepError(live, generation, err, 'sendPrompt');
    }
  }

  #mergeFailureVerdict(taskKey: string, attempt: number, result: MergeResult): AuditVerdict {
    return {
      taskKey,
      attempt,
      pass: false,
      checks: [{ name: 'integration-tests', ok: false, detail: result.detail }],
      laneViolations: [],
      summary: `Merging into ${this.#integrationBranchName} failed its tests.`,
      fixInstructions: `The merge regression suite failed: ${result.detail}\nFix the failure and make the suite green.`,
      model: modelFor(this.#deps.config, 'auditor'),
      ts: this.#now(),
    };
  }

  async #cleanup(live: LiveTask): Promise<void> {
    const node = live.node;
    const handle = live.handle;
    live.handle = undefined;
    if (node === undefined || handle === undefined) return;
    try {
      await node.cleanup(handle);
    } catch (err) {
      this.#log('warn', `node cleanup failed for ${live.key}: ${messageOf(err)}`, live.key);
    }
  }

  // ── flock: registry changes ──────────────────────────────────────────────────────────────────

  #onRegistryChange(event: { type: 'joined' | 'left' | 'stats'; node: NodeInfo }): void {
    if (this.#done) return;
    const node = event.node;
    if (event.type === 'left') {
      this.#publish({
        type: 'node.left',
        runId: this.runId,
        ts: this.#now(),
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

    this.#publish({
      type: event.type === 'joined' ? 'node.joined' : 'node.stats',
      runId: this.runId,
      ts: this.#now(),
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
    this.#log('warn', `${live.key} will be rescheduled: ${reason}`, live.key);
    this.#transition(live.key, 'ready', { nodeId: undefined, sessionId: undefined });
  }

  // ── transitions and events ───────────────────────────────────────────────────────────────────

  #transition(key: string, to: TaskStatus, patch: Partial<TaskRun> = {}): boolean {
    if (this.#done) return false;
    const task = this.#run.tasks[key];
    if (task === undefined) {
      this.#log('error', `transition requested for unknown task "${key}"`);
      return false;
    }
    const from = task.status;
    if (from === to) return false;
    if (!assertTaskTransition(from, to, { strict: this.#strict, taskKey: key })) {
      this.#log('error', `Illegal task transition ${from} → ${to} for ${key}; ignored`, key);
      return false;
    }
    task.status = to;
    Object.assign(task, patch);
    if (isTerminalStatus(to)) task.finishedAt = task.finishedAt ?? this.#now();
    this.#save();
    this.#publish({
      type: 'task.status',
      runId: this.runId,
      ts: this.#now(),
      payload: { taskKey: key, from, to, run: structuredClone(task) },
    });
    this.#publisher.touch();
    if (isTerminalStatus(to) && to !== 'merged') this.#cancelDependents(key);
    if (isTerminalStatus(to)) this.#scheduleFinishCheck();
    this.#pump();
    return true;
  }

  #cancelDependents(rootKey: string): void {
    for (const key of dependentsToCancel(this.#run, rootKey)) {
      const task = this.#run.tasks[key];
      if (task === undefined || isTerminalStatus(task.status)) continue;
      if (this.#transition(key, 'cancelled')) {
        this.#log('warn', `${key} cancelled because ${rootKey} will not merge`, key);
      }
    }
  }

  #publish(event: StarlingEvent): void {
    this.#deps.store.appendEvent(event);
    this.#deps.bus.publish(event);
  }

  #publishMetricsNow(): void {
    this.#publisher.publishNow();
  }

  #log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, taskKey?: string): void {
    this.#publish({
      type: 'log',
      runId: this.runId,
      ts: this.#now(),
      payload: taskKey === undefined ? { level, msg } : { level, msg, taskKey },
    });
  }

  #save(): void {
    this.#deps.store.saveRun(structuredClone(this.#run));
  }

  #snapshot(): Run {
    return structuredClone(this.#run);
  }

  #now(): number {
    return this.#deps.clock.now();
  }

  #branchOf(taskKey: string): string {
    return this.#run.tasks[taskKey]?.branch ?? `starling/${this.#runShort}/${taskKey}`;
  }

  #liveFor(taskKey: string, spec: TaskSpec): LiveTask {
    const existing = this.#live.get(taskKey);
    if (existing !== undefined) return existing;
    const live: LiveTask = { key: taskKey, spec, generation: 0, chain: Promise.resolve() };
    this.#live.set(taskKey, live);
    return live;
  }

  #enqueue(live: LiveTask, generation: number, step: () => Promise<void>): void {
    live.chain = live.chain
      .then(async () => {
        if (this.#done || this.#stopped || generation !== live.generation) return;
        await step();
      })
      .catch((err) => {
        this.#onStepError(live, live.generation, err, 'pipeline');
      });
  }

  #onStepError(live: LiveTask, generation: number, err: unknown, phase: string): void {
    if (this.#done || generation !== live.generation) return;
    const detail = messageOf(err);
    this.#log('error', `${phase} failed for ${live.key}: ${detail}`, live.key);
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
    if (task !== undefined && !isTerminalStatus(task.status)) this.#transition(live.key, 'failed');
  }

  // ── budget + finish ──────────────────────────────────────────────────────────────────────────

  #budgetExhausted(): boolean {
    const maxUsd = this.#deps.config.budget.maxUsd;
    return computeRunMetrics(this.#run, this.#ledger, this.#now()).apiCostUsd >= maxUsd;
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
    this.#log('warn', `Cancelling ${keys.length} undispatched task(s): ${reason}`);
    for (const key of keys) this.#transition(key, 'cancelled');
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
    run.status = status;
    run.finishedAt = this.#now();
    this.#save();

    const summary = await this.#writeSummary();
    run.metrics = computeRunMetrics(run, this.#ledger, this.#now());
    this.#save();
    this.#publishMetricsNow();
    this.#done = true;
    this.#publish({
      type: 'run.finished',
      runId: this.runId,
      ts: this.#now(),
      payload: { run: this.#snapshot(), summary },
    });
    if (status !== 'cancelled') {
      try {
        await this.#deps.tracker.openFinalPR(run, summary);
      } catch (err) {
        this.#log('warn', `Tracker.openFinalPR failed: ${messageOf(err)}`);
      }
    }
    this.#dispose();
    this.#resolveDone(this.#snapshot());
  }

  async #writeSummary(): Promise<string> {
    const fallback = renderRunSummary(this.#run);
    const writer = this.#deps.writer;
    if (writer === undefined) return fallback;
    try {
      const response = await writer.complete({
        role: 'writer',
        system: WRITER_SYSTEM,
        messages: [{ role: 'user', content: writerPrompt(this.#run) }],
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
      this.#log('warn', `writer model failed; using the template summary: ${messageOf(err)}`);
      return fallback;
    }
  }

  #failRun(err: unknown): void {
    if (this.#done) return;
    const detail = messageOf(err);
    this.#log('error', `run failed: ${detail}`);
    this.#run.status = 'failed';
    this.#run.finishedAt = this.#now();
    this.#run.metrics = computeRunMetrics(this.#run, this.#ledger, this.#now());
    this.#save();
    this.#publish({
      type: 'run.finished',
      runId: this.runId,
      ts: this.#now(),
      payload: { run: this.#snapshot(), summary: renderRunSummary(this.#run, { reason: detail }) },
    });
    this.#done = true;
    this.#dispose();
    this.#resolveDone(this.#snapshot());
  }

  #dispose(): void {
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
