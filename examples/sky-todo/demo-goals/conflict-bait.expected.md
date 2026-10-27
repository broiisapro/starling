# Expected decomposition — conflict-bait

**Goal: 2 tasks that must both edit `src/ui/render.ts`.** This goal deliberately
breaks the lane rule so the demo can show what Starling does about it: the
validator raises `lane-overlap`, `git merge-tree` predicts the conflict, and the
resolver agent reconciles the two diffs.

> Do **not** use this goal on the main 3-minute path. It is for the conflict
> demo, and for showing that the planner's lane check actually sees something.

## Task table

| # | key          | title                                | depends on | lane owns                                |
| - | ------------ | ------------------------------------ | ---------- | ---------------------------------------- |
| 1 | `date-sort`  | Sort-by-due toggle in the footer     | —          | `src/ui/render.ts`, `src/ui/styles.css`  |
| 2 | `delete-all` | Delete-all button in the footer      | —          | `src/ui/render.ts`, `src/ui/styles.css`  |

Expected validator output:

- `lane-overlap` (error) on `src/ui/render.ts` and `src/ui/styles.css`, task keys
  `date-sort`, `delete-all`.
- No cycle, no missing dependency.

Expected merge result: the first task merges cleanly; the second returns
`status: 'conflict'` with `conflictedFiles: ['src/ui/render.ts']` (and likely
`styles.css`). The resolver receives both diffs plus the conflict markers and
must keep **both** behaviours.

## Why they overlap on purpose

Both changes live in the same shell furniture: the footer's markup, its click
delegation branch and a couple of rules in the shared stylesheet. There is no
feature-slot way to add a sort toggle that reorders the shared list — sorting is
a renderer concern — and "Delete all" is naturally an app-level action too. The
honest plan is either **one task** (preferred in production) or two overlapping
tasks (preferred for this demo).

If the planner repairs the plan, acceptable outcomes are:

1. Merge them into one task with lane `src/ui/render.ts`, `src/ui/styles.css`; or
2. Keep two tasks and flag the overlap as a `warn` (demo mode), letting the merge
   queue exercise the resolver.

Anything else (e.g. giving one task an empty lane) is a planning bug.

## Details

### date-sort — `src/ui/render.ts`, `src/ui/styles.css`

Deliverables: footer button that toggles between insertion order and
`sortByDue()`; button label/aria-pressed reflects the mode; uses the existing
`sortByDue` helper from `src/lib/dates.ts`.
DoD: clicking reorders the rendered list; clicking again restores insertion
order; test covers both states.

### delete-all — `src/ui/render.ts`, `src/ui/styles.css`

Deliverables: footer button "Delete all" with a confirm step
(`window.confirm` or a two-click arm state — no `alert`); empties the store via
`store.replaceAll([])`; disabled when the list is empty.
DoD: clicking with confirmation removes every todo and shows the empty state;
test covers the confirm path and the disabled state.

## Golden path

Run with `--max-parallel 2`, expect an amber `lane-overlap` verdict in the plan
view, one clean merge and one `conflict` that the resolver fixes. Both
behaviours must survive: a list that can be sorted **and** cleared.
