# Epic 42 — Flock end-to-end: two perches on one laptop, then two laptops

## Goal

Prove Flock mode for real, and make it a 60-second experience.

Before this epic, Flock existed as parts: `LocalNode`, `RemoteNode`, registry, scheduler, hub and the
Perch daemon were all tested, but no run had ever put two real daemons on two real ports, moved real git
bundles through them, and shown what happens when one of them dies mid-task. This epic:

1. carries four Wave 1 loose ends into the flock/perch packages (graceful leave, heartbeat URL,
   SSE resume, mDNS port types);
2. makes `starling perch` a real daemon and `starling flock` read the hub's roster;
3. adds a no-LLM **loopback E2E**: two perches on one machine, three tasks, a kill, a reschedule, a
   heartbeat timeout and a second reschedule — as a readable script and as a test under 60 s;
4. documents the two-laptop runbook (below) so the demo is copy-paste, not tribal knowledge.

The engine's own state machine (Epic 49) is out of scope; where the loopback needs dispatch and
rescheduling it plays a deliberately small, explicit dispatcher.

## How it works

### 1. Carryovers

**Graceful leave.** `startPerch.stop()` already sent a final heartbeat with `status: 'offline'`, but
the hub treated every heartbeat as "still alive", so a stopped perch sat in the roster until the 15 s
sweep. `createFlockHub.heartbeat` now branches on `status === 'offline'`: it removes the node, closes
its `RemoteNode` (which stops the SSE stream) and publishes `left` with reason `perch-stopped`. An
offline heartbeat for an id the hub has already forgotten is a no-op.

**Heartbeat carries the perch URL.** The perch's `NodeInfo` includes `url`, and the hub already
re-registers an unknown id when the heartbeat has a URL. The loopback hub additionally answers 404 for
unknown ids so the client's own "drop the id and register again" path is exercised end to end. The
locked Perch API has no deregister route, so this pair (404 or URL) is the whole recovery story.

**SSE resume.** `/perch/events` now assigns a monotonic id to every event, keeps the last 500 in a ring
(`packages/perch/src/event-log.ts`), and replays everything after a client's `Last-Event-ID`. On a
fresh connection (no header) the stream is live-only, so a new subscriber never receives history it did
not ask for. `subscribeSse` records the last `id:` it saw and sends `Last-Event-ID` on every reconnect;
`RemoteNode` gained `eventsReady()` so a caller can wait until the stream is actually open instead of
sleeping and hoping. A dropped stream can therefore no longer lose `session.idle`.

**mDNS port types.** Already unified at checkpoint C1: both packages import `MdnsAdvertiser` /
`MdnsBrowser` from `@starling/core`. The only difference is the constant: `@starling/perch` advertises
the full DNS-SD type `_starling._tcp`, `@starling/flock` browses the bare `starling` name that
`bonjour-service` expects. `splitServiceType` bridges them; that is why the two constants are not equal.

### 2. `starling perch` is a daemon

`packages/perch/src/compose-perch.ts` (`composePerch`) builds, in order:

1. a per-perch state root `<cacheDir>/<perch-<slug>(name)>`, with `<root>/worktrees`, so two perches on
   one laptop cannot share worktrees or bundle caches;
2. the real git `Workspace` from `@starling/workspace` and a spawned `opencode serve` runner from
   `@starling/runner` (constructed lazily; no session, no model, no cost until a task arrives);
3. a `LocalNode` with `maxSessions`, the state root and the machine name;
4. `startPerch`, with the explicit hub URL and join code, mDNS advertising when `flock.mdns` is on.

`apps/cli/src/real/perch-compose.ts` is the CLI-shaped part: it merges `starling.config.yaml` with the
flags (`perchComposeInput`) and re-exports the composition, keeping the heavy lifting testable without a
socket or a spawned process. `starling perch --hub … --code …` prints

```
✔ 🪺 roosting on Smoke Perch · 0/2 sessions
  node     perch-smoke-perch
  perch    http://10.0.0.12:7798
  state    ~/.starling/perch/perch-smoke-perch
  hub      http://127.0.0.1:7799
  join code SMOK-TEST

The flock can now schedule tasks here. Ctrl-C to leave.
```

and stays in the foreground. SIGINT/SIGTERM stop the daemon (`handle.stop()` aborts in-flight sessions,
sends the offline heartbeat, unpublishes mDNS and closes the listener). The status line refreshes when
the busy-slot count changes. With no `--hub` the command still prints the join instructions and exits,
which is what a first-time user needs.

### 3. `starling flock` reads the hub

`starling flock` asks the running server for `GET /api/nodes` and `GET /api/flock/join`, prints the same
roster table plus the copy-pastable `starling perch --hub … --code …` command, and supports `--json`.
The hub URL is `STARLING_HUB_URL` when set, otherwise `http://127.0.0.1:<config.server.port>`. When no
server answers, the command falls back to this process's own composition and says so, so the mock demo
still works before the dashboard is up.

### 4. The loopback E2E (`tools/flock/`)

Three files, all in the epic's lane, all import workspace packages through their public index:

- `hub-server.ts` — the real `createRegistry` + `createLocalNode` (hub, `maxSessions: 0`) +
  `createFlockHub` + four HTTP routes (`/api/nodes`, `/api/flock/join|register|heartbeat|bundle`).
  The hub's own node has zero slots on purpose: every task must run on a perch for the test to prove
  anything.
- `replay-agent.ts` — the real `ReplayRunner` plus two additions: a per-start `edit` hook (so the agent
  leaves a file and the bundle is non-empty) and session fan-out (one replay per task).
- `loopback.ts` — seeds a temp git repo with an integration branch, starts the hub and two perches on
  **7781/7782** (falling back to an ephemeral port when taken, e.g. while another agent is testing),
  then drives the phases below. It returns a typed summary and, when run as a script, prints a readable
  trace.

Phases:

1. **Parallel** `t01`/`t02`, one per perch, through the real scheduler. Each: `startTask` over HTTP with
   a bundle URL → `session.started`…`session.idle` over SSE → `collect` → bundle download →
   `fetchBundle` into the hub repo → `git merge-tree` + `commit-tree` + `update-ref` so the integration
   branch moves before the next task.
2. **Graceful kill**: `t03` starts on perch one; the perch is stopped mid-task; the hub publishes `left`
   (`perch-stopped`) immediately; the scheduler's next pick is perch two, where `t03` runs to completion
   and its bundle lands in the hub.
3. **Crash**: perch one reconnects (fresh state root) and takes `t04`; its heartbeat `fetch` is then
   blackholed, the registry sweeps it to `offline` with `heartbeat-timeout`, and `t04` is re-dispatched
   to perch two and imported.

`loopback.e2e.test.ts` asserts the whole story: two registrations, four tasks (all `nodeId !== 'hub'`),
`changedFiles` for every task, real 40-character hub commits, both `left` reasons in order, and a wall
clock under 60 s (normally ~5 s). `bun tools/flock/loopback.ts` prints:

```
🪺 hub      http://127.0.0.1:61215  code LOOPBACK
   hub has 0 session slots: every task must run on a perch
🐦 loop-perch-1  http://127.0.0.1:7781
🐦 loop-perch-2  http://127.0.0.1:7782
→ t03-murmur → loop-perch-1 (will be stopped mid-task)
  ✂ stopping loop-perch-1 while t03-murmur is running
  ⚠ loop-perch-1 left the flock (perch-stopped)
  ↻ t03-murmur re-dispatched to loop-perch-2
  📴 loop-perch-1 stopped heartbeating
  ⚠ loop-perch-1 left the flock (heartbeat-timeout)
  ↻ t04-dusk re-dispatched to loop-perch-2
✔ loopback finished in 5538 ms
```

### 5. Manual CLI smoke (real `starling perch`, no model)

The full Flock smoke from the brief needs Epic 40's real engine composition, which is not on `main`
yet, so that step is deferred. What was run for real: `starling perch --hub http://127.0.0.1:7799
--code SMOK-TEST --port 7798 --max-sessions 2 --name "Smoke Perch"` against the loopback hub. It
registered (`/api/nodes` showed `perch-smoke-perch`, 2 slots, the machine's LAN URL), `starling flock`
listed it and printed the join command, and Ctrl-C produced the offline heartbeat: the node disappeared
from `/api/nodes` immediately. No session was started, so no model was called and no `opencode serve`
was spawned.

## Key decisions & reasoning

- **The composition lives in `packages/perch`, the CLI file is a thin mapper.** The brief asks for
  `apps/cli/src/real/perch-compose.ts`; keeping the actual wiring in the package makes it unit-testable
  with a mock workspace/runner/hub-fetch and keeps `apps/cli` free of a second composition root (the
  engine's root is Epic 40's).
- **Fresh SSE connections are live-only; replay needs `Last-Event-ID`.** Replaying the ring to every
  new client would duplicate events for anything that attaches mid-run (a dashboard, a debugger) and
  hides ordering bugs. The resume header is exactly the contract the carryover asked for, and
  `eventsReady()` removes the connect race on the client side instead.
- **Graceful leave is a hub concern, not a new route.** The Perch API is locked and has no deregister
  route, so `status: 'offline'` is the signal. Doing it in `createFlockHub` means the server route stays
  a two-line passthrough and every caller of the port gets the behaviour.
- **The registry never sweeps `kind: 'local'` nodes.** The hub's own `LocalNode` lives in the same
  process and has no heartbeat to miss; sweeping it dropped the hub out of its own roster (and its own
  scheduler) after `offlineAfterMs`. Found by the loopback on its first run.
- **Scheduler latency comparison, not subtraction.** `(undefined ?? Infinity) - (undefined ?? Infinity)`
  is `NaN`, and a `NaN` comparator leaves the array in insertion order — so "ties break by id" silently
  depended on heartbeat order. Now unknown latency compares equal and the id tie-break decides. Also
  found by the loopback (perch two won a tie it should have lost).
- **A minimal hub in `tools/flock`, on the real hub objects.** `apps/server` owns the real routes and is
  another lane. Serving four routes over the real `FlockHub` exercises registration, heartbeats,
  graceful leave, 404-recovery and bundle caching without depending on a server branch that is still in
  flight; the two behaviours the server should copy are filed as FIX REQUESTS.
- **The loopback waits for a heartbeat before the second dispatch.** The scheduler reads registry
  `NodeInfo`, which only learns about a started session on the perch's next heartbeat (50 ms here). The
  real dispatcher has the same constraint; dispatching twice in the same tick double-books a
  `maxSessions: 1` perch and the node correctly rejects the second start. The loopback makes the wait
  explicit and logs why.
- **Four tasks, not three.** Three tasks would cover parallel + one kill. Adding the crash phase costs
  ~1 s and covers the path a demo laptop actually takes (lid closed, Wi-Fi gone) end to end: the sweep,
  the `heartbeat-timeout` reason, and recovery on the survivor.
- **Fixed ports with an ephemeral fallback.** The brief names 7781/7782 for readable output; on a busy
  build machine a fixed port is a flake waiting to happen, so a bind failure falls back to port 0 and
  the URL in the output is the real one.
- **Hub-side merge is plumbing (`merge-tree` + `commit-tree` + `update-ref`).** The loopback needs the
  integration branch to move so the next perch fetches a newer bundle, but the real `Merger` is Epic 17's
  port and not part of this lane. Plumbing avoids a checkout and keeps the temp repo's working tree
  alone; conflicts fail loudly rather than being silently overwritten.

## Interfaces for future epics

From `@starling/perch`:

```ts
export interface ComposePerchOptions {
  hub?: string;
  code?: string;
  port?: number;
  maxSessions?: number;
  name?: string;
  cacheDir?: string;        // default ~/.starling/perch
  home?: string;            // test injection for `~`
  workspace?: Workspace & Partial<BundleOps>;
  runner?: AgentRunner;
  mdns?: MdnsAdvertiser | false;
  lendModels?: boolean;
  fetch?: typeof fetch;
  clock?: Clock;
  os?: OsProbe;
  exec?: ExecFn;
  bus?: EventBus;
  heartbeatMs?: number;
  publicHost?: string;
  opencodeCommand?: string;
}
export interface RealPerch {
  node: LocalNode;
  handle: PerchHandle;
  root: string;
  name: string;
  maxSessions: number;
  hub?: string;
  statusLine(): string;     // 🪺 roosting on MacBook Pro · 2/5 sessions
  stop(): Promise<void>;
}
export function composePerch(opts?: ComposePerchOptions): Promise<RealPerch>;
export function perchNodeId(name: string): string;      // perch-macbook-pro
export function expandHome(path: string, home?: string): string;
export function perchStatusLine(input: PerchStatusInput): string;

// SSE backlog (also useful to any future stream consumer)
export const EVENT_REPLAY_LIMIT = 500;
export function createEventLog(limit?: number): EventLog;
```

From `@starling/flock`:

```ts
export interface RemoteNode extends ExecutionNode {
  readonly url: string;
  close(): void;
  eventsReady(): Promise<void>;   // resolves when the SSE stream is open
  lastEventError(): StarlingError | undefined;
}
```

From `apps/cli/src/real/perch-compose.ts` (Epic 40 may reuse it, or supersede it):

```ts
export { composePerch, perchStatusLine } from '@starling/perch';
export function perchComposeInput(config: StarlingConfig, flags: PerchFlagOptions, env?): PerchComposeInput;
export function perchComposeOptions(input: PerchComposeInput): ComposePerchOptions;
```

From `tools/flock` (test harness, not a package):

```ts
export function startLoopbackHub(opts: LoopbackHubOptions): Promise<LoopbackHub>;
export function runLoopback(opts?: LoopbackOptions): Promise<LoopbackSummary>;
export const TASKS; // four TaskSpec fixtures reused by future E2Es
```

The hub contract change worth propagating: `createFlockHub.heartbeat` treats `status: 'offline'` as an
immediate leave with reason `perch-stopped`; `createRegistry.sweep` skips `kind: 'local'`; the server's
heartbeat route should 404 unknown ids.

## Deviations from plan

- **The real two-machine/single-machine flock smoke is deferred.** It needs Epic 40's real engine
  composition (`apps/cli/src/real/*`), which was not on `main` when this branch was cut. Nothing here
  builds a competing composition; the loopback plus the CLI smoke cover registration, scheduling,
  bundles, kill and resume without a model call, and the remaining step is documented in the handback
  and the brief.
- **The loopback hub routes live in `tools/flock/hub-server.ts`, not `apps/server`.** Lane rule; see the
  decision above and the FIX REQUESTS in the handback.
- **`starling flock` takes its hub URL from `STARLING_HUB_URL` / config, not a `--hub` flag.** Adding the
  flag means editing `apps/cli/src/program.ts`, which is outside this lane. Filed as a FIX REQUEST.
- **No terminal QR code in `starling flock`.** A QR renderer needs a CLI dependency (Epic 40's lane, per
  the brief). The command itself is printed and copy-pasteable; filed as a FIX REQUEST.
- **The loopback runs four tasks** (three from the brief plus a crash-demo task) and prints both leave
  reasons; see the decision above.
- **`apps/cli/package.json`, `packages/perch/package.json` and `bun.lock` changed.** Adding workspace
  dependencies is allowed by AGENTS §2; the lockfile was regenerated by `bun install`, never edited by
  hand.

## Two-laptop runbook (MacBook Pro hub + MacBook Air perch)

Run this when both laptops are on the same wifi and the repo is cloned on both. Budget ~60 seconds once
the prerequisites are done.

### Before you start (both laptops)

- Bun 1.4.4+, `git` 2.38+ and `opencode` on `PATH`.
- `bun install` at the repo root succeeds.
- `starling doctor` is green for bun, git and opencode.
- The perch laptop is signed in to the same opencode account/provider as the hub, so its agents can run.
  The hub does not need a model key for perch work; the perch uses its own `opencode serve`.
- Same wifi, same subnet. Guest networks and "client isolation" break both mDNS and plain HTTP; check
  with `ping <other-laptop-ip>` from each side.

### Laptop A — the hub

1. `bun install && bun run starling doctor`
2. Find this laptop's LAN IP: `ipconfig getifaddr en0`.
3. Start the hub the way you normally do (`starling run "<goal>" --repo <repo>` once Epic 40's real
   composition is on `main`; until then `starling dash` shows the flock endpoints).
4. macOS will ask whether `bun`/`node` may accept incoming connections — **Allow**. A denied prompt is
   the single most common cause of "the Air never appears".
5. `starling flock` prints the roster and the command, e.g.
   `starling perch --hub http://192.168.1.20:7777 --code K7QM-3XPH`. Copy that line.
6. Keep the terminal open: the hub must stay running for the flock to exist.

### Laptop B — the perch

1. `bun install && bun run starling doctor`
2. Run the line from laptop A:
   `starling perch --hub http://192.168.1.20:7777 --code K7QM-3XPH --max-sessions 5 --name "M2 Air"`
3. Expect `✔ 🪺 roosting on M2 Air · 0/5 sessions` and `node perch-m2-air`, then the "Ctrl-C to leave"
   line. The first heartbeat registers the machine; there is no separate "join" step.
4. Back on laptop A, `starling flock` should now list `perch-m2-air` with 5 free slots and a latency.
5. When tasks are dispatched, the status line updates to `2/5 sessions`; the dashboard's flock panel and
   sky show the bird.

### What success looks like

- `starling flock` on the hub lists two nodes, `hub` first, the Air with `online`/`busy` and a latency.
- At least one task's `TaskRun.nodeId` (and the dashboard's agent drawer) is `perch-m2-air`, not `hub`.
- The Air's terminal shows sessions starting and finishing; the hub audits and merges the result, so the
  task's files appear on the hub's integration branch.
- Ctrl-C on the Air removes it from the roster immediately (`left`, reason `perch-stopped`) and its
  in-flight tasks are re-dispatched to the hub if slots are free.
- Close the Air's lid instead: the node stays `online` for ~15 s and then goes `offline` with
  `heartbeat-timeout`; tasks move the same way.

### Six troubleshooting checks

1. **Firewall prompt.** macOS asked and was denied for `bun` (or the terminal): System Settings →
   Network → Firewall → Options, allow `bun`, restart the perch. Symptom: the hub sees the perch try to
   register and immediately time out.
2. **Same wifi / subnet.** `ping <other-ip>` both ways and compare the first three octets of
   `ipconfig getifaddr en0`. A guest SSID or a VPN on either side breaks the LAN route even when both
   laptops have internet.
3. **mDNS blocked.** If the hub never auto-discovers but the manual command works, leave it: discovery
   is opportunistic. If the manual command also fails, the hub URL is wrong — use the IP, not
   `localhost`, and remember `localhost` on the Air means the Air.
4. **Hotspot fallback.** No shared wifi: turn on the Pro's internet sharing/hotspot, join it from the
   Air, re-read `ipconfig getifaddr en0` (it changes), and pass the new IP to `--hub`. Both laptops end
   up on the same `/24`, which is all Starling needs.
5. **Clock skew.** Heartbeats are judged by the hub's clock and `lastSeen` is epoch ms; a laptop whose
   clock is minutes off looks dead or wildly alive. Check `date` on both (or enable automatic time), and
   prefer mDNS/manual join over trusting a far-future `lastSeen`.
6. **Port in use.** `lsof -nP -iTCP:7778 -sTCP:LISTEN` on the Air. Two perches (or a stale one) cannot
   share 7778; pass `--port 7790` (or stop the old one). The loopback tools do the same and fall back to
   an ephemeral port automatically.

If the code on the Air is older than the hub's, pull and `bun install` again: the join code and the Perch
API are stable, but an old build may not support `Last-Event-ID` resume or the graceful offline
heartbeat, which makes a stopped Air linger for 15 s instead of leaving immediately.

## Known limitations / deferred

- **No real two-laptop run yet.** Requires physical hardware; the runbook is the hand-off.
- **The real flock smoke (hub + one perch + a real `quick-wins` run, recorded to
  `fixtures/real/flock-loopback.jsonl`) is deferred** until Epic 40's real composition lands.
- **The engine still owns rescheduling.** The loopback re-dispatches by hand; a real `left` event only
  produces a signal today.
- **The hub's roster can be stale between heartbeats.** A task started in the same tick as another can
  double-book a `maxSessions: 1` perch and get an `INVALID_ARGUMENT` rejection. Filed as a FIX REQUEST
  (reserve at dispatch time, or refresh the node's `info()` before a second pick).
- **The SSE ring is per process and bounded at 500 events.** A hub that falls further behind than that
  resumes from the oldest buffered event; text floods can evict a `session.idle` in principle. One idle
  per task and 500 events of headroom make that unlikely.
- **The loopback is one machine.** It exercises HTTP, bundles and the daemon lifecycle, but not Wi-Fi,
  mDNS multicast or two clocks; those are in the runbook, not in CI.
- **No bundle garbage collection** on either side (inherited from Epics 14/30).
- **mDNS advertising in the smoke test is best-effort** and never fatal; a firewall that blocks it
  degrades to the manual `--hub` path, which is the only path the tests cover.
