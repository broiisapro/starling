# `tools/load` — swarm-scale load tests (Epic 70)

Three scripts that answer one question without spending a cent: **does Starling stay smooth when a
plan has 30 tasks, 20 agent sessions and thousands of events per minute?**

They use the real `@starling/engine`, `@starling/store`, `@starling/workspace`, `@starling/auditor`,
`@starling/merger`, `@starling/flock` `LocalNode` and `apps/server`. Only the model is faked:

| Real | Faked |
|---|---|
| engine state machine, SQLite store, git worktrees, merge queue, audits, Hono server, SSE, web reducer | the planner's model (`MockLLM`), the agents (`ReplayRunner` + 300 scripted events/task), the LLM reviewer (deterministic auditor) |

## Run

```sh
bun tools/load/index.ts          # all three, full scale (~45 s)
bun tools/load/index.ts --quick  # 12 tasks / 8 sessions / 6 dashboards (~10 s)

bun tools/load/engine.ts         # Table 1: engine + store + merge queue
bun tools/load/sse.ts            # Table 2: server + 20 SSE dashboards
bun tools/load/web-reducer.ts    # Table 3: 20k events through the web reducer
```

Every script prints a table and writes machine-readable JSON to `tools/load/results/`. Unit tests:
`bun test tools/load`.

Useful flags: `--tasks`, `--parallel`, `--events` (per task), `--speed` (replay multiplier),
`--clients`, `--headroom`, `--raw-merges`, `--no-retime`, `--double-record`, `--reducer-events`.
The last four exist to reproduce specific findings; see `docs/epic-70-load-test.md`.

## What is measured

- **Engine** — wall time, events/s (mean and peak 250 ms bucket), event gap percentiles, SQLite
  append/flush/saveRun latency, audit latency, merge latency split into queue wait vs service time,
  task duration, peak RSS/heap, database size and stored-row count.
- **SSE** — 20 concurrent `/api/runs/:id/events` streams: live delivery latency, backlog drain,
  dropped/duplicated frames (multiset comparison against the store), connect delay, and two
  `?since=` reconnects (mid-run and a large post-run tail) validated against the stored tail.
- **Reducer** — ms/event through `apps/web/src/data/reducer.ts` and every retention cap
  (`EVENT_CAP`, `AGENT_LOG_CAP`, `VERDICT_CAP`, `MERGE_CAP`, `METRICS_CAP`).

## Notes

- `tools/` is not a Bun workspace package, so the scripts import sibling packages through their
  public `src/index.ts` with relative paths. Nothing outside `tools/load/**` is imported for
  mutation.
- No network, no model server, no Ollama. The only processes spawned are `git`, `bash -c 'true'`
  (the generated repo's test command) and whatever the packages shell out to.
- Each script cleans up its temporary repo, worktrees, integration worktree and SQLite file.
- The generated repo's test command is `true`, so audit/merge latency includes a real process spawn
  but not a real test suite. That keeps the run under three minutes and the numbers comparable.
