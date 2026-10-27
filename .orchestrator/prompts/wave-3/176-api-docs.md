# Epic 176: API reference: REST, SSE events, perch API and config, checked against the zod schemas

**Wave 3 · Branch `epic/176-api-docs` · Issue: `gh issue list --search "Epic 176 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-176-api-docs.md` and `.orchestrator/handbacks/176-api-docs.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **D1 docs convention (shared by Epics 172–183, all writing in parallel).**
  - **Entry points:** every docs area has its index at `docs/<area>/README.md`. Link siblings by these planned paths even if they don't exist yet: `docs/guide/` (175), `docs/api/` (176), `docs/architecture/` (177), `docs/demo/` (178), `docs/blog/` (180), `docs/troubleshooting/` (181), `docs/models/` (182), `docs/flock/` (183), `docs/release/` + `CHANGELOG.md` (174), `CONTRIBUTING.md`, `SECURITY.md`, `docs/good-first-issues.md` (173), `examples/README.md` (171), `examples/birdwatch-api/` (168), `site/` (179).
  - **The pending marker:** anything not merged on `main` yet gets `⏳ Epic NN` (or `⏳ C3` for wiring) on the same line or table row. Checkers skip existence checks on marked lines but require the marker to name an epic. Never present unmerged behaviour as working.
  - **The real-run flow (Epic 40, branch `epic/40-integration-captain`, merging in parallel with you; read `git show epic/40-integration-captain:docs/epic-40-integration-captain.md`):** `starling run` is **real by default**: one private `opencode serve` on a free port, git worktrees under `worktreeRoot`, SQLite at `<repo>/.starling/starling.db`, the flock hub and the merge queue. It starts the dashboard server and prints its URL unless `--no-dash`, then prints a summary such as `✔ 5 merged · ✘ 0 failed · 0 conflicts / api $0.223 · local $0 / branch starling/3rcdzr/integration (7m 11s)`. Flags new in Epic 40 (all `⏳ Epic 40` until merged): `run --mock` (the old no-process demo stack), `run --budget <usd>` (overrides `budget.maxUsd`) and `status --repo <path>`. `plan --json` prints only `{ plan, issues }` on stdout. `starling dash` serves the repo's store read-only (`POST /api/runs` → 501, "use `starling run`"). The default LLM profile for real runs is `opencode` (`STARLING_LLM_PROFILE` overrides it; the library default stays `deepseek`). Recordings over 5 MB keep lifecycle events only. Real recordings: `fixtures/real/quick-wins.jsonl`, `fixtures/real/launch-day.jsonl`. Known limits: the auditor runs tests in the hub repo, opencode completions report `$0` for planner/auditor turns, a single machine only (perches come from Epic 42's `starling perch`), and no conflict-resolver wiring.
  - **Wave 3 CLI extensions** (built in `apps/cli/src/ext/*`, registered by C3/Epic 203, so mark them `⏳ C3`): `watch` (142), `gc` (143), `explain` (144), `completions` + `version --json` (145), `report` (146), `config` (147), `logs` (148), `try` (149).
  - **Verify against code, not memory.** The CLI surface is `createProgram()` in `apps/cli/src/program.ts`. Import it read-only (`import { createProgram } from '../../apps/cli/src/program.ts'`) and walk `program.commands` / `command.options` (`.long`, `.short`, `.negate`, `.required`, `.defaultValue`). It works from `docs/` today (verified). Core schemas: `../../packages/core/src/index.ts` (`StarlingEventTypeSchema.options`, `TaskStatusSchema.options`, `RunStatusSchema.options`, `defaultConfig`, `StarlingConfigSchema`). Never spawn the CLI binary, start servers or touch the network in a checker.
  - **Checker layout:** `docs/<area>/check.ts` (pure exported functions plus an `import.meta.main` CLI with `--check` (exit 1 on problems) and, where it generates content, `--write`), `docs/<area>/check.test.ts` beside it, and `docs/<area>/tsconfig.json` = `{ "extends": "../../tsconfig.base.json", "include": ["*.ts"] }`. Generated blocks sit between `<!-- generated:<name>:start -->` / `<!-- generated:<name>:end -->` markers. Tests are offline, deterministic and finish in under 2 s.
  - **Root `bun run test` does not cover `docs/`** (its filters are `packages apps/server apps/cli skills integrations tools evals`; keep those words out of your file paths). Run `bun test docs/<area>` and `bunx tsc --noEmit -p docs/<area>` yourself. Biome **does** lint `docs/**/*.ts`, so `bun run check` must stay clean. C3 wiring for every docs epic: "add `bun test docs` and the `docs/*/tsconfig.json` typechecks to the CI docs job (Epic 150) / root scripts".
  - Mermaid fenced blocks are fine (GitHub renders them). Reuse images from `docs/assets/**` (Epic 172 owns that folder; link, don't copy).
- **Parallel siblings change this surface:** Epic 110 (server hardening), 111 (insights routes, mounted later by C3) and 40 (`run.status`, `dash` 501). Document what's on `main` and mark the rest `⏳`. Your checker must stay green both before and after those merge (pending items are allowed to exist).

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`docs/api/**`
plus `docs/epic-176-api-docs.md` and `.orchestrator/handbacks/176-api-docs.md`. Read anything.

## Goal
Integrators (the VS Code extension, the MCP server, the GitHub Action, the notifier, the shell prompt, all being built this wave) need one reference for Starling's REST API, the SSE event stream, the perch API and `starling.config.yaml`. Great looks like this: every route and every `StarlingEvent` type is documented with a working example, **every JSON example is validated against the real zod schemas**, and a checker fails the moment a route, event or config key is added without docs.

## Deliverables
1. **`docs/api/README.md`:** an overview (ports 7777/7778, JSON + SSE, the error envelope, auth today, versioning: contracts are additive-only per L33) and the page index.
2. **`rest.md`:** every route found in `apps/server/src/**/*.ts` (today: health, runs list/get/create/cancel, task abort, `runs/:id/events` SSE, `/api/events` SSE, replay, nodes, flock join/register/heartbeat/bundle, `runs/:id/diff/:taskKey`, `config/public`). Each gets method, path, request body / query with its core type, response type, status codes, the error envelope (read `apps/server/src/http.ts`), and a `curl` example. Document the **current** security posture honestly: SEC-04 replay confinement is fixed (403 outside `fixtures/` and `.starling/`); SEC-01 loopback default + token, SEC-05 413 body limits and SEC-06 SSE caps are `⏳ Epic 110`. Add the planned insights routes `GET /api/runs/:id/report|timeline|costs` and `GET /api/compare?a=&b=` as `⏳ Epic 111 (C3 mounts)`, and the `dash` read-only behaviour (`POST /api/runs` → 501) as `⏳ Epic 40`.
3. **`events.md`:**
   - the SSE wire format (read `apps/server/src/sse.ts`: `data:` framing, ids if any, backlog-then-live, `?since=` resume);
   - a reconnect recipe;
   - **one section per `StarlingEventTypeSchema.options` value** (today 14: `run.created`, `repomap.ready`, `plan.created`, `task.status`, `agent.event`, `audit.verdict`, `merge.result`, `metrics`, `log`, `node.joined`, `node.left`, `node.stats`, `task.migrated`, `run.finished`), plus `run.status` as `⏳ Epic 40`.
   Each section has: when it fires, the payload fields table, and a JSON example preceded by `<!-- event: <type> -->`. Take examples from `fixtures/runs/sky-todo-launch-day.jsonl` where present (trim long strings), and hand-write the rest.
4. **`perch.md`:** every route in `packages/perch/src/perch-app.ts` (`/perch/info`, tasks start/prompt/abort/collect/bundle/delete, `/perch/events`), the `x-flock-token` requirement, the `AgentEvent` SSE format, and SEC-10 ref validation `⏳ Epic 102`.
5. **`config.md`:** every leaf key of `starling.config.yaml` as a dotted path (`maxParallel`, `opencode.mode`, `models.planner.provider`, `providers.<name>.baseUrl`, `flock.offlineAfterMs`, `perch.cacheDir`, …) with type, default (from `defaultConfig`) and meaning, plus `STARLING_LLM_PROFILE`, provider `apiKeyEnv` vars (e.g. `DEEPSEEK_API_KEY`) and the other `STARLING_*` env vars you find by grepping `process.env` in `packages/` and `apps/` (each with the file that reads it). Note that `starling.config.example.yaml` exists, and validate it.
6. **Checker `docs/api/check.ts`:**
   - `scanRoutes(roots)`: a regex scan of non-test `.ts` files for `app.(get|post|put|patch|delete)('<path>'`, returning `{ method, path, file }`;
   - `docRoutes(markdown)`: parses route tables;
   - `eventTypes()` from `StarlingEventTypeSchema.options`;
   - `validateEventExamples(markdown)`: each `<!-- event: X -->` JSON block parses with `StarlingEventSchema.safeParse` and has `type === X`;
   - `configLeafKeys()`: walks `defaultConfig`, treating `providers` and `models` as maps with documented placeholder keys;
   - `validateExampleConfig()`: `StarlingConfigSchema.safeParse` on the parsed example YAML (core's `loadConfig(path)` does this).
   Checks run in both directions. Docs → code: no stale route, event or key unless marked `⏳`. Code → docs: everything is documented. `--check` exits 1 listing `file:line` problems.
7. **Tests** `docs/api/check.test.ts` (≥ 22): the route regex on synthetic sources (template literals, chained calls, comments), table parsing, an example with a wrong type / missing field, a pending event that later exists (allowed), config walking (nested defaults, records), the real docs pass, and a synthetic new route → reported missing.

## Explicitly out of scope
- Server code (110/111), perch code (102), core schemas (202, Wave 3b). Mismatches become FIX REQUESTS or `⏳` notes.
- OpenAPI generation or any new dependency (a hand-written reference plus checker is the deliverable).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test docs/api` → 0 fail, ≥ 22 tests, and `bunx tsc --noEmit -p docs/api` → clean.
3. `bun docs/api/check.ts --check; echo exit=$?` → `exit=0`. Paste the summary (routes, events, examples validated, config keys).
4. Paste the event section count: 14 present types + `run.status` pending, and every example validated by zod.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-176-api-docs.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/176-api-docs.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/176-api-docs`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
