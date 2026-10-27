import type { StarlingEvent } from '@starling/core/browser';
import { StarlingError } from '@starling/core/browser';

/**
 * The dashboard's live connection: one EventSource, exponential-backoff reconnect, and a `since`
 * resume so a flaky wifi moment does not lose a run's history.
 *
 * Two endpoints (ARCHITECTURE §6):
 * - `/api/events`                     every event, run-scoped and flock-global
 * - `/api/runs/:id/events?since=<ts>` a single run's backlog + live tail
 */

export type SseStatus = 'connecting' | 'live' | 'offline';

/** The slice of EventSource we use. Tests inject a fake; happy-dom may not implement EventSource. */
export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface SseTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BackoffOptions {
  /** First retry delay. */
  baseMs: number;
  /** Delay ceiling. */
  maxMs: number;
  /** Exponential growth per failed attempt. */
  factor: number;
  /** 0 = perfectly regular retries; 0.2 = ±20% so a fleet of tabs doesn't stampede. */
  jitterRatio: number;
  random(): number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 1_000,
  maxMs: 30_000,
  factor: 2,
  jitterRatio: 0.2,
  random: Math.random,
};

export function nextBackoffDelay(attempt: number, options: BackoffOptions = DEFAULT_BACKOFF): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const raw = Math.min(options.maxMs, options.baseMs * options.factor ** safeAttempt);
  const jitter = 1 - options.jitterRatio + options.jitterRatio * 2 * options.random();
  return Math.max(0, Math.min(options.maxMs, Math.round(raw * jitter)));
}

export interface ConnectOptions {
  url: string;
  onEvent(event: StarlingEvent): void;
  onStatus?(status: SseStatus, detail: { attempt: number; delayMs?: number; url: string }): void;
  onError?(error: StarlingError): void;
  factory?: EventSourceFactory;
  timers?: SseTimers;
  backoff?: Partial<BackoffOptions>;
  /** Query parameter used to resume; the server's contract is `since`. */
  sinceParam?: string;
  /** Start from this timestamp (e.g. the last event already in the store). */
  since?: number;
  /** Give up after this many reconnect attempts. Unlimited by default — a dashboard should heal. */
  maxRetries?: number;
}

export interface SseHandle {
  readonly status: SseStatus;
  readonly lastTs: number | undefined;
  readonly url: string;
  close(): void;
}

const defaultTimers: SseTimers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

function defaultFactory(url: string): EventSourceLike {
  const Ctor = (globalThis as { EventSource?: new (url: string) => EventSourceLike }).EventSource;
  if (Ctor === undefined) {
    throw new StarlingError('NOT_IMPLEMENTED', 'EventSource is unavailable in this environment', {
      details: { url },
    });
  }
  return new Ctor(url);
}

function malformed(raw: unknown, url: string): StarlingError {
  const preview = typeof raw === 'string' ? raw.slice(0, 120) : String(raw);
  return new StarlingError('UNKNOWN', 'Malformed SSE event payload', { details: { url, preview } });
}

function looksLikeEvent(value: unknown): value is StarlingEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === 'string' &&
    typeof candidate.runId === 'string' &&
    typeof candidate.ts === 'number' &&
    typeof candidate.payload === 'object' &&
    candidate.payload !== null
  );
}

/** Parse one `data:` line. Returns `undefined` after reporting a bad frame. */
export function parseSseEvent(
  raw: unknown,
  onError?: (error: StarlingError) => void,
): StarlingEvent | undefined {
  let parsed: unknown;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : undefined;
  } catch {
    const error = malformed(raw, 'parse');
    if (onError === undefined) throw error;
    onError(error);
    return undefined;
  }
  if (!looksLikeEvent(parsed)) {
    const error = malformed(parsed, 'shape');
    if (onError === undefined) throw error;
    onError(error);
    return undefined;
  }
  return parsed;
}

export function runEventsUrl(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/events`;
}

export const ALL_EVENTS_URL = '/api/events';

export function withSince(url: string, since: number | undefined, param = 'since'): string {
  if (since === undefined) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(param)}=${Math.floor(since)}`;
}

/**
 * Open an SSE stream and keep it open.
 *
 * Status reporting: `connecting` immediately, `live` on open, `offline` on error. Reconnects resume
 * from the last event's `ts`, so the server replays only what we missed.
 */
export function connectEvents(options: ConnectOptions): SseHandle {
  const timers = options.timers ?? defaultTimers;
  const factory = options.factory ?? defaultFactory;
  const backoff: BackoffOptions = { ...DEFAULT_BACKOFF, ...options.backoff };
  const sinceParam = options.sinceParam ?? 'since';

  let status: SseStatus = 'connecting';
  let lastTs = options.since;
  let attempt = 0;
  let closed = false;
  let source: EventSourceLike | undefined;
  let timer: unknown;

  const setStatus = (next: SseStatus, delayMs?: number): void => {
    status = next;
    const detail: { attempt: number; delayMs?: number; url: string } = {
      attempt,
      url: options.url,
    };
    if (delayMs !== undefined) detail.delayMs = delayMs;
    options.onStatus?.(next, detail);
  };

  const scheduleReconnect = (): void => {
    if (closed) return;
    if (options.maxRetries !== undefined && attempt >= options.maxRetries) {
      setStatus('offline');
      return;
    }
    const delayMs = nextBackoffDelay(attempt, backoff);
    attempt += 1;
    setStatus('offline', delayMs);
    timer = timers.setTimeout(() => {
      timer = undefined;
      open();
    }, delayMs);
  };

  const open = (): void => {
    if (closed) return;
    const url = withSince(options.url, lastTs, sinceParam);
    setStatus('connecting');
    let nextSource: EventSourceLike;
    try {
      nextSource = factory(url);
    } catch (error) {
      options.onError?.(
        new StarlingError('UNKNOWN', 'Could not open the event stream', { cause: error, details: { url } }),
      );
      scheduleReconnect();
      return;
    }
    source = nextSource;

    nextSource.onopen = () => {
      if (closed) return;
      attempt = 0;
      setStatus('live');
    };

    nextSource.onmessage = (message: MessageEvent) => {
      if (closed) return;
      const event = parseSseEvent(message.data, (error) => options.onError?.(error));
      if (event === undefined) return;
      lastTs = Math.max(lastTs ?? Number.NEGATIVE_INFINITY, event.ts);
      options.onEvent(event);
    };

    nextSource.onerror = () => {
      if (closed) return;
      nextSource.close();
      if (source === nextSource) source = undefined;
      scheduleReconnect();
    };
  };

  open();

  return {
    get status() {
      return status;
    },
    get lastTs() {
      return lastTs;
    },
    get url() {
      return options.url;
    },
    close() {
      closed = true;
      if (timer !== undefined) timers.clearTimeout(timer);
      timer = undefined;
      source?.close();
      source = undefined;
    },
  };
}

/** Convenience wrapper for the per-run stream. */
export function connectRunEvents(runId: string, options: Omit<ConnectOptions, 'url'>): SseHandle {
  return connectEvents({ ...options, url: runEventsUrl(runId) });
}
