# Epic 104: Merger round 2: native serial merges, priority queue, batch bisect, SEC-11

**Wave 3 · Branch `epic/104-merger-r2` · Issue: `gh issue list --search "Epic 104 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-104-merger-r2.md` and `.orchestrator/handbacks/104-merger-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- Epic 100 (engine) passes `{ testCommand, priority }` to `queue().enqueue` in parallel with you. Accept unknown option fields silently, and don't rename `MergeOptions`.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **SEC-11** (69), merger half: the suite runs repo commands through `bash -c` (deliverable 5).
- **70 F1** and **Epic 40 CONTRACT REQUEST 4:** `merge()` could bypass the queue. Serialise inside the merger (deliverable 1). Tell C3 that Epic 40's `apps/cli/src/real/merger-deps.ts` serial decorator becomes redundant (harmless either way).
- **45** open question (two suite runs on the resolver path): answer it in the doc. **45 #1–#4** are engine work (Epic 100), not yours.
- **70** open question (serial merges are the tail): batches plus bisect (deliverable 4).

## Your lane (you may write ONLY here)
`packages/merger/**`
plus `docs/epic-104-merger-r2.md` and `.orchestrator/handbacks/104-merger-r2.md`. Read anything.

## Goal
At swarm scale the merge queue is the tail of every run (Epic 70: queue wait p50 5.75 s at 30 tasks), and Epic 40 had to wrap `merger.merge` in a decorator because two parallel merges collided on `index.lock`. Make the merger safe by construction (every merge goes through its queue), smarter (critical-path tasks land first, nobody starves), and faster when it counts: merge a batch, run the suite once, and when the batch is red, find the culprit in log2 steps. Put the same command policy as the auditor around the regression suite. Great looks like: the existing resolver and conflict tests stay green, and a bisect test on a real temp repo finds the bad branch in ⌈log2 n⌉ suite runs.

## Deliverables
1. **Serial by construction** (70 F1, Epic 40 CONTRACT REQUEST 4). In `createMerger` (`src/merger.ts`), `merge()` now goes through `queue().enqueue(…)`. The queue calls the raw `mergeTask` internally, so nothing recurses. `MergerOptions.serialMerge?: boolean` (default `true`, `false` restores the direct path). Tests: 5 concurrent `merge()` calls → peak concurrency 1, FIFO results, and `createConflictResolver` landing a resolution through `merger.merge` still works (existing `resolver.test.ts` green, plus one new case).
2. **Priority and fairness** (`src/queue.ts`). Replace the per-key promise tail with a per-key pending list and one drain loop. Keep the `enqueue`/`pending`/`results`/`onResult` signatures. `MergeOptions.priority?: number` (higher first, default 0, FIFO within equal priority). Aging: effective priority = `priority + floor(waitedMs / agingMs)`, with `MergerOptions.queueAgingMs` (default 60 000) so nothing starves. `MergeQueueEntry.priority?` is visible in `pending()`. A rejected merge still doesn't poison the queue, and different integration branches still run concurrently. FakeClock tests for each rule.
3. **`queue().stats()`** returns `{ pending; running; landed; avgWaitMs; maxWaitMs }` (additive) for the queue panel (Epic 133).
4. **Batch merge with bisect** (new `src/batch.ts`). The pure core is `findCulprit(n: number, isGreen: (prefixLen: number) => Promise<boolean>): Promise<{ index: number; probes: number[] }>`, a binary search over prefixes. `mergeBatch(deps: MergeDeps, repo, integrationBranch, tasks: TaskRun[], opts: MergeOptions): Promise<BatchMergeReport>` merges each branch without the suite, then runs the suite **once**. Green → all `merged`. Red → reset the integration worktree to the pre-batch commit, bisect, mark the culprit `tests-failed` and re-merge the others (recursing if a second culprit exists). A branch that conflicts during the batch gets `conflict` and is skipped. `BatchMergeReport = { results: MergeResult[]; suiteRuns: number; steps: Array<{ lo: number; hi: number; green: boolean }> }` (JSON, for Epic 133's visual). It is exposed as an additive `MergerService.mergeBatch(repo, integrationBranch, tasks, opts?)` that runs inside the queue. Tests: `findCulprit` for n = 1..16 and every culprit position with probes ≤ ⌈log2 n⌉ + 1, plus a real temp git repo with 4 branches where one creates `BROKEN` under a `test ! -f BROKEN` suite.
5. **SEC-11 merger side** (new `src/command-policy.ts`). Use the same shape and default table as Epic 103's auditor policy (`CommandPolicy`, `evaluateCommand`, `scrubbedEnv`), duplicated on purpose because the merger can't depend on the auditor. Note in the handback that Epic 202 may move it to core. `MergerOptions.commandPolicy?`, applied in `runSuite` (`src/suite.ts`): env scrub merged with the existing `{ CI: '1', STARLING_TASK }`, and a blocked command means `tests-failed` with `blocked by command policy`. **Keep the literal `['bash', '-c', command]` in `suite.ts`** (`tools/security/exec-argv.test.ts`).
6. **Docs:** in your epic doc, the SEC-11 accepted risk, the batch-vs-serial tradeoff (when to use which), and an answer to 45's open question about two suite runs on the resolver happy path (keep it, and say why).
7. Write **at least 30 new tests**. `conflict-bait.test.ts`, `worktree.test.ts` and `preflight.test.ts` stay green.

## Explicitly out of scope
- Deciding *when* the engine uses batches, and computing priorities (Epic 100 passes `priority`; batch adoption is a C3/3b decision).
- The conflict resolver's prompt and agent loop (unchanged unless a test needs a hook). The auditor's policy (Epic 103).
- Multiple integration branches per run (the Epic 70 open question): write it up in your doc, don't build it.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test packages/merger` → 0 fail, ≥ 30 new tests.
3. `bunx tsc --noEmit -p packages/merger` clean.
4. `bun test tools/security/exec-argv.test.ts` → 0 fail.
5. Paste the `BatchMergeReport` JSON from the 4-branch bisect test (`suiteRuns` and `steps`).
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-104-merger-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/104-merger-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/104-merger-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
