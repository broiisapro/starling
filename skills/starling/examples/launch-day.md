# Worked transcript 1 — the launch-day goal

> **Illustrative transcript.** This is a hand-written example of how an agent should use the skill, not a
> recording of a real run. Timings, run IDs and cost are invented; the plan mirrors
> `examples/sky-todo/demo-goals/launch-day.expected.md`.

**Setup:** the demo repo is at `~/starling-demos/sky-todo`, clean tree, `starling` on `PATH`, and
`budget.maxUsd: 5` in `starling.config.yaml`.

---

**User:** parallelise this — dark mode, live search, CSV export, keyboard shortcuts, due-date badges, and fix
the overdue and date-sorting bugs in `src/lib/dates.ts`.

**Agent:** This has six separable areas, so I'll use the Starling skill rather than editing serially. Planning
first; nothing runs yet.

```console
$ .opencode/skills/starling/scripts/plan.sh --json "Add dark mode with a persisted toggle, live search filtering, CSV export, keyboard shortcuts (n = new, / = search, ? = help), due-date badges, and fix the overdue-calculation and date-sorting bugs in src/lib/dates.ts."
```

```json
{
  "plan": {
    "summary": "Seven lane-safe tasks: five independent features, one date fix, one dependent badge task.",
    "tasks": [
      {
        "key": "theme",
        "title": "Dark mode with a persisted toggle",
        "dependsOn": [],
        "lane": { "owns": ["src/features/theme/**"] }
      },
      {
        "key": "search",
        "title": "Live search filtering",
        "dependsOn": [],
        "lane": { "owns": ["src/features/search/**"] }
      },
      {
        "key": "csv-export",
        "title": "CSV export with correct quoting",
        "dependsOn": [],
        "lane": { "owns": ["src/features/export/**"] }
      },
      {
        "key": "shortcuts",
        "title": "Keyboard shortcuts n / ?",
        "dependsOn": [],
        "lane": { "owns": ["src/features/shortcuts/**"] }
      },
      {
        "key": "help-overlay",
        "title": "Help sheet listing shortcuts",
        "dependsOn": ["shortcuts"],
        "lane": { "owns": ["src/features/help/**"] }
      },
      {
        "key": "dates-fix",
        "title": "Fix overdue + due-date sorting",
        "dependsOn": [],
        "lane": { "owns": ["src/lib/dates.ts", "src/lib/dates.test.ts"] }
      },
      {
        "key": "due-badges",
        "title": "Due-date badges on todo rows",
        "dependsOn": ["dates-fix"],
        "lane": { "owns": ["src/features/due-dates/**"] }
      }
    ]
  },
  "issues": []
}
```

**Agent:**

| key            | title                             | owns                                        | depends on  |
| -------------- | --------------------------------- | ------------------------------------------- | ----------- |
| `theme`        | Dark mode with a persisted toggle | `src/features/theme/**`                     | —           |
| `search`       | Live search filtering             | `src/features/search/**`                    | —           |
| `csv-export`   | CSV export with correct quoting   | `src/features/export/**`                    | —           |
| `shortcuts`    | Keyboard shortcuts n / ?          | `src/features/shortcuts/**`                 | —           |
| `help-overlay` | Help sheet listing shortcuts      | `src/features/help/**`                      | `shortcuts` |
| `dates-fix`    | Fix overdue + due-date sorting    | `src/lib/dates.ts`, `src/lib/dates.test.ts` | —           |
| `due-badges`   | Due-date badges on todo rows      | `src/features/due-dates/**`                 | `dates-fix` |

Plan review: seven tasks, **no validation issues**. One folder per feature, one two-file bug fix, and the only
shared files (`src/ui/slots.ts`, `src/store/todos.ts`) are read-only contracts. Five tasks can start
immediately; `help-overlay` waits for `shortcuts`, `due-badges` waits for the date fix. Nothing owns
`package.json`, `src/main.ts` or `index.html`, so a conflict would mean a planner bug, not a plan problem.

**Agent:** Shall I launch this? It will use up to 8 parallel agents and the configured $5 budget.

**User:** yes.

**Agent:** Dry-run first, then the real run.

```console
$ .opencode/skills/starling/scripts/run.sh --dry-run "Add dark mode … fix the date bugs in src/lib/dates.ts."
plan: 7 tasks, 0 issues, maxParallel 8 — dry run, no agents launched

$ .opencode/skills/starling/scripts/run.sh --record .starling/run.jsonl "Add dark mode … fix the date bugs in src/lib/dates.ts."
run 01J9Q4H7K2 created · integration branch starling/01J9Q4/integration
5 tasks dispatched (hub: 5) · 2 waiting on dependencies
… status by exception …
[12:04] task.started   help-overlay (after shortcuts merged)
[12:06] audit.verdict  csv-export attempt 1 failed: missing RFC-4180 quoting test → fix instructions sent
[12:09] audit.verdict  csv-export attempt 2 passed
[12:11] task.migrated  due-badges hub → "M2 Air" (perch joined, 3 free slots)
[12:16] merge.result   due-badges merged
run finished: 7 merged, 0 failed
```

**Agent:** Done. Report:

- **Integration branch:** `starling/01J9Q4/integration` — full suite green.
- **Merged:** 7/7. `csv-export` failed its first audit (no quoting test), got fix instructions, passed on
  attempt 2. `due-badges` was rescheduled onto the M2 Air perch and merged from there.
- **Cost:** $0.34 API, 41 local-auditor calls, 0 failures. About 12 minutes wall clock.
- **Next step:** review the branch and merge it (or open a PR) when you are happy. `.starling/run.jsonl` is
  replayable with `starling replay`.

The human still owns the merge to `main`; Starling treats the integration branch as a proposal.
