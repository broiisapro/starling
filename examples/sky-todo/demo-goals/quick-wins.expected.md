# Expected decomposition — quick-wins

**Goal (3 tasks, ~2 minutes total).** The smoke test: tiny, independent, each one
inside its own feature folder. If this plan has issues, the planner is broken.

## Task table

| # | key           | title                                | depends on | lane owns                     |
| - | ------------- | ------------------------------------ | ---------- | ----------------------------- |
| 1 | `title-count` | Open-task count in the tab title     | —          | `src/features/title-count/**` |
| 2 | `today`       | Today's date in the header           | —          | `src/features/today/**`       |
| 3 | `tag-count`   | Distinct tag count in the footer     | —          | `src/features/tag-count/**`   |

Expected validator output: **no issues**. All three ready at t0; three agents,
three folders, zero shared writes.

## Why the lanes are disjoint

Each task adds a new folder with one `index.ts`. Discovery is a Vite glob, so no
shared registration line exists. The three folders already exist with a
`.gitkeep` (`src/features/title-count/`, `today/`, `tag-count/`), so the lane is
visible in the repo before the run starts — a planner reading the tree can see
where each task belongs. `title-count` and `tag-count` read the store; `today`
reads `formatShort` from `src/lib/dates.ts`; none of them writes a shared file.

## Details

### title-count — `src/features/title-count/**`

Registers a store subscription; sets `document.title` to
`Sky Todo (${open} open)` / `Sky Todo` when nothing is open; unsubscribes are not
required at app level but the subscription must not throw.
DoD: one test asserts 0 open → `Sky Todo` and 2 open → `Sky Todo (2 open)`.

### today — `src/features/today/**`

`header-right` slot item with `formatShort(new Date())` and a `title` attribute
holding the full ISO date.
DoD: one test asserts the text equals `formatShort(new Date())`.

### tag-count — `src/features/tag-count/**`

`footer` slot item with `"${n} tags in use"` (correct singular/plural), computed
from the union of `todo.tags`; updates after store changes.
DoD: empty → `0 tags in use`; two todos sharing a tag → `1 tag in use`.

## Golden path

All three dispatch at once; merge in any order; no conflicts; ~2 minutes.
