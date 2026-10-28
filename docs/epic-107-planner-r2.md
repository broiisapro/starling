# Epic 107 — Planner round 2: one renderer, swarm-size plans, plan diffing, lane suggestions

## Goal

Wave 3 plans at swarm scale: 30–60 tasks rather than an advisory ceiling of 12. This epic gives the
planner the pieces a re-plan and a 100-agent murmuration need:

- **one repo-map renderer** — the planner's own renderer is deprecated, `@starling/repomap` is the
  only default, and the prompt is pinned to its exact output;
- **swarm-size plans** — `maxTasks` accepts 2..100 while the default stays 12;
- **lane-size warning** — a lane that owns more than 40 map files gets an actionable warning;
- **`diffPlans` / `formatPlanDiff`** — pure, deterministic comparison of two plans for re-plan
  highlighting (Epic 131) and run comparison (Epic 122);
- **`suggestLanes` / `applyLaneSuggestion`** — cheap, serialisable fixes for every illegal lane
  overlap: serialise, narrow or merge;
- **better messages** — every validator message keeps its first clause and appends a concrete
  `; fix: …` hint, plus `explainIssues` for the CLI.

`PLANNER_SYSTEM_PROMPT` and the doctrine text are untouched: the planner evals (Epic 161) are
calibrated against them.

## How it works

### 1. One renderer

`packages/planner/src/render-map.ts` (`renderRepoMap`, `RenderRepoMapOptions`) and the `'verbose'`
member of `MapRenderer` are marked `@deprecated` with the reason (duplicate of `@starling/repomap`,
losing side of the Epic 48 A/B) and a removal note. Nothing is deleted: L33 forbids removing public
API, and the A/B stays reproducible.

The default path never touches the legacy renderer: `buildPlanPrompt` → `renderMapFor` →
`@starling/repomap`'s `renderRepoMap(map, { maxTokens })`. Tests assert the prompt **ends with
exactly** that output for the default 3,000-token budget, for explicit budgets and for the 200-token
floor. `'verbose'` is reachable only when a caller asks for it by name.

### 2. Swarm-size plans

`PLANNER_MAX_TASKS_LIMIT = 100` is exported from `src/validate.ts` and enforced by
`createPlanner({ maxTasks })`. `DEFAULT_MAX_TASKS` remains 12, so a caller has to opt into a bigger
plan; `validatePlan`'s count warning follows whatever bound the caller passes. A 60-task plan goes
through the full pipeline (prompt → draft → validate → repair → renumber) and comes back with zero
issues and `t01..t60` keys.

The validator's work is quadratic in the number of tasks (every concurrent pair is checked once).
The swarm test asserts the **op count**, not the wall clock: 60 tasks sharing one lane produce
exactly `C(60, 2) = 1,770` `lane-overlap` issues (one per pair, no duplicates), 60 disjoint lanes
produce none, and a 100-task plan at the hard limit validates without a count warning. That is the
same number of pair comparisons the loop performs, independent of machine load.

### 3. Lane-size warning

`ValidatePlanOptions.ownedFilesWarnAt` (default `DEFAULT_OWNED_FILES_WARN_AT = 40`, exported) adds a
`warn` / `'other'` issue when a task's `lane.owns` matches more than that many files in the map:

```
task "t04" owns 57 files in the repo map, above the 40-file advisory limit; fix: split it into
per-capability tasks or narrow its lane
```

The count is the union of all writable globs (a file matched twice counts once). The check only runs
when a map is supplied, and `ownedFiles` / `ownedFileCount` live in `src/lanes.ts` so the diff,
suggestion and future UI code share one definition of "owned files".

### 4. `diffPlans` and `formatPlanDiff`

`src/diff.ts` matches tasks in two passes:

1. by `key` (the stable `tNN-kebab` scheme means re-plans usually keep keys);
2. by normalised title for the rest — `stripTaskNumber`, lower-case, whitespace collapsed — so a
   re-keyed task with the same title is a **rename**, not an add+remove pair.

`PlanDiff` contains `added`, `removed`, `renamed`, `changed`, `unchanged` and a one-line `summary`.
`changed[].fields` is a fixed-order subset of
`'title' | 'lane' | 'dependsOn' | 'definitionOfDone' | 'estimateMin' | 'description'`, plus
`laneAdded` / `laneRemoved` for writable globs. Everything is ordered by the older plan's task order;
task reordering alone is not a change, and `dependsOn` order is compared as a set.

`formatPlanDiff` renders Markdown sections (`Added`, `Removed`, `Renamed`, `Changed`, `Unchanged`)
and says `No task changes.` instead of printing empty sections.

### 5. `suggestLanes` and `applyLaneSuggestion`

`src/suggest.ts` iterates the **same pairs** `validatePlan` reports (`overlappingConcurrentPairs` in
`src/lanes.ts`) and offers, in this order per pair:

- **serialise** — add `second.dependsOn += first` or the reverse, whichever yields the shorter
  critical path in estimated minutes. Adding an edge between two concurrent tasks cannot create a
  cycle, and it removes the overlap from the validator's perspective.
- **narrow** — only with a repo map. Replace a broad glob with the concrete files it still needs,
  leaving the shared files to the other task. The replacement is enumerable and smaller than the
  original, so it cannot create a new overlap; new files that do not exist yet are not covered (the
  rationale says so). Not offered when the whole lane is shared, or when the map has no files to
  enumerate.
- **merge** — when more than half of **both** lanes overlap (file ratio with a map, overlapping glob
  pairs without one) and the merged lane would not newly overlap a third task. The survivor is the
  lexicographically smaller key, fields are unioned (estimates summed), and any task waiting on the
  absorbed task is repointed to the survivor.

Suggestions are **plain JSON patches**, not closures:

```ts
interface LaneSuggestion {
  kind: 'serialise' | 'narrow' | 'merge';
  taskKeys: [string, string];
  rationale: string;
  patch:
    | { kind: 'serialise'; task: string; dependsOn: string }
    | { kind: 'narrow'; task: string; owns: string[] }
    | { kind: 'merge'; keep: string; absorb: string };
}
```

`applyLaneSuggestion(plan, suggestion)` is the only place that mutates a plan (purely — it returns a
new one) and throws `StarlingError('INVALID_ARGUMENT')` for unknown tasks or a kind/patch mismatch.
This shape crosses HTTP, lands in a PR body and can be rendered by the DAG without shipping
functions.

### 6. Messages and `explainIssues`

Every `validatePlan` message keeps its original first clause **byte-identical** and appends
`; fix: <concrete action>`. Examples:

```
task "b" depends on unknown task "ghost"; fix: add a task with key "ghost" or remove it from "b".dependsOn
tasks "a" and "b" can run concurrently but their lanes overlap: src/ui/styles.css <=> src/ui/styles.css; fix: add "a" to b.dependsOn or narrow b's lane (src/ui/styles.css <=> src/ui/styles.css)
plan has 15 tasks, outside the configured bounds (1..12); fix: split the goal into smaller runs or raise maxTasks above 15
```

`explainIssues(issues)` groups by severity then code, prints counts, and keeps plan-level issues
free of empty `[tasks: ]` brackets:

```
2 errors, 1 warning

Errors
  cycle (1)
    - dependency cycle: a -> b -> a; fix: remove "b" from "a".dependsOn, or remove the reverse edge [tasks: a, b]
```

## Key decisions & reasoning

- **Deprecate, don't delete** (L33, and the assignment's explicit instruction for Epic 48's
  deferred item). The legacy renderer is still exercised by `render-map.test.ts`, so its behaviour
  cannot rot silently while it waits for removal.
- **`PLANNER_MAX_TASKS_LIMIT = 100`, default 12.** Raising the *default* would change prompt text
  semantics (the task-count line) and eval baselines; raising only the *ceiling* keeps existing
  behaviour and lets a caller ask for swarm scale. The hard limit stops a model/config typo from
  creating a 10,000-task plan the scheduler can never finish.
- **JSON patches over function-bearing suggestions.** The prompt allowed either. A patch is
  serialisable (dashboard/HTTP/PR body), snapshot-testable and trivially pure; the cost is that
  callers must go through `applyLaneSuggestion`, which is one small exported function.
- **Serialise direction by critical path, not by key order.** The critical path (sum of
  `estimateMin` along the longest dependency chain) is the run's lower bound; picking the shorter
  direction keeps the most plausible parallelism. Ties fall back to lexicographic order for
  determinism.
- **Narrow needs a map.** Without one, the planner cannot enumerate which files a glob covers, and
  guessing could silently drop ownership. The fallback is always serialise (safe) or merge (guarded).
- **Merge is skipped when it would create a new third-party overlap.** Folding two lanes can only
  widen the survivor; the check compares the merged lane against every other task and declines when
  neither half overlapped that task before. Conservative on purpose — a false merge is a merge
  conflict.
- **`description` in `PlanDiffField` covers `goal`, `deliverables` and `outOfScope`.** `TaskSpec`
  has no `description` field; the union member keeps the dashboard vocabulary ("what the task is")
  while the implementation compares the actual contract fields.
- **`laneAdded` / `laneRemoved` are writable globs only.** Reads are free in the validator, so a
  reads-only edit names the `lane` field without pretending a write lane changed.
- **Message hints are appended, never rewritten.** Evals and snapshots match on the first clause;
  `; fix:` is stable enough to parse and human enough to quote.
- **Op-count, not wall-clock, swarm tests** (L38). Machine load from ~100 agents makes timing
  assertions flaky; `C(60,2)` issues is an exact proxy for the pair enumeration.

## Interfaces for future epics

Everything is exported from `@starling/planner` (`src/index.ts`) and is additive.

```ts
// swarm scale
export const PLANNER_MAX_TASKS_LIMIT = 100;
export const DEFAULT_OWNED_FILES_WARN_AT = 40;
export interface ValidatePlanOptions {
  map?: RepoMap; minTasks?: number; maxTasks?: number; ownedFilesWarnAt?: number;
}

// lane helpers (shared by validator, suggestions, and future UI)
export interface LaneOverlap { a: TaskSpec; b: TaskSpec; hits: string[] }
export function overlappingConcurrentPairs(tasks: TaskSpec[]): LaneOverlap[];
export function ownedFiles(task: TaskSpec, map: RepoMap): string[];
export function ownedFileCount(task: TaskSpec, map: RepoMap): number;

// plan diffing
export type PlanDiffField = 'title' | 'lane' | 'dependsOn' | 'definitionOfDone'
                          | 'estimateMin' | 'description';
export interface PlanDiffChange { key: string; fields: PlanDiffField[]; laneAdded: string[]; laneRemoved: string[] }
export interface PlanDiffRename { from: string; to: string }
export interface PlanDiff {
  added: TaskSpec[]; removed: TaskSpec[]; renamed: PlanDiffRename[];
  changed: PlanDiffChange[]; unchanged: string[]; summary: string;
}
export function diffPlans(a: Plan, b: Plan): PlanDiff;
export function formatPlanDiff(diff: PlanDiff): string;
export function normalizeTaskTitle(title: string): string;

// lane suggestions
export type LaneSuggestionKind = 'serialise' | 'narrow' | 'merge';
export type LaneSuggestionPatch =
  | { kind: 'serialise'; task: string; dependsOn: string }
  | { kind: 'narrow'; task: string; owns: string[] }
  | { kind: 'merge'; keep: string; absorb: string };
export interface LaneSuggestion {
  kind: LaneSuggestionKind; taskKeys: [string, string]; rationale: string; patch: LaneSuggestionPatch;
}
export function suggestLanes(plan: Plan, map?: RepoMap): LaneSuggestion[];
export function applyLaneSuggestion(plan: Plan, suggestion: LaneSuggestion): Plan;
export function criticalPathMinutes(tasks: TaskSpec[]): number;

// explanations
export function explainIssues(issues: PlanIssue[]): string;
```

Suggested consumers:

- **Epic 131 (DAG re-plan highlight):** `diffPlans(oldPlan, newPlan)` → colour `changed` keys and
  mark `added`/`removed`; `formatPlanDiff` is ready for a tooltip or drawer.
- **Epic 122 (run comparison):** `diffPlans(runA.plan, runB.plan).summary` plus `changed` fields.
- **Epic 202 (UI):** `suggestLanes` and `applyLaneSuggestion` let a user click "serialise these
  two" without a server round-trip; render with `validatePlan` afterwards.
- **CLI:** `explainIssues(issues)` for the text view; keep `--json` emitting raw issues.

### C3 wiring

**None.** This epic is a self-contained module; no shared registration file is needed.

## Deviations from plan

- **`MapRenderer` is deprecated as a whole alias** rather than one union member (TypeScript has no
  per-member `@deprecated`). The doc comment names `'verbose'` explicitly and points at
  `DEFAULT_MAP_RENDERER`; `'repomap'` remains fully supported.
- **The rename test for `maxTasks` changed intentionally:** the old test asserted `13` throws. It
  now asserts `101` throws and `100` is accepted, matching deliverable 2. Existing snapshots are
  unchanged (system prompt and default prompt text untouched).
- **Lane suggestions return a `patch`, not an `apply` closure.** The brief allowed either; see the
  decision above.
- **Merge skips unsafe third-party collisions.** The brief did not require it, but "every applied
  suggestion re-validates with no new errors" is only true with that guard.
- **The lane-size warning is a `warn` `'other'` issue** because new `PlanIssue` codes are a core
  change (Epic 202).
- **`explainIssues` lives in its own `src/explain.ts`** so the validator stays about validation.

## Carryover from `.orchestrator/fix-requests-w2.md`

| Request | Outcome |
| --- | --- |
| **56 #1** — planner still carries its own renderer | **Done.** `render-map.ts` and the verbose renderer are `@deprecated`; the default prompt embeds exactly `@starling/repomap`'s output and tests pin it. |
| **70 F7** — `maxTasks` ceiling is 12 | **Done.** `PLANNER_MAX_TASKS_LIMIT = 100`; `DEFAULT_MAX_TASKS` stays 12; 60-task plans are tested end to end. |
| **56 open question** — warn above ~40 owned files | **Done.** `ownedFilesWarnAt` (default 40) emits a warn-level `'other'` issue naming the count and suggesting a split. |
| **48 deferred** — deleting `render-map.ts` | **Declined, as instructed.** L33 forbids removal; it is deprecated with a removal note instead. |
| **48 FIX REQUEST** — move opencode service discovery into `@starling/llm` | **Not applicable to this lane** (targets `packages/llm`; Wave 3b). |

## Known limitations / deferred

- **Lane overlap is conservative** (core's `globsOverlap`). `suggestLanes` inherits that: it may
  propose a fix for a pair that a human would call disjoint. A false positive costs one serialised
  task, never a conflict.
- **Narrow expands globs to concrete paths, so it does not cover files that do not exist yet.** A
  task that mostly creates new files should be serialised or merged instead; the rationale mentions
  the explicit paths.
- **Merge sums estimates.** Two 25-minute tasks become a 50-minute task, which the validator warns
  about (> 40). That is honest: one agent doing both really is a bigger task. A future epic could
  split the merged task instead.
- **Serialise ranks by estimated minutes only.** Real per-node throughput, branch width and cache
  warmth are engine concerns; the suggestion is a planning-stage heuristic.
- **`diffPlans` matches duplicate normalised titles greedily, in older-plan order.** Duplicate keys
  are a validator error anyway; identical titles are the only ambiguous case and the pairing is
  deterministic.
- **No UI work.** `apps/web` (Epic 131, 122) and `apps/cli` are outside this lane; the exports above
  are the seam.
- **No new test for the deprecated renderer's deletion.** Its existing tests still pass, which is
  the point of keeping it.
- **No real model calls** (L37). Every test uses fixtures and `MockLLM`; both recorded prompt
  snapshots are byte-identical.
