import type {
  AgentEvent,
  AuditVerdict,
  EventBus,
  Goal,
  MergeResult,
  ModelRef,
  NodeInfo,
  Plan,
  Run,
  StarlingEvent,
  Store,
  TaskRun,
  TaskSpec,
  TokenUsage,
} from '@starling/core';
import {
  emptyMetrics,
  emptyUsage,
  newId,
  StarlingError,
  shortId,
  usageCostUsd,
  withCall,
} from '@starling/core';
import { makeNodeInfo } from '@starling/core/testing';
import type { EngineApi, StartRunInput } from './handshake';
import { buildMockPlan } from './mock-plan';

export interface MockEngineOptions {
  store: Store;
  bus: EventBus;
  models: { worker: ModelRef; auditor: ModelRef };
  maxParallel?: number;
  baseBranch?: string;
  flockEnabled?: boolean;
  now?: () => number;
  /** Simulated latency between transitions. 0 makes tests fast; the CLI uses ~55 ms for motion. */
  stepMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

class Cancelled extends Error {}

/**
 * In-memory `EngineApi` used by every CLI command in Wave 1.
 *
 * It implements the §8 handshake exactly and publishes the same events the real engine will, so the
 * renderers, the recorder and the replay path are exercised end to end before the engine exists.
 * It is intentionally a scripted happy path with one audit failure, rather than a second engine.
 */
export class MockEngine implements EngineApi {
  readonly #store: Store;
  readonly #bus: EventBus;
  readonly #models: MockEngineOptions['models'];
  readonly #maxParallel: number;
  readonly #baseBranch: string;
  readonly #flockEnabled: boolean;
  readonly #now: () => number;
  readonly #stepMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #finishes = new Map<string, { promise: Promise<Run>; resolve: (run: Run) => void }>();
  readonly #cancelled = new Set<string>();
  readonly #aborted = new Set<string>();
  readonly #done = new Set<string>();
  readonly #live = new Map<string, Run>();

  constructor(options: MockEngineOptions) {
    this.#store = options.store;
    this.#bus = options.bus;
    this.#models = options.models;
    this.#maxParallel = Math.max(1, options.maxParallel ?? 8);
    this.#baseBranch = options.baseBranch ?? 'main';
    this.#flockEnabled = options.flockEnabled ?? true;
    this.#now = options.now ?? (() => Date.now());
    this.#stepMs = options.stepMs ?? 0;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async start(input: StartRunInput): Promise<{ runId: string }> {
    if (input.goal.trim().length === 0) {
      throw new StarlingError('INVALID_ARGUMENT', 'A goal is required — e.g. starling run "add dark mode"');
    }

    const now = this.#now();
    const runId = newId();
    const goal: Goal = {
      id: newId(),
      text: input.goal,
      repoPath: input.repoPath,
      baseBranch: input.baseBranch ?? this.#baseBranch,
      createdAt: now,
      constraints: [],
    };
    const plan = buildMockPlan(goal, { model: this.#models.worker });
    const tasks: Record<string, TaskRun> = {};
    for (const task of plan.tasks) {
      tasks[task.key] = {
        runId,
        taskKey: task.key,
        status: 'pending',
        attempts: 0,
        usage: emptyUsage(),
        costUsd: 0,
      };
    }
    const run: Run = {
      id: runId,
      goal,
      plan,
      tasks,
      status: 'mapping',
      integrationBranch: `starling/${shortId(runId)}/integration`,
      startedAt: now,
      metrics: emptyMetrics(),
    };

    this.#live.set(runId, run);
    this.#store.saveRun(run);
    this.#publish(run, { type: 'run.created', payload: { run: structuredClone(run) } });

    let resolveFinish: (finished: Run) => void = () => {};
    const promise = new Promise<Run>((resolve) => {
      resolveFinish = resolve;
    });
    this.#finishes.set(runId, { promise, resolve: resolveFinish });

    void this.#simulate(run, input);
    return { runId };
  }

  async cancel(runId: string): Promise<void> {
    if (!this.#live.has(runId)) throw new StarlingError('INVALID_ARGUMENT', `Unknown run ${runId}`);
    this.#cancelled.add(runId);
  }

  async abortTask(runId: string, taskKey: string): Promise<void> {
    this.#aborted.add(`${runId}/${taskKey}`);
    const run = this.#live.get(runId);
    const task = run?.tasks[taskKey];
    if (run === undefined || task === undefined || isTerminalTask(task.status)) return;
    this.#transition(run, taskKey, 'cancelled', { finishedAt: this.#now() });
    this.#syncMetrics(run);
    this.#save(run);
    this.#publishMetrics(run);
  }

  getRun(runId: string): Run | undefined {
    return this.#store.getRun(runId);
  }

  listRuns(): Run[] {
    return this.#store.listRuns();
  }

  waitForFinish(runId: string): Promise<Run> {
    const run = this.#store.getRun(runId);
    if (run === undefined) {
      return Promise.reject(new StarlingError('INVALID_ARGUMENT', `Unknown run ${runId}`));
    }
    if (isTerminal(run.status)) return Promise.resolve(run);
    return this.#finishes.get(runId)?.promise ?? Promise.resolve(run);
  }

  async #simulate(run: Run, input: StartRunInput): Promise<void> {
    try {
      await this.#step();
      this.#assertActive(run.id);
      this.#publish(run, {
        type: 'repomap.ready',
        payload: { files: 34, tokenEstimate: 4200 },
      });

      run.status = 'planning';
      this.#save(run);
      await this.#step();
      this.#assertActive(run.id);
      this.#publish(run, {
        type: 'plan.created',
        payload: { plan: run.plan as Plan, issues: [] },
      });
      run.status = 'planned';
      this.#save(run);
      await this.#step();
      this.#assertActive(run.id);

      if (input.dryRun === true) {
        this.#finish(
          run,
          'finished',
          `Dry run: ${run.plan?.tasks.length ?? 0} tasks planned. No agents launched. 🪶`,
        );
        return;
      }

      run.status = 'running';
      this.#save(run);
      this.#publishNodes();

      const merged = new Set<string>();
      const plan = run.plan as Plan;
      const limit = Math.max(1, input.maxParallel ?? this.#maxParallel);

      while (merged.size < plan.tasks.length) {
        const ready = plan.tasks.filter(
          (task) => !merged.has(task.key) && task.dependsOn.every((dep) => merged.has(dep)),
        );
        if (ready.length === 0) break;
        for (const group of chunk(ready, limit)) {
          await Promise.all(group.map((task) => this.#runTask(run, task, merged)));
          this.#assertActive(run.id);
        }
      }

      this.#syncMetrics(run);
      const counts = this.#counts(run);
      const summary =
        counts.failed > 0
          ? `Merged ${counts.merged}/${plan.tasks.length}; ${counts.failed} task(s) need a human. 🐦`
          : `Merged all ${counts.merged} tasks onto ${run.integrationBranch ?? 'the integration branch'} in ${Math.max(1, Math.round((this.#now() - run.startedAt) / 1000))}s of mock time. 🐦`;
      this.#finish(run, counts.failed > 0 ? 'failed' : 'finished', summary);
    } catch (err) {
      if (err instanceof Cancelled) {
        this.#finish(run, 'cancelled', 'Run cancelled — the flock landed early. 🐦');
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.#finish(run, 'failed', `Mock engine stopped: ${message}`);
    }
  }

  async #runTask(run: Run, task: TaskSpec, merged: Set<string>): Promise<void> {
    if (this.#aborted.has(`${run.id}/${task.key}`)) return;

    const sessionId = `ses_mock_${task.key}`;
    const nodeId = this.#nodeFor(run, task);
    const startedAt = this.#now();
    let attempts = 1;

    this.#transition(run, task.key, 'running', { attempts, startedAt, nodeId });
    await this.#step();
    this.#assertActive(run.id);
    if (this.#aborted.has(`${run.id}/${task.key}`)) return;

    this.#agent(run, task, sessionId, {
      kind: 'session.started',
      data: { model: this.#models.worker },
    });
    this.#agent(run, task, sessionId, {
      kind: 'text',
      data: { text: `Reading ${task.lane.reads[0] ?? 'the repo'} for “${task.title}”.` },
    });
    await this.#step();
    this.#assertActive(run.id);

    this.#agent(run, task, sessionId, {
      kind: 'tool.call',
      data: { tool: 'read', path: task.lane.reads[0] ?? 'README.md' },
    });
    this.#agent(run, task, sessionId, {
      kind: 'file.edited',
      data: { path: sampleFile(task) },
    });

    const usage: TokenUsage = {
      input: 1200 + planIndex(run, task.key) * 180,
      output: 260 + planIndex(run, task.key) * 40,
      cached: 180,
    };
    this.#recordUsage(run, task.key, usage, false);
    this.#agent(run, task, sessionId, { kind: 'usage', data: { ...usage } });
    this.#agent(run, task, sessionId, { kind: 'session.idle', data: {} });
    await this.#step();
    this.#assertActive(run.id);

    this.#transition(run, task.key, 'auditing');
    await this.#step();
    this.#assertActive(run.id);

    const failsFirst = task.key === 'tests' && attempts === 1;
    if (failsFirst) {
      this.#publishVerdict(run, task, false, attempts, 'One regression test still fails.');
      this.#transition(run, task.key, 'fixing');
      await this.#step();
      this.#assertActive(run.id);
      this.#agent(run, task, sessionId, {
        kind: 'text',
        data: { text: 'Fixer prompt: make the failing assertion pass without weakening it.' },
      });
      this.#agent(run, task, sessionId, {
        kind: 'file.edited',
        data: { path: sampleFile(task) },
      });
      await this.#step();
      this.#assertActive(run.id);
      attempts = 2;
      this.#transition(run, task.key, 'auditing', { attempts });
      await this.#step();
      this.#assertActive(run.id);
    }

    this.#publishVerdict(run, task, true, attempts, 'Definition of done met.');
    this.#transition(run, task.key, 'merging');
    await this.#step();
    this.#assertActive(run.id);
    if (this.#aborted.has(`${run.id}/${task.key}`)) return;

    const finishedAt = this.#now();
    const branch = `starling/${shortId(run.id)}/${task.key}`;
    this.#transition(run, task.key, 'merged', { attempts, finishedAt, branch });
    const merge: MergeResult = {
      taskKey: task.key,
      status: 'merged',
      conflictedFiles: [],
      commit: `mock-${task.key}-${run.id.slice(-4)}`,
      detail: `Merged ${task.key} onto ${run.integrationBranch ?? 'the integration branch'}`,
      ts: finishedAt,
    };
    this.#publish(run, { type: 'merge.result', payload: merge });
    merged.add(task.key);

    this.#syncMetrics(run);
    this.#save(run);
    this.#publishMetrics(run);
  }

  #recordUsage(run: Run, taskKey: string, usage: TokenUsage, local: boolean): void {
    const model = local ? this.#models.auditor.model : this.#models.worker.model;
    run.metrics = withCall(run.metrics, { usage, model, local });
    const task = run.tasks[taskKey];
    if (task !== undefined) {
      task.usage = {
        input: task.usage.input + usage.input,
        output: task.usage.output + usage.output,
        cached: task.usage.cached + usage.cached,
      };
      if (!local) task.costUsd += usageCostUsd(model, usage);
    }
  }

  #publishVerdict(run: Run, task: TaskSpec, pass: boolean, attempt: number, summary: string): void {
    const verdict: AuditVerdict = {
      taskKey: task.key,
      attempt,
      pass,
      checks: [
        { name: 'tests', ok: pass, detail: pass ? 'bun test: green' : 'bun test: 1 failing' },
        { name: 'lane', ok: true, detail: `owns ${task.lane.owns.join(', ')}` },
        { name: 'definition-of-done', ok: pass, detail: `${task.definitionOfDone.length} checks` },
      ],
      laneViolations: [],
      summary,
      ...(pass
        ? {}
        : { fixInstructions: 'Run bun test and fix the failing assertion without weakening it.' }),
      model: this.#models.auditor,
      ts: this.#now(),
    };
    const current = run.tasks[task.key];
    if (current !== undefined) run.tasks[task.key] = { ...current, lastVerdict: verdict };
    this.#recordUsage(run, task.key, { input: 500, output: 90, cached: 0 }, true);
    this.#save(run);
    this.#publish(run, { type: 'audit.verdict', payload: verdict });
  }

  #publishNodes(): void {
    const hub: NodeInfo = makeNodeInfo({
      id: 'hub',
      name: 'MacBook Pro',
      kind: 'local',
      platform: process.platform,
      arch: process.arch,
      cpuCores: 12,
      memGb: 32,
      maxSessions: 8,
      localModels: ['qwen3.6:35b-a3b'],
      status: 'online',
      lastSeen: this.#now(),
      latencyMs: 1,
    });
    this.#bus.publish({ type: 'node.joined', runId: '*', ts: this.#now(), payload: { node: hub } });
    if (!this.#flockEnabled) return;
    const air: NodeInfo = makeNodeInfo({
      id: 'm2-air',
      name: 'MacBook Air',
      kind: 'remote',
      url: 'http://192.168.1.42:7778',
      platform: 'darwin',
      arch: 'arm64',
      cpuCores: 8,
      memGb: 16,
      maxSessions: 5,
      localModels: [],
      status: 'online',
      lastSeen: this.#now(),
      latencyMs: 18,
    });
    this.#bus.publish({ type: 'node.joined', runId: '*', ts: this.#now(), payload: { node: air } });
  }

  #agent(
    run: Run,
    task: TaskSpec,
    sessionId: string,
    event: { kind: AgentEvent['kind']; data: Record<string, unknown> },
  ): void {
    this.#publish(run, {
      type: 'agent.event',
      payload: {
        runId: run.id,
        taskKey: task.key,
        sessionId,
        ts: this.#now(),
        kind: event.kind,
        data: event.data,
      },
    });
  }

  #transition(run: Run, taskKey: string, to: TaskRun['status'], patch: Partial<TaskRun> = {}): void {
    const current = run.tasks[taskKey];
    if (current === undefined) return;
    const from = current.status;
    const next: TaskRun = { ...current, ...patch, status: to };
    run.tasks[taskKey] = next;
    this.#save(run);
    this.#publish(run, {
      type: 'task.status',
      payload: { taskKey, from, to, run: structuredClone(next) },
    });
  }

  #publish(run: Run, event: DistributiveOmit<StarlingEvent, 'runId' | 'ts'>): void {
    const full = { ...event, runId: run.id, ts: this.#now() } as StarlingEvent;
    this.#bus.publish(full);
  }

  #publishMetrics(run: Run): void {
    this.#publish(run, { type: 'metrics', payload: run.metrics });
  }

  #syncMetrics(run: Run): void {
    const counts = this.#counts(run);
    run.metrics = {
      ...run.metrics,
      agentsActive: counts.running + counts.fixing,
      tasksMerged: counts.merged,
      tasksFailed: counts.failed + counts.conflict,
      elapsedMs: Math.max(0, this.#now() - run.startedAt),
    };
  }

  #counts(run: Run): Record<TaskRun['status'], number> {
    const counts: Record<TaskRun['status'], number> = {
      pending: 0,
      ready: 0,
      running: 0,
      auditing: 0,
      fixing: 0,
      merging: 0,
      merged: 0,
      failed: 0,
      conflict: 0,
      cancelled: 0,
    };
    for (const task of Object.values(run.tasks)) counts[task.status] += 1;
    return counts;
  }

  #nodeFor(run: Run, task: TaskSpec): string {
    if (!this.#flockEnabled) return 'hub';
    const index = run.plan?.tasks.findIndex((candidate) => candidate.key === task.key) ?? 0;
    return index % 2 === 1 ? 'm2-air' : 'hub';
  }

  #finish(run: Run, status: Run['status'], summary: string): void {
    if (this.#done.has(run.id)) return;
    this.#done.add(run.id);
    run.status = status;
    run.finishedAt = this.#now();
    this.#syncMetrics(run);
    this.#save(run);
    this.#publish(run, { type: 'run.finished', payload: { run: structuredClone(run), summary } });
    this.#finishes.get(run.id)?.resolve(this.#store.getRun(run.id) ?? run);
  }

  #assertActive(runId: string): void {
    if (this.#cancelled.has(runId)) throw new Cancelled();
  }

  async #step(): Promise<void> {
    if (this.#stepMs <= 0) {
      await Promise.resolve();
      return;
    }
    await this.#sleep(this.#stepMs);
  }

  #save(run: Run): void {
    this.#store.saveRun(run);
  }
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function isTerminal(status: Run['status']): boolean {
  return status === 'finished' || status === 'failed' || status === 'cancelled';
}

function isTerminalTask(status: TaskRun['status']): boolean {
  return status === 'merged' || status === 'failed' || status === 'conflict' || status === 'cancelled';
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function planIndex(run: Run, key: string): number {
  return run.plan?.tasks.findIndex((task) => task.key === key) ?? 0;
}

function sampleFile(task: TaskSpec): string {
  const own = task.lane.owns[0] ?? 'src/index.ts';
  return own.replace(/\/\*\*$/, '/index.ts').replace(/\*+/g, 'feature');
}
