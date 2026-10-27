# Epic 25 — Web: DAG + agent drawer

## Goal

The two "zoom in" panels of the dashboard:

- `DagView`: the task graph — what depends on what, coloured by status, with node badges, lane tooltips,
  animated dependency edges, keyboard navigation and a minimap toggle.
- `AgentDrawer`: everything about one task — its live activity timeline, audit verdicts, diff and spec.

Both are **props-only** per ARCHITECTURE §8. They never read the global store, never fetch, never write.
The shell (Epic 23) owns selection and data; this epic owns rendering.

## How it works

### The DAG (`apps/web/src/features/dag/`)

- `layout.ts` runs `@dagrejs/dagre` with `rankdir: 'LR'` over the plan's tasks and edges. Dagre output is
  pure data (`Record<taskKey, {x, y}>`) and is memoised by plan id (plans are immutable once
  `plan.created` fires), so a stream of agent events never re-runs layout.
- `DagView.tsx` maps that layout onto `@xyflow/react` nodes (`type: 'task'`) and edges. Edges carry
  `animated: true` exactly when the upstream task is live (`running | auditing | fixing | merging`) and
  the downstream task is waiting (`pending | ready`) — see `edgeAnimates` in `status.ts`.
- `TaskNode.tsx` is the custom node: status dot/icon/label, mono key, truncated title, node badge
  (`run.nodeId`, or `unassigned`), attempt count, elapsed. Hovering reveals the lane's `owns` globs.
- Selection is **controlled**: clicking a node calls `onSelectTask(key)`; the next render highlights
  `selectedTask`. The canvas is one tab stop and `ArrowLeft/Right/Up/Down` move selection to the nearest
  node in that direction (`pickNeighbour`: primary distance + 2× cross-axis drift).
- Fit-to-view runs when the plan id changes (not on every status tick), so the viewport does not jump
  while the flock works. A `Panel` button toggles the `MiniMap` (`aria-pressed`).
- Status colours live in `status.ts` as a **local fallback palette** of literal Tailwind class strings,
  as instructed until the shared palette lands at C1 (ARCHITECTURE §8). Tailwind v4 only emits classes it
  can see literally, hence no interpolation.

### The drawer (`apps/web/src/features/agents/`)

One right-side `<aside role="dialog">`, four tabs, read-only.

- **Activity** (`ActivityTab.tsx` + `activity.ts`): raw `AgentEvent`s become `TimelineEntry`s sorted by
  timestamp. A `tool.call` is paired with the next `tool.result` in the same session, so a tool use is one
  collapsible row (name, one-line summary, ✓/✗, result detail). Prose renders through `MarkdownLite`
  (fenced code + inline code spans, no HTML injection). File edits render as chips, usage as a subtle
  footer. The list follows the tail while the reader is at the bottom; scrolling up pins the view and
  reveals a "jump to latest" pill. Above 80 entries it windows rows (`windowing.ts`, uniform 76px
  estimate + 8-row overscan).
- **Audit** (`AuditTab.tsx` + `audit.ts`): one card per attempt, newest first. Pass/fail banner, checks
  table (name, ok, detail, duration), lane violations, and fix instructions split into a numbered list.
- **Diff** (`DiffTab.tsx` + `diff.ts`): `DiffSummary.files` drives the file list and counts; the unified
  patch is parsed into per-file, per-line rows (add/del/context/hunk/meta) with collapsible `<details>`
  per file and a truncated-patch notice.
- **Spec** (`SpecTab.tsx` + `spec.ts`): goal, deliverables, out of scope, DoD (ticks come from the latest
  verdict's DoD check), lane owns/reads globs.
- Header: key, title, status pill, node, attempts, cost, event count. Esc is bound on `document`; the ✕
  button calls `onClose`.

### Playgrounds

- `apps/web/src/features/dag/Playground.tsx` → `/src/features/dag/playground.html` in the Vite dev server.
- `apps/web/src/features/agents/Playground.tsx` → `/src/features/agents/playground.html`.

Both read `fixtures/runs/sky-todo-launch-day.jsonl` with a `?raw` import and `run-jsonl.ts`, a tiny zod-validated
replayer that reconstructs plan, tasks, agent events, verdicts and merges. The agents playground's diff is
synthesised from `file.edited` events because the recorded run predates `DiffSummary`; the patch body is
explicitly labelled illustrative.

## Key decisions & reasoning

- **Declared node geometry (`width/height/measured/handles`) instead of relying on measurement.** React Flow
  withholds edges until both endpoints are "initialised", which in a browser comes from `ResizeObserver`.
  Declaring the geometry makes the first paint deterministic, makes SSR/`happy-dom` tests render real edges,
  and removes a one-frame flash of edgeless graph. `handles` is the fallback when measurement has not run.
- **Dagre in a pure module, memoised by plan id.** Layout is ~1ms per task; recomputing on every agent event
  would be wasteful and would fight with fit-to-view. Plan immutability makes id-keyed caching safe; the
  cache is bounded at 16 plans with a test-visible `clearLayoutCache`.
- **Animation rule as a pure predicate.** Whether an edge pulses is a product rule (waiting on live work),
  not a rendering accident, so `edgeAnimates` is unit-tested without React Flow.
- **Controlled selection, internal tab state.** The DAG selection must be shared with the drawer/shell, so it
  stays a prop. Drawer tabs are private UI state and stay local.
- **Windowing with an estimate, not measurement.** Rows are prose with variable height; a measurement
  observer per row would cost more than it saves at 500 events. Uniform 76px with 8-row overscan keeps
  scrolling smooth and the code small. Under 80 rows everything renders (tests, short sessions).
- **Tool call/result pairing in `buildTimeline`.** Pairing is data normalisation, not presentation. Doing it
  in a pure function makes "one row per tool use" testable and keeps the component dumb.
- **Diff parser is shallow by design.** The drawer needs colouring and file grouping, not hunk application.
  It never mutates the patch and tolerates truncated input (a hunk can start with no file header).
- **DoD ticks are conservative.** `AuditCheck` has no per-item evidence, so a check that passed ticks every
  item; a failed check ticks none. A green checkbox must mean an auditor said so (see CONTRACT REQUEST in the
  handback for per-item evidence).
- **Fix instructions split on newlines then sentence boundaries.** Model prose arrives as one paragraph
  often containing two instructions. The heuristic strips bullets/numbering, then splits sentences; it is
  documented and unit-tested. It may over-split abbreviations like "e.g.".
- **No modal backdrop.** The drawer is a side panel; the DAG stays interactive so the operator can keep
  exploring while reading. Esc and ✕ close it; `aria-modal` is deliberately not set.
- **`screen` is avoided in tests.** Testing Library binds `screen` to `document.body` at import time. The
  root test runner imports modules before this lane's `happy-dom` registration, so `screen` would be a set of
  throwers. Tests use each `render()`'s bound queries and re-register the DOM in `beforeEach` (another lane's
  teardown may unregister happy-dom between files).
- **Local fallback palette.** Keeping status colours in `status.ts` with literal class strings avoids both
  cross-lane imports and Tailwind's dynamic-class purge. C1 can swap it for the shared palette.

## Interfaces for future epics

Each lane exports exactly the §8 component (plus the `FEATURE` id kept from Wave 0). The mirrors live in
`handshake.ts` with the mandated header comment.

```ts
// apps/web/src/features/dag/index.ts
export const FEATURE = 'dag';
export function DagView(props: DagViewProps): JSX.Element;

// apps/web/src/features/agents/index.ts
export const FEATURE = 'agents';
export function AgentDrawer(props: AgentDrawerProps): JSX.Element;
```

Props (verbatim from ARCHITECTURE §8, mirrored locally):

```ts
export interface DagViewProps {
  plan?: Plan;
  tasks: Record<string, TaskRun>;
  selectedTask?: string;
  onSelectTask(key: string): void;
}

export interface AgentDrawerProps {
  task?: TaskSpec;
  run?: TaskRun;
  events: AgentEvent[];
  verdicts: AuditVerdict[];
  diff?: DiffSummary;
  onClose(): void;
}
```

Wiring in the shell (Epic 23) is a one-liner each:

```tsx
import { DagView } from './features/dag';
import { AgentDrawer } from './features/agents';

function TaskZoom({ run, selectedTask, setSelectedTask }) {
  return (
    <>
      <DagView
        plan={run?.plan}
        tasks={run?.tasks ?? {}}
        selectedTask={selectedTask}
        onSelectTask={setSelectedTask}
      />
      {selectedTask ? (
        <AgentDrawer
          task={run?.plan?.tasks.find((task) => task.key === selectedTask)}
          run={run?.tasks[selectedTask]}
          events={eventsFor(selectedTask)}
          verdicts={verdictsFor(selectedTask)}
          diff={diffFor(selectedTask)}
          onClose={() => setSelectedTask(undefined)}
        />
      ) : null}
    </>
  );
}
```

Other exported seams, if a sibling lane wants them (they are not part of §8 and may move):

- `dag/layout.ts`: `layoutPlan(plan)`, `layoutFor(plan)`, `pickNeighbour(...)`, `NODE_WIDTH`, `NODE_HEIGHT`.
- `dag/status.ts`: `STATUS_META`, `edgeAnimates(upstream, downstream)`.
- `agents/activity.ts`: `buildTimeline(events)`; `agents/diff.ts`: `parsePatch`, `diffFiles`.
- `agents/audit.ts`: `sortVerdicts`, `splitFixInstructions`, `checkDuration`.
- `agents/spec.ts`: `dodChecklist(items, verdict)`.
- `dag/run-jsonl.ts`: `parseRunJsonl(text)` — temporary stand-in for the store/replay client.

## Deviations from plan

- **Checks "duration"** has no contract field. The table reads an optional `durationMs` from a check (local
  extended type) and renders `—` otherwise. Filed as a CONTRACT REQUEST rather than editing core.
- **DoD evidence** is per-verdict, not per-item (contract gap). Ticks are all-or-nothing per the DoD check;
  a per-item contract is proposed in the handback.
- **Playground diff is illustrative.** The fixture records `file.edited` counts, not hunks, so the agents
  playground synthesises a patch body and says so in the UI.
- **The agents playground imports `../dag/run-jsonl`.** Both files are in this lane; duplicating the replayer
  would be worse. It is dev-only and not exported from either `index.ts`.
- **No live clock in the drawer header.** It shows attempts/cost/events; elapsed lives on the DAG card, which
  ticks once a second only while a task is live.
- **Node badge shows `run.nodeId`** because `NodeInfo.name` is not part of the drawer/DAG props. A perch shows
  its id (e.g. `M2-Air`); the shell can pass friendlier ids if it wants.

## Known limitations / deferred

- No store, SSE, fetching, or mutation — by design, Epic 23/C1 owns wiring. Both components are stateless with
  respect to run data.
- The activity window estimate is uniform; a very tall markdown message can make the scrollbar jump by a row.
  Measurement-based virtualization is deferred.
- Tail-following is not tested directly (only the jump-to-latest pill and the `isAtBottom` predicate); scroll
  metrics are not meaningful in `happy-dom`.
- `DagView` keyboard navigation is direction-nearest, not graph-topological: on a diamond it may pick the
  upper/lower sibling depending on drift. Fine for a graph, not a formal focus order.
- The diff viewer has no syntax highlighting and no word-level diffing.
- No mobile layout beyond a full-width drawer (`max-w-[560px]`) and a horizontally scrollable patch.
- Playgrounds require the Vite dev server (they use `?raw` fixture imports); they are not part of the
  production bundle or the shell routes.
- `bun run check` is red on this branch because of **pre-existing** Biome formatting errors in
  `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md` and `tools/local-models/**` (all from Epics 01/02,
  untouched here). `bun run typecheck` is green for every workspace.
