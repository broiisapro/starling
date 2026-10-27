# Epic 55 — Web panels polish (DAG, drawer, queue, metrics, flock)

## Goal

Bring every panel that is **not** the Sky up to projector quality, and finish the four carryover
items from Epic 34 and the screenshot review. Judges watch these from the back of a room, on a 1280×720
laptop and a 1920×1080 projector, so the bar is: legible at both ends, calm rather than janky, and
informative enough that a five-second glance explains what the flock is doing.

Five panels, one visual language: `features/dag`, `features/agents`, `features/queue`,
`features/metrics`, `features/flock`. All remain props-only (ARCHITECTURE §8) and read no store.

## How it works

### Shared legibility floor

`features/metrics/legibility.test.ts` scans **every** `.ts`/`.tsx` file in the five lane folders
(not just the components a test happens to render) and fails the build on four regressions:

| rule | why |
| --- | --- |
| no `text-[<12px]` | 12 px is the meta floor on a projector |
| no `text-[13px]` | 13 px is neither meta nor body; it reads as an accident |
| no `text-slate-500`…`900` (and grey/stone synonyms) | below 4.5:1 on the dusk surface |
| no `text-micro` / `text-caption` | shell tokens belong to the shell, not to a panel card |

A guard test asserts the scan covers > 60 files across all five folders, so a moved directory cannot
turn the whole suite green. All counters carry `tabular-nums`; where a digit span is wrapped, the
test looks inside the wrapper.

### DAG (`features/dag`)

- **Critical path** (`critical-path.ts`): longest dependency chain by summed `estimateMin`, computed
  once per `Plan` identity by memoised DFS. Ties break on chain length, then lexicographic key order,
  so the answer is stable across renders. A cycle (which the planner validator rejects) is guarded
  so a bad plan can never hang the dashboard. The chain is drawn as a legend chip ("critical path
  25 min · 2 tasks"), a `data-critical="true"` marker on each node, and highlighted edges.
- **Status transitions** (`use-status-flash.ts`): a card glows for `STATUS_FLASH_MS = 700` after its
  status changes. The first render never flashes — a card that mounts already `running` is not a
  transition. A second change clears the pending timer, so a 16× replay collapses to one glow instead
  of stacking animations. Reduced motion drops the animation entirely via the stylesheet.
- **Follow the action** (`follow.ts`): pure `followTarget(tasks, previousActiveKeys)`. The newest live
  task wins (it is the news); with nothing new the *oldest* live task wins, so the camera settles
  instead of jumping between two agents every tick; with nothing live the viewport stays where the
  user left it. The toggle is `aria-pressed`, and panning uses the shared `activeKeys` list.
- **Auto-fit**: re-fits whenever `Plan.id` changes (`fitView({ padding: 0.18 })`), so a new plan always
  lands framed. The manual "Fit" button animates to the same padding.
- **Lane legend on hover**: `TaskNode` reveals the task's lane (`owns` globs, optional `reads`) in a
  tooltip on hover, as the carryover asked.

### Agent drawer (`features/agents`)

- **Live header**: elapsed time ticks once a second only while the task is in a live status (and
  freezes when it stops), next to cost, tokens and the attempt count.
- **Activity tab**: `activity.ts` pairs each `tool.call` with its next `tool.result` in the same
  session, so one row per tool use with a ✓/✗ badge; identical consecutive calls collapse to
  "ran tests ×3". File-edit chips are buttons that switch the drawer to the Diff tab and scroll to
  that file. Long streams are windowed (`windowing.ts`) with a "Jump to latest" pill that appears
  only when the user has scrolled away from the tail.
- **Audit tab**: each `AuditVerdict` renders as a card with pass/fail, model, timestamp, the
  `checks` table (name, ✓/✗, detail, `durationMs` when present) and fix instructions. When an auditor
  supplies `verdict.dod`, the DoD items render as a checklist with their evidence quotes. Fixtures
  predating `dod` simply omit the checklist — the tab never fakes evidence.
- **Diff tab**: `diff.ts` parses `DiffSummary.patch` into per-file, per-line kinds. Small hunks get
  word-level highlights (`diff.ts`: `wordDiff`, `annotateWordDiffs`): a changed line is diffed
  against its counterpart token by
  token, so a one-word edit reads as one highlighted word rather than a red line and a green line.

### Metrics (`features/metrics`)

- **Cost meter**: the API figure counts up (`count-up.ts`, 550 ms, ease-out cubic) while the stream is
  live and **snaps** on a replay or scrub, because a judge stepping through events needs exact numbers.
- **Off-peak note** (`pricing.ts`): core's `PRICING` bills DeepSeek at its peak tariff on purpose
  (the `budget.maxUsd` guardrail must never under-count). Off-peak is exactly half of peak, so the
  meter shows `off-peak $0.02` under the API number with the full reasoning in the tooltip. The
  half-of-peak assumption is pinned to core's real table by a Bun test that imports `PRICING`.
- **Local calls** counter and **"you saved"** figure, with a tooltip that says what the estimate
  compares (local tokens priced at the API model they replaced) so the number is auditable rather
  than magic. `estSavedUsd` from core is preferred when present.

### Queue (`features/queue`)

- **Selected card** highlight: `selectedTask` (arriving in core from Epic 40) outlines the card and
  sets `aria-current`; the prop is optional, so the panel works before and after that lands.
- **Column-level scrolling**: each column is its own scroll container with `overscroll-contain`, so
  clicking a card cannot scroll-jump the board. The strip scrolls horizontally only.
- **Virtualisation** (`window.ts`): above 30 cards a column renders only the visible rows plus four
  of overscan, with two spacer rows keeping the scrollbar honest. Below the threshold everything
  renders — a 7-task demo should not pay for it, and tests can query every card. A column with more
  than three cards shows a `↕` affordance so a scrollable column is never invisible.
- **Node names**: `taskNodeLabel` prefers `TaskRun.nodeName` when core publishes it and falls back to
  the id, which the shell's selectors already map to a display name.

### Flock (`features/flock`)

- **Compact rail + drawer**: at 720p the rail drops to one chip per roost, losing hardware, session
  meters, lent models and task chips. "All roosts" opens a drawer with the **real** `RoostCard`s
  (same component as the projector layout, task chips included), portalled to `document.body` — the
  rail's ancestors include a `backdrop-filter`, which makes `position: fixed` resolve against the
  rail and clipped the drawer to 240 px on the first browser pass. Escape closes it and focus moves
  to the close button.
- **Honest join card**: the card shows the join code whenever `join` is present, whatever the node
  count. Without join info it is neutral ("Join info unavailable") when two or more nodes are present,
  because a live perch proves flock mode works — saying "off" there is a lie — and only says
  "Flock mode is off for this run" when the hub is genuinely alone.
- **Hardware line**: split into two `whitespace-nowrap` atoms (`darwin · arm64`, `8 cores · 16 GB`) so
  the narrow rail wraps between facts and never inside "32 GB".
- **No nested chrome**: the shell's `Panel` already frames and titles the region, so the flock panel
  brings only its summary line. A rounded card inside a rounded card cost the rail ~40 px at 720p.

### Legibility and truncation

Every panel now carries no self-drawn card frame where the shell supplies one (`queue`, `metrics`,
`flock`), recovers the height as content, keeps counters tabular, and puts anything a truncation hides
into a native `title` and the accessible name. The strip is a fixed 12 rem tall in the shell, so the
queue cards became one line (key, attempts/wire number, node, elapsed, terminal status) rather than
two — a two-line card left room for one visible card per column at 14 px type.

## Key decisions & reasoning

- **Source assertions for the legibility floor, not computed styles.** happy-dom ships no stylesheet,
  so `getComputedStyle` would silently pass. Asserting on the Tailwind classes in the source is the
  only way to enforce a floor across *every* file in the lane, including cards no test renders.
- **Critical path by estimate, not by task count.** The planner already assigns minutes; the chain
  whose estimates sum highest is the one that decides the run's wall-clock floor. Counting tasks would
  mark a wide fan-out as critical when it is not.
- **Follow prefers the oldest live task when nothing is new.** Following the *newest* on every tick
  made the camera ping-pong between two running agents — actively hostile on a projector. Settling is
  calmer and still shows live work.
- **Count-up snaps on replay.** Animation is a live-stream affordance. When a judge scrubs a recording
  they are reading numbers, so a 550 ms count-up would be a lie about the value at that timestamp.
- **`PRICING` is not imported at runtime in the browser.** `apps/web` keeps core's zod/config graph out
  of the bundle (`src/lib/events.ts` is the browser-safe path), so `pricing.ts` encodes the half-of-peak
  ratio and a Bun test imports the real `PRICING` to pin it. If DeepSeek's tariffs change, the test
  fails before the note can drift.
- **Feature-detect carryover props instead of blocking on core.** `selectedTask` and `nodeName` are
  read structurally (`TaskRunWithNodeName`) so the panel is correct before and after Epic 40 lands,
  with no `any` and no runtime branch on a version.
- **One-line queue cards.** In a fixed-height strip, 14 px body text plus a two-line card meant one
  visible card per column. The whole row is still a button whose accessible name spells out status,
  attempts, node and blocked/merge reason; the tooltip carries the rest.
- **Drawer portalled to `document.body`.** Verified in a real browser: without the portal the
  `backdrop-filter` on the rail made `fixed` resolve to the rail.

## Interfaces for future epics

- Every feature still exports exactly the §8 component with the same props (`SkyViewProps` style
  contracts untouched), plus these additive, optional props: `FlockPanel` accepts `compact`,
  `reducedMotion`, `now`; `MergeQueue` accepts `selectedTask`.
- Pure modules with no React, reusable by later panels and by tests:
  `dag/critical-path.ts` (`criticalPath(plan)`), `dag/follow.ts` (`activeKeys`, `followTarget`),
  `agents/activity.ts` (`buildTimeline`, `groupToolCalls`), `agents/diff.ts` (`parsePatch`,
  `diffFiles`, `wordDiff`, `annotateWordDiffs`),
  `queue/window.ts` (`columnWindow`), `metrics/count-up.ts`, `metrics/pricing.ts` (`peakNote`),
  `flock/format.ts` (`formatHardwareParts`, `sortRoosts`, `sessionTotals`).
- `metrics/legibility.test.ts` is a reusable enforcement pattern: point it at a folder list and it
  guards type size and contrast for any lane.
- Screenshots for docs and the demo live in `apps/web/src/features/dag/__screens__/`.

## Deviations from plan

- **Screenshots**: the DoD made them conditional on Playwright being available. It is not a dependency
  of `apps/web`, so none was added; the three shots were captured with a throwaway Playwright script
  against the Vite dev server (recorded below) and committed under the required 300 KB each.
- **Playgrounds** were updated for the behaviours they demonstrate (compact toggle in flock, the
  recorded run in queue/metrics, plan selection in the DAG) rather than restyled. No new Playground
  was added, because every panel already had one.
- **`AuditVerdict.dod` is rendered feature-detected.** The recorded fixtures predate per-item evidence,
  so the Audit screenshot shows no checklist; the checklist path is covered by a unit test with a
  verdict that supplies `dod` rather than by faking evidence in the fixture.

## Known limitations / deferred

- **Queue columns are equal width.** Five empty stages each take a sixth of the board while "On the
  wire" scrolls. Growing occupied columns proportionally is a layout judgement that belongs with the
  shell's grid (Epic 41), so it is left alone and noted here.
- **`TaskRun.nodeName` and `MergeQueueProps.selectedTask` are not in core yet.** Both are read
  structurally; the FIX REQUEST is in the handback. Until Epic 40 lands, the queue falls back to the
  node id and the shell's name mapping.
- **Audit check names wrap at their hyphens** ("definition-of-" / "done") in the narrow check-name
  column. Readable, but a wider column or a `title` on the name would be tidier.
- **The compact rail's bare task count** (a `5` next to `0/8` sessions) is explained only by its
  tooltip; at 15 rem there is no room for "5 tasks".
- **Virtualisation is per column, not per board.** Correct for the six-column board; a single-column
  phone layout would want its own threshold.
