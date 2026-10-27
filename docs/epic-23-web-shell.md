# Epic 23 — Web shell + data layer

## Goal

Build the frame and nervous system of the Starling dashboard: the dusk-sky design system, the
five-region shell, and a data layer that turns the event stream (live or recorded) into plain props
for the six feature panels that land in parallel.

What works at the end of this epic:

- `apps/web` boots straight into the shell from `src/main.tsx`.
- With no backend (or `?demo=1`) the whole UI is alive: `fixtures/runs/sky-todo-launch-day.jsonl`
  replays with its recorded timing at 1× / 4× / 16×, loops with a 3 s pause, and reaches the final
  state (7/7 merged, 2 nodes, the failed-then-fixed `theme` audit).
- With a server, the same store is fed by `/api/events` over SSE, with exponential-backoff reconnect
  and `?since=` resume.
- Every region holds a placeholder whose replacement at C1 is a one-line spread of a selector.

## How it works

### Boot

```
src/main.tsx → <AppShell> (src/app/AppShell.tsx)
  ├─ theme      readTheme() → applyTheme(data-theme) → toggleTheme()
  ├─ route      currentRoute() from ?demo=, ?speed=, ?run= / #/runs/:id / #/demo
  ├─ data       startSkyData({ demo, speed })  (src/data/bootstrap.ts)
  │               ├─ demo=1            → playDemo() over the fixture
  │               ├─ demo=0            → connectEvents('/api/events')
  │               └─ demo undefined    → probe /api/health, then live or demo
  └─ <Layout state={useSky()} … />
```

`App.tsx` (the Wave 0 boot page) is deliberately untouched: it sits outside this epic's lane, is
still covered by its own test, and is no longer used by `main.tsx`.

### Data flow

```
StarlingEvent ──► applyEvent(state, e)   pure reducer, caps enforced
                       │
                       ▼
                 useSky (zustand)  ──► skyProps / dagProps / drawerProps /
                       │                queueProps / metricsProps / flockProps
                       ▼
              Layout regions  ──►  feature panels (C1)
```

`SkyState` is event-sourced and contains no React. The reducer keeps:

| Field | Contents | Cap |
|---|---|---|
| `runs` | run snapshots keyed by id, with `plan` and task states applied | — |
| `activeRunId` | latest `run.created` / `run.finished` | — |
| `events` | active-run events **plus** `runId === '*'` flock events | 5,000 |
| `nodes` | latest `NodeInfo` per node; `node.left` marks it `offline` | — |
| `agentLog` | normalized `AgentEvent[]` per task | 500/task |
| `verdicts` | every `AuditVerdict` per task (attempt history) | 100/task |
| `merges` | merge results in arrival order | 500 |
| `metricsHistory` | `{ ts, metrics }` samples; the latest also updates `run.metrics` | 2,000 |
| `join`, `connection`, `selectedTask` | shell state | — |

The reducer is pure: unknown/foreign-run events are ignored (except global `*`), and every write
copies the affected slice.

### Regions

```
┌──────────── top bar: 🐦 Starling · run picker · live/demo/offline · landed · speed · theme ┐
│ flock (collapsible) │   sky / flight plan (tabs)   │        agent drawer             │
├─────────────────────┴──────────────────────────────┴─────────────────────────────────┤
│                         merge queue                    │          metrics             │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- `src/app/Layout.tsx` owns the grid and every `data-region` hook (`flock`, `sky`, `drawer`,
  `strip`, `queue`, `metrics`).
- `RegionPlaceholder` renders the Wave 1 empty state. Each call site carries the exact C1 wiring:
  `{/* WIRED AT C1: <SkyView {...skyProps(state)} /> */}` (and the same for DAG, drawer, queue,
  metrics and flock).
- The flock rail collapses to 3.25 rem and reports online/total nodes without the feature panel.
- The shell was checked at 1280×720 (no horizontal overflow) and 1920×1080.
- Keyboard: skip link to the sky, roving-focus tabs (←/→/Home/End), focus-visible rings, labels on
  every control, `aria-expanded` on the flock rail.

### Demo mode

`src/data/demo.ts` imports the fixture with `?raw` (supported by both Vite and Bun), validates every
line against `StarlingEventSchema`, and chains `setTimeout`s from the recorded deltas divided by
speed. The first event is emitted synchronously so a paused tab is never empty. After the last event
it waits 3 s, calls `onLoop` (the store resets, keeping `connection: 'demo'`) and starts again.
Speed changes restart from a clean store so the replay stays deterministic.

## Key decisions & reasoning

- **One reducer, no side effects.** Feature epics get plain props and never read the store; the
  store only composes reducer output. This makes the whole UI replayable, testable and C1-friendlier
  than per-feature stores.
- **`events` includes global flock events.** `/api/events` streams `runId: '*'` node events on the
  same wire; dropping them would starve the Sky of roost updates. Run-scoped events from other runs
  are filtered out when a run is active, and `setActiveRun` re-filters the tail.
- **`node.left` marks a node offline instead of deleting it.** The flock panel is more useful with
  the perch's history, and the fixture's Air drops and rejoins. `node.joined` overwrites it cleanly.
- **Metric samples are the source of truth for the meter.** Intermediate `metrics` events update both
  the active run snapshot and `metricsHistory`; `run.finished` also carries a final snapshot.
- **Selectors default to real store actions.** `skyProps(state)` works as a C1 one-liner because its
  default `onSelectTask` calls `skyActions`; tests pass spies as the optional second argument. This
  is the smallest API that keeps panels pure without a provider.
- **SSE reconnect is owned by the client.** Status is `connecting → live → offline`; retries grow
  from 1 s to 30 s with ±20 % jitter, and every reconnect appends the last seen `ts` as `since`.
  `NEXT` attempts reset on a successful open.
- **Theme via `data-theme`, tokens via CSS variables.** Dark is the default; `[data-theme="light"]`
  flips only semantic surfaces/ink, so feature panels need no theme-aware code.
- **Design tokens live in `src/lib/tokens.pcss`.** The root Biome config does not enable
  `css.parser.tailwindDirectives`, so `@theme` in a `.css` file breaks `bun run check`. A `.pcss`
  file imported first by `src/index.css` is ignored by Biome but fully processed by Tailwind/Vite.
- **Core's root barrel needs a browser shim.** `@starling/core`'s index loads `config.ts`, which
  imports `node:fs` / `node:path`. The web only needs contracts, the error class and zod schemas, so
  Vite aliases those two builtins to a loud stub in `src/lib/browser-stubs.ts`.
- **A dev-only store handle** (`window.__STARLING_SKY__`, behind `import.meta.env.DEV`) makes the
  browser demo verifiable without adding production surface.

## Interfaces for future epics

Everything below is exported from `@starling/web`'s source (or its folder `index.ts`).

### State and store

```ts
export interface SkyState {
  runs: Record<string, Run>;
  activeRunId?: string;
  events: StarlingEvent[];
  nodes: Record<string, NodeInfo>;
  agentLog: Record<string, AgentEvent[]>;
  verdicts: Record<string, AuditVerdict[]>;
  merges: MergeResult[];
  metricsHistory: { ts: number; metrics: RunMetrics }[];
  join?: JoinInfo;
  connection: 'live' | 'demo' | 'offline';
  selectedTask?: string;
}

export function createInitialState(): SkyState;
export const initialState: SkyState;
export function applyEvent(state: SkyState, event: StarlingEvent): SkyState;
export function applyEvents(state: SkyState, events: readonly StarlingEvent[]): SkyState;

export interface SkyActions {
  ingest(event: StarlingEvent): void;
  ingestMany(events: readonly StarlingEvent[]): void;
  selectTask(taskKey?: string): void;
  setActiveRun(runId?: string): void;
  setConnection(connection: ConnectionState): void;
  setJoin(join: JoinInfo | undefined): void;
  reset(): void;
}
export const useSky: UseBoundStore<StoreApi<SkyState & SkyActions>>;
export const skyActions: { …same actions, stable for non-React callers };
```

### Selectors (§8 props)

```ts
export interface SelectorActions { selectTask(key: string): void; closeDrawer(): void }

export function skyProps(state: SkyState, actions?: SelectorActions): SkyViewProps;
export function dagProps(state: SkyState, actions?: SelectorActions): DagViewProps;
export function drawerProps(state: SkyState, actions?: SelectorActions): AgentDrawerProps;
export function queueProps(state: SkyState, actions?: SelectorActions): MergeQueueProps;
export function metricsProps(state: SkyState): MetricsPanelProps;
export function flockProps(state: SkyState): FlockPanelProps;
```

C1 wiring in `Layout.tsx` becomes:

```tsx
const state = useSky();

<SkyView {...skyProps(state)} />
<DagView {...dagProps(state)} />
<AgentDrawer {...drawerProps(state)} />
<MergeQueue {...queueProps(state)} />
<MetricsPanel {...metricsProps(state)} />
<FlockPanel {...flockProps(state)} />
```

`AgentDrawerProps.diff` is intentionally absent in Wave 1: the event stream carries merge summaries,
not patches. The drawer should fetch the diff lazily when it opens.

### Data transport + demo

```ts
export function connectEvents(options: ConnectOptions): SseHandle;
export function connectRunEvents(runId: string, options: Omit<ConnectOptions, 'url'>): SseHandle;
export function runEventsUrl(runId: string): string;       // /api/runs/:id/events
export function nextBackoffDelay(attempt: number, options?: BackoffOptions): number;

export function startSkyData(options?: StartSkyDataOptions): Promise<{
  mode: 'live' | 'demo';
  stop(): void;
}>;
export async function probeHealth(options?: StartSkyDataOptions): Promise<boolean>;

export function parseJsonl(raw: string, source?: string): StarlingEvent[];
export function demoEvents(): StarlingEvent[];
export function playDemo(options: DemoOptions): DemoHandle;
export function demoTimeline(events: readonly StarlingEvent[], speed: DemoSpeed): number[];
```

Example for a future run-launch panel (Wave 2):

```ts
const { mode, stop } = await startSkyData({ demo: false, speed: 4, sink: skyActions });
// …later, on unmount:
stop();
```

### Design-system API

```ts
export const STATUS_COLORS: Record<TaskStatus, StatusPalette>; // { label, description, hex, text, bg, border, dot }
export const TASK_STATUSES: readonly TaskStatus[];
export function statusPalette(status: TaskStatus): StatusPalette;

export function Panel(props: PanelProps): JSX.Element;
export function Badge(props: BadgeProps): JSX.Element;
export function StatusDot(props: StatusDotProps): JSX.Element;
export function Tabs<T extends string | number>(props: TabsProps<T>): JSX.Element;
export function Tooltip(props: TooltipProps): JSX.Element;
export function EmptyState(props: EmptyStateProps): JSX.Element;
export function Stat(props: StatProps): JSX.Element;
export function Kbd(props: KbdProps): JSX.Element;
```

Canvas code should read `STATUS_COLORS[status].hex`; DOM code should use `.text` / `.bg` /
`.border` so a theme switch keeps working.

## Deviations from plan

- **`@theme` is in `src/lib/tokens.pcss`, imported by `src/index.css`, not inline in `index.css`.**
  Root Biome (locked) rejects Tailwind directives in `.css` files. See CONTRACT REQUESTS.
- **`App.tsx` is left as the Wave 0 boot page.** The lane lists `src/main.tsx` but not `App.tsx`;
  `main.tsx` now renders `AppShell` directly. C1 can delete `App.tsx` and its test.
- **Extra files inside the lane** beyond the prompt's list: `bootstrap.ts` (health + mode selection),
  `tokens.pcss`, `test-dom.ts` (happy-dom bootstrap for root-level `bun test`), `browser-stubs.ts`,
  `speed.ts`, `cn.ts`, `format.ts`, plus tests. They keep modules small and the demo self-contained.
- **The top bar also shows `landed/total`.** Not requested, but it is shell-level progress proof and
  it makes the demo check verifiable without a feature panel.
- **`SkyRoute.demo` is optional (`undefined` = auto).** This is what allows `/api/health` failure to
  fall back to demo; `?demo=0` explicitly forces live.

## Known limitations / deferred

- Feature panels, DAG canvas, run-launch form, diff drawer and C1 wiring are out of scope.
- The event contract has no intermediate `run.status` event, so the picker shows `mapping` until
  `run.finished`; task progress is the live signal. If the engine later emits run status transitions,
  the reducer has an obvious extension point.
- No committed browser test: Playwright verification is recorded in the handback (dev + production
  preview, 1280×720 and 1920×1080). The dev-only store handle is the verification hook.
- The fixture is bundled (~116 KB raw) on every page. Acceptable for a demo; a lazy `import()` of
  `demo.ts` would move it out of the initial chunk if bundle size matters later.
- Theme choice and selected run are not persisted across reloads; only theme is written to
  localStorage (by `toggleTheme`). Demo speed comes from the URL.
- The core root barrel still drags zod/yaml/config into the web bundle. A browser-safe core entry
  would cut ~100 KB and remove the Vite aliases (CONTRACT REQUEST).
