# Sky Todo

A small but real todo app — vanilla TypeScript, Vite, zero runtime dependencies.
It is **Starling's demo target**: the app is deliberately split into feature
folders so a goal like "add dark mode, search, CSV export and fix the date bugs"
can be planned into parallel, non-overlapping tasks.

> Not part of the Starling Bun workspace. This folder has its own `package.json`,
> lockfile and tests.

## Quick start

```bash
bun install
bun run dev        # http://localhost:5173
bun test           # unit tests, happy-dom for the DOM ones
bunx tsc --noEmit
bun run build      # dist/
```

## What's inside

```
src/main.ts               boot: persistence → store → UI → auto-discovered features
src/store/todos.ts        Todo {id,title,done,createdAt,due?,tags[]} + pub/sub
src/store/persist.ts      localStorage, schema v2 + v1 migration hook
src/ui/render.ts          list, composer, footer, event delegation
src/ui/slots.ts           feature slots + per-slot item registry
src/ui/filters.ts         view filters (search, tag chips) — data stays intact
src/ui/styles.css         design tokens as CSS custom properties
src/ui/dom.ts             createEl helper
src/lib/dates.ts          parse/format/isOverdue/sortByDue/relativeDays
src/lib/ids.ts            short unique ids
src/lib/commands.ts       named UI intents shared between features
src/features/README.md    the slot API — read this before writing a feature
src/features/item-count/  the reference feature (one footer slot item + CSS)
src/features/<name>/      empty folders reserved for the demo features
demo-goals/               ready-to-run goals + *.expected.md answer keys
.starling-answers/        seeded-bug and stage-run answer keys (never copied into a demo repo)
```

## Features are folders

A feature is one folder under `src/features/` with an `index.ts` that
default-exports `defineFeature({ id, register })`. Vite eagerly glob-imports
`./*/index.ts`, so **adding a feature requires zero edits outside its folder** —
that is what makes Starling's lanes truly disjoint here. See
[`src/features/README.md`](src/features/README.md) for slots, commands, filters,
CSS conventions and testing.

```ts
// src/features/hello/index.ts
import { defineFeature } from '../registry'

export default defineFeature({
  id: 'hello',
  register({ slots, doc }) {
    slots.register({
      id: 'hello',
      slot: 'footer',
      render: () => {
        const node = doc.createElement('span')
        node.textContent = 'hello from the flock'
        return node
      },
    })
  },
})
```

## Demo goals

| File                        | Tasks | Use it for                                        |
| --------------------------- | ----- | ------------------------------------------------- |
| `demo-goals/launch-day.md`  | 7     | The main 3-minute demo                           |
| `demo-goals/launch-day-xl.md` | 10  | Flock mode: enough parallel work for two laptops |
| `demo-goals/stage.md`       | 6     | The 8-minute stage beat: six agents, one audit failure |
| `demo-goals/quick-wins.md`  | 3     | Smoke test, ~2 minutes                           |
| `demo-goals/conflict-bait.md` | 2   | Lane-overlap warning + conflict resolver         |
| `demo-goals/will-fail-audit.md` | 1 | Auditor catches a missing test                   |

Each goal is the literal text Starling receives:

```bash
starling run "$(cat demo-goals/launch-day.md)" --repo .
```

The sibling `*.expected.md` files are the answer keys for evals: ideal task
keys, lanes, dependencies and why the lanes are disjoint. They are excluded from
demo repos by `examples/scripts/make-demo-repo.sh`.

`stage`'s decomposition lives in
[`.starling-answers/stage.expected.md`](.starling-answers/stage.expected.md)
instead of next to the other keys: `evals/planner/cases.test.ts` requires one
planner case per `demo-goals/*.expected.md`, and the stage case belongs to the
planner-evals lane. Both folders are stripped from demo repos.

## Seeded bugs

`src/lib/dates.ts` contains two realistic, intentionally **untested** bugs:

- `isOverdue` compares the due instant with "now" and parses the day as UTC
  midnight, so a task due today looks overdue all day (a day early west of UTC).
- `sortByDue` compares `M/D/YYYY` strings, so October sorts before September and
  undated tasks land in the middle.

The baseline is green because the committed tests only cover the unambiguous
cases. Repro steps and the expected fixes live in
[`.starling-answers/BUGS.md`](.starling-answers/BUGS.md) (answer key — do not
point coding agents at it).

## Resetting a demo

```bash
bash ../scripts/make-demo-repo.sh                 # sky-todo into $TMPDIR, timestamped
bash ../scripts/make-demo-repo.sh sky-todo ./demo # sky-todo into ./demo
```

Copies this project (without the answer key and expected-goal files) into a fresh
directory, runs `git init -b main`, `bun install`, verifies the baseline with
`bun test` and commits one commit. It prints the repo path on the last line.
Re-run it with the same path to get a clean repo again.

The same script builds the Python demo target:
`bash ../scripts/make-demo-repo.sh py-ledger`. See
[`examples/README.md`](../README.md) for both targets side by side.

## License

MIT.
