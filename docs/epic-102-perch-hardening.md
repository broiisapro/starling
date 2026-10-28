# Epic 102 — Perch hardening: body limits, hostile refs, mDNS code opt-in, health, drain, jitter

## Goal

A perch is a stranger's laptop doing work for the hub, so its HTTP surface has to be boring and safe:
refuse giant bodies and hostile git refs before git ever sees them, and stop shouting the join code
over mDNS. Demo day needs two operational features as well: a deep health check the presenter can
glance at, and a graceful **drain** so a perch can be restarted mid-demo without killing a bird in
flight.

Everything here is inside `packages/perch/**` (plus the five security probes that were waiting on
this boundary). The hub, the CLI flags and the docs for Epic 31 belong to other lanes; the exact
wiring is listed under *Interfaces for future epics* and in the handback.

## How it works

### 1. Body limit (SEC-05, perch half)

`readJson` (`src/perch-app.ts`) now takes `{ maxBytes }` and defaults to the exported
`PERCH_MAX_BODY_BYTES = 256 * 1024`. It rejects in two phases:

1. a declared `content-length` over the limit is refused without reading a byte;
2. the bytes actually streamed are counted through `c.req.raw.body.getReader()`, so a chunked body
   with no length (or a lie about it) is refused too.

Both answer **413** `{ error: { code: 'payload-too-large', message } }`. Every POST route parses
through it (`/perch/tasks`, `…/prompt`, `…/collect`), and the prompt/collect routes read the body
*before* looking up the handle, so a 1 MiB fixer prompt gets a 413 even when the session it names is
already gone. The JSON text is decoded from the counted bytes and then `JSON.parse`d, so there is one
path for "too big", "not JSON" (400 `invalid-json`) and "wrong shape" (400 `invalid-body`).

### 2. Hostile refs (SEC-10)

New `src/validate.ts`:

- `isSafeRef(ref, opts?)` — `^[A-Za-z0-9._/-]{1,200}$`, no leading `-`, no `..` (git forbids it in a
  ref name, and it is the traversal primitive), no empty segment (`//`, leading or trailing `/`), no
  reflog `@{` (typed as `allowReflog?: false`; never accepted today).
- `isSafeId(value)` — `^[A-Za-z0-9._-]{1,128}$` for `runId`, `taskKey` and the `:runId` / `:key`
  route params.
- `PerchStartTaskSchema = StartTaskOptionsSchema.superRefine(…)` validates `branch`, `fromRef`,
  `runId`, `taskKey` with one issue per bad field (path = the field name).
- `PerchCollectSchema` applies the ref rule to `baseRef`.

`POST /perch/tasks` uses `PerchStartTaskSchema`, so a hostile value is a **400** `invalid-body` and
`node.startTask` is never called. Every `/perch/tasks/:runId/:key/*` route validates its params first
and answers **400** `invalid-params`, which is also a small honesty fix: a hub bug ("my run id has a
slash") no longer looks like "the perch forgot my task" (404), which would send the hub down its
re-register path. The bundle route's `?base=` is held to the same ref rule.

### 3. mDNS join-code opt-in (SEC-07)

`StartPerchOptions.advertiseCode?: boolean` (default **false**) and the same option on
`ComposePerchOptions`. The TXT record is `{ node }` unless opted in, in which case it is
`{ node, code }`.

Discovery does not depend on the TXT code: the hub authenticates with the code it already has (typed
once, or read from `/api/flock/join`), and `hub.discover` never read `txt.code` in the first place.
The tradeoff is deliberate and documented below: zero-config discovery used to hand the flock's only
secret to anyone on the Wi-Fi.

### 4. `GET /perch/health`

Token-guarded like every route. `buildPerchHealth(probes)` (`src/health.ts`) returns

```ts
{ ok: boolean, status: 'ok' | 'degraded' | 'draining', checks: { name, ok, detail }[] }
```

with checks, in this order:

| check          | probe                                                           | fails when                                    |
| -------------- | --------------------------------------------------------------- | --------------------------------------------- |
| `git`          | `git --version` through the injected `exec` (2 s timeout, argv)  | non-zero exit, or it throws                   |
| `runner`       | the wrapped `ExecutionNode` answers `info()`                     | the session backend is dead                   |
| `worktreeRoot` | `access(worktreeRoot, W_OK)` via the injected `freeBytes()` seam | the root is missing/read-only                 |
| `disk`         | `freeBytes()` (`statfs.bavail × bsize` in production)            | under `PERCH_MIN_FREE_BYTES` (2 GiB)          |
| `sessions`     | the node's `activeSessions` / `maxSessions`                      | `active > max` (a full perch is *not* unwell) |
| `hub`          | age of the last successful register/heartbeat                    | never acked, or older than 3 × `heartbeatMs`  |

`status` is `draining` when drain mode is on (and `ok` is then false even if every check passes),
`degraded` when any check fails, `ok` otherwise. A probe that throws becomes a failed check
(`probe failed: …`) instead of a failed request: "the disk probe exploded" is exactly what a
presenter needs to see. The route answers **200** when `ok`, **503** otherwise, and 503
`health-unavailable` when the app was constructed without probes rather than pretending.

Every probe is injected: `createPerchHealthProbes` takes the node, the worktree root, the heartbeat
period, the last-ack timestamp, `draining`, `now`, `exec` and `freeBytes`. Tests never touch the real
machine's disk or git.

### 5. Graceful drain

- `PerchApp.setDraining(on)` / `isDraining()` / `drainTasks(opts)` (`src/perch-app.ts`).
- `PerchHandle.drain(opts?: { timeoutMs?, pollMs?, now?, sleep? })` (`src/perch-daemon.ts`).

While draining:

- a **new** `POST /perch/tasks` is **503** `{ error: { code: 'draining' } }`;
- a hub **retry of an existing handle** still gets that same handle (a retry is not new work);
- every heartbeat advertises `maxSessions = activeSessions`, i.e. zero free slots, so the scheduler
  stops picking this perch; `drain()` also sends one immediate heartbeat so the hub learns now rather
  than up to one period later;
- the loop waits for the hub to `DELETE` every task (a task's worktree/session is only safe to drop
  after its bundle was collected, and `DELETE` is the hub saying so), polling the handle map;
- at the timeout it aborts whatever is left, then `stop()`s the daemon (offline heartbeat, app close,
  mDNS unpublish, server stop).

`DrainReport = { finished: string[]; aborted: string[]; waitedMs: number }` — task keys, not handle
keys, because that is what the hub/logs speak. `drain()` is idempotent (a second SIGINT awaits the
drain in flight) and an already-stopped perch reports `{ finished: [], aborted: [], waitedMs: 0 }`.
`RealPerch.drain()` (`compose-perch.ts`) additionally closes the runner, so the CLI has one call.

`now` and `sleep` are injectable, which is how the deterministic test drives a `FakeClock` through
"hub deletes in time", "timeout aborts", "zero timeout" and "nothing to drain" without a wall-clock
wait.

### 6. Heartbeat jitter

`nextHeartbeatDelay({ heartbeatMs, jitter, random })` (`src/heartbeat.ts`) returns
`heartbeatMs × (1 ± jitter)` as whole milliseconds. `StartPerchOptions.heartbeatJitter` defaults to
`PERCH_HEARTBEAT_JITTER = 0.1` (±10%) and `random?: () => number` is injectable. The jitter applies to
the register→heartbeat period and to heartbeat→heartbeat; **backoff** after a failed call keeps its
exponential schedule (that delay is already a function of failure count, and jittering it would make
the recovery test lie). Ten perches that all boot after a demo start now spread over ~600 ms instead
of sharing one tick.

## Key decisions & reasoning

- **Two-phase body limit, not `c.req.json()` with a header check.** A `content-length` check alone is
  bypassable with `transfer-encoding: chunked`; counting alone pays to read 1 GiB before rejecting.
  Doing both is a few lines and closes the probe and the attack.
- **256 KiB.** It is ~3 000 lines of prompt; the largest legitimate body on this surface is a worker
  or fixer prompt. Chosen to match the hub-side number in SEC-05 so the two limits cannot disagree
  about what a "big" body is.
- **Body before handle lookup on prompt/collect.** The old order answered 404 for an unknown session
  before parsing the body; the security probe (correctly) wants the boundary to be independent of
  session state. The visible change is "413 instead of 404 for a giant body on a dead session" — the
  hub has already lost the session either way.
- **Reject any `..`, not only a `..` segment.** Git rejects `..` anywhere in a ref name, so the
  stricter rule matches what git will accept anyway and removes the "is `a/../../b` a segment?"
  argument. Same reasoning for `/`-only ids: a task key is never a path.
- **`invalid-params` (400) instead of 404 for a bad route param.** 404 would send the hub into its
  re-register path; a malformed id is a caller bug.
- **mDNS code off by default.** Zero-config discovery stays (name, type, port), and the hub already
  authenticates with the code it holds. The cost is one-time typing on a network you trust; the
  benefit is that being on the Wi-Fi is no longer enough to run an agent on someone's laptop.
- **Health checks are injected, synchronously shaped, and never cached.** Every request re-probes;
  the expensive parts (`git --version`) have a 2 s timeout, and a cached "ok" is exactly the lie a
  demo cannot afford. The `runner` check uses `node.info()`, which is the cheapest honest signal that
  the session backend is alive.
- **Drain waits on the handle map, not on agent events.** A session goes idle long before its work is
  collected and merged; deleting the worktree early would lose the task. `DELETE` is the only signal
  that means "this task is done here".
- **`maxSessions = activeSessions` during drain.** It is the one field the existing scheduler already
  honours (`maxSessions - activeSessions`), so no hub change is needed and the perch shows up in the
  roster as full rather than offline (an offline perch would trigger migration of tasks it is trying
  to finish).
- **Jitter default 10%.** Large enough to de-correlate ten laptops, small enough that the hub's 15 s
  offline window (5 periods) is never at risk.
- **`worktreeRoot` is optional on the daemon.** A bare `createPerchApp`/`startPerch` (tests, embedding)
  has no state root; the check then says "nothing to check" and stays green rather than probing
  `process.cwd()` and reporting a directory the workspace does not use. Compose always passes the real
  root.

## Interfaces for future epics

New public surface (all additive; `packages/perch/src/index.ts` re-exports the new modules):

```ts
// src/perch-app.ts
export const PERCH_MAX_BODY_BYTES = 256 * 1024;
export interface PerchAppDeps { /* … */ health?: PerchHealthProbes }
export type PerchApp = Hono & {
  handles(): TaskHandle[];
  close(): Promise<void>;
  setDraining(on: boolean): void;
  isDraining(): boolean;
  drainTasks(opts?: DrainOptions): Promise<DrainReport>;
};

// src/validate.ts
export const PERCH_REF_MAX_LENGTH, PERCH_ID_MAX_LENGTH, PERCH_REF_PATTERN, PERCH_ID_PATTERN;
export function isSafeRef(ref: string, opts?: { allowReflog?: false }): boolean;
export function isSafeId(value: string): boolean;
export const PerchStartTaskSchema, PerchPromptSchema, PerchCollectSchema;

// src/health.ts
export const PERCH_MIN_FREE_BYTES, PERCH_HEARTBEAT_STALE_FACTOR;
export type PerchHealthCheckName, PerchHealthCheck, PerchHealthStatus, PerchHealth;
export interface PerchHealthProbes, PerchProbeResult, PerchSessionCount, PerchHubProbe;
export function buildPerchHealth(probes): Promise<PerchHealth>;
export function createPerchHealthProbes(opts): PerchHealthProbes;
export function probeHub(hub, now): PerchProbeResult;
export function formatBytes(bytes: number): string;

// src/drain.ts
export const PERCH_DRAIN_TIMEOUT_MS = 30_000, PERCH_DRAIN_POLL_MS = 25;
export interface DrainReport, DrainOptions;
export function defaultDrainSleep(ms: number): Promise<void>;

// src/heartbeat.ts
export const PERCH_HEARTBEAT_JITTER = 0.1;
export function normalizeJitter(jitter: number | undefined): number;
export function nextHeartbeatDelay(opts): number;

// src/perch-daemon.ts
export interface StartPerchOptions { /* … */ advertiseCode?, heartbeatJitter?, random?, worktreeRoot?, freeBytes?, health? }
export interface PerchHandle { url; readonly nodeId?; stop(); drain(opts?): Promise<DrainReport> }

// src/compose-perch.ts
export interface ComposePerchOptions { /* … */ advertiseCode?, heartbeatJitter?, random?, freeBytes? }
export interface RealPerch { /* … */ drain(opts?): Promise<DrainReport> }
```

The locked Perch HTTP API gains one row: `GET /perch/health` (token required) → `PerchHealth`
(200/503). `POST /perch/tasks` can now answer 413 `payload-too-large` and 503 `draining`; every
`/perch/tasks/:runId/:key/*` route can answer 400 `invalid-params`.

**What C3 must add (CLI only; `apps/cli` is Wave 3b / Epic 203):** `--mdns-code`,
`--drain-timeout <ms>`, SIGTERM/SIGINT → `drain()`, and the new compose fields. Exact lines are in the
handback (§ *C3 wiring*).

## Deviations from plan

- `isSafeRef` rejects every `..` occurrence, not only a `..` *segment* (see above). The deliverable's
  pattern and probes are satisfied; the rule is strictly safer.
- The health check list in the deliverable names `runner` but the prose lists five probes; the
  `runner` check is implemented as "the `ExecutionNode` answers `info()`", which is the only
  runner-liveness signal the perch owns without spawning anything.
- `PerchApp.drainTasks` is the waiting primitive; `PerchHandle.drain` is the orchestration (set drain
  mode → announce → wait → stop). The prompt named the two methods but not where the wait lives; this
  split keeps the app testable without a server.
- `RealPerch.drain` was added (not requested) so the CLI does not have to reach into `handle` +
  `node.close()` + `runner.close()` itself.
- `tools/security/*` probes were edited only where the assignment allows it (five `test.failing`
  → `test`); the four hub body-size probes stay `test.failing` for Epic 110.
- `packages/perch/src/perch-daemon.test.ts`'s existing mDNS assertion was updated: it asserted the
  old "publish the code by default" behaviour, which this epic reverses.

## Known limitations / deferred

- No CLI flags / SIGTERM wiring yet (`apps/cli` is Wave 3b). Until then a perch drains only when
  something calls `PerchHandle.drain` programmatically.
- `discover` is unchanged (Epic 101's lane). It never read `txt.code`, so nothing breaks; a hub that
  wants the code on the wire needs the operator to pass `advertiseCode` (or type the code once).
- The hub's own body limit (Epic 110) is untouched; the four hub probes remain `test.failing`.
- Drain timeout is a default, not config: `PerchDrainOptions.timeoutMs` (30 s) is passed by the caller
  (C3 adds `--drain-timeout`). No `starling.config.yaml` key (root config is not this lane).
- Health does not probe opencode/LLM/Ollama reachability: those are per-session concerns and would
  make the endpoint slow and flaky. `runner` only proves the node object answers.
- `freeBytes` uses `statfs` on the worktree root; it does not account for disk quota or APFS
  purgeable space.
- A `%2F`-encoded slash in a route param is rejected by Hono's router (404) before `isSafeId` sees it;
  a plain `:`/space/`;` is a 400. Both fail closed.
- No TLS or per-node credentials: the join code is still the only secret (L18).
