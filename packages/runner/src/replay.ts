/**
 * `ReplayRunner` — an `AgentRunner` that replays recorded `AgentEvent`s with their original
 * relative timing (scaled by `speed`) and remaps runId/taskKey to whatever session `start()`
 * creates. Demos and tests can run the whole UI and engine with no model and no network.
 *
 * Timing has two modes:
 * - default clock: real `setTimeout`s honour the recorded spacing;
 * - custom clock (e.g. `FakeClock`): no timers are created — call `tick()` after advancing the
 *   clock. This keeps replay tests deterministic and leak-free.
 */
import { readFileSync } from 'node:fs';
import type { AgentEvent, AgentRunner, Clock, ModelRef } from '@starling/core';
import { AgentEventSchema, newId, StarlingError, systemClock } from '@starling/core';
import type { ScheduledTask, Scheduler } from './schedule';
import { timerScheduler } from './schedule';

export interface ReplayRunnerOptions {
  events: AgentEvent[] | string;
  clock?: Clock;
  /** Playback speed. 2 = twice as fast. Default 1. */
  speed?: number;
  /** Override the timer used for real-clock replay (tests pass a manual scheduler). */
  schedule?: Scheduler;
  /** Session id factory, mostly for deterministic tests. */
  newSessionId?: () => string;
}

export interface ReplayRunner extends AgentRunner {
  /** Emit every event whose virtual due time has been reached. */
  tick(): void;
  /** Resolves once every event has been emitted or the runner is closed. */
  done(): Promise<void>;
  readonly replayed: number;
  readonly remaining: number;
}

interface QueueItem {
  dueAt: number;
  event: AgentEvent;
}

function parseEvents(input: AgentEvent[] | string): AgentEvent[] {
  if (Array.isArray(input)) return input.map((event, index) => validate(event, `event ${index}`));

  let raw: string;
  try {
    raw = readFileSync(input, 'utf8');
  } catch (err) {
    throw new StarlingError('RUNNER_ERROR', `could not read replay file ${input}`, { cause: err });
  }

  const trimmed = raw.trim();
  if (trimmed === '') return [];
  const lines = trimmed.startsWith('[')
    ? [trimmed]
    : trimmed.split('\n').filter((line) => line.trim() !== '');
  const events: AgentEvent[] = [];
  for (const [index, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new StarlingError('RUNNER_ERROR', `invalid JSON in replay file at line ${index + 1}`, {
        cause: err,
      });
    }
    if (Array.isArray(parsed)) {
      for (const [inner, event] of parsed.entries()) {
        events.push(validate(event, `event ${index + 1}.${inner}`));
      }
    } else {
      events.push(validate(parsed, `event ${index + 1}`));
    }
  }
  return events;
}

function validate(value: unknown, label: string): AgentEvent {
  const result = AgentEventSchema.safeParse(value);
  if (!result.success) {
    throw new StarlingError('RUNNER_ERROR', `${label} is not a valid AgentEvent`, {
      cause: result.error,
    });
  }
  return result.data;
}

class ReplayRunnerImpl implements ReplayRunner {
  readonly #clock: Clock;
  readonly #speed: number;
  readonly #schedule: Scheduler | undefined;
  readonly #newSessionId: () => string;
  readonly #recorded: AgentEvent[];
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  readonly #queue: QueueItem[] = [];

  #sessionId: string | undefined;
  #runId = '';
  #taskKey = '';
  #timer: ScheduledTask | undefined;
  #replayed = 0;
  #closed = false;
  #resolveDone: () => void = () => {};
  #done: Promise<void>;

  constructor(options: ReplayRunnerOptions) {
    this.#clock = options.clock ?? systemClock;
    this.#speed = options.speed ?? 1;
    if (!Number.isFinite(this.#speed) || this.#speed <= 0) {
      throw new StarlingError('INVALID_ARGUMENT', `replay speed must be positive, got ${this.#speed}`);
    }
    this.#schedule = options.schedule ?? (this.#clock === systemClock ? timerScheduler : undefined);
    this.#newSessionId = options.newSessionId ?? (() => `replay-${newId()}`);
    this.#recorded = parseEvents(options.events);
    this.#done = new Promise<void>((resolve) => {
      this.#resolveDone = resolve;
    });
  }

  get replayed(): number {
    return this.#replayed;
  }

  get remaining(): number {
    return this.#queue.length;
  }

  async start(opts: {
    runId: string;
    taskKey: string;
    dir: string;
    prompt: string;
    model: ModelRef;
    title: string;
  }): Promise<{ sessionId: string }> {
    if (this.#sessionId !== undefined) {
      throw new StarlingError('INVALID_ARGUMENT', 'ReplayRunner supports one session per instance');
    }
    if (this.#closed) throw new StarlingError('RUNNER_ERROR', 'replay runner is closed');

    this.#runId = opts.runId;
    this.#taskKey = opts.taskKey;
    this.#sessionId = this.#newSessionId();

    const startNow = this.#clock.now();
    const baseTs = this.#recorded[0]?.ts ?? startNow;
    for (const event of this.#recorded) {
      this.#queue.push({
        dueAt: startNow + Math.max(0, (event.ts - baseTs) / this.#speed),
        event,
      });
    }
    this.#queue.sort((a, b) => a.dueAt - b.dueAt);
    if (this.#queue.length === 0) this.#finish();

    if (this.#schedule !== undefined) {
      this.#timer = this.#schedule(() => {
        this.#timer = undefined;
        this.#arm();
      }, 0);
    }

    return { sessionId: this.#sessionId };
  }

  async send(_sessionId: string, _prompt: string): Promise<void> {
    if (this.#closed) throw new StarlingError('RUNNER_ERROR', 'replay runner is closed');
    if (this.#sessionId === undefined) {
      throw new StarlingError('INVALID_ARGUMENT', 'ReplayRunner has no active session');
    }
    // A replay has exactly one recording; a fixer prompt has nothing more to play. The caller
    // still gets a terminal idle so its state machine can move on.
    this.#emit({
      runId: this.#runId,
      taskKey: this.#taskKey,
      sessionId: this.#sessionId,
      ts: this.#clock.now(),
      kind: 'session.idle',
      data: { replay: true },
    });
  }

  async abort(sessionId: string): Promise<void> {
    if (this.#sessionId === undefined || sessionId !== this.#sessionId) return;
    this.#emit({
      runId: this.#runId,
      taskKey: this.#taskKey,
      sessionId: this.#sessionId,
      ts: this.#clock.now(),
      kind: 'session.idle',
      data: { replay: true, aborted: true },
    });
  }

  onEvent(fn: (event: AgentEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  tick(): void {
    this.#arm();
  }

  done(): Promise<void> {
    return this.#done;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#timer?.cancel();
    this.#timer = undefined;
    this.#queue.length = 0;
    this.#listeners.clear();
    this.#resolveDone();
  }

  #arm(): void {
    if (this.#closed || this.#sessionId === undefined) return;
    const now = this.#clock.now();
    while (this.#queue.length > 0) {
      const next = this.#queue[0];
      if (next === undefined || next.dueAt > now) break;
      this.#queue.shift();
      this.#emit({ ...next.event, runId: this.#runId, taskKey: this.#taskKey, sessionId: this.#sessionId });
    }

    if (this.#queue.length === 0) {
      this.#finish();
      return;
    }
    if (this.#schedule === undefined) return;

    const next = this.#queue[0];
    if (next === undefined) return;
    this.#timer?.cancel();
    this.#timer = this.#schedule(
      () => {
        this.#timer = undefined;
        this.#arm();
      },
      Math.max(0, next.dueAt - now),
    );
  }

  #emit(event: AgentEvent): void {
    this.#replayed += 1;
    for (const listener of [...this.#listeners]) listener(event);
  }

  #finish(): void {
    if (this.#closed) return;
    this.#timer?.cancel();
    this.#timer = undefined;
    this.#resolveDone();
  }
}

export function createReplayRunner(options: ReplayRunnerOptions): ReplayRunner {
  return new ReplayRunnerImpl(options);
}
