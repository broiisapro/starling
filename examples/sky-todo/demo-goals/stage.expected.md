# Expected decomposition — stage

**Goal (6 tasks, ≤ 8 minutes with 6 agents).** The middle-length demo beat: more
than `quick-wins`, much shorter than `launch-day-xl`, one visible audit failure
and one retry. Every task is one feature folder, so all six dispatch at t0 and
no two agents write the same file.

## Task table

| # | key          | title                                | depends on | lane owns                | expected time |
| - | ------------ | ------------------------------------ | ---------- | ------------------------ | ------------- |
| 1 | `today`      | Today's date in the header           | —          | `src/features/today/**`      | ~1 min        |
| 2 | `stats`      | Completion stats in the footer       | —          | `src/features/stats/**`      | ~2 min        |
| 3 | `search`     | Live search filtering                | —          | `src/features/search/**`     | ~2 min        |
| 4 | `theme`      | Dark mode with a persisted toggle    | —          | `src/features/theme/**`      | ~3 min        |
| 5 | `shortcuts`  | Keyboard shortcuts n / ?             | —          | `src/features/shortcuts/**`  | ~2 min        |
| 6 | `csv-export` | CSV export with quoting tests        | —          | `src/features/export/**`     | ~3 min + retry |

Expected validator output: **no issues**. Six ready tasks at t0, six agents
busy, no DAG edges — the whole point of this goal is a full murmuration that
drains in one round plus one retry.

## Why the lanes are disjoint

Six tasks, six folders. Discovery is a Vite glob of `src/features/*/index.ts`, so
adding a feature never edits a shared file. Every task reads the shared
contracts (`src/features/README.md`, `src/ui/slots.ts`, `src/ui/filters.ts`,
`src/lib/commands.ts`, `src/store/todos.ts`, `src/ui/styles.css`) and writes
only inside its own folder. Nothing touches `src/ui/render.ts`, `src/main.ts`,
`index.html` or `package.json`.

Two tasks hang items in the same slot without touching the same file: `stats`
registers a `footer` item, `today` a `header-right` item, `theme` another
`header-right` item; `search` and `csv-export` both register `toolbar` items
from their own folders. That is the designed behaviour of the slot registry.

`shortcuts` runs `search:focus` (registered by `search` in this same run) and
`help:open` (nobody registers it here) — the spec requires the handler to
degrade silently when a command is missing, so that is not a dependency.

## The intended moments on stage

1. **t0 — six birds leave the wire.** `plan.created` has zero issues, all six
   tasks go `running` at once. Point at the DAG: one row, no edges.
2. **~1–2 min — `today` and `search` merge first.** The header date and a live
   filter appear; useful for showing that lanes really are independent.
3. **~2–3 min — `theme` and `stats` merge.** Toggle dark mode; the footer shows
   `3 / 7 · 43%`. `shortcuts` lands with them; `n` focuses the composer.
4. **~3 min — `csv-export` fails audit (the beat).** The goal says "with tests
   for quoting and commas"; the first attempt ships `src/features/export/index.ts`
   with a working exporter and **no test file**. Audit verdict: `pass: false`
   with `definition-of-done` naming the missing quoting tests, and
   `fixInstructions` listing commas, embedded quotes, newlines, the header row
   and the empty list. Attempt count goes to 1; the agent gets the fixer prompt
   in the same session.
5. **~5–6 min — the fixer adds `src/features/export/index.test.ts`.** Audit
   passes on attempt 2, the merge queue drains, 6/6 merged, 0 conflicts. The
   cost meter shows one retry (that is the point).
6. **~7 min — all green.** Click through the header date, the filter, the stats,
   the CSV download and the theme toggle. Stop the clock before 8 minutes.

If `csv-export` *does* pass on attempt 1, that is fine — say "the flock learned"
and show the same run without the retry; the timeline still holds because the
other five lanes take about as long.

## Task details

### today — `src/features/today/**`

Deliverables: `header-right` slot item showing `formatShort(new Date())` and a
`title` attribute with the ISO day.
DoD: one test asserts the text equals `formatShort(new Date())` and the title
attribute matches `todayIso()`; `bun test` green.

### stats — `src/features/stats/**`

Deliverables: `footer` slot item showing `done / total` plus a whole-number
percentage; empty state reads `0 / 0 · 0%`; updates after toggle, add and remove.
DoD: tests cover 0%, partial and 100%; `bun test` green.

### search — `src/features/search/**`

Deliverables: `toolbar` input; case-insensitive substring match on `todo.title`,
live on `input`; registers `search:focus`; removes its filter when the field is
emptied; a "no matches" note while a query hides everything; uses
`ctx.filters.add()` + `ctx.refresh()`, never edits the renderer.
DoD: typing hides non-matching rows immediately, clearing restores them,
`commands.run('search:focus')` focuses the input; tests cover filter and focus.

### theme — `src/features/theme/**`

Deliverables: `header-right` labelled toggle with `aria-pressed`; sets
`document.documentElement.dataset.theme`; defines dark values for the `--sky-*`
custom properties in the feature's own CSS; persists under `sky-todo.theme`;
falls back to `prefers-color-scheme` when nothing is stored.
DoD: toggling repaints immediately, reload keeps the choice, tests cover toggle,
persistence and the initial default; `bun test` green.

### shortcuts — `src/features/shortcuts/**`

Deliverables: one `keydown` listener on `document`, ignoring events whose target
is an input/textarea/select/contenteditable and any event with meta/ctrl/alt.
`n` → `commands.run('todo:new')`, `/` → `commands.run('search:focus')`,
`?` → `commands.run('help:open')`; `preventDefault()` only when a command ran.
DoD: synthetic `KeyboardEvent`s for all three keys, typing in the composer is
ignored, missing commands degrade silently; tests cover all three.

### csv-export — `src/features/export/**`

Deliverables: `toolbar` button "Export CSV"; header
`id,title,done,createdAt,due,tags`; RFC 4180 quoting (fields with `,`, `"` or a
newline are quoted, inner quotes doubled), CRLF row endings; `tags` joined with
`;`; a missing due date is an empty field; download via Blob + object URL named
`sky-todo-YYYY-MM-DD.csv`.
DoD: colocated tests cover a title with a comma, a title with a double quote, a
title with a newline, the header row and the empty list; `bun test` green.

## Golden path

`--max-parallel 6`, one laptop, no flock. Expect `plan.created` with zero issues,
6 dispatch at t0, 5 merges, 1 audit failure, 1 fix, 6/6 merged and 0 conflicts in
under 8 minutes.
