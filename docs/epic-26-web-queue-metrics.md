# Epic 26 — Web: merge queue + cost meter

## Goal

Build the bottom strip of the Starling dashboard: a **merge queue board** that shows every task on its
journey from `pending` to the wire, and a **metrics panel** whose cost meter tells the open-weight
story at a glance — _"$0.03 on DeepSeek · $0.00 on this laptop · you saved $0.01"_.

Both are props-only components per ARCHITECTURE §8. They read no global store, fetch nothing, and
never import a sibling Wave 1 package.

## How it works

### Files

| file                                  | role                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `features/queue/columns.ts`           | pure selectors: status → column, dependency gating, wire order, elapsed, animation offset    |
| `features/queue/palette.ts`           | local `TaskStatus` palette (fallback until C1)                                               |
| `features/queue/TaskCard.tsx`         | one compact, keyboard-focusable card                                                         |
| `features/queue/MergeQueue.tsx`       | the board, its six columns, injected motion CSS                                              |
| `features/queue/replay.ts`            | folds the recorded event log up to an index (used by the playground)                         |
| `features/queue/Playground.tsx`       | fixture-driven board with a scrubber                                                         |
| `features/queue/handshake.ts`         | verbatim mirror of §8 `MergeQueueProps`                                                      |
| `features/metrics/format.ts`          | `formatUsd`, `formatTokens`, `formatTokensExact`, `formatDuration`, `formatRate`, `shortSha` |
| `features/metrics/cost.ts`            | cost breakdown, token split, throughput, live elapsed                                        |
| `features/metrics/sparkline.ts`       | sparkline path geometry (plain SVG, no chart library)                                        |
| `features/metrics/hooks.ts`           | `useNow` heartbeat, `usePrefersReducedMotion`                                                |
| `features/metrics/motion.ts`          | the shared reduced-motion stylesheet                                                         |
| `features/metrics/CostMeter.tsx`      | three money numbers + API/local token split bar                                              |
| `features/metrics/SparklineChart.tsx` | accessible sparkline SVG                                                                     |
| `features/metrics/MetricsPanel.tsx`   | cost meter, agents, counters, elapsed, throughput                                            |
| `features/metrics/replay.ts`          | collects `metrics` events for the playground                                                 |
| `features/metrics/Playground.tsx`     | fixture-driven meter with a scrubber                                                         |
| `features/metrics/handshake.ts`       | verbatim mirror of §8 `MetricsPanelProps`                                                    |

### The board

`buildQueueBoard(plan, tasks, merges)` is the whole board in one pure call. The renderer only maps
columns to `<section>`s and cards to `<button>`s.

| column      | statuses                          | notes                                                                       |
| ----------- | --------------------------------- | --------------------------------------------------------------------------- |
| Waiting     | `pending`, `ready`                | card says `blocked` (with the unmet dependency list) or `queued for a slot` |
| Flying      | `running`                         |                                                                             |
| Audit       | `auditing`, `fixing`              | `×n` attempt badge                                                          |
| Landing     | `merging`                         |                                                                             |
| On the wire | `merged`                          | merge ordinal `#n` + 7-char merge commit                                    |
| Grounded    | `failed`, `conflict`, `cancelled` | status label + failed-merge detail                                          |
- **Wire order** comes from `merge.result` events (`status: 'merged'`) ascending by `ts`, deduped by
  task key (a task that merged twice keeps its first commit). Merged tasks without a merge event are
  appended by finish time, so a card can never go missing.
- **Failure detail** for `conflict` / `tests-failed` lives on `card.problem` and is rendered as the
  card's `title` (native hover) plus an `aria-describedby` target for screen readers.
- **Live elapsed** ticks once a second only while a task is in `running`/`auditing`/`fixing`/`merging`,
  and freezes on `finishedAt`; `taskElapsedMs` is pure and tested for clock skew.
- **Animation** compares each task's column with the previous render (`useRef`). A card that moves
  gets `data-arrived="true"` and `--starling-from-x: ±18px…±72px`, and the injected keyframes slide
  and fade it in from the direction it travelled. No layout is measured, so a 252-event replay costs
  nothing. Reduced motion collapses the duration to `0ms` and hard-disables the animation.
- **Accessibility**: each column is a labelled `<section>` with an `h3`; each card is a button whose
  accessible name spells out key, status, attempt, node and unmet dependencies; the board heading
  reports `n of m on the wire`.

### The meter

- **Money** comes from `RunMetrics` (`apiCostUsd`, `estSavedUsd`); the local lane is always `$0.00`
  and carries a visible `local` badge. The panel never re-prices tokens — one source of truth.
- **Split bar** is a two-segment SVG (`role="img"`, `<title>`, `<desc>`, exact counts in a hover/focus
  bubble and in an `sr-only` paragraph).
- **Sparkline** is generated from `history` (`agentsActive`), with a flat dashed placeholder before the
  first sample; `min`/`max`/sample count are in `<desc>`.
- **Counters**: merged, failed, elapsed, throughput (tasks merged per 10 minutes, from
  `tasksMerged / elapsedMs`).
- **Ticking**: `liveElapsedMs` interpolates from the newest sample while the stream is fresh
  (≤ 1.25 sample intervals + 250 ms), then freezes. On the fixture's 5 s cadence that bounds drift to
  ~1.5 s past the true end of a run.
- **No layout shift**: every stat uses `tabular-nums` and a minimum width, the sparkline has a fixed
  height, and the layout is a `flex-wrap` row rather than a grid whose tracks resize.

### Formatting rules (locale-independent on purpose)

| input                                                                            | output                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------- |
| `formatUsd(0)` / `formatUsd(0.0004)` / `formatUsd(0.0309)` / `formatUsd(1234.5)` | `$0.00` / `$<0.01` / `$0.03` / `$1,234.50`   |
| `formatTokens(742)` / `(1_234)` / `(103_500)` / `(1_234_567)`                    | `742` / `1.2k` / `104k` / `1.23M`            |
| `formatTokensExact(103_500)`                                                     | `103,500`                                    |
| `formatDuration(0)` / `(950)` / `(44_000)` / `(356_000)` / `(3_725_000)`         | `0s` / `950ms` / `44s` / `5m 56s` / `1h 02m` |
| `formatRate(11.83)`                                                              | `11.8`                                       |

## Key decisions & reasoning

- **One pure board builder.** All the ambiguity (a plan task with no run, a merged task with no merge
  event, a cancelled task, a dependency missing from the run) is resolved in `columns.ts`, so the
  component is a dumb renderer and the edge cases are unit-tested without a DOM.
- **`ready` with met dependencies stays in Waiting, labelled "queued".** The brief defines Waiting as
  "pending or ready with unmet deps"; a ready task whose deps are merged is still waiting for a slot,
  and a seventh column would fragment a strip that has to fit 1280×720. The card distinguishes the two
  cases (`blocked` + dependency list vs `queued for a slot`).
- **The engine owns the money.** Displaying `metrics.apiCostUsd` / `estSavedUsd` avoids a second
  pricing implementation drifting from `@starling/core`. The tests still cross-check the displayed
  savings against `estimateSavedUsd(localUsage)` so the meter cannot silently disagree with the engine.
- **Elapsed is interpolated, not derived from `run.startedAt`.** `MetricsPanelProps` (§8) carries no
  `Run`, so the panel infers liveness from the freshness of `history`. The overshoot is bounded and
  documented; C1 can pass an explicit `live` flag (filed as an additive contract request).
- **No chart dependency.** The brief prefers hand-rolled SVG and L11 keeps the dependency surface
  small; a sparkline and a two-rect bar do not justify a charting library on a 32 GB laptop running
  20 agents.
- **Native `title` instead of a floating tooltip on cards.** The board scrolls horizontally, which
  makes an absolutely positioned bubble clip at the column edge. `title` + `aria-describedby` keeps the
  detail reachable by mouse, keyboard and screen reader with zero layout risk.
- **Shared helpers live in `features/metrics/`.** The brief puts the formatters there; `queue` imports
  `format.ts`, `hooks.ts` and `motion.ts` intra-lane rather than duplicating three small modules.
  C1 moves all three to `src/lib/`.
- **Local palette copy.** Epic 23 owns `src/lib/status.ts` and is being written in parallel; importing
  it now would break the build, so `features/queue/palette.ts` mirrors the shape (`label`/`dot`/`text`/
  `chip`) and is swapped at C1.
- **Tests drive the real fixture.** The final board, wire order and cost numbers are asserted against
  `fixtures/runs/sky-todo-launch-day.jsonl` parsed with the production `StarlingEventSchema`, not
  hand-written snapshots — the fixture is the contract with the engine.
- **happy-dom is registered lazily per test file.** The root `bun run test` does not preload
  `apps/web/bunfig.toml`, and test files may run in any order, so `mount()` calls `ensureDom()` instead
  of relying on module-load ordering.

## Interfaces for future epics

```ts
// features/queue/index.ts
export interface MergeQueueProps {
  plan?: Plan;
  tasks: Record<string, TaskRun>;
  merges: MergeResult[];
  onSelectTask(key: string): void;
}
export function MergeQueue(props: MergeQueueProps): ReactElement;

// features/metrics/index.ts
export interface MetricsPanelProps {
  metrics?: RunMetrics;
  history: { ts: number; metrics: RunMetrics }[];
}
export function MetricsPanel(props: MetricsPanelProps): ReactElement;
```

Public helpers worth reusing (all exported from the feature `index.ts`):

```ts
// queue
export function assignColumn(status: TaskStatus): QueueColumnId;          // 'waiting' | 'flying' | … | 'grounded'
export function buildQueueBoard(plan: Plan | undefined, tasks: Record<string, TaskRun>,
                                merges: readonly MergeResult[]): QueueBoard;
export function wireOrder(merges: readonly MergeResult[],
                          tasks: Record<string, TaskRun>): WireEntry[];   // merge order + short sha
export const QUEUE_COLUMNS: readonly QueueColumnId[];
export const QUEUE_COLUMN_META: Record<QueueColumnId, QueueColumnMeta>;
export const STATUS_STYLE: Record<TaskStatus, StatusStyle>;               // fallback palette

// metrics
export function costBreakdown(metrics: RunMetrics | undefined): CostBreakdown;  // spends, tokens, shares
export function liveElapsedMs(metrics: RunMetrics | undefined,
                              history: readonly MetricsSample[], now: number): number;
export function throughputPer10Min(tasksMerged: number, elapsedMs: number): number;
export function sparklineGeometry(values: readonly number[],
                                  options: { width: number; height: number; padding?: number }):
  SparklineGeometry;                                                       // { path, areaPath, points, min, max }
export function formatUsd(value: number): string;
export function formatTokens(value: number): string;
export function formatDuration(ms: number): string;
export function SparklineChart(props: SparklineChartProps): ReactElement;  // reusable SVG sparkline
export function replayQueue(events: readonly StarlingEvent[], upTo: number): QueueReplayState;
export function replayMetrics(events: readonly StarlingEvent[], upTo: number): MetricsSample[];
```

Wiring at C1 (Epic 23's `selectors.ts` already produces these prop objects):

```tsx
// apps/web/src/app/Layout.tsx
import { MergeQueue } from '../features/queue';
import { MetricsPanel } from '../features/metrics';

<MergeQueue {...queueProps(state)} />
<MetricsPanel {...metricsProps(state)} />
```

`queueProps` must pass `state.merges` (`MergeResult[]`, in arrival order — the component sorts),
`state.runs[state.activeRunId]?.tasks ?? {}` and `state.runs[state.activeRunId]?.plan`;
`metricsProps` must pass the active run's `metrics` and `state.metricsHistory`.

C1 checklist for this lane:

1. Delete both `handshake.ts` files (types move into `@starling/core`).
2. Replace `features/queue/palette.ts` with `src/lib/status.ts`'s `STATUS_COLORS`.
3. Move `format.ts`, `hooks.ts`, `motion.ts` to `src/lib/` and update the imports in `queue`.
4. Optionally pass `live` to `MetricsPanel` (see contract request) and drop the interpolation heuristic.
5. Add the Playgrounds behind a dev-only route or delete them.

## Deviations from plan

- **Elapsed comes from `metrics.elapsedMs` interpolation, not `run.startedAt`.** `MetricsPanelProps`
  has no `Run`; see the decision above and the contract request in the handback.
- **"Show the detail on hover" is a native `title` + `sr-only` text**, not a custom floating bubble, to
  avoid clipping inside the board's horizontal scroller.
- **The Playgrounds are not routed.** Epic 23 owns `src/main.tsx` and routing; each Playground is
  self-contained and can be mounted by hand (`<Playground />`) during development.
- **Extra exports beyond the two components** (selectors, formatters, `SparklineChart`, replay
  functions) — needed for tests and reusable at C1; all documented above.
- **A local status palette ships in this lane** until C1, as instructed.

## Known limitations / deferred

- Cards have an arrival animation but no exit animation, and columns do not FLIP-measure real
  positions — a card is unmounted from one column and mounted in another with a directional slide.
- Board and panel are not virtualised. The fixture has seven tasks; a 200-task plan would want
  windowing inside each column (deferred to a later web epic).
- The interpolated clock can overshoot the true end of a run by at most ~1.5 sample intervals on a
  finished run, until the shell provides a liveness flag.
- The split-bar tooltip relies on CSS `group-hover`/`group-focus-within`; with the panel inside a
  clipped container it would need a portal (not the case in the planned layout).
- No light-theme styling: the palette assumes Epic 23's dark dusk-sky shell and uses standard Tailwind
  slate/sky/emerald tokens rather than custom `@theme` variables, so it renders sensibly before the
  design system lands.
- `bun run check` currently fails on nine pre-existing formatting issues outside this lane
  (`docs/epic-01*`, `docs/epic-02*`, `tools/local-models/**`); `bun run typecheck` passes for every
  workspace and Biome is clean for `apps/web/src/features/{queue,metrics}`.
