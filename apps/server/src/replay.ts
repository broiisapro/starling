/**
 * JSONL replay: read a recorded event log, validate every line against `StarlingEventSchema`, then
 * publish it on a timer at `speed`× real time.
 *
 * This backs both `POST /api/replay` (ARCHITECTURE §6) and the demo server in `dev.ts`, so the
 * dashboard and the web epics can watch a realistic run before the engine exists. Replay is a
 * *publisher*, not a re-executor: it writes the same events the engine would, into the same store, on
 * the same bus.
 */
import { readFileSync } from 'node:fs';
import type { EventBus, StarlingEvent, Store } from '@starling/core';
import { StarlingError, StarlingEventSchema } from '@starling/core';

/** ARCHITECTURE §6's CLI default (`starling replay --speed 4`). */
export const DEFAULT_REPLAY_SPEED = 4;

export interface ReplayFile {
  events: StarlingEvent[];
  /** The first run-scoped `runId` in the file. `'*'` node events are not runs. */
  runId: string;
  /** Wall-clock span of the recording in ms, used to space loops apart. */
  spanMs: number;
}

export interface ReplayOptions {
  file: ReplayFile;
  store: Store;
  bus: EventBus;
  speed?: number;
  /** Restart from the top after the last event (demo mode). */
  loop?: boolean;
  /** Pause between loops, in real ms (scaled by `speed` like the rest of the schedule). */
  gapMs?: number;
  onError?: (err: unknown) => void;
}

export interface ReplayHandle {
  runId: string;
  /** Resolves when a single pass finishes, or when `stop()` is called. */
  done: Promise<void>;
  stop: () => void;
}

/** Parse and validate a recorded JSONL event log. Throws `StarlingError('INVALID_ARGUMENT')`. */
export function loadReplayFile(path: string): ReplayFile {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new StarlingError('INVALID_ARGUMENT', `Cannot read replay file: ${path}`, { cause: err });
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new StarlingError('INVALID_ARGUMENT', `Replay file is empty: ${path}`);
  }

  const events: StarlingEvent[] = [];
  for (const [index, line] of lines.entries()) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      throw new StarlingError('INVALID_ARGUMENT', `Invalid JSON on line ${index + 1} of ${path}`, {
        cause: err,
      });
    }
    const parsed = StarlingEventSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const detail = first === undefined ? 'invalid event' : `${first.path.join('.')}: ${first.message}`;
      throw new StarlingError('INVALID_ARGUMENT', `Invalid event on line ${index + 1} of ${path}: ${detail}`);
    }
    events.push(parsed.data);
  }

  const runId = events.find((event) => event.runId !== '*')?.runId;
  if (runId === undefined) {
    throw new StarlingError('INVALID_ARGUMENT', `Replay file has no run-scoped events: ${path}`);
  }

  const timestamps = events.map((event) => event.ts);
  const spanMs = Math.max(...timestamps) - Math.min(...timestamps);
  return { events, runId, spanMs };
}

function clampSpeed(speed: number | undefined): number {
  if (speed === undefined || !Number.isFinite(speed) || speed <= 0) return DEFAULT_REPLAY_SPEED;
  return Math.min(1000, Math.max(0.1, speed));
}

/**
 * Publish a recorded run. The first event is emitted synchronously, so a caller can hand the returned
 * `runId` straight back over HTTP and the run is already visible in `GET /api/runs`.
 */
export function startReplay(options: ReplayOptions): ReplayHandle {
  const { file, store, bus } = options;
  const speed = clampSpeed(options.speed);
  const gapMs = options.gapMs ?? 3_000;
  const first = file.events[0];
  if (first === undefined) {
    throw new StarlingError('INVALID_ARGUMENT', 'Replay file has no events');
  }

  let round = 0;
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let resolveDone = (): void => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    resolveDone();
  };

  const offsetFor = (loop: number): number => loop * (file.spanMs + gapMs);

  const publish = (event: StarlingEvent): void => {
    try {
      store.appendEvent(event);
      if (event.type === 'run.created' || event.type === 'run.finished') {
        store.saveRun(event.payload.run);
      }
      bus.publish(event);
    } catch (err) {
      options.onError?.(err);
    }
  };

  const step = (): void => {
    if (stopped) return;
    const source = file.events[index];
    if (source === undefined) {
      if (options.loop !== true) {
        stop();
        return;
      }
      round += 1;
      index = 0;
      timer = setTimeout(step, gapMs / speed);
      timer.unref?.();
      return;
    }
    index += 1;

    const offset = offsetFor(round);
    // Re-played rounds are shifted forward in time so `?since=` stays monotonic; payload timestamps
    // keep their recorded values (the recording is the artifact, only delivery is re-timed).
    publish(offset === 0 ? source : ({ ...source, ts: source.ts + offset } as StarlingEvent));

    const next = file.events[index];
    const delay = next === undefined ? 0 : Math.max(0, (next.ts - source.ts) / speed);
    timer = setTimeout(step, delay);
    timer.unref?.();
  };

  step();

  return { runId: file.runId, done, stop };
}

/** Convenience wrapper for `POST /api/replay`: load, validate, then start. */
export function startJsonlReplay(path: string, options: Omit<ReplayOptions, 'file'>): ReplayHandle {
  return startReplay({ ...options, file: loadReplayFile(path) });
}
