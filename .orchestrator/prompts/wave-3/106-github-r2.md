# Epic 106: GitHub round 2: rate-limit backoff, idempotent labels and milestones, murmuration PR body, commit statuses

**Wave 3 · Branch `epic/106-github-r2` · Issue: `gh issue list --search "Epic 106 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-106-github-r2.md` and `.orchestrator/handbacks/106-github-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.


## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- No Wave 2 FIX REQUEST targets `packages/github`. 43's requests are engine work (Epic 100).
- **43 deferred, now in scope:** pagination past 500 issues and editing issues when the plan changes (deliverable 5). Secondary-rate-limit hardening without a live provocation (deliverable 1).

## Your lane (you may write ONLY here)
`packages/github/**`
plus `docs/epic-106-github-r2.md` and `.orchestrator/handbacks/106-github-r2.md`. Read anything.

## Goal
GitHub mode is how judges see Starling's work outside the dashboard: an issue per task, a PR per task, and a final PR that tells the story. Make it robust against GitHub's rate limits (primary as well as secondary), keep every write idempotent (labels and milestones included), turn the final PR body into a proud "murmuration summary" (who flew, how parallel, time saved), and optionally light up a commit status per task. Great looks like: a dry-run tracker records a believable `gh` transcript, every retry path is tested with a fake `gh` and a seeded random, and NoopTracker and the GitHub tracker pass one shared contract suite.

## Deliverables
1. **Deterministic, smarter backoff** (`src/gh.ts`). `GhRetryOptions.random?: () => number` (today `backoffMs` calls `Math.random()`). It parses `retry after N seconds` / `Retry-After: N` from stderr and honours it (capped by `maxDelayMs`). For a **primary** limit (`API rate limit exceeded`, which `failure()` flags `rateLimited` and doesn't retry today), `GhClient` calls `gh api rate_limit --jq .resources.core.reset` once and waits `min(reset − now, maxRateLimitWaitMs /* default 60 000 */)` before one retry. A total `maxTotalWaitMs` budget bounds everything. Every wait goes through `warn`. Tests with `testing/fake-gh.ts` and an injected `sleep`.
2. **Idempotent milestones and label styles.** `GitHubTrackerOptions.milestone?: string | ((run: Run) => string)`: `ensureMilestone(title)` lists via `gh api repos/{repo}/milestones?state=all` and creates once, and issues get `--milestone`. `syncLabelStyles?: boolean` updates a drifted colour or description with `gh label edit`. Both are safe to repeat, and a race ("already exists") counts as success. Tests in real and dry-run modes.
3. **Murmuration summary.** Export `renderMurmurationSummary(run: Run): string`: a `## Murmuration` section with a per-node table (tasks, merged, attempts, cost), peak parallelism and time saved vs serial (Σ task `finishedAt − startedAt` minus `metrics.elapsedMs`, computed from `TaskRun`), audit pass rate on the first try, and one 🐦 per merged task on a single line. `renderFinalPRBody` embeds it before `## Cost`. The body is still clamped by `clampBody` (65,536). Update `src/__snapshots__` deliberately and list the diff in the handback.
4. **Commit statuses (opt-in).** `GitHubTrackerOptions.commitStatuses?: boolean` (default false). `openTaskPR` posts `success` ("audit passed: …") and `onMerged` posts `success` ("merged into <integration>") via `gh api -X POST repos/{repo}/statuses/<sha> -f state=… -f context=starling/<taskKey> -f description=<≤ 140 chars> [-f target_url=<prUrl>]`, with the sha from `git rev-parse <branch>`. Failures `warn` and never throw. Tests: argv in dry-run, truncation, flag off = no call.
5. **Scale fixes** (43 deferred). `issuesWithLabel` pages past 500 (`gh api --paginate` or a growing `--limit`). `syncPlan` **edits** an existing issue whose rendered body changed (marker match, `gh issue edit --body-file`) instead of leaving a stale plan. Tests with 600 fake issues and a changed task title.
6. **Tracker contract suite** (new `src/tracker-contract.test.ts`). One behavioural suite run against `NoopTracker` (`@starling/core/testing`), `createGitHubTracker({ dryRun: true, … })` and the fake-gh real mode. It checks: every port method resolves on valid input, repeat calls are idempotent, `openTaskPR`/`openFinalPR` return a URL or `undefined`, and nothing throws for a task with no issue.
7. Write **at least 30 new tests**. No real `gh` call anywhere (L23).

## Explicitly out of scope
- Calling `openTaskPR` and routing `warn` to the event bus. That's the engine (Epic 100), which exports `trackerWarnToLog`; you only keep `warn` working.
- `tools/github-sandbox/**` (Epic 159) and the GitHub Action (Epic 164).
- Check runs via the Checks API (needs an App token). Commit statuses are the supported path.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test packages/github` → 0 fail, ≥ 30 new tests.
3. `bunx tsc --noEmit -p packages/github` clean.
4. Paste the dry-run transcript (`dryRunLog()`) of a 3-task run with `milestone` and `commitStatuses` on, and the rendered `## Murmuration` section for the fixture run.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-106-github-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/106-github-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/106-github-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
