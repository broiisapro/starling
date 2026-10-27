## Epic 21 Handback — Server: REST + SSE + flock endpoints

**Status:** Complete. Branch `epic/21-server` @ `HEAD` (this handback commit on top). Every route in ARCHITECTURE §6 is implemented on Hono, fed only by injected ports, and tested against core mocks; the dev server demos the full pipeline with no engine.

**Delivered:**

- `apps/server/src/app.ts` — `createApp(deps, options?)` and `startServer(deps, { port, hostname? })` → `{ url, port, app, stop() }`. `ServerDeps = { engine, store, bus, flock?, replay?, version, webDist? }`. CORS for `localhost:5173` / `127.0.0.1:5173`, JSON 404s, `onError` mapping, `Bun.serve` with `idleTimeout: 0`, `hostname: 0.0.0.0`.
- `apps/server/src/handshake.ts` — verbatim §8 MIRROR (`StartRunInput`, `EngineApi`, `JoinInfo`, `FlockHub`, `BundleUrlFor`) with the required header comment; the only shape the server knows about E20/E30.
- `apps/server/src/routes/runs.ts` — `GET /api/runs`, `GET /api/runs/:id`, `POST /api/runs` (201), `POST /api/runs/:id/cancel`, `POST /api/runs/:id/tasks/:key/abort`, all zod-validated, 404 `RUN_NOT_FOUND`.
- `apps/server/src/routes/events.ts` + `src/sse.ts` — `GET /api/runs/:id/events?since=` and `GET /api/events?since=`: backlog first, then live, buffered+deduplicated so no frame is lost or doubled; 15 s keep-alive comment; unsubscribes on disconnect.
- `apps/server/src/routes/flock.ts` — `GET /api/flock/join` (open), `POST /api/flock/register`, `POST /api/flock/heartbeat`, `GET /api/flock/bundle?ref=` (streams `application/octet-stream`), `GET /api/nodes` (hub first). Token via `x-flock-token`/`verifyToken` → 401; no flock → 503 `FLOCK_DISABLED`.
- `apps/server/src/routes/replay.ts` — `POST /api/replay` (202) via injected implementation, 503 `REPLAY_DISABLED` without one.
- `apps/server/src/static.ts` — SPA hosting for `deps.webDist`: traversal-safe resolution, hashed-asset caching, `index.html` fallback, `/api/*` never shadowed.
- `apps/server/src/logging.ts` — one debug `log` event per request (`runId: '*'`).
- `apps/server/src/http.ts` — the `{ error: { code, message } }` envelope, `parseJsonBody`, `parseSince`, zod issue flattening, `StarlingError`-aware status mapping.
- `apps/server/src/replay.ts` — `loadReplayFile` (schema-validates every line), `startReplay`/`startJsonlReplay` (timed publish, loop with monotonic `ts`), `DEFAULT_REPLAY_SPEED = 4`.
- `apps/server/src/dev.ts` — `bun run dev`: `MemoryStore` + the launch-day fixture on an 8× loop, real REST/SSE, `POST /api/replay`, start/cancel 501 `NOT_IMPLEMENTED`.
- `apps/server/src/test-support.ts` — `FakeEngine`, `FakeFlock`, `makeHarness`, `connectSse`, `serveOnEphemeralPort` (test-only, not exported from the package).
- `docs/epic-21-server.md` — route table, SSE contract, decisions, exact signatures, Wave 2 wiring snippet, limitations.

**Key design decisions:**

- **Subscribe before reading the backlog, then buffer + dedupe (`runId|type|ts`)** — reading the backlog first leaves a window where a published event is neither in the snapshot nor delivered live. A duplicate frame makes an event-sourced UI double-apply; a lost frame is gone forever.
- **Inclusive `since` (`ts >= since`) on backlog *and* live tail** — matches `Store.events` exactly, so the server never invents filtering semantics and a reconnecting client cannot receive older frames after a cursor.
- **`/api/nodes` returns `[]` without a flock hub; `FLOCK_DISABLED` stays on `/api/flock/*`** — a single-node hub legitimately has one node, so an empty list is honest; the panel should not show an error banner before any perch joins.
- **Request logs use `runId: '*'`** — they reach the `/api/events` log feed but never pollute a run's stream (the Agent drawer).
- **`: connected` SSE preamble** — without a first byte, Bun's `fetch` does not resolve and a quiet run looks hung; comments are ignored by every SSE parser.
- **`idleTimeout: 0` + `0.0.0.0`** — a quiet SSE stream must not be cut by Bun's idle timer, and a perch on the LAN must be able to reach the hub.
- **zod at the HTTP boundary, `StarlingError` beyond it** — bodies become a 400 with `path: message` issues; `INVALID_ARGUMENT` → 400, `NOT_IMPLEMENTED` → 501, everything else 500, no stack traces or causes serialised.
- **Demo replays a real fixture into a real `MemoryStore` + `EventBus`** — the store, bus, SSE and UI exercise the production path; only the event source is fake, so web epics are never building against a second implementation.
- **Replay loops shift the envelope `ts`, not payload timestamps** — keeps `?since=` monotonic across loops while leaving the recording intact.
- **Hand-written static handler instead of `hono/bun` `serveStatic`** — `serveStatic` is not reachable through `app.request`, and traversal + SPA fallback deserve unit tests.

**Verification (exact commands + results):**

- `bun install` (worktree root): `Checked 133 installs across 192 packages (no changes) [14.00ms]`.
- `cd apps/server && bun test`: **78 pass / 0 fail**, `182 expect() calls`, `Ran 78 tests across 6 files. [419.00ms]` (requirement: ≥ 25).
- `bun test apps/server` from the repo root: same suite, 78 pass / 0 fail.
- **Dev server, literal DoD check:** `cd apps/server && bun run dev`, then
  `curl -N localhost:7777/api/runs/01jd2k7m3p4q5r6s7t8v9w0x1y/events | head -5`:
  ```
  : connected

  data: {"type":"run.created","runId":"01jd2k7m3p4q5r6s7t8v9w0x1y","ts":1731000000000,"payload":{"run":{"id":"01jd2k7m3p4q5r6s7t8v9w0x1y", …}}}
  data: {"type":"metrics","runId":"01jd2k7m3p4q5r6s7t8v9w0x1y","ts":1731000000000,"payload":{"agentsActive":0,"tasksMerged":0,…}}
  ```
  Also checked live: `GET /api/health` → `{"ok":true,"version":"0.0.0"}`, `GET /api/runs` → the fixture run,
  `GET /api/nodes` → `[]`, `GET /api/flock/join` → 503, `POST /api/runs` → 501 `NOT_IMPLEMENTED`,
  `POST /api/replay` with an absolute path → `{"runId":"01jd2k7m3p4q5r6s7t8v9w0x1y"}`. Server stopped afterwards.
- `bun run test` (repo root): **262 pass / 0 fail**, `964 expect() calls`, `Ran 262 tests across 42 files. [763.00ms]`.
- `bun run check`: **fails on 9 pre-existing files outside this lane** (all committed on `main` before this branch, none touched by me):
  `tools/local-models/host.ts`, `ollama.test.ts`, `ollama.ts`, `smoke.ts` (format + organizeImports), `results/smoke-…-nothink.json`, `results/smoke-….json`, and `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md` (format).
  In-lane: `bunx biome check apps/server` → `Checked 23 files … No fixes applied`, and
  `bun run typecheck` (the check script's `tsc --noEmit -p` loop over every workspace) → **clean, all 18 workspaces**.
- `git status` clean after the final commit (excluding this handback's own commit).

**Dependencies added:** `zod@4.6.7` in `apps/server` (same pin as `@starling/core`); `bun.lock` updated by `bun install`, not hand-edited.

**CONTRACT REQUESTS:** none. The §8 mirror (`EngineApi`, `FlockHub`) covers everything the server needs;
at checkpoint C1 it can move into `@starling/core` unchanged. `waitForFinish` is carried in the mirror but
no route uses it.

**Deliberately deferred / out of scope:**

- Engine and flock-hub implementations (E20/E30) — the server only consumes the §8 interfaces.
- Auth beyond the flock token, TLS, per-route rate limiting (LAN-only per L18).
- `Last-Event-ID` resume; the cursor is `?since=<ts>` because contracts carry no event ids.
- A global event index in the store: `/api/events` backlog currently scans every run's bucket.
- Compression, ETag/If-None-Match, HEAD for API routes.
- `*.live.test.ts` — nothing here needs a network, so none was written.

**Open questions / flagged tradeoffs:**

- `POST /api/replay` takes a server-side path, so anyone on the LAN can ask the hub to read a file it can
  read. Fine for a dev/demo hub; if the server is ever exposed beyond localhost this needs an allow-list
  or removal (flagged in the epic doc).
- Status codes for creates (201 for runs, 202 for replay) are not pinned by §6, only the bodies; changed
  trivially if the web client expects 200.
- `bun run check` is red on `main` for `tools/local-models/**` and two Wave 0/1 doc files. I did not fix
  them (out of lane); whoever owns E02/CI should run `bunx biome check --write` on those paths — the
  `format` script would do it in one go and would also rewrite `AGENTS.md`-adjacent docs, so it needs a
  careful pass.

Closes #15
