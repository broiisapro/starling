/**
 * `dev:live` — a real dashboard server with no LLM, no worktrees and no opencode.
 *
 * `bun run dev:live` (in `apps/server`) starts the same `startDashboard` surface Epic 40 uses, but the
 * engine is an in-process scripted double: it emits a realistic three-task run on the real event bus,
 * into the real `MemoryStore`, through the real SSE route. That makes live mode (`/api/runs`,
 * `/api/events`, `/api/flock/join`, `/api/config/public`, lazy diffs) exercisable on a plane, and it is
 * the fixture the Epic 41 definition of done uses for `curl -N localhost:7777/api/events`.
 *
 * Everything that is fake here is fake *only* here: the engine, the flock registry, and the diff
 * payloads the real engine does not publish yet (see `docs/epic-41-live-dashboard.md`).
 */
import type {
  AgentEventKind,
  AuditVerdict,
  DiffSummary,
  EventBus,
  NodeRegistry,
  Run,
  StarlingEvent,
  TaskRun,
  TaskStatus,
} from '@starling/core';
import { createEventBus, emptyMetrics, newId, withCall } from '@starling/core';
import {
  MemoryStore,
  MockNode,
  MockRegistry,
  makeAgentEvent,
  makeAuditVerdict,
  makeGoal,
  makeNodeInfo,
  makePlan,
  makeRun,
  makeTaskRun,
  makeTaskSpec,
} from '@starling/core/testing';
import { DEFAULT_PORT, type ServerHandle } from './app';
import { startDashboard } from './dashboard';
import type { EngineApi, FlockHub, JoinInfo, StartRunInput } from './handshake';

const MODEL = { provider: 'opencode', model: 'deepseek-v4.1-flash' } as const;
const AUDITOR = { provider: 'ollama', model: 'qwen3.6:35b-a3b' } as const;
const JOIN: JoinInfo = {
  code: 'DEMO-4A7C',
  hubUrl: `http://localhost:${DEFAULT_PORT}`,
  command: `starling perch --hub http://localhost:${DEFAULT_PORT} --code DEMO-4A7C`,
};

const TASK_KEYS = ['theme', 'search', 'csv-export'] as const;
type TaskKey = (typeof TASK_KEYS)[number];

const DIFFS: Record<TaskKey, DiffSummary> = {
  theme: {
    files: [{ path: 'src/theme.ts', added: 46, removed: 2 }],
    patch: '+++ b/src/theme.ts\n+export function applyTheme(theme: "dark" | "light") { … }',
    truncated: false,
  },
  search: {
    files: [{ path: 'src/search.ts', added: 31, removed: 4 }],
    patch: '+++ b/src/search.ts\n+export function filterTodos(todos: Todo[], query: string) { … }',
    truncated: false,
  },
  'csv-export': {
    files: [
      { path: 'src/export/csv.ts', added: 28, removed: 0 },
      { path: 'src/ui/header.ts', added: 7, removed: 1 },
    ],
    patch: '+++ b/src/export/csv.ts\n+export function toCsv(todos: Todo[]): string { … }',
    truncated: false,
  },
};

const AGENT_LINES: Record<TaskKey, [AgentEventKind, Record<string, unknown>][]> = {
  theme: [
    ['session.started', { model: MODEL.model }],
    ['text', { text: 'Reading src/main.ts and the existing CSS variables before adding a theme.' }],
    ['tool.call', { tool: 'read', input: { path: 'src/main.ts' } }],
    ['file.edited', { path: 'src/theme.ts', added: 46 }],
    ['text', { text: 'Toggling twice returns to light mode; writing the test now.' }],
  ],
  search: [
    ['session.started', { model: MODEL.model }],
    ['tool.call', { tool: 'grep', input: { pattern: 'overdue', path: 'src' } }],
    ['text', { text: 'The first cut filters on the wrong field — the auditor will catch it.' }],
    ['file.edited', { path: 'src/search.ts', added: 24 }],
  ],
  'csv-export': [
    ['session.started', { model: MODEL.model }],
    ['text', { text: 'Generating the CSV in the UI layer, no runtime dependency.' }],
    ['file.edited', { path: 'src/export/csv.ts', added: 28 }],
    ['tool.result', { tool: 'bun test', output: '14 pass, 0 fail' }],
  ],
};

interface ScriptStep {
  atMs: number;
  run(): void;
}

export interface DevLiveOptions {
  port?: number;
  /** Playback speed multiplier (default `STARLING_DEV_SPEED` or 1). */
  speed?: number;
  /** Start one run immediately (default true). */
  autoplay?: boolean;
}

/** A `FlockHub` over core's `MockRegistry`: two believable roosts and a stable join code. */
export function createDevFlock(bus: EventBus): FlockHub {
  const hub = makeNodeInfo({
    id: 'hub',
    kind: 'local',
    name: 'MacBook Pro',
    maxSessions: 8,
    localModels: [],
  });
  const air = makeNodeInfo({
    id: 'air',
    kind: 'remote',
    name: 'M2 Air',
    url: 'http://192.168.1.42:7778',
    maxSessions: 5,
    activeSessions: 1,
    memGb: 16,
    cpuCores: 8,
    localModels: ['qwen3.6:8b'],
    latencyMs: 14,
  });
  const registry = new MockRegistry([
    { node: new MockNode({ id: 'hub', info: { kind: 'local', name: 'MacBook Pro' } }), info: hub },
    { node: new MockNode({ id: 'air', info: { kind: 'remote', name: 'M2 Air' } }), info: air },
  ]);
  registry.onChange((event) => {
    const type = event.type === 'left' ? 'node.left' : event.type === 'stats' ? 'node.stats' : 'node.joined';
    const payload =
      type === 'node.left' ? { nodeId: event.node.id, reason: event.reason ?? 'left' } : { node: event.node };
    bus.publish({ type, runId: '*', ts: Date.now(), payload } as StarlingEvent);
  });
  return {
    registry: registry as NodeRegistry,
    joinInfo: () => JOIN,
    verifyToken: (token) => token === JOIN.code,
    register: async ({ info }) => {
      registry.add(new MockNode({ id: info.id, info }), info);
      return { nodeId: info.id };
    },
    heartbeat: ({ info }) => registry.update(info),
    bundle: async (ref) => {
      throw new Error(`dev-live has no repo to bundle (${ref})`);
    },
    setActiveRepo: () => {},
    close: async () => {},
  };
}

/**
 * A scripted `EngineApi`. `start()` builds a run from core's factories and schedules the same event
 * sequence a real engine would publish; there is no planner, auditor or merger behind it.
 */
export function createScriptedEngine(options: {
  store: MemoryStore;
  bus: EventBus;
  speed?: number;
}): EngineApi & { stop(): void } {
  const { store, bus } = options;
  const speed = options.speed ?? 1;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let finishWaiters: Array<(run: Run) => void> = [];

  const stop = (): void => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  };

  const start = async (input: StartRunInput): Promise<{ runId: string }> => {
    stop();
    const startedAt = Date.now();
    const goal = makeGoal({
      id: newId(),
      text: input.goal,
      repoPath: input.repoPath,
      baseBranch: input.baseBranch ?? 'main',
      createdAt: startedAt,
    });
    const specs = [
      makeTaskSpec({
        key: 'theme',
        title: 'Dark mode with a toggle',
        lane: { owns: ['src/theme.ts', 'src/ui/**'], reads: ['src/main.ts'] },
      }),
      makeTaskSpec({
        key: 'search',
        title: 'Live search filtering',
        lane: { owns: ['src/search.ts'], reads: ['src/ui/**'] },
      }),
      makeTaskSpec({
        key: 'csv-export',
        title: 'CSV export',
        dependsOn: ['theme'],
        lane: { owns: ['src/export/**'], reads: ['src/ui/**'] },
      }),
    ];
    const plan = makePlan({
      id: newId(),
      goalId: goal.id,
      summary: 'Three lane-disjoint changes to the sky-todo demo.',
      tasks: specs,
      createdAt: startedAt,
      model: MODEL,
    });
    const runId = newId();
    const tasks: Record<string, TaskRun> = {};
    for (const spec of specs) tasks[spec.key] = makeTaskRun({ runId, taskKey: spec.key });
    const run: Run = makeRun({
      id: runId,
      goal,
      plan,
      tasks,
      status: 'mapping',
      startedAt,
      integrationBranch: `starling/${runId.slice(-6)}/integration`,
      metrics: emptyMetrics(),
    });

    const publish = (event: StarlingEvent): void => {
      store.appendEvent(event);
      if (event.type === 'run.created' || event.type === 'run.finished') store.saveRun(run);
      bus.publish(event);
    };
    const save = (): void => store.saveRun(run);
    const now = (): number => Date.now();

    const transition = (key: TaskKey, to: TaskStatus, patch: Partial<TaskRun> = {}): void => {
      const task = run.tasks[key];
      if (task === undefined) return;
      const from = task.status;
      const next: TaskRun = { ...task, ...patch, status: to };
      if (to === 'running' && next.startedAt === undefined) next.startedAt = now();
      if (to === 'merged' || to === 'failed' || to === 'cancelled') next.finishedAt = now();
      run.tasks[key] = next;
      save();
      publish({ type: 'task.status', runId, ts: now(), payload: { taskKey: key, from, to, run: next } });
      touchMetrics();
    };

    const touchMetrics = (): void => {
      const all = Object.values(run.tasks);
      run.metrics = {
        ...run.metrics,
        agentsActive: all.filter((task) => task.status === 'running' || task.status === 'fixing').length,
        tasksMerged: all.filter((task) => task.status === 'merged').length,
        tasksFailed: all.filter((task) => task.status === 'failed').length,
        elapsedMs: now() - run.startedAt,
      };
      save();
      publish({ type: 'metrics', runId, ts: now(), payload: run.metrics });
    };

    const usage = (local: boolean, input = 1_400, output = 320): void => {
      run.metrics = withCall(run.metrics, {
        usage: { input, output, cached: local ? 0 : Math.round(input * 0.6) },
        model: local ? AUDITOR.model : MODEL.model,
        local,
      });
      touchMetrics();
    };

    const agentStep = (key: TaskKey): void => {
      for (const [kind, data] of AGENT_LINES[key]) {
        const event = makeAgentEvent({ runId, taskKey: key, sessionId: `ses_${key}`, kind, data, ts: now() });
        publish({ type: 'agent.event', runId, ts: event.ts, payload: event });
      }
      usage(false);
    };

    const verdict = (key: TaskKey, attempt: number, pass: boolean): AuditVerdict => {
      const base = makeAuditVerdict({
        taskKey: key,
        attempt,
        pass,
        summary: pass
          ? 'Definition of done met; tests green.'
          : 'Search filters on `due` instead of `title`.',
        model: AUDITOR,
        ts: now(),
        checks: [
          { name: 'tests', ok: pass, detail: pass ? 'bun test: 14 pass' : 'bun test: 1 fail' },
          { name: 'lane', ok: true, detail: 'no files outside the lane' },
        ],
        ...(pass ? {} : { fixInstructions: 'Filter on title and keep the empty-string case.' }),
      });
      // Dev-only: real engines do not attach a diff yet (FIX REQUEST to Epic 49). The server's
      // `/api/runs/:id/diff/:taskKey` reads it from here, so the drawer's Diff tab has real content.
      return { ...base, diff: DIFFS[key] } as AuditVerdict;
    };

    const audit = (key: TaskKey, attempt: number, pass: boolean): void => {
      usage(true, 900, 140);
      const event: StarlingEvent = {
        type: 'audit.verdict',
        runId,
        ts: now(),
        payload: verdict(key, attempt, pass),
      };
      publish(event);
      const task = run.tasks[key];
      if (task !== undefined) {
        run.tasks[key] = { ...task, attempts: attempt, lastVerdict: verdict(key, attempt, pass) };
        save();
      }
    };

    const merge = (key: TaskKey): void => {
      publish({
        type: 'merge.result',
        runId,
        ts: now(),
        payload: {
          taskKey: key,
          status: 'merged',
          conflictedFiles: [],
          commit: newId().slice(-7),
          detail: 'fast-forward onto the integration branch; tests green',
          ts: now(),
        },
      });
      transition(key, 'merged', { branch: `starling/${runId.slice(-6)}/${key}` });
    };

    // ── the timeline ────────────────────────────────────────────────────────────────────────────
    const steps: ScriptStep[] = [];
    let cursor = 0;
    const at = (delayMs: number, fn: () => void): void => {
      cursor += delayMs;
      steps.push({ atMs: cursor, run: fn });
    };

    at(0, () => {
      publish({ type: 'run.created', runId, ts: now(), payload: { run } });
    });
    at(650, () => {
      publish({
        type: 'repomap.ready',
        runId,
        ts: now(),
        payload: { files: 18, tokenEstimate: 6_400 },
      });
      run.status = 'planning';
      save();
    });
    at(700, () => {
      run.status = 'planned';
      save();
      publish({ type: 'plan.created', runId, ts: now(), payload: { plan, issues: [] } });
    });
    at(800, () => {
      run.status = 'running';
      save();
      for (const key of TASK_KEYS) transition(key, 'ready');
      transition('theme', 'running', { nodeId: 'hub' });
    });
    at(900, () => agentStep('theme'));
    at(700, () => {
      transition('theme', 'auditing');
      audit('theme', 1, true);
    });
    at(500, () => {
      transition('theme', 'merging');
      merge('theme');
    });

    at(450, () => transition('search', 'running', { nodeId: 'air' }));
    at(900, () => agentStep('search'));
    at(700, () => {
      transition('search', 'auditing');
      audit('search', 1, false);
    });
    at(600, () => transition('search', 'fixing'));
    at(900, () => {
      agentStep('search');
      transition('search', 'auditing');
      audit('search', 2, true);
    });
    at(500, () => {
      transition('search', 'merging');
      merge('search');
    });

    at(350, () => transition('csv-export', 'running', { nodeId: 'hub' }));
    at(1_000, () => agentStep('csv-export'));
    at(700, () => {
      transition('csv-export', 'auditing');
      audit('csv-export', 1, true);
    });
    at(500, () => {
      transition('csv-export', 'merging');
      merge('csv-export');
    });

    at(500, () => {
      run.status = 'finished';
      run.finishedAt = now();
      touchMetrics();
      publish({
        type: 'run.finished',
        runId,
        ts: now(),
        payload: {
          run,
          summary:
            '3 tasks merged into the integration branch; 14 tests green. No API key, no worktree — this is the dashboard rehearsal.',
        },
      });
      const waiters = finishWaiters;
      finishWaiters = [];
      for (const waiter of waiters) waiter(structuredClone(run));
    });

    for (const step of steps) {
      const delay = Math.max(0, Math.round(step.atMs / speed));
      const timer = setTimeout(() => {
        if (run.status !== 'cancelled') step.run();
      }, delay);
      timer.unref?.();
      timers.push(timer);
    }

    return { runId };
  };

  return {
    start,
    async cancel(runId) {
      stop();
      const run = store.getRun(runId);
      if (run === undefined) return;
      run.status = 'cancelled';
      store.saveRun(run);
      bus.publish({ type: 'run.finished', runId, ts: Date.now(), payload: { run, summary: 'cancelled' } });
    },
    async abortTask(runId, taskKey) {
      const run = store.getRun(runId);
      const task = run?.tasks[taskKey];
      if (run === undefined || task === undefined) return;
      task.status = 'cancelled';
      task.finishedAt = Date.now();
      store.saveRun(run);
      bus.publish({
        type: 'task.status',
        runId,
        ts: Date.now(),
        payload: { taskKey, from: 'running', to: 'cancelled', run: task },
      });
    },
    getRun: (runId) => store.getRun(runId),
    listRuns: () => store.listRuns(),
    waitForFinish: (runId) =>
      new Promise<Run>((resolve) => {
        const current = store.getRun(runId);
        if (current?.status === 'finished' || current?.status === 'cancelled') {
          resolve(current);
          return;
        }
        finishWaiters.push(resolve);
      }),
    stop,
  };
}

export interface DevLiveServer {
  url: string;
  port: number;
  runId: string | undefined;
  handle: ServerHandle;
  stop(): void;
}

/** Compose the scripted engine, flock and dashboard. Used by `main` and by the dev-live test. */
export function startDevLive(options: DevLiveOptions = {}): DevLiveServer {
  const store = new MemoryStore();
  const bus = createEventBus();
  const envSpeed = Number(process.env.STARLING_DEV_SPEED);
  const speed = options.speed ?? (Number.isFinite(envSpeed) && envSpeed > 0 ? envSpeed : 1);
  const engine = createScriptedEngine({ store, bus, speed });
  const flock = createDevFlock(bus);

  const handle = startDashboard({
    engine,
    store,
    bus,
    flock,
    port: options.port ?? Number(process.env.STARLING_PORT ?? DEFAULT_PORT),
    publicConfig: { profile: process.env.STARLING_LLM_PROFILE ?? 'opencode' },
    repoRoot: process.cwd(),
  });

  // Seed the flock backlog so a dashboard that connects before the first run still shows two roosts.
  for (const node of flock.registry.list()) {
    const event: StarlingEvent = { type: 'node.joined', runId: '*', ts: Date.now(), payload: { node } };
    store.appendEvent(event);
    bus.publish(event);
  }

  let runId: string | undefined;
  if (options.autoplay !== false) {
    void engine
      .start({
        goal: 'Add dark mode, live search and CSV export to sky-todo, and fix the overdue dates',
        repoPath: 'examples/sky-todo',
      })
      .then((started) => {
        runId = started.runId;
      });
  }

  return {
    url: handle.url,
    port: handle.port,
    get runId() {
      return runId;
    },
    handle,
    stop: () => {
      engine.stop();
      handle.stop();
    },
  };
}

if (import.meta.main) {
  const live = startDevLive();
  // An app boundary: the dev script is allowed to print.
  console.log(`Starling live dashboard (scripted engine) on ${live.url} 🐦`);
  console.log(`  REST   ${live.url}/api/runs`);
  console.log(`  SSE    ${live.url}/api/events`);
  console.log(`  config ${live.url}/api/config/public`);
  console.log('  no LLM, no worktrees — Ctrl-C to stop.');
}
