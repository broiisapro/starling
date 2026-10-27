/**
 * The Starling hub HTTP API — ARCHITECTURE §6, verbatim, on Hono.
 *
 * Everything is injected (`ServerDeps`), so this app can be built and tested against mocks in Wave 1
 * and wired to the real engine + flock hub in Wave 2 without touching a route. The only runtime
 * globals it needs are `Bun.serve` (in `startServer`) and `Bun.file` (for bundle streaming).
 */
import type { EventBus, StarlingEvent, Store } from '@starling/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { EngineApi, FlockHub } from './handshake';
import { errorResponse, fail } from './http';
import { RUN_AGNOSTIC_RUN_ID, requestLogger } from './logging';
import { mountEvents } from './routes/events';
import { mountFlock } from './routes/flock';
import { mountReplay, type ReplayFn } from './routes/replay';
import { mountRuns } from './routes/runs';
import { DEFAULT_KEEP_ALIVE_MS } from './sse';
import { serveWebDist } from './static';

/** Reported by `GET /api/health` unless the caller injects its own version. */
export const VERSION = '0.0.0';

export const DEFAULT_PORT = 7777;

/** The Vite dev server, over http and 127.0.0.1 (both spellings appear in browser bars). */
export const DEFAULT_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export interface HealthResponse {
  ok: true;
  version: string;
}

export interface ServerDeps {
  engine: EngineApi;
  store: Store;
  bus: EventBus;
  /** Absent in single-node/dev mode; flock routes then answer 503 `FLOCK_DISABLED`. */
  flock?: FlockHub;
  /** Absent → `POST /api/replay` answers 503 `REPLAY_DISABLED`. */
  replay?: ReplayFn;
  version: string;
  /** Built dashboard to serve (`apps/web/dist`). `/api/*` always wins. */
  webDist?: string;
}

export interface ServerOptions {
  /** SSE keep-alive comment interval (default 15 s, ARCHITECTURE §6). */
  keepAliveMs?: number;
  /** Extra origins for the Vite dev server; defaults to localhost/127.0.0.1:5173. */
  corsOrigins?: string[];
}

function logError(bus: EventBus, msg: string, err?: unknown): void {
  const detail = err === undefined ? '' : `: ${err instanceof Error ? err.message : String(err)}`;
  const event: StarlingEvent = {
    type: 'log',
    runId: RUN_AGNOSTIC_RUN_ID,
    ts: Date.now(),
    payload: { level: 'error', msg: `${msg}${detail}` },
  };
  bus.publish(event);
}

export function createApp(deps: ServerDeps, options: ServerOptions = {}): Hono {
  const app = new Hono();
  const keepAliveMs = options.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS;
  const origins = options.corsOrigins ?? DEFAULT_CORS_ORIGINS;

  app.use('*', requestLogger(deps.bus));
  app.use(
    '*',
    cors({
      origin: origins,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['content-type', 'x-flock-token'],
      maxAge: 600,
    }),
  );

  app.get('/api/health', (c) => c.json<HealthResponse>({ ok: true, version: deps.version }));

  mountRuns(app, { engine: deps.engine, store: deps.store });
  mountEvents(app, {
    engine: deps.engine,
    store: deps.store,
    bus: deps.bus,
    keepAliveMs,
    onStreamError: (err) => logError(deps.bus, 'event stream write failed', err),
  });
  mountFlock(app, { flock: deps.flock });
  mountReplay(app, { replay: deps.replay });

  if (deps.webDist !== undefined) {
    const webDist = deps.webDist;
    app.on(['GET', 'HEAD'], '*', (c) =>
      c.req.path.startsWith('/api/') ? c.notFound() : serveWebDist(c, webDist),
    );
  }

  app.notFound((c) =>
    c.req.path.startsWith('/api/')
      ? fail(c, 404, 'NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`)
      : c.text('Not found', 404),
  );

  app.onError((err, c) => {
    logError(deps.bus, `${c.req.method} ${c.req.path} failed`, err);
    return errorResponse(c, err);
  });

  return app;
}

export interface StartServerOptions extends ServerOptions {
  port?: number;
  /** `0.0.0.0` by default: a perch on the LAN must be able to reach the hub. */
  hostname?: string;
}

export interface ServerHandle {
  url: string;
  port: number;
  app: Hono;
  stop: () => void;
}

/**
 * Bind the app with `Bun.serve`. `idleTimeout: 0` disables Bun's idle timer, which would otherwise be
 * free to cut an SSE connection that has sent nothing for a while (the 15 s keep-alive covers normal
 * cases, but a paused stream must never be mistaken for a dead one).
 */
export function startServer(deps: ServerDeps, options: StartServerOptions = {}): ServerHandle {
  const app = createApp(deps, options);
  const server = Bun.serve({
    port: options.port ?? DEFAULT_PORT,
    hostname: options.hostname ?? '0.0.0.0',
    fetch: app.fetch,
    idleTimeout: 0,
  });
  const port = server.port ?? options.port ?? DEFAULT_PORT;
  const url = `http://localhost:${port}`;
  return {
    url,
    port,
    app,
    stop: () => {
      server.stop(true);
    },
  };
}
