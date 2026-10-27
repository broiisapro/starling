/**
 * `POST /api/replay` — re-publish a recorded JSONL log as a new run (ARCHITECTURE §6).
 *
 * The replay implementation is injected (`ServerDeps.replay`); in Wave 1 that is the fixture replay in
 * `replay.ts`, in Wave 2 the engine owns it. Without one the route answers 503 rather than pretending.
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import { fail, parseJsonBody } from '../http';

export const ReplayBodySchema = z.object({
  path: z.string().trim().min(1, 'path is required'),
  speed: z.number().positive().max(1000).optional(),
});

export type ReplayBody = z.infer<typeof ReplayBodySchema>;
export type ReplayFn = (path: string, speed?: number) => Promise<{ runId: string }>;

export interface ReplayRouteDeps {
  replay?: ReplayFn;
}

export function mountReplay(app: Hono, deps: ReplayRouteDeps): void {
  app.post('/api/replay', async (c) => {
    if (deps.replay === undefined) {
      return fail(c, 503, 'REPLAY_DISABLED', 'This server was started without a replay implementation.');
    }
    const body = await parseJsonBody(c, ReplayBodySchema);
    if (!body.ok) return body.response;

    const { runId } = await deps.replay(body.value.path, body.value.speed);
    return c.json({ runId }, 202);
  });
}
