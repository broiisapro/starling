import {
  type Clock,
  type EventBus,
  type ExecutionNode,
  isStarlingError,
  type NodeInfo,
  systemClock,
  type TaskHandle,
  type TaskResult,
} from '@starling/core';
import { type Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { type ZodType, z } from 'zod';
import { FLOCK_TOKEN_HEADER, tokensMatch } from './auth';
import {
  type DrainOptions,
  type DrainReport,
  defaultDrainSleep,
  PERCH_DRAIN_POLL_MS,
  PERCH_DRAIN_TIMEOUT_MS,
} from './drain';
import { createEventLog } from './event-log';
import { buildPerchHealth, type PerchHealth, type PerchHealthProbes } from './health';
import {
  isSafeId,
  isSafeRef,
  PerchCollectSchema,
  PerchPromptSchema,
  PerchStartTaskSchema,
} from './validate';

/**
 * Largest request body the perch will parse (SEC-05). A hub never legitimately sends more: the
 * biggest field is a worker prompt, and 256 KiB is several thousand lines of instructions. The
 * limit is enforced twice — the declared `content-length` first (cheap rejection) and then the
 * bytes actually streamed (a chunked body can lie about, or omit, its length).
 */
export const PERCH_MAX_BODY_BYTES = 256 * 1024;

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
  /**
   * Probes behind `GET /perch/health`. `startPerch` always wires them; a bare app (tests, embedding)
   * may omit them, in which case the route answers 503 `health-unavailable` instead of lying.
   */
  health?: PerchHealthProbes;
}

/**
 * `createPerchApp` returns a Hono app plus the hooks the daemon needs. The extra surface is
 * deliberately small: `startPerch` must be able to list in-flight tasks (for a graceful stop or a
 * drain) and abort them without reaching into the app's private maps.
 */
export type PerchApp = Hono & {
  /** Handles accepted and not yet cleaned up. */
  handles(): TaskHandle[];
  /** Abort every in-flight session. Best-effort; failures are logged, not thrown. */
  close(): Promise<void>;
  /**
   * Enter/leave drain mode. While draining, `POST /perch/tasks` answers 503 `draining` for a new
   * task (a retry of an existing handle still gets that handle back).
   */
  setDraining(on: boolean): void;
  isDraining(): boolean;
  /** Wait for the hub to delete every task, aborting whatever is left at the timeout. */
  drainTasks(opts?: DrainOptions): Promise<DrainReport>;
};

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
  /** One backlog for the whole perch: every `/perch/events` client reads the same event ids. */
  const events = createEventLog();
  const unsubscribeNode = deps.node.onEvent((event) => {
    events.append(event);
  });
  const app = new Hono();
  let draining = false;

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

  // Token-guarded like every other route: the presence of a perch on the LAN is not public.
  app.get('/perch/health', async (c) => {
    if (deps.health === undefined) {
      return c.json(
        errorBody('health-unavailable', 'this perch was started without health probes'),
        503,
      );
    }
    // The app's own drain state wins over the probe's, so a caller cannot report "healthy" while
    // this app is refusing new tasks.
    const health: PerchHealth = await buildPerchHealth({
      ...deps.health,
      draining: () => draining || deps.health?.draining() === true,
    });
    return c.json(health, health.ok ? 200 : 503);
  });

  app.post('/perch/tasks', async (c) => {
    const body = await readJson(c, PerchStartTaskSchema);
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
      // starting a second agent on the same branch (flaky Wi-Fi is the normal case on a LAN), even
      // while draining: a retry is not new work.
      log('debug', `perch replayed the handle for ${existing.taskKey}`, existing.taskKey);
      return c.json(existing);
    }
    if (draining) {
      log('warn', `perch is draining; refused ${body.data.taskKey}`, body.data.taskKey);
      return c.json(
        errorBody('draining', 'this perch is draining for a restart and accepts no new tasks'),
        503,
      );
    }

    const handle = await deps.node.startTask(body.data);
    handles.set(key, handle);
    log('info', `perch accepted ${handle.taskKey} (session ${handle.sessionId})`, handle.taskKey);
    return c.json(handle);
  });

  app.post('/perch/tasks/:runId/:key/prompt', async (c) => {
    const params = readTaskParams(c);
    if (params === undefined) return invalidParams(c);
    // Read the body before looking the handle up: a hub that sends a 1 MiB body gets the same 413
    // whether or not the session still exists (SEC-05).
    const body = await readJson(c, PerchPromptSchema);
    if (!body.ok) return body.response;

    const handle = handles.get(taskKey(params.runId, params.key));
    if (handle === undefined) return unknownTask(c);

    await deps.node.sendPrompt(handle, body.data.prompt);
    log('info', `perch forwarded a fixer prompt for ${handle.taskKey}`, handle.taskKey);
    return c.json({ ok: true });
  });

  app.post('/perch/tasks/:runId/:key/abort', async (c) => {
    const params = readTaskParams(c);
    if (params === undefined) return invalidParams(c);
    const handle = handles.get(taskKey(params.runId, params.key));
    if (handle === undefined) return unknownTask(c);

    await deps.node.abort(handle);
    log('warn', `perch aborted ${handle.taskKey}`, handle.taskKey);
    return c.json({ ok: true });
  });

  app.post('/perch/tasks/:runId/:key/collect', async (c) => {
    const params = readTaskParams(c);
    if (params === undefined) return invalidParams(c);
    const body = await readJson(c, PerchCollectSchema);
    if (!body.ok) return body.response;

    const key = taskKey(params.runId, params.key);
    const handle = handles.get(key);
    if (handle === undefined) return unknownTask(c);

    // The second argument is the *hub's* repo. A perch never touches it: for bundle-sourced tasks
    // `LocalNode.collect` commits the perch worktree and writes a result bundle instead.
    const result = await deps.node.collect(handle, '', body.data.baseRef);
    results.set(key, result);
    log('info', `perch collected ${handle.taskKey} (${result.commit.slice(0, 8)})`, handle.taskKey);
    return c.json({ commit: result.commit, diff: result.diff, changedFiles: result.changedFiles });
  });

  app.get('/perch/tasks/:runId/:key/bundle', async (c) => {
    const params = readTaskParams(c);
    if (params === undefined) return invalidParams(c);
    const key = taskKey(params.runId, params.key);
    if (!handles.has(key)) return unknownTask(c);

    const base = c.req.query('base');
    if (base !== undefined && base.trim().length === 0) {
      return c.json(errorBody('invalid-query', 'base must not be empty when supplied'), 400);
    }
    if (base !== undefined && !isSafeRef(base)) {
      return c.json(errorBody('invalid-query', 'base must be a plain git ref'), 400);
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
    const params = readTaskParams(c);
    if (params === undefined) return invalidParams(c);
    const key = taskKey(params.runId, params.key);
    const handle = handles.get(key);
    // Cleanup is idempotent: a hub that retries after a dropped response must not see an error.
    if (handle === undefined) return c.json({ ok: true });

    await deps.node.cleanup(handle);
    handles.delete(key);
    results.delete(key);
    log('debug', `perch cleaned up ${handle.taskKey}`, handle.taskKey);
    return c.json({ ok: true });
  });

  app.get('/perch/events', (c) => {
    // `Last-Event-ID` is the resume point after a dropped stream (ARCHITECTURE §1). No header means a
    // fresh client and, like the locked API says, a live stream: replaying history to a new subscriber
    // would duplicate events it never asked for.
    const resume = parseLastEventId(c.req.header('last-event-id'));

    return streamSSE(c, async (stream) => {
      let closed = false;
      let wake: (() => void) | undefined;
      let keepAlive: ReturnType<typeof setInterval> | undefined;
      let cursor = resume === undefined ? events.nextId() : resume + 1;

      const wakeUp = (): void => {
        wake?.();
      };
      const unsubscribe = events.onChange(wakeUp);

      const stop = (): void => {
        if (closed) return;
        closed = true;
        if (keepAlive !== undefined) clearInterval(keepAlive);
        unsubscribe();
        wakeUp();
      };
      // Register the abort listener before the first await: a client that disappears immediately
      // must still unsubscribe the log listener and clear the keep-alive.
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
          const entry = events.since(cursor - 1);
          if (entry === undefined) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = undefined;
            continue;
          }
          cursor = entry.id + 1;
          await stream.writeSSE({ id: String(entry.id), data: JSON.stringify(entry.event) });
        }
      } catch {
        // A write after disconnect rejects. That is a normal end of stream, not a perch error.
      } finally {
        stop();
      }
    });
  });

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

  /**
   * Wait for the hub to delete every task, then abort whatever is left.
   *
   * The hub's `DELETE` is the only signal that a task's worktree and session are safe to drop, so
   * the loop polls the handle map instead of guessing from agent events (a session can go idle long
   * before its bundle is collected and merged). Injected `now`/`sleep` make the timeout provable.
   */
  const drainTasks = async (opts: DrainOptions = {}): Promise<DrainReport> => {
    draining = true;
    const now = opts.now ?? ((): number => clock.now());
    const sleep = opts.sleep ?? defaultDrainSleep;
    const pollMs = opts.pollMs ?? PERCH_DRAIN_POLL_MS;
    const timeoutMs = opts.timeoutMs ?? PERCH_DRAIN_TIMEOUT_MS;
    const startedAt = now();
    const before = new Map<string, string>();
    for (const [key, handle] of handles) before.set(key, handle.taskKey);

    while (handles.size > 0 && now() - startedAt < timeoutMs) {
      await sleep(pollMs);
    }

    // Anything the hub already deleted is "finished"; anything still here ran out of time.
    const finished = [...before.entries()]
      .filter(([key]) => !handles.has(key))
      .map(([, key]) => key);
    const aborted: string[] = [];
    for (const [key, handle] of [...handles.entries()]) {
      try {
        await deps.node.abort(handle);
        aborted.push(handle.taskKey);
        log('warn', `perch aborted ${handle.taskKey} after the drain timeout`, handle.taskKey);
      } catch (err) {
        log(
          'warn',
          `perch could not abort ${handle.taskKey} during drain: ${
            err instanceof Error ? err.message : String(err)
          }`,
          handle.taskKey,
        );
      }
      handles.delete(key);
      results.delete(key);
    }

    return { finished, aborted, waitedMs: Math.max(0, now() - startedAt) };
  };

  return Object.assign(app, {
    handles: () => [...handles.values()],
    setDraining: (on: boolean): void => {
      draining = on;
    },
    isDraining: (): boolean => draining,
    drainTasks,
    close: async (): Promise<void> => {
      unsubscribeNode();
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

async function readJson<T>(
  c: Context,
  schema: ZodType<T>,
  opts: { maxBytes: number } = { maxBytes: PERCH_MAX_BODY_BYTES },
): Promise<ParsedBody<T>> {
  const tooLarge = (): ParsedBody<T> => ({
    ok: false,
    response: c.json(
      {
        error: {
          code: 'payload-too-large',
          message: `request body must be at most ${opts.maxBytes} bytes`,
        },
      },
      413,
    ),
  });

  // Cheap rejection first: a declared length over the limit never needs to be read. A lying or
  // absent length is caught by the byte count below, so this is an optimisation, not the check.
  const declared = c.req.header('content-length');
  if (declared !== undefined) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > opts.maxBytes) return tooLarge();
  }

  let text = '';
  const body = c.req.raw.body;
  if (body !== null) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > opts.maxBytes) {
          await reader.cancel().catch(() => undefined);
          return tooLarge();
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } catch {
      return {
        ok: false,
        response: c.json(
          { error: { code: 'invalid-json', message: 'request body could not be read' } },
          400,
        ),
      };
    }
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
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

interface TaskParams {
  runId: string;
  key: string;
}

/**
 * `:runId` and `:key` are a path segment each, so they are validated as ids. A param that fails is
 * a 400, not a 404: "your run id contains a slash" is a hub bug, not a missing task, and answering
 * 404 would send the hub down its re-register path.
 */
function readTaskParams(c: Context): TaskParams | undefined {
  const runId = c.req.param('runId');
  const key = c.req.param('key');
  if (runId === undefined || key === undefined) return undefined;
  if (!isSafeId(runId) || !isSafeId(key)) return undefined;
  return { runId, key };
}

function invalidParams(c: Context): Response {
  return c.json(
    {
      error: {
        code: 'invalid-params',
        message: `runId and task key must match ${/^[A-Za-z0-9._-]{1,128}$/.source}`,
      },
    },
    400,
  );
}

function unknownTask(c: Context): Response {
  return c.json(
    { error: { code: 'unknown-task', message: 'this perch has no session for that run/task' } },
    404,
  );
}

/** `Last-Event-ID: 41` → 41. Anything non-numeric (or absent) means "start live". */
function parseLastEventId(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number(trimmed);
}
