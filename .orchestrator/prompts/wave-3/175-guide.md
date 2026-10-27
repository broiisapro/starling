# Epic 175: User guide: install to first real run, verified against the CLI

**Wave 3 · Branch `epic/175-guide` · Issue: `gh issue list --search "Epic 175 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-175-guide.md` and `.orchestrator/handbacks/175-guide.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
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


## Your lane (you may write ONLY here)
`docs/guide/**`
plus `docs/epic-175-guide.md` and `.orchestrator/handbacks/175-guide.md`. Read anything.

## Goal
Write the guide a new user follows from `git clone` to a merged, green integration branch: install, the first real run on a demo repo (Epic 40's flow), writing goals that plan into clean lanes, reading the dashboard, budgets, flock setup, open-weight profiles and where to go when it breaks. Great looks like this: it reads like a friendly walkthrough, and **every command and flag in it is machine-checked** against `createProgram()`, so the guide can't drift when Wave 3b rewires the CLI.

## Deliverables
1. **`docs/guide/README.md`:** a short "what Starling does" paragraph, the reading order, and a page index with one line per page.
2. **`install.md`:** prerequisites (Bun 1.4.4 (≥ 1.3 works), Git ≥ 2.38 for `merge-tree --write-tree`, opencode ≥ 2.1 with a provider login, Ollama optional), clone + `bun install`, the `alias starling='bun run --cwd <checkout> starling'` tip, and `starling doctor`: what each line means (read `apps/cli/src/doctor-probes.ts`). Then `starling init --yes` / `--dry-run` / `--profile auto|opencode|deepseek|local`. Binaries/installer get `⏳ Epic 151/152`.
3. **`first-run.md`**, the heart of the guide:
   - make a demo repo (`bash examples/scripts/make-demo-repo.sh`);
   - plan it read-only (`starling plan "$(cat …/quick-wins.md)" --repo <path>`, and `--json | jq '.plan.tasks[].key'`);
   - run it for real (`starling run … --repo <path> --max-parallel 3 --record run.jsonl`), with what you see in order: dashboard URL, live view, audits, merges, the final summary and the integration branch;
   - verify it (`git -C <repo> log --oneline starling/<run>/integration`, then `bun test` on that branch);
   - replay it (`starling replay run.jsonl --speed 20`) and inspect it (`starling status --file run.jsonl`).
   Include the no-agents variants: `--dry-run`, and `--mock` (`⏳ Epic 40`).
4. **`goals.md`:** how the planner reads a goal; good vs bad goal pairs (use the real `examples/*/demo-goals/*.md` texts as the good ones); naming files/folders to steer lanes; why "fix X and refactor everything" overlaps; how to read `plan` issues (the `PlanIssueCodeSchema.options` codes from core, each explained in one line); iterating with `plan --json`.
5. **`dashboard.md`:** the Sky (roosts, bird states mapped to `TaskStatus`), the DAG, the agent drawer, the merge queue, metrics and the cost meter, the flock panel, and the launch form. Hotkeys `1 2 b f ? Esc` (verify in `apps/web/src/app/Layout.tsx`). `?demo=1`, and how `starling run` vs `starling dash` vs `bun run --cwd apps/server dev:live` feed it. Wave 3 panels (report, timeline, costs, palette, …) get `⏳ C3` with their assigned hotkeys from the w3 conventions.
6. **`budgets.md`:** `budget.maxUsd` (default 5, from `defaultConfig`), `--budget` (`⏳ Epic 40`), what the engine does at the cap, API vs local spend in the meter and why opencode completions currently show `$0` (Epic 40 limitation), plus `maxParallel` and `maxAttempts`.
7. **`flock.md`, `models.md` and `troubleshooting.md`:** one-screen summaries that link the deep docs (`docs/flock/`, `docs/models/`, `docs/troubleshooting/`) so the guide stands alone but doesn't duplicate them.
8. **`commands.md`:** a full CLI reference **generated** from `createProgram()`: for each command, the signature, description, and an options table (flag, value, default, description), plus its examples text. Then a hand-written "Coming with Wave 3" table of extension commands marked `⏳ C3`. Generated between `<!-- generated:commands:start/end -->` markers.
9. **Checker `docs/guide/check.ts`:**
   - `cliSurface(program)` → `Record<string, { args: string[]; options: { flags: string; long?: string; short?: string; negate: boolean; takesValue: boolean; defaultValue?: unknown; description: string }[] }>`;
   - `extractInvocations(markdown, file)` → `{ file, line, command, flags[], pending: boolean }[]`. Scan fenced `bash`/`sh`/`text`-less blocks and inline code. Handle `bun run starling`, `starling`, quoted args, `$(…)`, trailing-backslash continuations, `--flag=value`, `# comments`, and the `⏳` marker;
   - `validateInvocations(invocations, surface)` → problems (unknown command, unknown flag, missing pending-marker epic);
   - `renderCommandsReference(surface)`;
   - `checkRepoPaths(markdown)`: backticked paths starting `examples/`, `fixtures/`, `docs/`, `apps/`, `packages/`, `tools/` exist, or are D1 planned paths, or are marked `⏳`.
   CLI `--check` / `--write`.
10. **Tests** `docs/guide/check.test.ts` (≥ 25): the extraction edge cases above, the negated `--no-dash` / `--no-flock`, `--max-parallel 8` vs `--max-parallel=8`, an unknown flag, a pending line with and without an epic, `commands.md` up to date, the whole real guide passes, and a fake surface showing a newly added flag doesn't break existing docs.

## Explicitly out of scope
- Deep reference material owned by siblings: REST/SSE/config reference (176), architecture (177), troubleshooting entries (181), models (182), flock (183). Summarise and link.
- `README.md` (172). Any change to `apps/cli` (help text problems → FIX REQUEST for Epic 203).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test docs/guide` → 0 fail, ≥ 25 tests, and `bunx tsc --noEmit -p docs/guide` → clean.
3. `bun docs/guide/check.ts --check; echo exit=$?` → `exit=0` (paste the summary: pages, invocations checked, pending count).
4. Offline commands from `first-run.md` that need no model were actually run (`make-demo-repo.sh`, `starling init --yes --dry-run`, `starling replay fixtures/runs/sky-todo-launch-day.jsonl --speed 200`, `starling status --file fixtures/runs/sky-todo-launch-day.jsonl`), with output pasted in the handback.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-175-guide.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/175-guide.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/175-guide`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
