## Epic 00 Handback — Foundation & frozen contracts

**Status:** Complete. Branch `epic/00-foundation` @ `079bb87`.
**Delivered:**
- Bun 1.4.4 workspace pinned in `packageManager` + `.bun-version`; root scripts `test`, `check`, `typecheck`, `format`, `dev:web`, `dev:server`, `starling`. 18 workspaces (`packages/*`, `apps/*`), source-only exports, no inter-package build step.
- `@starling/core` with every ARCHITECTURE §6 contract as a zod v4 schema (types via `z.infer`), every §6 port verbatim, and additive helpers (`StarlingEventOf`, `PlanIssueCode`, `NodeStatus`, `StartTaskOptionsRepo`).
- Core runtime: `createEventBus()` (sync fan-out, isolated throwing subscribers reported as `error` log events), `loadConfig()`/`defaultConfig` over the exact §5 YAML, `newId()`/`shortId()`, `StarlingError`, argv-only `exec()` on `Bun.spawn`, `systemClock`/`FakeClock`, glob matching + conservative `globsOverlap`, pricing table + `usageCostUsd`/`estimateSavedUsd`/`withCall`.
- `@starling/core/testing`: `MockLLM`, `MockRepoMapper`, `MockPlanner`, `MockPromptCompiler`, `MockWorkspace`, `MockRunner`, `MockAuditor`, `MockMerger`, `MockNode`, `MockRegistry`, `MockScheduler`, `NoopTracker`, `MemoryStore`, nine factories. Each mock has its own test. `MockNode.simulateDeath()` rejects later calls with `NODE_OFFLINE` and stops events.
- 15 package skeletons + 3 apps, each importing `@starling/core` and `@starling/core/testing` in a real test, with the exact dependency set from the assignment pinned (no `^`).
- `apps/web`: bootable Vite 8 + React 19 + Tailwind v4 page ("Starling — the sky is loading 🐦"), `/api` → 7777 proxy, `src/app`, `src/data`, `src/components`, `src/lib` and eight feature folders with `index.ts` placeholders, happy-dom setup (package-local `bunfig.toml` + defensive registration in the test).
- `apps/server`: Hono `GET /api/health` → `{ ok: true, version }`, boots on 7777. `apps/cli`: all nine locked commands registered as stubs that name their epic.
- `fixtures/`: `repomaps/sky-todo.json`, a seven-task `plans/sky-todo-launch-day.json` with two dependency edges and disjoint lanes, and a 252-event `runs/sky-todo-launch-day.jsonl` (hub-only start, perch join, three tasks on the Air, `node.left` + `task.migrated`, audit failure → fix → pass on attempt 2, DAG-ordered merges, metrics every 5 s, ~6 minute span). Regenerable with `bun fixtures/scripts/generate-launch-day.ts`, which validates every event against `StarlingEventSchema`.
- `docs/epic-00-foundation.md` with the required sections, full export inventory and a 10-line `MockLLM` example.
- Root `bun run test` excludes `examples/` and `fixtures/` by naming only the seven implementation roots; verified with a deliberately failing test under `examples/` (ignored, then deleted, never committed).

**Key design decisions:**
- **Zod-first contracts, inferred types** — one source of truth; no interface/schema drift. No §6 contradictions were found, only additive schemas/helpers.
- **TypeScript 5.9.3 rather than registry-latest 7.0.2** — 18 workspaces depend on stable `tsc --noEmit -p`; the new native compiler's build-mode ergonomics are still settling, and Wave 1 should not be a compiler beta test.
- **`check` uses a shell loop, not `tsc -b`** — packages are source-only with `noEmit`; project references want composite projects and emitted declarations.
- **Conservative lane overlap** — unknown cases report overlap (serialise one task) rather than miss a conflict; directory semantics apply only to literal trailing segments so `src/*.ts` cannot swallow `src/ui/render.ts`.
- **Mocks behind `@starling/core/testing`** — production imports stay clean and the Wave 1 "prefer mocks" rule is a one-line import.
- **Mock scheduling is async by default, with `immediateScheduler` + `FakeClock` for deterministic tests** — covers both event-subscription realism and synchronous assertions.
- **Fixture data is generated** from the plan fixture and schema-validated before writing, so task keys/dependencies cannot drift.
- **DeepSeek uncached-input price is a documented placeholder** ($0.28/M); output $0.60/M and cached input $0.003/M are the supplied figures. One table to correct before the demo.
- **Biome excludes `AGENTS.md` and `starling.config.example.yaml`** — orchestrator-owned, whitespace-sensitive files must not be rewritten by `bun run format`.

**Verification (exact commands + results):**
- `bun run test` (root): **173 pass / 0 fail** — summary line: `173 pass, 0 fail, 726 expect() calls. Ran 173 tests across 36 files.`
- `bun run check`: clean — `Checked 134 files … No fixes applied` and the per-workspace `tsc --noEmit -p` loop exits 0 for all 18 workspaces.
- Exclusion check: created `examples/throwaway/ignored.test.ts` asserting `1 === 2`; `bun run test` still reported `173 pass, 0 fail`; removed it (`examples/` absent before and after).
- `bun run dev:web` then `curl http://localhost:5173/`: HTML `<title>Starling — the sky is loading 🐦</title>`; `bun run build` in `apps/web`: `✓ built in 266ms` (`dist/index.html`, CSS, JS).
- `bun run dev:server` then `curl http://localhost:7777/api/health`: `{"ok":true,"version":"0.0.0"}`.
- `bun run starling --help`: lists plan, run, replay, dash, perch, flock, status, doctor, init (plus help/version).
- `bun fixtures/scripts/generate-launch-day.ts`: `Wrote 252 events …`; every event passed `StarlingEventSchema`.
- Fresh clone: `git clone --branch epic/00-foundation <worktree> <tmp>` → `bun install` → `bun run test` → **173 pass / 0 fail**, `bun run check` clean.

**Dependencies added:** all pinned exact.
- root dev: `@biomejs/biome@2.6.3`, `@types/bun@1.4.4`, `typescript@5.9.3`.
- core: `zod@4.6.7`, `ulid@3.0.2`, `yaml@2.9.1`. llm: `openai@7.45.0`. planner/auditor: `picomatch@4.0.7` + `@types/picomatch@4.0.3`. runner: `@opencode-ai/sdk@1.19.4`. server: `hono@4.13.14`. flock: `bonjour-service@1.4.4`. perch: `hono@4.13.14`, `bonjour-service@1.4.4`. cli: `commander@15.0.0`, `picocolors@1.1.1`.
- web: `react@19.3.1`, `react-dom@19.3.1`, `zustand@5.0.16`, `@xyflow/react@12.12.0`, `@dagrejs/dagre@3.1.3`, `lucide-react@1.62.0`; dev `vite@8.3.5`, `@vitejs/plugin-react@6.1.2`, `tailwindcss@4.3.3`, `@tailwindcss/vite@4.3.3`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `@happy-dom/global-registrator@21.0.4`, `@testing-library/react@16.3.3`.
- No hand edits to `bun.lock`.

**CONTRACT REQUESTS:** none. No contract or port change was needed; additions are schemas/helpers only.

**Deliberately deferred / out of scope:**
- All real implementations of llm, repomap, planner, prompts, workspace, runner, auditor, merger, github, store, engine, flock, perch; server routes beyond `/api/health`; CLI behaviour beyond stubs; web UI beyond the boot page.
- `examples/`, `.github/`, `tools/local-models/`, CI, and any live/network test (the `*.live.test.ts` + `STARLING_LIVE` convention is documented, not used yet).

**Open questions / flagged tradeoffs:**
- DeepSeek V4.1 Flash's uncached-input price could not be read (client-rendered pricing page). Using $0.28/M as a placeholder in `PRICING`; re-check before the demo.
- `globsOverlap` intentionally over-reports for some mid-pattern `**` cases and does not parse braces/extglobs. If the planner starts emitting those forms, the validator will serialise more tasks than strictly necessary (safe direction) or need a matching upgrade.
- `MockWorkspace` is a file-map model, not a git simulator; conflict prediction is scripted. Real `git merge-tree` behaviour belongs to the workspace epic.
- The recorded run is synthetic. It exercises the event contract but is not evidence of real engine behaviour; regenerate once recording exists.
- Issue #1 is linked as `Closes #1`; if the orchestrator wants a different tracking issue, relink at merge time.

Closes #1
