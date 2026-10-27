/**
 * `GET /api/runs/:id/diff/:taskKey` — the drawer's Diff tab, fetched lazily.
 *
 * The event contract has no first-class diff event today: `TaskResult` carries the `DiffSummary` from
 * `ExecutionNode.collect`, but the engine only publishes the verdict and merge result. Rather than
 * pretend, this module reads the store with a *forward-compatible* rule — the latest event whose
 * payload carries a `DiffSummary` for that task, wherever it sits:
 *
 *   { taskKey, diff }                      a future `task.diff` event
 *   { taskKey, run, diff }                 an additive `diff` on `task.status`
 *   { taskKey, result: { diff } }          an additive `TaskResult` on any event
 *
 * Any event type is accepted, so an engine that starts publishing diffs needs no server change.
 * When nothing has been recorded the route answers 404, which the drawer renders as "no diff yet".
 */
import type { DiffSummary, StarlingEvent, Store } from '@starling/core';
import { DiffSummarySchema } from '@starling/core';
import type { Hono } from 'hono';
import type { EngineApi } from '../handshake';
import { fail } from '../http';
import { findRun } from './runs';

export interface DiffRouteDeps {
  engine: EngineApi;
  store: Store;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Pull a task key out of the shapes the engine could plausibly use. */
function taskKeyOf(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.taskKey === 'string') return payload.taskKey;
  const run = payload.run;
  if (isRecord(run) && typeof run.taskKey === 'string') return run.taskKey;
  return undefined;
}

/** The `DiffSummary` a payload carries, if any. */
function diffOf(payload: Record<string, unknown>): DiffSummary | undefined {
  const candidates: unknown[] = [payload.diff];
  if (isRecord(payload.result)) candidates.push(payload.result.diff);
  for (const candidate of candidates) {
    const parsed = DiffSummarySchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

/** The newest recorded diff for one task, or `undefined`. Scans newest-first. */
export function latestTaskDiff(events: readonly StarlingEvent[], taskKey: string): DiffSummary | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined) continue;
    if (!isRecord(event.payload)) continue;
    if (taskKeyOf(event.payload) !== taskKey) continue;
    const diff = diffOf(event.payload);
    if (diff !== undefined) return diff;
  }
  return undefined;
}

export function mountDiff(app: Hono, deps: DiffRouteDeps): void {
  app.get('/api/runs/:id/diff/:taskKey', (c) => {
    const runId = c.req.param('id');
    const taskKey = c.req.param('taskKey');
    const run = findRun(deps, runId);
    if (run === undefined) return fail(c, 404, 'RUN_NOT_FOUND', `No run ${runId}`);
    if (run.tasks[taskKey] === undefined) {
      return fail(c, 404, 'NOT_FOUND', `Run ${runId} has no task ${taskKey}`);
    }
    const diff = latestTaskDiff(deps.store.events(runId), taskKey);
    if (diff === undefined) {
      return fail(c, 404, 'NOT_FOUND', `No diff has been recorded for ${taskKey} yet`);
    }
    return c.json(diff);
  });
}
