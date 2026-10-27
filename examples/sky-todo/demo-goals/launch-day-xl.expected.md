# Expected decomposition — launch-day XL

**Goal (10 tasks).** Everything in `launch-day` plus undo/redo, a stats footer and
tags with filter chips. This fills both laptops in the flock demo: 7–8 tasks are
ready in the first dispatch round, with two DAG edges.

## Task table

| #  | key            | title                                  | depends on    | lane owns                                   |
| -- | -------------- | -------------------------------------- | ------------- | ------------------------------------------- |
| 1  | `theme`        | Dark mode with a persisted toggle      | —             | `src/features/theme/**`                     |
| 2  | `search`       | Live search filtering                  | —             | `src/features/search/**`                    |
| 3  | `csv-export`   | CSV export with correct quoting        | —             | `src/features/export/**`                    |
| 4  | `shortcuts`    | Keyboard shortcuts n / ?               | —             | `src/features/shortcuts/**`                 |
| 5  | `help-overlay` | Help sheet listing the shortcuts       | `shortcuts`   | `src/features/help/**`                      |
| 6  | `dates-fix`    | Fix overdue + due-date sorting         | —             | `src/lib/dates.ts`, `src/lib/dates.test.ts` |
| 7  | `due-badges`   | Due-date badges on todo rows           | `dates-fix`   | `src/features/due-dates/**`                 |
| 8  | `undo`         | Undo / redo the todo list              | —             | `src/features/undo/**`                      |
| 9  | `stats`        | Completion stats in the footer         | —             | `src/features/stats/**`                     |
| 10 | `tags`         | Tag chips + tag filtering              | —             | `src/features/tags/**`                      |

Expected validator output: **no issues**. 8 tasks are ready at t0 (`theme`,
`search`, `csv-export`, `shortcuts`, `dates-fix`, `undo`, `stats`, `tags`), so
with `maxParallel: 8` the hub and a 5-slot perch both get work immediately.

## Why the lanes are disjoint

Same argument as `launch-day`: six feature folders plus one dedicated pair of
date files. The three new tasks also get exactly one folder each:

- `undo` snapshots through `store.subscribe()` and restores with
  `store.replaceAll()` — both already part of the store's public API.
- `stats` is a `footer` slot item; `tags` is a `toolbar` item plus an
  `item-badges` item in its own folder; neither edits `render.ts`.
- `search` and `tags` both use `ctx.filters.add()`; two filters coexisting is the
  designed behaviour (AND), proven by `src/ui/filters.test.ts`.

No task edits a shared file, so there is nothing for the merge queue to resolve.

## Extra task details

### undo — `src/features/undo/**`

Deliverables: `toolbar` (or `footer`) undo and redo buttons; keeps a bounded
history (50 snapshots) by subscribing to the store; restores via
`replaceAll`; ignores its own restore event so it does not push a redundant
step; disables buttons at the ends of the history; exposes `undo:back` /
`undo:forward` commands.
DoD: add → undo removes; redo restores; editing after undo drops the redo tail;
tests cover the three cases.

### stats — `src/features/stats/**`

Deliverables: `footer` slot item showing `done / total` and a percentage, plus
the number of tasks due this week (`daysUntil` from `src/lib/dates.ts`).
DoD: empty state reads "0% complete"; updates after toggle/remove; tests cover
0%, partial and 100%.

### tags — `src/features/tags/**`

Deliverables: `item-badges` item rendering each todo's tags as chips; `toolbar`
row of the distinct tags in use as toggle chips; selecting chips adds an AND
filter (`todo.tags` contains all selected), clearing removes it; an "Add tag"
affordance may use `store.update`. New tags are normalized by the store.
DoD: chips reflect the current tag union; selecting two chips narrows the list;
toggling off restores it; tests cover filtering and chip rendering.

## Golden path

Dispatch 8 → `help-overlay` and `due-badges` dispatch after their dependency
merges → 10/10 merged, 0 conflicts. With flock mode on, expect 2–4 tasks on the
perch; killing the perch mid-run reschedules its task (test this on `launch-day-xl`,
not on the 3-minute script).
