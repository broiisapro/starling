# Epic 21: Server: REST + SSE + flock endpoints

**Wave 1 · Branch `epic/21-server` · Issue: find it with `gh issue list --search "Epic 21 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees (on this laptop and on other laptops, "perches"), audits each result with tests, a lane check and a local model, and merges everything through a queue, all shown live in a murmuration dashboard.

**Wave 0 is merged** (tags `epic-00-complete`, `epic-01-complete`):
- `@starling/core`: every contract (zod-first), every port, the event bus, config, `exec`, globs (`matchesAny`, `globsOverlap`, `lanesDisjoint`), pricing/metrics, and **`@starling/core/testing`**, which has a mock for every port plus factories (`makePlan`, `makeRun`, `makeTaskSpec`, `makeNodeInfo`, `makeAgentEvent`, …). **Read `docs/epic-00-foundation.md` first.** Its "Interfaces for future epics" section lists every exported symbol.
- `fixtures/`: `repomaps/sky-todo.json`, `plans/sky-todo-launch-day.json`, `runs/sky-todo-launch-day.jsonl` (252 realistic events including flock events).
- `examples/sky-todo/`: the demo app Starling will operate on. `examples/scripts/make-demo-repo.sh` makes a fresh git repo of it.

**You are one of 23 agents building Wave 1 at the same time**, each in its own lane. Your siblings' packages are still placeholders while you work. **Never import a sibling Wave 1 package.** Depend only on `@starling/core` and its mocks. Where you meet a sibling, use the **handshake interfaces in ARCHITECTURE §8**, mirrored locally in `src/handshake.ts`, copied verbatim with the header comment the section specifies.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L25**. Especially:
- **L21**: Bun 1.4.4, TS 5.9.3, zod 4.6.7, Biome 2.6.3; never touch root config.
- **L22**: add deps only to your own package.json, pinned exact.
- **L23**: **NO local models, no real LLM calls, no real opencode prompts, no GitHub calls from tests, no `ollama` commands at all.** Use the core mocks and in-process `Bun.serve({ port: 0 })` fakes. You may write `*.live.test.ts` files but do not run them. This laptop runs 20+ agents at once, so keep memory use low: no long-running servers left behind, no huge test fixtures.
- **L13/L14**: git and gh go through `exec` from core, injectable so tests can fake it.

## FIRST TASK: carryover
None. This is a Wave 1 epic built directly on Wave 0. (Stated explicitly so it's clear carryover was considered.)

## Your lane (you may write ONLY here)
`apps/server/**`
plus `docs/epic-21-server.md` and `.orchestrator/handbacks/21-server.md`. Read anything; write nothing else.

## Goal
Implement the hub's HTTP server, exactly matching the locked API in ARCHITECTURE §6 (runs, SSE events, replay, nodes, flock join/register/heartbeat/bundle), on Hono. Everything it serves comes from injected dependencies, so it can be built and tested now against mocks and wired to the real engine and flock hub in Wave 2.

## Deliverables
- `createApp(deps: ServerDeps): Hono` and `startServer(deps, { port }): { url; stop() }`. `ServerDeps = { engine: EngineApi; store: Store; bus: EventBus; flock?: FlockHub; replay?: (path: string, speed?: number) => Promise<{ runId: string }>; version: string; webDist?: string }`, with `EngineApi` and `FlockHub` mirrored from §8 in `src/handshake.ts`.
- Every route in the §6 server table, with zod validation of bodies (400 with a clear message), 404s for unknown runs, and JSON errors `{ error: { code, message } }`:
  - `GET /api/runs/:id/events?since=ts`: **SSE** via Hono `streamSSE`. Backlog from `store.events(runId, since)` first, then live events from the bus filtered by runId. Keep-alive comment every 15 s. Clean unsubscribe on disconnect.
  - `GET /api/events`: an all-events SSE stream (run-scoped plus `node.*`).
  - Flock routes check `x-flock-token` via `flock.verifyToken` (401 otherwise). `GET /api/flock/bundle` streams the bundle file as `application/octet-stream`. If `flock` isn't configured, flock routes return 503 `FLOCK_DISABLED`.
  - `GET /api/flock/join` returns `JoinInfo` (no token needed, LAN only).
- Static hosting of `webDist` (if given) with an SPA fallback to `index.html`. `/api/*` is never shadowed.
- CORS for `http://localhost:5173` (the Vite dev server).
- A request log line per request through the bus `log` event (debug level).
- `src/dev.ts`: a **demo server** using `MemoryStore` from core testing plus a replay of `fixtures/runs/sky-todo-launch-day.jsonl` on a timer. `bun run dev` serves a live-looking event stream with **no engine at all**, so the web epics have something real to point at. Keep `GET /api/health`.
- Tests (Hono's `app.request`, no real ports, except one SSE test on `port: 0`): every route's happy path and validation errors; SSE backlog then live delivery order and `since` filtering; token checks; bundle streaming (temp file); SPA fallback; 503 when flock is absent.

## Explicitly out of scope
Implementing the engine or flock hub (siblings). Auth beyond the flock token. TLS. The web UI.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test apps/server` passes, ≥ 25 tests.
3. `cd apps/server && bun run dev`, then `curl -N localhost:7777/api/runs/<the fixture run id>/events | head -5` shows SSE frames (paste them), then stop the server.
4. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
5. `bun run check` passes (Biome + typecheck for every workspace).
6. `docs/epic-21-server.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/21-server.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/21-server`. Conventional Commits scoped to your lane (`feat(server): …`, `test(server): …`, `docs(epic-21): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
