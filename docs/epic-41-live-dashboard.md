# Epic 41 — Live dashboard: server ↔ web on real data

## Goal

Turn the dashboard from a fixture player into a live control room. `apps/server` gains the routes a
real hub needs (`/api/config/public`, `/api/runs/:id/diff/:taskKey`), the replay allow-list E21 left
open, a `startDashboard` composition entry point for the CLI, and a graceful shutdown that closes SSE
streams. `apps/web` boots live when a hub answers, lists and follows real runs, resumes its stream from
a cursor, loads drawer diffs lazily, shows the model per role in the header and keeps demo mode one
click away. `apps/server/src/dev-live.ts` gives the whole thing a no-LLM rehearsal: a scripted engine
that emits a realistic three-task run through the real bus, store and routes.

## How it works

### Server

```
createApp(deps, options)
  /api/health          version
  /api/runs*           (E21)
  /api/runs/:id/events (E21)  ── shutdownSignal aborts every open stream
  /api/events          (E21)
  /api/flock/*         (E21)
  /api/replay          path guard → injected replay (403 FORBIDDEN when outside)
  /api/runs/:id/diff/:taskKey   latest recorded DiffSummary, else 404
  /api/config/public   { version, profile, models, flockEnabled }
```

- **`startDashboard({ engine, store, bus, flock, webDist, port, … })`** (`dashboard.ts`) is the one
  call Epic 40's CLI needs. It builds `ServerDeps`, binds the Hono app with `Bun.serve` and returns the
  usual `ServerHandle` plus the resolved public config. Everything remains injected: the server never
  imports the engine, flock or store packages.
- **`/api/config/public`** (`public-config.ts`, `routes/config.ts`) projects the hub's configuration to
  four printable facts. `profile` comes from an explicit option or `STARLING_LLM_PROFILE`, defaulting
  to `opencode` (L29). With the `opencode` profile every role uses `deepseek-v4.1-flash`; otherwise the
  §5 split (DeepSeek for planner/worker/resolver, the local tag for auditor/summarizer/writer) applies.
  Per-role overrides accept a model id **or** a `ModelRef`, and a test pins the precedence.
- **`/api/runs/:id/diff/:taskKey`** (`routes/diff.ts`) scans the run's stored events newest-first for a
  payload that carries a `DiffSummary` for that task. It accepts three shapes: `{ taskKey, diff }`
  (a future `task.diff`), `{ taskKey, run, diff }` (an additive `diff` on `task.status`), and
  `{ taskKey, run, result: { diff } }` (an additive `TaskResult`). Unknown runs/tasks and "no diff
  recorded yet" are 404s with the standard envelope.
- **Replay allow-list** (`replay-paths.ts`) resolves a caller path against the repo root and admits it
  only inside `fixtures/` or `.starling/`. The check is lexical (`..` normalised) and physical
  (`realpath`), so a symlink inside `fixtures/` cannot point outside it. A rejection is 403
  `FORBIDDEN` before the replay implementation runs.
- **Graceful shutdown**: `startServer` owns an `AbortController`, passes it to the SSE routes and aborts
  it in `stop()` before force-closing the listener. `streamEvents` resolves its promise on the signal,
  removes the bus subscription and clears the keep-alive timer, so a stopped hub leaves no subscribers
  behind. Tests assert both the stream ending and the subscriber count returning to its baseline.
- **`src/dev-live.ts`** starts `startDashboard` with a scripted `EngineApi` and a `FlockHub` over core's
  `MockRegistry` (hub + a remote M2 Air). The engine builds a three-task plan with core's factories and
  publishes `run.created → repomap.ready → plan.created → task.status/agent.event/audit.verdict/
  merge.result/metrics → run.finished` on real timers. One task fails its first audit, gets fixed and
  passes on attempt 2. The run's audit verdicts carry a dev-only `diff` field so the lazy-diff route has
  content. `POST /api/runs` starts another run; `STARLING_DEV_SPEED` scales the timeline.

### Web data layer

Boot order (`data/bootstrap.ts`):

1. `GET /api/health` decides live vs demo (unless `?demo=0/1` forces it).
2. Live: `/api/runs`, `/api/flock/join`, `/api/config/public` in parallel (2 s cap) →
   `ingestRuns`, `setJoin`, `setPublicConfig`.
3. Open `/api/events` with no `since` on first boot (the backlog is the run's history), then let
   `connectEvents` resume reconnects from the last `ts`.
4. Demo: reset, synthesise a `JoinInfo` (`demoJoinInfo`), clear the config, play the fixture.

The reducer (`data/reducer.ts`) gained `ingestRuns`, `publicConfig`, and a per-run diff cache
(`diffKey(runId, taskKey)`). `run.created` no longer blindly steals the selection: it keeps an
already-hydrated snapshot (REST is fresher than the backlog) and only switches the active run when the
new one is at least as new as the current one. That is what makes "follow a newly started run" true
while a backlog replay of older runs cannot bounce the picker backwards. `metrics` updates the run it
belongs to; `run.finished` follows the same newest-wins rule.

`run.status` is handled through `data/run-status.ts`: a local interface + runtime guard for the
additive core event. The switch is typed as `Exclude<StarlingEvent, RunStatusEvent>`, so the file
compiles both before and after Epic 40 adds the member, and the exhaustiveness guard in `default`
still fails typecheck if a *known* event type is ever dropped.

Live diffs (`data/api.ts` + `AppShell`): selecting a task in live mode calls
`/api/runs/:id/diff/:taskKey` once; the result lands in the store and `drawerProps` passes it to
`AgentDrawer`. A 404 (no diff yet) is `undefined` and the drawer keeps its empty state.

Header: `TopBar` shows `auditor: <model> (<profile>)` from `/api/config/public`, with every role in a
tooltip; without the route (older hub / demo) the line is hidden. A `Demo` / `Live` button flips
`demoOverride` in `AppShell`, which restarts the data layer — the one-click fallback. `Layout` now
passes the typed additive props `paused: view !== 'sky'` to `SkyView` and `selectedTask` to
`MergeQueue`; both compile before and after core grows those fields, and the feature lanes can start
honouring them without touching the shell again.

### Browser-safe core

`data/demo.ts`, `data/sse.ts` and `lib/events.ts` import from `@starling/core/browser`; the Vite
`node:fs`/`node:path` aliases and `src/lib/browser-stubs.ts` are gone. Bundle effect:

| build | main JS | gzip |
| --- | --- | --- |
| before (aliases) | 867.08 kB | 248.15 kB |
| after (browser entry) | 840.70 kB | 239.04 kB |

That is −26.38 kB (−3.0 %) raw and −9.11 kB (−3.7 %) gzip, with no `node:` module left in the graph.

## Key decisions & reasoning

- **The server projects config; it never serves it.** `PublicConfig` exists so the dashboard can name
  models and flock mode without an API key, a provider URL or a budget crossing the wire. The shape is
  deliberately flat (role → model id) because the UI only ever prints it.
- **Diff extraction is forward-compatible instead of inventing an event.** The contract has no first
  class diff event today, but `TaskResult.diff` is real. Rather than returning 501 forever, the route
  reads any of the shapes the engine could plausibly publish. A FIX REQUEST asks Epic 49 to publish
  `task.diff` (or attach `diff` to `task.status`); the route then needs no change.
- **Feature-detect `run.status`, do not wait for core.** Epic 41 and Epic 40 land in the same wave, in
  either order. A local interface + guard + `Exclude` keeps the reducer exhaustive in both worlds; a
  literal `case 'run.status'` would fail typecheck on today's core.
- **REST hydrates, SSE tails.** The run picker must list runs that started before the tab opened; the
  stream must not downgrade those snapshots. `ingestRuns` seeds, `run.created` merges only when the run
  is unknown (or newer), and `setActiveRun` remains the explicit user choice.
- **Replay is a file read, so it gets a real boundary.** Lexical + realpath, two roots only, 403 before
  the injected implementation. `replayRoots` is injectable so tests and embedders decide the roots.
- **Shutdown aborts before force-closing.** `Bun.serve.stop(true)` closes sockets but would leave the
  bus subscription and keep-alive timer for the cancelled stream alive; aborting the signal first
  makes shutdown observable and removes them deterministically.
- **The dev-live engine is a double, not a second engine.** It composes only public core factories and
  the real store/bus/routes, so the rehearsal exercises the actual wire format. It is not imported by
  `index.ts` and has no effect on production.
- **`dev:live` lives in `apps/server`.** The root `package.json` is outside this lane, so the script is
  `apps/server/package.json#scripts.dev:live`; a FIX REQUEST asks the root owner for the one-line
  passthrough. The equivalent invocations are documented in the handback.

## Interfaces for future epics

```ts
// @starling/server
export interface DashboardOptions {
  engine: EngineApi; store: Store; bus: EventBus; flock?: FlockHub;
  webDist?: string; port?: number; hostname?: string; version?: string;
  publicConfig?: { profile?: string; models?: Partial<Record<ModelRole, string | ModelRef>> };
  replay?: ReplayFn; repoRoot?: string; replayRoots?: string[];
  keepAliveMs?: number; corsOrigins?: string[]; shutdownSignal?: AbortSignal;
}
export function startDashboard(options: DashboardOptions): DashboardHandle; // ServerHandle + publicConfig

export interface PublicConfig { version: string; profile: string; models: Record<ModelRole, string>; flockEnabled: boolean }
export function buildPublicConfig(input: PublicConfigInput | undefined, version: string, flockEnabled: boolean, env?: NodeJS.ProcessEnv): PublicConfig;
export function resolveReplayPath(candidate: string, roots: readonly string[], cwd?: string): { ok: boolean; path: string; reason?: string };
export function latestTaskDiff(events: readonly StarlingEvent[], taskKey: string): DiffSummary | undefined;
export function createScriptedEngine(options: { store: MemoryStore; bus: EventBus; speed?: number }): EngineApi & { stop(): void };
export function startDevLive(options?: { port?: number; speed?: number; autoplay?: boolean }): DevLiveServer;
```

```ts
// @starling/web data
export function fetchRuns(opts?: ApiOptions): Promise<Run[] | undefined>;
export function fetchJoinInfo(opts?: ApiOptions): Promise<JoinInfo | undefined>;
export function fetchPublicConfig(opts?: ApiOptions): Promise<PublicConfig | undefined>;
export function fetchTaskDiff(runId: string, taskKey: string, opts?: ApiOptions): Promise<DiffSummary | undefined>;
export function demoJoinInfo(origin?: string): JoinInfo;
export function isRunStatusEvent(event: StarlingEvent): event is StarlingEvent & RunStatusEvent;
export function diffKey(runId: string, taskKey: string): string;
// SkySink gained ingestRuns? / setJoin? / setPublicConfig?; SkyActions gained ingestRuns, setPublicConfig, setDiff.
// SkyExtras { paused? }; QueueExtras { selectedTask? } are exported selectors; pass them as spreads.
```

Epic 47 can read `paused` in `SkyView`; Epic 53's launch form can reuse `SkyActions.setActiveRun` after
`POST /api/runs`; Epic 49 can publish diffs in any of the accepted shapes; Epic 40 calls
`startDashboard` from the CLI.

## Deviations from plan

- **No root `dev:live` script.** Root `package.json` is an AGENTS §1 protected file. The script lives
  in `apps/server/package.json`; the equivalent commands are
  `cd apps/server && bun run dev:live` and `bun --cwd apps/server run dev:live`. FIX REQUEST in the
  handback.
- **`dev-live` publishes a dev-only `diff` on `audit.verdict`.** Real engines do not, and the contract
  has no diff event; this is how the rehearsal exercises the new lazy-diff route. It is documented in
  the source and never leaves `dev-live.ts`.
- **`RunStatusEvent` is declared locally in `apps/web/src/data/run-status.ts`** until Epic 40 adds it to
  core; the guard and `Exclude` make the switch compile on either side of that change.
- **`startDashboard` returns `DashboardHandle` (a `ServerHandle` plus `publicConfig`)** rather than a
  bare `ServerHandle`, so a CLI can print the profile it is about to use without re-reading config.
- **`POST /api/replay` now returns 403 `FORBIDDEN` for disallowed paths**, a new ApiErrorCode/status
  pair (E21 only had 400/401/404/500/501/503). Tests pin it.
- **`src/dev.ts`'s replay now respects the same allow-list** because it goes through `createApp`; the
  demo's own loop bypasses the route and is unaffected.

## Known limitations / deferred

- **Real diffs need a producer.** Until Epic 49 publishes `task.diff` (or attaches `diff`), a real run's
  Diff tab shows "no diff yet" even though the auditor saw one. The route and UI are ready.
- **Lazy diffs are fetched once per run+task.** A later fix attempt does not refresh the cached diff;
  selecting a different task and returning reuses the cache. A refresh button or a diff version is a
  future add.
- **`run.status` is plumbed but not yet published by the engine** (Epic 40 adds the type; Epic 49 wires
  the engine). Until then the reducer simply never sees it.
- **The all-events backlog still scans every run on connect** (E21's known limitation), and the diff
  route scans a run's events each call. Fine for a hub with a handful of runs.
- **`/api/config/public` reads `process.env` at request time**; changing `STARLING_LLM_PROFILE` in a
  long-lived process is reflected on the next request, but the engine itself was already composed.
- **Demo join info is synthetic** (`DEMO-7F3A`, localhost:7777): there is no hub to ask. The copy
  button and QR work; the perch command will not reach a server that is not running.
- **New-run following is newest-wins, not user-pinned.** An explicit selection is replaced when a newer
  run is created, which is what a control room wants; a future "pin this run" toggle would need a
  store flag.
- **`dev:live` is a single-process rehearsal**: no worktrees, no audit commands, no opencode, one fake
  run shape. It is not a substitute for Epic 40's real end-to-end run.
