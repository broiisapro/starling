# Seeded bug answer key

Two realistic bugs live in `src/lib/dates.ts`. They are **untested on purpose**:
the committed suite only asserts the unambiguous cases, so the baseline is green
and Starling's auditor/agents have something real to find. Do not point coding
agents at this folder; `examples/scripts/make-demo-repo.sh` strips it.

Reproduce from `examples/sky-todo`.

---

## Bug A — `isOverdue` treats UTC midnight as local midnight

```bash
TZ=America/Toronto bun -e '
import { isOverdue } from "./src/lib/dates.ts"
const now = new Date(2026, 9, 27, 10, 0)   // Oct 27, 10:00 EDT
console.log("isOverdue(2026-10-27) =", isOverdue("2026-10-27", now))
'
# => isOverdue(2026-10-27) = true   (wrong: a task due today is not overdue)
```

**Cause.** `isOverdue` compares the due *instant* with `now` instead of comparing
calendar days, and `new Date('YYYY-MM-DD')` is parsed as **UTC** midnight. The due
day's midnight is always in the past by the time you look at it, so a task due
today is reported overdue all day in every timezone. West of UTC the mistake is
worse: Toronto is UTC−4/−5, so the "due day" starts at 20:00/19:00 the previous
evening, and a task due tomorrow is already overdue late tonight.

**Expected behaviour.** Compare calendar days in local time: overdue only when
the due day is strictly before today's local midnight. A task due today is not
overdue at any hour.

**Expected fix.**

```ts
export function isOverdue(due: string | undefined, now: Date = new Date()): boolean {
  if (!due) return false
  return parseDay(due).getTime() < startOfDay(now).getTime()
}
```

**Regression tests to add after the fix.**

- `isOverdue('2026-10-27', new Date(2026, 9, 27, 10, 0))` → `false` (due today).
- `isOverdue('2026-10-27', new Date(2026, 9, 27, 23, 59))` → `false` (still today).
- `isOverdue('2026-10-26', new Date(2026, 9, 27, 0, 1))` → `true` (yesterday).
- The same assertions pass under `TZ=America/Toronto`, `TZ=UTC` and
  `TZ=Asia/Tokyo`.

(The auditor should accept any implementation with that behaviour, e.g.
comparing `daysUntil(due, now) < 0`.)

---

## Bug B — `sortByDue` compares formatted strings

```bash
TZ=America/Toronto bun -e '
import { sortByDue } from "./src/lib/dates.ts"
const at = (y, m, d) => new Date(y, m - 1, d).getTime()
const todos = [
  { id: "oct-02", title: "Oct 2",  done: false, createdAt: at(2026, 10, 2), due: "2026-10-02", tags: [] },
  { id: "sep-30", title: "Sep 30", done: false, createdAt: at(2026, 9, 30), due: "2026-09-30", tags: [] },
  { id: "undated", title: "Undated", done: false, createdAt: at(2026, 5, 1), tags: [] },
]
console.log(sortByDue(todos).map((todo) => todo.id).join(", "))
'
# => oct-02, undated, sep-30
#    (wrong: Oct 2 should come after Sep 30, and the undated task should be last)
```

**Cause.** The comparator builds `M/D/YYYY` labels (`formatMdy`) and compares
them lexicographically, so `"10/2/2026"` < `"9/30/2026"` because `"1" < "9"`.
Missing due dates fall back to `formatMdy(createdAt)`, so undated todos are
scattered between dated ones instead of being grouped.

**Expected behaviour.** Dated todos ascending by calendar day; undated todos
after all dated ones; ties broken by `createdAt` (then `id` for stability).
Undated-last is the decision the answer key expects; "undated first" is not
acceptable because the badge column would jump around as dates are added.

**Expected fix.**

```ts
export function sortByDue(todos: readonly Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    if (!a.due && !b.due) return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
    if (!a.due) return 1
    if (!b.due) return -1
    return (
      parseDay(a.due).getTime() - parseDay(b.due).getTime() ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id)
    )
  })
}
```

**Regression tests to add after the fix.**

- `2026-09-30` before `2026-10-02`.
- `2026-01-02` before `2026-01-10` (string comparison gets this pair wrong too).
- Undated todo sorts after every dated todo.
- Input array is not mutated and the result is a new array.

---

## Why the baseline stays green

`src/lib/dates.test.ts` deliberately:

- tests `isOverdue` only for a day long past (2020) and a day far ahead (2099);
- tests `sortByDue` only with two dates where lexicographic and chronological
  order agree (`2026-03-04` before `2026-09-30`) and never asserts where an
  undated todo goes.

The show is better if the auditor finds these by reasoning about the diff rather
than by a red test, so do not add coverage for the cases above until the demo
task `dates-fix` runs.
