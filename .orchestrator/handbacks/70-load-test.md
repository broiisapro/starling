## Epic 70 Handback — Load test: 30-task runs and a busy dashboard

**Status:** Complete. Branch `epic/70-load-test` @ `43fd8b8` (+ docs commit). Closes #85.

**Delivered:**
- `tools/load/plan.ts` — a 30-task lane-disjoint DAG as a real `PlanDraft`, plus a deterministic 300-event/`1.6 s` transcript per task (`session.started` → text/tool/edit/usage → `session.idle`).
- `tools/load/repo.ts` — a throwaway git repo (`main`, `scripts.test = "true"`) and worktree root per run.
- `tools/load/runner.ts` — `ReplayFleetRunner`: one real `ReplayRunner` per `LocalNode` session, per-session event forwarding, retiming to the wall clock, and the simulated worktree edit that makes diffs/audits/merges real.
- `tools/load/rig.ts` — real `createEngine`, `createSqliteStore`, `createWorkspace`, `createAuditor`, `createMerger` + `createMergeQueue`, `createLocalNode`, flock registry/scheduler, real repo mapper/prompt compiler; bus instrumentation, store instrumentation, session and memory samplers.
- `tools/load/engine.ts` — 30 tasks at `maxParallel` 20, Table 1, `results/engine.json`; flags `--tasks/--parallel/--events/--speed/--headroom/--raw-merges/--no-retime/--double-record`.
- `tools/load/sse.ts` — real Hono server, run created via `POST /api/runs`, 20 SSE clients + mid-run `?since=` and post-run large-tail reconnects, multiset dropped/duplicate detection, Table 2, `results/sse.json`.
- `tools/load/web-reducer.ts` — 20 000 events through `apps/web/src/data/reducer.ts`, ms/event and every retention cap, Table 3, `results/web-reducer.json`.
- `tools/load/index.ts` + `--quick`, `tools/load/README.md`, 22 unit tests, and committed JSON evidence including the four reproduction runs (`engine-raw-merges.json`, `engine-double-record.json`, `engine-no-retime.json`, `sse-no-retime.json`, `engine-capacity-bug.json`).
- `docs/epic-70-load-test.md` — methodology, tables, readings, decisions, F1–F8 with exact code sites.

**Key design decisions:**
- **Real everything except models/agents.** Engine, store, git worktrees, auditor, merger, `LocalNode`, server and web reducer are production code; the planner is the real planner over a `MockLLM`, agents are `ReplayRunner`s. This is the only zero-cost way to answer the question and respects Wave 2's no-LLM rule.
- **Measure queue wait and service separately.** The rig routes engine merges through `createMergeQueue` (the engine itself does not — F1) and times the inner merge and the enqueued call independently. That is why the report can attribute the tail to the serial queue rather than to git.
- **Four-slot session cushion (`--headroom 4`, default).** The engine releases a task's slot on `merged` before `node.cleanup()`; `LocalNode` can answer `at capacity`. The cushion absorbs the window while `maxParallel` stays 20 (peak measured: exactly 20). `--headroom 0` reproduces the race (F2).
- **Retime replayed events (default), `--no-retime` to reproduce.** `ReplayRunner` keeps the recording's absolute `ts`; as a live runner that makes SSE `since` drop every agent event. The wrapper preserves recorded spacing and stamps monotonic wall-clock values.
- **One store writer.** The engine already persists in `publish()`; wiring `attachRecorder` too doubles rows. The rig uses one writer, `--double-record` measures the conflict (F3).
- **Generated test command is `true`.** Real process spawn per audit/merge (the cost we care about) without a multi-minute suite.
- **Relative imports into sibling `src/index.ts`.** `tools/` is not a workspace package, so `@starling/*` does not resolve; this keeps public-entry imports without root config changes.

**Verification (exact commands + results):**
- `bun install` → `Checked 162 installs across 221 packages (no changes)`.
- `bun run test` (root):
  - packages/tools half: `1381 pass, 4 skip, 0 fail` — `Ran 1385 tests across 166 files.`
  - web half: `426 pass, 0 fail` — `Ran 426 tests across 39 files.`
- `bun run check` → `biome check .` (732 files, no fixes) + per-workspace `tsc --noEmit` loop, all clean. `tools/` is outside the root typecheck loop; `bunx tsc --noEmit -p tools/load/tsconfig.json` is also clean.
- `bun test tools/load` → `22 pass, 0 fail, 467 expect() calls`.
- `bun tools/load/index.ts` (full suite) → three tables below; all 30 tasks merged, 0 dropped SSE frames, all reducer caps hold. Machine was running ~23 other agents (load avg ≈ 70), so absolute latencies are pessimistic; JSON in `tools/load/results/`.

Table 1 — engine + store + merge queue (30 tasks, `maxParallel` 20):

```text
  metric                                             value     p50     p95     p99
  wall time                                         19.41s       —       —       —
  tasks merged                                       30/30       —       —       —
  tasks failed                                           0       —       —       —
  sessions peak                                20 (cap 24)       —       —       —
  events total                                        9235       —       —       —
  agent events                                        9000       —       —       —
  events/sec (mean)                                  475.7       —       —       —
  events/sec (peak 250ms)                             1820       —       —       —
  store append                                         0µs   0.9µs   1.9µs   6.6ms
  sqlite flush (50ms)                                1.2µs   5.2µs  41.2µs   3.2ms
  saveRun                                          410.6µs  12.9ms    45ms   132ms
  audit latency                                       1.2s   1.66s   1.75s   1.78s
  merge service                                      375ms   1.28s   1.37s   1.39s
  merge queue wait                                   5.75s   7.15s   7.25s   7.29s
  task duration                                     10.61s  15.32s  15.67s  15.74s
  recorded events          9235 (9235 appends, 0 stale ts)
  sqlite file                                        5.6MB
  memory peak                    rss 61.2MB / heap 126.7MB
  plan                      30 tasks, 0 errors, 1 warnings
```

Table 2 — server + 20 SSE dashboards:

```text
  metrics                                        value     p50     p95     max
  events stored                                   9247
  frames delivered                            184940
  live latency                                   63ms   417ms   594ms   1.04s
  connect delay                                  14ms    14ms       —    14ms
  live/client                                     9245
  dropped frames                                     0
  duplicate frames                                   0
  clients with drops                                 0
  since mid-run                            9202/9202 ✓
  since tail                   9213/9213 ✓ in 1.1s
  stale agent ts                     0 (oldest 2026-10-27)
  memory peak                  rss 155.7MB / heap 139.9MB
```

Table 3 — web reducer, 20 000 events (standalone run):

```text
  events applied                                  20000
  wall time                                        604ms
  per event                                       3.9µs  8.1µs  40.9µs  88.6ms
  events/sec                                       33142
  cap events                                5000/5000 ✓
  cap agentLog/task                           500/500 ✓
  cap verdicts/task                           100/100 ✓
  cap merges                                  500/500 ✓
  cap metricsHistory                        2000/2000 ✓
  state JSON                                      3.3MB
  heap delta                    0.5MB (peak 8.3MB used)
  rss peak                                       42.6MB
```

Reproduction runs (all committed as JSON):
- `bun tools/load/engine.ts --raw-merges` → **28/30 merged, 2 failed** (`git merge … failed`); merge service p50 987 ms.
- `bun tools/load/engine.ts --double-record` → **18 466 rows** for 9 233 events, DB 11.3 MB (vs 9 235 / 5.6 MB).
- `bun tools/load/engine.ts --no-retime` → **9 000 stale agent events**.
- `bun tools/load/sse.ts --no-retime` → 9 000 stale events, 237 live frames/client, mid-run `since` **✗**, backlog drain 19.5 s.
- `bun tools/load/engine.ts --tasks 5 --parallel 3 --headroom 0` → **4/5 merged**, `startTask failed … Node hub is at capacity (3 sessions)`.

**Dependencies added:** none (no `package.json` or lockfile changes).

**CONTRACT REQUESTS:**
1. Add `worktreePath?: string` to `TaskHandle` (or `TaskResult`) in `packages/core/src/contracts.ts`. `LocalNode` already knows the path (`local-node.ts`), but the engine has no way to put it on `TaskRun`; as a result `Auditor` falls back to `ctx.goal.repoPath` (`auditor.ts:125`) and audits the **hub repo** instead of the task worktree. Proposed: `TaskHandle.worktreePath?: string`, engine sets `TaskRun.worktreePath` after `startTask`/before `audit`. (F5)
2. Optional `queue?(): MergeQueuePort` on the `Merger` port (with a small core-local `MergeQueuePort { enqueue(repo, branch, task, opts): Promise<MergeResult> }`), or document that `createMerger().merge` is internally serialised. Either lets the engine use the real queue without a structural cast. Alternative with no type change: make `MergerService.merge` enqueue internally. (F1)

**FIX REQUESTS (detailed in `docs/epic-70-load-test.md`):**
- **F1 (engine 49, high):** `pipeline.ts:150` calls `merger.merge()` directly, bypassing `MergerService.queue()`. `--raw-merges`: 2/30 failed merges, service p50 987 ms. Use `queue().enqueue(...)` when available, or serialise inside `merge`.
- **F2 (engine 49, medium):** `transition()` pumps synchronously (`run-driver.ts:623`) before `node.cleanup()` (`pipeline.ts:168`), so a slot is free while the node session is alive; `--headroom 0` reproduces `at capacity` and a failed task. Pump after cleanup or count live handles.
- **F3 (engine 49 + store 41, high):** `RunDriver.publish()` (`run-driver.ts:637-639`) and `attachRecorder` (`store/src/recorder.ts`) both persist; following both docs doubles rows (18 466 vs 9 233) and DB size. Also `*`-scoped server logs are only persisted if the recorder is attached. Pick one owner.
- **F4 (runner 15, high for demos):** `ReplayRunner` re-emits recorded `ts` (`replay.ts:227`); used live, all 9 000 agent events are stale and a `?since=` reconnect loses the transcript. Add `retime` (default true for a live clock).
- **F5 (engine 49 + contract, high):** no `TaskRun.worktreePath`, so audits run tests in the hub repo (`auditor.ts:125`). See CONTRACT REQUEST 1.
- **F6 (server 46, medium):** `sse.ts:81-87` serialises the whole backlog synchronously; 20 clients × 9 002 backlog events took 19.5 s (no-retime run). Yield every few hundred events.
- **F7 (planner 12, low):** `maxTasks` ceiling is 12, so every 30-task plan carries a warning. Make the advisory bound configurable up to swarm scale.
- **F8 (web data 41, low):** `appendCapped` (`reducer.ts:67-71`) copies the cap on every event (5 000 elements at saturation); 89 ms worst-case pause is GC churn. Ring buffer.

**Deliberately deferred / out of scope:**
- Editing any package under test (F1–F8 are requests only).
- Remote perches, bundles, node loss/migration, cancellation storms, budget exhaustion and fixer loops.
- Real LLM/opencode latency and real code-writing agents (Wave 2 rule L29).
- Conflict resolution / large or binary diffs; every task writes one small file.
- Pushing the load test into CI as a performance budget (JSON is there for it; thresholds are not).

**Open questions / flagged tradeoffs:**
- Should `MergerService.merge` serialise internally (making it impossible to bypass the queue) or should the engine learn about `queue()`? Internally is safer; the port change is cleaner. Flagged in CONTRACT REQUEST 2.
- Is "one integration branch, serial merges" the intended swarm-scale design? At 30 tasks the merge queue, not dispatch or events, is the tail (queue wait p50 5.75 s). If that is unacceptable, the fix is a merge-queue policy discussion (batched merges, multiple integration branches), not a micro-optimisation.
- Should `ReplayRunner`'s `retime` default be true always? That changes `starling replay` semantics if reused there; the runner is used both for recordings and as a live demo agent.
- The machine was at load ≈ 70 with ~23 parallel agents; numbers should be re-baselined on a quiet machine before any budget is written down.
