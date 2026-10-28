SPECS = []

SPECS.append(dict(nn="15", slug="runner", title="opencode runner", scope="runner",
lane="`packages/runner/**`",
goal="""Implement `AgentRunner` on top of opencode's server API: start one opencode server, open one session per task in that task's worktree, send prompts, and turn opencode's event stream into Starling's normalised `AgentEvent`s (text, tool calls, file edits, usage, idle, error). Also provide `ReplayRunner` so demos and tests can run without any model.""",
carryover="""**Important environment fact (L25):** the opencode installed here is a **newer CLI** than most docs describe. It runs a background service; `serve` is the "v2 API and web server"; there are `--standalone` and `--server` flags; the TUI has no `--model` flag; and LLM access goes through the **OpenCode Go** provider (`opencode-go/deepseek-v4.1-flash`). Before designing anything:
1. Record `opencode --version`, `opencode serve --help` and `opencode --help`.
2. Start `opencode serve --port <free port>` (add `--standalone` if needed, so it doesn't touch the shared background service), fetch its OpenAPI document (try `/doc`, and look for the v2 equivalent if that 404s), save it to `packages/runner/test/fixtures/openapi.json`, and stop the server. **Never send a prompt** (L23).
3. Check whether the pre-installed `@opencode-ai/sdk` matches that API. If it doesn't (the SDK targets v1), write a thin typed client against the real endpoints yourself, and document the decision.""",
deliverables="""- `createOpencodeRunner(opts: { mode: 'spawn' | 'attach'; url?: string; port?: number; password?: string; standalone?: boolean; bus?: EventBus; clock?: Clock; spawn?: typeof Bun.spawn; fetch?: typeof fetch }): AgentRunner & { url(): string; health(): Promise<boolean> }`.
  - `spawn`: start `opencode serve` on a free port, wait for health, and kill it on `close()` (also on process exit).
  - `attach`: use an existing server.
- `start({ runId, taskKey, dir, prompt, model, title })`: create a session scoped to `dir` (per-request directory header or the v2 equivalent), send the prompt asynchronously with `providerID/modelID` split from `model`, return `sessionId`. `send(sessionId, prompt)` continues the same session; `abort(sessionId)` aborts.
- **Event normalisation**: one SSE subscription per server, demultiplexed by session id → `AgentEvent` with the runId/taskKey you were given:
  - `session.started`
  - `text` (debounced: merge deltas, emit at most every 500 ms per session, with `{ text }`)
  - `tool.call` and `tool.result` (`{ tool, args/summary, ok }`)
  - `file.edited` (`{ path }`)
  - `usage` (`{ input, output, cached, costUsd? }`)
  - `session.idle` (the agent finished its turn)
  - `session.error`
  Reconnect the SSE stream with backoff and resync via a session status poll after reconnect.
- **Concurrency**: many sessions on one server; a semaphore option `maxConcurrentPrompts`.
- `createReplayRunner({ events: AgentEvent[] | path, clock?, speed? })`: implements `AgentRunner` by replaying events (with original relative timing scaled by `speed`) for whatever session `start` creates, remapping runId/taskKey. Used by demos and tests.
- Tests: a **fake opencode server** on `Bun.serve({ port: 0 })` that implements the endpoints you actually use, with shapes taken from your saved OpenAPI fixture (create session, prompt async, abort, SSE stream). Cover start → events → idle, two sessions interleaved and demuxed correctly, abort, SSE drop and reconnect, error event, debounce of text, plus ReplayRunner timing with FakeClock. Also a `runner.live.test.ts` that spawns the real server and runs one tiny prompt, gated by `STARLING_LIVE=1`; **don't run it**.""",
oos="Choosing which node runs a task (Flock, Epic 30). Prompt content (Epic 13). Auditing. Any real LLM prompt during this epic.",
dod=["`bun test packages/runner` passes, ≥ 20 tests. No opencode process left running afterwards (`pgrep -f 'opencode serve'` shows none started by you).",
     "Your doc's \"Interfaces\" section includes the **exact endpoint table** of the installed opencode server you integrated against, plus a note on SDK-vs-handwritten client."]))

SPECS.append(dict(nn="16", slug="auditor", title="Auditor: tests + lanes + local LLM verdict", scope="auditor",
lane="`packages/auditor/**`",
goal="""Implement `Auditor`: Starling's quality gate. When an agent says it's done, decide **pass or fail with exact fix instructions**, combining hard deterministic checks (lane respected, tests pass) with a judgment from a (usually local, open-weight) model reading the diff against the task's definition of done. The demo moment ("the local model caught a missing test") lives here.""",
deliverables="""- `createAuditor(opts: { llm?: LLM; exec?: typeof exec; clock?: Clock; commandTimeoutMs?: number /* 600_000 */; lintBlocking?: boolean /* false */; maxDiffChars?: number /* 60_000 */ }): Auditor`.
- `audit(input: AuditInput)` runs checks in order, records each as an `AuditCheck`, and never throws for check failures:
  1. **lane**: every changed file must match `ctx.task.lane.owns` (core `matchesAny`), so violations land in `laneViolations`. Starling's own bookkeeping paths are allowed (document which).
  2. **non-empty**: the diff isn't empty.
  3. **tests**: run `ctx.testCommand` in the worktree (`sh -c` via exec with a timeout) and keep the last 4 KB of output.
  4. **lint** (optional, blocking only if `lintBlocking`).
  5. **llm-review** (role `auditor`): `completeJson` with a schema `{ pass, summary, dod: [{ item, met, evidence }], fixInstructions? }`. The input is the task spec, the DoD list, the truncated diff (prioritise lane files, keep file headers) and the test output tail. The prompt is strict: every DoD item needs evidence in the diff, and **new behaviour without new tests fails**.
- Final `pass` = lane ok && non-empty && tests ok && (llm.pass, or no LLM configured). If the LLM errors or times out, record `llm-review` as skipped with the reason and decide deterministically. `fixInstructions` merges the deterministic failures (e.g. "revert changes to src/ui/render.ts, which is outside your lane") with the LLM's instructions into one numbered list.
- Each check reports its duration. The verdict carries the `model` used and `ts`.
- Tests with **MockLLM** and an **injected fake exec**: lane violation fails even when tests pass; tests failing gives fix instructions with the output tail; LLM says DoD unmet; LLM unavailable → deterministic pass; diff truncation keeps lane files; the "no tests added" scenario (the seeded `will-fail-audit` style diff) fails with an instruction to add tests. Prompt text gets a snapshot test.""",
oos="Tuning against the real local model (Wave 2, Epic 44). Choosing the model (Epic 28). Running the fix loop (the engine does). Real `ollama` (L23).",
dod=["`bun test packages/auditor` passes, ≥ 20 tests.",
     "Your doc includes the full auditor system prompt and a worked example verdict JSON for the sky-todo csv-export task."]))

SPECS.append(dict(nn="17", slug="merger", title="Merge queue", scope="merger",
lane="`packages/merger/**`",
goal="""Implement `Merger`: land audited task branches onto the run's integration branch one at a time, run the regression suite after each merge, and roll back cleanly if tests fail or git conflicts. The integration branch must **always** be green.""",
deliverables="""- `createMerger(opts: { worktreeRoot: string; exec?: typeof exec; clock?: Clock; testTimeoutMs?: number }): Merger & { queue(): MergeQueue }`.
- `merge(repo, integrationBranch, run, { testCommand })`:
  - Uses a dedicated integration worktree (`<worktreeRoot>/_integration/<branch-sanitised>`, created on first use).
  - `git merge --no-ff --no-edit <run.branch>` with message `merge(<taskKey>): <title or branch>`.
  - On conflict: collect `git diff --name-only --diff-filter=U`, `git merge --abort`, return `conflict` with `conflictedFiles`.
  - On a clean merge with a `testCommand`: run the tests. If they fail, `git reset --hard HEAD~1` (verify it was our merge commit) and return `tests-failed` with the output tail in `detail`. Otherwise return `merged` with the commit sha.
  - Idempotent: if the branch is already an ancestor of the integration branch, return `skipped`.
- `MergeQueue`: `enqueue(repo, integrationBranch, run, opts): Promise<MergeResult>`, which serialises **per integration branch** (one merge at a time) and keeps FIFO order; `pending()` and `onResult(fn)`.
- `preflight(repo, integrationBranch, branch)`: uses `git merge-tree --write-tree --name-only` to predict conflicts **without** touching any worktree. The engine can call it before enqueueing.
- Tests against **real temp git repos**: clean merge; conflict → aborted and integration branch unchanged; tests-failed → rolled back (testCommand like `test ! -f BROKEN`); already-merged → skipped; three concurrent `enqueue` calls serialised with the final history containing all three; preflight agrees with the actual merge result; the integration worktree is reused across merges.""",
oos="Conflict *resolution* by an agent (Wave 2, Epic 45). Pushing or opening PRs (Epic 18). Choosing merge order (the engine decides; the queue is FIFO).",
dod=["`bun test packages/merger` passes, ≥ 15 tests, total runtime < 30 s."]))

SPECS.append(dict(nn="18", slug="github", title="GitHub tracker", scope="github",
lane="`packages/github/**`",
goal="""Implement `Tracker` for GitHub via the `gh` CLI. In GitHub mode a Starling run mirrors itself onto the repo: one issue per task, a PR per task branch carrying the audit verdict, and a final PR from the integration branch. That makes a swarm's work reviewable by humans the normal way.""",
deliverables="""- `createGitHubTracker(opts: { repo?: string /* owner/name; auto-detect via gh repo view */; cwd: string; exec?: typeof exec; dryRun?: boolean; labelPrefix?: string /* 'starling' */ }): Tracker & { dryRunLog(): string[] }`.
- `syncPlan(run)`: ensures labels `starling`, `starling:run-<short>` and `starling:task`; creates one issue per task (`[starling] <title>`) whose body has the goal, deliverables, DoD checklist and lane; idempotent via a hidden marker `<!-- starling:run=<id> task=<key> -->` (search existing issues before creating). Returns `taskKey → issue number`.
- `openTaskPR(run, task, body)`: `git push -u origin <branch>` (via exec in the worktree), then `gh pr create --base <integration branch> --head <branch> --title "[starling] <title>" --body-file <tmp>` with `Closes #<issue>`. Returns the URL.
- `onMerged(run, task)`: comments the verdict summary on the issue and closes it with a reason.
- `openFinalPR(run, body)`: pushes the integration branch and opens a PR to `run.goal.baseBranch`.
- Pure renderers in `src/render.ts`: `renderTaskIssue(task, run)`, `renderTaskPRBody(task, run)` (verdict table: check → ✅/❌ → detail; usage and cost; agent handback summary if present) and `renderFinalPRBody(run)` (task table, totals, cost split API vs local). Snapshot-test them.
- **Dry-run mode**: no commands executed. Every `gh` or `git` argv is appended to `dryRunLog()` so the CLI can show what *would* happen.
- Tests with an injected fake exec that records argv and returns canned `gh` JSON: idempotent sync (second call creates nothing), PR creation argv exact, failures (gh not authenticated → `StarlingError('GH_AUTH')`), dry-run log contents. **No real gh calls** (L23).""",
oos="Running gh against a real repo (Wave 2, Epic 43). CI. Webhooks. Merging PRs via GitHub (Starling merges locally).",
dod=["`bun test packages/github` passes, ≥ 15 tests. Renderer snapshots committed."]))

SPECS.append(dict(nn="19", slug="store", title="Store + record/replay", scope="store",
lane="`packages/store/**`",
goal="""Implement `Store` on `bun:sqlite`, plus the JSONL record/replay machinery. Every run is persisted and can be replayed later at any speed, which is the **demo safety net** when the venue wifi dies.""",
deliverables="""- `createSqliteStore(path: string /* or ':memory:' */): Store & { close(): void }`. WAL mode. Tables `runs(id PK, status, started_at, json)` and `events(run_id, seq, ts, type, json)` with index `(run_id, seq)`. `saveRun` upserts; `appendEvent` assigns a monotonically increasing `seq` per run; `events(runId, sinceTs?)` returns events ordered by seq; `listRuns()` is newest first. Writes are batched in a transaction when many events arrive at once (≥ 2,000 events/s sustained on this laptop).
- `exportJsonl(runId, path)` and `importJsonl(path): StarlingEvent[]` (zod-validated, failing on the first bad line with its line number).
- **`deriveRun(events: StarlingEvent[]): Run | undefined`**: a pure reducer folding an event stream into the latest `Run` snapshot (tasks, nodes seen, metrics, status). Export it; the web dashboard's reducer will be cross-checked against it.
- `createReplayer(opts: { events: StarlingEvent[]; bus: EventBus; clock?: Clock; speed?: number; newRunId?: string }): { start(): Promise<void>; stop(): void; done: Promise<void> }`: re-publishes events preserving relative timing scaled by `speed` (`speed: Infinity` = as fast as possible), optionally rewriting `runId`. Long idle gaps are capped at 2 s of real time.
- `attachRecorder(bus, store)`: subscribes to a bus and persists every event, saving the run on `run.created`, `task.status` and `run.finished`.
- Tests with `fixtures/runs/sky-todo-launch-day.jsonl`: import → store → export round-trips byte-identically (after normalised JSON); `deriveRun` on the fixture yields 7 tasks with final statuses matching the fixture's story (one migrated task, one fixed after a failed audit, all merged); replay at speed 100 with FakeClock emits all 252 events in order with scaled timing; recorder plus replayer end to end; the 10k-event write throughput test.""",
oos="Server endpoints (Epic 21). Web reducer (Epic 23). Remote/cloud storage. Migrations beyond a `schema_version` pragma.",
dod=["`bun test packages/store` passes, ≥ 15 tests, including the throughput test."]))

SPECS.append(dict(nn="20", slug="engine", title="Engine state machine", scope="engine",
lane="`packages/engine/**`",
goal="""Implement the orchestration engine, the conductor of the murmuration. It runs ARCHITECTURE §4 exactly: map → plan → dispatch ready tasks to execution nodes → audit → fix loop → merge queue → finish. That includes **Flock behaviour** (scheduling across nodes, rescheduling when a perch disappears). It only ever talks to ports, so all of it is testable with core mocks.""",
deliverables="""- `createEngine(deps: EngineDeps): EngineApi` (EngineApi mirrored from ARCHITECTURE §8 in `src/handshake.ts`). `EngineDeps = { config: StarlingConfig; bus: EventBus; store: Store; clock: Clock; repoMapper: RepoMapper; planner: Planner; prompts: PromptCompiler; workspace: Workspace; registry: NodeRegistry; scheduler: Scheduler; auditor: Auditor; merger: Merger; tracker: Tracker; bundleUrlFor?: BundleUrlFor; writer?: LLM }`.
- **Explicit transition table** (`src/transitions.ts`) over `TaskStatus`. An illegal transition throws in tests and logs an error in production. Every transition emits `task.status` (from/to/run snapshot), and the run is saved via the store.
- The run lifecycle per ARCH §4: `run.created` → `repomap.ready` → `plan.created` (issues included) → `dryRun` stops here as status `planned` → `tracker.syncPlan` → dispatch loop:
  - **Ready** = all `dependsOn` merged. Dispatch up to `maxParallel`, capped by registry capacity.
  - Each dispatch does `scheduler.pick(nodes, task)`, then `node.startTask` with `repo` = `{kind:'local', path}` for local nodes or `{kind:'bundle', ...bundleUrlFor(integrationBranch)}` for remote ones, branch `starling/<runShort>/<taskKey>` from the integration branch, and the prompt from `prompts.worker`.
  - Subscribe to node `onEvent`. Forward each as an `agent.event` StarlingEvent and accumulate usage into `TaskRun.usage` and cost.
  - On `session.idle`: `node.collect` → `auditing` → `auditor.audit` → `audit.verdict` event.
    - pass → `merging` → `merger.merge` → `merge.result` (`merged` → `tracker.onMerged`, `node.cleanup`; `conflict` → `conflict`, Wave 2 adds the resolver; `tests-failed` → treated like an audit failure).
    - fail with attempts < `maxAttempts` → `fixing` → `node.sendPrompt(prompts.fixer(...))`.
    - otherwise → `failed`. Dependents of failed tasks become `cancelled`.
  - **Node loss**: registry `onChange` `left` → every running/fixing/auditing task on that node goes back to `ready` (attempts unchanged), emitting `task.migrated` when it lands on another node.
  - **Budget**: when API cost ≥ `config.budget.maxUsd`, stop dispatching new tasks, let running ones finish, and emit a warn `log`.
  - **Metrics**: recompute `RunMetrics` on every change and publish `metrics` at most once per second, plus a heartbeat every 5 s. `estSavedUsd` via core `estimateSavedUsd`.
  - Finish: when all tasks are terminal → `run.finished` with a summary (from `writer` if given, else a deterministic template) → `tracker.openFinalPR`.
- `cancel` aborts all sessions and marks pending tasks `cancelled`; `abortTask` aborts one. `waitForFinish(runId)` resolves on `run.finished`.
- Tests with **core mocks + FakeClock** (`MockNode`, `MockRegistry`, `MockScheduler`, `MockAuditor`, `MockMerger`, `MockPlanner`, `MemoryStore`, …):
  - The full sky-todo launch-day plan (fixture) runs to completion with merges in dependency order.
  - Audit fail → fix → pass. maxAttempts exhausted → failed → dependents cancelled.
  - Merge conflict → `conflict`. Tests-failed → fix loop.
  - Node death mid-task → migrated → completes on the other node.
  - maxParallel respected at every instant. Budget cap stops dispatch.
  - Dry run. Cancel. The metrics throttle.
  - A **golden test**: the sequence of `task.status` transitions for the happy path is snapshot-tested, so later refactors can't silently change behaviour.""",
oos="Real implementations of any port (siblings are building them). Conflict resolver agent (Wave 2). Server/CLI wiring (Epics 21, 22). Persisting across process restarts beyond what the Store gives.",
dod=["`bun test packages/engine` passes, ≥ 30 tests, all deterministic (run the suite 3× and paste three identical pass counts)."]))
