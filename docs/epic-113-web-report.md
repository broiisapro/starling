# Epic 113 — Web: flight report (the post-run summary page)

## Goal

One page, `?page=report`, that answers the question a judge asks after the murmuration lands: *did it
work, how much faster than one agent, what did it cost, which laptop did what, where did the auditor
push back, and what is the story?* It must read well on a projector, print cleanly, and every number
must be traceable to a run snapshot or an event. Estimated numbers say "estimate".

Everything is derived from `SkyState` alone, so the page works in live mode, in demo mode, from
`starling replay`, and against a hub that predates Epic 111's report endpoint.

## How it works

```
SkyState ──► buildFlightReport(state, runId?, now?)
              ├─ counts/timings   run.tasks[*] + run.plan
              ├─ money/tokens     latest metrics sample (live) | run.metrics (finished)
              ├─ nodes            TaskRun.nodeId + task.migrated events + state.nodes
              ├─ verdicts         state.verdicts[*] filtered to this run's task keys
              └─ story/summary    state.events (active run + '*' flock events in window)
                                 │
ReportPage ◄── FlightReport ◄────┘
   │  optional: GET /api/runs/:id/report (live only, 2 s, abortable, structural guard)
   └─ Hero · ComparisonBars · NodeBars · TaskChips · VerdictCards · StoryTimeline
```

**`derive.ts`** exports `buildFlightReport(state, runId = state.activeRunId, now = Date.now())` and
returns `FlightReport | undefined`. It is pure. The timings are:

- `wallMs = (run.finishedAt ?? now) − run.startedAt`.
- per-task flight `= finishedAt − startedAt` (`math.ts#taskFlightMs`).
- `flightWindowMs = max(startedAt…finishedAt window) − min(startedAt)` over all timed tasks.
- `serialMs = (wallMs − flightWindowMs) + Σ flight` — overhead plus the tasks one at a time.
  If **no** task has both timestamps, it falls back to `Σ plan.tasks[*].estimateMin` and adds
  `planner-estimate` to `estimated`.
- `savedMs = serialMs − wallMs`, `speedup = serialMs / wallMs` (guarded to `1` when there is no wall).
- `outcome`: `cancelled`/`failed` from the run status; `in-flight` for any non-final run; `landed`
  when a finished run merged every planned task; `partial` when some merged; `failed` otherwise.

**Money** (`moneyFor`): while the active run is unfinished, the newest `state.metricsHistory` sample
wins because it is fresher than `run.created`; a finished run uses its own `run.metrics`, which is
definitive. `metricsHistory` is not per run, so it is never trusted for a finished or non-active run.

**Nodes** (`nodes.ts`): grouped by `TaskRun.nodeId` (the reducer rewrites it on migration, so a task
belongs to the roost that finished it), named through `state.nodes`, with `migratedIn`/`migratedOut`
counted from `task.migrated` events for this run's task keys. Hub first, then by task count/flight.

**Verdicts** (`verdicts.ts`): a verdict is notable when it failed, carried lane violations or asked
for a fix. `state.verdicts` is keyed by task key only, so foreign keys are filtered out by the run's
task list. A notable attempt is paired with the next later passing attempt (`resolvedBy`) and
rendered as "theme failed attempt 1 (tests, definition-of-done), then passed on attempt 2".

**Story** (`story.ts`): `storyBeats(events, run, nodes)` takes the run's events plus global
(`runId: '*'`) flock events that fall inside the run window, and emits repomap, plan, node join/leave
(with reason), the first take-off, failed audits, migrations, the first and last landing, merge
conflicts, warn/error logs and `run.finished`. `at` is milliseconds since `run.startedAt`, so the
timeline is clock-independent. Beats are de-duplicated, capped at 12 (dropping the least narrative
beats first) and sorted chronologically.

**The page**: hero outcome, a six-`Stat` row (landed, wall, time saved, API spend, local savings,
local tokens), the serial-vs-wall bars, node bars, task chips, verdict cards and the T+m:ss timeline
with the writer's summary quoted at the bottom. Clicking a task or a verdict's "Inspect" button calls
`onSelectTask`; the run `<select>` calls `onSelectRun` and switches the report. An unfinished run
shows "Still flying." plus a live note and re-derives on a 1 s clock.

**Print**: `print:` utilities drop the chrome (run picker, print button, live note), switch to white
paper with dark ink, and keep every card off a page break (`print:break-inside-avoid`). The Print
button calls `printPage()` (`print.ts`), which is guarded on `window.print`.

**Optional live enhancement** (`live.ts`, `use-server-report.ts`): only when
`state.connection === 'live'`, the page fetches `GET /api/runs/:id/report` once per run with an
`AbortController`, a 2 s timeout and a structural guard per field. A 404/501/network error/malformed
body/`runId` mismatch leaves the local report untouched; server-provided fields win per field. The
shape coded against is in the handback. The first render never waits for it.

## Key decisions & reasoning

- **Derive, never depend.** Epic 111's endpoint is landing in parallel with no final shape. The page
  is complete from `SkyState`, and the endpoint is an enhancer that can only replace fields it proves
  it provides. This keeps the demo green if the route is missing.
- **One `now` input.** `buildFlightReport` takes an explicit clock so tests and screenshots are
  deterministic; the page feeds it `useNow` only while the run is unfinished, otherwise the
  snapshot's `finishedAt`.
- **Serial time is always an estimate.** The formula is honest about its two parts (overhead and
  sequential work) and the UI repeats the word "estimate" on the stat, the bar, the comparison
  caption and the footnote. There is no attempt to claim a measured counterfactual.
- **`TaskRun.nodeId` is final ownership.** Counting a migrated task under both roosts would double
  the task count; the migration counters carry the "who lost it" story instead. This is why the Air
  shows 2 tasks although the writer's summary says it "took three" (search started there).
- **Only first/last landings in the story.** Emitting one beat per merge produced six "Last landing"
  lines and pushed the interesting beats out of the 12-beat cap. Merge results are collected and
  emitted as exactly two beats.
- **Verdicts keyed by task only.** The reducer's `state.verdicts` has no run dimension, so the report
  filters by the run's task keys and never merges another run's history.
- **Print via Tailwind's `print:` variants**, not a second stylesheet. Every card is
  `break-inside-avoid`, the page is white/dark-ink, and interactive controls are `print:hidden`.
- **Icons via `lucide-react` strings in the manifest.** The manifest is data (`icon: 'FileText'`);
  the shell resolves it, exactly as L39 describes.

## Interfaces for future epics

- `apps/web/src/features/report/index.ts` exports the L39 manifest
  `feature = { id: 'report', title: 'Flight report', kind: 'page', icon: 'FileText', hotkey: 'r',
  Component }`, `FEATURE = 'report'`, and every pure helper below.
- `buildFlightReport`, `taskCounts`, `taskTimings`, `plannerEstimateMs`, `outcomeOf`, `moneyFor`,
  `runSummary`, `isRunOver` — reusable by a future stats/export/timeline page.
- `storyBeats(events, run, nodes)`, `MAX_STORY_BEATS` and the `StoryBeat` type can drive a shared
  "what happened" rail elsewhere.
- `nodeContributions(run, events, nodes)` for a per-roost leaderboard.
- `notableVerdicts`, `verdictHeadline`, `verdictModel` for an audit-focused view.
- `mergeServerReport(local, remote)` and `fetchServerReport` are the reconciliation seam for Epic
  111/122/123: any reader of the report route can reuse them.
- `FeatureProps` (`state`, `onSelectTask`, `onSelectRun`, `onClose`) plus optional `fetchImpl`,
  `now` on `ReportPage`; C3 must keep those extras optional.

## Deviations from plan

- **No `ml`/`sparkline` additions**; the page reuses `Stat`, `Badge`, `EmptyState` and `lucide-react`
  only. No dependencies added.
- **`goal` is the goal text (string)**, not the `Goal` object, because that is what the page renders.
- **`estimated: string[]` holds field ids** (`serialMs`, `savedMs`, `speedup`, and
  `planner-estimate` when the fallback is used) rather than prose. The UI turns them into labels.
- **Story priority trimming** is a small addition beyond "cap at 12": if more than 12 beats exist,
  outcome/plan/repomap/conflict/audit/migration beats win over node joins and logs, then the result is
  re-sorted chronologically. Without it, a busy run's story would begin with four roost joins.

## Known limitations / deferred

- **Story and summary require loaded events.** `SkyState.events` only contains the active run's
  events (plus `*` flock events), so a report for a run selected from the picker but not active has
  counters/money/verdicts but an empty story and no summary. The shell selects the active run by
  default; a future store change (per-run event archives) removes the caveat.
- **`state.verdicts` and `state.agentLog` are not per run**, so verdict pairing relies on the run's
  task keys and a clean session. Two runs with identical task keys in one tab could borrow history.
- **The 5,000-event cap** can evict a long run's early story beats; the run/task snapshots still carry
  all counters and timings, which is why those are the primary source.
- **Per-node cost is the sum of task `costUsd`**, which does not include auditor/LLM overhead that the
  metrics sample attributes to the run. The run-level spend remains the authoritative number.
- **`time saved` can be negative** (a small run with lots of overhead); it renders as "N slower"
  rather than hiding the result.
- **No export/share, comparison or Gantt** — Epics 123, 122 and 114 own those.
- **The report endpoint shape is provisional.** Only fields listed in the handback are merged; any
  extra fields Epic 111 adds are ignored until C3 reconciles them.
- **Playwright/projector screenshots** are not part of this epic (Epic 71's suite); verification is
  derivation + happy-dom coverage.
