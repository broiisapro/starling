# Epic 156: Workspace stress round 2: 100 worktrees, crash recovery and baselines

**Wave 3 · Branch `epic/156-stress-r2` · Issue: `gh issue list --search "Epic 156 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-156-stress-r2.md` and `.orchestrator/handbacks/156-stress-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Your folder is outside the Bun workspace.** `tools/`, `evals/` and `integrations/` are not workspace members, so bare `@starling/*` and `zod` specifiers do not resolve there. Import other packages by relative path to their public entry (`../../packages/core/src/index.ts`, exactly like `tools/stress/harness.ts` and `evals/lib/core.ts`). Validate with core's exported zod schemas (`StarlingEventSchema`, `PlanSchema`, `RunSchema`, …) instead of importing `zod`. The root `typecheck` loop only covers `packages/* apps/*`, so give every new folder its own `tsconfig.json` (copy `tools/flock/tsconfig.json`, widen `include` if you add subfolders) and typecheck it yourself.
- **Root `bun run test` runs every `*.test.ts` under `tools`, `integrations` and `evals` in one process**, next to everyone else's. Your tests must be offline, deterministic and quick (budget given below), restore any env var they set, stop every server they start and delete every temp dir.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- No Wave 2 FIX REQUEST targets `tools/stress/**` (Epic 57's requests go to the CLI and engine lanes).
- Epic 57 open question, *machine load makes absolute timings non-comparable*: record load average, core count and host in every report and summary (deliverables 5–6).
- Epic 57 open question, *apparent vs allocated bytes*: keep both in the summary's disk table and label which is which.

## Your lane (you may write ONLY here)
`tools/stress/**`
plus `docs/epic-156-stress-r2.md` and `.orchestrator/handbacks/156-stress-r2.md`. Read anything.

## Goal
Epic 57 proved the git layer at 60 worktrees. Wave 3 runs **100 agents on one laptop**, so the claim on the landing page and in the blog has to be "100 parallel worktrees, 0 failures", measured, with the tail latencies and disk cost next to it. Round 2 makes the harness reach 100, adds the two things a swarm really hits (a crashed run that must be reclaimed, and false-positive conflict predictions on clean pairs), and turns the output into a pasteable Markdown summary plus a JSON baseline you can compare against later. Great looks like: `bun tools/stress/worktrees.ts --scale full` prints one headline line a judge understands, writes `.json` + `.md` results, and `--compare` shows what got faster or slower since Wave 2. Default test runs stay tiny.

## Deliverables
1. **Scale presets** `tools/stress/presets.ts`: `export type StressScale = 'tiny' | 'small' | 'demo' | 'full' | 'xl'` and `export const STRESS_PRESETS: Record<StressScale, { files: number; worktrees: number; conflictPairs: number; bundles: number; predictionSample: number; crashRecovery: number }>` (tiny = today's test scale 120/6/2/2, full = 5 000 files / **100** worktrees / 40 pairs / 20 bundles, xl = 20 000 files / 100 worktrees). `worktrees.ts` gains `--scale <name>`; explicit flags still override. **Keep every existing flag** (`--files --worktrees --pairs --bundles --root --keep --no-sparse --json`, L33) and export `parseArgs` additively.
2. **Harness options, additive only** (keep every existing `StressOptions`/`StressReport` field and phase name in `harness.ts`): `gitConcurrency?: number` → `createWorkspace({ maxConcurrency })`; `seed?: number` driving a tiny local PRNG (mulberry32, no deps); `predictionSample?: number` → after the known-conflict pairs, predict N seeded pairs of branches that touch disjoint files and report `checks.cleanPairsChecked` and `checks.falsePositiveConflicts` (must be 0).
3. **Crash-recovery phase** `recover` (option `crashRecovery?: number`, 0 disables): create K extra worktrees on `starling/crash/t<i>`, commit in them, then abandon them like a dead laptop would (never call `ws.remove`; delete half of their directories by hand). Then call the real `recoverWorkspace(repo, worktreeRoot, { dryRun: false, olderThanHours: 0, liveRunIds: ['stress'] })` from `packages/workspace/src/index.ts` and report `checks.recovered`, `checks.recoveryErrors`, and that no `starling/stress/*` branch was touched (they are live). Read `packages/workspace/src/recover.ts` for the reasons and actions it reports.
4. **Bundles at scale:** keep the existing bundle round trip, and add `checks.bundleBytesP95` so the flock cost per task is visible.
5. **Markdown summary** `tools/stress/summary.ts`: `export function renderStressSummary(report: StressReport, meta: { scale?: StressScale; host?: string }): string` → a headline (`100 worktrees · 0 failures · create p95 …ms · disk/worktree … · load 3.1 on 10 cores`), then phase, operation, checks and disk tables. Always show the load average and core count next to timings (Epic 57: timings under load are not comparable).
6. **Results files:** `--out <dir>` writes `stress-<scale>-<YYYYMMDD-HHmm>.json` (the full `StressReport` plus `{ scale, host: { platform, arch, cpus, memGb }, gitVersion }`) and a `.md` twin. Create `tools/stress/results/` with a short `README.md`; commit the result of your one real run (deliverable 10).
7. **Baseline comparison** `tools/stress/compare.ts`: `export function compareStressReports(base: StressReport, next: StressReport, opts?: { regressPct?: number }): StressComparison` (per operation p50/p95 delta %, per phase wall delta, failures delta, a `'better' | 'same' | 'worse'` verdict per row, default threshold 25 %) and `renderComparison(c): string`. CLI flag `--compare <baseline.json>`. Must accept an Epic 57-era report that lacks the new fields.
8. **Concurrency sweep:** `--sweep-concurrency 4,8,12` runs the scenario once per value on a fresh repo and prints one table of phase wall times per value; export `sweepConcurrency(values: number[], opts: StressOptions): Promise<StressReport[]>`.
9. **Safety:** before `full`/`xl`, print an estimate (files × worktrees × average file size × 1.5) and refuse with a clear message when free disk is below it (use `statfs` from `node:fs/promises` when available, otherwise warn and continue). Ctrl-C removes the temp root unless `--keep`.
10. **One real run, through the gate** (it is heavy): `bash .orchestrator/bin/heavy.sh bun tools/stress/worktrees.ts --scale full --out tools/stress/results`. If load average is above 2× the core count, run `--scale demo` instead and say so. Commit the `.json` + `.md`.
11. **Tests** (keep `harness.test.ts` passing unchanged): `presets.test.ts`, `compare.test.ts` (old-shape baseline, regress threshold, verdicts), `summary.test.ts` (headline and tables from a canned report, string asserts, no snapshots of timings), PRNG determinism, `parseArgs` (scale + overrides + bad input), and **one** tiny real run with `crashRecovery: 2, predictionSample: 2` (≤ 150 files, ≤ 6 worktrees) asserting `recovered ≥ 2`, `falsePositiveConflicts === 0`, `worktreesRegisteredAfter === 1`. At least 20 new tests; `bun test tools/stress` under 10 s.

## Explicitly out of scope
- `packages/workspace/**` (Epic 105 is adding a gc library, a disk budget and worktree locks in parallel). Use only today's exports; report workspace bugs as FIX REQUESTS to Epic 105.
- `tools/load/**` (Epic 155), `tools/qa/workspace/**` (Epic 187), `apps/cli/src/ext/gc/**` (Epic 143).
- Merge logic, the engine, real agents, any network.
- Running `full`/`xl` from a test.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test tools/stress` → 0 fail, ≥ 20 new tests, under 10 s (paste the summary line).
3. `bunx tsc --noEmit -p tools/stress/tsconfig.json` and `bunx biome check tools/stress` clean.
4. `bun tools/stress/worktrees.ts --scale tiny --out /tmp/stress-tiny` exits 0; paste the headline, the `recover` line and the false-positive count (0).
5. The real `full` (or `demo`, with the reason) run via `heavy.sh` is committed under `tools/stress/results/`; paste its headline and load average.
6. `bun tools/stress/worktrees.ts --scale tiny --compare tools/stress/results/<your full run>.json` prints the comparison table (paste it).
7. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
8. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
9. `docs/epic-156-stress-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/156-stress-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/156-stress-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
