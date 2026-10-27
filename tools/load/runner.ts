/**
 * `ReplayFleetRunner` — one real `ReplayRunner` per task session, behind the single `AgentRunner`
 * that `LocalNode` expects.
 *
 * `ReplayRunner` deliberately supports exactly one session per instance (it replays one recording),
 * while a load test needs twenty concurrent sessions on one node. This wrapper creates an instance
 * per `start()`, forwards every event, and keeps the per-session handles for `send`/`abort`.
 *
 * It also *acts out* the recording's edits: when a session starts, it writes the task's file into
 * the worktree. Without that, every collected diff would be empty and the real merger would answer
 * `skipped` thirty times, measuring nothing.
 */
import type { AgentEvent, AgentRunner, ModelRef } from '../../packages/core/src/index.ts';
import { StarlingError } from '../../packages/core/src/index.ts';
import { createReplayRunner, type ReplayRunner } from '../../packages/runner/src/index.ts';

export interface SessionStartInfo {
  taskKey: string;
  dir: string;
  prompt: string;
  model: ModelRef;
  title: string;
}

export interface ReplayFleetRunnerOptions {
  /** The scripted transcript for a task key. Called once per session. */
  eventsFor(taskKey: string): AgentEvent[];
  /** Playback multiplier: recorded time is divided by this. */
  speed?: number;
  /** Side effect that makes the session look like it edited the worktree. */
  onStart?: (info: SessionStartInfo) => Promise<void> | void;
  /**
   * Stamp every replayed event with "now" (default true).
   *
   * `ReplayRunner` preserves the recording's absolute `ts`, which is right for a recording replay
   * but wrong when it is used as a live `AgentRunner`: the engine publishes those old timestamps,
   * and the SSE `since` filter then drops agent events on a reconnect. Retiming keeps the recorded
   * *spacing* (the runner schedules by the original deltas) and makes the event stream readable by
   * the dashboard. Set false to measure the raw behaviour.
   */
  retime?: boolean;
}

export interface ReplayFleetRunner extends AgentRunner {
  readonly activeSessions: number;
  /** Every session handle this runner has opened, in start order. */
  sessionIds(): string[];
}

export class ReplayFleetRunnerImpl implements ReplayFleetRunner {
  readonly #options: ReplayFleetRunnerOptions;
  readonly #replays = new Map<string, ReplayRunner>();
  readonly #order: string[] = [];
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  #closed = false;
  readonly #retime: boolean;
  readonly #lastTs = new Map<string, number>();

  constructor(options: ReplayFleetRunnerOptions) {
    this.#options = options;
    this.#retime = options.retime ?? true;
  }

  /** Monotonic, wall-clock timestamp per session: never behind now, never duplicated. */
  #stamp(sessionId: string): number {
    const now = Date.now();
    const previous = this.#lastTs.get(sessionId) ?? 0;
    const stamp = Math.max(now, previous + 1);
    this.#lastTs.set(sessionId, stamp);
    return stamp;
  }

  get activeSessions(): number {
    return this.#replays.size;
  }

  sessionIds(): string[] {
    return [...this.#order];
  }

  async start(opts: {
    runId: string;
    taskKey: string;
    dir: string;
    prompt: string;
    model: ModelRef;
    title: string;
  }): Promise<{ sessionId: string }> {
    if (this.#closed) throw new StarlingError('RUNNER_ERROR', 'replay fleet runner is closed');

    const replay = createReplayRunner({
      events: this.#options.eventsFor(opts.taskKey),
      speed: this.#options.speed ?? 4,
      newSessionId: () => `replay-${opts.taskKey}`,
    });
    replay.onEvent((event) => {
      const outbound = this.#retime ? { ...event, ts: this.#stamp(event.sessionId) } : event;
      for (const listener of [...this.#listeners]) listener(outbound);
    });

    // The simulated edit lands before the first event, so the worktree looks like an agent that
    // started by writing a file (which is what the auditor and merger will inspect).
    await this.#options.onStart?.({
      taskKey: opts.taskKey,
      dir: opts.dir,
      prompt: opts.prompt,
      model: opts.model,
      title: opts.title,
    });

    const { sessionId } = await replay.start(opts);
    this.#replays.set(sessionId, replay);
    this.#order.push(sessionId);
    return { sessionId };
  }

  async send(sessionId: string, prompt: string): Promise<void> {
    const replay = this.#replays.get(sessionId);
    if (replay === undefined) {
      throw new StarlingError('RUNNER_ERROR', `No replay session ${sessionId}`, {
        details: { sessionId, sessions: this.#order.length },
      });
    }
    await replay.send(sessionId, prompt);
  }

  async abort(sessionId: string): Promise<void> {
    await this.#replays.get(sessionId)?.abort(sessionId);
  }

  onEvent(fn: (event: AgentEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.all([...this.#replays.values()].map((replay) => replay.close()));
    this.#replays.clear();
    this.#listeners.clear();
  }
}

export function createReplayFleetRunner(options: ReplayFleetRunnerOptions): ReplayFleetRunner {
  return new ReplayFleetRunnerImpl(options);
}
