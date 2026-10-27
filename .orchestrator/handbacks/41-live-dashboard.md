## Epic 41 Handback — Live dashboard: server ↔ web on real data

**Status:** Complete. Branch `epic/41-live-dashboard` (PR opened after this file). `Closes #28`.

**Delivered:**

- **`apps/server/src/dashboard.ts`** — `startDashboard({ engine, store, bus, flock, webDist, port, publicConfig, replay, repoRoot, … })` returning a `ServerHandle` plus the resolved `publicConfig`. This is the single entry point Epic 40 calls from the CLI; it binds Hono/Bun.serve with `idleTimeout: 0` and serves `apps/web/dist` when given.
- **`GET /api/config/public`** (`public-config.ts`, `routes/config.ts`) — `{ version, profile, models, flockEnabled }`. Profile from an explicit option or `STARLING_LLM_PROFILE`, default `opencode`; opencode → one model for every role (`deepseek-v4.1-flash`), otherwise the §5 split; per-role override accepts a model id or `ModelRef`.
- **`GET /api/runs/:id/diff/:taskKey`** (`routes/diff.ts`) — newest `DiffSummary` for a task from stored events, accepting `{taskKey,diff}`, `{taskKey,run,diff}` and `{taskKey,run,result:{diff}}`; 404 for unknown run/task or "no diff yet".
- **`POST /api/replay` allow-list** (`replay-paths.ts`) — only paths under `<repoRoot>/fixtures/` and `<repoRoot>/.starling/`, checked lexically and via `realpath` (symlink escape rejected); 403 `FORBIDDEN` before the replay implementation runs. E21's open question is closed.
- **Graceful shutdown** — `startServer` owns an `AbortController`, aborts it in `stop()` and `streamEvents` unsubscribes the bus + clears the keep-alive; a stopped hub leaves no SSE subscribers (tested by counting subscriptions).
- **`apps/server/src/dev-live.ts`** — `bun run dev:live` in `apps/server`: `startDashboard` + a scripted `EngineApi` (core factories) + a two-roost `FlockHub` over `MockRegistry`. Emits a realistic three-task run (one failed audit → fix → pass), a real `task.status/agent.event/audit.verdict/merge.result/metrics/run.finished` sequence, a dev-only diff on the verdicts, and `POST /api/runs` starts another run. `STARLING_DEV_SPEED` scales it.
- **Web live data layer** (`api.ts`, `bootstrap.ts`) — `fetchRuns`, `fetchJoinInfo` (503 = single-node, not an error), `fetchPublicConfig`, `fetchTaskDiff`, `demoJoinInfo`; live boot hydrates `/api/runs` + `/api/flock/join` + `/api/config/public` in parallel (2 s cap), then tails `/api/events`; reconnects resume via `?since=<lastTs>`. Demo mode synthesises a plausible join card and clears the config.
- **Store/reducer** — `ingestRuns`, `setPublicConfig`, `setDiff`; `run.created` merges instead of downgrading hydrated runs and follows a newer run automatically; `run.finished` uses the same newest-wins rule; per-run diff cache (`diffKey`).
- **`run.status` support** (`data/run-status.ts`) — local interface + runtime guard, switch typed as `Exclude<StarlingEvent, RunStatusEvent>`, exhaustiveness preserved. Compiles before and after Epic 40's core addition. Demo rebasing handles it too.
- **Lazy drawer diffs** — `AppShell` fetches the diff once per selected run+task in live mode; `drawerProps` passes it to `AgentDrawer`; 404 leaves the empty state.
- **Header** — `TopBar` shows `auditor: deepseek-v4.1-flash (opencode)` with all six roles in a tooltip, plus a one-click `Demo`/`Live` switch wired through `AppShell`.
- **Carryover items** — `@starling/core/browser` adopted in `data/demo.ts`, `data/sse.ts`, `lib/events.ts`; `node:fs`/`node:path` aliases and `src/lib/browser-stubs.ts` deleted; `run.status` handled; flock join supplied (live + demo); `paused: view !== 'sky'` passed to `SkyView`; `selectedTask` passed to `MergeQueue`.
- **Tests** — server 104 (was 87): config precedence/shape, diff extraction + routes, replay allow-list (including symlink escape), `startDashboard`, SSE shutdown subscriber count, scripted engine end-to-end. Web 441 (was 426): live boot/hydration, `since` resume, 503 join, demo join, synthetic `run.status`, run following/hydration precedence, lazy diffs with mocked fetch, `drawerProps`, TopBar model line + demo toggle.

**Key design decisions:**

- **Forward-compatible diff lookup instead of a fake event** — the contract has no diff event yet, so the route accepts the three plausible shapes and asks Epic 49 to publish one; no server change needed when it does.
- **Feature-detect `run.status` with a local type + `Exclude`** — a literal switch case would not typecheck on today's core; the `Exclude` keeps `never` exhaustiveness on either side of Epic 40.
- **REST hydrates, SSE tails, newest run wins** — REST snapshots survive the backlog replay; an explicitly selected older run is not bounced back by old `run.created` frames, but a genuinely newer run takes over (control-room behaviour).
- **Replay guard is lexical + physical** — `resolve` alone would let a symlink out of `fixtures/`; `realpath` closes that while still allowing a not-yet-existing path to fail later with the normal 400.
- **Abort before force-close** — `Bun.serve.stop(true)` alone closes sockets but leaves the bus subscription/timer; the signal makes shutdown observable and deterministic.
- **Demo join is synthesised** — there is no hub to ask in demo mode; the card, copy button and QR are half the panel's value, and the shape matches `JoinInfo` exactly.
- **`dev:live` in `apps/server`** — root `package.json` is an AGENTS §1 protected file; equivalent commands are documented below and the root passthrough is a FIX REQUEST.

**Verification (exact commands + results):**

- `bun install`: `Checked 162 installs across 221 packages (no changes) [9.00ms]` — clean.
- **Bundle, before** (`cd apps/web && bun run build`, with the old aliases):
  `dist/assets/index-BKBVbvdd.js 867.08 kB │ gzip: 248.15 kB` — `✓ built in 2.27s`.
- **Bundle, after** (browser entry, aliases removed):
  `dist/assets/index-ClrIJeg9.js 840.70 kB │ gzip: 239.04 kB` · `dist/assets/index-B0FG0939.css 88.64 kB │ gzip: 15.49 kB` — `✓ built in 946ms`.
  Δ main JS −26.38 kB (−3.0 %), gzip −9.11 kB (−3.7 %); no `node:` import remains.
- **Live dev script** (`cd apps/server && bun run dev:live`):
  ```
  Starling live dashboard (scripted engine) on http://localhost:7777 🐦
    REST   http://localhost:7777/api/runs
    SSE    http://localhost:7777/api/events
    config http://localhost:7777/api/config/public
  ```
  `curl -sN --max-time 1 localhost:7777/api/events | head -5`:
  ```
  : connected

  data: {"type":"node.joined","runId":"*","ts":1793131422935,"payload":{"node":{"id":"hub","name":"MacBook Pro",...}}}
  data: {"type":"node.joined","runId":"*","ts":1793131422935,"payload":{"node":{"id":"air","name":"M2 Air",...}}}
  ```
  `curl -s localhost:7777/api/config/public`:
  ```
  {"version":"0.0.0","profile":"opencode","models":{"planner":"deepseek-v4.1-flash","worker":"deepseek-v4.1-flash","resolver":"deepseek-v4.1-flash","auditor":"deepseek-v4.1-flash","summarizer":"deepseek-v4.1-flash","writer":"deepseek-v4.1-flash"},"flockEnabled":true}
  ```
  `curl -s localhost:7777/api/flock/join`:
  ```
  {"code":"DEMO-4A7C","hubUrl":"http://localhost:7777","command":"starling perch --hub http://localhost:7777 --code DEMO-4A7C"}
  ```
  `curl -s localhost:7777/api/runs/<id>/diff/theme`:
  ```
  {"files":[{"path":"src/theme.ts","added":46,"removed":2}],"patch":"+++ b/src/theme.ts\n+export function applyTheme(theme: \"dark\" | \"light\") { … }","truncated":false}
  ```
- `bun run test` (root):
  - packages: `1385 pass / 4 skip / 0 fail`, `23 snapshots, 6336 expect() calls`, `Ran 1389 tests across 166 files. [33.40s]`
  - web: `441 pass / 0 fail`, `3572 expect() calls`, `Ran 441 tests across 41 files. [3.79s]`
  - One earlier run had a single unrelated flake in `apps/web/src/features/sky/sim.test.ts` (the 360-birds perf budget, 477 ms vs 250 ms while ~20 agents were compiling); re-running the file alone passed (`21 pass / 0 fail`, 212 ms) and the final full run above was green. After the pre-push rebase a second unrelated flake appeared once in `packages/flock/src/remote-node.test.ts` (reconnect timing); it passed alone (`8 pass / 0 fail`, 346 ms) and the immediately following full run was green as pasted above.
- `bun run check`: `Checked 717 files in 636ms. No fixes applied.` then the per-workspace `tsc --noEmit` loop exited 0.
- `cd apps/server && bun test src`: `104 pass / 0 fail`, 248 expects, 10 files.
- `cd apps/web && bun test`: `441 pass / 0 fail`, 41 files.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none — every new prop/event is feature-detected locally and every new server type is server-owned.

**FIX REQUESTS:**

1. **Root `package.json`**: add `"dev:live": "bun apps/server/src/dev-live.ts"`. The prompt's DoD says `bun run dev:live`; root config is outside this lane (AGENTS §1), so the script currently lives in `apps/server/package.json` and the working invocations are `cd apps/server && bun run dev:live` or `bun --cwd apps/server run dev:live`.
2. **Epic 49 (`packages/engine`)**: publish the collected diff so the new route is populated on real runs — either a `task.diff` event `{ taskKey, diff }` or an additive `diff` on `task.status`. The server already accepts either shape, so this is the only missing producer.
3. **Epic 47 (`apps/web/src/features/sky`)**: honour `SkyViewProps.paused`. The shell now passes `paused: view !== 'sky'`; until the prop exists the Sky's rAF loop keeps running behind the DAG.
4. **Epic 55 / queue lane**: honour `MergeQueueProps.selectedTask` to highlight the selected queue card. The shell passes it; the component currently ignores it.
5. **Epic 49**: publish `run.status` transitions (`{from,to,run}`). The web reducer already handles them; the picker will otherwise keep saying `mapping` until `run.finished`.

**Deliberately deferred / out of scope:**

- Real engine/CLI composition (Epic 40), visual Sky polish (Epic 47), the launch form (Epic 53).
- Refreshing a cached drawer diff after a later fix attempt (fetch-once per run+task today).
- Pinning the selected run against "newest run wins" (a future store flag).
- A committed browser/Playwright pass for live mode; verification here is route tests, the scripted hub, and the live curls above.
- Last-Event-ID support (still cursor-based `?since=`, per E21).

**Open questions / flagged tradeoffs:**

- **Diff shape ownership.** The route accepts three shapes to avoid blocking on core; if Epic 49 picks a different field name, the extractor needs one small addition. `latestTaskDiff` is the single place to change.
- **`/api/config/public` resolves env per request.** A running process that changes `STARLING_LLM_PROFILE` after composition will show the new value while the engine keeps the old routes; acceptable for a dev hub, but worth knowing.
- **Auto-follow replaces an explicit selection when a newer run starts.** That is the control-room reading of the requirement; a "pin" toggle is the escape hatch if it proves surprising on stage.
- **`dev-live` adds a `diff` to `audit.verdict` payloads.** It is dev-only and documented; the strict contract is untouched, and real recordings never contain it.

Closes #28
