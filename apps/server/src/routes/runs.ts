/** `GET/POST /api/runs*` — the run surface from ARCHITECTURE §6. */
import type { Run, Store } from '@starling/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { EngineApi, StartRunInput } from '../handshake';
import { fail, parseJsonBody } from '../http';

export const MAX_PARALLEL_LIMIT = 64;

export const StartRunBodySchema = z.object({
  goal: z.string().trim().min(1, 'goal is required'),
  repoPath: z.string().trim().min(1, 'repoPath is required'),
  dryRun: z.boolean().optional(),
  maxParallel: z.number().int().min(1).max(MAX_PARALLEL_LIMIT).optional(),
  baseBranch: z.string().trim().min(1).optional(),
});

export type StartRunBody = z.infer<typeof StartRunBodySchema>;

export interface RunRouteDeps {
  engine: EngineApi;
  store: Store;
}

/**
 * Look a run up in the store first (it survives restarts) and fall back to the engine (a run created
 * this tick may not be persisted yet, and an in-flight run's copy is the freshest).
 */
export function findRun(deps: Pick<RunRouteDeps, 'engine' | 'store'>, runId: string): Run | undefined {
  return deps.store.getRun(runId) ?? deps.engine.getRun(runId);
}

export function mountRuns(app: Hono, deps: RunRouteDeps): void {
  app.get('/api/runs', (c) => c.json(deps.store.listRuns()));

  app.get('/api/runs/:id', (c) => {
    const run = findRun(deps, c.req.param('id'));
    if (run === undefined) return fail(c, 404, 'RUN_NOT_FOUND', `No run ${c.req.param('id')}`);
    return c.json(run);
  });

  app.post('/api/runs', async (c) => {
    const body = await parseJsonBody(c, StartRunBodySchema);
    if (!body.ok) return body.response;
    const input: StartRunInput = {
      goal: body.value.goal,
      repoPath: body.value.repoPath,
      ...(body.value.dryRun === undefined ? {} : { dryRun: body.value.dryRun }),
      ...(body.value.maxParallel === undefined ? {} : { maxParallel: body.value.maxParallel }),
      ...(body.value.baseBranch === undefined ? {} : { baseBranch: body.value.baseBranch }),
    };
    const { runId } = await deps.engine.start(input);
    return c.json({ runId }, 201);
  });

  app.post('/api/runs/:id/cancel', async (c) => {
    const runId = c.req.param('id');
    if (findRun(deps, runId) === undefined) {
      return fail(c, 404, 'RUN_NOT_FOUND', `No run ${runId}`);
    }
    await deps.engine.cancel(runId);
    return c.json({ ok: true });
  });

  app.post('/api/runs/:id/tasks/:key/abort', async (c) => {
    const runId = c.req.param('id');
    const taskKey = c.req.param('key');
    const run = findRun(deps, runId);
    if (run === undefined) return fail(c, 404, 'RUN_NOT_FOUND', `No run ${runId}`);
    if (run.tasks[taskKey] === undefined) {
      return fail(c, 404, 'NOT_FOUND', `Run ${runId} has no task ${taskKey}`);
    }
    await deps.engine.abortTask(runId, taskKey);
    return c.json({ ok: true });
  });
}
