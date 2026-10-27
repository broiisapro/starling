# Epic 21 — Server: REST + SSE + flock endpoints

## Goal

Give the hub a single HTTP surface, exactly as locked in ARCHITECTURE §6, so the dashboard, the CLI
and a perch all talk to one app instead of to each other's packages. The whole server is built from
injected dependencies (`ServerDeps`), which means Wave 1 can implement, test and demo it against
mocks, and Wave 2 only has to hand it a real engine and a real flock hub. No route changes when that
happens.

`bun run dev` in `apps/server` serves that same API with **no engine at all**: it replays the recorded
launch-day run, so the web epics can build against a live event stream before the engine exists.

## How it works

### App composition

```
createApp(deps, options?) ──► Hono
  middleware   requestLogger (bus log, debug) · cors (localhost:5173)
  /api/health  { ok, version }
  runs         mountRuns   (store + engine)
  events       mountEvents (store + bus, SSE)
  flock        mountFlock  (FlockHub, optional)
  replay       mountReplay (replay fn, optional)
  web          serveWebDist (only when deps.webDist is set)
  notFound     JSON 404 for /api/*, text 404 elsewhere
  onError      StarlingError → its code/status, anything else → 500 INTERNAL (logged on the bus)

startServer(deps, { port, hostname? }) ──► { url, port, app, stop }
  Bun.serve({ fetch: app.fetch, idleTimeout: 0, hostname: '0.0.0.0' })
```

`stop()` force-closes the listener (SSE connections included). Tests use `app.request` for everything
except SSE, which needs a transport that can be aborted, so those tests bind `Bun.serve({ port: 0 })`.

### Routes (ARCHITECTURE §6)

| Method | Path                             | Success            | Notes                                                     |
| ------ | -------------------------------- | ------------------ | --------------------------------------------------------- |
| GET    | `/api/health`                    | 200 `{ok,version}` | never touches a port                                      |
| GET    | `/api/runs`                      | 200 `Run[]`        | from `store.listRuns()`, most recent first                |
| GET    | `/api/runs/:id`                  | 200 `Run`          | store first, then `engine.getRun`                         |
| POST   | `/api/runs`                      | 201 `{runId}`      | zod-validated body → `EngineApi.start`                    |
| POST   | `/api/runs/:id/cancel`           | 200 `{ok}`         | 404 for unknown runs                                      |
| POST   | `/api/runs/:id/tasks/:key/abort` | 200 `{ok}`         | 404 when the task is not in the run                       |
| GET    | `/api/runs/:id/events?since=ts`  | 200 SSE            | backlog then live, run-scoped                             |
| GET    | `/api/events?since=ts`           | 200 SSE            | every run plus `node.*` and request logs                  |
| POST   | `/api/replay`                    | 202 `{runId}`      | 503 `REPLAY_DISABLED` without an implementation           |
| GET    | `/api/nodes`                     | 200 `NodeInfo[]`   | hub first, then perches by name; `[]` without a flock hub |
| GET    | `/api/flock/join`                | 200 `JoinInfo`     | deliberately token-free                                   |
| POST   | `/api/flock/register`            | 201 `{nodeId}`     | token + `NodeInfo` schema                                 |
| POST   | `/api/flock/heartbeat`           | 200 `{ok}`         | token + `NodeInfo` schema                                 |
| GET    | `/api/flock/bundle?ref=<ref>`    | 200 octet-stream   | token; streams the file `FlockHub.bundle` produced        |

Errors are always `{ "error": { "code": "…", "message": "…" } }` with status 400/401/404/500/501/503.
The codes are `INVALID_BODY`, `INVALID_QUERY`, `RUN_NOT_FOUND`, `NOT_FOUND`, `UNAUTHORIZED`,
`FLOCK_DISABLED`, `REPLAY_DISABLED`, `INTERNAL` plus any `StarlingErrorCode` that reached the handler.

Flock routes answer **503 `FLOCK_DISABLED`** when `deps.flock` is undefined, so single-node mode is a
first-class state rather than a crash. `/api/nodes` is the exception: it returns `[]`, because a hub
with no flock still legitimately has one node and the dashboard should render an empty flock, not an
error banner.

### SSE contract

`streamEvents` (in `sse.ts`) is shared by both event routes:

1. Write `: connected` immediately — `fetch` does not resolve until the first byte, so without this a
   quiet run would look like a hung request.
2. Subscribe to the bus **before** reading the store backlog. Events that arrive while the backlog is
   being written are buffered.
3. Write the backlog (already `ts >= since` from the store).
4. Flush the buffer, dropping frames already covered by the backlog (deduplicated by
   `runId|type|ts`), then stream live.
5. Keep-alive comment every 15 s (configurable for tests), dropped on disconnect; the bus
   subscription is removed on abort, so a closed tab leaves nothing behind.

The per-run stream filters on `runId === :id`. The all-events stream forwards everything, including
`node.*` and the per-request debug logs (`runId: '*'`). Data frames are one `StarlingEvent` JSON each,
identical to what `Store.appendEvent` persisted.

### Static hosting

When `deps.webDist` is set, `serveWebDist` serves `apps/web/dist` and falls back to `index.html` for
anything that is not a file, so client-side routes work on refresh. Paths are resolved inside the web
root and URL-encoded traversal is rejected. Hashed assets under `/assets/` get
`cache-control: immutable`; everything else is `no-cache`. `/api/*` is never served from disk: the API
routes are mounted first, and the static handler explicitly passes API paths through to the JSON 404.

### Demo server (`src/dev.ts`)

`bun run dev` (and `bun start`) build a `MemoryStore`, a `createEventBus()` and replay
`fixtures/runs/sky-todo-launch-day.jsonl` at 8× real time (~45 s per pass), looping after a short
pause. `POST /api/replay` works with any readable JSONL. Start/cancel answer 501 `NOT_IMPLEMENTED`,
because there is no engine to start anything.

## Key decisions & reasoning

- **Everything injected, nothing imported from siblings.** `EngineApi` and `FlockHub` are the §8
  mirrors in `src/handshake.ts`, so the server compiles and tests against fakes. Wave 2 passes the
  real objects into the same `ServerDeps`.
- **Subscription before backlog, with dedupe.** Reading the backlog first leaves a race window in
  which a published event is neither persisted in time nor delivered live. Subscribing first closes
  it; dedupe by `runId|type|ts` handles the event that lands in both. A duplicate frame makes an
  event-sourced UI double-apply a transition; a missed frame loses one forever, so the bias is
  towards never losing.
- **`since` is inclusive (`ts >= since`).** It matches `Store.events(runId, sinceTs)` exactly; the
  server never re-implements filtering semantics. `since` is also applied to the live tail so a
  reconnecting client with a cursor does not receive out-of-order older frames.
- **Request logs live outside runs (`runId: '*'`).** They land in the `/api/events` log feed but never
  in a run's stream, which is what the Agent drawer consumes.
- **15 s keep-alive comment, not an `event: ping`.** SSE comments are ignored by every client parser
  (`EventSource` and the web epics' own reader), whereas a synthetic event type would have to be
  filtered out everywhere.
- **`idleTimeout: 0` and `0.0.0.0`.** Bun would otherwise be free to drop a stream that has been
  quiet for its idle window, and the hub must accept a perch from the LAN, not just localhost.
- **zod at the boundary, `StarlingError` beyond it.** Bodies are validated in the route and turned
  into a 400 with an `issue.path`-prefixed message. Anything thrown deeper keeps its own code: an
  `INVALID_ARGUMENT` from the engine is a 400, `NOT_IMPLEMENTED` is a 501, everything else a 500.
  No stack traces or nested causes are serialised.
- **`MemoryStore` + fixture for the demo instead of a fake engine.** The point of the demo is a
  _real_ event pipeline: store, bus, SSE and the UI see exactly what a real run produces, and the
  only fake is the source of the events.
- **A replayed loop shifts the envelope `ts`.** Without it, every loop would re-deliver frames whose
  `ts` goes backwards, breaking `?since=` and confusing the metrics history. Payload timestamps stay
  as recorded: the recording is the artifact, only delivery is re-timed.
- **Static handler is hand-written.** `serveStatic` from `hono/bun` is not reachable through
  `app.request`, and the traversal check and SPA fallback are exactly the sort of thing that deserves
  a unit test.

## Interfaces for future epics

Import everything from the package root (`@starling/server`):

```ts
import type { ServerDeps, ServerOptions, StartServerOptions, ServerHandle } from '@starling/server';
import type { EngineApi, FlockHub, JoinInfo, StartRunInput } from '@starling/server';
import { createApp, startServer, VERSION, DEFAULT_PORT } from '@starling/server';
import type { ReplayFile, ReplayOptions, ReplayHandle } from '@starling/server';
import { loadReplayFile, startReplay, startJsonlReplay, DEFAULT_REPLAY_SPEED } from '@starling/server';
import type { SseSource, StreamEventsOptions } from '@starling/server';
import { streamEvents, DEFAULT_KEEP_ALIVE_MS } from '@starling/server';
import { serveWebDist, resolveStaticPath, contentTypeFor } from '@starling/server';
```

Exact signatures:

```ts
export interface ServerDeps {
  engine: EngineApi;
  store: Store;
  bus: EventBus;
  flock?: FlockHub;
  replay?: (path: string, speed?: number) => Promise<{ runId: string }>;
  version: string;
  webDist?: string;
}
export interface ServerOptions {
  keepAliveMs?: number;
  corsOrigins?: string[];
}
export interface StartServerOptions extends ServerOptions {
  port?: number;
  hostname?: string;
}
export interface ServerHandle {
  url: string;
  port: number;
  app: Hono;
  stop: () => void;
}
export function createApp(deps: ServerDeps, options?: ServerOptions): Hono;
export function startServer(deps: ServerDeps, options?: StartServerOptions): ServerHandle;

export interface ReplayFile {
  events: StarlingEvent[];
  runId: string;
  spanMs: number;
}
export interface ReplayOptions {
  file: ReplayFile;
  store: Store;
  bus: EventBus;
  speed?: number;
  loop?: boolean;
  gapMs?: number;
  onError?: (err: unknown) => void;
}
export interface ReplayHandle {
  runId: string;
  done: Promise<void>;
  stop: () => void;
}
export function loadReplayFile(path: string): ReplayFile;
export function startReplay(options: ReplayOptions): ReplayHandle;
export function startJsonlReplay(path: string, options: Omit<ReplayOptions, 'file'>): ReplayHandle;

export const DEFAULT_PORT = 7777;
export const VERSION = '0.0.0';
export const DEFAULT_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
export const DEFAULT_KEEP_ALIVE_MS = 15_000;
export const DEFAULT_REPLAY_SPEED = 4;
```

### Wave 2 wiring (what the integrator writes)

```ts
import { createEventBus } from '@starling/core';
import { createStore } from '@starling/store'; // E15
import { createEngine } from '@starling/engine'; // E20
import { createFlockHub } from '@starling/flock'; // E30
import { startServer } from '@starling/server';

const bus = createEventBus();
const store = createStore('.starling/starling.db');
const flock = createFlockHub({ bus, store });
const engine = createEngine({ store, bus, flock /* … lanes, runner, auditor, merger */ });

const server = startServer(
  {
    engine,
    store,
    bus,
    flock,
    version: '0.1.0',
    webDist: new URL('../../web/dist', import.meta.url).pathname,
  },
  { port: 7777 },
);
console.log(server.url);
```

`EngineApi.start` must resolve once the run exists (the route returns that id immediately), and
`FlockHub.bundle(ref)` must return a path to a git bundle **file** on the hub — the route streams it as
`application/octet-stream` with a `content-length`.

### For the web and CLI epics

- The dashboard proxies `/api` → `localhost:7777` in dev (already configured in `apps/web/vite.config.ts`);
  CORS also allows `localhost:5173` directly.
- SSE: `EventSource('/api/runs/<id>/events')`; each message's `data` is one `StarlingEvent`. The
  stream begins with a `: connected` comment and keeps alive every 15 s, so no client-side timeout is
  needed. Reconnect with `?since=<last ts>` to replay from a cursor.
- `POST /api/runs` takes `{ goal, repoPath, dryRun?, maxParallel?, baseBranch? }` and returns
  `{ runId }`; `dryRun` stops after planning (ARCHITECTURE §4).
- `POST /api/replay` takes `{ path, speed? }`; the path is resolved by the server process, so use an
  absolute path or one relative to its cwd.

## Deviations from plan

- **`createApp(deps, options?)` takes an optional second argument.** The required `createApp(deps)`
  signature is unchanged; the options only expose `keepAliveMs` and extra CORS origins so the tests
  can exercise keep-alives without waiting 15 s. Production callers pass nothing.
- **`/api/health` reports `deps.version`**, not the `VERSION` constant. `VERSION` is exported as the
  default the demo server injects; this keeps the package version in one injectable place without
  hard-coding it into routes.
- **`/api/nodes` returns `200 []` with no flock hub** instead of 503. Only `/api/flock/*` is a "flock
  route" in the 503 sense.
- **Status codes for creates are 201 (run) and 202 (replay).** §6 fixes the bodies, not the codes;
  201/202 are the accurate ones and tests pin them.
- **The SSE stream opens with `: connected`.** Not in the spec, but without a first byte Bun's fetch
  does not resolve and a quiet run looks hung.
- **`src/dev.ts` is the dev entry point** (`bun run dev`), and `bun start` runs the demo too, because
  there is no engine to start until Wave 2. `src/index.ts` stays the library entry and documents this.
- **`index.test.ts` was replaced by `app.test.ts` + route suites.** The old test asserted
  `createApp()` with no arguments, which no longer exists by design.
- **Replay is also exposed as a reusable module.** §6 only asks for `POST /api/replay` with an injected
  function; `replay.ts` is what both the demo and the injected function use, so the dev server can
  serve a real replay without a second implementation.

## Known limitations / deferred

- **No auth beyond the flock token.** `POST /api/replay` reads any file the server process can read,
  and every run route is unauthenticated. That is acceptable for a LAN-only dev hub; anything exposed
  beyond localhost needs a real auth layer.
- **No `Last-Event-ID` support.** Cursor-based resume is `?since=<ts>`, which is what the store
  indexes; SSE's built-in `Last-Event-ID` would need event ids that the contract does not have.
- **The all-events backlog scans every run** on connect (`store.listRuns()` → `store.events`). Fine for
  a demo and a handful of runs; a long-lived hub with hundreds of runs needs a global event index in
  the store.
- **No compression, rate limiting, TLS or HTTP/2.** LAN-only by design (ARCHITECTURE L18).
- **Static hosting has no directory index other than `index.html`**, no ETag/If-None-Match, and no
  HEAD for API routes.
- **The demo's loop replays the same run id** with shifted timestamps, so `GET /api/runs` shows the
  last known state of one run rather than a growing history. A real engine records real runs.
- **`EngineApi.waitForFinish` is not used by any route.** It is part of the §8 mirror and the CLI's
  in-process path; the server never blocks a request on a whole run.
- **No test asserts the flock route's 401 on a body-less request** — every token test sends a valid
  body so a 401 is unambiguously about the token. The check runs before body parsing regardless.
- **Pre-existing root `bun run check` failures in `tools/local-models/**` and `docs/epic-0{1,2}*.md`.**
  They were merged before Epic 00's root scripts existed and are outside this lane; `apps/server`
  itself is clean (`bunx biome check apps/server`, and `bun run typecheck` passes for every workspace).
