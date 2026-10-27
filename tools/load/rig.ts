/**
 * The load rig: the **real** engine, store, workspace, auditor and merger wired over a generated
 * repo, with a mocked planner model and replay agents. Nothing here talks to a network.
 *
 * ```ts
 * const rig = await createLoadRig({ maxParallel: 20 });
 * const runId = await rig.startRun();
 * const run = await rig.finish(runId);
 * await rig.dispose();
 * ```
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createAuditor } from '../../packages/auditor/src/index.ts';
import type {
  EventBus,
  Merger,
  ModelRef,
  Plan,
  PlanIssue,
  RepoMap,
  Run,
  StarlingEvent,
  TaskStatus,
} from '../../packages/core/src/index.ts';
import { createEventBus, StarlingConfigSchema, systemClock } from '../../packages/core/src/index.ts';
import { MockLLM, NoopTracker } from '../../packages/core/src/testing/index.ts';
import type { EngineApi, StartRunInput } from '../../packages/engine/src/handshake.ts';
import { createEngine } from '../../packages/engine/src/index.ts';
import type { FlockRegistry, LocalNode } from '../../packages/flock/src/index.ts';
import { createLocalNode, createRegistry, createScheduler } from '../../packages/flock/src/index.ts';
import type { MergerService } from '../../packages/merger/src/index.ts';
import { createMergeQueue, createMerger } from '../../packages/merger/src/index.ts';
import { createPlanner } from '../../packages/planner/src/index.ts';
import { createPromptCompiler } from '../../packages/prompts/src/index.ts';
import { createRepoMapper } from '../../packages/repomap/src/index.ts';
import { attachRecorder, createSqliteStore } from '../../packages/store/src/index.ts';
import { createWorkspace } from '../../packages/workspace/src/index.ts';
import { type InstrumentedStore, instrumentStore } from './instrument.ts';
import { buildPlanDraft, buildScriptedEvents, fileForTask, LOAD_MODEL, TASK_COUNT } from './plan.ts';
import { createGeneratedRepo, type GeneratedRepo } from './repo.ts';
import { createReplayFleetRunner, type ReplayFleetRunner } from './runner.ts';

export interface LoadRigOptions {
  taskCount?: number;
  maxParallel?: number;
  /** Recorded time is divided by this: 4 means a 1.6 s transcript plays in 0.4 s. */
  replaySpeed?: number;
  eventsPerTask?: number;
  /**
   * Extra session slots on the LocalNode above `maxParallel`.
   *
   * Workaround for an engine bug this load test found: a task's slot is released when it transitions
   * to `merged`, but the node session is only cleaned up on the next line, so the dispatcher can
   * start a new task while the old session still holds a slot. With zero headroom LocalNode answers
   * `at capacity` and the engine fails that task. See the FIX REQUEST in
   * `docs/epic-70-load-test.md`; set 0 to reproduce it.
   */
  sessionHeadroom?: number;
  /**
   * Also call `attachRecorder(bus, store)`, the store package's documented persistence hook.
   *
   * The engine already writes every event to the store in `publish()`, so doing both doubles every
   * write and every stored row. Default false (one writer). Set true to reproduce the conflict.
   */
  doubleRecord?: boolean;
  /** Retime replayed agent events to the wall clock (default true; false shows the raw timestamps). */
  retimeReplayEvents?: boolean;
  /**
   * Route engine merges through `MergerService.queue()`. Default true: that is the intended
   * production shape and it makes "merge queue time" measurable. Set false to reproduce the
   * unsynchronised path the engine uses today (see `docs/epic-70-load-test.md`).
   */
  serialiseMerges?: boolean;
}

export interface TaskTiming {
  key: string;
  status: TaskStatus;
  readyAt?: number;
  runningAt?: number;
  auditingAt?: number;
  mergingAt?: number;
  terminalAt?: number;
}

export interface EventObservation {
  /** Bus receive times (performance.now), one per event. */
  receivedAt: number[];
  byType: Record<string, number>;
  agentEvents: number;
  errors: string[];
}

export interface LoadRig {
  repo: GeneratedRepo;
  engine: EngineApi;
  store: InstrumentedStore;
  bus: EventBus;
  merger: MergerService;
  runner: ReplayFleetRunner;
  node: LocalNode;
  registry: FlockRegistry;
  events: EventObservation;
  timings: Map<string, TaskTiming>;
  plan?: Plan;
  issues: PlanIssue[];
  map?: RepoMap;
  /** What the real repo mapper detected in the generated repo. */
  testCommand?: string;
  /** LocalNode's advertised cap: `maxParallel + sessionHeadroom`. */
  nodeMaxSessions: number;
  sessionHeadroom: number;
  retimeReplayEvents: boolean;
  /** Per-task audit latency (auditing → verdict). */
  auditMs: number[];
  /** Per-task merge latency (merging → merge.result), including serial queue wait. */
  mergeMs: number[];
  /** Time the merge service itself took after being dequeued, per task. */
  mergeServiceMs: number[];
  /** Queue wait = mergeMs − mergeServiceMs, per task. */
  mergeQueueWaitMs: number[];
  /** Highest `LocalNode.activeSessions()` sampled during the run. */
  readonly peakSessions: number;
  startRun(input?: Partial<StartRunInput>): Promise<string>;
  finish(runId: string, timeoutMs?: number): Promise<Run>;
  dbBytes(): Promise<number>;
  dispose(): Promise<void>;
}

const GOAL =
  'Ship thirty lane-disjoint improvements to the load target. Stay inside each task lane and keep tests green.';

function nowMs(): number {
  return performance.now();
}

function planModel(): ModelRef {
  return LOAD_MODEL;
}

export async function createLoadRig(options: LoadRigOptions = {}): Promise<LoadRig> {
  const taskCount = options.taskCount ?? TASK_COUNT;
  const maxParallel = options.maxParallel ?? 20;
  const replaySpeed = options.replaySpeed ?? 4;
  const eventsPerTask = options.eventsPerTask ?? 300;
  const sessionHeadroom = options.sessionHeadroom ?? 4;
  const serialiseMerges = options.serialiseMerges ?? true;
  const doubleRecord = options.doubleRecord ?? false;
  const retimeReplayEvents = options.retimeReplayEvents ?? true;

  const repo = await createGeneratedRepo();

  const config = StarlingConfigSchema.parse({
    maxParallel,
    maxAttempts: 2,
    baseBranch: 'main',
    integrationBranch: 'auto',
    worktreeRoot: repo.worktreeRoot,
    testCommand: 'auto',
    budget: { maxUsd: 100 },
    flock: { enabled: true, hubMaxSessions: maxParallel + sessionHeadroom, mdns: false },
    models: {
      planner: planModel(),
      worker: LOAD_MODEL,
      auditor: { provider: 'starling', model: 'deterministic' },
      writer: { provider: 'starling', model: 'deterministic' },
    },
  });

  const bus = createEventBus();
  const innerStore = createSqliteStore(repo.dbPath);
  const store = instrumentStore(innerStore);
  // The engine persists events itself (`RunDriver.publish`) before publishing them on the bus.
  // `attachRecorder` is the store package's documented hook for the same job, so wiring both writes
  // every event twice. Opt in only to measure the conflict.
  if (doubleRecord) attachRecorder(bus, store.store);

  const plannerModel = new MockLLM({
    model: planModel(),
    local: false,
    responder: () => ({ parsed: buildPlanDraft(taskCount), text: '', model: planModel(), local: false }),
  });
  // The real planner validates and normalises the draft; `maxTasks: 12` is the package's ceiling,
  // so a 30-task plan returns one advisory warning and still runs (see the epic doc).
  const planner = createPlanner({ llm: plannerModel, maxTasks: 12 });

  const workspace = createWorkspace({ worktreeRoot: repo.worktreeRoot });
  const merger = createMerger({ worktreeRoot: repo.worktreeRoot, testTimeoutMs: 120_000 });
  const mergeServiceMs: number[] = [];
  const mergeQueueWaitMs: number[] = [];
  const serviceByTask = new Map<string, number>();
  const mergeQueue = createMergeQueue({
    clock: systemClock,
    merge: async (repoPath, integrationBranch, task, mergeOptions) => {
      const started = performance.now();
      try {
        return await merger.merge(repoPath, integrationBranch, task, mergeOptions);
      } finally {
        const elapsed = performance.now() - started;
        mergeServiceMs.push(elapsed);
        serviceByTask.set(task.taskKey, elapsed);
      }
    },
  });

  const mergerPort: Merger = serialiseMerges
    ? {
        merge: async (repoPath, integrationBranch, task, mergeOptions) => {
          const enqueuedAt = performance.now();
          const result = await mergeQueue.enqueue(repoPath, integrationBranch, task, mergeOptions);
          const total = performance.now() - enqueuedAt;
          mergeQueueWaitMs.push(Math.max(0, total - (serviceByTask.get(task.taskKey) ?? 0)));
          return result;
        },
      }
    : {
        merge: async (repoPath, integrationBranch, task, mergeOptions) => {
          const started = performance.now();
          try {
            return await merger.merge(repoPath, integrationBranch, task, mergeOptions);
          } finally {
            mergeServiceMs.push(performance.now() - started);
            mergeQueueWaitMs.push(0);
          }
        },
      };

  const runner = createReplayFleetRunner({
    eventsFor: (taskKey) =>
      buildScriptedEvents(taskKey, {
        count: eventsPerTask,
        seed: taskKey.length * 17 + taskKey.charCodeAt(2),
      }),
    speed: replaySpeed,
    retime: retimeReplayEvents,
    onStart: async ({ taskKey, dir }) => {
      const path = join(dir, fileForTask(taskKey));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, simulatedFile(taskKey), 'utf8');
    },
  });

  const node = createLocalNode({
    id: 'hub',
    name: 'Load Hub',
    workspace,
    runner,
    maxSessions: maxParallel + sessionHeadroom,
    worktreeRoot: repo.worktreeRoot,
  });

  const registry = createRegistry({
    clock: systemClock,
    offlineAfterMs: 60_000,
    autoSweep: false,
  });
  registry.add(node, await node.info());

  // `LocalNode.activeSessions()` is the only honest view of how many agent sessions were open;
  // task statuses are not enough because a merged task's session lives until `cleanup`.
  let peakSessions = 0;
  const sessionTimer = setInterval(() => {
    peakSessions = Math.max(peakSessions, node.activeSessions());
  }, 5);
  sessionTimer.unref?.();

  const events: EventObservation = { receivedAt: [], byType: {}, agentEvents: 0, errors: [] };
  const timings = new Map<string, TaskTiming>();
  const auditMs: number[] = [];
  const mergeMs: number[] = [];
  const issues: PlanIssue[] = [];
  let plan: Plan | undefined;
  let map: RepoMap | undefined;
  let disposed = false;

  const timingFor = (key: string): TaskTiming => {
    const existing = timings.get(key);
    if (existing !== undefined) return existing;
    const created: TaskTiming = { key, status: 'pending' };
    timings.set(key, created);
    return created;
  };

  bus.subscribe((event: StarlingEvent) => {
    events.receivedAt.push(nowMs());
    events.byType[event.type] = (events.byType[event.type] ?? 0) + 1;

    switch (event.type) {
      case 'repomap.ready':
        return;
      case 'plan.created':
        plan = event.payload.plan;
        issues.push(...event.payload.issues);
        return;
      case 'agent.event': {
        events.agentEvents += 1;
        return;
      }
      case 'task.status': {
        const { taskKey, to } = event.payload;
        const timing = timingFor(taskKey);
        timing.status = to;
        const at = nowMs();
        if (to === 'ready' && timing.readyAt === undefined) timing.readyAt = at;
        if (to === 'running' && timing.runningAt === undefined) timing.runningAt = at;
        if (to === 'auditing') timing.auditingAt = at;
        if (to === 'merging') timing.mergingAt = at;
        if (to === 'merged' || to === 'failed' || to === 'cancelled' || to === 'conflict') {
          timing.terminalAt = at;
        }
        return;
      }
      case 'audit.verdict': {
        const timing = timingFor(event.payload.taskKey);
        if (timing.auditingAt !== undefined) auditMs.push(nowMs() - timing.auditingAt);
        return;
      }
      case 'merge.result': {
        const timing = timingFor(event.payload.taskKey);
        if (timing.mergingAt !== undefined) mergeMs.push(nowMs() - timing.mergingAt);
        return;
      }
      case 'log': {
        if (event.payload.level === 'error') events.errors.push(event.payload.msg);
        return;
      }
      default:
        return;
    }
  });

  const auditor = createAuditor({ commandTimeoutMs: 60_000 });

  const engine = createEngine({
    config,
    bus,
    store: store.store,
    clock: systemClock,
    repoMapper: {
      async map(repoPath) {
        map = await createRepoMapper().map(repoPath);
        return map;
      },
    },
    planner,
    prompts: createPromptCompiler(),
    workspace,
    registry,
    scheduler: createScheduler({ hubId: 'hub' }),
    auditor,
    merger: mergerPort,
    tracker: new NoopTracker(),
    strictTransitions: true,
  });

  const startRun = async (input: Partial<StartRunInput> = {}): Promise<string> => {
    const { runId } = await engine.start({
      goal: GOAL,
      repoPath: repo.repo,
      maxParallel,
      baseBranch: 'main',
      ...input,
    });
    return runId;
  };

  const finish = async (runId: string, timeoutMs = 180_000): Promise<Run> => {
    return withTimeout(engine.waitForFinish(runId), timeoutMs, `run ${runId} did not finish`);
  };

  const dbBytes = async (): Promise<number> => {
    let total = 0;
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        total += (await stat(`${repo.dbPath}${suffix}`)).size;
      } catch {
        // The WAL/shm files only exist while the database is open; missing is zero bytes.
      }
    }
    return total;
  };

  return {
    repo,
    engine,
    store,
    bus,
    merger,
    runner,
    node,
    registry,
    events,
    timings,
    get plan() {
      return plan;
    },
    issues,
    get map() {
      return map;
    },
    get testCommand() {
      return map?.testCommand;
    },
    nodeMaxSessions: maxParallel + sessionHeadroom,
    sessionHeadroom,
    retimeReplayEvents,
    auditMs,
    mergeMs,
    mergeServiceMs,
    mergeQueueWaitMs,
    get peakSessions() {
      return peakSessions;
    },
    startRun,
    finish,
    dbBytes,
    async dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(sessionTimer);
      await node.close();
      await runner.close();
      registry.close();
      try {
        await merger.dispose();
      } finally {
        store.close();
        innerStore.close();
        await repo.cleanup();
      }
    },
  };
}

/** A tiny deterministic implementation file per task; the agent's "work". */
export function simulatedFile(taskKey: string): string {
  return `/** ${taskKey}: generated by tools/load. */\nexport const task = '${taskKey}';\nexport function run(): string {\n  return \`\${task} ok\`;\n}\n`;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}
