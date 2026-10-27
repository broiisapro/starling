import { systemClock } from '../clock';
import type { AgentEvent, ModelRef } from '../contracts';
import { StarlingError } from '../errors';
import type { AgentRunner, Clock } from '../ports';

/**
 * Schedules a callback. The default is `setTimeout(fn, 0)` so subscribers attached right after
 * `start()` still see every event. Pass `immediateScheduler` (or a FakeClock-driven one) for
 * synchronous, deterministic tests.
 */
export type MockEventScheduler = (fn: () => void, delayMs: number) => void;

export const immediateScheduler: MockEventScheduler = (fn) => fn();

export interface MockScriptContext {
  runId: string;
  taskKey: string;
  sessionId: string;
  /** 1 for the initial run, 2+ for fixer prompts. */
  pass: number;
}

export type MockEventScript =
  | Array<Partial<AgentEvent>>
  | ((ctx: MockScriptContext) => Array<Partial<AgentEvent>>);

const DEFAULT_MODEL: ModelRef = { provider: 'deepseek', model: 'deepseek-v4.1-flash' };

/** The events every mock agent emits when a test does not script its own. */
export function defaultAgentEvents(ctx: MockScriptContext): Array<Partial<AgentEvent>> {
  return [
    { kind: 'session.started', data: { model: DEFAULT_MODEL } },
    { kind: 'text', data: { text: `Working on ${ctx.taskKey} (pass ${ctx.pass}).` } },
    { kind: 'tool.call', data: { tool: 'read', path: 'src/main.ts' } },
    { kind: 'tool.result', data: { ok: true } },
    { kind: 'file.edited', data: { path: 'src/main.ts' } },
    { kind: 'usage', data: { input: 1200, output: 300, cached: 0 } },
    { kind: 'session.idle', data: {} },
  ];
}

export interface MockRunnerOptions {
  clock?: Clock;
  schedule?: MockEventScheduler;
  events?: MockEventScript;
}

interface MockSession {
  runId: string;
  taskKey: string;
  pass: number;
  aborted: boolean;
}

/**
 * Scripted `AgentRunner` double.
 *
 * `start()` emits a session script (default: started → text → tool.call → tool.result → file.edited
 * → usage → session.idle), `send()` emits the same script with `pass + 1`, and `flush()` awaits all
 * scheduled emissions. It can be driven by a FakeClock through a custom `schedule`.
 */
export class MockRunner implements AgentRunner {
  readonly sessions = new Map<string, MockSession>();
  readonly sentPrompts: Array<{ sessionId: string; prompt: string }> = [];
  readonly #clock: Clock;
  readonly #scheduleImpl: MockEventScheduler;
  readonly #script: MockEventScript;
  readonly #listeners = new Set<(e: AgentEvent) => void>();
  #counter = 0;
  #pending = 0;
  #waiters: Array<() => void> = [];
  #closed = false;

  constructor(options: MockRunnerOptions = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#scheduleImpl = options.schedule ?? ((fn) => setTimeout(fn, 0));
    this.#script = options.events ?? defaultAgentEvents;
  }

  async start(opts: {
    runId: string;
    taskKey: string;
    dir: string;
    prompt: string;
    model: ModelRef;
    title: string;
  }): Promise<{ sessionId: string }> {
    if (this.#closed) throw new StarlingError('RUNNER_ERROR', 'MockRunner is closed');
    this.#counter += 1;
    const sessionId = `ses_mock_${this.#counter}`;
    const session: MockSession = { runId: opts.runId, taskKey: opts.taskKey, pass: 0, aborted: false };
    this.sessions.set(sessionId, session);
    this.#emitScript(sessionId, session, 1);
    return { sessionId };
  }

  async send(sessionId: string, prompt: string): Promise<void> {
    if (this.#closed) throw new StarlingError('RUNNER_ERROR', 'MockRunner is closed');
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw new StarlingError('RUNNER_ERROR', `Unknown session ${sessionId}`);
    this.sentPrompts.push({ sessionId, prompt });
    session.pass += 1;
    this.#emitScript(sessionId, session, session.pass + 1);
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    session.aborted = true;
    this.#emit(sessionId, session, { kind: 'session.error', data: { reason: 'aborted' } });
  }

  onEvent(fn: (e: AgentEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#listeners.clear();
  }

  /** Wait until every scheduled emission has run. */
  flush(): Promise<void> {
    if (this.#pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  #emitScript(sessionId: string, session: MockSession, pass: number): void {
    const ctx: MockScriptContext = {
      runId: session.runId,
      taskKey: session.taskKey,
      sessionId,
      pass,
    };
    const events = typeof this.#script === 'function' ? this.#script(ctx) : this.#script;
    events.forEach((event, index) => {
      this.#queue(() => {
        this.#emit(sessionId, session, event);
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

  #emit(sessionId: string, session: MockSession, partial: Partial<AgentEvent>): void {
    const event: AgentEvent = {
      runId: session.runId,
      taskKey: session.taskKey,
      sessionId,
      ts: this.#clock.now(),
      kind: 'text',
      data: {},
      ...partial,
    };
    for (const fn of [...this.#listeners]) fn(event);
  }
}
