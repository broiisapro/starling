import type { StarlingEvent } from '@starling/core';
import { DEFAULT_DEMO_SPEED, type DemoSpeed } from '../lib/speed';
import { DEMO_LOOP_PAUSE_MS, demoEvents, parseJsonl, playDemo } from './demo';
import type { ConnectionState } from './reducer';
import { ALL_EVENTS_URL, connectEvents, type EventSourceFactory, type SseTimers } from './sse';
import { skyActions } from './store';

/**
 * Boots the data layer: live SSE when a Starling server answers, the recorded fixture when it does
 * not (or when `?demo=1` is in the URL). This is what makes the dashboard demo-able on a plane.
 */

/** The store methods bootstrap needs. Tests can pass a fake to observe events. */
export interface SkySink {
  ingest(event: StarlingEvent): void;
  setConnection(connection: ConnectionState): void;
  reset(): void;
}

export interface StartSkyDataOptions {
  /** `true` forces demo, `false` forces live; undefined auto-detects from `/api/health`. */
  demo?: boolean;
  speed?: DemoSpeed;
  sink?: SkySink;
  fetchImpl?: typeof fetch;
  factory?: EventSourceFactory;
  timers?: SseTimers;
  healthUrl?: string;
  eventsUrl?: string;
  healthTimeoutMs?: number;
  loop?: boolean;
  loopPauseMs?: number;
}

export interface StartSkyDataResult {
  mode: 'live' | 'demo';
  stop(): void;
}

const defaultTimers: SseTimers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** `GET /api/health` with a short timeout. Any failure (network, 404, junk) means "no server". */
export async function probeHealth(options: StartSkyDataOptions = {}): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (fetchImpl === undefined) return false;
  const timers = options.timers ?? defaultTimers;
  const controller = new AbortController();
  const timeout = timers.setTimeout(() => controller.abort(), options.healthTimeoutMs ?? 1_500);
  try {
    const response = await fetchImpl(options.healthUrl ?? '/api/health', {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return isRecord(body) && body.ok === true;
  } catch {
    // No server, no key, no wifi — demo mode is the documented fallback.
    return false;
  } finally {
    timers.clearTimeout(timeout);
  }
}

/** Start live SSE against `/api/events`. */
function startLive(options: StartSkyDataOptions, sink: SkySink): StartSkyDataResult {
  const handle = connectEvents({
    url: options.eventsUrl ?? ALL_EVENTS_URL,
    onEvent: (event) => sink.ingest(event),
    onStatus: (status) => sink.setConnection(status === 'live' ? 'live' : 'offline'),
    factory: options.factory,
    timers: options.timers,
  });
  // Health already answered: show "live" while the EventSource handshake completes.
  sink.setConnection('live');
  return { mode: 'live', stop: () => handle.close() };
}

/** Start the demo player over the recorded fixture. */
function startDemo(options: StartSkyDataOptions, sink: SkySink): StartSkyDataResult {
  // A speed switch or a React StrictMode remount starts a new replay; clear the old one first.
  sink.reset();
  sink.setConnection('demo');
  const handle = playDemo({
    events: demoEvents(),
    speed: options.speed ?? DEFAULT_DEMO_SPEED,
    loop: options.loop ?? true,
    loopPauseMs: options.loopPauseMs ?? DEMO_LOOP_PAUSE_MS,
    timers: options.timers,
    onEvent: (event) => sink.ingest(event),
    onLoop: () => sink.reset(),
  });
  return { mode: 'demo', stop: () => handle.stop() };
}

/**
 * Resolves once the first event is in the store (live: on the SSE open/backlog, demo: immediately).
 * Call `stop()` from the React effect cleanup — it closes the EventSource or clears demo timers.
 */
export async function startSkyData(options: StartSkyDataOptions = {}): Promise<StartSkyDataResult> {
  const sink = options.sink ?? skyActions;
  if (options.demo === true) return startDemo(options, sink);
  if (options.demo === false) return startLive(options, sink);

  const healthy = await probeHealth(options);
  return healthy ? startLive(options, sink) : startDemo(options, sink);
}

/** Exposed for the JSONL replay path and tests. */
export { parseJsonl };
