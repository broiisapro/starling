/** The three-line dependency of every route: an engine, a store and a bus. */
import type { EventBus } from '@starling/core';
import type { MiddlewareHandler } from 'hono';

/**
 * Events that belong to no run (request logs, flock heartbeats) use `'*'` as their `runId`, matching
 * ARCHITECTURE §6's `node.*` convention. Keeping request logs out of a run's stream means the Agent
 * drawer is never padded with HTTP noise.
 */
export const RUN_AGNOSTIC_RUN_ID = '*';

/**
 * One debug `log` event per request, through the bus so it reaches `/api/events` (and, in future,
 * the JSONL log) without a second logging subsystem.
 */
export function requestLogger(bus: EventBus, now: () => number = Date.now): MiddlewareHandler {
  return async (c, next) => {
    const started = now();
    await next();
    const path = new URL(c.req.url).pathname;
    const elapsed = Math.max(0, now() - started);
    bus.publish({
      type: 'log',
      runId: RUN_AGNOSTIC_RUN_ID,
      ts: now(),
      payload: { level: 'debug', msg: `${c.req.method} ${path} → ${c.res.status} (${elapsed}ms)` },
    });
  };
}
