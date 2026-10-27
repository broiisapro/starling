import type { AuditVerdict, Run, StarlingEvent, TaskRun } from '@starling/core/browser';
import { StarlingError, StarlingEventSchema } from '@starling/core/browser';
import fixtureRaw from '../../../../fixtures/runs/sky-todo-launch-day.jsonl?raw';
import { DEFAULT_DEMO_SPEED, type DemoSpeed } from '../lib/speed';
import { isRunStatusEvent, type KnownStarlingEvent, type RunStatusEvent } from './run-status';

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

/**
 * Shift a recorded run so it plays "now".
 *
 * The fixture was recorded on a specific day, so replaying it verbatim makes every elapsed clock and
 * "last seen" label read in days ("9d 12h" on a task card, "last seen 9d ago" on a roost). That is
 * wrong on a projector: the run is happening in front of the audience. Rebasing shifts the envelope
 * `ts` *and* the payload timestamps that panels read (`startedAt`, `finishedAt`, `lastSeen`,
 * verdict/merge `ts`), while leaving every duration untouched — so `metrics.elapsedMs`, the sample
 * spacing and the run's own reported cost/timing stay exactly as recorded.
 */
function rebaseTask(
  task: TaskRun,
  offset: number,
  rebaseVerdict: (v: AuditVerdict) => AuditVerdict,
): TaskRun {
  const next: TaskRun = { ...task };
  if (task.startedAt !== undefined) next.startedAt = task.startedAt + offset;
  if (task.finishedAt !== undefined) next.finishedAt = task.finishedAt + offset;
  if (task.lastVerdict !== undefined) next.lastVerdict = rebaseVerdict(task.lastVerdict);
  return next;
}

function rebaseRun(run: Run, offset: number, rebaseVerdict: (v: AuditVerdict) => AuditVerdict): Run {
  const tasks: Record<string, TaskRun> = {};
  for (const [key, task] of Object.entries(run.tasks)) tasks[key] = rebaseTask(task, offset, rebaseVerdict);
  const next: Run = {
    ...run,
    goal: { ...run.goal, createdAt: run.goal.createdAt + offset },
    tasks,
    startedAt: run.startedAt + offset,
  };
  if (run.plan !== undefined) next.plan = { ...run.plan, createdAt: run.plan.createdAt + offset };
  if (run.finishedAt !== undefined) next.finishedAt = run.finishedAt + offset;
  return next;
}

function rebaseEvent(event: StarlingEvent, offset: number): StarlingEvent {
  const ts = event.ts + offset;
  const rebaseVerdict = (verdict: AuditVerdict): AuditVerdict => ({ ...verdict, ts: verdict.ts + offset });

  // Additive in core (Epic 40): shift the embedded run snapshot, then let the known-event switch below
  // stay exhaustive whether or not the union has grown yet.
  if (isRunStatusEvent(event)) {
    const statusEvent = event as RunStatusEvent;
    return {
      ...statusEvent,
      ts,
      payload: { ...statusEvent.payload, run: rebaseRun(statusEvent.payload.run, offset, rebaseVerdict) },
    } as unknown as StarlingEvent;
  }

  const known = event as KnownStarlingEvent;
  switch (known.type) {
    case 'run.created': {
      const run = known.payload.run;
      return { ...known, ts, payload: { ...known.payload, run: rebaseRun(run, offset, rebaseVerdict) } };
    }
    // `run.status` (Wave 2, Epic 40) also carries a full run snapshot, so it rebases like the
    // other two run-carrying events; the spread keeps `from`/`to` intact.
    case 'run.status': {
      const run = event.payload.run;
      return { ...event, ts, payload: { ...event.payload, run: rebaseRun(run, offset, rebaseVerdict) } };
    }
    case 'run.finished': {
      const run = known.payload.run;
      return { ...known, ts, payload: { ...known.payload, run: rebaseRun(run, offset, rebaseVerdict) } };
    }
    case 'plan.created':
      return {
        ...known,
        ts,
        payload: {
          ...known.payload,
          plan: { ...known.payload.plan, createdAt: known.payload.plan.createdAt + offset },
        },
      };
    case 'task.status': {
      const rebase = (verdict: AuditVerdict) => ({ ...verdict, ts: verdict.ts + offset });
      return {
        ...known,
        ts,
        payload: {
          ...known.payload,
          run: rebaseTask(known.payload.run, offset, rebase),
        },
      };
    }
    case 'agent.event':
      return { ...known, ts, payload: { ...known.payload, ts: known.payload.ts + offset } };
    case 'audit.verdict':
      return { ...known, ts, payload: { ...known.payload, ts: known.payload.ts + offset } };
    case 'merge.result':
      return { ...known, ts, payload: { ...known.payload, ts: known.payload.ts + offset } };
    case 'node.joined':
    case 'node.stats': {
      const node = known.payload.node;
      return {
        ...known,
        ts,
        payload: { ...known.payload, node: { ...node, lastSeen: node.lastSeen + offset } },
      };
    }
    // Durations live in the payload and must not move; the envelope ts has already been shifted.
    case 'metrics':
    case 'log':
    case 'repomap.ready':
    case 'task.migrated':
    case 'node.left':
      return { ...known, ts };
    default: {
      const neverEvent: never = known;
      void neverEvent;
      return { ...event, ts };
    }
  }
}

/**
 * Rebase a whole log so its first event lands at `now` (epoch ms). Pure: the input array is never
 * mutated, and relative timing — which is all the player and the metrics sampler care about — is
 * preserved exactly.
 */
export function rebaseEvents(events: readonly StarlingEvent[], now: number = Date.now()): StarlingEvent[] {
  const first = events[0];
  if (first === undefined) return [];
  const offset = now - first.ts;
  if (offset === 0) return [...events];
  return events.map((event) => rebaseEvent(event, offset));
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
  /**
   * When set, every event is rebased so the first one lands at `rebaseTo()` (epoch ms). The shell
   * passes `() => Date.now()` so a recorded run reads as "happening now"; tests leave it out and see
   * the fixture's exact timestamps.
   */
  rebaseTo?(): number;
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
  const source = options.events ?? demoEvents();
  const speed = options.speed ?? DEFAULT_DEMO_SPEED;
  const loop = options.loop ?? true;
  const loopPauseMs = options.loopPauseMs ?? DEMO_LOOP_PAUSE_MS;
  const timers = options.timers ?? browserTimers;

  // Rebased once per pass, so a looping kiosk demo is always "happening now".
  let events = options.rebaseTo === undefined ? source : rebaseEvents(source, options.rebaseTo());
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
      events = options.rebaseTo === undefined ? source : rebaseEvents(source, options.rebaseTo());
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
