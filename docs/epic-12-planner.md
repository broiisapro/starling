# Epic 12 — Planner: goal → lane-safe task DAG

## Goal

Turn one goal sentence plus a `RepoMap` into a `Plan` whose tasks a flock of agents can execute in
parallel git worktrees **without ever touching the same files**. The LLM proposes the decomposition;
deterministic code verifies it, asks the model to fix errors a bounded number of times, and then
repairs whatever is left with rules that always terminate. `plan()` never returns a plan with
error-level issues, so the engine can start work without a human reading the DAG first.

Lane: `packages/planner/**`. Depends only on `@starling/core` and its mocks (per Wave 1 rules).

## How it works

### The pipeline

1. **Prompt** (`src/prompt.ts`, `src/render-map.ts`) — `buildPlanPrompt(goal, map)` returns
   `{ system, user }`. The system prompt is Starling's planning doctrine; the user message carries
   the goal, its constraints, the test command and a compact text rendering of the repo map.
2. **Draft** (`src/draft.ts`) — one `llm.completeJson(req, PlanDraftSchema)` call with role
   `planner`. The draft is deliberately narrower than `Plan`: summary, `lockedDecisions`, tasks.
   Starling mints `id`, attaches `goalId`, records the model that actually answered and stamps the
   clock (`src/planner.ts#planFromDraft`). Keys and globs are normalised on the way in so branch
   names and worktree paths stay safe.
3. **Validate** (`src/validate.ts`) — `validatePlan(plan, { map?, minTasks?, maxTasks? })` returns
   `PlanIssue[]`. Deterministic, pure, ordered.
4. **Repair loop** — while `validate()` reports errors and repairs remain, the model is asked again
   with the original request, the rejected draft as the assistant turn, and the numbered errors as
   the next user turn.
5. **Deterministic repair** (`src/repair.ts`) — whatever errors survive are fixed by rules, not by
   hoping. Every fix is reported as a `warn` `PlanIssue`.
6. **Guarantee** — `plan()` re-validates the repaired plan, throws `PLAN_INVALID` if any error
   somehow remains (defensive, unreachable by design) or if zero executable tasks survived, and
   returns `{ plan, issues }` where `issues` contains only warnings: repair notices plus remaining
   validator warnings.

### Validator rules

| Severity | Code           | Rule                                                                                                                                                                                 |
| -------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| error    | `cycle`        | dependency cycle; message contains the path (`a -> b -> a`)                                                                                                                          |
| error    | `missing-dep`  | `dependsOn` names a key that does not exist                                                                                                                                          |
| error    | `other`        | duplicate task keys, empty task key                                                                                                                                                  |
| error    | `empty-dod`    | `definitionOfDone` is empty or blank-only                                                                                                                                            |
| error    | `empty-lane`   | `lane.owns` is empty or blank-only                                                                                                                                                   |
| error    | `lane-overlap` | two tasks that can run concurrently (neither is an ancestor) have overlapping `owns`                                                                                                 |
| warn     | `other`        | task count outside `minTasks..maxTasks`, estimate > 40, non-positive estimate, an `owns` glob that matches no file and is not a plausible new-file location, a DoD with no test step |

Ancestry is transitive through `dependsOn` (`src/graph.ts`), so `a → b → c` allows `a` and `c` to
share a file. Only tasks that can actually run at the same time must be disjoint.

"Plausible new-file location" (`globCanNameNewFile`) means: the glob matches an existing file, or it
names a new file in the repo root / in an existing directory / in a brand-new directory directly
under an existing one. Feature folders being born is the normal case, so the warning is biased
towards silence.

### Deterministic repair (in order)

1. Drop tasks with an empty key; keep the first of any duplicate key.
2. Drop tasks with no writable lane or no DoD — they could never be audited or verified. Inventing
   a lane or a DoD would be lying to the auditor.
3. Drop `dependsOn` entries that name no surviving task.
4. Break each cycle by dropping its **newest edge**: the edge whose source task appears latest in
   the plan's task array, tie-broken by target index. The oldest, load-bearing edges survive.
5. For each remaining pair of concurrent tasks with overlapping lanes, add `later.dependsOn.push(earlier)`
   where "later" is the lexicographically greater key. Repeat until no overlapping concurrent pair
   remains. Adding that edge cannot create a cycle because the pair was concurrent.

Each step appends a warn-level notice (`cycle`, `missing-dep`, `lane-overlap` or `other`) so the
engine and dashboard can see what was fixed instead of silently losing work.

### Files

| file                   | contents                                                   |
| ---------------------- | ---------------------------------------------------------- |
| `src/index.ts`         | public surface                                             |
| `src/draft.ts`         | `PlanDraftSchema` (LLM-facing shape)                       |
| `src/prompt.ts`        | system doctrine, user prompt, repair request/messages      |
| `src/render-map.ts`    | compact deterministic repo-map renderer                    |
| `src/graph.ts`         | dependency graph, cycles, ancestry, concurrency            |
| `src/validate.ts`      | `validatePlan`, glob plausibility, issue helpers           |
| `src/repair.ts`        | `repairPlan`                                               |
| `src/planner.ts`       | `createPlanner`, `planFromDraft`                           |
| `src/test-fixtures.ts` | test-only fixture loaders and task/plan builders           |
| `src/*.test.ts`        | 72 tests, including 200 fuzz plans and a DAG property test |

## Key decisions & reasoning

- **The model only supplies judgement; Starling supplies identity and trust.** Ids, `goalId`,
  `model` and `createdAt` are set from Starling's own state, not from the model's JSON. That keeps
  `Plan.id` sortable (ULID), lets the UI attribute cost correctly, and makes it impossible for a
  model to claim it was a different model.
- **Lane safety is structural, not prose.** `lane.owns` globs are validated with core's
  `globsOverlap`, which is deliberately conservative: a false positive costs one serialised task, a
  false negative costs a merge conflict. The engine trusts this check, so it must never be softened
  to make a plan look parallel.
- **Ancestor pairs may overlap.** The DAG already serialises them. Blanket "all lanes disjoint"
  would forbid the most natural decomposition (fix a helper, then build on it).
- **Repair order is deliberate.** Duplicates and unauditable tasks go first so later steps operate
  on a sane task set; dangling deps go before cycles so a missing key cannot masquerade as a cycle;
  cycles go before overlap serialisation so ancestor checks are meaningful; adding edges last cannot
  reintroduce cycles.
- **"Newest edge" = latest in the task array.** The model emits tasks in dependency-ish order, so
  the later task is usually the one that introduced a contentious back-edge. This is a heuristic,
  but a deterministic and explainable one, and the alternative (drop an arbitrary cycle edge) is
  worse for reviewability.
- **Serialise by key, not by array order.** Keys are stable across model retries; array order is
  not. `beta` waits for `alpha` consistently even if the model reorders tasks.
- **Warnings don't block.** Estimates, task count and glob existence are advice: a 45-minute task
  or a new top-level `docs/` file can still be the right call. Errors are invariants. Returning
  warnings (rather than throwing) lets the engine put them on `plan.created` and show them in the
  dashboard.
- **Un-auditable tasks are dropped, not patched.** Filling in an invented DoD would make the
  auditor verify something the planner never meant. If every task is dropped, `plan()` fails with
  `PLAN_INVALID` instead of starting an empty run.
- **Normalisation happens once, at the boundary.** `CSV Export!!` becomes `csv-export` and
  `./src/features/X/` becomes `src/features/X`; dependency references are normalised the same way.
  This keeps branch names (`starling/<run>/<key>`) and glob checks predictable. Collisions created
  by normalisation are caught as duplicate keys and repaired.
- **`validate(plan)` uses the last repo map.** The frozen `Planner` port only passes a plan, but
  glob-existence warnings need a map. `createPlanner` closes over the map from the most recent
  `plan()` call; `validatePlan(plan, { map })` is the explicit form for the engine and evals.
- **No `src/handshake.ts`.** The only interfaces the planner touches are `LLM`, `Clock`, `Planner`,
  `Plan`, `TaskSpec`, `RepoMap` and `PlanIssue` — all already in `@starling/core`. None of the
  ARCHITECTURE §8 mirrors apply, so adding one would have been dead code.

## Interfaces for future epics

Everything below is exported from `@starling/planner` (`./src/index.ts`).

```ts
import type { Clock, Goal, LLM, Plan, PlanIssue, RepoMap, Planner, ModelRef } from '@starling/core';

export const PACKAGE: '@starling/planner';
export const DEFAULT_MIN_TASKS = 2;
export const DEFAULT_MAX_TASKS = 12;
export const MAX_ESTIMATE_MIN = 40;
export const PLANNER_SYSTEM_PROMPT: string;

export interface CreatePlannerOptions {
  llm: LLM;
  clock?: Clock;          // default systemClock
  maxRepairs?: number;    // default 2
  minTasks?: number;      // default 2, >= 1
  maxTasks?: number;      // default 12, must be 2..12
  maxTokens?: number;     // default 8192
  temperature?: number;   // default 0.2
}

export function createPlanner(options: CreatePlannerOptions): Planner;
// Planner from core:
//   plan(goal: Goal, map: RepoMap): Promise<{ plan: Plan; issues: PlanIssue[] }>
//   validate(plan: Plan): PlanIssue[]

export function planFromDraft(
  draft: PlanDraft,
  goal: Goal,
  model: ModelRef,
  createdAt: number,
): Plan;

export interface PlanDraft { summary: string; lockedDecisions: string[]; tasks: TaskSpec[] }
export const PlanDraftSchema: ZodType<PlanDraft>;

export interface ValidatePlanOptions { map?: RepoMap; minTasks?: number; maxTasks?: number }
export function validatePlan(plan: Plan, options?: ValidatePlanOptions): PlanIssue[];
export function globCanNameNewFile(glob: string, map: RepoMap): boolean;
export function hasErrors(issues: PlanIssue[]): boolean;
export function warningsOf(issues: PlanIssue[]): PlanIssue[];

export interface RepairOutcome { plan: Plan; notices: PlanIssue[] }
export function repairPlan(plan: Plan): RepairOutcome;

export interface PlanPrompt { system: string; user: string }
export interface PlanPromptOptions { minTasks?: number; maxTasks?: number }
export function buildPlanPrompt(goal: Goal, map: RepoMap, options?: PlanPromptOptions): PlanPrompt;
export function buildRepairRequest(errors: PlanIssue[]): string;
export function buildRepairMessages(
  prompt: PlanPrompt,
  previous: PlanDraft,
  errors: PlanIssue[],
): { role: 'user' | 'assistant'; content: string }[];

export interface RenderRepoMapOptions {
  maxFiles?: number; maxSymbols?: number; summaryChars?: number; maxTreeLines?: number;
}
export function renderRepoMap(map: RepoMap, options?: RenderRepoMapOptions): string;

// graph helpers (exported for the engine, evals and the dashboard)
export function buildDepGraph(tasks: TaskSpec[]): Map<string, string[]>;
export function findCycles(graph: Map<string, string[]>): string[][];
export function formatCycle(cycle: string[]): string;
export function isAncestor(graph: Map<string, string[]>, ancestor: string, descendant: string): boolean;
export function canRunConcurrently(graph: Map<string, string[]>, a: string, b: string): boolean;
```

### Engine usage (Epic 20)

```ts
import { createPlanner } from '@starling/planner';
import type { Run } from '@starling/core';

const planner = createPlanner({ llm, clock });

const { plan, issues } = await planner.plan(goal, map);
// issues is warnings-only. Surface it on plan.created — repair notices are how the dashboard
// explains tasks that were serialised or dropped:
// bus.publish({ type: 'plan.created', runId, ts: clock.now(), payload: { plan, issues } });

const tasks = plan.tasks; // safe to schedule: zero error-level issues
```

`PlanIssue.taskKeys` always names the tasks involved (`[]` for plan-level notices). Warnings with
`code: 'lane-overlap'` or `'cycle'` are _repair notices_: the returned plan no longer has those
problems.

## How the prompt steers the launch-day decomposition

`examples/sky-todo/demo-goals/launch-day.expected.md` is the sanity target; the recorded plan
`fixtures/plans/sky-todo-launch-day.json` is the same decomposition. Feeding that fixture through
the validator against `fixtures/repomaps/sky-todo.json` yields **no issues** (test:
`validatePlan` › "the recorded sky-todo plan is clean").

The prompt rules map onto that result:

- Goal lists seven distinct outcomes → rule 1 (5–25 min tasks) + rule 13 (own only folders you
  extend) produce seven tasks of 10–15 minutes rather than three vague epics.
- The repo map shows `src/features/{theme,search,export,shortcuts,due-dates}/` and shared
  `src/ui/styles.css`, `src/lib/dates.ts` → rule 5 (prefer new files in feature folders) turns each
  feature into its own folder; rule 6 keeps `src/main.ts`, `render.ts` and `store/todos.ts` read-only
  for everybody.
- `help-overlay` needs the shortcut dispatch that `shortcuts` registers → rule 4 says add a
  `dependsOn` edge instead of both tasks editing the command registry. `due-badges` does the same
  for `dates-fix`. Everything else stays concurrent.
- Rule 4's "concurrent ⇒ disjoint owns" is exactly what the validator enforces, so the fixture's
  five independent feature folders + two DAG-ordered tasks pass with zero lane overlaps.
- Rule 8 (literal DoD including the test command) yields the fixture's "bun test passes + specific
  behaviour" items; the validator's no-test-step warning nudges any model that forgets.
- Rule 10 derives `lockedDecisions` from the map: vanilla TypeScript + Vite, tests beside sources
  with `bun test`, feature folders own their code, `localStorage` persistence — facts every worker
  prompt will restate.

## Deviations from plan

- **No `src/handshake.ts`** — no ARCHITECTURE §8 interface applies (reason above).
- **Extra deterministic repairs:** duplicate keys and un-auditable tasks (empty lane / empty DoD)
  are dropped with notices. The assignment said "never contains error-level issues" without saying
  how to fix these two, and dropping is the only honest option.
- **Extra warnings:** DoD without a test step, non-positive estimate, empty task key. They do not
  block and keep the plan reviewable.
- **`validate(plan)` closes over the last repo map**; the map-aware pure function is exported as
  `validatePlan`. This avoids a contract change while still warning about dead globs.
- **The fuzz test drives `plan()` end-to-end** (200 seeded plans, `maxRepairs: 0`) rather than only
  `repairPlan`, which is a stronger version of the required guarantee. A separate property test
  checks that validator lane-overlap reports exactly the concurrent overlapping pairs over 50
  generated DAGs.
- **`picomatch` stays in `package.json`** because Epic 00 pre-installed it for this package; the
  planner itself uses core's glob helpers. `zod` was added (4.6.7) because `PlanDraftSchema` lives
  here.
- **Test-only fixture loader** lives in `src/test-fixtures.ts` and is not re-exported from the
  package root.

## Known limitations / deferred

- **Glob overlap is conservative.** Patterns with `**` can be reported as overlapping when they are
  not, which serialises one extra task. Braces and extglobs are unsupported (core's contract).
- **Structure only.** The validator cannot tell that a task is badly scoped or that a DoD is
  semantically weak; that is the auditor's and the eval harness's job (Epic 29).
- **Repair is lossy by design.** If a model returns many tasks with no lane or no DoD, they are
  dropped. The run continues; a plan with nothing left fails with `PLAN_INVALID`.
- **No usage/cost accounting in the result.** `LLMResponse.usage`/`costUsd` are owned by Epic 10's
  router and the engine's metrics; the `Planner` port has nowhere to return them.
- **No events.** The planner does not publish `plan.created`; the engine owns the EventBus. It does
  return every warning the engine needs in that payload.
- **Prompt unverified against live models** (L23 forbids real calls in build waves). The text is
  snapshot-tested and reviewed; mood/tuning is Epic 28/29 work.
- **Task cap of 12.** Larger goals should be split into multiple runs; the cap keeps a single
  murmuration schedulable and the prompt small.
- **Renderer duplication.** `renderRepoMap` overlaps with Epic 11's repomap renderer; C1 picks the
  survivor and deletes the other mirror.
- **No `minTasks`/`maxTasks` enforcement as errors.** Out-of-bounds counts are warnings, following
  the assignment; the engine can still dispatch a six-task plan with `maxTasks: 4`.
