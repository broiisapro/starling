## Epic 26 Handback — Web: merge queue + cost meter

**Status:** Complete. Branch `epic/26-web-queue-metrics` @ `468fd31` (docs follow in the next commit).

**Delivered:**

- `MergeQueue` from `features/queue/index.ts`: six-column board — Waiting (pending/ready, with
  `blocked` + unmet dependency list or `queued for a slot`), Flying, Audit (auditing/fixing + `×n`
  attempt badge), Landing, On the wire (merge ordinal `#n` + 7-char merge commit, in merge order),
  Grounded (failed/conflict/cancelled). Every card is a keyboard-focusable button showing key, status
  dot, node badge and live elapsed; `conflict`/`tests-failed` details appear on hover (`title`) and via
  `aria-describedby`. Cards slide in from the direction they travelled (CSS transform + custom
  property), and the animation collapses to 0 ms under `prefers-reduced-motion`.
- `buildQueueBoard` / `assignColumn` / `wireOrder` / `unmetDependencies` / `latestMergeResult` /
  `taskElapsedMs` / `transitionOffset` in `features/queue/columns.ts`: every column decision is a pure,
  tested function (plan task with no run, merged task with no merge event, duplicate merges, cancelled
  tasks, missing dependencies, clock skew).
- `MetricsPanel` from `features/metrics/index.ts`: cost meter (API `$0.03` · local `$0.00` with a
  `local` badge · saved `$0.01`, plus local call count and total tokens), a two-segment SVG
  API/local token split bar with exact-count tooltips and `<title>`/`<desc>`, an agents-active
  sparkline from `history`, merged/failed counters, a ticking elapsed clock and throughput per 10
  minutes. All digits are tabular with minimum widths, so nothing reflows as values change.
- `formatUsd` / `formatTokens` / `formatTokensExact` / `formatDuration` / `formatRate` / `shortSha` in
  `features/metrics/format.ts`; `costBreakdown`, `tokenSplit`, `liveElapsedMs`, `sampleIntervalMs`,
  `throughputPer10Min` in `cost.ts`; `sparklineGeometry` / `seriesFromHistory` in `sparkline.ts`;
  `useNow` / `usePrefersReducedMotion` in `hooks.ts`; the shared reduced-motion stylesheet in
  `motion.ts`.
- `handshake.ts` in each feature mirroring §8 `MergeQueueProps` / `MetricsPanelProps` verbatim with the
  required header comment. Local `STATUS_STYLE` palette in `features/queue/palette.ts` until C1.
- `Playground.tsx` per feature, driven by `fixtures/runs/sky-todo-launch-day.jsonl` (`?raw`) with an
  event scrubber; the pure fold lives in `replay.ts` (`replayQueue`, `replayMetrics`) and is tested.
- 125 new tests in 8 files (queue 55, metrics 70), including a status→column table for all ten
  statuses, wire order, cost math against the recorded fixture cross-checked with core pricing,
  formatting edge cases (0, sub-cent, millions of tokens, hours), sparkline geometry, ticking vs frozen
  clocks, tooltip token counts and both reduced-motion paths.

**Key design decisions:**

- **One pure board builder** — all ambiguity (missing run, missing merge event, duplicate merge,
  cancelled, unknown dependency) is resolved in `columns.ts`, so `MergeQueue` is a dumb renderer and
  the edge cases are tested without a DOM.
- **`ready` with met dependencies stays in Waiting, labelled "queued"** — the brief defines Waiting as
  "pending or ready with unmet deps"; a seventh column would fragment a strip that must fit 1280×720.
- **The engine owns the money** — the meter displays `metrics.apiCostUsd` / `estSavedUsd` instead of
  re-pricing tokens, so it cannot drift from the engine; tests still cross-check against
  `estimateSavedUsd` from `@starling/core`.
- **Elapsed is interpolated, not derived from `run.startedAt`** — §8 `MetricsPanelProps` carries no
  `Run`; liveness is inferred from history freshness (freeze at 1.25 sample intervals + 250 ms). See
  the additive contract request below.
- **Native `title` + `sr-only` for card details instead of a floating bubble** — the board scrolls
  horizontally, so an absolute tooltip would clip at the column edge.
- **No charting dependency** — hand-rolled SVG (sparkline + two-rect split bar), matching L11 and the
  brief; nothing was added to any `package.json`.
- **Shared helpers live under `features/metrics/`** (`format`/`hooks`/`motion`) and are imported
  intra-lane by `queue`, because the brief places the formatters there; C1 moves them to `src/lib/`.
- **Tests drive the real fixture** through `StarlingEventSchema` rather than hand-written snapshots, so
  the board and meter are asserted against the same data the demo replays.

**Verification (exact commands + results):**

- `bun install` (worktree root): `Checked 133 installs across 192 packages (no changes)`.
- `bun test apps/web/src/features/queue apps/web/src/features/metrics`: **125 pass / 0 fail**, 411
  expect() calls, 8 files.
- `bun run test` (root, all workspaces): **312 pass / 0 fail**,
  `Ran 312 tests across 45 files. [282.00ms]`.
- `bun run typecheck` (all 18 workspaces): clean, no output.
- `bunx biome check apps/web/src/features/queue apps/web/src/features/metrics docs/epic-26-web-queue-metrics.md`:
  `Checked 29 files … No fixes applied`.
- `bun run check`: **fails on 9 pre-existing formatting errors outside this lane** —
  `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`, `tools/local-models/{host,ollama,smoke}.ts`,
  `tools/local-models/ollama.test.ts`, `tools/local-models/results/*.json` (double quotes / import
  order, i.e. Epic 02's tooling). Nothing in this branch touches those paths (`git status` shows only
  `apps/web/src/features/{queue,metrics}/**` and `docs/epic-26-*`). The typecheck half of `check`
  passes as shown above.
- No live network, no LLM, no opencode, no GitHub calls in any test; no `*.live.test.ts` written.
- Visual check in a browser was not possible without a route (Epic 23 owns `src/main.tsx`/routing);
  both Playgrounds are self-contained and mountable by hand for C1.

**Dependencies added:** none (card, sparkline and split bar are hand-rolled; no `package.json` edit).

**CONTRACT REQUESTS:** optional, additive — `MetricsPanelProps` could carry an explicit liveness flag
so the clock does not have to infer it:

```ts
export interface MetricsPanelProps {
  metrics?: RunMetrics;
  history: { ts: number; metrics: RunMetrics }[];
  /** Optional; when present the panel ticks only while true instead of inferring from sample age. */
  live?: boolean;
}
```

Why: §8 gives the panel no `Run`, so `run.startedAt`/`run.status` are unavailable and the panel infers
liveness from `history` timestamps (bounded overshoot ≈ 1.5 s past a finished run). Nothing is blocked:
the inference is implemented and documented, and C1 can wire `live: run.status === 'running'` when the
field exists.

**Deliberately deferred / out of scope:**

- Global store, selectors and region wiring (Epic 23 / C1).
- Sky, DAG, agent drawer and flock panels (Epics 24, 25, 32).
- Backend metrics computation and pricing (the engine + `@starling/core` own it).
- Card exit animations / FLIP measurement and column virtualisation (small plans today).
- Playground routing — they are plain mounts until the shell owns routes.
- Light-theme variants: the palette targets the dark dusk-sky shell using stock Tailwind tokens.

**Open questions / flagged tradeoffs:**

- Should `ready`-with-met-deps be visually distinct from `pending` (e.g. a subtle "dispatching" pulse)?
  It currently reads `queued for a slot`, which the brief's Waiting definition implies but does not
  spell out.
- `formatTokens(103_500)` shows `104k` (three significant digits) while the tooltip shows the exact
  `103,500`; if reviewers prefer `103.5k`, only `format.ts` changes.
- The meter shows `metrics.tasksFailed` as-is, so a task that failed an attempt and later merged still
  counts as merged (not failed) — that matches the engine's accounting, but product may want a
  "retried" chip in the Audit column later.

Closes #20
