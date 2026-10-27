/**
 * Test-only harness: fake `EngineApi` / `FlockHub`, a fully wired `ServerDeps`, and an SSE client.
 *
 * Not exported from `index.ts` — production code must never import this. Kept in `src/` so it can use
 * core's mocks without a separate tsconfig project.
 */
import type { EventBus, NodeInfo, Run, StarlingEvent } from '@starling/core';
import { createEventBus, StarlingError } from '@starling/core';
import {
  BASE_TS,
  MemoryStore,
  MockNode,
  MockRegistry,
  makeGoal,
  makeNodeInfo,
  makeRun,
} from '@starling/core/testing';
import type { Hono } from 'hono';
import type { ServerDeps, ServerOptions } from './app';
import { createApp } from './app';
import type { EngineApi, FlockHub, JoinInfo, StartRunInput } from './handshake';

export class FakeEngine implements EngineApi {
  readonly runs = new Map<string, Run>();
  readonly started: StartRunInput[] = [];
  readonly cancelled: string[] = [];
  readonly aborted: Array<{ runId: string; taskKey: string }> = [];
  startError: Error | undefined;
  /** When set, `start()` reports this id without storing a run (mirrors an engine that persists later). */
  pinnedRunId: string | undefined;

  constructor(runs: Run[] = []) {
    for (const run of runs) this.runs.set(run.id, run);
  }

  async start(input: StartRunInput): Promise<{ runId: string }> {
    this.started.push(input);
    if (this.startError !== undefined) throw this.startError;
    if (this.pinnedRunId !== undefined) return { runId: this.pinnedRunId };
    const run = makeRun({
      goal: makeGoal({ text: input.goal, repoPath: input.repoPath }),
      status: 'mapping',
    });
    this.runs.set(run.id, run);
    return { runId: run.id };
  }

  async cancel(runId: string): Promise<void> {
    this.cancelled.push(runId);
  }

  async abortTask(runId: string, taskKey: string): Promise<void> {
    this.aborted.push({ runId, taskKey });
  }

  getRun(runId: string): Run | undefined {
    return this.runs.get(runId);
  }

  listRuns(): Run[] {
    return [...this.runs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  async waitForFinish(runId: string): Promise<Run> {
    const run = this.runs.get(runId);
    if (run === undefined) throw new StarlingError('INVALID_ARGUMENT', `No run ${runId}`);
    return run;
  }
}

export interface FakeFlockOptions {
  token?: string;
  nodes?: Array<{ node: MockNode; info: Partial<NodeInfo> }>;
  bundlePath?: string;
  joinInfo?: JoinInfo;
}

export class FakeFlock implements FlockHub {
  readonly registry: MockRegistry;
  readonly registered: Array<{ url: string; info: NodeInfo }> = [];
  readonly heartbeats: Array<{ nodeId: string; info: NodeInfo }> = [];
  readonly bundled: string[] = [];
  bundlePath: string | undefined;
  readonly #token: string;
  readonly #join: JoinInfo;

  constructor(options: FakeFlockOptions = {}) {
    this.#token = options.token ?? 'TEST-CODE';
    this.bundlePath = options.bundlePath;
    this.#join = options.joinInfo ?? {
      code: this.#token,
      hubUrl: 'http://localhost:7777',
      command: `starling perch --hub http://localhost:7777 --code ${this.#token}`,
    };
    const entries = (options.nodes ?? []).map(({ node, info }) => ({
      node,
      info: makeNodeInfo({ id: node.id, lastSeen: BASE_TS, ...info }),
    }));
    this.registry = new MockRegistry(entries);
  }

  joinInfo(): JoinInfo {
    return this.#join;
  }

  verifyToken(token: string | undefined): boolean {
    return token === this.#token;
  }

  async register(input: { url: string; info: NodeInfo }): Promise<{ nodeId: string }> {
    this.registered.push(input);
    return { nodeId: input.info.id };
  }

  heartbeat(input: { nodeId: string; info: NodeInfo }): void {
    this.heartbeats.push(input);
  }

  async bundle(ref: string): Promise<{ path: string }> {
    this.bundled.push(ref);
    if (this.bundlePath === undefined) {
      throw new StarlingError('EXEC_FAILED', `No bundle produced for ${ref}`);
    }
    return { path: this.bundlePath };
  }

  setActiveRepo(_repoPath: string): void {}

  async close(): Promise<void> {}
}

/** A hub + one remote perch, in dashboard order (hub first). */
export function makeFlockWithTwoNodes(): FakeFlock {
  return new FakeFlock({
    nodes: [
      {
        node: new MockNode({ id: 'air', info: { kind: 'remote', name: 'M2 Air' } }),
        info: { kind: 'remote', name: 'M2 Air' },
      },
      {
        node: new MockNode({ id: 'hub', info: { kind: 'local', name: 'MacBook Pro' } }),
        info: { kind: 'local', name: 'MacBook Pro' },
      },
    ],
  });
}

export interface HarnessOptions {
  engine?: FakeEngine;
  /** Pass `null` to build a server without a flock hub. Defaults to a one-node hub. */
  flock?: FakeFlock | null;
  /** A wrapped bus (e.g. one that counts subscribers). Defaults to `createEventBus()`. */
  bus?: EventBus;
  replay?: ServerDeps['replay'];
  webDist?: string;
  serverOptions?: ServerOptions;
}

export interface Harness {
  app: Hono;
  deps: ServerDeps;
  store: MemoryStore;
  bus: EventBus;
  engine: FakeEngine;
  flock: FakeFlock | undefined;
  /** Everything the bus published, request logs included. */
  published: StarlingEvent[];
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const store = new MemoryStore();
  const bus = options.bus ?? createEventBus();
  const engine = options.engine ?? new FakeEngine();
  const flock =
    options.flock === null
      ? undefined
      : (options.flock ??
        new FakeFlock({
          nodes: [{ node: new MockNode({ id: 'hub' }), info: { kind: 'local', name: 'MacBook Pro' } }],
        }));

  const published: StarlingEvent[] = [];
  bus.subscribe((event) => published.push(event));

  const deps: ServerDeps = {
    engine,
    store,
    bus,
    version: '9.9.9',
    ...(flock === undefined ? {} : { flock }),
    ...(options.replay === undefined ? {} : { replay: options.replay }),
    ...(options.webDist === undefined ? {} : { webDist: options.webDist }),
  };

  return { app: createApp(deps, options.serverOptions), deps, store, bus, engine, flock, published };
}

export interface SseClient {
  /** Parsed `data:` frames in arrival order. */
  events: StarlingEvent[];
  /** `:` comment lines (keep-alives). */
  comments: string[];
  waitForEvents(count: number, timeoutMs?: number): Promise<StarlingEvent[]>;
  /** Wait until the predicate holds for the frames captured so far. */
  waitFor(predicate: (events: StarlingEvent[]) => boolean, timeoutMs?: number): Promise<StarlingEvent[]>;
  waitForComments(count: number, timeoutMs?: number): Promise<string[]>;
  close(): void;
}

/** Connect to an SSE endpoint and parse frames as they arrive. Call `close()` in a finally. */
export async function connectSse(url: string, init: RequestInit = {}): Promise<SseClient> {
  const controller = new AbortController();
  const response = await fetch(url, { ...init, signal: controller.signal });
  if (response.body === null) throw new Error('SSE response had no body');

  const events: StarlingEvent[] = [];
  const comments: string[] = [];
  const waiters = new Set<() => void>();
  const notify = (): void => {
    for (const waiter of [...waiters]) waiter();
  };

  const handle = (block: string): void => {
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) data.push(line.slice('data:'.length).trimStart());
      else if (line.startsWith(':')) comments.push(line.slice(1).trim());
    }
    if (data.length > 0) events.push(JSON.parse(data.join('\n')) as StarlingEvent);
  };

  const pump = async (): Promise<void> => {
    const reader = response.body?.getReader();
    if (reader === undefined) return;
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          handle(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
        }
        notify();
      }
    } catch {
      // Aborted by close(): expected.
    } finally {
      notify();
    }
  };
  void pump();

  const waitUntil = async (predicate: () => boolean, timeoutMs: number, what: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
      await new Promise<void>((resolve) => {
        const done = (): void => {
          waiters.delete(done);
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(done, Math.min(remaining, 50));
        waiters.add(done);
      });
    }
  };

  return {
    events,
    comments,
    async waitForEvents(count, timeoutMs = 3000) {
      await waitUntil(() => events.length >= count, timeoutMs, `${count} SSE event(s)`);
      return events;
    },
    async waitFor(predicate, timeoutMs = 3000) {
      await waitUntil(() => predicate(events), timeoutMs, 'SSE frames matching the predicate');
      return events;
    },
    async waitForComments(count, timeoutMs = 3000) {
      await waitUntil(() => comments.length >= count, timeoutMs, `${count} SSE comment(s)`);
      return comments;
    },
    close() {
      controller.abort();
      notify();
    },
  };
}

/** Bind a real (ephemeral) HTTP listener for the SSE tests, which need a transport that can abort. */
export function serveOnEphemeralPort(app: Hono): { url: string; stop: () => void } {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch, idleTimeout: 0 });
  return {
    url: `http://127.0.0.1:${server.port ?? 0}`,
    stop: () => server.stop(true),
  };
}
