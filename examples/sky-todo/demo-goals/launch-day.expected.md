# Expected decomposition — launch-day

**Goal (7 tasks).** Theme, search, CSV export, shortcuts, help overlay, a fix for
the two date bugs, and due-date badges. Five tasks can start immediately; two
wait on a dependency.

## Task table

| # | key            | title                                  | depends on    | lane owns                                              |
| - | -------------- | -------------------------------------- | ------------- | ------------------------------------------------------ |
| 1 | `theme`        | Dark mode with a persisted toggle      | —             | `src/features/theme/**`                                |
| 2 | `search`       | Live search filtering                  | —             | `src/features/search/**`                               |
| 3 | `csv-export`   | CSV export with correct quoting        | —             | `src/features/export/**`                               |
| 4 | `shortcuts`    | Keyboard shortcuts n / ?               | —             | `src/features/shortcuts/**`                            |
| 5 | `help-overlay` | Help sheet listing the shortcuts       | `shortcuts`   | `src/features/help/**`                                 |
| 6 | `dates-fix`    | Fix overdue + due-date sorting         | —             | `src/lib/dates.ts`, `src/lib/dates.test.ts`            |
| 7 | `due-badges`   | Due-date badges on todo rows           | `dates-fix`   | `src/features/due-dates/**`                            |

Every task reads (never writes) the shared contracts: `src/features/README.md`,
`src/ui/slots.ts`, `src/ui/filters.ts`, `src/lib/commands.ts`, `src/store/todos.ts`,
`src/lib/dates.ts`, `src/ui/styles.css`.

## Why the lanes are disjoint

- Six tasks own **one feature folder each**. Feature discovery is a Vite glob of
  `src/features/*/index.ts`, so there is no registry file for two agents to edit.
- `dates-fix` owns the only two non-feature files in the whole goal, and no other
  task writes them. `due-badges` consumes the fixed helper across the DAG edge.
- Slots, commands and filters are *read-only* contracts. Two features can hang
  items in the same slot (`toolbar`, `footer`) without touching the same file,
  because each item is registered from its own folder.
- Nothing in this plan touches `src/ui/render.ts`, `src/main.ts`, `index.html` or
  any `package.json`, so there is nothing to conflict on.

Expected validator output: **no issues**.

## Task details

### theme — `src/features/theme/**`

Deliverables: header-right slot item with a labelled toggle (light/dark); sets
`document.documentElement.dataset.theme`; defines the dark values of the
`--sky-*` custom properties in `theme.css`; persists the choice under
`sky-todo.theme`; falls back to `prefers-color-scheme` when nothing is stored.
DoD: toggling repaints immediately; reload keeps the choice; unit tests cover
toggle, persistence and the initial default; `bun test` green.

### search — `src/features/search/**`

Deliverables: toolbar search input; case-insensitive substring match on the todo
title, live on `input`; registers `search:focus` on the command bus; removes its
filter when the field is emptied; shows a "no matches" note in the toolbar.
Uses `ctx.filters.add()` + `ctx.refresh()` — never edits the renderer.
DoD: typing hides non-matching rows immediately; clearing restores them;
`/` shortcut (when present) focuses the field; tests cover filter + focus.

### csv-export — `src/features/export/**`

Deliverables: toolbar button "Export CSV"; RFC 4180 output with header
`id,title,done,createdAt,due,tags`; quotes doubled, fields with `,`, `"` or
newline quoted, CRLF line endings; download via Blob + object URL.
DoD: unit tests cover a title with a comma, embedded quotes and a newline;
`bun test` green; no network.

### shortcuts — `src/features/shortcuts/**`

Deliverables: one `keydown` listener on `document`, ignoring events whose target
is an input/textarea/select/contenteditable and any event with meta/ctrl/alt.
`n` → `commands.run('todo:new')`, `/` → `commands.run('search:focus')`,
`?` → `commands.run('help:open')`; `preventDefault()` only when a command ran.
DoD: tests dispatch synthetic KeyboardEvents for all three keys, assert typing in
the composer is ignored, and assert the handlers degrade silently when a command
is not registered (independent start order).

### help-overlay — `src/features/help/**` (depends on `shortcuts`)

Deliverables: overlay slot item rendering a hidden dialog; registers
`help:open`; lists n, /, ? and Escape; close button, backdrop click and Escape
close it; focus moves into the dialog on open and back to the trigger on close.
DoD: pressing `?` opens it (needs shortcuts), Escape closes it; tests cover open,
close and the command registration; no `alert()`.

### dates-fix — `src/lib/dates.ts`, `src/lib/dates.test.ts`

Deliverables: `isOverdue('YYYY-MM-DD')` must compare **calendar days in local
time** (a task due today is not overdue at 10:00 in America/Toronto);
`sortByDue` must sort chronologically by due day and keep undated todos after
dated ones (tie-break `createdAt`); keep the existing exported API.
DoD: new regression tests fail on the old code and pass on the new; run the suite
under `TZ=America/Toronto` and `TZ=UTC`; `bun test` green.

### due-badges — `src/features/due-dates/**` (depends on `dates-fix`)

Deliverables: `item-badges` slot item showing `formatShort(due)` plus
`relativeDays(due)` ("today", "in 2 days", "3 days ago"); overdue badges get an
`is-overdue` class driven by the fixed `isOverdue`; nothing rendered without a
due date. Badge styling lives in the feature's own CSS.
DoD: tests cover no date, future date, overdue date and the class name;
`bun test` green.

## Golden path on stage

`theme`, `search`, `csv-export`, `shortcuts` and `dates-fix` dispatch together
(5 birds). `help-overlay` and `due-badges` dispatch as soon as their dependency
merges. Expected merges: 7/7, 0 conflicts.
