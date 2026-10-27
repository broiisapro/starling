import type { StarlingEvent } from './contracts';
import type { EventBus } from './ports';

/**
 * Create the in-process event bus (ARCHITECTURE §4: every engine transition publishes an event).
 *
 * Fan-out is synchronous and ordered by subscription. A subscriber that throws does not break the
 * others: the failure is reported to every subscriber as a `log` event with level `error`. If a
 * `log` subscriber itself throws, the error is dropped (we cannot log a logging failure without a
 * loop) — this is the one intentionally silent path in core.
 */
export function createEventBus(): EventBus {
  const subscribers = new Set<(e: StarlingEvent) => void>();
  let reportingLogFailure = false;

  const emit = (event: StarlingEvent): void => {
    for (const fn of [...subscribers]) {
      try {
        fn(event);
      } catch (err) {
        if (reportingLogFailure) continue;
        reportingLogFailure = true;
        try {
          const detail = err instanceof Error ? err.message : String(err);
          emit({
            type: 'log',
            runId: event.runId,
            ts: event.ts,
            payload: { level: 'error', msg: `event subscriber threw: ${detail}` },
          });
        } finally {
          reportingLogFailure = false;
        }
      }
    }
  };

  return {
    publish: emit,
    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}
