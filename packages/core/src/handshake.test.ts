import { describe, expect, test } from 'bun:test';
import type { Run } from './contracts';
import { createEventBus } from './events';
import type {
  AgentDrawerProps,
  BundleUrlFor,
  DagViewProps,
  EngineApi,
  FlockHub,
  FlockPanelProps,
  JoinInfo,
  MergeQueueProps,
  MetricsPanelProps,
  SkyViewProps,
  StartRunInput,
  WorkerHandback,
} from './handshake';
import { emptyMetrics } from './metrics';
import { MockRegistry, makeNodeInfo } from './testing';
import { MemoryStore } from './testing/memory-store';

/**
 * §8 moved into core at checkpoint C1. These are compile-time locks: each interface is instantiated
 * with a shape the consumers really use, so a field rename breaks the build here first.
 *
 * `handshake.ts` is also **types only** — the runtime test below asserts it emits nothing, which is
 * what lets `@starling/core/browser` include it.
 */
function sampleRun(): Run {
  return {
    id: 'run-1',
    goal: {
      id: 'goal-1',
      text: 'ship it',
      repoPath: '/repo',
      baseBranch: 'main',
      createdAt: 0,
      constraints: [],
    },
    tasks: {},
    status: 'running',
    startedAt: 0,
    metrics: emptyMetrics(),
  };
}

describe('the §8 handshake lives in core', () => {
  test('handshake.ts has no runtime exports', async () => {
    const mod = await import('./handshake');
    expect(Object.keys(mod)).toEqual([]);
  });

  test('EngineApi accepts a StartRunInput and returns the pieces the CLI needs', async () => {
    const input: StartRunInput = { goal: 'ship it', repoPath: '/repo', dryRun: true, maxParallel: 4 };
    const engine: EngineApi = {
      start: async (i) => ({ runId: `run-for-${i.repoPath}` }),
      cancel: async () => undefined,
      abortTask: async () => undefined,
      getRun: () => undefined,
      listRuns: () => [],
      waitForFinish: async () => sampleRun(),
    };
    expect(await engine.start(input)).toEqual({ runId: 'run-for-/repo' });
    expect(engine.getRun('nope')).toBeUndefined();
  });

  test('FlockHub exposes the registry, join info and token check', async () => {
    const join: JoinInfo = {
      code: 'ABCD-1234',
      hubUrl: 'http://hub.local:7777',
      command: 'starling perch --hub http://hub.local:7777 --code ABCD-1234',
    };
    const registry = new MockRegistry();
    const hub: FlockHub = {
      registry,
      joinInfo: () => join,
      verifyToken: (token) => token === join.code,
      register: async ({ info }) => ({ nodeId: info.id }),
      heartbeat: () => undefined,
      bundle: async (ref) => ({ path: `/tmp/${ref}.bundle` }),
      setActiveRepo: () => undefined,
      close: async () => undefined,
    };
    expect(hub.verifyToken(join.code)).toBe(true);
    expect(hub.verifyToken(undefined)).toBe(false);
    expect((await hub.register({ url: 'http://air:7778', info: makeNodeInfo() })).nodeId).toBeTruthy();
  });

  test('BundleUrlFor returns a URL and a token', () => {
    const bundleUrlFor: BundleUrlFor = (ref) => ({
      url: `http://hub.local:7777/api/flock/bundle?ref=${ref}`,
      token: 'ABCD-1234',
    });
    expect(bundleUrlFor('main').token).toBe('ABCD-1234');
  });

  test('the six web feature props accept exactly the data the shell has', () => {
    const run = sampleRun();
    const bus = createEventBus();
    const store = new MemoryStore();
    expect(bus).toBeDefined();
    expect(store.listRuns()).toEqual([]);

    const sky: SkyViewProps = {
      run,
      nodes: [makeNodeInfo()],
      recent: [],
      selectedTask: 'theme',
      onSelectTask: () => undefined,
      reducedMotion: true,
    };
    const dag: DagViewProps = { plan: run.plan, tasks: run.tasks, onSelectTask: () => undefined };
    const drawer: AgentDrawerProps = {
      events: [],
      verdicts: [],
      onClose: () => undefined,
    };
    const queue: MergeQueueProps = {
      plan: run.plan,
      tasks: run.tasks,
      merges: [],
      onSelectTask: () => undefined,
    };
    // C1 amendments: `live` (Epic 26) and `onSelectTask` (Epic 32) are optional, so old callers compile.
    const metrics: MetricsPanelProps = { metrics: run.metrics, history: [], live: true };
    const metricsOld: MetricsPanelProps = { metrics: run.metrics, history: [] };
    const flock: FlockPanelProps = { nodes: [], tasks: {}, onSelectTask: () => undefined };
    const flockOld: FlockPanelProps = { nodes: [], tasks: {} };

    expect(sky.nodes).toHaveLength(1);
    expect(dag.selectedTask).toBeUndefined();
    expect(drawer.events).toEqual([]);
    expect(queue.merges).toEqual([]);
    expect(metrics.live).toBe(true);
    expect(metricsOld.live).toBeUndefined();
    expect(flock.onSelectTask).toBeDefined();
    expect(flockOld.onSelectTask).toBeUndefined();
  });

  test('WorkerHandback is the block prompts parses and the UI shows', () => {
    const handback: WorkerHandback = {
      status: 'complete',
      summary: 'Added the CSV export',
      filesChanged: ['src/csv.ts'],
      testsAdded: ['src/csv.test.ts'],
    };
    expect(handback.status).toBe('complete');
    const partial: WorkerHandback = { ...handback, status: 'partial', notes: 'lint still red' };
    expect(partial.notes).toBe('lint still red');
  });
});
