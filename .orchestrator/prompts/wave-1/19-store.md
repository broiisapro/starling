# Epic 19: Store + record/replay

**Wave 1 · Branch `epic/19-store` · Issue: find it with `gh issue list --search "Epic 19 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`packages/store/**`
plus `docs/epic-19-store.md` and `.orchestrator/handbacks/19-store.md`. Read anything; write nothing else.

## Goal
Implement `Store` on `bun:sqlite`, plus the JSONL record/replay machinery. Every run is persisted and can be replayed later at any speed, which is the **demo safety net** when the venue wifi dies.

## Deliverables
- `createSqliteStore(path: string /* or ':memory:' */): Store & { close(): void }`. WAL mode. Tables `runs(id PK, status, started_at, json)` and `events(run_id, seq, ts, type, json)` with index `(run_id, seq)`. `saveRun` upserts; `appendEvent` assigns a monotonically increasing `seq` per run; `events(runId, sinceTs?)` returns events ordered by seq; `listRuns()` is newest first. Writes are batched in a transaction when many events arrive at once (≥ 2,000 events/s sustained on this laptop).
- `exportJsonl(runId, path)` and `importJsonl(path): StarlingEvent[]` (zod-validated, failing on the first bad line with its line number).
- **`deriveRun(events: StarlingEvent[]): Run | undefined`**: a pure reducer folding an event stream into the latest `Run` snapshot (tasks, nodes seen, metrics, status). Export it; the web dashboard's reducer will be cross-checked against it.
- `createReplayer(opts: { events: StarlingEvent[]; bus: EventBus; clock?: Clock; speed?: number; newRunId?: string }): { start(): Promise<void>; stop(): void; done: Promise<void> }`: re-publishes events preserving relative timing scaled by `speed` (`speed: Infinity` = as fast as possible), optionally rewriting `runId`. Long idle gaps are capped at 2 s of real time.
- `attachRecorder(bus, store)`: subscribes to a bus and persists every event, saving the run on `run.created`, `task.status` and `run.finished`.
- Tests with `fixtures/runs/sky-todo-launch-day.jsonl`: import → store → export round-trips byte-identically (after normalised JSON); `deriveRun` on the fixture yields 7 tasks with final statuses matching the fixture's story (one migrated task, one fixed after a failed audit, all merged); replay at speed 100 with FakeClock emits all 252 events in order with scaled timing; recorder plus replayer end to end; the 10k-event write throughput test.

## Explicitly out of scope
Server endpoints (Epic 21). Web reducer (Epic 23). Remote/cloud storage. Migrations beyond a `schema_version` pragma.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test packages/store` passes, ≥ 15 tests, including the throughput test.
3. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
4. `bun run check` passes (Biome + typecheck for every workspace).
5. `docs/epic-19-store.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/19-store.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/19-store`. Conventional Commits scoped to your lane (`feat(store): …`, `test(store): …`, `docs(epic-19): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
