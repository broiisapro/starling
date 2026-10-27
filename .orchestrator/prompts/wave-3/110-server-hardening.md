# Epic 110: Server hardening: SEC-01/05/06/09, LAN token guard, rate limits, preview and budget

**Wave 3 · Branch `epic/110-server-hardening` · Issue: `gh issue list --search "Epic 110 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-110-server-hardening.md` and `.orchestrator/handbacks/110-server-hardening.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **The dashboard must keep working on `main` the moment you merge.** The web can't send a token until Wave 3b, so loopback stays trusted by default and flock mode stays reachable on the LAN. If a change would break `cd apps/web && bun run e2e` or `tools/flock`, it's the wrong default.
- Epic 101 throws `StarlingError('INVALID_ARGUMENT', …, { details: { reason: 'reserved-node-id' } })` from `register`. Map on `details.reason`, test it with a fake hub, and leave the `refuses a registration that claims the reserved hub id` probe `test.failing` (C3 flips it once both land).

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **SEC-01** (69): loopback by default, with a token for LAN clients (deliverables 1–2). Write the exact C3/3b lines that switch `trustLoopback` off once the web carries the token.
- **SEC-02 / SEC-03** (69), route half: 409 for reserved ids, and generic bundle errors (deliverable 6).
- **SEC-05 / SEC-06 / SEC-09** (69): deliverables 3, 4, 5. **SEC-04** is already fixed by Epic 41. List it as done.
- **41 #1** (root `dev:live` script): decline under L34, and document the working command.
- **42 #1:** 404 for an unknown heartbeat id (deliverable 6). **42 #3** (hub `lastSeen`): decline, because Epic 40's `real/hub-heartbeat.ts` does it in the composition.
- **53 #2 / #3:** the preview endpoint and `budgetUsd` (deliverable 8). **53 #1/#4/#5** are web shell work, not yours.
- **70 F6:** the synchronous SSE backlog (deliverable 4).

## Your lane (you may write ONLY here)
`apps/server/**` except `apps/server/src/routes/insights*` and `apps/server/src/insights/**` (Epic 111's)
plus `docs/epic-110-server-hardening.md` and `.orchestrator/handbacks/110-server-hardening.md`. Read anything.

## Goal
The hub's HTTP server is the one thing on the demo laptop that the whole room's Wi-Fi can reach. Today anyone on the LAN can `POST /api/runs` and start a coding agent on any repo (SEC-01), upload a 1 GiB body, open unlimited SSE streams, or follow a symlink out of the web root. Close every one of those **without breaking the dashboard on the hub laptop or the flock over LAN**, because the web data layer can't carry a token until Wave 3b. Great looks like: loopback stays frictionless, LAN clients need the token, the hub-side security probes flip green, and all 104 existing server tests pass untouched.

## Deliverables
1. **SEC-01 binding** (`src/app.ts` `startServer`). The default `hostname` becomes `'127.0.0.1'`, **unless `deps.flock` is set** (flock needs LAN reach), in which case it stays `'0.0.0.0'`. `StartServerOptions.lan?: boolean` forces LAN, and an explicit `hostname` always wins. Do the same in `startDashboard` (`src/dashboard.ts`).
2. **SEC-01 token guard** (new `src/auth.ts`). Middleware on every `/api/*` route except `/api/health` and `/api/flock/join` (the flock routes keep their own guard). The token comes from `x-starling-token`, `x-flock-token`, or `?token=` (EventSource can't set headers), compared in constant time via `FlockHub.verifyToken` when there is a flock, else `ServerDeps.auth.token`. Policy: `ServerDeps.auth?: { token?: string; trustLoopback?: boolean /* default true */ }`. A client whose remote address isn't loopback needs the token whenever the server is bound off-loopback, and `trustLoopback: false` makes everyone need it. The remote address comes from Bun via `getConnInfo` (`hono/bun`, `startServer` passes the server as env), with an injectable `ServerOptions.remoteAddressOf?(c)` for tests. An unknown address (`app.request` in tests) counts as loopback, so existing tests stay green. Failures answer 401 `UNAUTHORIZED`.
3. **SEC-05 body limit.** An `/api/*` middleware rejects `content-length` > 256 KiB with **413** `PAYLOAD_TOO_LARGE` *before* any route logic (the replay probe hits a 503 route). `parseJsonBody` (`src/http.ts`) counts streamed bytes from `c.req.raw.body` for chunked bodies. Add `413` and `429` to `ApiErrorStatus`, plus the new codes to `ApiErrorCode` (additive).
4. **SEC-06 SSE cap and 70 F6.** `ServerOptions.maxStreams` (default 32) is shared by `/api/events` and `/api/runs/:id/events`. Past the cap: 503 `TOO_MANY_STREAMS` with `retry-after: 5`, and a slot is freed in `streamEvents`' existing `stop()`. The backlog loop yields to the event loop every 250 events (`await` a macrotask), so 20 clients × 9k events no longer block the server. Tests: cap, release on disconnect, backlog order preserved with yields.
5. **SEC-09 static confinement** (`src/static.ts`). `resolveStaticPath` compares `realpathSync(candidate)` against `realpathSync(root)` and answers 404 on escape or a missing file. Tests with a symlinked file and a symlinked directory.
6. **Flock route mapping** (`src/routes/flock.ts`). In `register`, a `StarlingError` with `details.reason === 'reserved-node-id'` (thrown by Epic 101's hub) → **409** `NODE_ID_RESERVED`. A heartbeat for an id the registry doesn't know → **404** `UNKNOWN_NODE` (42 #1; the perch already re-registers on 404). On the bundle route, `EXEC_FAILED` → 404 "ref not found on the hub" (detail logged to the bus, never echoed) and `INVALID_ARGUMENT` → 400 `INVALID_QUERY`. Test with a fake `FlockHub` whose errors contain an absolute path, and assert the path never reaches the body.
7. **Per-IP rate limit** (new `src/rate-limit.ts`). `createRateLimiter({ capacity: 20, refillPerSec: 2, clock })` on mutating routes (POST `/api/runs`, `/api/runs/preview`, `/api/replay`, cancel/abort, `/api/flock/register`). Heartbeats, GETs and loopback are exempt by default (`ServerOptions.rateLimit`). Over the limit: 429 `RATE_LIMITED` with `retry-after`. FakeClock tests.
8. **Preview and budget** (53 #2/#3). `POST /api/runs/preview` calls `engine.preview?.(input)` when the engine structurally has it and returns `{ plan, issues }`, else 501 `PREVIEW_UNAVAILABLE`. It never persists or creates worktrees. `StartRunBodySchema.budgetUsd: z.number().min(0).max(1000).optional()` is forwarded as an additive `budgetUsd` on `StartRunInput` (the engine already reads it, `packages/engine/src/run-driver.ts:77`).
9. **Mount hook for C3.** `ServerOptions.mount?: Array<(app: Hono, deps: ServerDeps) => void>` runs after the built-in routes and before `notFound`, so Epic 111's `mountInsights` can be wired in one line without anyone else editing `app.ts`.
10. **Probes** (L36). Flip the four hub probes in `tools/security/body-size.test.ts`, `refuses streams beyond a documented cap` (`sse-flood.test.ts`) and both `static-confinement.test.ts` probes. The `unauth-routes.test.ts` and `replay-confinement` auth probes **stay `test.failing`**: they hit loopback, which is trusted by default until the web data layer (Epic 204) sends the token. Run all of `tools/security` and confirm no other `test.failing` flipped by accident. Write **at least 40 new tests**.

## Explicitly out of scope
- `apps/server/src/routes/insights*` and `apps/server/src/insights/**` (Epic 111). Don't mount them yourself, provide the hook.
- `apps/web` sending the token (Epics 118 and 204), and CLI flags such as `--lan` and printing the token (Epic 203).
- The root `package.json` (`dev:live` script) under L34. Document `bun --cwd apps/server run dev:live` instead.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test apps/server` → 0 fail, ≥ 40 new tests, every pre-existing server test unchanged.
3. `bunx tsc --noEmit -p apps/server` clean.
4. `bun test tools/security` → 0 fail, with your seven probes flipped and the auth probes still `test.failing`.
5. Paste `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' --data-binary @big.json localhost:<port>/api/runs` → `413` from a scripted `startServer`, plus a 401 from a non-loopback-simulated request in a test.
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-110-server-hardening.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/110-server-hardening.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/110-server-hardening`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
