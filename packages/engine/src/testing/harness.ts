/**
 * Test harness for the engine. Not exported from the package index: it is only imported by the
 * engine's own tests, which drive the real state machine over core's doubles.
 */
import { readFileSync } from 'node:fs';
import type {
  LLM,
  Plan,
  PlanIssue,
  Run,
  Scheduler,
  StarlingConfig,
  StarlingEvent,
  TaskSpec,
} from '@starling/core';
import { createEventBus, FakeClock, StarlingConfigSchema } from '@starling/core';
import {
  immediateScheduler,
  MemoryStore,
  MockAuditor,
  MockMerger,
  MockNode,
  MockPlanner,
  MockPromptCompiler,
  MockRegistry,
  MockRepoMapper,
  MockScheduler,
  MockWorkspace,
  makePlan,
  makeRepoMap,
  makeTaskSpec,
  NoopTracker,
} from '@starling/core/testing';
import { createEngine } from '../engine';
import type { EngineApi, StartRunInput } from '../handshake';
import type { Timers } from '../metrics';
import type { EngineDeps } from '../types';

export const FIXTURE_PLAN_PATH = new URL(
  '../../../../fixtures/plans/sky-todo-launch-day.json',
  import.meta.url,
);

export function loadFixturePlan(): Plan {
  return JSON.parse(readFileSync(FIXTURE_PLAN_PATH, 'utf8')) as Plan;
}

export function makeConfig(overrides: Record<string, unknown> = {}): StarlingConfig {
  return StarlingConfigSchema.parse(overrides);
}

/** A controllable `Timers` double: `fireHeartbeat()` runs whatever the publisher registered. */
export class FakeTimers implements Timers {
  #callbacks = new Set<() => void>();
  #timeouts = new Set<{ fn: () => void }>();
  intervalMs: number | undefined;

  setInterval(fn: () => void, ms: number): unknown {
    this.intervalMs = ms;
    this.#callbacks.add(fn);
    return fn;
  }

  clearInterval(handle: unknown): void {
    this.#callbacks.delete(handle as () => void);
  }

  setTimeout(fn: () => void, _ms: number): unknown {
    const entry = { fn };
    this.#timeouts.add(entry);
    return entry;
  }

  clearTimeout(handle: unknown): void {
    this.#timeouts.delete(handle as { fn: () => void });
  }

  fireHeartbeat(): void {
    for (const fn of [...this.#callbacks]) fn();
  }

  /** Fire every pending timeout once (stall watchdogs), then forget it. */
  fireTimeouts(): void {
    const pending = [...this.#timeouts];
    this.#timeouts.clear();
    for (const entry of pending) entry.fn();
  }

  get active(): number {
    return this.#callbacks.size;
  }

  get pendingTimeouts(): number {
    return this.#timeouts.size;
  }
}

export interface HarnessOptions {
  plan?: Plan;
  issues?: PlanIssue[];
  audit?: MockAuditor;
  merger?: MockMerger;
  scheduler?: Scheduler;
  config?: Record<string, unknown>;
  nodes?: MockNode[];
  /** Per-node registry overrides (maxSessions, kind, latency…). */
  nodeInfo?: Record<string, Partial<import('@starling/core').NodeInfo>>;
  writer?: LLM;
  bundleUrlFor?: EngineDeps['bundleUrlFor'];
  tracker?: NoopTracker;
  timers?: Timers;
  strictTransitions?: boolean;
  policies?: EngineDeps['policies'];
  worktreePathFor?: EngineDeps['worktreePathFor'];
}

export interface Harness {
  engine: EngineApi;
  deps: EngineDeps;
  bus: ReturnType<typeof createEventBus>;
  store: MemoryStore;
  clock: FakeClock;
  registry: MockRegistry;
  workspace: MockWorkspace;
  prompts: MockPromptCompiler;
  planner: MockPlanner;
  auditor: MockAuditor;
  merger: MockMerger;
  scheduler: Scheduler;
  tracker: NoopTracker;
  nodes: MockNode[];
  events: StarlingEvent[];
  start(input?: Partial<StartRunInput>): Promise<string>;
  finish(input?: Partial<StartRunInput>): Promise<Run>;
  statusEvents(): Array<{ taskKey: string; from: string; to: string }>;
  ofType<T extends StarlingEvent['type']>(type: T): Array<Extract<StarlingEvent, { type: T }>>;
  logs(level?: 'debug' | 'info' | 'warn' | 'error'): string[];
  /** Policy-coded log events (the additive `code` property Epic 49 adds). */
  policyLogs(code?: string): Array<{ code: string; msg: string; taskKey?: string }>;
  transitionsFor(taskKey: string): string[];
}

export const DEFAULT_INPUT: StartRunInput = {
  goal: 'Add dark mode, search, CSV export and fix the two date bugs',
  repoPath: '/tmp/sky-todo',
};

/** Five independent tasks, one gated on `dates-fix`, one gated on `shortcuts` — a small DAG. */
export function smallPlan(tasks?: TaskSpec[]): Plan {
  return makePlan({
    goalId: 'goal-small',
    tasks: tasks ?? [
      makeTaskSpec({ key: 'a', lane: { owns: ['src/a/**'], reads: [] } }),
      makeTaskSpec({ key: 'b', lane: { owns: ['src/b/**'], reads: [] } }),
      makeTaskSpec({ key: 'c', dependsOn: ['a'], lane: { owns: ['src/c/**'], reads: [] } }),
    ],
  });
}

export function buildHarness(options: HarnessOptions = {}): Harness {
  const clock = new FakeClock(1_700_000_000_000);
  const bus = createEventBus();
  const store = new MemoryStore();
  const config = makeConfig({ maxAttempts: 3, maxParallel: 8, ...options.config });
  const planner = new MockPlanner({
    results: [{ plan: options.plan ?? smallPlan(), issues: options.issues ?? [] }],
  });
  const prompts = new MockPromptCompiler();
  const workspace = new MockWorkspace();
  const tracker = options.tracker ?? new NoopTracker();
  const auditor = options.audit ?? new MockAuditor();
  const merger = options.merger ?? new MockMerger();
  const scheduler = options.scheduler ?? new MockScheduler();
  const nodes = options.nodes ?? [
    new MockNode({
      id: 'hub',
      info: { kind: 'local', name: 'hub', maxSessions: 8 },
      schedule: immediateScheduler,
    }),
  ];
  const registry = new MockRegistry();
  for (const node of nodes) {
    registry.add(node, {
      id: node.id,
      name: node.id,
      kind: node.id === 'hub' ? 'local' : 'remote',
      platform: 'darwin',
      arch: 'arm64',
      cpuCores: 12,
      memGb: 32,
      maxSessions: node.id === 'hub' ? 8 : 5,
      activeSessions: 0,
      localModels: [],
      status: 'online',
      lastSeen: clock.now(),
      latencyMs: 2,
      ...(options.nodeInfo?.[node.id] ?? {}),
    });
  }

  const deps: EngineDeps = {
    config,
    bus,
    store,
    clock,
    repoMapper: new MockRepoMapper(makeRepoMap({ testCommand: 'bun test' })),
    planner,
    prompts,
    workspace,
    registry,
    scheduler,
    auditor,
    merger,
    tracker,
    strictTransitions: options.strictTransitions ?? true,
    timers: options.timers,
    ...(options.policies === undefined ? {} : { policies: options.policies }),
    ...(options.worktreePathFor === undefined ? {} : { worktreePathFor: options.worktreePathFor }),
    ...(options.writer === undefined ? {} : { writer: options.writer }),
    ...(options.bundleUrlFor === undefined ? {} : { bundleUrlFor: options.bundleUrlFor }),
  };

  const engine = createEngine(deps);
  const events: StarlingEvent[] = [];
  bus.subscribe((event) => events.push(event));

  const start = async (input: Partial<StartRunInput> = {}): Promise<string> => {
    const { runId } = await engine.start({ ...DEFAULT_INPUT, ...input });
    return runId;
  };

  const finish = async (input: Partial<StartRunInput> = {}): Promise<Run> => {
    const runId = await start(input);
    const run = await withTimeout(engine.waitForFinish(runId));
    return run;
  };

  return {
    engine,
    deps,
    bus,
    store,
    clock,
    registry,
    workspace,
    prompts,
    planner,
    auditor,
    merger,
    scheduler,
    tracker,
    nodes,
    events,
    start,
    finish,
    statusEvents() {
      const out: Array<{ taskKey: string; from: string; to: string }> = [];
      for (const event of events) {
        if (event.type !== 'task.status') continue;
        out.push({ taskKey: event.payload.taskKey, from: event.payload.from, to: event.payload.to });
      }
      return out;
    },
    ofType(type) {
      return events.filter(
        (event): event is Extract<StarlingEvent, { type: typeof type }> => event.type === type,
      );
    },
    logs(level) {
      const out: string[] = [];
      for (const event of events) {
        if (event.type !== 'log') continue;
        if (level !== undefined && event.payload.level !== level) continue;
        out.push(event.payload.msg);
      }
      return out;
    },
    policyLogs(code) {
      const out: Array<{ code: string; msg: string; taskKey?: string }> = [];
      for (const event of events) {
        if (event.type !== 'log') continue;
        const payload = event.payload as Record<string, unknown>;
        const value = payload.code;
        if (typeof value !== 'string') continue;
        if (code !== undefined && value !== code) continue;
        out.push({
          code: value,
          msg: event.payload.msg,
          ...(event.payload.taskKey === undefined ? {} : { taskKey: event.payload.taskKey }),
        });
      }
      return out;
    },
    transitionsFor(taskKey) {
      const out: string[] = [];
      for (const event of events) {
        if (event.type !== 'task.status' || event.payload.taskKey !== taskKey) continue;
        out.push(`${event.payload.from}->${event.payload.to}`);
      }
      return out;
    },
  };
}

/** Fail the test instead of hanging when the state machine deadlocks (a real risk in a DAG run). */
export async function withTimeout<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Poll for a condition with real timers; used when a mock node schedules events asynchronously. */
export async function waitFor(condition: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${ms}ms`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

/** Every task's canonical happy-path transition list. */
export const HAPPY_SEQUENCE = [
  'pending->ready',
  'ready->running',
  'running->auditing',
  'auditing->merging',
  'merging->merged',
];
