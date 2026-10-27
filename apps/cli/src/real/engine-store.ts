/**
 * The store the engine writes through when `attachRecorder` owns the event log.
 *
 * `RunDriver.publish()` appends every event to its injected store *and* publishes it on the bus, and
 * `attachRecorder(bus, store)` then appends the same event again. Wiring both straight to SQLite
 * doubles the log (the run still looks right, but `starling status` and the JSONL export show every
 * event twice). So the engine gets this facade: run snapshots are forwarded (the engine saves them
 * itself, and `getRun` must see them immediately), `appendEvent` is a no-op because the recorder is
 * the single writer, and reads pass through untouched.
 */
import type { Run, StarlingEvent, Store } from '@starling/core';

export function createRecorderOwnedStore(store: Store): Store {
  return {
    saveRun(run: Run): void {
      store.saveRun(run);
    },
    getRun(id: string): Run | undefined {
      return store.getRun(id);
    },
    listRuns(): Run[] {
      return store.listRuns();
    },
    appendEvent(_event: StarlingEvent): void {
      // Intentionally empty: attachRecorder(bus, store) writes the event log.
    },
    events(runId: string, sinceTs?: number): StarlingEvent[] {
      return store.events(runId, sinceTs);
    },
    exportJsonl(runId: string, path: string): void {
      store.exportJsonl(runId, path);
    },
  };
}
