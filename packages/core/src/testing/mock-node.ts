import { systemClock } from '../clock';
import type { AgentEvent, NodeInfo, StartTaskOptions, TaskHandle, TaskResult } from '../contracts';
import { StarlingError } from '../errors';
import type { Clock, ExecutionNode } from '../ports';
import { makeNodeInfo } from './factories';
import { defaultAgentEvents, type MockEventScheduler, type MockEventScript } from './mock-runner';

export interface MockNodeOptions {
  id?: string;
  info?: Partial<NodeInfo>;
  clock?: Clock;
  schedule?: MockEventScheduler;
  events?: MockEventScript;
  /** Result returned by `collect()`, or a builder per task. */
  result?: Partial<TaskResult> | ((opts: StartTaskOptions) => Partial<TaskResult>);
}

interface NodeSession {
  opts: StartTaskOptions;
  pass: number;
}

/**
 * An `ExecutionNode` double with the same scripted events as `MockRunner`.
 *
 * `simulateDeath()` models a perch whose lid closed: no further events are emitted and every
 * subsequent call rejects with `NODE_OFFLINE` (already-delivered events stay delivered).
 */
export class MockNode implements ExecutionNode {
  readonly id: string;
  readonly startedTasks: StartTaskOptions[] = [];
  readonly prompts: Array<{ taskKey: string; prompt: string }> = [];
  readonly collected: TaskHandle[] = [];
  readonly #info: NodeInfo;
  readonly #clock: Clock;
  readonly #scheduleImpl: MockEventScheduler;
  readonly #script: MockEventScript;
  readonly #result: MockNodeOptions['result'];
  readonly #listeners = new Set<(e: AgentEvent) => void>();
  readonly #sessions = new Map<string, NodeSession>();
  #dead = false;
  #deathReason = '';
  #counter = 0;
  #commits = 0;
  #pending = 0;
  #waiters: Array<() => void> = [];

  constructor(options: MockNodeOptions = {}) {
    this.id = options.id ?? 'hub';
    this.#info = makeNodeInfo({ id: this.id, ...options.info });
    this.#clock = options.clock ?? systemClock;
    this.#scheduleImpl = options.schedule ?? ((fn) => setTimeout(fn, 0));
    this.#script = options.events ?? defaultAgentEvents;
    this.#result = options.result;
  }

  get dead(): boolean {
    return this.#dead;
  }

  get deathReason(): string {
    return this.#deathReason;
  }

  async info(): Promise<NodeInfo> {
    this.#assertAlive();
    return {
      ...this.#info,
      activeSessions: this.#sessions.size,
      status: this.#sessions.size > 0 ? 'busy' : 'online',
      lastSeen: this.#clock.now(),
    };
  }

  /** The most recent info even after death — registries need it for the `left` event. */
  infoSnapshot(): NodeInfo {
    return {
      ...this.#info,
      activeSessions: this.#sessions.size,
      status: this.#dead ? 'offline' : this.#sessions.size > 0 ? 'busy' : 'online',
    };
  }

  async startTask(opts: StartTaskOptions): Promise<TaskHandle> {
    this.#assertAlive();
    this.#counter += 1;
    const sessionId = `ses_node_${this.#counter}`;
    this.startedTasks.push(opts);
    this.#sessions.set(opts.taskKey, { opts, pass: 0 });
    const handle: TaskHandle = {
      nodeId: this.id,
      runId: opts.runId,
      taskKey: opts.taskKey,
      branch: opts.branch,
      sessionId,
    };
    this.#emitScript(handle, opts, 1);
    return handle;
  }

  async sendPrompt(h: TaskHandle, prompt: string): Promise<void> {
    this.#assertAlive();
    const session = this.#session(h);
    this.prompts.push({ taskKey: h.taskKey, prompt });
    session.pass += 1;
    this.#emitScript(h, session.opts, session.pass + 1);
  }

  async abort(h: TaskHandle): Promise<void> {
    this.#assertAlive();
    this.#emit(h, { kind: 'session.error', data: { reason: 'aborted' } });
    this.#sessions.delete(h.taskKey);
  }

  async collect(h: TaskHandle, _hubRepo: string, _baseRef: string): Promise<TaskResult> {
    this.#assertAlive();
    this.#session(h);
    this.collected.push(h);
    this.#commits += 1;
    const override =
      typeof this.#result === 'function' ? this.#result(this.#session(h).opts) : (this.#result ?? {});
    return {
      commit: `mock-node-commit-${this.#commits}`,
      diff: {
        files: [{ path: 'src/main.ts', added: 3, removed: 1 }],
        patch: '--- a/src/main.ts\n+++ b/src/main.ts\n+// mock change',
        truncated: false,
      },
      changedFiles: ['src/main.ts'],
      ...override,
    };
  }

  async cleanup(h: TaskHandle): Promise<void> {
    this.#assertAlive();
    this.#sessions.delete(h.taskKey);
  }

  onEvent(fn: (e: AgentEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** Simulate a perch vanishing mid-task. Idempotent. */
  simulateDeath(reason = 'perch went offline'): void {
    if (this.#dead) return;
    this.#dead = true;
    this.#deathReason = reason;
  }

  /** Wait until every scheduled emission has run (or was suppressed by death). */
  flush(): Promise<void> {
    if (this.#pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  #assertAlive(): void {
    if (this.#dead) {
      throw new StarlingError('NODE_OFFLINE', `Node ${this.id} is offline: ${this.#deathReason}`, {
        details: { nodeId: this.id },
      });
    }
  }

  #session(h: TaskHandle): NodeSession {
    const session = this.#sessions.get(h.taskKey);
    if (session === undefined) {
      throw new StarlingError('RUNNER_ERROR', `Node ${this.id} has no session for ${h.taskKey}`);
    }
    return session;
  }

  #emitScript(h: TaskHandle, opts: StartTaskOptions, pass: number): void {
    const events =
      typeof this.#script === 'function'
        ? this.#script({
            runId: opts.runId,
            taskKey: opts.taskKey,
            sessionId: h.sessionId,
            pass,
          })
        : this.#script;
    events.forEach((event, index) => {
      this.#queue(() => {
        this.#emit(h, event);
      }, index * 5);
    });
  }

  #queue(fn: () => void, delayMs: number): void {
    this.#pending += 1;
    this.#scheduleImpl(() => {
      try {
        fn();
      } finally {
        this.#pending -= 1;
        if (this.#pending === 0) {
          const waiters = this.#waiters;
          this.#waiters = [];
          for (const resolve of waiters) resolve();
        }
      }
    }, delayMs);
  }

  #emit(h: TaskHandle, partial: Partial<AgentEvent>): void {
    if (this.#dead) return;
    const event: AgentEvent = {
      runId: h.runId,
      taskKey: h.taskKey,
      sessionId: h.sessionId,
      ts: this.#clock.now(),
      kind: 'text',
      data: {},
      ...partial,
    };
    for (const fn of [...this.#listeners]) fn(event);
  }
}
