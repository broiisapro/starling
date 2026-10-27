# Epic 29: Evals harness (planner + auditor)

**Wave 1 · Branch `epic/29-evals` · Issue: find it with `gh issue list --search "Epic 29 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees (on this laptop and on other laptops, "perches"), audits each result with tests, a lane check and a local model, and merges everything through a queue, all shown live in a murmuration dashboard.

**Wave 0 is merged** (tags `epic-00-complete`, `epic-01-complete`):
- `@starling/core`: every contract (zod-first), every port, the event bus, config, `exec`, globs (`matchesAny`, `globsOverlap`, `lanesDisjoint`), pricing/metrics, and **`@starling/core/testing`**, which has a mock for every port plus factories (`makePlan`, `makeRun`, `makeTaskSpec`, `makeNodeInfo`, `makeAgentEvent`, …). **Read `docs/epic-00-foundation.md` first.** Its "Interfaces for future epics" section lists every exported symbol.
- `fixtures/`: `repomaps/sky-todo.json`, `plans/sky-todo-launch-day.json`, `runs/sky-todo-launch-day.jsonl` (252 realistic events including flock events).
- `examples/sky-todo/`: the demo app Starling will operate on. `examples/scripts/make-demo-repo.sh` makes a fresh git repo of it.

**You are one of 23 agents building Wave 1 at the same time**, each in its own lane. Your siblings' packages are still placeholders while you work. **Never import a sibling Wave 1 package.** Depend only on `@starling/core` and its mocks. Where you meet a sibling, use the **handshake interfaces in ARCHITECTURE §8**, mirrored locally in `src/handshake.ts`, copied verbatim with the header comment the section specifies.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L25**. Especially:
- **L21**: Bun 1.4.4, TS 5.9.3, zod 4.6.7, Biome 2.6.3; never touch root config.
- **L22**: add deps only to your own package.json, pinned exact.
- **L23**: **NO local models, no real LLM calls, no real opencode prompts, no GitHub calls from tests, no `ollama` commands at all.** Use the core mocks and in-process `Bun.serve({ port: 0 })` fakes. You may write `*.live.test.ts` files but do not run them. This laptop runs 20+ agents at once, so keep memory use low: no long-running servers left behind, no huge test fixtures.
- **L13/L14**: git and gh go through `exec` from core, injectable so tests can fake it.

## FIRST TASK: carryover
None. This is a Wave 1 epic built directly on Wave 0. (Stated explicitly so it's clear carryover was considered.)

## Your lane (you may write ONLY here)
`evals/**`
plus `docs/epic-29-evals.md` and `.orchestrator/handbacks/29-evals.md`. Read anything; write nothing else.

## Goal
Build the evals that tell us whether Starling's **planner** produces good, lane-safe decompositions and whether its **auditor** makes the right calls, measured against answer keys rather than vibes. In Wave 1 the harness runs against port implementations you're given (mocks now; the real planner and auditor in Wave 2's quality passes).

## Deliverables
- `evals/planner/cases/`: convert every `examples/sky-todo/demo-goals/*.expected.md` into structured JSON cases (goal text, expected task count range, required feature coverage as keyword groups, expected dependency edges, files that must be in some lane, files that must **not** be touched). Add **3 more cases** on two small public-repo-shaped synthetic fixtures you generate (e.g. a tiny Express API, a tiny Python CLI) with RepoMaps written by hand.
- `evals/planner/score.ts`: `scorePlan(plan, case, repoMap) → { score: 0..1, checks: [...] }`. Checks: the validator has zero error-level issues (reimplement the overlap check with core `globsOverlap`/`lanesDisjoint`, not the planner package), task count in range, feature coverage (keyword groups matched in titles/deliverables), dependency correctness (required edges present, no spurious edges between disjoint features), lane precision (lanes cover the needed files, nothing forbidden), and DoD quality (every task has a test item).
- `evals/auditor/cases/`: 12 seeded diffs with expected verdicts. Coordinate in spirit with Epic 28 but **don't import from tools/**; write your own set focused on *decision quality* (including tricky ones: tests added but trivially asserting `true`; a lane violation in a lockfile; a docs-only task).
- `evals/auditor/score.ts`: accuracy, false-pass rate (the dangerous one), false-fail rate, and quality of fix instructions (keyword hits).
- `evals/run.ts`: `bun evals/run.ts planner|auditor --impl mock|real [--case name]`. `mock` uses core testing mocks scripted with **reference answers** (to validate the harness itself); `real` imports `@starling/planner` / `@starling/auditor` dynamically and is documented as Wave 2-only (it needs the real packages and a model). Output: a table plus `evals/results/<suite>-<date>.json`.
- Tests: scoring functions on hand-built good and bad plans/verdicts (a perfect plan scores ≥ 0.95; an overlapping plan fails the validator check; a missing feature reduces coverage); case files validate against their zod schemas; `run.ts --impl mock` end to end.

## Explicitly out of scope
Running real models (L23). Tuning the planner or auditor (Wave 2, Epics 44 and 48). Modifying `examples/`.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test evals` passes, ≥ 15 tests.
3. `bun evals/run.ts planner --impl mock` and `bun evals/run.ts auditor --impl mock` outputs pasted.
4. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
5. `bun run check` passes (Biome + typecheck for every workspace).
6. `docs/epic-29-evals.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/29-evals.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/29-evals`. Conventional Commits scoped to your lane (`feat(evals): …`, `test(evals): …`, `docs(epic-29): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
