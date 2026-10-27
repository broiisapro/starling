# Epic 102: Perch hardening: body limits, hostile refs, mDNS code opt-in, health, drain, jitter

**Wave 3 · Branch `epic/102-perch-hardening` · Issue: `gh issue list --search "Epic 102 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-102-perch-hardening.md` and `.orchestrator/handbacks/102-perch-hardening.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.


## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **SEC-05** (69), perch half: `readJson` has no body limit (deliverable 1).
- **SEC-07** (69): the join code is in mDNS TXT. Default it off and document the tradeoff in your epic doc. `docs/epic-31-perch.md` isn't yours, so add a FIX REQUEST for the docs owner (deliverable 3).
- **SEC-10** (69): hostile `branch`/`fromRef` reach `node.startTask` (deliverable 2).

## Your lane (you may write ONLY here)
`packages/perch/**`
plus `docs/epic-102-perch-hardening.md` and `.orchestrator/handbacks/102-perch-hardening.md`. Read anything.

## Goal
A perch is a stranger's laptop doing work for the hub, so its HTTP surface has to be boring and safe. It must refuse giant bodies and hostile git refs before git ever sees them, and stop shouting the join code over mDNS. Demo day also needs two operational features: a deep health check the presenter can glance at, and a graceful **drain** so a perch can be restarted mid-demo without killing a bird in flight. Great looks like: the four perch security probes and the mDNS probe flip to green, and `drain()` is proven with a deterministic test.

## Deliverables
1. **SEC-05 body limit.** `readJson` (`src/perch-app.ts` ~`:302`) takes `{ maxBytes }` (export `PERCH_MAX_BODY_BYTES = 256 * 1024`). It rejects on `content-length` first, then counts streamed bytes through `c.req.raw.body.getReader()`, and answers **413** `{ error: { code: 'payload-too-large', message } }`. It applies to every POST route (`/perch/tasks`, `…/prompt`, `…/collect`). Tests cover the declared length, a chunked stream with no length, and exactly-at-limit.
2. **SEC-10 hostile refs.** `PerchStartTaskSchema = StartTaskOptionsSchema.superRefine(…)` in a new `src/validate.ts`, with an exported `isSafeRef(ref: string, opts?: { allowReflog?: false }): boolean` (`^[A-Za-z0-9._/-]{1,200}$`, no `..` segment, no leading `-`, and for `fromRef` no `@{`). `runId`/`taskKey` (body and the `:runId/:key` route params) must match `^[A-Za-z0-9._-]{1,128}$`. Answer 400 `invalid-body` / `invalid-params`, and never call `node.startTask`. Tests.
3. **SEC-07 mDNS code opt-in.** `StartPerchOptions.advertiseCode?: boolean` (default **false**) and the same option on `compose-perch.ts`. The TXT record (`perch-daemon.ts` ~`:252`) carries `{ node }` only unless it is opted in. The hub's `discover` never reads `txt.code` (it authenticates with its own code), so discovery keeps working. Test: a fake advertiser records TXT without the code by default, and with it when opted in.
4. **`GET /perch/health`** (token-guarded like every route). `buildPerchHealth(probes)` returns `{ ok, status: 'ok' | 'degraded' | 'draining', checks: Array<{ name: 'git' | 'runner' | 'worktreeRoot' | 'disk' | 'sessions' | 'hub'; ok: boolean; detail: string }> }`. The checks are: git version via injected exec, worktreeRoot writable, free disk via an injectable `freeBytes()` (degraded under 2 GiB), active/max sessions, and the age of the last successful heartbeat (degraded over 3× the interval). It answers 200 when ok and 503 otherwise. Every probe is injected, so the tests never touch the real machine.
5. **Graceful drain.** `PerchHandle.drain(opts?: { timeoutMs?: number }): Promise<DrainReport>` and `PerchApp.setDraining(on: boolean)`. While draining, a new `POST /perch/tasks` gets **503** `draining` (a hub retry of an existing handle still gets the same handle back), and heartbeats advertise `maxSessions = activeSessions` so the scheduler stops picking this perch. Drain waits until the hub has deleted every task (or the timeout passes, then aborts the rest), then `stop()`s. `DrainReport = { finished: string[]; aborted: string[]; waitedMs: number }`. Deterministic test with a fake clock and node.
6. **Heartbeat jitter** (moved here from Epic 101's intent, since the timer is perch-side). `StartPerchOptions.heartbeatJitter?: number` (default 0.1) and `random?: () => number`. The next delay is `heartbeatMs × (1 ± jitter)`, so 10 perches don't hit the hub in lockstep. Test with a seeded `random`.
7. **Probes** (L36). Flip `rejects a 1 MiB prompt before starting a session` and `rejects a 1 MiB fixer prompt` (`tools/security/body-size.test.ts`), both `tools/security/perch-tasks.test.ts` probes, and `does not publish the join code in the mDNS TXT record by default` (`tools/security/secrets.test.ts`). Touch nothing else in those files.
8. Write **at least 30 new tests**. Keep `loopback.test.ts` green.

## Explicitly out of scope
- The `starling perch` CLI flags (`--mdns-code`, `--drain-timeout`, SIGTERM → drain). `apps/cli` belongs to Wave 3b (Epic 203), so write the exact C3 lines.
- Hub-side registry and scheduling (Epic 101). The hub's own body limits (Epic 110).
- TLS and per-node credentials (L18).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test packages/perch` → 0 fail, ≥ 30 new tests.
3. `bunx tsc --noEmit -p packages/perch` clean.
4. `bun test tools/security/body-size.test.ts tools/security/perch-tasks.test.ts tools/security/secrets.test.ts` → 0 fail, with your five probes flipped (the hub body-size probes stay `test.failing` until Epic 110 lands).
5. Paste a `curl -s -H 'x-flock-token: …' 127.0.0.1:<port>/perch/health` from a perch started in a test script (JSON with every check).
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-102-perch-hardening.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/102-perch-hardening.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/102-perch-hardening`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
