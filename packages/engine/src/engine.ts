/** `createEngine` — the engine's public entry point (ARCHITECTURE §4, §8). */

import type { Run } from '@starling/core';
import { StarlingError } from '@starling/core';
import type { EngineApi } from './handshake';
import { isRunSettled, RunDriver } from './run-driver';
import type { EngineDeps } from './types';

/**
 * Build an `EngineApi` over injected ports.
 *
 * `start()` resolves as soon as the run exists (status `mapping`); mapping, planning, dispatching,
 * auditing and merging continue in the background and stream as events. Call `waitForFinish()` (the
 * CLI does) or subscribe to the bus (the dashboard does).
 */
export function createEngine(deps: EngineDeps): EngineApi {
  const drivers = new Map<string, RunDriver>();

  return {
    async start(input) {
      if (typeof input.goal !== 'string' || input.goal.trim().length === 0) {
        throw new StarlingError('INVALID_ARGUMENT', 'A non-empty goal is required');
      }
      if (typeof input.repoPath !== 'string' || input.repoPath.trim().length === 0) {
        throw new StarlingError('INVALID_ARGUMENT', 'A repoPath is required');
      }
      const driver = new RunDriver(deps, input);
      drivers.set(driver.runId, driver);
      void driver.begin();
      return { runId: driver.runId };
    },

    async cancel(runId) {
      const driver = drivers.get(runId);
      if (driver === undefined) {
        const stored = deps.store.getRun(runId);
        if (stored === undefined) {
          throw new StarlingError('INVALID_ARGUMENT', `Unknown run "${runId}"`, { details: { runId } });
        }
        return;
      }
      await driver.cancel();
    },

    async abortTask(runId, taskKey) {
      const driver = drivers.get(runId);
      if (driver === undefined) {
        throw new StarlingError('INVALID_ARGUMENT', `Run "${runId}" is not active in this engine`, {
          details: { runId, taskKey },
        });
      }
      await driver.abortTask(taskKey);
    },

    getRun(runId) {
      return deps.store.getRun(runId);
    },

    listRuns() {
      return deps.store.listRuns();
    },

    waitForFinish(runId): Promise<Run> {
      const driver = drivers.get(runId);
      if (driver !== undefined) return driver.done;
      const stored = deps.store.getRun(runId);
      if (stored === undefined) {
        return Promise.reject(
          new StarlingError('INVALID_ARGUMENT', `Unknown run "${runId}"`, { details: { runId } }),
        );
      }
      if (isRunSettled(stored.status)) return Promise.resolve(stored);
      return Promise.reject(
        new StarlingError('INVALID_ARGUMENT', `Run "${runId}" is not owned by this engine instance`, {
          details: { runId, status: stored.status },
        }),
      );
    },
  };
}
