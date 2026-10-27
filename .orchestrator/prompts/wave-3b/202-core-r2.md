# Epic 202: Core round 2: contract consolidation

**Wave 3b · Branch `epic/202-core-r2` · Issue: `gh issue list --search "Epic 202 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-202-core-r2.md` and `.orchestrator/handbacks/202-core-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Wave 3b ownership.** You are the **single owner of `packages/core`** in Wave 3b. The header's line saying `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are off limits was written for Wave 3a and **does not apply to your lane**. The other areas in that list stay off limits to you: Epics 200 (`packages/llm`), 201 (`packages/runner`), 203 (`apps/cli`) and 204 (`apps/web/src/data`) own them and run **in parallel** with you, so never wait for them and never edit their lanes.
- **Where main is now.** Your `main` includes Epic 40 (the real `starling run`: `apps/cli/src/real/compose-real.ts`, real recordings in `fixtures/real/*.jsonl`, its core additions) and the Wave 3a epics merged so far. Start with `git log --oneline origin/main | head -40`, `docs/epic-40-integration-captain.md` and `.orchestrator/handbacks/40-integration-captain.md`. The Wave 3a handbacks are `.orchestrator/handbacks/1[0-9][0-9]-*.md` (careful: `1*.md` also matches the Wave 1 handbacks 10–19). Read the ones that mention your area: their **FIX REQUESTS**, **CONTRACT REQUESTS** and **C3 wiring** sections are carryover for you too, exactly like `fix-requests-w2.md`.
- **Core write rights for this wave.** AGENTS.md §1's "never edit `contracts.ts` / `ports.ts`" and L30 ("core is owned by Epic 40") pass to you for Wave 3b: you are the only writer of `packages/core`. **Additive only.** Every new field is optional or has a default, and every new union arm leaves old recordings valid.
- **New event arms vs exhaustive switches.** Only `apps/web/src/data/reducer.ts` and `apps/web/src/data/demo.ts` have a `const neverEvent: never` exhaustiveness check. Epic 204 (in parallel) is told to feature-detect `task.diff` with a local type so it compiles both ways. After rebasing, run `cd apps/web && bunx tsc --noEmit -p .`. If it fails **only** because of your new arm (204 not merged yet), you may make one cross-lane edit: a single no-op `case 'task.diff':` arm in each of those two files, mirroring how Epic 40 added `run.status`. List it in your handback.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
From `fix-requests-w2.md` and the Wave 2 handbacks:
- **Epic 49, FIX REQUESTS 1–3:** `log.payload.code?`, `stallAfterMs`, `budget.warnRatio`, `StartRunInput.budgetUsd?`. (The `run.status` arm is already done by Epic 40.)
- **Epic 49, FIX REQUEST 4; Epic 70, CR1; Epic 40, CR1:** `TaskHandle.worktreePath?`.
- **Epic 53, CRs 1–2:** `StartRunInput.budgetUsd?`, `EngineApi.preview?`.
- **Epic 41, FIX REQUEST 2:** a `task.diff` event, so real runs populate the diff route.
- **Epic 70, CR2; Epic 40, CR4:** an optional `Merger.queue?()` / `MergeQueuePort`.
- **Epic 45:** `MergeResult.resolved?` (it chose `resolved` on `ResolveResult` and named this as the natural core change).
- **SEC-08 (Epic 69):** lane-path normalisation in `glob.ts`, the additive core half.
- **Epic 57, FIX REQUEST 4:** the `worktree.maxGitConcurrency` and `worktree.pruneIntervalMs` config knobs.
- **Epic 55, FIX REQUESTS 1–2 and Epic 47, FIX REQUEST 1:** already landed by Epic 40. Verify them and list them as done.

## Your lane (you may write ONLY here)
`packages/core/**`
plus `docs/epic-202-core-r2.md` and `.orchestrator/handbacks/202-core-r2.md`. Read anything.

## Goal
Every wave has filed CONTRACT REQUESTS that nobody could make because core was locked. The result is local intersection types, payloads guessed among five shapes, `[code]` prefixes inside log messages, and feature detection everywhere. Be the one place where they all land: **additively**, with tests, and with migration notes that tell each consumer what to adopt. Great looks like this: every request from the Wave 2 and Wave 3a handbacks is either landed (optional or defaulted, tested, documented with who should adopt it) or declined with a reason; no existing test, fixture or consumer breaks; and C3 can delete the workarounds one lane at a time.

## Deliverables
1. **Inventory first.**
   - `grep -n -i -A15 "CONTRACT REQUEST" .orchestrator/handbacks/*.md`, plus every FIX REQUEST naming `packages/core` in `.orchestrator/fix-requests-w2.md` and in the Wave 3a handbacks (`.orchestrator/handbacks/1[0-9][0-9]-*.md`, and any `.orchestrator/fix-requests-w3*.md`).
   - Your doc gets a table: source epic | request | decision (landed / declined / already on main) | file.
   - Expect Wave 3a requests from 100 (engine: diff, budget, warn verdicts), 103 (auditor: SEC-08), 104 (merger: queue port), 105 (workspace knobs), 107 (planner `maxTasks`), 110 (server auth config), 111 (insights types) and 112 (feature manifest type).
2. **Already on main from Epic 40; verify, don't redo:** `TaskRun.nodeName?`, the `run.status` event `{ from, to, run }`, `SkyViewProps.paused?` and `MergeQueueProps.selectedTask?`.
3. **Known requests to land.** Each one is optional or defaulted:
   - **a.** `log` payload `code?: string` (Epic 49).
   - **b.** Config gets `stallAfterMs: z.number().int().nonnegative().default(240_000)` and `budget.warnRatio: z.number().min(0).max(1).default(0.8)` (Epic 49). The `.default({...})` literals in `config.ts` must include the new keys. Test that an old YAML without them still loads and that `defaultConfig` has the new values.
   - **c.** `StartRunInput.budgetUsd?: number` (Epics 49 and 53).
   - **d.** `EngineApi.preview?(input: StartRunInput): Promise<{ plan: Plan; issues: PlanIssue[] }>` (Epic 53).
   - **e.** `TaskHandle.worktreePath?: string` (Epics 40, 49 and 70). `TaskRun.worktreePath` already exists.
   - **f.** A `task.diff` event, **exactly** `{ type: 'task.diff', runId, ts, payload: { taskKey: string; diff: DiffSummary } }`, also added to `StarlingEventTypeSchema` (Epics 41 and 100). Epic 204 codes against this exact shape. If Epic 100's handback publishes something else, keep this shape, and note the mapping as a FIX REQUEST to the engine.
   - **g.** An optional merge-queue port: `MergeQueuePort { enqueue(repo: string, integrationBranch: string, run: TaskRun, opts: { testCommand?: string }): Promise<MergeResult> }` and `Merger.queue?(): MergeQueuePort` (Epic 70 CR2, Epic 40 CR4). Also `MergeResult.resolved?: boolean` (Epic 45).
   - **h.** `LLMResponse.usageSource?: UsageSource` with `export type UsageSource = 'reported' | 'estimated' | 'unknown'` (Epic 200 codes against this exact name).
   - **i.** `ProviderConfig.capabilities?: { jsonSchema?: boolean; jsonObject?: boolean; tools?: boolean; contextTokens?: number }` (Epic 10's limitation; Epic 200 reads it).
   - **j.** Config gets an optional `worktree: { maxGitConcurrency?: number; pruneIntervalMs?: number }` (positive ints, Epic 57). Epic 203 plumbs it.
   - **k.** The SEC-08 core half:
     - `normalizeRepoPath(path: string): string | undefined` in `glob.ts` runs `normalizeGlobPath`, then posix-normalises, and returns `undefined` for absolute paths, `../` escapes and any leftover `..` segment;
     - `matchesGlob` and `matchesAny` return `false` for a path that escapes, so a traversal never matches a lane;
     - test `src/../secrets.txt` against `src/**`.

     If a `test.failing` probe in `tools/security/` now passes, flip it per L36.
4. **Leave alone:** don't change existing `PRICING` rows (L28: peak rates) or existing semantics, and don't rename anything (L33). A new error code or event is fine; changing an enum's meaning is not.
5. **Fixtures still parse.** Extend `fixtures.test.ts` so `fixtures/runs/*.jsonl` **and** `fixtures/real/*.jsonl` still parse against `StarlingEventSchema` after your changes, and add a round-trip test for each new arm and field.
6. **Mocks** in `@starling/core/testing`:
   - `MockMerger` gets a `queue()` returning a serial queue;
   - `MockNode` sets `TaskHandle.worktreePath`;
   - add or update a mock test for each change.

   `@starling/core/browser` re-exports any new type the web needs (`UsageSource`, `MergeQueuePort` types only), and `browser.test.ts` still proves the entry is free of `node:` imports.
7. **Migration notes** (a section in `docs/epic-202-core-r2.md`). For each addition, name the consumer that should adopt it and the workaround it replaces. Examples:
   - the engine's `[code]` message prefix and its five `run.status` candidate shapes;
   - the queue's `TaskRunWithNodeName`;
   - the server's three diff shapes in `latestTaskDiff`;
   - web's `run-status.ts`-style detection;
   - the CLI's merge-port decorator.

   Each becomes a one-line FIX REQUEST in your handback, addressed to the owning lane.
8. **Tests: at least 30 new.** Cover zod round-trips, type-level assignments (a value typed with the new optional field and one without), config defaults, glob traversal, and the mocks.

## Explicitly out of scope
- **Implementing behaviour behind the new fields.** Publishing `task.diff`, honouring `warnRatio` and `preview()`, merging through `queue()`: these belong to the engine, server, web and CLI owners. Your handback tells them.
- **Root config** (`package.json`, `tsconfig*.json`, `biome.json`).
- **Other packages' code**, with the one exception in the rules above.
- **`packages/llm`, `packages/runner`, `apps/cli` and `apps/web/src/data`**: they belong to Epics 200, 201, 203 and 204.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test packages/core` → 0 fail, at least 30 new tests.
3. `bunx tsc --noEmit -p packages/core` clean, and once through the gate: `bash .orchestrator/bin/heavy.sh bash -c 'for d in packages/* apps/*; do bunx tsc --noEmit -p "$d/tsconfig.json" || exit 1; done'` clean, because every consumer must still compile with your additions.
4. `bun test tools/security/auditor-lane.test.ts packages/core/src/fixtures.test.ts` → 0 fail (paste).
5. Paste the inventory grep's hit count next to the number of rows in your doc's request table. Every hit must be accounted for.
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-202-core-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/202-core-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/202-core-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
