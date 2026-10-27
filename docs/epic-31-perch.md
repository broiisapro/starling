# Epic 31 — Perch daemon

## Goal

Make `starling perch` real. A perch is the daemon that turns a second laptop into a member of the
flock: it exposes its local `ExecutionNode` over the locked Perch HTTP API, advertises itself as
`_starling._tcp` on the LAN, registers with the hub using the flock join code, and heartbeats until
it is stopped. The hub can then schedule agents onto it, stream their events back, and collect the
result bundle — all without the perch ever touching the hub's filesystem or git repo.

This epic owns the **server side** of flock mode. Epic 30 owns `LocalNode`/`RemoteNode`, the
registry, the scheduler and the hub; Epic 22 owns CLI flag parsing; Epic 42 proves two real laptops.

## How it works

### The HTTP surface (`src/perch-app.ts`)

`createPerchApp` builds a Hono app implementing every row of the ARCHITECTURE §6 Perch table:

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `/perch/info` | `await deps.info()` → `NodeInfo` |
| POST | `/perch/tasks` | zod-validates `StartTaskOptions`, rejects `repo.kind: 'local'`, calls `node.startTask`, remembers the handle |
| POST | `/perch/tasks/:runId/:key/prompt` | forwards a fixer prompt to the same session |
| POST | `/perch/tasks/:runId/:key/abort` | aborts the session |
| POST | `/perch/tasks/:runId/:key/collect` | `node.collect(handle, '', baseRef)`, caches the `TaskResult` |
| GET | `/perch/tasks/:runId/:key/bundle?base=<ref>` | streams `TaskResult.bundlePath` as `application/octet-stream` |
| DELETE | `/perch/tasks/:runId/:key` | `node.cleanup`, drops the cached handle/result |
| GET | `/perch/events` | SSE of the node's `AgentEvent`s, with a keep-alive |

Every route goes through one `app.use('*')` middleware, so a future route cannot ship
unauthenticated by accident. `x-flock-token` is compared against the join code with
`tokensMatch`: both values are SHA-256 hashed and compared with `timingSafeEqual`, so the comparison
is over a fixed 32 bytes and neither the length nor the first differing byte leaks.

Handles are keyed by `runId/taskKey`, because the Perch API addresses tasks by path while
`ExecutionNode` speaks `TaskHandle`. `collect` caches the `TaskResult`; the bundle route streams the
`bundlePath` the node already wrote instead of re-running git. Bodies are parsed with the frozen
`StartTaskOptionsSchema` plus two small local schemas (`{ prompt }`, `{ baseRef }`). Errors are
always `{ error: { code, message } }`; a thrown `StarlingError` is mapped by `app.onError`
(`NODE_OFFLINE` → 503, `INVALID_ARGUMENT` → 400, everything else → 500).

`createPerchApp` returns a `PerchApp`: a Hono app with two extra methods, `handles()` and
`close()`. `startPerch` needs them for a graceful stop (abort in-flight sessions) without reaching
into private maps. The value is still assignable to `Hono`, so the assignment's signature holds.

### The daemon (`src/perch-daemon.ts`)

`startPerch`:

1. Normalises the hub URL, resolves the token (`token` → `code` → a generated `XXXX-XXXX` code when
   running without a hub), and refuses to join a hub without one.
2. Probes the OS once (name, platform, arch, cores, memory).
3. Creates the app, binds `Bun.serve` on `0.0.0.0` (default port 7778, `idleTimeout: 120` for SSE)
   and computes the URL from the first non-internal IPv4.
4. Advertises `_starling._tcp` with the join code and node name in the TXT record, if an advertiser
   was supplied. mDNS failure is logged, never fatal.
5. If a hub was given, registers (`POST /api/flock/register`) and then heartbeats every 3 s
   (`POST /api/flock/heartbeat`). `startPerch` awaits the first attempt so `nodeId` is normally
   populated when it resolves, but hub failures never reject the call.
6. Returns `{ url, nodeId, stop }`; `nodeId` is a getter so a later successful retry is visible.

The loop's failure policy:

- network error / non-OK response → exponential backoff (`backoffMs · 2^(n-1)`, capped at
  `maxBackoffMs`, default 500 ms → 30 s), retry forever;
- heartbeat `404` (hub restarted or forgot the node) → drop the id and re-register;
- heartbeat `500` → back off but keep the id;
- registration rejection → back off (a wrong join code therefore retries at the cap rather than
  hammering the hub).

`stop()` is idempotent: it clears the heartbeat timer, aborts every in-flight session through
`app.close()`, sends a final heartbeat with `status: 'offline'` (the closest thing to deregistration
the locked API allows), unpublishes mDNS, and closes the listener with `server.stop(true)`.

### `perchInfo` (`src/perch-info.ts`)

Builds a `NodeInfo` from two sources: the wrapped `ExecutionNode` (capacity, active sessions, its
own id until the hub assigns one) and an OS probe. On macOS the probe runs
`scutil --get ComputerName` (via core's injectable `exec`) and falls back to `os.hostname()`; it also
reports `os.platform()`, `os.arch()`, `os.cpus().length` and `os.totalmem()` rounded to 0.1 GB.

`localModels` is only probed when `lendModels` is not `false`, and the probe is a single
`GET {ollamaUrl}/api/tags` — the metadata endpoint behind `ollama list`, which does **not** load a
model. A sleeping Ollama is the normal case: any failure means `[]`, never an error. The daemon
wraps the probe in `createLocalModelsProbe`, which caches successes *and* failures for 30 s so a
3 s heartbeat loop does not hammer Ollama or pay a 750 ms timeout every tick.

A perch is always reported as `kind: 'remote'`, even when it is this laptop's own daemon: from the
hub's point of view every node reached over HTTP is remote.

### mDNS (`src/mdns.ts`)

`createBonjourAdvertiser` is the `bonjour-service` implementation of the `MdnsAdvertiser` interface.
It imports the package lazily (unit tests never open a multicast socket, per L23), translates the
full DNS-SD type (`_starling._tcp`) into the bare name/protocol Bonjour wants, and exposes `stop()`.

## Key decisions & reasoning

- **One auth middleware, hashed constant-time compare.** A per-route guard is easy to forget when a
  route is added; middleware on `*` is not. Hashing first removes the length-timing signal and the
  `timingSafeEqual` length exception in one move.
- **Bundles only.** `POST /perch/tasks` rejects `repo.kind: 'local'`. A remote machine must never be
  able to ask the perch to read the hub's disk; the type system allows it, the API refuses it.
- **Idempotent start and cleanup.** A hub whose Wi-Fi drops the response will retry. `POST
  /perch/tasks` returns the existing handle for the same `runId/taskKey` instead of starting a
  second agent on the same branch, and `DELETE` returns `{ ok: true }` when the task is already gone.
- **Collect caches, bundle streams.** `collect` already made the result bundle; re-running
  `git bundle create` in the HTTP handler would be slower and could disagree with the cached diff.
  The `base` query is validated but unused, because the bundle was cut against it at collect time.
- **SSE flushes a `: connected` comment immediately.** Bun's `fetch` does not resolve until the
  first byte, and an idle stream with a 15 s keep-alive exceeded Bun's 10 s default idle timeout.
  The comment fixes both; `Bun.serve({ idleTimeout: 120 })` keeps long, quiet streams alive.
- **Backoff with three distinct recoveries.** Network failures are transient (retry), 404s are
  identity loss (re-register), 500s are hub trouble (retry with the same id). Treating them all the
  same would either duplicate registrations or leave a node heartbeating into the void.
- **Offline heartbeat instead of a deregister route.** The Perch API is locked and has no
  deregister route. A final heartbeat with `status: 'offline'` gives a well-behaved hub an immediate
  signal; if it ignores it, the 15 s `offlineAfterMs` timeout still cleans up.
- **The join code is the API token, and it is in the mDNS TXT record.** A hub doing zero-config
  discovery needs a code to authenticate with. Publishing it on the LAN matches the L18 threat model
  (LAN-only, no TLS, shared join code); a hub that already has a code passes it explicitly.
- **First non-internal IPv4, link-local skipped.** The assignment asks for the first non-internal
  IPv4. `169.254/16` means DHCP failed and the address is not routable from the other laptop, so it
  is skipped; offline falls back to `127.0.0.1` so a single-laptop demo still works. `publicHost`
  exists so tests (and a future `--host` flag) can override it.
- **`perchInfo` is stateless; the daemon memoises.** Keeping `perchInfo` pure makes it trivial to
  test with injected OS/exec/fetch fakes. The 30 s model cache lives in the daemon, where the
  heartbeat cadence is known.
- **No dangling timers.** Every hub call and Ollama probe uses an explicit `AbortController` with a
  cleared timeout, and timers are `unref`'d. Tests finish in ~350 ms and leave no sockets behind.

## Interfaces for future epics

Everything below is exported from `@starling/perch` (`src/index.ts`). `src/test-helpers.ts` is
test-only and deliberately not exported.

```ts
// ── daemon ───────────────────────────────────────────────────────────────
export interface StartPerchOptions {
  node: ExecutionNode;
  hub?: string;
  code?: string;
  port?: number;                 // default 7778
  hostname?: string;             // bind address, default '0.0.0.0'
  name?: string;                 // 'auto' -> ComputerName -> hostname
  maxSessions?: number;
  lendModels?: boolean;
  mdns?: MdnsAdvertiser;
  clock?: Clock;
  fetch?: typeof fetch;
  heartbeatMs?: number;          // default 3000
  backoffMs?: number;            // default 500
  maxBackoffMs?: number;         // default 30000
  requestTimeoutMs?: number;     // default 5000
  keepAliveMs?: number;          // SSE ping, default 15000
  ollamaUrl?: string;
  exec?: ExecFn;
  os?: OsProbe;
  bus?: EventBus;
  token?: string;
  publicHost?: string;
}

export interface PerchHandle {
  url: string;
  readonly nodeId?: string;
  stop(): Promise<void>;
}

export function startPerch(opts: StartPerchOptions): Promise<PerchHandle>;

// ── HTTP app ─────────────────────────────────────────────────────────────
export interface PerchAppDeps {
  node: ExecutionNode;
  token: string;
  info: () => Promise<NodeInfo>;
  bus?: EventBus;
  clock?: Clock;
  keepAliveMs?: number;
}

export type PerchApp = Hono & {
  handles(): TaskHandle[];
  close(): Promise<void>;
};

export function createPerchApp(deps: PerchAppDeps): PerchApp;

// ── node info ────────────────────────────────────────────────────────────
export type ExecFn = (cmd: string[], opts: ExecOptions) => Promise<ExecResult>;
export interface OsFacts {
  hostname: string;
  computerName?: string;
  platform: string;
  arch: string;
  cpuCores: number;
  memGb: number;
}
export type OsProbe = () => Promise<OsFacts>;

export function probeOs(opts?: ProbeOsOptions): Promise<OsFacts>;
export function listLocalModels(opts?: ListLocalModelsOptions): Promise<string[]>;
export function createLocalModelsProbe(opts?: LocalModelsProbeOptions): () => Promise<string[]>;
export function perchInfo(opts: PerchInfoOptions): Promise<NodeInfo>;

// ── LAN, auth, join code, mDNS ───────────────────────────────────────────
export function findLanIPv4(interfaces?: ReturnType<typeof networkInterfaces>): string;
export function perchUrl(host: string, port: number): string;
export function randomJoinCode(): string;
export const FLOCK_TOKEN_HEADER: string;
export function tokensMatch(provided: string | undefined, expected: string): boolean;
export const STARLING_SERVICE_TYPE: string;   // '_starling._tcp'
export function createBonjourAdvertiser(opts?: BonjourAdvertiserOptions): MdnsAdvertiser;
export function splitServiceType(serviceType: string): { name: string; protocol: 'tcp' | 'udp' };

// ── handshake mirror (Epic 30's MdnsAdvertiser, moved to core at C1) ─────
export interface MdnsAdvertiseOptions {
  name: string;
  type?: string;
  port: number;
  txt?: Record<string, string>;
}
export interface MdnsAdvertiser {
  advertise(opts: MdnsAdvertiseOptions): void | Promise<void>;
  stop(): void | Promise<void>;
}
```

Usage — the CLI (Epic 22) wires Epic 30's `LocalNode` into the daemon:

```ts
import { createBonjourAdvertiser, startPerch } from '@starling/perch';
import { createLocalNode } from '@starling/flock';

const node = createLocalNode({
  name: 'M2 Air',
  workspace,
  runner,
  maxSessions: 5,
  worktreeRoot: '~/.starling/perch/worktrees',
});

const perch = await startPerch({
  node,
  hub: 'http://192.168.1.20:7777',
  code: 'ABCD-EFGH',
  port: 7778,
  maxSessions: 5,
  mdns: createBonjourAdvertiser(),
});

console.log(`perch at ${perch.url} (node ${perch.nodeId})`);
process.on('SIGINT', () => void perch.stop());
```

Consumers of the HTTP API (Epic 30's `RemoteNode`, Epic 21's `/api/nodes`, Epic 32's flock panel)
should treat `TaskResult.bundlePath` as perch-local: it is never sent in the collect response, only
the bytes are served from `/perch/tasks/:runId/:key/bundle`.

## Deviations from plan

- **`createPerchApp` returns `PerchApp`, not a bare `Hono`.** It is a Hono subtype with `handles()`
  and `close()`; the daemon needs both for a graceful stop. Assignable everywhere a `Hono` is
  expected.
- **Extra optional options.** `StartPerchOptions` adds `token`, `publicHost`, `heartbeatMs`,
  `backoffMs`, `maxBackoffMs`, `requestTimeoutMs`, `keepAliveMs`, `ollamaUrl`, `exec`, `os`, `bus`
  and `lendModels`; `PerchAppDeps` adds `clock` and `keepAliveMs`. All are additive and defaulted.
- **`MdnsAdvertiser` is a local mirror.** It is not in ARCHITECTURE §8 yet; it is declared in
  `src/handshake.ts` with the required header comment and matched to Epic 30's planned
  `packages/flock/src/mdns.ts` shape. Filed as a CONTRACT REQUEST to move it into core at C1.
- **"Deregister if possible" is an offline heartbeat.** The locked Perch table has no deregister
  route, so `stop()` sends one last heartbeat with `status: 'offline'` and relies on the hub's
  `offlineAfterMs` otherwise.
- **`/api/tags` instead of `ollama list`.** The assignment mentions `ollama list`; L23 forbids
  running `ollama` commands, and `/api/tags` is the same metadata without loading a model.
- **Tests use short real timers plus `FakeClock`.** There is no injectable scheduler in the
  assignment's signature, so the loop is exercised with 10–15 ms intervals; `FakeClock` pins the
  `lastSeen` timestamps and the model-probe TTL. Backoff/re-register behaviour is scripted through a
  fake `fetch`, and the end-to-end loopback test uses a real in-process hub.
- **Loopback "separate cache dirs".** Cache dirs belong to `LocalNode` (Epic 30), not the perch. The
  test gives each perch its own temp dir and result bundle, which proves the two instances share no
  state.

## Known limitations / deferred

- **No TLS.** Locked by L18; the join code is the only secret and it is advertised over mDNS for
  zero-config discovery. Anyone on the LAN can see it — the documented threat model.
- **mDNS is not exercised by unit tests.** Constructing `bonjour-service` opens a multicast socket,
  which L23 forbids in build waves. Only the type translation and the post-stop guard are tested;
  real discovery is Epic 42.
- **The `base` query on the bundle route is informational.** The bundle was already cut by
  `collect`; the handler validates the parameter but does not re-cut.
- **No rate limiting or lockout.** A wrong join code retries at the backoff cap forever. The CLI
  should surface the repeated 401 (Epic 22).
- **`activeSessions` is only as fresh as `ExecutionNode.info()`.** The perch reports what the node
  says; it does not track sessions itself.
- **`stop()` aborts sessions but does not remove worktrees.** That is `LocalNode.cleanup`'s job
  (Epic 30); a restarted perch can reuse or clean them.
- **The bundle path must stay readable until the hub downloads it.** The perch does not delete it on
  `DELETE`; the local node owns the cache directory lifecycle.
