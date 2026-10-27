# Epic 01 — Demo target: `sky-todo`

## Goal

Give Starling a **real repo to work on**. `examples/sky-todo` is a small vanilla
TypeScript + Vite todo app whose features land in separate folders, so a goal
like "add dark mode, search, CSV export, fix two date bugs" decomposes into
parallel tasks with non-overlapping write lanes. It also seeds two realistic
date bugs and ships demo goals (plus answer keys) for every demo beat: the main
launch run, the two-laptop flock run, a smoke test, conflict prediction and an
auditor failure.

The app is deliberately **not** a member of the Starling Bun workspace. It has
its own `package.json`, lockfile, tsconfig and tests, and `make-demo-repo.sh`
copies it into a throwaway git repo.

## How it works

### App shell

```
src/main.ts                 boot: localStorage → store → UI → features
src/store/todos.ts          Todo model + pub/sub (add/update/toggle/remove/clearDone/replaceAll)
src/store/persist.ts        localStorage schema v2 + v1 migration
src/ui/render.ts            header, composer, list, footer, overlay, event delegation
src/ui/slots.ts             5 slots + per-slot item registry
src/ui/filters.ts           view filters (search, tag chips)
src/ui/styles.css           --sky-* custom properties
src/lib/dates.ts            parse/format/isOverdue/sortByDue/relativeDays
src/lib/commands.ts         named UI intents shared between features
src/lib/ids.ts              short unique ids
src/features/item-count/    reference feature: one footer item + its own CSS
```

`src/main.ts` wires `createTodoStore` + `loadTodos` + `mountApp`, then registers
every discovered feature with a `FeatureContext` (`doc`, `root`, `store`,
`slots`, `commands`, `filters`, `refresh`). Store edits re-render the list, the
counts and every slot; persistence subscribes to the store.

### Slots (the lane boundary)

| Slot           | Renders                          | Typical owner                |
| -------------- | -------------------------------- | ---------------------------- |
| `header-right` | header actions                   | theme toggle, today's date   |
| `toolbar`      | above the list                   | search, tag chips, CSV export |
| `item-badges`  | inside each row (per-todo host)  | due badges, tag chips        |
| `footer`       | footer row                       | stats, item count, hints     |
| `overlay`      | below the list                   | help sheet, modals           |

An item is `{ id, slot, order?, render(host) → Node | null }`; `render` runs on
every refresh, so items read the current store state. Duplicate item ids within
a slot throw. Features get a document via `ctx.doc`, never the global `document`,
which keeps them testable under happy-dom.

Cross-feature behaviour goes through the **command bus** (`todo:new`,
`todo:clear-done` are built in; search registers `search:focus`, help registers
`help:open`, shortcuts runs them) and the **filter registry**
(`ctx.filters.add(predicate)` + `ctx.refresh()`), so no feature imports another
feature or edits the renderer.

### Auto-discovery: zero shared registration edits

```ts
modules = import.meta.glob('./*/index.ts', { eager: true })
```

Vite statically rewrites that call into an eager module map at build/dev time.
A new feature folder with an `index.ts` default-exporting
`defineFeature({ id, register })` is live with **no edit outside the folder** —
no registry import, no route table, no shared list. The glob sits inside a
`try/catch`: Bun's test runner has no `import.meta.glob`, so tests use the
Bun-only twin `src/features/discover.node.ts`, which reads the directory and
dynamic-imports each `index.ts`. `features/discovery.test.ts` asserts the twin
finds every folder and boots the whole set.

Proven live (not committed):

- adding `src/features/zz-test/index.ts` made `bun test` go 68 → 69 and the
  built bundle contain its footer text, with no other file changed;
- deleting the folder returned both to 68 and removed the text from the bundle.

### Seeded bugs (answer key, not shown to agents)

`src/lib/dates.ts`:

- **A** `isOverdue` compares the due instant with `now` and parses `YYYY-MM-DD`
  as UTC midnight → a task due today is overdue all day (a day early in
  America/Toronto).
- **B** `sortByDue` compares `M/D/YYYY` strings → `10/2` sorts before `9/30`, and
  undated todos fall back to `createdAt` and land in the middle.

The committed tests deliberately only assert the unambiguous cases (2020 vs
2099 for overdue; March vs September for sorting), so the baseline is green and
the demo's `dates-fix` task has real work. Repro steps and expected fixes:
`examples/sky-todo/.starling-answers/BUGS.md`.

### Demo goals

| File                              | Tasks | Purpose                                     |
| --------------------------------- | ----- | ------------------------------------------- |
| `launch-day.md`                   | 7     | main demo; 5 ready at t0, 2 DAG edges       |
| `launch-day-xl.md`                | 10    | flock demo; 8 ready at t0 for two laptops   |
| `quick-wins.md`                   | 3     | ~2-minute smoke test                        |
| `conflict-bait.md`                | 2     | intentional `src/ui/render.ts` overlap      |
| `will-fail-audit.md`              | 1     | first attempt skips required tests          |

Each has a `*.expected.md` answer key with task keys, lane globs, dependencies,
per-task DoD and the disjointness argument. `launch-day` lanes are
`src/features/{theme,search,export,shortcuts,help,due-dates}/**` plus
`src/lib/dates.ts` (+ its test); `help-overlay → shortcuts` and
`due-badges → dates-fix`.

### Resetting a demo repo

```bash
bash examples/scripts/make-demo-repo.sh                # $TMPDIR/sky-todo-<ts>
bash examples/scripts/make-demo-repo.sh /tmp/my-demo   # explicit target
```

Copies the app (excluding `.starling-answers/`, `demo-goals/*.expected.md`,
`node_modules`, `dist`, `.git`), `git init -b main`, `bun install`, one commit
`chore: initial sky-todo`, prints the path. Re-running the same target rebuilds
it; a non-empty directory the script did not create is refused, never deleted.
bash 3.2 compatible.

## Key decisions & reasoning

- **Vanilla TS + Vite, no framework** — the brief; keeps the demo app readable
  in a diff and the build 10 kB. Rendering is a full replace of the list on each
  store change; at todo scale this is simpler and less bug-prone than a diffing
  layer, and it makes slot items trivially idempotent.
- **Injected `doc` instead of globals** — every feature and the shell receives
  the document through `ctx`/`mountApp`, so happy-dom tests need no global
  registration and Bun never touches a DOM.
- **Filters as a registry, not a store concern** — search and tag chips must not
  change persisted data or edit `render.ts`; predicates are ANDed, counts still
  describe the whole list, and `src/ui/filters.test.ts` pins the contract.
- **Commands as a registry, not imports** — shortcuts must trigger search and
  help without importing those folders (which would create cross-lane coupling
  and merge conflicts). Names are namespaced and duplicates throw.
- **Discovery in a `try/catch` glob + a Bun twin** — literal
  `import.meta.glob` is required for a zero-edit registry, but Bun has no glob.
  Catching the missing function keeps the browser path honest while letting the
  test suite verify the same folder→feature contract through `node:fs`.
- **State version 2 with a real v1 migration** — makes `persist.ts` a feature-shaped
  module (schema evolution is testable) rather than a JSON.stringify wrapper. A
  future version refuses to load instead of silently mangling data.
- **Bugs are untested on purpose** — the demo's dramatic beat is the auditor
  finding a wrong date computation, not a red baseline. The answer key records
  the exact cases to add after the fix so evals can judge the task.
- **Demo copies strip answer keys** — `make-demo-repo.sh` excludes
  `.starling-answers/` and `*.expected.md`; a coding agent in a demo repo can't
  read the answer. The main repo keeps them for evals.

## Interfaces for future epics

- **Consumed by E12 (planner) evals**: `demo-goals/*.expected.md` give golden
  decompositions (keys, lanes, deps) for 5 goals of different sizes.
- **Consumed by E14/E17 (workspace/merger)**: `conflict-bait` is a real,
  minimal overlapping-lane goal; `src/ui/render.ts` is the intentional conflict
  point.
- **Consumed by E15 (runner)**: the goal text is literal; `starling run "$(cat
  demo-goals/launch-day.md)" --repo <demo>` is the documented invocation.
- **Consumed by E16 (auditor)**: `will-fail-audit` defines an auditable miss;
  the per-task DoD in the answer keys names the checks.
- **Consumed by E22/E23 (CLI/web)**: `make-demo-repo.sh` prints the repo path on
  its last line, ready to pipe into a scripted demo.
- **Feature contract** for any agent working in a demo repo:
  `src/features/README.md` (slots, commands, filters, CSS, tests) is the only
  doc an agent needs inside its lane.

## Deviations from plan

- The prompt's feature-folder list did not include `help`, but `launch-day`
  needs a `help-overlay` task with its own folder. Added
  `src/features/help/.gitkeep`.
- Added two baseline extension points that the prompt implies but does not
  list: `src/ui/filters.ts` (otherwise search/tag chips would have to edit
  `render.ts`, breaking their lanes) and `src/lib/commands.ts` (shortcuts → help
  and search without imports). Both are small, documented and tested.
- Added `src/ui/dom.ts` and `src/testing/dom.ts` helpers; they are not in the
  prompt's tree but keep modules under 300 lines and tests uniform.

## Known limitations / deferred

- No end-to-end browser test (no Playwright); DOM behaviour is covered by
  happy-dom, and the Vite build is smoke-checked by asserting `item-count`
  reaches `dist/`.
- `demo-goals/*.expected.md` are hand-written answer keys, not validated by a
  planner yet; E29/E37 evals should diff Starling's plan against them.
- The seeded bugs are fixed by the demo, so the "buggy" state exists only in the
  baseline and in `make-demo-repo.sh` copies.
- `sortByDue`'s "undated last" choice is specified in the answer key; the
  baseline's undated-middle behaviour is the bug.
- No CI in this epic (root CI is out of scope); verification is manual via the
  commands in the handback.
