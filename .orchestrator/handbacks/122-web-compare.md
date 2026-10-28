## Epic 122 Handback — Web: compare two runs

**Status:** Complete. Branch `epic/122-web-compare` @ `84e4cd8` (plus the docs/handback commit on top).

**Delivered:**
- `apps/web/src/features/compare/derive.ts` — `runStats(run, now)` → `RunStats` (wall, serial, speedup, tasks, merged, failed, attempts, cost, savings, tokens, peak parallel, nodes) from the `Run` snapshot only; `peakParallel` via an interval sweep; `serialMs` / `serialBaseline` (a real synthetic `Run`, `${id}:serial`, structural `synthetic` marker, task intervals laid end to end, same plan/cost/usage); `nodeTaskCounts`, `hasTaskTimings`, `isSerialBaseline`.
- `apps/web/src/features/compare/metrics.ts` — `compareStats` with per-metric better-directions, `formatMetricValue`, `deltaChip` (▲/▼/= plus text, winner in the label). Re-exported from `derive.ts`.
- `apps/web/src/features/compare/plan-diff.ts` — `diffPlanTasks(a?, b?)` matched by key; added/removed/changed (`title`, `lane.owns`, `lane.reads`, `dependsOn`, `estimateMin`, `deliverables`); list fields compared as sets; `same` keys.
- `apps/web/src/features/compare/selection.ts` + `url.ts` — `/a`/`/b` preference order, baseline sentinel, same-run notice, clipping labels, `history.replaceState` URL sync that preserves other parameters.
- `apps/web/src/features/compare/api.ts` — optional `GET /api/compare?a=&b=` client: live-only, `AbortController` + 2 s timeout, structural guard, silent local fallback, never blocks first render.
- `apps/web/src/features/compare/ComparePage.tsx` (kind `page`) + `RunPickers`, `MetricTable`, `PairedBars`, `NodeCounts`, `PlanDiffView` — pickers, headline verdict, table with text delta chips, paired bars (wall/cost/parallelism), per-node counts, plan diff, empty/same-run/live/missing-plan states, light+dark tokens, keyboard reachable, `prefers-reduced-motion` reflected on the root.
- `apps/web/src/features/compare/index.ts` — full public surface plus the L39 manifest (`id: 'compare'`, `kind: 'page'`, `icon: 'GitCompareArrows'`, `hotkey: 'x'`, `Component` cast to `ComponentType<FeatureProps>`), `FEATURE`, and `Playground`.
- `apps/web/src/features/compare/test-fixtures.ts` — recorded launch-day run plus a deterministic second run (new id, `help-overlay` removed, `shortcuts` lane widened, costs ×1.6) and one-run/two-run `SkyState` helpers.
- `Playground.tsx` + `playground.html` + `playground-main.tsx` — event-index scrubber over the fixture, second-run pair, serial-baseline toggle.
- 72 tests across 5 files: 39 pure derivation/plan-diff assertions incl. fixture stats (wall 5m 56s, peak 4, attempts 2, 1.44×), missing timings, serial math/labelling; selection, URL and API-guard tests; 14 happy-dom page tests (baseline-only run, pair from `?a=&b=`, picker → `replaceState`, same-run notice, live note, plan diff, select-run callback, missing plans, remote rows, silent fallback, no fetch in demo).

**Key design decisions:**
- **Everything from `Run` snapshots.** `state.events` only holds the active run, so the page reads `state.runs` and `Run.metrics`; it never touches `verdicts`/`metricsHistory` (which are not per-run).
- **16 s serial tail per task** (`SERIAL_STEP_OVERHEAD_MS`). The fixture's first dispatch took 14 s; rounding up gives 512.3 s (8m 32s) vs 356 s recorded → 1.44×. One exported constant if a measured overhead replaces it.
- **The baseline is a real `Run`**, tagged structurally rather than changing frozen core, so the same formatters/stats render both sides.
- **Flight times include audit and merge** (the fixture sets `finishedAt` at the merge), making the serial claim conservative.
- **Plan list fields are unordered**; reordering globs/dependencies is not a change.
- **URL is shareable but not canonical**: the page works from state alone; the hub route is only an optional enhancement.
- **`metrics.ts` split** keeps both files readable while `derive.ts` remains the named entry point.

**Verification (exact commands + results):**
- `bun install --frozen-lockfile`: `Checked 172 installs across 225 packages (no changes)` — `bun.lock` untouched.
- `cd apps/web && bun test src/features/compare`: `72 pass / 0 fail`, `234 expect() calls`, 5 files.
- `bunx tsc --noEmit -p apps/web`: clean (no output).
- `bunx biome check apps/web/src/features/compare`: `Checked 23 files … No fixes applied`.
- `bash .orchestrator/bin/heavy.sh bun run test`:
  - packages/apps/skills/tools/evals: `1938 pass`, `4 skip`, `0 fail`, `29 snapshots, 8627 expect() calls`, 223 files.
  - apps/web: `653 pass`, `0 fail`, `4398 expect() calls`, 65 files.
- `bash .orchestrator/bin/heavy.sh bun run check`: `Checked 998 files in 554ms. No fixes applied.` then the per-workspace `tsc --noEmit` loop exited 0.
- `bash .orchestrator/bin/heavy.sh bun run --cwd apps/web build`: `✓ built in 736ms` (only the pre-existing >500 kB chunk warning).

**Dependencies added:** none.

**Carryover done:**
- No FIX REQUEST in `.orchestrator/fix-requests-w2.md` targets `apps/web/src/features/compare/**` (the folder is new in Wave 3). Requests aimed at `apps/web/src/data`, the shell/layout, `packages/core`, `packages/engine`, the CLI and the server are Wave 3b/C3 by rule and were not touched.

**C3 wiring (exact code):**

```tsx
// apps/web/src/app/AppShell.tsx — after every hook, before the playground branch
import { ComparePage } from '../features/compare';

const page = new URLSearchParams(globalThis.location.search).get('page');
if (page === 'compare') {
  return (
    <ComparePage
      state={state}
      onSelectRun={(runId) => useSky.getState().setActiveRun(runId)}
      fetchImpl={(input, init) => fetch(input, init)} // replace with Epic 110's authed client
    />
  );
}
```

```ts
// apps/web/src/lib/route.ts
export const PLAYGROUNDS = ['sky', 'dag', 'agents', 'queue', 'metrics', 'flock', 'compare'] as const;
```

```tsx
// apps/web/src/app/PlaygroundHost.tsx
const ComparePlayground = lazy(() =>
  import('../features/compare').then((m) => ({ default: m.Playground })),
);
// TITLES: compare: 'Compare runs'
// switch (name): case 'compare': return <ComparePlayground />;
```

The `x` hotkey comes from the `feature` manifest and is bound by Epic 112's registry; the page adds no document-level key listener.

**Expected `/api/compare` shape coded against** (for reconciliation with Epic 111):

```ts
{
  a?: RunStats,   // { id, goal, status, wallMs, serialMs, speedup, tasks, merged, failed,
                  //   attempts, apiCostUsd, savedUsd, tokens, peakParallel, nodes }
  b?: RunStats,
  rows?: Array<{
    metric: string, label?: string,
    format: 'duration' | 'usd' | 'count' | 'tokens' | 'multiplier',
    direction?: 'lower' | 'higher',
    a: number, b: number, delta: number,
    better: 'a' | 'b' | 'same',
  }>,
}
```

`rows` wins; `a` + `b` derive rows locally; invalid rows are dropped; an empty/mismatched payload is ignored. This is deliberately additive: Epic 111 can return a superset.

**CONTRACT REQUESTS:** none. No core, port, root-config or dependency change is needed; the baseline marker is local/structural.

**FIX REQUESTS:**
1. **Epic 111 (`apps/server`)** — publish `GET /api/compare?a=&b=` with the shape above (or tell C3 the final shape). If the route returns whole `Run` snapshots for runs whose `RunStats` lack task timings, add that arm to `parseComparePayload` in `api.ts`; today it accepts `{a,b,rows}` only.
2. **C3 / shell** — wire the page and playground as shown. `?page=compare` is not read by `lib/route.ts` today; the page self-parses `?a=&b=` but not `?page=`.
3. **Epic 112 (hotkey registry)** — bind `x` from the `feature` manifest; the folder deliberately exposes it but does not listen globally.

**Deliberately deferred / out of scope:**
- Server-side comparison, run storage, report/timeline/costs endpoints (Epic 111) and the single-run report (Epic 113).
- A task-level Gantt/timeline strip; peak parallelism is the summary the assignment asked for.
- Persisting a chosen pair outside the URL.
- Diffing goal text/constraints/locked decisions.
- Retrying or timing out per-node hub calls (the hub compare call is single-shot with a 2 s abort).
- A measured per-repo serial overhead.

**Open questions / flagged tradeoffs:**
- **The serial overhead is a stage aid, not a forecast.** 16 s/task is calibrated to the fixture's 14 s first dispatch and lands the demo line at 1.44×. If future recordings pay more or less audit/merge time, replace `SERIAL_STEP_OVERHEAD_MS` (one constant) rather than tuning the UI.
- **The baseline is conservative** because a task's fixture interval ends at merge, so its flight already includes audit+merge; a truly serial run might be slightly faster than the baseline shown.
- **Same-run is honoured, not hidden.** `?a=X&b=X` shows zero deltas plus a notice; the default picker flow auto-switches A to avoid creating that state accidentally.
- **Remote numbers can arrive after first paint.** The table switches from local to hub rows when the optional fetch resolves; no loading skeleton is shown because the local derivation is always valid.
- **Per-node names depend on `state.nodes`.** A replay without `node.joined` shows raw ids; the compare page does not invent labels.
