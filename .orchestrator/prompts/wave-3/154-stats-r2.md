# Epic 154: Stats round 2: the 100-agent wave in numbers

**Wave 3 · Branch `epic/154-stats-r2` · Issue: `gh issue list --search "Epic 154 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-154-stats-r2.md` and `.orchestrator/handbacks/154-stats-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Parallel consumer.** Epic 137 (about page) is coding against this epic's new optional fields **right now** with a fallback. Keep the field names in item 1 exactly; if you must deviate, put the final shape at the top of your epic doc's "Interfaces for future epics" and flag it in the handback.
- The collector runs `git`/`gh` on the real repo while ~100 agents push to it: never write into `.git`, never fetch, and keep `gh` optional (`--no-gh`).

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **59-landing-site, request 4** (to Epic 68): the site reads `site/data/stats.json` in the canonical shape `{ generatedAt, source, totals: { epics, prs, tests, agents, laptops, commits } }`. Provide it via `--site <path>` and add `totals.laptops` / `source`; writing into `site/` is Epic 179's call (they run `--site site/data/stats.json`).
- **60-readme, request 3** (to Epic 68): replace README's placeholder "Built by the flock" table with collector output. README is Epic 172's lane: produce the table in `stats.md` and say in the handback exactly which block 172 (or C3) should paste.
- **68-swarm-stats, request 3:** the workspace/typecheck gap for `tools/` is root config (declined here; Epic 150 typechecks `tools/*` in CI).

## Your lane (you may write ONLY here)
`tools/stats/**`
plus `docs/epic-154-stats-r2.md` and `.orchestrator/handbacks/154-stats-r2.md`. Read anything.

## Goal
Wave 3 is the headline of the whole story: about 100 open-weight agents building one product on one laptop in a day. The about page (Epic 137) and the blog post (Epic 180) need numbers that prove it: epics and PRs per wave, PRs merged per hour, lines changed by lane, and a curve of how many agents were working in parallel over time. This epic extends Epic 68's collector to Wave 3 scale, **additively**, so the existing about page keeps rendering while the new one reads the richer data. Great looks like: one command regenerates `stats.json` (+ a Markdown digest for the blog and README), every number is reproducible from git/gh, and degraded sources are explained rather than hidden.

## Deliverables
1. **Additive types** in `tools/stats/types.ts` (L33: `apps/web/src/features/about` imports these types and the landing site normalises the file): keep `SWARM_STATS_VERSION = 1` and every existing field; add optional fields only: `SwarmStats.concurrency?: ConcurrencyPoint[]` (`{ t: string /* ISO */, active: number }`, a step series), `SwarmStats.throughput?: ThroughputStats` (`{ hourly: { hour: string; merged: number; opened: number }[]; peakMergedPerHour: number; meanMergedPerHour: number }`), `SwarmStats.lanes?: LaneStats[]` (`{ lane: string; epics: string[]; added: number; removed: number; files: number; generated: { added: number; removed: number } }`), `SwarmStats.source?: string` (e.g. `"tools/stats v1.1"`), `SwarmTotals.laptops?: number` (distinct `machine` values), and on `WaveStats`: `prs?`, `prsPerHour?`, `peakParallel?`, `linesExcludingGenerated?`. Add `SWARM_STATS_FEATURES = ['concurrency', 'throughput', 'lanes', 'wave3'] as const` and `SwarmStats.features?: string[]` so consumers can feature-detect.
2. **Wave 3 epics:** `epics.ts` learns `'3b'` in `WAVE_ORDER` (after `'3'`), and a fallback `waveForEpicNumber(n)` (`100–199` → `'3'`, `200–299` → `'3b'`) used when `.orchestrator/epics.tsv` has no row for an epic (today it stops at 71). Three-digit epic numbers already parse; add tests proving tags `epic-142-complete`, branches `epic/142-cli-watch` and PR titles `epic(142): …` are recognised.
3. **PR timing:** add `createdAt` to `PR_FIELDS` and `PullRequest` (optional) so each PR has an open → merge interval; parse it tolerantly.
4. **Concurrency series:** `concurrency.ts` with pure `concurrencySeries(intervals: { start: number; end: number }[]): ConcurrencyPoint[]` and `peakOf(series)`. Intervals come from, in order of preference: agent log sessions (exact, from `logs.ts`), else epic `startedAt` → `mergedAt` (first commit author date or PR `createdAt`, whichever is earlier), else PR `createdAt` → `mergedAt`. In-flight epics end at `generatedAt`. Merge adjacent equal points; cap the series at 2,000 points by bucketing (document the rule).
5. **Throughput:** `throughput.ts`: hourly buckets (UTC, ISO hour strings) of PRs merged and opened, peak and mean over hours that had any activity, per wave `prsPerHour` (merged PRs ÷ wave wall-clock hours).
6. **Lines by lane:** `lanes.ts`: per epic, `git log --numstat` over the epic's own commits (reuse how `git.ts` finds an epic's commit range), bucket each path to a lane key (rules: `apps/web/src/features/<x>`, `apps/cli/src/ext/<x>`, `packages/<x>`, `apps/<x>`, `tools/<x>`, `evals/<x>`, `examples/<x>`, `docs`, `.github`, else top-level dir), and count **generated** lines separately (`bun.lock`, `fixtures/**`, `*.jsonl`, `**/__snapshots__/**`, `**/__screenshots__/**`, `tools/*/results/**`, `tools/stats/out/**`, `openapi.json`); also `linesExcludingGenerated` per wave and in totals (Epic 68 deferred this). One `git log` call per wave range, not per file, so 150 epics stay fast.
7. **Outputs:** `collect.ts` gains `--md <path>` writing `stats.md` (a digest for the blog and README: headline sentence, per-wave table `| Wave | Epics | Agents (peak) | PRs | PRs/hour | Tests after | Lines (hand-written) |`, top 10 lanes by lines, an ASCII concurrency sparkline) and `--site <path>` writing the landing site's canonical shape `{ generatedAt, source, totals: { epics, prs, tests, agents, laptops, commits } }` (Epic 59's request). Default outputs stay `tools/stats/out/stats.json`; also write `tools/stats/out/stats.md`. Commit a regenerated snapshot of both at the end.
8. `summaryLines` adds a line for throughput and peak parallel agents with its source ("from agent logs" / "from PR timestamps").
9. Performance guard: a test builds a synthetic temp repo with 120 epic tags/branches (scripted `git` in a temp dir, small files) and asserts the collector completes with a bounded number of `git` invocations (count calls through the injected `run`; no wall-clock asserts).
10. Tests (≥ 30 new): concurrency series edge cases (empty, nested, identical starts, open-ended), throughput buckets across midnight UTC, lane bucketing table-driven (≥ 15 paths), generated-line exclusion, wave fallback for 100–299, PR `createdAt` parsing, `--md` and `--site` output snapshots from a fixed fake input, back-compat: an old v1 `stats.json` fixture still satisfies the extended type, and the about page's `FIXTURE_STATS` (`apps/web/src/features/about/fixture.ts`) still type-checks against the new types (a type-only import in a test is enough).

## Explicitly out of scope
- The about page (Epic 137 renders the new fields), the landing site (Epic 179), the blog (Epic 180), and README numbers (Epic 172). You produce the data and the Markdown digest; they consume it.
- Running the test suite inside the collector (still "test declarations", as Epic 68 decided).
- Editing `.orchestrator/epics.tsv` (the Orchestrator owns it; that's why the number-range fallback exists).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test tools/stats` → 0 fail, ≥ 30 new tests; `bunx tsc --noEmit -p tools/stats` clean.
3. `cd apps/web && bunx tsc --noEmit -p .` still clean (the about page compiles against the extended types).
4. `bun tools/stats/collect.ts --md tools/stats/out/stats.md --site /tmp/site-stats.json` on this repo: paste the summary lines, the per-wave table from `stats.md`, and the site JSON. Commit the regenerated `tools/stats/out/stats.json` and `stats.md`.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-154-stats-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/154-stats-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/154-stats-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
