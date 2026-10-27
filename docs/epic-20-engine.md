# Epic 20 — Engine state machine

## Goal

Be the conductor of the murmuration. One coding goal and a repo go in; the engine maps the repo,
plans a lane-safe DAG, dispatches ready tasks to execution nodes (this laptop or a perch), audits each
result, feeds failures back to the same agent, merges passing work onto the integration branch, and —
when a perch disappears — reschedules its work instead of losing it. Every step is a `StarlingEvent`
on the bus and a row in the store.

The engine implements ARCHITECTURE §4 literally and talks **only** to the ports in `@starling/core`.
That is what makes the whole state machine testable with `@starling/core/testing` doubles and keeps it
independent of the twelve sibling packages being written in parallel.

## How it works

### Run lifecycle

1. `createEngine(deps).start(input)` mints a `Goal` and a `Run` (`status: 'mapping'`), saves them, and
   publishes `run.created`. It resolves immediately; all work continues in the background.
2. `RepoMapper.map` → `repomap.ready` → `planner.plan` (`status: 'planning'` while it thinks) →
   one `pending` `TaskRun` per plan task → `plan.created` with the plan's issues.
3. A **dry run** stops here: `status: 'planned'`, no dispatch, `waitForFinish` resolves with the plan.
   Error-level plan issues (a cycle, overlapping lanes) refuse dispatch and fail the run **after**
   `plan.created` is published, so the dashboard can show what was wrong.
4. `Workspace.ensureIntegrationBranch(repo, base, starling/<runShort>/integration)`, then
   `Tracker.syncPlan` (issue numbers land on the TaskRuns), then `status: 'running'` and the dispatch
   loop.
5. When every task is terminal: `run.finished` with a summary (the optional `writer` model or a
   deterministic template), a final `metrics` event, and `Tracker.openFinalPR` when at least one task
   merged.

### Dispatch

`#pump()` promotes `pending → ready` for tasks whose `dependsOn` all reached `merged`, then dispatches
in plan order while both caps allow:

- **`maxParallel`** (start input, else config) counts tasks in `running | fixing | auditing | merging`.
- **Node capacity** is the sum of free sessions over dispatchable nodes. The engine rewrites each
  `NodeInfo.activeSessions` with its *own* assignment count before handing the list to
  `Scheduler.pick`, because a perch's reported count can lag a heartbeat. A just-filled slot is never
  offered twice.

For the chosen node it builds `StartTaskOptions`: branch `starling/<runShort>/<taskKey>`, `fromRef` =
the integration branch, `repo` = `{kind:'local', path}` on a local node or
`{kind:'bundle', url, token}` from `bundleUrlFor` on a perch, the worker prompt from
`PromptCompiler.worker`, and `config.models.worker`. Remote nodes are skipped (with a one-time warn)
when the hub has no `bundleUrlFor`.

### Task pipeline

Node events are forwarded as `agent.event`; `usage` events accumulate `TaskRun.usage`/`costUsd` and the
run's local-vs-API ledger. `session.idle` starts the per-task chain:

```
collect → auditing → auditor.audit → audit.verdict
        ├─ pass         → merging → merger.merge → merge.result
        │                    merged   → merged,  tracker.onMerged, node.cleanup
        │                    skipped  → merged with a warning (nothing to merge)
        │                    conflict → conflict (Wave 2 adds the resolver)
        │                    tests-failed → fixing (merge evidence as fix instructions)
        └─ fail         → fixing (attempts < maxAttempts) → node.sendPrompt(fixer)
                        → failed (attempts exhausted), dependents cancelled transitively
```

All steps for one task run through a single promise chain, and each dispatch bumps a **generation**
counter. A result that arrives for an abandoned session (node lost, task cancelled) sees the stale
generation and is dropped instead of corrupting the new attempt.

`attempts` is the number of audit verdicts, so the auditor always receives a 1-based `attempt`.
Migration never increments it.

### Flock behaviour

`NodeRegistry.onChange` drives the distributed story:

- **`left`** → publish `node.left`, forbid that node for the run, and put every `running | fixing |
  auditing` task back to `ready` with its attempts untouched. `task.migrated` is published when the
  task actually lands on a different node.
- **`joined` / `stats`** → publish `node.joined` / `node.stats`, clear any local "offline" mark and
  pump, so fresh capacity is used immediately.
- An `NODE_OFFLINE` error from any port takes the same requeue path even if the registry has not
  noticed yet.

### Budget, metrics, cancellation

- **Budget**: once `metrics.apiCostUsd >= config.budget.maxUsd`, no new task is dispatched and a warn
  `log` is emitted once. Running work drains; then undispatched tasks are cancelled so the run can
  reach a terminal state (a run that can never dispatch must not hang forever).
- **Metrics**: recomputed on every transition/usage event, published at most once per second, plus a
  5 s heartbeat. `estSavedUsd` comes from core's `estimateSavedUsd`.
- **Cancel** bumps every generation, aborts every session, cancels all unfinished tasks and finishes
  the run as `cancelled` (no final PR). **abortTask** does the same for one task.
- Transitions go through `src/transitions.ts`. In strict mode (tests, or `strictTransitions: true`) an
  illegal edge throws `StarlingError('INVALID_ARGUMENT')`; in production it publishes an error `log`
  and is ignored so one bad edge cannot kill the flock.

## Key decisions & reasoning

- **A `RunDriver` per run, with the engine as a thin registry.** `EngineApi` is process-wide
  (`getRun`, `listRuns`, `waitForFinish`), so per-run state must be isolated. Two concurrent runs in
  one engine share only the bus, store and registry; node events are filtered by `runId` and every run
  has its own ledger, chains and metric publisher.
- **Engine-authoritative session counts.** Trusting `NodeInfo.activeSessions` would over-subscribe a
  node for one heartbeat after each dispatch. `dispatchableNodes()` clones the registry snapshot and
  substitutes the engine's own count, leaving the registry untouched. `MockScheduler` then behaves
  exactly like the real capacity scheduler in tests.
- **Generation counters instead of abort flags.** A dead perch can deliver a late `session.idle`, and
  `collect()` can resolve after its task has already been rescheduled. A monotonically increasing
  generation per live task is the smallest mechanism that makes every in-flight step a no-op once the
  session it belongs to is gone.
- **The task chain is per task, not per run.** Tasks are independent; serialising them only within a
  task (start → audit → merge → fix → audit) preserves in-session fix continuity without coupling
  lanes. `sendPrompt`'s idle event is queued behind the current step, so the fix loop cannot deadlock.
- **`attempts` counts verdicts, not dispatches.** The auditor's `attempt` is `attempts + 1`; a
  migration keeps the count, which is why a perch death cannot burn the retry budget. The same counter
  gates `tests-failed`, so a task gets `maxAttempts` total chances across audit and merge failures.
- **Merge failures reuse the fixer.** `PromptCompiler.resolver` is Wave 2; for a `tests-failed` merge
  the engine synthesises an `AuditVerdict` whose fix instructions quote the merger's detail and sends
  the normal fixer prompt. The agent stays in the same session, which is where the context is.
- **`conflict` is terminal in Wave 1.** The spec says dependents of a failed task are cancelled; a
  conflicted task can never merge either, so its dependents are cancelled the same way. Wave 2 inserts
  the resolver between `conflict` and `fixing`.
- **Budget drains, then cancels the tail.** Strictly "let running tasks finish" would leave the run
  non-terminal forever. Cancelling the undispatched remainder (with a warn log) is the only way the
  CLI's `waitForFinish` and the dashboard can conclude. Documented as a deviation below.
- **Metrics are throttled in the publisher, not the caller.** Every state change calls `touch()`
  (cheap recompute); only the publisher knows about the 1 s window and the dirty flag. Timers are
  injectable (`timers`) so the 5 s heartbeat is testable without waiting.
- **Local vs API by provider config.** A usage event is priced with the model announced at
  `session.started` (falling back to the worker model). A provider counts as local when it is
  `ollama`/`local` or its config has no `apiKeyEnv` — that covers Ollama, llama.cpp, LM Studio and a
  lent perch model without naming them all.
- **Error-level plan issues fail loudly before any dispatch.** An overlapping or cyclic plan would
  either collide or hang; the planner's auto-repair is upstream, so the engine's job is to refuse the
  unsound result after showing it.
- **Dry run resolves `waitForFinish` without `run.finished`.** `planned` is a settled status for the
  CLI, but nothing ran, so emitting `run.finished` would make replay/dashboards claim a run happened.
- **A scheduler that answers with an unlisted node fails that task.** Silently looping (or hanging)
  on a broken invariant is worse; the error log names the node.

## Interfaces for future epics

### Exported signatures (`@starling/engine`)

```ts
// engine.ts — the public entry point
export function createEngine(deps: EngineDeps): EngineApi;

// handshake.ts — MIRROR of ARCHITECTURE §8 (moves into @starling/core at checkpoint C1)
export interface StartRunInput {
  goal: string; repoPath: string; dryRun?: boolean; maxParallel?: number; baseBranch?: string;
}
export interface EngineApi {
  start(input: StartRunInput): Promise<{ runId: string }>;
  cancel(runId: string): Promise<void>;
  abortTask(runId: string, taskKey: string): Promise<void>;
  getRun(runId: string): Run | undefined;
  listRuns(): Run[];
  waitForFinish(runId: string): Promise<Run>;
}
export type BundleUrlFor = (ref: string) => { url: string; token: string };

// types.ts
export interface EngineDeps {
  config: StarlingConfig; bus: EventBus; store: Store; clock: Clock;
  repoMapper: RepoMapper; planner: Planner; prompts: PromptCompiler; workspace: Workspace;
  registry: NodeRegistry; scheduler: Scheduler; auditor: Auditor; merger: Merger; tracker: Tracker;
  bundleUrlFor?: BundleUrlFor; writer?: LLM;
  strictTransitions?: boolean;   // additive: default process.env.NODE_ENV === 'test'
  timers?: Timers;               // additive: metrics heartbeat (default real, unref'd)
}

// run-driver.ts
export class RunDriver implements PipelineHost { readonly runId: string; readonly done: Promise<Run>; /* … */ }
export function isRunSettled(status: RunStatus): boolean;

// transitions.ts
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]>;
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[];
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[];
export function isTerminalStatus(status: TaskStatus): boolean;
export function isActiveStatus(status: TaskStatus): boolean;
export function allowedTransitions(from: TaskStatus): readonly TaskStatus[];
export function isTaskTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean;
export function assertTaskTransition(
  from: TaskStatus, to: TaskStatus, opts?: { strict?: boolean; taskKey?: string },
): boolean;

// state.ts — pure run/task helpers used by the engine and available to the server
export function createTaskRuns(runId: string, plan: Plan): Record<string, TaskRun>;
export function dependenciesMerged(spec: TaskSpec, tasks: Record<string, TaskRun>): boolean;
export function promotableTaskKeys(run: Run): string[];
export function readyTaskKeys(run: Run): string[];
export function activeCount(run: Run): number;
export function activeByNode(run: Run): Record<string, number>;
export function countStatus(run: Run, status: TaskStatus): number;
export function allTasksTerminal(run: Run): boolean;
export function dependentsToCancel(run: Run, rootKey: string): string[];
export function unfinishedTaskKeys(run: Run): string[];

// nodes.ts
export function dispatchableNodes(
  nodes: NodeInfo[], activeByNode: Record<string, number>, excluded?: ReadonlySet<string>,
): NodeInfo[];
export function availableSlots(nodes: NodeInfo[], activeByNode: Record<string, number>): number;

// metrics.ts
export interface UsageLedger { api: TokenUsage; local: TokenUsage; localCalls: number; apiCostUsd: number }
export function emptyLedger(): UsageLedger;
export function recordCall(ledger: UsageLedger, call: RecordedCall): UsageLedger;
export function computeRunMetrics(run: Run, ledger: UsageLedger, now: number): RunMetrics;
export interface Timers { setInterval(fn: () => void, ms: number): unknown; clearInterval(handle: unknown): void }
export const systemTimers: Timers;
export class MetricsPublisher {
  constructor(options: MetricsPublisherOptions);
  start(): void; touch(): void; publishNow(): void; stop(): void;
  readonly published: number; readonly dirty: boolean;
}

// summary.ts
export function formatDuration(ms: number): string;
export function renderRunSummary(run: Run, options?: { reason?: string }): string;
export function writerPrompt(run: Run): string;

// agent-event.ts
export function parseUsage(data: Record<string, unknown>): TokenUsage | undefined;
export function parseModel(value: unknown): ModelRef | undefined;
export function isLocalProvider(config: StarlingConfig, provider: string): boolean;
export function pricingKey(model: ModelRef): string;
```

### Usage from the server (Epic 21) or CLI (Epic 22)

```ts
import { createEventBus, loadConfig, systemClock } from '@starling/core';
import { createEngine, type EngineDeps } from '@starling/engine';

const deps: EngineDeps = {
  config: loadConfig(),
  bus: createEventBus(),
  store, clock: systemClock, repoMapper, planner, prompts, workspace,
  registry, scheduler, auditor, merger, tracker,
  bundleUrlFor: (ref) => ({ url: `${hubUrl}/api/flock/bundle?ref=${encodeURIComponent(ref)}`, token: joinCode }),
};

const engine = createEngine(deps);
deps.bus.subscribe((event) => sse.send(event));   // the server's live stream
const { runId } = await engine.start({ goal, repoPath, maxParallel: 6 });
const run = await engine.waitForFinish(runId);   // `starling run`
if (run.status !== 'finished') process.exitCode = 1;
```

Tests never construct real ports:

```ts
import { FakeClock, createEventBus } from '@starling/core';
import { MemoryStore, MockAuditor, MockMerger, MockNode, MockPlanner, MockPromptCompiler,
         MockRegistry, MockRepoMapper, MockScheduler, MockWorkspace, NoopTracker } from '@starling/core/testing';
import { createEngine } from '@starling/engine';

const engine = createEngine({ /* one mock per port, strictTransitions: true */ });
```

## Deviations from plan

- **Two additive `EngineDeps` fields.** `strictTransitions?: boolean` and `timers?: Timers` are not in
  the Wave 1 deliverable list. They make "throw in tests, log in production" and the 5 s heartbeat
  deterministic without reading `NODE_ENV` inside the transition table or sleeping in tests.
- **Budget exhaustion cancels the undispatched tail.** The prompt says "let running ones finish";
  leaving queued tasks forever would make the run non-terminal. Drain-then-cancel is the smallest
  change that keeps the contract's `run.finished` promise.
- **A dry run does not emit `run.finished`.** It resolves `waitForFinish` as `planned` instead.
- **`Tracker.openTaskPR` is not called.** The engine's flow only needs `syncPlan`, `onMerged` and
  `openFinalPR`; per-task PR bodies depend on the worker handback parser (Epic 13) and GitHub mode.
  Left for the GitHub epic.
- **`merging → fixing` on `tests-failed` uses a synthesised `AuditVerdict`.** `PromptCompiler.fixer`
  only accepts a verdict, and inventing one with the merger's evidence keeps the interface unchanged.
- **`RunDriver` is the one large file (~830 lines).** All pure logic was extracted (`state`, `nodes`,
  `metrics`, `summary`, `transitions`, `agent-event`) and the task pipeline lives in `pipeline.ts`.
  The remaining class is the state machine itself; splitting its fields across classes would invite
  exactly the desync this epic is meant to prevent.
- **No `@starling/*` sibling imports.** The handshake mirror plus core's ports is the whole surface.

## Known limitations / deferred

- **No conflict resolver.** `conflict` is terminal; the resolver agent (Wave 2) plugs in at
  `merging → conflict → fixing`.
- **Offline-by-heartbeat without `left` does not requeue.** The engine reacts to the registry's `left`
  event and to `NODE_OFFLINE` errors; a node that merely reports `status: 'offline'` in `stats` is
  excluded from dispatch but its running task is only rescheduled when the registry removes it. That
  timeout belongs to the flock/perch epic.
- **No recovery after a process restart.** Runs live in the driver; the store has the history and the
  event log, but resuming a half-finished run is out of scope (the prompt says so explicitly).
- **No retry/backoff around port failures.** An auditor error fails the task; a merger error fails the
  task; only `NODE_OFFLINE` retries (by migrating). Rate limiting and provider backoff belong to the
  runner/LLM epics.
- **`Worktree` paths are never set by the engine.** Local nodes create their own worktree and report
  the diff through `collect`; the engine would only duplicate that knowledge.
- **No per-task GitHub PRs** (see deviations) and **no `openTaskPR` body compilation**.
- **A plan with duplicate task keys is not rejected.** `Plan` validation is the planner/validator's
  job; the engine would silently keep the last `TaskRun`.
- **`agentsActive` counts `auditing` and `merging`.** They hold a session slot on the hub but not on a
  perch; the difference is invisible in `RunMetrics` by design (one number for the dashboard).
- **Metrics throttling uses wall-clock ms from the injected clock.** With a FakeClock frozen at a
  single instant, only the first and final metrics are published; tests that need more advance it.
