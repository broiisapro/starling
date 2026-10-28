SPECS = []

SPECS.append(dict(nn="21", slug="server", title="Server: REST + SSE + flock endpoints", scope="server",
lane="`apps/server/**`",
goal="""Implement the hub's HTTP server, exactly matching the locked API in ARCHITECTURE §6 (runs, SSE events, replay, nodes, flock join/register/heartbeat/bundle), on Hono. Everything it serves comes from injected dependencies, so it can be built and tested now against mocks and wired to the real engine and flock hub in Wave 2.""",
deliverables="""- `createApp(deps: ServerDeps): Hono` and `startServer(deps, { port }): { url; stop() }`. `ServerDeps = { engine: EngineApi; store: Store; bus: EventBus; flock?: FlockHub; replay?: (path: string, speed?: number) => Promise<{ runId: string }>; version: string; webDist?: string }`, with `EngineApi` and `FlockHub` mirrored from §8 in `src/handshake.ts`.
- Every route in the §6 server table, with zod validation of bodies (400 with a clear message), 404s for unknown runs, and JSON errors `{ error: { code, message } }`:
  - `GET /api/runs/:id/events?since=ts`: **SSE** via Hono `streamSSE`. Backlog from `store.events(runId, since)` first, then live events from the bus filtered by runId. Keep-alive comment every 15 s. Clean unsubscribe on disconnect.
  - `GET /api/events`: an all-events SSE stream (run-scoped plus `node.*`).
  - Flock routes check `x-flock-token` via `flock.verifyToken` (401 otherwise). `GET /api/flock/bundle` streams the bundle file as `application/octet-stream`. If `flock` isn't configured, flock routes return 503 `FLOCK_DISABLED`.
  - `GET /api/flock/join` returns `JoinInfo` (no token needed, LAN only).
- Static hosting of `webDist` (if given) with an SPA fallback to `index.html`. `/api/*` is never shadowed.
- CORS for `http://localhost:5173` (the Vite dev server).
- A request log line per request through the bus `log` event (debug level).
- `src/dev.ts`: a **demo server** using `MemoryStore` from core testing plus a replay of `fixtures/runs/sky-todo-launch-day.jsonl` on a timer. `bun run dev` serves a live-looking event stream with **no engine at all**, so the web epics have something real to point at. Keep `GET /api/health`.
- Tests (Hono's `app.request`, no real ports, except one SSE test on `port: 0`): every route's happy path and validation errors; SSE backlog then live delivery order and `since` filtering; token checks; bundle streaming (temp file); SPA fallback; 503 when flock is absent.""",
oos="Implementing the engine or flock hub (siblings). Auth beyond the flock token. TLS. The web UI.",
dod=["`bun test apps/server` passes, ≥ 25 tests.",
     "`cd apps/server && bun run dev`, then `curl -N localhost:7777/api/runs/<the fixture run id>/events | head -5` shows SSE frames (paste them), then stop the server."]))

SPECS.append(dict(nn="22", slug="cli", title="CLI", scope="cli",
lane="`apps/cli/**`",
goal="""Implement the `starling` CLI per the locked surface in ARCHITECTURE §6. It should feel delightful in a terminal (this is what judges see first). In Wave 1, build every command's UX, output rendering and a **composition root** against the §8 handshake interfaces and core mocks. Real wiring to the other packages happens in Wave 2 (Epic 40).""",
deliverables="""- Commands per the §6 surface (commander + picocolors): `plan`, `run`, `replay`, `dash`, `perch`, `flock`, `status`, `doctor`, `init`. Help text with examples. `--json` where it makes sense (`plan`, `status`, `flock`).
- `src/compose.ts`: **the composition root**. `compose(config, { mode: 'mock' | 'real' })` returns `{ engine: EngineApi; flock?: FlockHub; store; bus }`. In Wave 1 only `mock` is implemented, built from core testing mocks so every command is runnable end to end with fake data. `real` throws `StarlingError('NOT_WIRED', 'wired in epic 40')`. Mirror §8 in `src/handshake.ts`.
- **Renderers** (pure, snapshot-tested) in `src/render/`:
  - `renderPlan(plan, issues)`: a table of tasks with deps and lanes, plus a lane-overlap matrix check mark.
  - `renderLive(state)`: a compact live view redrawn ≤ 4×/s. One line per task: status icon, key, node, attempts, elapsed, last agent action. Plus a footer with merged/failed counts and cost (API $ / local $0 / saved $).
  - `renderStatus(run)`.
  - `renderFlock(nodes, join)`.
  - Live redraw uses ANSI cursor movement and falls back to plain line output when `!process.stdout.isTTY`.
- `starling run` subscribes to the bus and drives `renderLive`, finishing with a summary box. `--no-dash` skips opening the browser, otherwise it prints the dashboard URL. `--record out.jsonl` appends every event to JSONL (use core schemas; no store dependency).
- `starling replay <file> [--speed]` reads JSONL (zod-validated) and renders it through `renderLive` with timing. **This is real in Wave 1**: it works today on `fixtures/runs/sky-todo-launch-day.jsonl`.
- `starling doctor` (**real**): checks bun, git ≥ 2.38, opencode on PATH and its version, an opencode model listing containing a DeepSeek V4.1 Flash id (any provider), gh auth, Ollama reachable (optional), config validity, and free RAM. Pretty ✔/✘/! output with fix hints; exit code 1 on ✘.
- `starling init` (**real**): writes `starling.config.yaml` from `defaultConfig`, with comments and the model profile auto-detected (opencode-go if present, else deepseek with `DEEPSEEK_API_KEY`, else local). Refuses to overwrite without `--force`.
- `starling perch` and `starling flock`: parse flags and render via the mock FlockHub in Wave 1.
- Tests: commander parsing for every command and flag; renderer snapshots (TTY and non-TTY); `replay` over the fixture at `--speed 1000` with output asserted; `doctor` with an injected exec fake (all ✔, and each ✘ case); `init` file content and the overwrite guard; `run` in mock mode reaching a summary.""",
oos="Real engine/flock/store wiring (Wave 2, Epic 40). The web dashboard. Packaging/publishing to npm (Wave 3).",
dod=["`bun test apps/cli` passes, ≥ 25 tests.",
     "Paste the terminal output of `bun run starling replay fixtures/runs/sky-todo-launch-day.jsonl --speed 200` (final screen) and `bun run starling doctor` into your doc."]))

SPECS.append(dict(nn="23", slug="web-shell", title="Web shell + data layer", scope="web",
lane="`apps/web/` root files (`index.html`, `vite.config.ts`, `package.json`, `tsconfig.json`, `bunfig.toml`, `src/main.tsx`, `src/index.css`), and `apps/web/src/{app,data,components,lib}/**`. **Not** `apps/web/src/features/**`: six sibling epics own those folders right now.",
goal="""Build the dashboard's frame and nervous system: layout, theme, routing, the zustand store fed by a pure event reducer, the SSE client, and a **demo mode** that replays the fixture run so the whole UI is alive with no backend. The feature panels (Sky, DAG, agents, queue, metrics, flock) are being built in parallel as plain-props components (ARCHITECTURE §8). You provide the regions and data they'll be wired into.""",
deliverables="""- **Design system**: a Tailwind v4 `@theme` in `src/index.css` with a *dusk sky* palette (deep navy → violet → amber horizon gradient background, starling-iridescent accents: teal/purple/green sheen), semantic status colours for every `TaskStatus` (export them as `STATUS_COLORS` in `src/lib/status.ts`; features will use them), and type scale and spacing tokens. Dark by default, with a light theme toggle. Components in `src/components/`: `Panel`, `Badge`, `StatusDot`, `Kbd`, `Tabs`, `Tooltip`, `EmptyState`, `Stat`. Accessible (focus rings, aria labels) and keyboard friendly.
- **Layout** (`src/app/Layout.tsx`): a top bar (logo "🐦 Starling", run picker, connection badge live/demo/offline, a demo speed control); a big centre **sky region**; a right **drawer region** (agent details); a bottom **strip** (queue + metrics); and a left or collapsible **flock region**. Each region renders a `<RegionPlaceholder name="sky" />` in Wave 1 with a comment `// WIRED AT C1: <SkyView {...skyProps(state)} />`. Responsive down to 1280×720 (projector resolution!) and usable at 1920×1080.
- **Data layer** (`src/data/`):
  - `reducer.ts`: a pure `applyEvent(state, e): SkyState` and `initialState`. SkyState = `{ runs: Record<id, Run>; activeRunId?; events: StarlingEvent[] (active run, capped 5,000); nodes: Record<id, NodeInfo>; agentLog: Record<taskKey, AgentEvent[]> (capped 500 each); verdicts: Record<taskKey, AuditVerdict[]>; merges: MergeResult[]; metricsHistory: {ts, metrics}[]; join?: JoinInfo; connection; selectedTask? }`.
  - `store.ts`: `useSky` (zustand) with actions `ingest(e)`, `ingestMany(es)`, `selectTask`, `setActiveRun`, `setConnection`.
  - `selectors.ts`: **prop builders for every §8 feature component**: `skyProps(state)`, `dagProps`, `drawerProps`, `queueProps`, `metricsProps`, `flockProps`. These make C1 wiring a one-liner per region.
  - `sse.ts`: connect to `/api/events` and `/api/runs/:id/events?since=` with exponential-backoff reconnect and resume from the last ts.
  - `demo.ts`: imports `fixtures/runs/sky-todo-launch-day.jsonl` (`?raw`), replays it with original timing × speed (1×, 4×, 16×), loops with a 3 s pause. Demo mode activates automatically when `/api/health` fails, or via `?demo=1`.
- Mirror §8 in `src/data/handshake.ts`.
- Tests (bun test + happy-dom): the reducer over the full fixture (final state: 7 tasks, all merged, 2 nodes, one migration, verdict history for the fixed task); caps enforced; selectors produce the exact §8 prop shapes (type-level `satisfies` plus runtime checks); the SSE client with a fake EventSource (reconnect + since); Layout renders all regions; the demo controller's timing with fake timers.""",
oos="The feature components themselves (Epics 24, 25, 26, 32). Wiring them in (C1). Run-launch form (Wave 2). Any change to `apps/web/src/features/**`.",
dod=["`bun test apps/web` passes (your tests plus any sibling feature tests already on main), ≥ 25 of yours.",
     "`cd apps/web && bun run build` succeeds. Then `bun run dev`, open `/?demo=1` with a headless browser (Playwright is available via `bunx playwright` if needed; otherwise curl the HTML and test the reducer), and paste evidence that demo mode reaches the final state."]))

SPECS.append(dict(nn="24", slug="web-sky", title="Web: The Sky murmuration", scope="sky",
lane="`apps/web/src/features/sky/**` (you may also add a dependency line to `apps/web/package.json`, add-only, but prefer none).",
goal="""Build **the Sky**: the visual that makes judges lean in. A live murmuration on a canvas where every task is a bird-flock, every machine is a roost, and `main` is a telephone wire birds land on when their work merges. It's driven purely by props (`SkyViewProps`, ARCHITECTURE §8), so it works with live data, the replay, or the fixture.""",
deliverables="""- `export function SkyView(props: SkyViewProps)` from `features/sky/index.ts` (mirror §8 in `features/sky/handshake.ts`).
- **Simulation** (`sim.ts`, pure, no DOM, a seeded RNG, deterministic given inputs and dt): a boids model (separation/alignment/cohesion plus goal attraction). Each task is a **flock of ~12 birds** around a leader, so 7 tasks ≈ 84 birds; support up to 30 tasks / 360 birds at 60 fps. Each node is a **roost**: a branch silhouette at the bottom-left for the hub and bottom-right for the perches, evenly spaced, labelled with the node name. **The wire** spans the top third: a catenary curve labelled `main`.
- **State → behaviour** (`behaviour.ts`, a table you document):
  - `pending`: perched on its node's roost, still, slight bob.
  - `ready`: hopping.
  - `running`: flying a wide murmuration loop above its roost; speed and spread scale with recent agent activity (count of `agent.event`s in the last 10 s from `recent`).
  - `auditing`: tight circle, amber tint.
  - `fixing`: agitated zig-zag, coral tint.
  - `merging`: glides to the wire.
  - `merged`: perched on the wire in merge order, gentle sway.
  - `failed`: falls slowly and greys out.
  - `conflict`: two-flock flicker.
  - `cancelled`: fades.
  - **Migration** (`task.migrated` in `recent`, or a `nodeId` change): the flock flies from one roost's sky to the other's in a long arc, with a fading trail.
  - **Node joined**: a new roost grows in with a soft glow. **Node left**: its roost dims and its birds scatter.
- **Rendering** (`render.ts`, Canvas 2D): devicePixelRatio aware, resize observer, bird glyphs as tiny chevrons with an iridescent sheen, a soft motion trail (alpha fade), the dusk gradient background drawn once to an offscreen canvas, and labels (task key) on hover. Uses the status colours from `src/lib/status.ts` once that lands at C1; until then, define a local fallback palette constant with the same keys.
- **Interaction**: click hit-tests the nearest flock leader → `onSelectTask(key)`; the selected flock gets a halo; hover shows a tooltip (title, status, node, attempts).
- **Accessibility**: `reducedMotion` (or the `prefers-reduced-motion` media query) switches to a calm static layout (birds placed in their state zones, no flocking). The canvas has an aria-label and an offscreen live region describing counts by state.
- Performance: one rAF loop, pausing when the tab is hidden. No per-frame allocations in the hot loop (pre-allocated Float32Arrays). Measure: log an fps estimate in dev mode.
- `features/sky/Playground.tsx`: a dev page component that drives `SkyView` from the fixture JSONL with a scrubber (no global store), for development and the demo backup.
- Tests: sim determinism (same seed and inputs → same positions after N steps); behaviour mapping for every status; migration targets the new roost; hit-testing; reduced-motion layout; performance budget (360 birds × 600 steps of `sim.step` in < 250 ms in bun).""",
oos="The global store and layout (Epic 23). Other panels. Three.js/WebGL (L11: Canvas 2D only). Sound (Wave 2).",
dod=["`bun test apps/web/src/features/sky` passes, ≥ 15 tests.",
     "Record a short description in your doc of what the Playground looks like at t=0, mid-run and the end of the fixture (and if you can, a PNG via Playwright screenshot committed under `features/sky/__screens__/`, ≤ 300 KB each)."]))

SPECS.append(dict(nn="25", slug="web-dag-agents", title="Web: DAG + agent drawer", scope="dag",
lane="`apps/web/src/features/dag/**` and `apps/web/src/features/agents/**` (may add a dependency line to `apps/web/package.json`, add-only).",
goal="""Build the two "zoom in" panels: the **task DAG** (what depends on what, and who's where, coloured by status, with lanes on hover), and the **agent drawer** (everything about one task: its live activity stream, audit verdicts, diff and spec). Props-only components per ARCHITECTURE §8.""",
deliverables="""- `export function DagView(props: DagViewProps)` from `features/dag/index.ts`:
  - `@xyflow/react` plus `@dagrejs/dagre` (pre-installed). Layout left→right, memoised by plan id.
  - Each node card shows status (colour + icon), key, short title, node badge (hub/perch name), attempts, elapsed.
  - Edges animate while the downstream task is waiting on an upstream that's running.
  - Hovering shows the lane `owns` globs in a tooltip. Clicking calls `onSelectTask`. Selection is highlighted.
  - Fit-to-view on plan change, a minimap toggle, and keyboard navigation between nodes.
- `export function AgentDrawer(props: AgentDrawerProps)` from `features/agents/index.ts`, a right-side drawer with tabs:
  - **Activity**: the `AgentEvent` stream rendered as a readable timeline. Text as prose (markdown-lite: code spans, fenced code); tool calls as collapsible rows (tool name + one-line summary + ok/err); file edits as chips; usage as subtle footers. Auto-scrolls when at the bottom, with a "jump to latest" pill otherwise. Virtualised for 500 events.
  - **Audit**: one card per `AuditVerdict` attempt (newest first): a pass/fail banner, the checks table (name, ok, detail, duration), lane violations, and fix instructions as a numbered list.
  - **Diff**: a file list with +/− counts and a unified patch viewer with per-line add/remove colouring and collapsible files, plus a `truncated` notice.
  - **Spec**: goal, deliverables, out of scope, DoD (checkboxes ticked from the latest verdict's evidence when present), lane.
  - Header: key, title, status, node, attempts, cost. Esc closes and calls `onClose`.
- Mirror §8 in each feature's `handshake.ts`. Use a local fallback status palette until C1.
- `Playground.tsx` per feature, driven from fixtures (a plan plus agent events and verdicts reconstructed from the run JSONL with a tiny local helper).
- Tests (happy-dom + Testing Library): DAG renders a node per task and edges per dep; click → `onSelectTask`; the drawer tabs switch; the activity list renders all kinds; the verdict card shows failing checks and fix instructions; the diff viewer counts lines and handles truncated; Esc → `onClose`.""",
oos="Global store and wiring (Epic 23/C1). Sky, queue, metrics, flock panels. Fetching data. Editing anything (read-only UI).",
dod=["`bun test apps/web/src/features/dag apps/web/src/features/agents` passes, ≥ 20 tests."]))

SPECS.append(dict(nn="26", slug="web-queue-metrics", title="Web: merge queue + cost meter", scope="queue",
lane="`apps/web/src/features/queue/**` and `apps/web/src/features/metrics/**` (may add a dependency line to `apps/web/package.json`, add-only, but hand-rolled SVG is preferred over chart libraries).",
goal="""Build the bottom strip: the **merge queue board** (where every task is in its journey to `main`) and the **metrics panel** whose cost meter tells the open-weight story at a glance: *"$0.04 on DeepSeek · $0.00 on this laptop · you saved $1.80"*. Props-only per ARCHITECTURE §8.""",
deliverables="""- `export function MergeQueue(props: MergeQueueProps)` from `features/queue/index.ts`: a horizontal board with columns **Waiting** (pending or ready with unmet deps), **Flying** (running), **Audit** (auditing/fixing, with an attempt badge), **Landing** (merging), **On the wire** (merged, in merge order, with merge commit short sha), and **Grounded** (failed/conflict/cancelled). Compact cards (key, node badge, elapsed). Cards animate between columns (CSS transforms, respecting reduced motion). Click → `onSelectTask`. Merge results with `conflict` or `tests-failed` show the detail on hover.
- `export function MetricsPanel(props: MetricsPanelProps)` from `features/metrics/index.ts`:
  - **Cost meter**: API spend vs local spend ($0.00, with a "local" badge) and estimated savings, with a split bar of API vs local tokens and a tooltip with exact token counts.
  - **Agents active** sparkline (from `history`).
  - Counters: merged, failed, elapsed (live ticking from `run.startedAt` when running).
  - **Throughput**: tasks merged per 10 minutes.
  - All charts hand-rolled SVG: responsive, accessible (`<title>`/`<desc>`, tabular numbers), with no layout shift as numbers tick.
- Mirror §8 in each feature's `handshake.ts`. Number formatting helpers (`formatUsd`, `formatTokens`, `formatDuration`) in `features/metrics/format.ts`, unit-tested. Local fallback status palette until C1.
- `Playground.tsx` per feature driven from the fixture.
- Tests: the column assignment function for every status; the merge order on the wire; the cost meter math (API vs local vs saved) against fixture metrics; formatting edge cases (0, < $0.01, millions of tokens); sparkline path generation; reduced-motion disables transitions.""",
oos="Global store/wiring (Epic 23/C1). Sky/DAG/flock panels. Backend metrics computation (the engine does it).",
dod=["`bun test apps/web/src/features/queue apps/web/src/features/metrics` passes, ≥ 20 tests."]))
