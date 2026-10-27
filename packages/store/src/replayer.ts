/**
 * Recorded-run replay: re-publish a `StarlingEvent[]` on a bus with the original relative timing,
 * scaled by `speed`, so the dashboard (and `starling replay`) can show a full run without an
 * engine, a network or a single model call. This is the demo safety net.
 *
 * Timing model:
 * - gap between events = `max(0, ts[i] - ts[i-1]) / speed`
 * - a gap is capped at `MAX_REPLAY_GAP_MS` (2 s) so idle stretches never stall the demo
 * - `speed: Infinity` emits everything back-to-back in one tick
 * - with a real `Clock` (the default) the delays are real timers; with a `FakeClock` (anything with
 *   an `advance(ms)` method) the replay is virtual-time: `advance` is called instead of waiting, so
 *   tests are deterministic and instant while still observing the exact scaled delays.
 *
 * Event timestamps are preserved, not rewritten: the dashboard shows the recorded timeline.
 */
import {
  type Clock,
  type EventBus,
  type Run,
  StarlingError,
  type StarlingEvent,
  systemClock,
  type TaskRun,
} from '@starling/core';

/** Real-time cap for an idle gap, after scaling. */
export const MAX_REPLAY_GAP_MS = 2000;

export interface ReplayerOptions {
  events: StarlingEvent[];
  bus: EventBus;
  clock?: Clock;
  /** Playback multiplier; default 1. `Infinity` means "as fast as the bus can take it". */
  speed?: number;
  /** Rewrite run-scoped event ids (e.g. to replay a recording as a fresh run). `'*'` events keep `'*'`. */
  newRunId?: string;
}

export interface Replayer {
  /** Play the whole stream; resolves when the last event is published or `stop()` is called. */
  start(): Promise<void>;
  /** Stop early; pending events are dropped and `done` resolves. Idempotent. */
  stop(): void;
  /** Resolves when playback ends, however it ends. */
  done: Promise<void>;
}

interface AdvancingClock extends Clock {
  advance(ms: number): number;
}

function isAdvancingClock(clock: Clock): clock is AdvancingClock {
  return typeof (clock as Partial<AdvancingClock>).advance === 'function';
}

function rewriteRun(run: Run, runId: string): Run {
  const tasks: Record<string, TaskRun> = {};
  for (const [key, task] of Object.entries(run.tasks)) tasks[key] = { ...task, runId };
  return { ...run, id: runId, tasks };
}

/** Rewrite every run-scoped id, keeping `'*'` (flock) events un-scoped. */
export function rewriteEventRunId(event: StarlingEvent, newRunId: string): StarlingEvent {
  if (event.runId === '*') return event;
  switch (event.type) {
    case 'run.created':
      return { ...event, runId: newRunId, payload: { run: rewriteRun(event.payload.run, newRunId) } };
    case 'run.finished':
      return {
        ...event,
        runId: newRunId,
        payload: { run: rewriteRun(event.payload.run, newRunId), summary: event.payload.summary },
      };
    case 'task.status':
      return {
        ...event,
        runId: newRunId,
        payload: { ...event.payload, run: { ...event.payload.run, runId: newRunId } },
      };
    case 'agent.event':
      return { ...event, runId: newRunId, payload: { ...event.payload, runId: newRunId } };
    default:
      return { ...event, runId: newRunId };
  }
}

export function createReplayer(opts: ReplayerOptions): Replayer {
  const speed = opts.speed ?? 1;
  if (typeof speed !== 'number' || Number.isNaN(speed) || speed <= 0) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `replay speed must be a positive number, got ${String(speed)}`,
    );
  }
  const clock = opts.clock ?? systemClock;
  const virtual = isAdvancingClock(clock);
  const events = opts.events;

  let started = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const wait = (ms: number): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (virtual) {
      (clock as AdvancingClock).advance(ms);
      return Promise.resolve();
    }
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(() => {
        timer = undefined;
        wake = undefined;
        resolve();
      }, ms);
    });
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    const resolve = wake;
    wake = undefined;
    resolve?.();
    resolveDone();
  };

  const start = async (): Promise<void> => {
    if (started) {
      throw new StarlingError('INVALID_ARGUMENT', 'replayer.start() may only be called once');
    }
    started = true;

    try {
      let previousTs: number | undefined;
      for (const event of events) {
        if (stopped) break;
        if (previousTs !== undefined) {
          const gap = Math.max(0, event.ts - previousTs);
          const scaled = Number.isFinite(speed) ? gap / speed : 0;
          await wait(Math.min(scaled, MAX_REPLAY_GAP_MS));
          if (stopped) break;
        }
        previousTs = event.ts;
        opts.bus.publish(opts.newRunId === undefined ? event : rewriteEventRunId(event, opts.newRunId));
      }
    } finally {
      // `done` must never reject unobserved; a throwing publisher surfaces through `start()`.
      if (!stopped) stopped = true;
      resolveDone();
    }
  };

  return { start, stop, done };
}
