/**
 * `GET /api/runs/:id/events` and `GET /api/events` — the two SSE streams in ARCHITECTURE §6.
 *
 * Both are backlog-then-live. The per-run stream is scoped by `runId`; the all-events stream carries
 * run-scoped events *and* the flock's `node.*` events (which are stored under the `'*'` bucket).
 */
import type { EventBus, StarlingEvent, Store } from '@starling/core';
import type { Hono } from 'hono';
import type { EngineApi } from '../handshake';
import { fail, parseSince } from '../http';
import { streamEvents } from '../sse';
import { findRun } from './runs';

export interface EventRouteDeps {
  engine: EngineApi;
  store: Store;
  bus: EventBus;
  keepAliveMs: number;
  onStreamError: (err: unknown) => void;
}

/**
 * Every persisted event, oldest first: run buckets plus the `'*'` bucket that holds `node.*` events.
 * `since` is passed through to the store so a reconnect does not re-read the whole transcript.
 */
export function allEvents(store: Store, since?: number, runIds?: string[]): StarlingEvent[] {
  const ids = runIds ?? store.listRuns().map((run) => run.id);
  const events = [...store.events('*', since)];
  for (const runId of ids) events.push(...store.events(runId, since));
  return events.sort((a, b) => a.ts - b.ts);
}

export function mountEvents(app: Hono, deps: EventRouteDeps): void {
  app.get('/api/runs/:id/events', (c) => {
    const runId = c.req.param('id');
    if (findRun(deps, runId) === undefined) {
      return fail(c, 404, 'RUN_NOT_FOUND', `No run ${runId}`);
    }
    const since = parseSince(c);
    if (!since.ok) return since.response;

    return streamEvents(
      c,
      {
        loadBacklog: () => deps.store.events(runId, since.since),
        subscribe: (fn) => deps.bus.subscribe((event) => (event.runId === runId ? fn(event) : undefined)),
      },
      { since: since.since, keepAliveMs: deps.keepAliveMs, onError: deps.onStreamError },
    );
  });

  app.get('/api/events', (c) => {
    const since = parseSince(c);
    if (!since.ok) return since.response;

    return streamEvents(
      c,
      {
        loadBacklog: () => allEvents(deps.store, since.since),
        subscribe: (fn) => deps.bus.subscribe(fn),
      },
      { since: since.since, keepAliveMs: deps.keepAliveMs, onError: deps.onStreamError },
    );
  });
}
