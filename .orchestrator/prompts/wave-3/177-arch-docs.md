# Epic 177: Architecture deep dive with Mermaid diagrams checked against the code

**Wave 3 · Branch `epic/177-arch-docs` · Issue: `gh issue list --search "Epic 177 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-177-arch-docs.md` and `.orchestrator/handbacks/177-arch-docs.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
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

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **From 56-repomap-prompts, FIX REQUEST 2:** `docs/epic-11-repomap.md` and `docs/epic-13-prompts.md` are stale (heading symbols, `maxFiles` 5,000, "the prompt package has its own minimal renderer"). They're orchestrator-owned, so don't edit them. Use the corrected facts from `docs/epic-56-repomap-prompts.md` in your docs: one renderer, `renderRepoMap(map, { maxTokens, … })` in `@starling/repomap`; the planner's adoption is `⏳ Epic 107`.

## Your lane (you may write ONLY here)
`docs/architecture/**`
plus `docs/epic-177-arch-docs.md` and `.orchestrator/handbacks/177-arch-docs.md`. Read anything.

## Goal
Explain how Starling actually works, for judges who ask "how?" and contributors who need the map: the package graph, the life of a run, the flock protocol, the merge queue and lanes. Each is a Mermaid diagram on GitHub, and **each diagram is checked by a script against the real code** (package.json dependencies, the status enums, event names and routes), so the pictures can't lie. Great looks like this: a reader understands why the engine talks only to ports, why lanes make parallel agents safe, and what Epic 40 learned when the pieces met.

## Deliverables
1. **`docs/architecture/README.md`:** a one-page overview (the big picture from ARCHITECTURE §1, the "engine only talks to ports" principle, mock vs real composition) and an index.
2. **`packages.md`:** a Mermaid `graph LR` of every workspace package/app and its `@starling/*` dependencies, **generated** from `packages/*/package.json` and `apps/*/package.json` (today: engine → core only; perch → core, flock, runner, workspace; planner → core, llm, repomap; cli → core, perch; …). It goes between `<!-- generated:packages:start/end -->`, with a `%% check: packages` directive. Add a prose section on what each package owns (one line each; read each `src/index.ts` header) and the off-workspace folders (`tools/`, `evals/`, `examples/`, `site/` import core by relative path). Note that Epic 40 adds CLI dependencies, so regenerate after rebasing.
3. **`run-lifecycle.md`:**
   - a `sequenceDiagram` of a real `starling run` (CLI → `compose` → `composeReal` → engine → repomap → planner → workspace/node → runner/opencode → auditor → merger serial queue → store/recorder → bus → server SSE → web), following Epic 40's doc and `packages/engine/src`;
   - a `stateDiagram-v2` for `TaskStatus` (`%% check: task-status`);
   - one for `RunStatus` (`%% check: run-status`).
   Derive transitions from the engine source (read `packages/engine/src/*.ts`, the transition/pipeline code) and cite file:line for the non-obvious ones (fixing loop, conflict, cancel).
4. **`flock-protocol.md`:** a `sequenceDiagram` of register → heartbeat → `startTask` (bundle fetch) → `/perch/events` SSE → collect → bundle back → `fetch` into the hub repo, plus the offline/reschedule path (`heartbeatMs` 3000, `offlineAfterMs` 15000 from `defaultConfig.flock`). Mark it `%% check: routes`: every `/api/...` and `/perch/...` path in it must exist in the code. Link `docs/flock/` for operations.
5. **`merge-queue.md`:** a flowchart: audit pass → `merge-tree` preflight → serial queue (Epic 40's `index.lock` finding and why the queue is the production path) → merge → regression suite → `merged` | `conflict` → resolver (Epic 45, wiring `⏳ Epic 100`) | rollback. Include the batch/bisect plans (`⏳ Epic 104`).
6. **`lanes.md`:** what a lane is (`owns`/`reads` globs), how the planner validates disjointness (`globsOverlap`/`lanesDisjoint` in `packages/core/src/glob.ts`, the `PlanIssueCodeSchema.options` codes), how the auditor enforces it after the fact (`packages/auditor/src/lane.ts`, the SEC-08 normalisation `⏳ Epic 103`), and a worked example from `examples/sky-todo/demo-goals/conflict-bait.expected.md`. Mark it `%% check: events` wherever event names appear.
7. **`decisions.md`:** the locked decisions L1–L31 condensed into "decision → why → consequence" (one line each, linking ARCHITECTURE §7), plus "what the build taught us": Epic 40's seven integration bugs, the duplicate event log, the hub heartbeat and the node_modules symlink. Use the correct current facts where older epic docs are stale (see carryover).
8. **Checker `docs/architecture/check.ts`:**
   - `parseMermaidBlocks(md)` → `{ directive, source, line }[]`;
   - `packageGraph(repoRoot)` → edges from package.json files;
   - `renderPackageGraph(edges)` (deterministic order);
   - `checkPackages(block, edges)`: both directions;
   - `checkStates(block, schemaOptions)`: every state in the diagram is a real status and every status appears;
   - `checkRoutes(block, routes)`: reuse a small route scan of `apps/server/src` and `packages/perch/src`;
   - `checkEvents(text)`: backticked `x.y` event names are in `StarlingEventTypeSchema.options` or marked `⏳`.
   `--write` regenerates the package graph; `--check` exits 1.
9. **Tests** `docs/architecture/check.test.ts` (≥ 18): Mermaid parsing (multiple blocks, comments, aliases like `A[label]`), an edge missing/extra, a state typo, an unknown route, a pending event, the generator's determinism, and the real docs pass.

## Explicitly out of scope
- `docs/epic-*.md` and `.orchestrator/ARCHITECTURE.md` (orchestrator-owned; list stale facts as FIX REQUESTS), `docs/assets/**` (172), `docs/flock/**` (183), `docs/api/**` (176).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test docs/architecture` → 0 fail, ≥ 18 tests, and `bunx tsc --noEmit -p docs/architecture` → clean.
3. `bun docs/architecture/check.ts --check; echo exit=$?` → `exit=0` (paste the per-diagram summary).
4. Every Mermaid block renders: paste each block into GitHub's preview, or keep the syntax to the documented subset (`graph`, `sequenceDiagram`, `stateDiagram-v2`, `flowchart`). State in the handback which you verified.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-177-arch-docs.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/177-arch-docs.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/177-arch-docs`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
