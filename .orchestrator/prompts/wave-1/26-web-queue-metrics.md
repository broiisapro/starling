# Epic 26: Web: merge queue + cost meter

**Wave 1 · Branch `epic/26-web-queue-metrics` · Issue: find it with `gh issue list --search "Epic 26 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`apps/web/src/features/queue/**` and `apps/web/src/features/metrics/**` (may add a dependency line to `apps/web/package.json`, add-only, but hand-rolled SVG is preferred over chart libraries).
plus `docs/epic-26-web-queue-metrics.md` and `.orchestrator/handbacks/26-web-queue-metrics.md`. Read anything; write nothing else.

## Goal
Build the bottom strip: the **merge queue board** (where every task is in its journey to `main`) and the **metrics panel** whose cost meter tells the open-weight story at a glance: *"$0.04 on DeepSeek · $0.00 on this laptop · you saved $1.80"*. Props-only per ARCHITECTURE §8.

## Deliverables
- `export function MergeQueue(props: MergeQueueProps)` from `features/queue/index.ts`: a horizontal board with columns **Waiting** (pending or ready with unmet deps), **Flying** (running), **Audit** (auditing/fixing, with an attempt badge), **Landing** (merging), **On the wire** (merged, in merge order, with merge commit short sha), and **Grounded** (failed/conflict/cancelled). Compact cards (key, node badge, elapsed). Cards animate between columns (CSS transforms, respecting reduced motion). Click → `onSelectTask`. Merge results with `conflict` or `tests-failed` show the detail on hover.
- `export function MetricsPanel(props: MetricsPanelProps)` from `features/metrics/index.ts`:
  - **Cost meter**: API spend vs local spend ($0.00, with a "local" badge) and estimated savings, with a split bar of API vs local tokens and a tooltip with exact token counts.
  - **Agents active** sparkline (from `history`).
  - Counters: merged, failed, elapsed (live ticking from `run.startedAt` when running).
  - **Throughput**: tasks merged per 10 minutes.
  - All charts hand-rolled SVG: responsive, accessible (`<title>`/`<desc>`, tabular numbers), with no layout shift as numbers tick.
- Mirror §8 in each feature's `handshake.ts`. Number formatting helpers (`formatUsd`, `formatTokens`, `formatDuration`) in `features/metrics/format.ts`, unit-tested. Local fallback status palette until C1.
- `Playground.tsx` per feature driven from the fixture.
- Tests: the column assignment function for every status; the merge order on the wire; the cost meter math (API vs local vs saved) against fixture metrics; formatting edge cases (0, < $0.01, millions of tokens); sparkline path generation; reduced-motion disables transitions.

## Explicitly out of scope
Global store/wiring (Epic 23/C1). Sky/DAG/flock panels. Backend metrics computation (the engine does it).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test apps/web/src/features/queue apps/web/src/features/metrics` passes, ≥ 20 tests.
3. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
4. `bun run check` passes (Biome + typecheck for every workspace).
5. `docs/epic-26-web-queue-metrics.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/26-web-queue-metrics.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/26-web-queue-metrics`. Conventional Commits scoped to your lane (`feat(queue): …`, `test(queue): …`, `docs(epic-26): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
