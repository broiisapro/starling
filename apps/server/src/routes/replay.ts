/**
 * `POST /api/replay` — re-publish a recorded JSONL log as a new run (ARCHITECTURE §6).
 *
 * The replay implementation is injected (`ServerDeps.replay`); in Wave 1 that is the fixture replay in
 * `replay.ts`, in Wave 2 the engine owns it. Without one the route answers 503 rather than pretending.
 *
 * A replay reads a file from the hub's disk, so every call passes the injected `allowPath` allow-list
 * first (Epic 41 closes E21's open question). A rejected path is a 403 `FORBIDDEN`, never a silent read.
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import { fail, parseJsonBody } from '../http';
import type { ReplayPathDecision } from '../replay-paths';

export const ReplayBodySchema = z.object({
  path: z.string().trim().min(1, 'path is required'),
  speed: z.number().positive().max(1000).optional(),
});

export type ReplayBody = z.infer<typeof ReplayBodySchema>;
export type ReplayFn = (path: string, speed?: number) => Promise<{ runId: string }>;

/** Decide whether a path may be replayed; the server injects its repo roots here. */
export type ReplayPathGuard = (path: string) => ReplayPathDecision;

export interface ReplayRouteDeps {
  replay?: ReplayFn;
  /**
   * Called before the replay implementation sees the path. Absent means "this composition trusts its
   * caller" (tests and the demo server); `createApp` always injects one in production.
   */
  allowPath?: ReplayPathGuard;
}

export function mountReplay(app: Hono, deps: ReplayRouteDeps): void {
  app.post('/api/replay', async (c) => {
    if (deps.replay === undefined) {
      return fail(c, 503, 'REPLAY_DISABLED', 'This server was started without a replay implementation.');
    }
    const body = await parseJsonBody(c, ReplayBodySchema);
    if (!body.ok) return body.response;

    const decision = deps.allowPath?.(body.value.path);
    if (decision !== undefined && !decision.ok) {
      return fail(
        c,
        403,
        'FORBIDDEN',
        decision.reason ?? 'That replay path is outside the allowed directories.',
      );
    }

    const { runId } = await deps.replay(decision?.path ?? body.value.path, body.value.speed);
    return c.json({ runId }, 202);
  });
}
