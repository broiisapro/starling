/**
 * Shared harness for the security probes (Epic 69).
 *
 * Every probe in this directory attacks a *real* component: the hub server from `apps/server`, the
 * perch app, the flock hub, the auditor's lane check. Nothing here is mocked except the pieces that
 * would otherwise need the network (an `ExecutionNode`, the remote-node event stream, git remotes),
 * because the point is to prove behaviour, not to re-test a fake.
 *
 * Imports use relative paths into each package's public entry (`src/index.ts`) instead of the
 * `@starling/*` specifiers: `tools/` is not a bun workspace, so it has no `node_modules` links of its
 * own. Every probe still only touches a package's exported surface.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineApi, ServerDeps } from '../../apps/server/src/index.ts';
import { startServer } from '../../apps/server/src/index.ts';
import type {
  EventBus,
  ExecutionNode,
  NodeInfo,
  StarlingEvent,
  StartTaskOptions,
  Store,
  TaskHandle,
} from '../../packages/core/src/index.ts';
import { createEventBus, exec, systemClock } from '../../packages/core/src/index.ts';
import { MemoryStore, MockNode, makeNodeInfo } from '../../packages/core/src/testing/index.ts';
import type { FlockRegistry } from '../../packages/flock/src/index.ts';
import { createFlockHub, createRegistry } from '../../packages/flock/src/index.ts';

/** The join code every flock probe uses. Fictional, and asserted absent from logs/recordings. */
export const PROBE_CODE = 'PROB-ECOD';

/** The recorded launch-day run, used by the replay probes instead of inventing an event stream. */
export const FIXTURE_PATH = join(import.meta.dir, '../../fixtures/runs/sky-todo-launch-day.jsonl');

/** Where the probes put temp repos, worktrees and `webDist` trees. */
export function probeTempDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `starling-probe-${label}-`));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run git and throw with stderr on failure. Probes only ever build throwaway repos with this. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await exec(['git', ...args], { cwd, timeoutMs: 20_000 });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/**
 * A repo with one commit on `main`, a `.env`-shaped secret and a task-shaped branch. Deliberately
 * small: the interesting part of every probe is what the *server* does with the request.
 */
export async function makeRepo(prefix = 'repo'): Promise<string> {
  const parent = await probeTempDir(prefix);
  const repo = join(parent, 'repo');
  await git(parent, 'init', '-b', 'main', repo);
  await git(repo, 'config', 'user.email', 'probe@starling.local');
  await git(repo, 'config', 'user.name', 'Probe');
  await Bun.write(join(repo, 'README.md'), '# probe repo\n');
  await Bun.write(join(repo, '.env'), 'PROBE_API_KEY=sk-should-never-be-recorded\n');
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-m', 'initial commit');
  await git(repo, 'branch', 'starling/probe/integration');
  return repo;
}

export interface ProbeEngine extends EngineApi {
  readonly started: unknown[];
}

/** An `EngineApi` that records starts and never runs anything. */
export function fakeEngine(): ProbeEngine {
  const started: unknown[] = [];
  return {
    started,
    async start(input) {
      started.push(input);
      return { runId: '01probe-run-0000000000000000' };
    },
    async cancel() {},
    async abortTask() {},
    getRun: () => undefined,
    listRuns: () => [],
    async waitForFinish() {
      throw new Error('probe engine never finishes a run');
    },
  };
}

export interface ProbeHarness {
  url: string;
  port: number;
  store: Store;
  bus: EventBus;
  engine: ProbeEngine;
  stop(): void;
}

export interface ProbeServerOptions {
  store?: Store;
  bus?: EventBus;
  engine?: ProbeEngine;
  flock?: ServerDeps['flock'];
  replay?: ServerDeps['replay'];
  webDist?: string;
}

/** Bind the real hub app on an ephemeral loopback port, exactly as `startServer` does in production. */
export function startProbeServer(options: ProbeServerOptions = {}): ProbeHarness {
  const store = options.store ?? new MemoryStore();
  const bus = options.bus ?? createEventBus();
  const engine = options.engine ?? fakeEngine();
  const deps: ServerDeps = {
    engine,
    store,
    bus,
    version: '0.0.0-probe',
    ...(options.flock === undefined ? {} : { flock: options.flock }),
    ...(options.replay === undefined ? {} : { replay: options.replay }),
    ...(options.webDist === undefined ? {} : { webDist: options.webDist }),
  };
  const handle = startServer(deps, { port: 0, hostname: '127.0.0.1' });
  return {
    url: handle.url,
    port: handle.port,
    store,
    bus,
    engine,
    stop: () => handle.stop(),
  };
}

export interface HubHarness {
  hub: ReturnType<typeof createFlockHub>;
  registry: FlockRegistry;
  repo: string;
  bundleDir: string;
  parent: string;
  close(): Promise<void>;
}

/**
 * The real `FlockHub` over a throwaway repo, with a registry whose only node is the hub itself.
 *
 * The injected `fetch` throws: no probe in this directory is allowed to reach a socket that is not
 * one of our own `Bun.serve({ port: 0 })` listeners.
 */
export async function makeHubHarness(options: { code?: string; repo?: string } = {}): Promise<HubHarness> {
  const repo = options.repo ?? (await makeRepo('hub'));
  const parent = join(repo, '..');
  const bundleDir = join(parent, 'bundles');
  const registry = createRegistry({ clock: systemClock, offlineAfterMs: 15_000, autoSweep: false });
  const hubInfo: NodeInfo = makeNodeInfo({ id: 'hub', kind: 'local', name: 'Probe Hub', url: undefined });
  registry.add(new MockNode({ id: 'hub' }), hubInfo);

  const hub = createFlockHub({
    registry,
    hubUrl: 'http://127.0.0.1:7777',
    code: options.code ?? PROBE_CODE,
    bundleDir,
    clock: systemClock,
    fetch: (async () => {
      throw new Error('probe: the flock hub must not reach a real socket');
    }) as unknown as typeof fetch,
  });
  hub.setActiveRepo(repo);

  return {
    hub,
    registry,
    repo,
    bundleDir,
    parent,
    close: async () => {
      await hub.close();
      registry.close();
    },
  };
}

export function nodeInfo(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return makeNodeInfo({ id: 'perch-probe', name: 'Probe Perch', kind: 'remote', ...overrides });
}

/**
 * An `ExecutionNode` that accepts everything and records what the perch forwarded. Used where the
 * probe is about the *HTTP boundary* (validation, body size, forwarding) rather than about git.
 */
export interface StubNode extends ExecutionNode {
  readonly startedTasks: StartTaskOptions[];
}

export function stubNode(): StubNode {
  const startedTasks: StartTaskOptions[] = [];
  let handle: TaskHandle = {
    nodeId: 'perch-probe',
    runId: 'probe-run',
    taskKey: 'probe-task',
    branch: 'probe-branch',
    sessionId: 'probe-session',
  };
  return {
    id: 'perch-probe',
    startedTasks,
    info: async () => nodeInfo({ id: 'perch-probe' }),
    async startTask(options) {
      startedTasks.push(options);
      handle = {
        nodeId: 'perch-probe',
        runId: options.runId,
        taskKey: options.taskKey,
        branch: options.branch,
        sessionId: 'probe-session',
      };
      return handle;
    },
    async sendPrompt() {},
    async abort() {},
    async collect() {
      return { commit: 'probe-commit', diff: { files: [], patch: '', truncated: false }, changedFiles: [] };
    },
    async cleanup() {},
    onEvent: () => () => {},
  };
}

export function isGitBundle(bytes: Uint8Array): boolean {
  const header = new TextDecoder().decode(bytes.slice(0, 16));
  return header.startsWith('# v2 git bundle') || header.startsWith('# v3 git bundle');
}

export interface SseReader {
  status: number;
  frames: StarlingEvent[];
  waitFor(count: number, timeoutMs?: number): Promise<StarlingEvent[]>;
  close(): void;
}

/**
 * Open an SSE connection the way the dashboard does, with a reader that keeps draining. The flood
 * probes use the same helper with a reader that stalls on purpose.
 */
export async function openSse(url: string, init: RequestInit = {}): Promise<SseReader> {
  const controller = new AbortController();
  const signal = init.signal ?? controller.signal;
  const response = await fetch(url, { ...init, signal });
  const frames: StarlingEvent[] = [];
  const body = response.body;
  if (body === null) {
    return { status: response.status, frames, waitFor: async () => frames, close: () => controller.abort() };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          for (const line of block.split('\n')) {
            if (line.startsWith('data:')) {
              frames.push(JSON.parse(line.slice(5).trimStart()) as StarlingEvent);
            }
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Aborted by close(): expected for every probe.
    }
  })();

  return {
    status: response.status,
    frames,
    async waitFor(count, timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      while (frames.length < count) {
        if (Date.now() > deadline) {
          throw new Error(`timed out after ${timeoutMs}ms waiting for ${count} SSE frame(s)`);
        }
        await wait(10);
      }
      return frames;
    },
    close: () => controller.abort(),
  };
}
