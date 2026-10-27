# Epic 70 — Load test: 30-task runs and a busy dashboard

## Goal

Find out whether Starling stays smooth at swarm scale — 30-task plans, 20 concurrent agent sessions,
thousands of events per minute — without spending a cent. Use the real engine, store, workspace,
auditor, merger, `LocalNode` and Hono server; fake only the models and the agents. Measure wall time,
event throughput, store write latency, merge-queue time, memory, SSE delivery latency/drops and the
web reducer's per-event cost and retention caps. Report a table per layer and file FIX REQUESTS for
anything that does not hold up.

## How it works

`tools/load` is three runnable scripts plus a suite runner. Every measurement lives in the same
process as the thing it measures (no fake metrics, no synthetic sleeps).

| File | What it does |
|---|---|
| `plan.ts` | A 30-task lane-disjoint DAG as a `PlanDraft` (tasks 1–20 independent, 21–30 each depend on one root) and a deterministic 300-event transcript per task (text/tool/edit/usage, `session.idle` last). |
| `repo.ts` | A throwaway git repo on `main` with `scripts.test = "true"`, plus an empty worktree root. |
| `runner.ts` | `ReplayFleetRunner`: one `ReplayRunner` per `LocalNode` session, forwards events, retimes them to the wall clock, and writes the task's file so the collected diff is non-empty. |
| `rig.ts` | The real wiring: `createEngine`, `createSqliteStore`, `createWorkspace`, `createAuditor`, `createMerger` + `createMergeQueue`, `createLocalNode`, flock registry/scheduler, real repo mapper, real prompt compiler, `NoopTracker`, `MockLLM` planner. Subscribes to the bus for timings and samples `LocalNode.activeSessions()`. |
| `engine.ts` | Runs one 30-task plan at `maxParallel: 20`, prints Table 1 and writes `results/engine.json`. |
| `sse.ts` | Starts `startServer` over that rig, creates the run via `POST /api/runs`, attaches 20 SSE clients, plus a mid-run `?since=` reconnect and a post-run large-tail reconnect. Prints Table 2. |
| `web-reducer.ts` | Builds 20 000 `StarlingEvent`s and feeds them through `apps/web/src/data/reducer.ts`'s `applyEvent`, timing every call and checking every retention cap. Prints Table 3. |
| `index.ts` | Runs reducer → engine → server/SSE in one process (`--quick` for a ~10 s smoke run) and writes `results/combined.json`. |
| `stats.ts`, `instrument.ts`, `report-engine.ts`, `results.ts` | Percentiles/table rendering, instrumented store + memory sampler, report shaping, JSON output and argv parsing. |

The generated plan goes through the **real** `@starling/planner` (`createPlanner`), so normalisation
and the lane/DAG validator run; only the model answer is a `MockLLM` carrying the draft. The real
auditor runs with no reviewer model (deterministic lane/non-empty/tests checks), and the real merger
runs the generated repo's `bun run test` (`true`) in its integration worktree after every merge.

Each task's simulated agent writes `src/task-NN/index.ts` when its session starts. That single file
is what `collect`, the auditor, the lane check and the merge see — without it every merge would be
`skipped` and the merge-queue measurement would be meaningless.

Measurement hooks:

- **Bus subscription** — receive time per event, per-type counts, error-level logs, `plan.created`
  issues, `task.status` transitions, `audit.verdict` and `merge.result`.
- **Instrumented store** — every `appendEvent`/`saveRun` timed; a 50 ms timer calls the SQLite
  store's `flush()` so WAL commit latency is measured under load rather than once at the end.
- **Merger wrapper** — total merge latency (engine `merging` → `merge.result`) split into queue wait
  and merge-service time by timing the inner `merge` and the enqueued call separately.
- **Session sampler** — `LocalNode.activeSessions()` every 5 ms: the honest count of open sessions.
- **Memory sampler** — `process.memoryUsage()` every 50 ms; peaks reported, not just end state.

## Results

Taken on an M-series Mac while ~23 other coding agents were running on the same machine (load
average ≈ 70 during the run). Absolute latencies are therefore pessimistic; the shape of the numbers,
the cap behaviour and the failure modes are the point. JSON for every run is in
`tools/load/results/`.

### Table 1 — engine + store + merge queue (30 tasks, `maxParallel` 20, 20 sessions)

```text
Table 1 — engine + store + merge queue (30 tasks, maxParallel 20, queued merges)
  metric                                             value     p50     p95     p99
----------------------------------------------------------------------------------
  wall time                                         19.41s       —       —       —
  tasks merged                                       30/30       —       —       —
  tasks failed                                           0       —       —       —
  sessions peak                                20 (cap 24)       —       —       —
  events total                                        9235       —       —       —
  agent events                                        9000       —       —       —
  events/sec (mean)                                  475.7       —       —       —
  events/sec (peak 250ms)                             1820       —       —       —
  event gap                                          0.4µs     3ms  48.6ms   548ms
  store append                                         0µs   0.9µs   1.9µs   6.6ms
  sqlite flush (50ms)                                1.2µs   5.2µs  41.2µs   3.2ms
  saveRun                                          410.6µs  12.9ms    45ms   132ms
  audit latency                                       1.2s   1.66s   1.75s   1.78s
  merge latency                                      6.54s   7.48s   7.81s   7.94s
  merge service                                      375ms   1.28s   1.37s   1.39s
  merge queue wait                                   5.75s   7.15s   7.25s   7.29s
  task duration                                     10.61s  15.32s  15.67s  15.74s
  recorded events          9235 (9235 appends, 0 stale ts)       —       —       —
  sqlite file                                        5.6MB       —       —       —
  memory peak                    rss 61.2MB / heap 126.7MB       —       —       —
  plan                      30 tasks, 0 errors, 1 warnings       —       —       —
  test command: bun run test · run 01m5zfgpvfzgf12n1xha1d5gn4 · finished
```

Reading it: the engine dispatches and event loop are not the bottleneck — mean 476 events/s,
peak 1 820/s, event gaps in single-digit milliseconds, store appends sub-microsecond (buffered) and
WAL flushes tens of microseconds. The tail is the **serial merge queue**: 30 merges ×
one `git merge --no-ff` + regression command, so by the end of the run a task waits ~7 s for its
turn, and task duration p50 is ~15 s. That is the honest cost of "merge everything onto one
integration branch after every task", not a regression.

### Table 2 — server + 20 SSE dashboards

```text
Table 2 — server + SSE (20 dashboards, 9247 events/stream)
  metric                                   value    p50    p95    max
---------------------------------------------------------------------
  wall time                               34.73s
  tasks merged                                30
  sse clients                       20 + 1 since
  events stored                             9247
  frames delivered              184940 (266.3/s)
  backlog/client                               2
  stale agent ts           0 (oldest 2026-10-27)
  backlog drain                              0µs    0µs    0µs      —
  live latency                              63ms  417ms  594ms  1.04s
  since latency                           44.5ms  392ms  569ms  1.04s
  connect delay                             14ms   14ms      —   14ms
  live/client                               9245
  dropped frames                               0
  duplicate frames                             0
  clients with drops                           0
  since mid-run                      9202/9202 ✓
  since tail                 9213/9213 ✓ in 1.1s
  sessions peak                               20
  memory peak                    rss 155.7MB / heap 139.9MB
  run 01m5zfh9zm4ex0022gsvcnvpax · finished · since mid=1793131588482 tail=1793131588072
```

Reading it: 184 940 frames delivered with **zero dropped and zero duplicated frames**, and both
`?since=` reconnects returned exactly the stored tail (multiset-equal, no gaps). Live delivery p50
63 ms, p95 417 ms under 20 clients plus a running engine on the same event loop — acceptable for a
dashboard, worth watching at higher fan-out. The 155 MB RSS includes the harness keeping 180 k
latency samples and key maps in-process; the server's own footprint is much smaller.

### Table 3 — web reducer, 20 000 events

```text
Table 3 — web reducer (20000 events, 14500 agent)
  metric                                          value    p50     p95     max
------------------------------------------------------------------------------
  events applied                                  20000      —       —       —
  wall time                                       604ms      —       —       —
  per event                                       3.9µs  8.1µs  40.9µs  88.6ms
  events/sec                                      33142      —       —       —
  state retained      6000 transcript lines in 1 run(s)      —       —       —
  cap events                                5000/5000 ✓      —       —       —
  cap agentLog/task                           500/500 ✓      —       —       —
  cap verdicts/task                           100/100 ✓      —       —       —
  cap merges                                  500/500 ✓      —       —       —
  cap metricsHistory                        2000/2000 ✓      —       —       —
  state JSON                                      3.3MB      —       —       —
  heap delta                    0.5MB (peak 8.3MB used)      —       —       —
  rss peak                                       42.6MB      —       —       —
  caps all hold: yes · state 3.3MB
```

Reading it: ~4 µs/event (33 k events/s), 8 µs p95, worst case 89 ms (a GC pause). All five caps hold
exactly at their ceiling; the retained state for a saturated 30-task dashboard is 3.3 MB of JSON and
~0.5 MB of extra heap. The reducer is not a bottleneck at the event rates the engine produces.

### Reproduction runs

| Run | Command | Result |
|---|---|---|
| Unqueued merges | `bun tools/load/engine.ts --raw-merges` | **28/30 merged, 2 failed** (`git merge … failed`); merge service p50 987 ms, no queue wait. |
| Double recording | `bun tools/load/engine.ts --double-record` | **18 466 stored rows** for 9 233 events, DB 11.3 MB (vs 9 235 rows / 5.6 MB). |
| Raw replay timestamps | `bun tools/load/engine.ts --no-retime` | **9 000 stale agent events** (all of them, from 2023-11-14). |
| Raw replay + SSE | `bun tools/load/sse.ts --no-retime` | 9 000 stale events, only 237 live frames/client, mid-run `since` **✗**, backlog drain 19.5 s. |
| Exact session cap | `bun tools/load/engine.ts --tasks 5 --parallel 3 --headroom 0` | **4/5 merged**, 1 failed: `Node hub is at capacity (3 sessions)`. |

## Key decisions & reasoning

- **Real everything except model answers.** The engine, store, git worktrees, auditor, merger and
  server are the production implementations. The planner is the real planner with a `MockLLM`; the
  agents are `ReplayRunner`s. This is the only way to answer "does the product stay smooth" without
  a model bill, and it matches Wave 2's no-real-LLM rule.
- **A queued merger adapter in the rig, not in the product.** The engine calls `merger.merge()`
  directly (`pipeline.ts:150`) while the real `MergerService` ships a serial queue. To make "merge
  queue time" measurable — and to get a green run — the rig routes engine merges through
  `createMergeQueue`. The unqueued path is reproducible with `--raw-merges` and is filed as F1.
  `engine.ts` records service time (inner merge) separately from queue wait (enqueue → result), which
  is why Table 1 can say the queue, not git, is the tail.
- **Four extra session slots (`--headroom 4`).** A task's slot is released on the transition to
  `merged`, before `node.cleanup()`; the dispatcher can therefore start a new task while the old
  session still exists, and `LocalNode` answers `at capacity`. Four slots absorb that window without
  changing `maxParallel` (20 sessions measured, 24 allowed). With `--headroom 0` the race is
  reproducible (F2). The sampler proves the engine never opened more than 20 sessions in the main run.
- **Retime replayed events (`--no-retime` to disable).** `ReplayRunner` keeps the recording's
  absolute `ts`; that is right for `starling replay` but wrong when it is used as a live
  `AgentRunner`, because the engine publishes those timestamps and SSE's `since` filter then drops
  every agent event on reconnect. The fleet wrapper stamps each emitted event with a monotonic
  wall-clock value, preserving recorded spacing. F4 asks for this in the runner itself.
- **One writer to the store.** `RunDriver.publish()` already persists to the store; wiring
  `attachRecorder(bus, store)` as well (the store's documented hook) doubles every row. The rig uses
  the engine's writer only; `--double-record` measures the conflict (F3). Note that non-engine events
  published straight onto the bus (server request logs) are *not* persisted by the engine path — the
  proper fix is one owner for "persist the bus", not two half-owners.
- **Deterministic auditor, real command.** No reviewer model is configured, so audits are lane +
  non-empty + tests. That keeps the run free and deterministic while still exercising the real
  auditor code path and a spawned command per audit.
- **The generated repo's test command is `true`.** `bun run test` spawns a real process (that is the
  cost being measured) but does not run a suite. A real suite would add minutes and noisy CPU, not
  insight into Starling's own overhead.
- **Relative imports into sibling `src/index.ts`.** `tools/` is not a Bun workspace package, so
  `@starling/*` does not resolve from here. Importing each package's public entry by relative path
  keeps the "public API only" rule without editing root `package.json`.
- **Reducer measured before the I/O scripts.** `index.ts` runs the pure reducer first so GC and the
  server's retained buffers do not inflate its numbers; that is why the standalone Table 3 is much
  better than the reducer number inside an earlier combined run.
- **In-process SSE clients are conservative.** The 20 dashboards share the server's event loop (as
  they would in a single `starling` process, though real dashboards are remote browsers). This makes
  delivery latency a worst case, not a best case.

## Findings and FIX REQUESTS

Each item names the owner lane from the prompt and the exact code site on this branch.

### F1 — Engine bypasses the merge queue (owner: engine, Epic 49) — **high**

`packages/engine/src/pipeline.ts:150` calls `deps.merger.merge(...)` directly. `MergerService` ships
`queue()` (`packages/merger/src/merger.ts`, `queue.ts`) but the engine never uses it, so concurrent
tasks merge into the same integration worktree at the same time. `--raw-merges` reproduced **2/30
failed tasks** with `git merge … failed`, and merge service p50 rose to 987 ms (queued: 375 ms).

Proposed change: when the injected merger exposes a queue (`'queue' in merger` or an optional
`Merger.queue?()` port), call `merger.queue().enqueue(repo, branch, task, opts)`; otherwise keep the
current direct call. Alternatively make `createMerger().merge` itself internally enqueue, so no caller
can bypass it.

### F2 — Slot released before the node session is cleaned up (owner: engine, Epic 49) — **medium**

`RunDriver.transition()` calls `#pump()` synchronously (`run-driver.ts:623`) after a terminal
transition, and `TaskPipeline` calls `node.cleanup()` one line after `transition('merged')`
(`pipeline.ts:168`). During that window `activeByNode()` no longer counts the task, but the
`LocalNode` session still holds a slot. Reproduced with `--tasks 5 --parallel 3 --headroom 0`:
`startTask failed for t04…: Node hub is at capacity (3 sessions)`, task failed.

Proposed change: release the slot after `cleanup` resolves (pump from the pipeline after cleanup), or
base `activeByNode` on live `TaskHandle`s rather than task status. Either removes the need for a
capacity cushion.

### F3 — Two writers persist every event twice (owner: engine 49 + store 41) — **high**

`RunDriver.publish()` writes `store.appendEvent(event)` then publishes on the bus
(`run-driver.ts:637-639`). `attachRecorder(bus, store)` (`packages/store/src/recorder.ts`) persists
every bus event and is the store package's documented integration point. Wiring both — the natural
reading of both docs — stores every event twice: `--double-record` gives 18 466 rows for 9 233 events
and an 11.3 MB database, vs 9 235 rows / 5.6 MB with one writer.

Also note the inverse gap: events the server publishes directly on the bus (`requestLogger` in
`apps/server/src/logging.ts`, and any flock node event published outside the engine) are never
persisted when the engine is the only writer.

Proposed change: one owner. Either (a) the engine stops writing and every composition root calls
`attachRecorder` (then engine `saveRun` calls also move to the recorder's accumulator), or (b) the
engine keeps writing and `attachRecorder` is documented as "for demos/replay, not with the engine"
or becomes idempotent. Add a `Store.appendEvent` test that a wiring helper cannot double-append.

### F4 — `ReplayRunner` leaves recorded absolute timestamps (owner: runner, Epic 15) — **high for demos**

`packages/runner/src/replay.ts:227` re-emits events with the recording's `ts` and only remaps
`runId`/`taskKey`/`sessionId`. Used as a live runner, the engine publishes 2023 timestamps and SSE's
`since` filter (`event.ts >= since`) drops all of them: `--no-retime` shows 9 000/9 000 agent events
stale, 237 live frames per client, and the mid-run reconnect incomplete (`sse-no-retime.json`).

Proposed change: add `retime?: boolean` (default `true` when a real clock is used, or a
`clock.now()` stamp on emit) to `ReplayRunnerOptions`; keep `false` for recorded-run replay where the
original timeline is the product. This is what `tools/load/runner.ts` works around today.

### F5 — The auditor tests the hub repo, not the task worktree (owner: engine 49 + contract) — **high**

`packages/auditor/src/auditor.ts:125` uses `run.worktreePath ?? ctx.goal.repoPath`. The engine never
sets `TaskRun.worktreePath`, and `TaskHandle` has no path, so with a `LocalNode` every audit runs the
test command in the **hub repo** instead of the agent's worktree. Changing the lane check or diff
does not hide this: the tests that "prove" the task are not the task's tests.

Proposed change: put `worktreePath` on `TaskHandle` (or `TaskResult`) and set
`TaskRun.worktreePath` before `auditor.audit`. See the CONTRACT REQUEST in the handback.

### F6 — Backlog replay is one synchronous burst per client (owner: server, Epic 46) — **medium**

`apps/server/src/sse.ts:81-87` reads the whole backlog and calls `send()` for every event without
yielding. In the no-retime run, 20 clients × 9 002 backlog events took **19.5 s** to drain and later
clients waited behind earlier backlogs. With retimed events the same 9 213-event tail drains in 1.1 s,
so this only bites reconnecting dashboards after a long run.

Proposed change: yield between chunks (`await Bun.sleep(0)` every 250–500 events) or stream the
backlog in pages from the store; keep the backlog-then-live ordering the current dedupe guarantees.

### F7 — Planner's advisory task ceiling is 12 (owner: planner, Epic 12) — **low**

`createPlanner({ maxTasks })` rejects values above 12 and `validatePlan` warns above it
(`packages/planner/src/validate.ts`). Every 30-task plan therefore carries one warning (shown in
Table 1: `1 warning`). It does not block the run, but "swarm scale" is now a product target.

Proposed change: make the ceiling configurable up to e.g. 64 (or scale with `maxParallel`), keeping
the warning for unusually large plans.

### F8 — `appendCapped` copies the cap on every event (owner: web data, Epic 41) — **low**

`apps/web/src/data/reducer.ts:67-71` does `list.concat(item)` then `slice(-cap)` per event, so a
saturated dashboard copies 5 000 elements for every event (and 2 000 for metrics). At current rates
it is cheap (~4 µs/event) but the 89 ms worst-case pause is GC from that churn.

Proposed change: a fixed-size ring buffer per capped list (or only slice when over cap and use a
mutable array behind `applyEvent`). Keep `SkyState` shapes unchanged.

## Interfaces for future epics

The scripts export their runners and report types so later epics can reuse them as a regression
harness rather than copy-pasting:

```ts
import { runEngineLoadTest } from './tools/load/engine.ts';   // → EngineReport
import { runSseLoadTest } from './tools/load/sse.ts';         // → SseReport
import { runWebReducerTest } from './tools/load/web-reducer.ts'; // → ReducerReport
import { runAll } from './tools/load/index.ts';               // → CombinedReport
```

- **`EngineReport`** — `mode`, `events` (total/agent/perSecond/peak/gap), `store`
  (append/flush/saveRun/read summaries, row count, DB bytes, stale agent events), `audit`, `merge`
  (`latency`, `service`, `queueWait`), `taskDurations`, `memory`, `plan`, `errors`.
- **`SseReport`** — `events`, `timestamps` (staleAgentEvents/oldest/newest), `liveLatency`,
  `backlog`, `connection.delayMs`, `drops` (missing/duplicates), `since.midRun` / `since.tail`
  multiset checks, `memory`.
- **`ReducerReport`** — `perEvent`, `msPerEvent`, `eventsPerSecond`, `mix`, `caps` (one `CapCheck`
  per reducer cap), retained `state`, `memory`.
- Every run writes `tools/load/results/*.json`, so CI or a future "performance budget" epic can diff
  a run against a stored baseline instead of parsing stdout.
- Reproduction flags (`--raw-merges`, `--double-record`, `--no-retime`, `--headroom 0`) are the
  fixtures for the fixes above: when an owner lands F1–F4, the corresponding flag should stop
  showing a difference.

## Deviations from plan

- The assignment names `tools/load/engine.ts`, `sse.ts` and `web-reducer.ts`; the shared rig, plan,
  runner, stats, instrumentation, report and suite runner are additional files in the same lane.
- `sse.ts` uses `startServer` in-process and submits the run through `POST /api/runs` (the real API
  path) rather than calling `engine.start` directly — the server is part of what is under test.
- The rig adds three narrowly scoped adapters that do **not** live in the product: a queued-merger
  adapter, a session cushion (`--headroom`), and a retiming fleet runner. Each one has a flag that
  turns it off to reproduce the underlying issue.
- The generated repo's test command is `true`, not a real suite (see Key decisions).
- No package under test was edited. All findings are in this doc and the handback as FIX REQUESTS.

## Known limitations / deferred

- **Machine load.** Measurements ran alongside ~23 other agents (load average ≈ 70). Absolute
  numbers move run to run: merge service p95 ranged 0.4–1.4 s and the reducer 0.6–2.0 s. Re-run on a
  quiet machine before quoting a budget; the structural results (no drops, caps hold, queue tail)
  were stable across runs.
- **One node.** The load run uses the hub's `LocalNode` only. Remote perches/bundles, node loss and
  task migration are covered by their own epics and are not exercised here.
- **Replay agents do not write real code.** A single generated file per task makes diffs, lane checks
  and merges real, but it does not exercise large diffs, binary files or conflict resolution.
- **No real LLM or opencode.** The planner model, reviewer and agents are mocked by design (Wave 2
  rule L29); this tests the harness, not model latency.
- **In-process SSE clients** share the server's event loop, so delivery latency is a worst case and
  server memory numbers include harness bookkeeping.
- **30-task plan carries one planner warning** because the planner's advisory ceiling is 12 (F7).
- **Conflict/resolver paths, cancellation storms, budget exhaustion and repeated fixer loops** are
  not load-tested here; the happy path is 30/30 merged.
- **Store read latency** is measured only for the per-run `events()` call used by SSE/report; no
  `listRuns()`/`getRun()` hot-loop benchmark.
