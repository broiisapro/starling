# Worked transcript 2 — catching a bad plan before it spends money

> **Illustrative transcript.** Hand-written example, not a recording. The first plan is intentionally broken
> to show the stop sign; the second is what a clean re-plan looks like. Both are on `examples/sky-todo`.

---

**User:** split into tasks: make every screen its own component, add filters to the list, and move the
overdue logic into a shared helper. Parallelise it.

**Agent:** Three areas, but "every screen its own component" is vague. Planning first; I will not run anything
with a broken lane.

```console
$ .opencode/skills/starling/scripts/plan.sh --json "Split every screen into its own component, add filters to the todo list, and move overdue logic into a shared helper."
```

```json
{
  "plan": {
    "summary": "Three tasks: screen split, filters, dates helper.",
    "tasks": [
      { "key": "split-screens", "lane": { "owns": ["src/**", "src/main.ts"] }, "dependsOn": [] },
      { "key": "filters", "lane": { "owns": ["src/features/filters/**", "src/main.ts"] }, "dependsOn": [] },
      {
        "key": "dates-helper",
        "lane": { "owns": ["src/lib/dates.ts", "src/features/list/**"] },
        "dependsOn": []
      }
    ]
  },
  "issues": [
    {
      "severity": "error",
      "code": "lane-overlap",
      "taskKeys": ["split-screens", "filters"],
      "message": "both own src/main.ts and src/** overlaps src/features/filters/**"
    },
    {
      "severity": "error",
      "code": "lane-overlap",
      "taskKeys": ["filters", "dates-helper"],
      "message": "both own src/features/list/**"
    }
  ]
}
```

**Agent:** Stopping here — the plan is not safe.

- `split-screens` owns `src/**`, which swallows every other task.
- `split-screens` and `filters` both own `src/main.ts`.
- `filters` and `dates-helper` both own `src/features/list/**`.
- All three are roots, so they would run concurrently and conflict.

I won't edit the plan and launch it: the engine re-validates and would reject the edits anyway. The goal has
two real problems:

1. "every screen its own component" has no boundary — it can touch any file.
2. Moving overdue logic into a shared helper changes a file the filters UI already imports, so the two are
   coupled unless the helper lands first.

Two options:

- **A — narrow it:** one task owns the helper, one owns filters, and a third only owns the two files needed to
  extract the _list_ screen. Lanes disjoint, one dependency edge.
- **B — split the run:** do the helper + filters now, then the screen split as a second goal.

**User:** A. Keep the screen split to the list screen for now.

**Agent:** Re-planning with that boundary in the goal text.

```console
$ .opencode/skills/starling/scripts/plan.sh --json "Move overdue logic into src/lib/dates.ts (src/lib/dates.ts and its test only). Add filters under src/features/filters/** that read the new helper. Extract only the list screen into src/features/list/**; one task owns src/main.ts wiring. Do not touch other screens."
```

```json
{
  "plan": {
    "summary": "Helper, filters and list-screen extraction with disjoint lanes; wiring is one task.",
    "tasks": [
      {
        "key": "dates-helper",
        "lane": { "owns": ["src/lib/dates.ts", "src/lib/dates.test.ts"] },
        "dependsOn": []
      },
      { "key": "list-screen", "lane": { "owns": ["src/features/list/**"] }, "dependsOn": [] },
      { "key": "filters", "lane": { "owns": ["src/features/filters/**"] }, "dependsOn": ["dates-helper"] },
      { "key": "wiring", "lane": { "owns": ["src/main.ts"] }, "dependsOn": ["list-screen", "filters"] }
    ]
  },
  "issues": []
}
```

**Agent:** Clean: four tasks, no overlap, `wiring` last so `src/main.ts` has a single owner. The DAG is a
little narrower than the original request because we deliberately cut the other screens — say the word if you
want them as a second run.

```console
$ .opencode/skills/starling/scripts/run.sh --dry-run "Move overdue logic … Do not touch other screens."
plan: 4 tasks, 0 issues, maxParallel 8 — dry run, no agents launched
```

**Agent:** Dry run matches. Shall I launch? Budget is $5 (`budget.maxUsd`), this should use about $0.20.

**User:** go.

**Agent:** Launched. The important part of this session was the refusal: a plan with overlapping lanes is a
merge conflict waiting to happen, and the right move is to re-plan, not to run and hope.

---

## What this example demonstrates

- `plan.sh --json` is cheap and safe; use it before every run.
- `lane-overlap` is a hard stop, even when each task looks reasonable on its own.
- A goal can be repaired by naming the boundary ("only the list screen", "one task owns `src/main.ts`").
- Do not hand-edit a plan: the engine validates again, and the run would be rejected.
- If the user's request is genuinely too broad, two sequential runs beat one unsafe parallel run.
