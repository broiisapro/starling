## Epic 107 Handback — Planner round 2: one renderer, swarm-size plans, plan diffing, lane suggestions

**Status:** Complete. Branch `epic/107-planner-r2` @ `deef183`.

**Delivered:**

- `packages/planner/src/render-map.ts` — `renderRepoMap`, `RenderRepoMapOptions` and the `'verbose'` member of `MapRenderer` are `@deprecated` (JSDoc reason + removal note); nothing deleted (L33). `src/prompt.ts` documents the deprecated branch on `PlanPromptOptions.mapRenderer` and `CreatePlannerOptions.mapRenderer`. Four new prompt tests pin that `buildPlanPrompt` embeds exactly `@starling/repomap`'s `renderRepoMap(map, { maxTokens })` for the default 3,000 budget, explicit budgets and the 200-token floor, and that the verbose text appears only on request.
- `packages/planner/src/planner.ts` + `src/validate.ts` — `PLANNER_MAX_TASKS_LIMIT = 100` exported; `createPlanner({ maxTasks })` accepts 2..100 (default `DEFAULT_MAX_TASKS` stays 12). The old `maxTasks: 13` rejection test was updated to 101/100. 60-task plans run through the full `plan()` pipeline with zero issues and `t01..t60` keys.
- `packages/planner/src/validate.ts` — lane-size advisory: `ownedFilesWarnAt` (default `DEFAULT_OWNED_FILES_WARN_AT = 40`) emits a warn `'other'` issue naming the exact count and suggesting a split; union-of-globs counting, map-only, overridable threshold.
- `packages/planner/src/lanes.ts` — `overlappingConcurrentPairs` (the single implementation of the validator's lane-overlap pair detection), `ownedFiles`, `ownedFileCount`, `LaneOverlap`.
- `packages/planner/src/diff.ts` — `diffPlans`, `formatPlanDiff`, `normalizeTaskTitle`; `PlanDiff` / `PlanDiffChange` / `PlanDiffRename` / `PlanDiffField` per the brief. Key-first then normalised-title matching, deterministic a-order, reorder-only is a no-op, `dependsOn` compared as a set.
- `packages/planner/src/suggest.ts` — `suggestLanes`, `applyLaneSuggestion`, `criticalPathMinutes`, `LaneSuggestion` and the three JSON patches (`serialise`, `narrow`, `merge`). Serialise picks the shorter critical path; narrow enumerates surviving map files for a broad glob; merge requires >50% of both lanes and is skipped if the merged lane would newly overlap a third task.
- `packages/planner/src/explain.ts` — `explainIssues(issues)` grouped by severity then code, with counts and `[tasks: …]` only when non-empty.
- Every `validatePlan` message keeps its existing first clause byte-identical and appends `; fix: <concrete action>`.
- `src/index.ts` exports all of the above (additive only).
- `docs/epic-107-planner-r2.md` written with the AGENTS §6 sections plus the carryover table.

**New tests:** 44 new tests across `diff.test.ts` (19), `suggest.test.ts` (16), `explain.test.ts` (9), and additions to `validate.test.ts` (14), `prompt.test.ts` (4) and `planner.test.ts` (2). Planner suite: 113 → 157 tests.

**Key design decisions:**

- **Plain JSON patches for lane suggestions, not `apply` closures.** The brief allowed either. Patches survive HTTP/PR bodies, are snapshot-friendly and keep `applyLaneSuggestion` as the single mutation point. Cost: one extra exported function.
- **Serialise direction by critical path in minutes**, ties broken lexicographically. Keeps the shortest lower bound on run duration; estimate minutes are the only cost signal the planner owns.
- **Narrow requires a repo map and expands to concrete files.** Without a map the planner cannot enumerate; guessing would silently drop ownership. New (not-yet-existing) files are not covered — the rationale says so.
- **Merge guard against new third-party overlaps.** Folding two lanes can only widen the survivor; the check declines a merge when neither half overlapped a third task before. This is what makes "every applied suggestion re-validates with no new errors" true.
- **`PlanDiffField = 'description'` maps to `goal` + `deliverables` + `outOfScope`** because `TaskSpec` has no `description`; the union member keeps the dashboard vocabulary.
- **`laneAdded` / `laneRemoved` are writable globs only**; reads-only edits surface as the `lane` field (reads are free in the validator).
- **Raise the ceiling, not the default.** `DEFAULT_MAX_TASKS` staying 12 keeps existing prompt/eval behaviour; `PLANNER_MAX_TASKS_LIMIT` stops a typo from producing an unschedulable plan.
- **Swarm performance is asserted as op counts.** 60 shared-lane tasks must yield exactly `C(60,2) = 1,770` lane-overlap issues (one per pair), 60 disjoint lanes zero. No wall-clock assertions (L38).
- **Deprecate, do not delete** the verbose renderer (L33 + the assignment's explicit instruction for 48's deferred item); its existing tests keep it honest.

**Verification (exact commands + results):**

- `bun install` — `Checked 172 installs across 225 packages (no changes)`; `bun.lock` untouched.
- `bun test packages/planner` — **157 pass / 0 fail**, 2 snapshots (both unchanged), 895 expect calls, 13 files.
- `bunx tsc --noEmit -p packages/planner` — clean (no output).
- `bunx biome check packages/planner/src` — `Checked 28 files … No fixes applied`.
- `bash .orchestrator/bin/heavy.sh bun run test` (repo root):
  - packages/apps/server/apps/cli/skills/integrations/tools/evals: **2007 pass, 4 skip, 0 fail** — `Ran 2011 tests across 226 files. [50.82s]`
  - apps/web: **581 pass, 0 fail** — `Ran 581 tests across 60 files. [4.48s]`
- `bash .orchestrator/bin/heavy.sh bun run check` — clean: `Checked 983 files in 353ms. No fixes applied.` + per-package `tsc --noEmit` loop with no errors.
- **DoD 4 — `formatPlanDiff(diffPlans(a, b))`** for `fixtures/plans/sky-todo-launch-day.json` vs a hand-edited copy (one task renamed `search` → `live-search`, one lane widened with `src/ui/render.ts`, one task added `bulk-complete`):

```markdown
# Plan diff

**Summary:** 1 added, 0 removed, 1 renamed, 1 changed, 5 unchanged

## Added (1)
- `bulk-complete` — Bulk complete

## Renamed (1)
- `search` -> `live-search`

## Changed (1)
- `theme`: lane (lane +src/ui/render.ts)

## Unchanged (5)
- `csv-export`, `shortcuts`, `due-badges`, `dates-fix`, `help-overlay`
```

**Dependencies added:** none.

**CONTRACT REQUESTS:** none.

**Carryover done:**

- **56 #1 (planner carries its own renderer)** — done: verbose renderer deprecated, default path pinned to `@starling/repomap` and covered by four tests.
- **70 F7 (`maxTasks` capped at 12)** — done: ceiling raised to `PLANNER_MAX_TASKS_LIMIT = 100`, default unchanged, 60-task plan tested end to end.
- **56 open question (>40 owned files)** — done: `ownedFilesWarnAt` default 40, warn-level `'other'` issue with the count and a split suggestion.
- **48 deferred (delete `render-map.ts`)** — declined as instructed under L33; deprecated with a removal note instead.
- **48 FIX REQUEST (move opencode discovery into `@starling/llm`)** — not in this lane (targets `packages/llm`, Wave 3b); untouched.

**C3 wiring:** none. This epic is a self-contained package module; all new surface is exported from `packages/planner/src/index.ts` (which the planner lane owns) and needs no change to `App.tsx`, `Layout.tsx`, `program.ts` or `app.ts`.

**FIX REQUESTS:** none.

**Deliberately deferred / out of scope:**

- `packages/repomap` (Epic 108) and planner evals (Epic 161); prompt/doctrine text is byte-identical.
- New `PlanIssue` codes (core enum, Epic 202) — the lane-size warning and duplicate-key hints use `'other'`.
- Dashboard/CLI wiring for diff and suggestions (Epics 131, 122, CLI lane); exports are the seam.
- Deleting the deprecated renderer (L33) and any `MapRenderer` union-member removal.
- A UI diff viewer, JSON schema versioning for patches, and suggesting fixes across more than two tasks at a time.

**Open questions / flagged tradeoffs:**

- **Merge sums estimates**, so two 25-minute tasks merge into a 50-minute task that trips the `> 40` warning. That is honest (one agent doing both is bigger), but a future epic may prefer splitting the merged task into two new capabilities instead.
- **Narrow only covers files the map already knows about.** A task that mostly creates new files should be serialised or merged; the patch rationale says which explicit paths were kept. A map-less caller gets no narrow suggestions at all by design.
- **The merge guard is conservative.** It may decline a merge that a human would accept when a third task's lane is only conservatively overlapping; serialise remains available.
- **`diffPlans` pairs duplicate normalised titles greedily in older-plan order.** Duplicate keys are already a validator error; identical titles are the only ambiguity and the result is deterministic.
- **Critical-path minutes ignore concurrency capacity.** A 60-task plan can have a 40-minute critical path and still take an hour on eight nodes; the suggestion only avoids making the DAG worse, not estimating wall clock.
