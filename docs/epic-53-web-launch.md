# Epic 53 — Web: launch a run + run history

## Goal

Make the dashboard the only screen a demo needs. `features/launch` gives a presenter a repo picker, a
goal box with four sky-todo quick-picks, a plan preview that shows lanes and the overlap check, a
confirm gate with an honest cost estimate, and a history of past runs that opens in the rest of the
dashboard.

The panel is **props-only** (the same rule every feature follows): it never reads the zustand store,
never fetches, never imports a server client. Epic 41 wires it to `POST /api/runs`, the run list and
routing; that wiring is specified in the handback's FIX REQUESTS.

The deliverables from the assignment, mapped to files:

| Deliverable | Where |
| --- | --- |
| `LaunchPanelProps` (local, props-only) | `types.ts` |
| Repo dropdown, goal + quick-picks, agents, budget, dry run | `LaunchForm.tsx`, `goals.ts`, `form.ts` |
| Plan preview table with lanes, deps and overlap badge | `PlanPreview.tsx`, `overlap.ts` |
| “🐦 Release the flock” + confirm step with estimated cost | `LaunchPanel.tsx`, `ConfirmLaunch.tsx`, `estimate.ts` |
| Run history: status, merged/failed, cost, duration, open | `RunHistory.tsx`, `history.ts` |
| Fixture playground | `Playground.tsx`, `playground.html`, `playground-main.tsx`, `fixtures.ts` |
| Tests | `launch-pure.test.ts`, `launch-panel.test.tsx`, `playground.test.tsx` |

## How it works

### Form and validation

`LaunchForm` is a plain controlled form. Every rule lives in `form.ts` so the contract is testable
without a DOM:

- repo path required (trimmed);
- goal required, at least 10 characters (`MIN_GOAL_LENGTH`);
- agents: integer `1…64`, mirroring `MAX_PARALLEL_LIMIT` in `apps/server/src/routes/runs.ts`;
- budget: `0…1000` USD; `0` is valid and means “plan only, no API spend” (the engine's `budget.maxUsd`
  guardrail blocks dispatch at zero);
- `toLaunchInput` trims, converts the numeric strings and omits `dryRun` when false.

Errors are attached to fields with `aria-invalid` and `aria-describedby`, and each message is a
`role="alert"`. Validation runs on submit and on preview; after the first attempt, it also runs on
every edit, so a fixed field stops shouting immediately.

The four chips are buttons with `aria-pressed`. Selecting one writes the goal text from
`goals.ts` (verbatim copies of `examples/sky-todo/demo-goals/*.md`) and remembers the name. Typing in
the textarea clears the name (`editedGoal`) without touching the text.

### Preview and the overlap badge

`onPreview` is optional because there is no preview endpoint today (see FIX REQUESTS). When present,
it resolves with `{ plan, issues }`; the panel stores the request key alongside the result, so a form
edit after planning shows an “inputs changed” badge and withholds the cost estimate until the user
re-plans.

`overlap.ts` recomputes the lane check locally:

1. For every pair of tasks, `dependsOn` walks the DAG to answer “can these two be in flight at the same
   time?”. A shared lane across a dependency edge is a hand-off, not a conflict.
2. Concurrent pairs are compared with core's conservative `globsOverlap` (the same matcher the planner
   validates with), imported from `@starling/core/browser` so no Node builtins reach the bundle.
3. The server's `issues` are folded in: any `error` issue blocks the “Lanes clear” state even if the
   globs look disjoint.

The table shows `key`/title, the first two owned globs (all of them in a tooltip), dependencies and the
estimate. The badge is one of “Lanes clear”, “N lane overlaps” or “N plan errors”.

### Confirm gate and estimates

“Release the flock” validates, then opens an inline confirm region — not a modal, so the dashboard stays
visible around it. It summarizes goal, repo, agents, budget, mode and the estimate; focuses the confirm
button; Escape cancels; the form keeps everything typed. Launch errors are shown in place and the user
can retry or back out.

`estimate.ts` is deliberately a heuristic, not a forecast:

- `TASK_TOKEN_ESTIMATE` = 40k input / 6k output per task, `PLANNER_TOKEN_ESTIMATE` = 24k / 3k;
- `RETRY_FACTOR` = 1.35 (a typical run needs ~1.35 worker attempts per task);
- prices come from core's `PRICING` at **peak** DeepSeek rates; a local model in the table costs $0, so
  `--fully-open` runs estimate at zero;
- wall clock = the DAG's natural depth (max `estimateMin` per depth, summed); the width says how many
  agents can actually fly at once.

The estimate is only shown for a **fresh** preview. Without one, the confirm step says “preview to
estimate” instead of inventing a number. If the estimate exceeds the budget, a warning explains that the
engine stops dispatching at the cap.

### Run history

`history.ts` is pure: per run it derives the status label/tone (Flying, Finished, Failed, …), merged and
failed counts (conflict counts as failed), cost from `run.metrics.apiCostUsd`, and duration from
`startedAt` → `finishedAt` (or the supplied clock for a live run). The list is newest first. Rows are
real buttons with an `aria-label`; the whole row is the click target and calls `onOpenRun(id)`.

Durations are evaluated at render time. The shell re-renders on every SSE event, so a live run's clock
moves with the run; the panel itself owns no timer.

### Playground

`Playground` wires the real panel to fixtures: three runs (finished launch-day, a running conflict-bait,
a failed quick-wins), the four demo goals, three recent repos, a fake 450 ms engine and two failure
switches (“fail preview”, “fail launch”). A fixture launch prepends a `mapping` run to history, which
demonstrates the full loop without a server. Open `features/launch/playground.html` through Vite, or
mount `<Playground />` from `src/main.tsx`.

Fixtures are literals that mirror `examples/sky-todo/demo-goals/*.expected.md`, not the recorded JSONL:
the launch screen is about *starting* a run, the JSONL is about replaying one, and a `?raw` import at the
workspace root is exactly the kind of specifier that breaks in a production build (the flock lane hit
that). They are deterministic and importable in tests.

### Accessibility and keyboard

- Every control has a real label; hints and errors are wired through `aria-describedby`.
- Chips are a `<fieldset>` with an `sr-only` legend, `aria-pressed` buttons and a tooltip with the
  scenario hint.
- ⌘/Ctrl+Enter opens the confirm gate from anywhere in the form; Enter in the focused confirm button
  launches; Escape cancels.
- The success banner is a polite live region; preview/launch failures are `role="alert"`.
- Focus moves to the confirm button when the gate opens, and the panel uses `focus-visible` rings and
  `motion-reduce` for the spinner/skeleton.

## Key decisions & reasoning

- **The panel is props-only.** It was the assignment's shape and it is the architecture's rule: the shell
  owns the store, fetches and routing. Consequence: preview is optional and error handling is about
  *reporting* the shell's failure, not fixing it.
- **Budget is a local superset, not a contract edit.** `LaunchInput extends StartRunInput` with
  `budgetUsd?`. A shell handler typed `(input: StartRunInput) => …` is still assignable (a function that
  accepts less-specific input is safe for a more-specific prop), so the deliverable's signature holds.
  Filing an additive core change is in the handback rather than editing frozen contracts.
- **The overlap check is duplicated on purpose.** The planner is authoritative, but the UI must be able
  to explain the badge without another round-trip, and the preview's `issues` may arrive before the DAG
  is re-planned. Using core's `globsOverlap` keeps the semantics identical (conservative), and folding
  in `issues` means the badge can only get stricter, never loftier.
- **The estimate is explicit about its inputs.** A fake-precise number on stage is worse than “preview to
  estimate”. The constants are centralised and the UI names peak pricing, so a future cost-model change
  is one file.
- **Inline confirm, not a modal.** A launch is a deliberate stop, not a context switch: keeping the form
  and preview visible makes the “review → confirm” step auditable, and it avoids hand-rolling a focus
  trap.
- **Literal fixtures.** They double as documentation of the demo scenarios and are importable by tests;
  the recorded JSONL remains the replay source for the Sky/DAG/queue.
- **Testing-library for the UI.** The newer feature lanes (agents, layout) already use
  `@testing-library/react` with a per-lane `test-env.ts`; the older hand-rolled `react-dom/client`
  harnesses exist because of a Wave 0 quirk. Both work under the root `bun run test`, which runs
  `apps/web` in its own process (L26).
- **History cost is `apiCostUsd`, not `apiCostUsd + estSavedUsd`.** The demo's headline is local savings,
  but the history column is “what this run cost”, and the metrics strip already celebrates the saved
  amount.

## Interfaces for future epics

Everything public is exported from `apps/web/src/features/launch/index.ts`.

```ts
export interface LaunchInput extends StartRunInput {
  budgetUsd?: number;                       // advisory until core adopts it
}
export interface LaunchPreview { plan: Plan; issues: PlanIssue[] }
export interface LaunchGoal { name: string; text: string; hint?: string }
export interface LaunchPanelProps {
  onLaunch(input: LaunchInput): Promise<{ runId: string }>;
  onPreview?(input: LaunchInput): Promise<LaunchPreview>;
  recentRepos: string[];
  goals: LaunchGoal[];
  runs: Run[];
  onOpenRun(id: string): void;
}
export function LaunchPanel(props: LaunchPanelProps): ReactNode;
```

Shell wiring (Epic 41) is a one-liner plus two async functions:

```tsx
<LaunchPanel
  recentRepos={recentRepos}                 // persisted by the shell
  goals={[...DEMO_GOALS]}                   // or the shell's own list
  runs={sortedRuns(state)}                  // data/selectors.ts
  onOpenRun={(id) => skyActions.setActiveRun(id)}
  onLaunch={(input) => postRun(input)}      // POST /api/runs
  onPreview={(input) => postPreview(input)} // POST /api/runs/preview (new)
/>
```

Pure helpers the shell (or a future stats page) can reuse:

- `validateForm`, `toLaunchInput`, `initialFormValues`, `requestKey` — the same rules and identity the
  panel uses;
- `DEMO_GOALS`, `DEMO_REPO_PATH` — the sky-todo scenario list;
- `overlapReport`, `findLaneOverlaps` — the concurrent-lane view for any `Plan`;
- `summarizeRun`, `runHistory`, `runStatusLabel`, `runTone` — the history row model;
- `estimatePlanCostUsd`, `estimateMinutes`, `estimateWidth` — the confirm-step numbers;
- `Playground`, `PLAYGROUND_RUNS`, `PLAYGROUND_RECENT_REPOS`, `fixturePlan` — a fixture backend for
  demo mode or another feature's visual test.

## Deviations from plan

- **`onPreview` takes the same `LaunchInput` as `onLaunch`** (the prompt wrote `onPreview?(input)`), so
  a shell can pass one client function. `dryRun`/`budgetUsd` are ignored by a preview endpoint.
- **`LaunchGoal.hint` is additive.** The prop type still accepts `{ name, text }`; the extra field is a
  tooltip line for the chips.
- **`RunHistory` takes an optional `now`** (the prompt did not specify it). It exists for deterministic
  tests and recorded demos, matching the `now` extras in the flock/metrics lanes.
- **The confirm step shows no estimate without a preview.** The prompt asks for a confirm step showing
  estimated cost; inventing a number from the goal alone would be less honest than asking for the
  preview. When the preview endpoint lands, every launch gets the number.
- **The playground is fixture-literal, not recorded-JSONL-driven.** See above.
- **`budgetUsd` is not sent anywhere by the panel except to `onLaunch`.** The server contract has no such
  field; the FIX REQUEST covers the full path.
- **Tests use `@testing-library/react`** rather than the older hand-rolled mount helper; see the decision
  above.

## Known limitations / deferred

- **No preview endpoint** (FIX REQUEST): without `onPreview`, the preview panel explains the gap and the
  confirm gate cannot show a cost estimate.
- **Per-run budget is not enforced yet** (FIX REQUEST): the engine reads `budget.maxUsd` from config; the
  form's value reaches the shell and stops there.
- **Recent repos are not persisted by the panel.** It takes the shell's list and starts from the first
  entry; a real shell should keep the last successful repo (localStorage or the server's config).
- **Late preview responses are not cancelled.** A slow first preview can land after a second one; the
  request key makes it visibly stale, but there is no `AbortSignal` in the prop contract.
- **The overlap check is conservative and ignores `lane.reads`.** That matches the planner; a plan with
  very broad globs (`**`) will show overlaps it may not have.
- **History has no pagination or filtering**, no per-run cancel/abort, and no diff preview. The shell's
  run list is the source; the panel shows all of it.
- **Duration for a live run is a snapshot.** It updates when the shell re-renders (SSE), not on a private
  interval.
- **No `?playground=launch` route in the shell.** The feature ships `playground.html` and a mountable
  `Playground`; adding the route is a one-line FIX REQUEST for Epic 41.
