import {
  type AgentEvent,
  type Clock,
  type EventBus,
  type ExecutionNode,
  isStarlingError,
  type NodeInfo,
  StartTaskOptionsSchema,
  systemClock,
  type TaskHandle,
  type TaskResult,
} from '@starling/core';
import { type Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { type ZodType, z } from 'zod';
import { FLOCK_TOKEN_HEADER, tokensMatch } from './auth';

export interface PerchAppDeps {
  /** The local `ExecutionNode` this perch exposes (Epic 30's `LocalNode` in production). */
  node: ExecutionNode;
  /** The flock join code. Every route requires it in `x-flock-token`. */
  token: string;
  /** Fresh `NodeInfo` for `GET /perch/info` (and the daemon's heartbeats). */
  info: () => Promise<NodeInfo>;
  /** Optional: perch lifecycle logs are published as `log` events with runId `'*'`. */
  bus?: EventBus;
  clock?: Clock;
  /** SSE keep-alive comment interval. Default 15 s. */
  keepAliveMs?: number;
}

/**
 * `createPerchApp` returns a Hono app plus the two hooks the daemon needs. The extra surface is
 * deliberately small: `startPerch` must be able to list in-flight tasks (for a graceful stop) and
 * abort them without reaching into the app's private maps.
 */
export type PerchApp = Hono & {
  /** Handles accepted and not yet cleaned up. */
  handles(): TaskHandle[];
  /** Abort every in-flight session. Best-effort; failures are logged, not thrown. */
  close(): Promise<void>;
};

const PromptBodySchema = z.object({ prompt: z.string().min(1) });
const CollectBodySchema = z.object({ baseRef: z.string().min(1) });
const ErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const taskKey = (runId: string, key: string): string => `${runId}/${key}`;

type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * The Perch HTTP API (ARCHITECTURE §6, LOCKED): the server side of a flock node.
 *
 * Design notes:
 * - Auth runs as middleware on `*`, so a new route cannot accidentally ship unauthenticated.
 * - Bodies are parsed with the frozen zod contracts; errors are always `{ error: { code, message } }`.
 * - A perch only accepts `repo.kind: 'bundle'`. `kind: 'local'` would mean "read the hub's disk",
 *   which is exactly the thing a remote machine must not be able to ask for.
 * - `collect` caches the `TaskResult`; the bundle route streams the `bundlePath` that
 *   `ExecutionNode.collect` wrote, rather than shelling out to git again.
 */
export function createPerchApp(deps: PerchAppDeps): PerchApp {
  const clock = deps.clock ?? systemClock;
  const keepAliveMs = deps.keepAliveMs ?? 15_000;
  const handles = new Map<string, TaskHandle>();
  const results = new Map<string, TaskResult>();
  const app = new Hono();

  const log = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, key?: string): void => {
    deps.bus?.publish({
      type: 'log',
      runId: '*',
      ts: clock.now(),
      payload: { level, msg, ...(key === undefined ? {} : { taskKey: key }) },
    });
  };

  const errorBody = (code: string, message: string): z.infer<typeof ErrorSchema> => ({
    error: { code, message },
  });

  app.use('*', async (c, next) => {
    if (!tokensMatch(c.req.header(FLOCK_TOKEN_HEADER), deps.token)) {
      return c.json(errorBody('unauthorized', 'missing or invalid x-flock-token'), 401);
    }
    await next();
  });

  app.get('/perch/info', async (c) => c.json(await deps.info()));

  app.post('/perch/tasks', async (c) => {
    const body = await readJson(c, StartTaskOptionsSchema);
    if (!body.ok) return body.response;
    if (body.data.repo.kind !== 'bundle') {
      return c.json(
        errorBody(
          'invalid-repo',
          "a perch only accepts repo.kind 'bundle'; it cannot read the hub's filesystem",
        ),
        400,
      );
    }

    const key = taskKey(body.data.runId, body.data.taskKey);
    const existing = handles.get(key);
    if (existing !== undefined) {
      // The hub retried a POST whose response it missed. Return the same session instead of
      // starting a second agent on the same branch (flaky Wi-Fi is the normal case on a LAN).
      log('debug', `perch replayed the handle for ${existing.taskKey}`, existing.taskKey);
      return c.json(existing);
    }

    const handle = await deps.node.startTask(body.data);
    handles.set(key, handle);
    log('info', `perch accepted ${handle.taskKey} (session ${handle.sessionId})`, handle.taskKey);
    return c.json(handle);
  });

  app.post('/perch/tasks/:runId/:key/prompt', async (c) => {
    const handle = handles.get(taskKey(c.req.param('runId'), c.req.param('key')));
    if (handle === undefined) return unknownTask(c);
    const body = await readJson(c, PromptBodySchema);
    if (!body.ok) return body.response;

    await deps.node.sendPrompt(handle, body.data.prompt);
    log('info', `perch forwarded a fixer prompt for ${handle.taskKey}`, handle.taskKey);
    return c.json({ ok: true });
  });

  app.post('/perch/tasks/:runId/:key/abort', async (c) => {
    const handle = handles.get(taskKey(c.req.param('runId'), c.req.param('key')));
    if (handle === undefined) return unknownTask(c);

    await deps.node.abort(handle);
    log('warn', `perch aborted ${handle.taskKey}`, handle.taskKey);
    return c.json({ ok: true });
  });

  app.post('/perch/tasks/:runId/:key/collect', async (c) => {
    const key = taskKey(c.req.param('runId'), c.req.param('key'));
    const handle = handles.get(key);
    if (handle === undefined) return unknownTask(c);
    const body = await readJson(c, CollectBodySchema);
    if (!body.ok) return body.response;

    // The second argument is the *hub's* repo. A perch never touches it: for bundle-sourced tasks
    // `LocalNode.collect` commits the perch worktree and writes a result bundle instead.
    const result = await deps.node.collect(handle, '', body.data.baseRef);
    results.set(key, result);
    log('info', `perch collected ${handle.taskKey} (${result.commit.slice(0, 8)})`, handle.taskKey);
    return c.json({ commit: result.commit, diff: result.diff, changedFiles: result.changedFiles });
  });

  app.get('/perch/tasks/:runId/:key/bundle', async (c) => {
    const key = taskKey(c.req.param('runId'), c.req.param('key'));
    if (!handles.has(key)) return unknownTask(c);

    const base = c.req.query('base');
    if (base !== undefined && base.trim().length === 0) {
      return c.json(errorBody('invalid-query', 'base must not be empty when supplied'), 400);
    }

    const result = results.get(key);
    if (result === undefined) {
      return c.json(errorBody('not-collected', 'collect the task before downloading its bundle'), 409);
    }
    if (result.bundlePath === undefined) {
      return c.json(errorBody('no-bundle', 'this task produced no changes, so there is no bundle'), 404);
    }

    const file = Bun.file(result.bundlePath);
    if (!(await file.exists())) {
      return c.json(errorBody('bundle-missing', `bundle file is gone: ${result.bundlePath}`), 404);
    }
    return new Response(file, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(file.size),
      },
    });
  });

  app.delete('/perch/tasks/:runId/:key', async (c) => {
    const key = taskKey(c.req.param('runId'), c.req.param('key'));
    const handle = handles.get(key);
    // Cleanup is idempotent: a hub that retries after a dropped response must not see an error.
    if (handle === undefined) return c.json({ ok: true });

    await deps.node.cleanup(handle);
    handles.delete(key);
    results.delete(key);
    log('debug', `perch cleaned up ${handle.taskKey}`, handle.taskKey);
    return c.json({ ok: true });
  });

  app.get('/perch/events', (c) =>
    streamSSE(c, async (stream) => {
      let closed = false;
      let notify: (() => void) | undefined;
      let keepAlive: ReturnType<typeof setInterval> | undefined;
      const queue: AgentEvent[] = [];

      const unsubscribe = deps.node.onEvent((event) => {
        queue.push(event);
        notify?.();
      });

      const stop = (): void => {
        if (closed) return;
        closed = true;
        if (keepAlive !== undefined) clearInterval(keepAlive);
        unsubscribe();
        notify?.();
      };
      // Register the abort listener before the first await: a client that disappears immediately
      // must still unsubscribe the node listener and clear the keep-alive.
      stream.onAbort(stop);

      // Flush headers immediately. Bun's `fetch` does not resolve until the first byte arrives, and
      // an idle SSE stream would otherwise look like a hung request to a client (or hit the server's
      // idle timeout before the first keep-alive).
      await stream.write(': connected\n\n');
      if (closed) return;

      keepAlive = setInterval(() => {
        void stream.write(': keep-alive\n\n');
      }, keepAliveMs);
      keepAlive.unref?.();

      try {
        while (!closed) {
          const event = queue.shift();
          if (event === undefined) {
            await new Promise<void>((resolve) => {
              notify = resolve;
            });
            notify = undefined;
            continue;
          }
          await stream.writeSSE({ data: JSON.stringify(event) });
        }
      } catch {
        // A write after disconnect rejects. That is a normal end of stream, not a perch error.
      } finally {
        stop();
      }
    }),
  );

  app.notFound((c) =>
    c.json(errorBody('not-found', `no perch route for ${c.req.method} ${c.req.path}`), 404),
  );

  app.onError((err, c) => {
    if (isStarlingError(err)) {
      log('error', `${err.code}: ${err.message}`);
      if (err.code === 'NODE_OFFLINE') return c.json(errorBody(err.code, err.message), 503);
      if (err.code === 'INVALID_ARGUMENT') return c.json(errorBody(err.code, err.message), 400);
      return c.json(errorBody(err.code, err.message), 500);
    }
    const message = err instanceof Error ? err.message : String(err);
    log('error', message);
    return c.json(errorBody('internal', message), 500);
  });

  return Object.assign(app, {
    handles: () => [...handles.values()],
    close: async (): Promise<void> => {
      const running = [...handles.values()];
      const outcomes = await Promise.allSettled(running.map((handle) => deps.node.abort(handle)));
      outcomes.forEach((outcome, index) => {
        if (outcome.status === 'rejected') {
          const handle = running[index];
          log(
            'warn',
            `perch could not abort ${handle?.taskKey ?? 'a task'} on shutdown: ${
              outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
            }`,
            handle?.taskKey,
          );
        }
      });
      handles.clear();
      results.clear();
    },
  }) as PerchApp;
}

async function readJson<T>(c: Context, schema: ZodType<T>): Promise<ParsedBody<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json({ error: { code: 'invalid-json', message: 'request body must be valid JSON' } }, 400),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return {
      ok: false,
      response: c.json({ error: { code: 'invalid-body', message } }, 400),
    };
  }
  return { ok: true, data: parsed.data };
}

function unknownTask(c: Context): Response {
  return c.json(
    { error: { code: 'unknown-task', message: 'this perch has no session for that run/task' } },
    404,
  );
}
