# Epic 00: Foundation & frozen contracts

**Wave 0 · Branch `epic/00-foundation` · Issue: `gh issue list --search "Epic 00"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

You are building the foundation of **Starling**, an open-source, open-weight-first harness that turns one coding goal into a swarm of parallel opencode agents. Each agent works in its own git worktree and its own non-overlapping file *lane*, gets audited by a local model, and is merged through a queue. Product: `.orchestrator/PRD.md`. Design: `.orchestrator/ARCHITECTURE.md`. Read both fully before writing anything.

Starling also has **Flock mode**: a hub can push agents onto other laptops ("perches") over the LAN, moving the repo as git bundles (ARCHITECTURE §1).

**Why this epic matters more than any other:** as soon as you merge, **23 agents start in parallel across two laptops** on top of your work, each confined to one package. They can't edit root config or the contracts. Anything you get wrong or leave out, all 20 inherit. Precision beats speed here.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE.md §7 L1–L20, in full. Most relevant to you: Bun ≥1.3 workspaces (`packages/*`, `apps/*`), TS strict ESM, packages export `./src/index.ts` directly (no build step), `bun test`, Biome, zod v4, ULIDs, `openai` SDK for LLMs, `@opencode-ai/sdk`, `bun:sqlite`, Hono, React 19 + Vite + Tailwind v4 + zustand + @xyflow/react + dagre, commander + picocolors, git and gh via `Bun.spawn`, MIT.

## FIRST TASK: carryover
None. This is the first epic. (Stated explicitly so it's clear carryover was considered.)

## Your lane (you may write)
Everything at the repo root **except** `AGENTS.md`, `opencode.json` and `.orchestrator/**` (other than your handback). Also `packages/*/` and `apps/*/` skeletons, all of `packages/core/**`, all of `fixtures/**`, and `docs/epic-00-foundation.md`.
**Not yours:** `examples/**` (Epic 01, running in parallel right now), `.github/**` and `tools/local-models/**` (Epic 02, also in parallel).

## Deliverables

### 1. Monorepo root
- Use the latest stable Bun. Check `bun --version`; if Bun is missing, install it with the official script. Pin it in `package.json#packageManager` and `.bun-version`.
- `package.json`: `"private": true`, `"name": "starling-monorepo"`, `"workspaces": ["packages/*", "apps/*"]`, scripts:
  - `test`: runs `bun test` over `packages apps skills integrations tools evals` only. Explicitly exclude `examples/` and `fixtures/`. Verify the exclusion works by creating a throwaway failing test under `examples/` locally, confirming it's ignored, then deleting it **without committing it**.
  - `check`: `biome check .` + typecheck of every workspace (choose `tsc -b` with project references or a loop; document the choice).
  - `format`, `dev:web`, `dev:server`, `starling` (runs `apps/cli/src/index.ts`).
- `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, ESM, `moduleResolution: bundler`, `types: ["bun"]`), `biome.json` (2-space indent, single quotes, line width 110, ignore `examples/`, `fixtures/`, `dist/`, `node_modules/`), `.gitignore` (extend the existing one; **keep its `Claude outputs/` line**; add node_modules, dist, `.starling/`, `*.db`, `.env*`, `*.log`), `.editorconfig`, `LICENSE` (MIT, "Starling contributors"), `README.md` (short placeholder: one-paragraph pitch, quickstart TBD, "built by a swarm"; Epic 50 rewrites it), `starling.config.example.yaml` (exactly ARCHITECTURE §5).

### 2. Package skeletons for every package and app in ARCHITECTURE §3
For each of `core llm repomap planner prompts workspace runner auditor merger github store engine flock perch` (under `packages/`) and `cli server web` (under `apps/`):
- `package.json` with name `@starling/<dir>`, `"type": "module"`, `"exports": {".": "./src/index.ts"}`, the workspace deps it will need on `@starling/core` (`"workspace:*"`), and the **pre-installed third-party deps below**. This exists to stop 20 agents fighting over `bun.lock`.
- `tsconfig.json` extending the base.
- `src/index.ts` exporting a clearly-marked placeholder (e.g. `export const PACKAGE = '@starling/planner' as const;`), plus one trivial passing test, so `bun run test` is meaningful from day 1.

Pre-installed deps (exact current versions, no `^`):
| package | deps |
|---|---|
| core | zod (v4), ulid, yaml |
| llm | openai |
| planner, auditor | picomatch (+ @types/picomatch) |
| runner | @opencode-ai/sdk |
| server | hono |
| flock | bonjour-service |
| perch | hono, bonjour-service |
| cli | commander, picocolors |
| web | react, react-dom, zustand, @xyflow/react, @dagrejs/dagre, lucide-react; dev: vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite, @types/react, @types/react-dom, @happy-dom/global-registrator, @testing-library/react |
| root dev | @biomejs/biome, typescript, @types/bun |

- **apps/web** must be a *bootable* Vite + React + Tailwind v4 app (`bun run dev:web` serves a page saying "Starling — the sky is loading 🐦"). Use this folder structure, with an `index.ts` placeholder in each feature folder so later lanes exist: `src/app/`, `src/data/`, `src/components/`, `src/lib/`, `src/features/{sky,dag,agents,queue,metrics,flock,launch,about}/`. Vite proxies `/api` → `http://localhost:7777`. Set up happy-dom for `bun test` via a web-local `bunfig.toml` preload, so React component tests work.
- **apps/server** boots a Hono app on port 7777 with `GET /api/health` → `{ ok: true, version }` only.
- **apps/cli** prints `starling --help` with commander, with the command names from ARCHITECTURE §6 "CLI surface" registered as stubs that print "not yet implemented (epic NN)".

### 3. `packages/core`: the frozen heart
- `src/contracts.ts`: **every type in ARCHITECTURE §6, verbatim in shape.** Write it zod-first: `export const GoalSchema = z.object({...}); export type Goal = z.infer<typeof GoalSchema>;`. Include the `StarlingEvent` discriminated union (`z.discriminatedUnion('type', [...])`). Field names and literal unions must match the doc exactly. If you find a real contradiction or gap in the doc, resolve it minimally, mark it `// DECISION(epic-00):` in code, and list it in your handback.
- `src/ports.ts`: every port interface in §6, verbatim.
- `src/events.ts`: `createEventBus(): EventBus` (sync fan-out; a throwing subscriber must not break the others; it gets reported as a `log` event).
- `src/config.ts`: `StarlingConfigSchema` (zod, matching §5, every field defaulted) and `loadConfig(path?)`, which reads YAML, merges defaults and validates. Plus `defaultConfig`.
- `src/ids.ts` (`newId()`, `shortId(id)`), `src/errors.ts` (`StarlingError` with `code` union + `cause`), `src/exec.ts` (`exec(cmd: string[], opts: { cwd, env?, timeoutMs?, input? }) → { code, stdout, stderr, durationMs }` on `Bun.spawn`, never throws on non-zero exit, does throw `StarlingError('EXEC_TIMEOUT')` on timeout), `src/clock.ts` (`systemClock`, `FakeClock`), `src/glob.ts` (`matchesAny(path, globs)`, `globsOverlap(a: string[], b: string[]): string[]`, a conservative overlap check used by planner and auditor; document its heuristics and test it hard, with at least 15 cases).
- `src/metrics.ts`: `emptyMetrics()`, `addUsage()`, and a **cost table** `PRICING: Record<string, { inputPerM, cachedInputPerM, outputPerM }>`. For DeepSeek V4.1 Flash, find the current off-peak/peak prices on DeepSeek's pricing page. If you can't fetch it, use output $0.60/M, cached input $0.003/M, and input as a documented placeholder. Local models cost 0. Also `estimateSavedUsd(localUsage)`, which prices local tokens *as if* they had gone to DeepSeek.
- `src/testing/`: **mocks for every port**, exported from `@starling/core/testing` (add that subpath to `exports`): `MockLLM` (queue of scripted responses or a responder function; `completeJson` validates with the given schema), `MockRepoMapper`, `MockPlanner`, `MockPromptCompiler`, `MockWorkspace` (in-memory branches/files), `MockRunner` (on `start`, emits a configurable scripted sequence of `AgentEvent`s ending in `session.idle`, using a `FakeClock`-friendly scheduler), `MockAuditor` (pass/fail script per task key and attempt), `MockMerger`, `MockNode` (an `ExecutionNode` built on MockRunner-style scripted events; supports `simulateDeath()` mid-task, which stops events and makes calls reject), `MockRegistry` (add/remove nodes, emits onChange), `NoopTracker`, `MemoryStore`, plus `makeGoal()`, `makePlan()`, `makeTaskSpec()`, `makeRun()`, `makeNodeInfo()` factories. Each mock gets its own test.
- `src/index.ts` re-exports everything except `testing`.

### 4. `fixtures/`: shared test data (plain JSON/JSONL, validated by a core test)
- `fixtures/repomaps/sky-todo.json`: a `RepoMap` for the demo app described below.
- `fixtures/plans/sky-todo-launch-day.json`: a valid 7-task `Plan` for the demo goal below. Lanes must be disjoint, with 1–2 dependencies.
- `fixtures/runs/sky-todo-launch-day.jsonl`: a **synthetic but realistic recorded run**, one `StarlingEvent` per line with timestamps over ~6 minutes. It covers run.created → repomap.ready → plan.created → tasks going ready/running with `agent.event`s (text, tool.call, file.edited, usage) → auditing → one task fails audit with fixInstructions, gets fixed, and passes on attempt 2 → merges in DAG order → metrics ticks every ~5 s → run.finished. **Flock flavour:** the run starts with only the hub node (`node.joined` for "MacBook Pro"). About 90 s in, a perch "MacBook Air" joins (`node.joined`), and later tasks get `nodeId` set to it. One task gets `task.migrated` when the Air briefly drops (`node.left`) and is rescheduled to the hub. `node.stats` ticks for both nodes. Generate it with a small script `fixtures/scripts/generate-launch-day.ts` (committed) so it can be regenerated. This file powers the web dashboard's demo mode for Epics 23–26 while the real engine doesn't exist yet. Make it rich: 150–400 events.
- A core test that parses every fixture with the zod schemas.

**Demo app facts** (Epic 01 is building it in parallel; make the fixtures consistent with this): `examples/sky-todo` is a Vite + vanilla TypeScript todo app with bun tests. Files: `index.html`, `src/main.ts`, `src/store/todos.ts`, `src/store/persist.ts`, `src/ui/render.ts`, `src/ui/styles.css`, `src/lib/dates.ts`, `src/lib/ids.ts`, tests beside them, and empty feature folders `src/features/{theme,search,export,shortcuts,due-dates}/`. Demo goal ("launch day"): *"Add dark mode with a toggle, live search filtering, CSV export, keyboard shortcuts (n = new, / = search, ? = help), due-date badges, and fix the overdue-calculation and date-sorting bugs in src/lib/dates.ts."* Seven tasks: theme, search, csv-export, shortcuts, due-badges (depends on dates-fix), dates-fix, and help-overlay (depends on shortcuts).

### 5. Docs
`docs/epic-00-foundation.md` per AGENTS.md §6. The **"Interfaces for future epics"** section matters most: show how a Wave 1 package imports contracts, ports and mocks, with a 10-line example test using `MockLLM`, and list every exported symbol of `@starling/core` and `@starling/core/testing`.

## Explicitly out of scope
Any real implementation of llm, repomap, planner, prompts, workspace, runner, auditor, merger, github, store, engine, flock, perch, server routes beyond health, CLI behaviour beyond stubs, or web UI beyond the boot page. Each belongs to a Wave 1 epic. Also out: `examples/`, `.github/`, `tools/local-models/`, CI.

## Definition of done (run literally, paste results in the handback)
1. Fresh clone of your branch → `bun install` with no errors or warnings about missing peers you could have fixed.
2. `bun run test` → all pass, ≥ 40 tests total, core coverage of contracts/glob/config/events/exec/mocks/fixtures.
3. `bun run check` → clean.
4. `bun run dev:web` → page loads (curl it, show the HTML contains the title). `bun run dev:server` → `curl localhost:7777/api/health` returns ok. `bun run starling --help` lists every command.
5. Every package imports `@starling/core` and `@starling/core/testing` successfully (prove it with one import in each package's trivial test).
6. `docs/epic-00-foundation.md` and `.orchestrator/handbacks/00-foundation.md` exist and are complete. PR opened per AGENTS.md §6.

## Git
Branch `epic/00-foundation`. Conventional Commits (`chore(root): …`, `feat(core): …`, `test(core): …`), committed often: at least 8 commits telling the story. Rebase on `origin/main` before pushing. Don't merge and don't tag; the integrator does that after audit.
