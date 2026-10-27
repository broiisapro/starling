# Writing a goal Starling can split

Starling plans from the goal plus a repo map. It cannot see the conversation you just had, the ticket
comments, or the design doc in your head — put what matters in the goal.

## The shape

```text
<outcome(s)> + <areas, when not obvious> + <constraints>
```

Two sentences is usually right. One sentence is fine for a tight goal. A paragraph is fine when the
constraints matter.

### Good

```text
Add a persisted dark-mode toggle, live search filtering, RFC-4180 CSV export, keyboard
shortcuts (n = new, / = search, ? = help), and due-date badges; fix the overdue
calculation and date sorting in src/lib/dates.ts. Keep the existing public API and add
no dependencies.
```

Why it works: five outcomes are independent feature folders, one is a two-file bug fix, and the
constraints rule out the shared-file edits that would force serialisation.

```text
Split the settings screen into tabs (Profile, Notifications, Billing), move each tab's
form into its own component under src/settings/, and keep the current routes and URL
state. Each tab must keep its existing tests green.
```

Why it works: "split into tabs" names the decomposition boundary, and "keep routes" is a real
constraint the planner cannot infer.

### Weak, and what to do instead

| Weak goal                        | Problem                                      | Better                                                                                                                    |
| -------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| "Improve the app"                | no outcome to audit                          | "Reduce first-load JS below 150 kB and add loading skeletons to the todo list and the header."                            |
| "Refactor everything into hooks" | touches every file; lanes cannot be disjoint | "Extract data loading from `src/features/todos/` and `src/features/search/` into `src/lib/hooks/`, one feature per task." |
| "Fix the bug"                    | no reproduction, no file                     | "Fix the off-by-one in `src/lib/dates.ts` where a due date exactly at midnight is marked overdue; add a regression test." |
| "Do what the ticket says"        | Starling cannot read the ticket              | paste the acceptance criteria into the goal as bullets                                                                    |

## Multi-feature goals

A goal is a good fit when you can draw **separate ownership areas**:

- one feature folder per deliverable;
- one bug fix per file pair (source + test);
- docs pages that live in separate files.

It is a bad fit when everything funnels through one file:

- a shared component library that every task must edit;
- a central router/registry that every new feature must touch;
- a lockfile or root config change that every task needs.

If a shared file is unavoidable, say who owns it and what the others may only read. Starling's planner
turns that into `owns` vs `reads`; the lane validator then keeps the other agents out.

## Constraints worth stating

- **No new dependencies** — otherwise several tasks may each add one and fight over `package.json`.
- **Public API frozen** — prevents drive-by signature changes in unrelated tasks.
- **Test command** if it is not the auto-detected one (`testCommand` in `starling.config.yaml`).
- **Budget / fully open** if the user cares about spend or wants local models only.
- **Do not touch** generated files, migrations, or vendored code.

## Examples to copy

The demo repo ships goals with expected decompositions:

- `examples/sky-todo/demo-goals/launch-day.md` — seven tasks, five ready immediately.
- `examples/sky-todo/demo-goals/quick-wins.md` — a smaller goal with fewer lanes.
- `examples/sky-todo/demo-goals/conflict-bait.md` — deliberately awkward; useful for testing lane review.
- `examples/sky-todo/demo-goals/will-fail-audit.md` — a task expected to fail its first audit.

To try the skill safely, make a throwaway repo first:

```bash
examples/scripts/make-demo-repo.sh
# prints the new repo path; cd there, then:
/path/to/skills/starling/scripts/plan.sh --json "$(cat demo-goals/launch-day.md)"
```

Use `--dry-run` until the plan looks right. A plan can be re-run as often as you like; it writes nothing.
