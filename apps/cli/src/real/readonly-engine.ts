/**
 * A read-only `EngineApi` over a store, for `starling dash`.
 *
 * The dashboard does not own a run: `starling run` does. `dash` serves history — every run in the
 * repo's SQLite store — plus the live bus of whatever *this* process knows, which is nothing. So
 * reads work, and starting/cancelling work says so honestly instead of pretending (a 501 on the
 * launch form beats a silent no-op).
 */
import type { Run, Store } from '@starling/core';
import { StarlingError } from '@starling/core';
import type { EngineApi } from '../handshake';

export function createReadOnlyEngine(store: Store): EngineApi {
  const refuse =
    (what: string): (() => Promise<never>) =>
    async () => {
      throw new StarlingError(
        'NOT_IMPLEMENTED',
        `${what} needs a running engine — start the run with \`starling run "<goal>"\``,
      );
    };

  return {
    start: refuse('Starting a run from the dashboard'),
    cancel: refuse('Cancelling a run from the dashboard'),
    abortTask: refuse('Aborting a task from the dashboard'),
    getRun: (runId: string): Run | undefined => store.getRun(runId),
    listRuns: (): Run[] => store.listRuns(),
    waitForFinish: refuse('Waiting for a run that this process does not own'),
  };
}
