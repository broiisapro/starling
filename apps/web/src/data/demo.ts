import type { StarlingEvent } from '@starling/core';
import { StarlingError, StarlingEventSchema } from '@starling/core';
import fixtureRaw from '../../../../fixtures/runs/sky-todo-launch-day.jsonl?raw';
import { DEFAULT_DEMO_SPEED, type DemoSpeed } from '../lib/speed';

/**
 * Demo mode: replay the recorded launch-day run with its original timing, scaled by 1× / 4× / 16×.
 * The fixture lives at the repo root so the server replay and the browser demo tell the same story.
 *
 * `?raw` is understood by Vite *and* by Bun's transpiler, so the same import works in `bun test`
 * and in the production bundle. ~116 KB, loaded once.
 */
export const DEMO_FIXTURE_PATH = 'fixtures/runs/sky-todo-launch-day.jsonl';
export const DEMO_LOOP_PAUSE_MS = 3_000;

export const demoFixtureRaw: string = fixtureRaw;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parse and contract-validate a JSONL event log. Bad lines are a loud error: a demo that silently
 * drops events is worse than one that refuses to start.
 */
export function parseJsonl(raw: string, source = DEMO_FIXTURE_PATH): StarlingEvent[] {
  const lines = raw.split('\n');
  const events: StarlingEvent[] = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new StarlingError('INVALID_ARGUMENT', `Invalid JSON on line ${index + 1} of ${source}`, {
        cause: error,
        details: { source, line: index + 1 },
      });
    }
    if (!isRecord(parsed)) {
      throw new StarlingError(
        'INVALID_ARGUMENT',
        `Event on line ${index + 1} of ${source} is not an object`,
        {
          details: { source, line: index + 1 },
        },
      );
    }
    const result = StarlingEventSchema.safeParse(parsed);
    if (!result.success) {
      throw new StarlingError(
        'INVALID_ARGUMENT',
        `Event on line ${index + 1} of ${source} breaks the contract`,
        {
          cause: result.error,
          details: { source, line: index + 1, type: parsed.type },
        },
      );
    }
    events.push(result.data);
  });
  return events;
}

let cached: StarlingEvent[] | undefined;

/** The fixture, parsed once per tab. */
export function demoEvents(): StarlingEvent[] {
  cached ??= parseJsonl(demoFixtureRaw);
  return cached;
}

/** Delay from `previous` to `next` at a given speed. Never negative, never a NaN timeout. */
export function scaledDelay(previous: StarlingEvent, next: StarlingEvent, speed: DemoSpeed): number {
  return Math.max(0, Math.round((next.ts - previous.ts) / speed));
}

/** Full schedule for tests and for the "how long is this demo" label. */
export function demoTimeline(events: readonly StarlingEvent[], speed: DemoSpeed): number[] {
  return events.map((event, index) => {
    if (index === 0) return 0;
    const previous = events[index - 1];
    // noUncheckedIndexedAccess: index > 0 guarantees previous, but keep the compiler honest.
    return previous === undefined ? 0 : scaledDelay(previous, event, speed);
  });
}

export function demoDurationMs(
  events: readonly StarlingEvent[],
  speed: DemoSpeed = DEFAULT_DEMO_SPEED,
): number {
  const first = events[0];
  const last = events.at(-1);
  if (first === undefined || last === undefined) return 0;
  return Math.round((last.ts - first.ts) / speed);
}

export interface DemoTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const browserTimers: DemoTimers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

export type DemoStatus = 'playing' | 'ended';

export interface DemoOptions {
  events?: readonly StarlingEvent[];
  speed?: DemoSpeed;
  /** Pause between loops; the prompt asks for 3 s. */
  loopPauseMs?: number;
  /** `false` plays once. Default true: a kiosk demo should never go dark. */
  loop?: boolean;
  onEvent(event: StarlingEvent): void;
  /** Called after the pause, just before the first event replays — the shell resets its store. */
  onLoop?(): void;
  onStatus?(status: DemoStatus, detail: { speed: DemoSpeed; events: number }): void;
  timers?: DemoTimers;
}

export interface DemoHandle {
  readonly speed: DemoSpeed;
  readonly index: number;
  readonly finished: boolean;
  stop(): void;
}

/**
 * Play the timeline. The first event is delivered synchronously so a paused tab still shows a
 * populated dashboard; every later event is a `setTimeout` chained off the previous one.
 */
export function playDemo(options: DemoOptions): DemoHandle {
  const events = options.events ?? demoEvents();
  const speed = options.speed ?? DEFAULT_DEMO_SPEED;
  const loop = options.loop ?? true;
  const loopPauseMs = options.loopPauseMs ?? DEMO_LOOP_PAUSE_MS;
  const timers = options.timers ?? browserTimers;

  let index = 0;
  let finished = false;
  let stopped = false;
  let timer: unknown;

  const clear = (): void => {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
  };

  const emitNext = (): void => {
    if (stopped) return;
    timer = undefined;
    const event = events[index];
    if (event === undefined) {
      endOfLoop();
      return;
    }
    index += 1;
    options.onEvent(event);

    const next = events[index];
    if (next === undefined) {
      endOfLoop();
      return;
    }
    timer = timers.setTimeout(emitNext, scaledDelay(event, next, speed));
  };

  const endOfLoop = (): void => {
    if (stopped) return;
    if (!loop) {
      finished = true;
      options.onStatus?.('ended', { speed, events: events.length });
      return;
    }
    timer = timers.setTimeout(() => {
      timer = undefined;
      if (stopped) return;
      index = 0;
      options.onLoop?.();
      emitNext();
    }, loopPauseMs);
  };

  options.onStatus?.('playing', { speed, events: events.length });
  emitNext();

  return {
    get speed() {
      return speed;
    },
    get index() {
      return index;
    },
    get finished() {
      return finished && !loop;
    },
    stop() {
      stopped = true;
      clear();
    },
  };
}
