/**
 * `attachRecorder` — persist everything the engine publishes.
 *
 * Every event goes into the store; the derived `Run` snapshot is saved on the three event types
 * that carry a new snapshot (`run.created`, `task.status`, `run.finished`), so `getRun()` works
 * while a run is still in flight without re-folding the whole stream on every read.
 *
 * The accumulator is incremental, not a re-fold, so a 10k-event run costs linear time overall.
 */
import type { EventBus, StarlingEventType, Store } from '@starling/core';
import { createRunAccumulator } from './derive';

/** The events that carry (or finalise) a full `Run` snapshot. */
const SAVE_RUN_ON: ReadonlySet<StarlingEventType> = new Set<StarlingEventType>([
  'run.created',
  'task.status',
  'run.finished',
]);

/** Subscribe `store` to `bus`. Returns the unsubscribe function. */
export function attachRecorder(bus: EventBus, store: Store): () => void {
  const accumulator = createRunAccumulator();

  return bus.subscribe((event) => {
    store.appendEvent(event);
    accumulator.apply(event);
    if (SAVE_RUN_ON.has(event.type)) {
      const run = accumulator.run();
      if (run !== undefined) store.saveRun(run);
    }
  });
}
