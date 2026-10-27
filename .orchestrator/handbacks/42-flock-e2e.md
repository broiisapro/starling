## Epic 42 Handback — Flock end-to-end: two perches, then two laptops

**Status:** Complete except the real flock smoke, which is explicitly deferred (Epic 40's real engine
composition is not on `main`). Branch `epic/42-flock-e2e` @ `f75a987` (feature head; the docs/handback
commit follows). Closes #29.

**Delivered:**

- **Carryover 1 — heartbeat carries the perch URL / unknown ids re-register.** Already true of the
  perch (`NodeInfo.url`) and the hub; the loopback hub now also answers **404** for an unknown heartbeat
  id, so the client's "drop the id and register again" path is exercised end to end.
- **Carryover 2 — graceful leave.** `createFlockHub.heartbeat` treats `info.status === 'offline'` as an
  immediate leave: it removes the node, closes its `RemoteNode` (SSE) and publishes `left` with reason
  `perch-stopped`. A late offline heartbeat for a forgotten id is a no-op. `tests` in
  `packages/flock/src/hub.test.ts`.
- **Carryover 3 — SSE resilience.** `/perch/events` assigns a monotonic id to every event, keeps the
  last 500 in a ring (`packages/perch/src/event-log.ts`), and replays everything after a client's
  `Last-Event-ID`. Fresh connections stay live-only. `subscribeSse` records ids and resends
  `Last-Event-ID` on every reconnect; `RemoteNode` gained `eventsReady(): Promise<void>`. Tests:
  `event-log.test.ts`, `perch-app.test.ts` (resume from id 0 and id 3), `remote-node.test.ts`
  (reconnect carries `Last-Event-ID: 41`).
- **Carryover 4 — mDNS port types.** Already unified at C1; both packages import `MdnsAdvertiser` /
  `MdnsBrowser` from `@starling/core`. No code change; documented that the two `STARLING_SERVICE_TYPE`
  constants differ on purpose (full DNS-SD type vs bonjour's bare name).
- **`packages/perch/src/compose-perch.ts`**: `composePerch(opts)` → `RealPerch` (`node`, `handle`,
  `root`, `statusLine()`, `stop()`), plus `perchNodeId`, `expandHome`, `perchStatusLine`. Builds the
  per-perch state root (`~/.starling/perch/<perch-name>`), real git `Workspace`, spawned opencode
  runner, `LocalNode`, and calls `startPerch` with the hub URL/code. Injectable workspace/runner/mDNS/
  fetch/os for tests. 4 tests with `MockWorkspace` + `MockRunner` + a scripted hub fetch (no socket, no
  spawn).
- **`apps/cli/src/real/perch-compose.ts`**: CLI mapper (`perchComposeInput`, `perchComposeOptions`) plus
  re-exports. `starling perch --hub … --code … [--port] [--max-sessions] [--name]` now runs a real
  daemon until SIGINT/SIGTERM, printing `🪺 roosting on <name> · n/m sessions`, the node id, the perch
  URL, the state root, the hub and the join code; the status line refreshes on slot changes.
- **`starling flock`** now reads `GET /api/nodes` and `GET /api/flock/join` from the hub
  (`STARLING_HUB_URL`, else `http://127.0.0.1:<config.server.port>`), prints the roster and the
  copy-pastable join command, supports `--json`, and falls back to the local composition with a warning
  when no server answers (so the mock demo still works).
- **`tools/flock/hub-server.ts`**: real `createRegistry` + `createLocalNode` (hub, 0 slots) +
  `createFlockHub` + `/api/nodes`, `/api/flock/{join,register,heartbeat,bundle}` over `Bun.serve`, with
  token auth, 404 for unknown heartbeat ids, and sha-cached real git bundles.
- **`tools/flock/replay-agent.ts`**: the real `ReplayRunner` with a per-start edit hook (so diffs are
  non-empty) and session fan-out; a 7-event, 400 ms scripted coding turn.
- **`tools/flock/loopback.ts`** (`bun tools/flock/loopback.ts`): seeds a temp git repo, starts the hub
  and two perches on **7781/7782** (ephemeral fallback when busy), and drives four tasks:
  `t01`/`t02` in parallel (one per perch) → collect → bundle → `fetchBundle` into the hub →
  hub-side `merge-tree`/`commit-tree`/`update-ref`; `t03` on perch one stopped mid-task (graceful) →
  `left perch-stopped` → re-dispatched to perch two; `t04` on a reconnected perch one whose heartbeats
  are blackholed → `left heartbeat-timeout` → re-dispatched to perch two. Returns a typed summary and
  prints a readable trace.
- **`tools/flock/loopback.e2e.test.ts`**: the same run as a test (1 test, 36 assertions, ~5 s),
  asserting both registrations, four tasks all with `nodeId !== 'hub'`, real `changedFiles`, 40-char hub
  commits, both leave reasons in order, and `elapsedMs < 60_000`.
- **`docs/epic-42-flock-e2e.md`**: the six required sections plus the two-laptop runbook (setup per
  laptop, expected output, what success looks like, 6 troubleshooting checks: firewall prompt, same
  wifi/subnet, mDNS blocked → `--hub`, hotspot fallback, clock skew, port in use).

**Key design decisions:**

- **Composition lives in `packages/perch`, the CLI file maps flags/config.** The brief names
  `apps/cli/src/real/perch-compose.ts`; keeping the wiring in the package makes it unit-testable with
  fakes and avoids a second composition root in `apps/cli` (the engine's root is Epic 40's). The CLI
  file still exports `composePerch`/`perchStatusLine`, so the brief's contract holds.
- **Fresh SSE = live-only; replay requires `Last-Event-ID`.** Replaying the ring to every new client
  would duplicate history for dashboards/debuggers and hide ordering bugs. `eventsReady()` replaces
  client-side sleeps and closes the connect race.
- **Graceful leave in `createFlockHub`, not a new route.** The Perch API is locked and has no
  deregister route; `status: 'offline'` is the signal. The server route stays a passthrough.
- **`createRegistry.sweep` never times out `kind: 'local'`.** The hub's own node lives in-process and
  has no heartbeat; sweeping it dropped the hub out of its own roster/scheduler after
  `offlineAfterMs`. Found by the loopback's first run.
- **Scheduler compares latencies instead of subtracting them.** `Infinity - Infinity` is `NaN`, and a
  `NaN` comparator left the array in registry order, so "ties break by id" silently depended on
  heartbeat order (perch two won a tie it should have lost). Now unknown latency compares equal and the
  id decides. Found by the loopback; regression test added.
- **A minimal hub in `tools/flock` over the real hub objects.** `apps/server` is another lane; four
  routes over the real `FlockHub` exercise registration, heartbeat, graceful leave, 404 recovery and
  bundle caching today. Behaviours the server should copy are FIX REQUESTS.
- **The loopback waits for a heartbeat before the second dispatch.** The scheduler reads registry
  `NodeInfo`, which only learns about a session on the next heartbeat (50 ms in the harness). Dispatching
  twice in one tick double-books a `maxSessions: 1` perch and the node correctly rejects the second
  start; the real dispatcher has the same constraint (FIX REQUEST).
- **Four tasks, not three.** The crash phase costs ~1 s and covers the lid-closed path end to end
  (sweep → `heartbeat-timeout` → recovery on the survivor), which the graceful stop alone does not.
- **Fixed ports with ephemeral fallback.** 7781/7782 for readable output, port 0 on bind failure so a
  busy build machine cannot flake the test.
- **Hub-side merge is git plumbing.** `merge-tree` + `commit-tree` + `update-ref` moves the integration
  branch without a checkout and keeps the loopback inside this lane (the real `Merger` is Epic 17's).

**Verification (exact commands + results):**

- `bun install`: `Checked 166 installs across 221 packages (no changes)`.
- `bun test tools/flock/loopback.e2e.test.ts`: **1 pass / 0 fail**, `36 expect() calls`,
  `Ran 1 test across 1 file. [4970.00ms]`.
- `bun tools/flock/loopback.ts` (trace, abridged; the migration is in the middle):

```
🪺 hub      http://127.0.0.1:61215  code LOOPBACK
   hub has 0 session slots: every task must run on a perch
🐦 loop-perch-1  http://127.0.0.1:7781
🐦 loop-perch-2  http://127.0.0.1:7782
   registered: hub, loop-perch-1, loop-perch-2
→ t01-sky-note → loop-perch-1
→ t02-wind-log → loop-perch-2
  ✔ t01-sky-note on loop-perch-1 → src/t01-sky-note.ts
  ✔ t02-wind-log on loop-perch-2 → src/t02-wind-log.ts
→ t03-murmur → loop-perch-1 (will be stopped mid-task)
  ✂ stopping loop-perch-1 while t03-murmur is running
  ⚠ loop-perch-1 left the flock (perch-stopped)
  ↻ t03-murmur re-dispatched to loop-perch-2
  ✔ t03-murmur on loop-perch-2 after loop-perch-1 left
🐦 loop-perch-1  http://127.0.0.1:61253  (rejoined)
→ t04-dusk → loop-perch-1 (heartbeats will be cut)
  📴 loop-perch-1 stopped heartbeating
  ⚠ loop-perch-1 left the flock (heartbeat-timeout)
  ↻ t04-dusk re-dispatched to loop-perch-2
  ✔ t04-dusk on loop-perch-2 after loop-perch-1 timed out
✔ loopback finished in 5538 ms
  task    t01-sky-note   on loop-perch-1 → starling/loopback/t01-sky-note [src/t01-sky-note.ts]
  task    t02-wind-log   on loop-perch-2 → starling/loopback/t02-wind-log [src/t02-wind-log.ts]
  task    t03-murmur     on loop-perch-2 (rescued from loop-perch-1) → starling/loopback/t03-murmur [src/t03-murmur.ts]
  task    t04-dusk       on loop-perch-2 (rescued from loop-perch-1) → starling/loopback/t04-dusk [src/t04-dusk.ts]
  leave   loop-perch-1 (perch-stopped)
  leave   loop-perch-1 (heartbeat-timeout)
  events  28 agent events
```

- **Real flock smoke: DEFERRED.** `apps/cli/src/real/` does not exist on `origin/main` (checked after
  `git fetch`; `apps/cli/src/compose.ts` is still mock-only and `starling dash` is a stub), so Epic 40's
  real composition is not available. Per the brief, no competing composition was built and
  `fixtures/real/flock-loopback.jsonl` was not produced. Partial real check instead (no model call):
  `starling perch --hub http://127.0.0.1:7799 --code SMOK-TEST --port 7798 --max-sessions 2 --name "Smoke
  Perch"` against `tools/flock/hub-server.ts`:
  - it printed `✔ 🪺 roosting on Smoke Perch · 0/2 sessions`, node `perch-smoke-perch`, perch URL
    `http://10.0.0.12:7798`, state `~/.starling/perch/perch-smoke-perch`;
  - `GET /api/nodes` listed `hub` and `perch-smoke-perch` (remote, 0/2, online, LAN URL);
  - `starling flock` printed both nodes and `starling perch --hub http://127.0.0.1:7799 --code
    SMOK-TEST`;
  - SIGINT printed `SIGINT — flying home… / Perch stopped.` and `/api/nodes` immediately contained only
    `hub` (graceful leave, no 15 s wait).
- `bun run test` (root): packages half **1374 pass / 0 fail / 4 skip**, `Ran 1378 tests across 165
  files. [48.91s]`; web half **426 pass / 0 fail**, `Ran 426 tests across 39 files. [15.58s]` on the
  confirming rerun. Two pre-existing timing flakes were seen once each under the ~20 concurrent agents
  on this machine and pass in isolation and on rerun: `apps/web` `performance > 360 birds × 600 steps in
  under 250 ms` and `packages/runner` `session demultiplexing > interleaved events from two sessions`
  (neither is in this lane; the loopback itself uses an ephemeral or 7781/7782 port with fallback).
- `bun run check`: **clean** — `Checked 715 files in 323ms. No fixes applied.` + typecheck loop exit 0.
- `bunx tsc --noEmit -p tools/flock/tsconfig.json`: clean (the root typecheck loop does not cover
  `tools/`, so this was run explicitly; a tsconfig was added there).
- Manual: no listeners left on 7781/7782/7798/7799 after the runs; the smoke's temp repo and
  `~/.starling/perch/perch-smoke-perch` were removed; no Ollama model was loaded (only the metadata
  list endpoint was probed by the perch, which is metadata-only).

**Dependencies added:** none (no npm packages). Workspace deps only: `@starling/flock`,
`@starling/runner`, `@starling/workspace` added to `packages/perch/package.json`; `@starling/perch`
added to `apps/cli/package.json`. `bun.lock` regenerated by `bun install` (never hand-edited).

**CONTRACT REQUESTS:** none — `packages/core` was not touched.

**FIX REQUESTS (changes needed outside this lane):**

1. **`apps/server/src/routes/flock.ts` (Epic 41): return 404 for an unknown heartbeat id.** Now the
   route always answers `{ok:true}` while the hub re-registers fire-and-forget. Answering 404 when
   `registry.get(nodeId) === undefined` makes the perch's explicit re-register path (already
   implemented) the recovery of record, and matches the loopback hub. Response body:
   `{error:{code:'unknown-node', message:…}}`.
2. **`packages/engine` (Epic 49) / dispatch:** the scheduler reads registry `NodeInfo`, which lags a
   dispatch by one heartbeat. Dispatching two tasks in the same tick can double-book a
   `maxSessions: 1` perch, and the node rejects the second `startTask` with `INVALID_ARGUMENT`. Reserve
   locally at dispatch, or refresh `node.info()` into the registry between picks (the loopback waits for
   `activeSessions > 0` before its second pick; see `tools/flock/loopback.ts`).
3. **`apps/server` (Epic 41) / hub node liveness:** the hub's `LocalNode` is in the registry but nothing
   refreshes its `lastSeen`. This lane's `createRegistry.sweep` now skips `kind: 'local'`, which fixes
   the symptom; if the server wants real stats on the hub row it should still `registry.touch('hub',
   await localNode.info())` on a timer or after each dispatch.
4. **`apps/cli/src/program.ts` (Epic 40/22): add `--hub <url>` to `starling flock`.** The command
   currently reads `STARLING_HUB_URL` and falls back to `config.server.port`; a flag is the obvious UX
   and cannot be added from this lane.
5. **`apps/cli` (Epic 40): terminal QR code in `starling flock`.** Needs a CLI dependency for QR
   rendering; per the brief that is Epic 40's lane. The join command is printed and copy-pasteable
   today.
6. **Epic 40/41: real composition + real flock smoke.** When `apps/cli/src/real/*` and the server's flock
   routes land, run hub + one perch on this Mac (separate port and cache dir) with `maxSessions: 1` on
   the hub, using the `quick-wins` goal, and record it to `fixtures/real/flock-loopback.jsonl`. The
   loopback is the harness to compare against.

**Deliberately deferred / out of scope:**

- The real flock smoke and its JSONL fixture (Epic 40 dependency, see above).
- Engine dispatch/reschedule execution (Epic 49): the loopback plays dispatcher and re-dispatch by hand.
- Web flock panel changes (Epic 41/47) and LLM lending (Epic 51).
- TLS / per-node credentials (LAN-only by L18), bundle garbage collection, scheduler affinity beyond
  free slots (inherited from Epics 14/30).
- Two physical laptops: the runbook is written, not executed here.

**Open questions / flagged tradeoffs:**

- **SSE replay window.** 500 events with a 400 ms scripted turn is plenty, but a text-heavy real session
  could evict an old `session.idle`. If that ever bites, the next step is a per-session sequence number
  or a larger/disk-backed ring, not a protocol change.
- **Fresh connections get no backlog.** Deliberate (see decisions). A hub that loses its `RemoteNode`
  object entirely (process restart) will not see events from before the restart; `Last-Event-ID` only
  helps within one node object's lifetime. The engine's periodic health check should remain the
  backstop.
- **Two rosters can disagree briefly.** `starling flock` reads `/api/nodes`; the in-process fallback
  reads a mock registry. The warning line makes the difference visible, but the two are not the same
  data source by design.
- **Fixed loopback ports vs. a busy build machine.** 7781/7782 with ephemeral fallback keeps output
  readable; if a future CI wants strict isolation, pass `port1: 0, port2: 0` (both are options on
  `runLoopback`).
