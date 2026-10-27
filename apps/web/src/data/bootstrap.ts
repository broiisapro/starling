import type { Run, StarlingEvent } from '@starling/core/browser';
import { DEFAULT_DEMO_SPEED, type DemoSpeed } from '../lib/speed';
import type { PublicConfig } from './api';
import { demoJoinInfo, fetchJoinInfo, fetchPublicConfig, fetchRuns } from './api';
import { DEMO_LOOP_PAUSE_MS, demoEvents, parseJsonl, playDemo } from './demo';
import type { JoinInfo } from './handshake';
import type { ConnectionState } from './reducer';
import { ALL_EVENTS_URL, connectEvents, type EventSourceFactory, type SseTimers } from './sse';
import { skyActions } from './store';

/**
 * Boots the data layer: live SSE when a Starling server answers, the recorded fixture when it does
 * not (or when `?demo=1` is in the URL). This is what makes the dashboard demo-able on a plane.
 *
 * Live boot is four small calls, not one: `/api/health` decides the mode, then `/api/runs` seeds the
 * run picker, `/api/flock/join` fills the join card and `/api/config/public` fills the header's model
 * line. They run in parallel and every one is optional — an older hub without the last two routes
 * still gets a working dashboard.
 */

/** The store methods bootstrap needs. Tests can pass a fake to observe events. */
export interface SkySink {
  ingest(event: StarlingEvent): void;
  setConnection(connection: ConnectionState): void;
  reset(): void;
  /** Live: seed runs before the backlog. Optional so old test sinks keep working. */
  ingestRuns?(runs: readonly Run[]): void;
  setJoin?(join: JoinInfo | undefined): void;
  setPublicConfig?(config: PublicConfig | undefined): void;
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
  runsUrl?: string;
  joinUrl?: string;
  configUrl?: string;
  healthTimeoutMs?: number;
  /** Give the three REST calls this long before booting the stream anyway. Default 2 s. */
  apiTimeoutMs?: number;
  /** Start the SSE backlog from this timestamp (a stored cursor / reconnect). */
  since?: number;
  /** Origin used to synthesise the demo join card. Defaults to `location.origin` or localhost:7777. */
  joinOrigin?: string;
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

/**
 * Hydrate the live dashboard, then tail `/api/events`.
 *
 * The stream is opened without `since` on first boot: the backlog is the run's history, which is
 * exactly what an attach-mid-run control room needs. Reconnects inside `connectEvents` pass the last
 * seen `ts`, so a flaky wifi moment resumes instead of replaying. A caller that already has a cursor
 * passes `since`.
 */
async function startLive(options: StartSkyDataOptions, sink: SkySink): Promise<StartSkyDataResult> {
  const timers = options.timers ?? defaultTimers;
  const api = new AbortController();
  const timeout = timers.setTimeout(() => api.abort(), options.apiTimeoutMs ?? 2_000);
  const fetchOptions = {
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    signal: api.signal,
  };

  try {
    const [runs, join, config] = await Promise.all([
      fetchRuns({ ...fetchOptions, ...(options.runsUrl === undefined ? {} : { url: options.runsUrl }) }),
      fetchJoinInfo({ ...fetchOptions, ...(options.joinUrl === undefined ? {} : { url: options.joinUrl }) }),
      fetchPublicConfig({
        ...fetchOptions,
        ...(options.configUrl === undefined ? {} : { url: options.configUrl }),
      }),
    ]);
    if (runs !== undefined) sink.ingestRuns?.(runs);
    sink.setJoin?.(join);
    sink.setPublicConfig?.(config);
  } finally {
    timers.clearTimeout(timeout);
  }

  const handle = connectEvents({
    url: options.eventsUrl ?? ALL_EVENTS_URL,
    ...(options.since === undefined ? {} : { since: options.since }),
    onEvent: (event) => sink.ingest(event),
    onStatus: (status) => sink.setConnection(status === 'live' ? 'live' : 'offline'),
    ...(options.factory === undefined ? {} : { factory: options.factory }),
    ...(options.timers === undefined ? {} : { timers: options.timers }),
  });
  // Health already answered: show "live" while the EventSource handshake completes.
  sink.setConnection('live');
  return {
    mode: 'live',
    stop: () => {
      api.abort();
      handle.close();
    },
  };
}

function browserOrigin(): string | undefined {
  const location = (globalThis as { location?: { origin?: string } }).location;
  return location?.origin === undefined || location.origin === '' ? undefined : location.origin;
}

/** Start the demo player over the recorded fixture. */
function startDemo(options: StartSkyDataOptions, sink: SkySink): StartSkyDataResult {
  // A speed switch or a React StrictMode remount starts a new replay; clear the old one first.
  sink.reset();
  sink.setConnection('demo');
  // No server to ask, but the join card is half the demo: synthesise the hub's own answer.
  sink.setJoin?.(demoJoinInfo(options.joinOrigin ?? browserOrigin()));
  sink.setPublicConfig?.(undefined);
  const handle = playDemo({
    events: demoEvents(),
    speed: options.speed ?? DEFAULT_DEMO_SPEED,
    loop: options.loop ?? true,
    loopPauseMs: options.loopPauseMs ?? DEMO_LOOP_PAUSE_MS,
    // The recording is from launch day; on stage it must read as happening right now.
    rebaseTo: () => Date.now(),
    timers: options.timers,
    onEvent: (event) => sink.ingest(event),
    onLoop: () => sink.reset(),
  });
  return { mode: 'demo', stop: () => handle.stop() };
}

/**
 * Resolves once the mode is chosen and the first data has been handed to the store (live: runs + the
 * SSE handshake; demo: the first event synchronously). Call `stop()` from the React effect cleanup —
 * it closes the EventSource or clears demo timers.
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
