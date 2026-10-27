# Epic 01: Demo target, `sky-todo`

**Wave 0 · Branch `epic/01-demo-target` · Issue: `gh issue list --search "Epic 01"` · Model: DeepSeek V4.1 Flash · Budget: 45–90 min**

Starling (read `.orchestrator/PRD.md`) is a harness that splits one coding goal into parallel agent tasks with non-overlapping file lanes, runs them across laptops, audits them with a local model and merges them. On stage it needs a **target repo to work on**. You are building that target: a small but real app, designed so a goal like "add 7 features" splits cleanly into parallel, non-overlapping tasks. It also has a couple of **seeded bugs** so the audit/fix loop has something to catch.

This is a **standalone project** inside `examples/`. It is *not* part of the Starling Bun workspace (the root workspaces are only `packages/*` and `apps/*`). It has its own `package.json`, its own tests and its own lockfile. Epic 00 (running in parallel) is building the Starling monorepo root, so don't touch anything outside `examples/`.

## Locked decisions relevant to you
Bun + TypeScript strict + Vite; `bun test`; MIT; Conventional Commits; lanes (ARCHITECTURE §7, AGENTS.md).

## FIRST TASK: carryover
None. This is a first-wave epic.

## Your lane
`examples/**`, `docs/epic-01-demo-target.md`, `.orchestrator/handbacks/01-demo-target.md`. Nothing else.

## Deliverables

### 1. `examples/sky-todo/`: a vanilla TS + Vite todo app (no framework)
It should feel like a real small product, about 700–1,000 lines of source plus tests, with **clear module boundaries** so features land in separate folders:
```
examples/sky-todo/
  package.json  tsconfig.json  vite.config.ts  index.html  README.md  bunfig.toml (if needed)
  src/main.ts                 bootstraps store + render + feature registry
  src/store/todos.ts          Todo model {id,title,done,createdAt,due?,tags[]}; add/update/toggle/remove/clear-done; pub-sub
  src/store/persist.ts        localStorage load/save with schema version + migration hook
  src/ui/render.ts            renders list, input, footer; event delegation; exposes mount points (slots) for features
  src/ui/styles.css           CSS custom properties for colours (so theming is a clean feature)
  src/ui/slots.ts             a tiny "feature slot" registry: header-right, toolbar, item-badges, footer, overlay
  src/lib/dates.ts            parse/format/isOverdue/sortByDue/relative ("in 2 days")  ← seeded bugs live here
  src/lib/ids.ts              id generator
  src/features/README.md      explains the slot API; one example feature "item-count" registered in the footer
  src/features/{theme,search,export,shortcuts,due-dates,undo,stats,tags}/.gitkeep   empty, for agents to fill
  tests: *.test.ts beside the source (use happy-dom for render tests)
```
- Every feature folder maps to exactly one slot plus its own CSS file, so tasks really don't need to share files. The only shared touchpoint is **one registration line** in `src/features/index.ts`. To avoid conflicts on that file, make registration **auto-discovered** with Vite `import.meta.glob('./*/index.ts', { eager: true })`, so a new feature needs **zero edits outside its own folder**. This is the whole point; test it.
- Baseline must be green: `bun install`, `bun test`, `bunx tsc --noEmit`, `bun run build`.

### 2. Seeded bugs (realistic, **untested** on purpose so the baseline stays green)
In `src/lib/dates.ts`:
- **Bug A, overdue off-by-one:** `isOverdue` parses `YYYY-MM-DD` with `new Date(str)` (UTC midnight) and compares against local now, so in America/Toronto a task due *today* shows as overdue.
- **Bug B, date sorting:** `sortByDue` compares formatted `M/D/YYYY` strings lexicographically, so 10/2 sorts before 9/30, and todos without a due date land in the middle.
Write them naturally, not with `// BUG` comments. Record them in `examples/sky-todo/.starling-answers/BUGS.md` (the answer key for evals, which agents won't be pointed at) with a repro and the expected fix.

### 3. Demo goals: `examples/sky-todo/demo-goals/`
Each goal is a `.md` file containing the goal text Starling will receive, plus an answer-key sibling `*.expected.md` with the ideal decomposition: task keys, lanes (globs), dependencies, and why the lanes are disjoint.
- `launch-day.md` (7 tasks, the main demo): *"Add dark mode with a toggle, live search filtering, CSV export, keyboard shortcuts (n = new, / = search, ? = help), due-date badges, and fix the overdue-calculation and date-sorting bugs in src/lib/dates.ts."* Expected tasks: theme, search, csv-export, shortcuts, help-overlay (depends on shortcuts), dates-fix, due-badges (depends on dates-fix).
- `launch-day-xl.md` (10–11 tasks, fills two laptops for the flock demo): launch-day plus undo/redo, a stats footer, and tags with filter chips.
- `quick-wins.md` (3 tiny tasks, about 2 minutes total: the smoke test).
- `conflict-bait.md` (2 tasks that *must* touch `src/ui/render.ts`; used to demo conflict prediction and the resolver).
- `will-fail-audit.md` (1 task whose natural first attempt tends to skip tests, e.g. "add CSV export *with tests for quoting and commas*"; used to demo the auditor catching a miss).

### 4. `examples/scripts/make-demo-repo.sh`
`make-demo-repo.sh [target-dir]` copies `examples/sky-todo` into a fresh directory (default `$TMPDIR/sky-todo-<timestamp>`), **excludes `.starling-answers/` and `demo-goals/*.expected.md`**, runs `git init -b main`, `bun install`, commits "chore: initial sky-todo", and prints the path. Make it idempotent and bash-3.2 compatible (macOS). Test it in your session and paste the output.

### 5. Docs
`docs/epic-01-demo-target.md` per AGENTS.md §6. Include the slot API, the auto-discovery mechanism, the list of demo goals, and how to reset a demo repo.

## Explicitly out of scope
Implementing any of the features named in the demo goals (that's what Starling's agents will do live). Any Starling code. Root config. CI.

## Definition of done (run literally, paste outputs)
1. `cd examples/sky-todo && bun install && bun test && bunx tsc --noEmit && bun run build`: all green, ≥ 25 tests.
2. Auto-discovery proof: create a throwaway `src/features/zz-test/index.ts` that registers a footer item, show a test sees it, then delete it (don't commit it).
3. Prove the bugs exist: write a throwaway script that shows a wrong `isOverdue` result for today's date with `TZ=America/Toronto`, and wrong `sortByDue` order, then delete it.
4. `bash examples/scripts/make-demo-repo.sh` produces a clean repo with one commit; `git -C <path> status` is clean; `bun test` passes there.
5. From the repo root, `bun run test` (if Epic 00's root exists on `origin/main` by the time you rebase) does **not** pick up sky-todo's tests.
6. Doc + handback written, PR opened (AGENTS.md §6).

## Git
Branch `epic/01-demo-target`, Conventional Commits scoped `examples` (e.g. `feat(examples): sky-todo slot registry`), at least 6 commits, rebase on `origin/main` before push. No merging or tagging.
