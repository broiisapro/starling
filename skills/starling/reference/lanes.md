# Reading and reviewing lanes

A **lane** is the set of repo-relative globs a task may write. Starling validates that lanes of tasks
which can run concurrently do not overlap. This is the property that makes parallel work conflict-free by
construction — and the one thing you must check before launching.

## The plan JSON

`plan.sh --json` prints the CLI's plan object. It is either the planner result

```json
{ "plan": { "summary": "...", "tasks": [], "lockedDecisions": [] }, "issues": [] }
```

or the bare plan. Normalise with `jq '.plan // .'` and `jq '.issues // []'`.

Each task looks like:

```json
{
  "key": "dates-fix",
  "title": "Fix overdue + due-date sorting",
  "goal": "…",
  "deliverables": ["…"],
  "outOfScope": ["…"],
  "definitionOfDone": ["…", "…"],
  "dependsOn": [],
  "lane": {
    "owns": ["src/lib/dates.ts", "src/lib/dates.test.ts"],
    "reads": ["src/store/todos.ts", "src/ui/slots.ts"]
  },
  "estimateMin": 20
}
```

## The five checks

1. **Owns is non-empty** for every task (`empty-lane` otherwise).
2. **DoD is non-empty and literal** (`empty-dod` otherwise). "Tests pass" alone is weak; "`bun test
   src/features/search` passes and covers empty input" is checkable.
3. **Dependencies exist** (`missing-dep`) and form a DAG (`cycle`).
4. **Concurrent lanes are disjoint** (`lane-overlap`). A `dependsOn` edge only helps once the dependency has
   **merged**; until then the tasks cannot run together. Treat every pair of tasks as concurrent unless one
   is an ancestor of the other, and require their `owns` globs to be disjoint.
5. **Reads do not become writes.** A task that needs to change a "read-only" contract is out of scope;
   send it back to planning.

`globsOverlap` is conservative: a false positive serialises one task, a false negative causes a merge
conflict. Do not argue with a `lane-overlap` warning; change the goal or the ownership.

## Common overlap patterns

| Pattern           | Example                                      | Fix                                                            |
| ----------------- | -------------------------------------------- | -------------------------------------------------------------- |
| A shared registry | every feature edits `src/ui/slots.ts`        | make the registry a read-only contract, or give it to one task |
| Root config       | two tasks add dependencies to `package.json` | forbid new deps, or one dependency task that others depend on  |
| Integration file  | two tasks edit `src/main.ts`                 | one task owns wiring; the others export from their folders     |
| Test helper       | two tasks edit `src/test/helpers.ts`         | one task owns it; the others read it                           |
| Migration + model | both touch the schema                        | serialise with `dependsOn` _and_ keep lanes disjoint anyway    |
| Copy-paste glob   | `src/**` for one task                        | narrow it to the files that task actually needs                |

Directory semantics: a literal directory owns everything below it, so `src/ui` overlaps `src/ui/render.ts`.
A file glob like `src/*.ts` does **not** swallow `src/ui/render.ts`.

## When the validator reports an issue

Do **not** hand-edit the plan and launch. The engine validates again and the edit is lost. Instead:

1. Read the issue `code`, `message` and `taskKeys`.
2. Decide which of these is true:
   - the goal asks for two things that genuinely share a file → re-plan with a boundary ("one task owns
     the registry; others only register from their own folder");
   - the planner over-broadened a lane → re-plan with "keep each task inside one feature folder";
   - the goal is too big → split it into two runs, one after the other.
3. Re-run `plan.sh` with the revised goal.
4. If it still overlaps, show the user the table and ask them to choose the boundary. Do not launch.

The planner auto-repairs up to two times before returning issues. If issues remain after that, they are
real.

## Reviewing the DAG

- A **wide** DAG (many roots, few edges) is what you want: it means parallelism.
- A **long chain** means the goal is sequential in disguise; expect a slow run and little benefit.
- A task that everything depends on becomes a bottleneck: if it fails, the rest stalls. Prefer pushing
  shared work into a read-only contract.
- `estimateMin` is advisory. Do not optimise the plan around it.

## After the run

Lane checks also run at audit time against the real diff. A `laneViolations` entry means the agent wrote
outside its lane even though the plan was clean. That task fails and goes back for a fix; do not merge its
branch by hand, because the next task may have edited the same file.
