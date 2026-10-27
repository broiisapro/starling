# Epic 30 — Flock core: nodes, registry, scheduler, discovery

## Goal

Make Starling multi-machine. Before this epic the engine could only run agents on the laptop that
started the run. After it, an `ExecutionNode` can be the hub's own machine (`LocalNode`) or another
laptop reached over the LAN (`RemoteNode`), a `NodeRegistry` keeps the roster and notices when a perch
goes quiet, a `Scheduler` places work by free capacity, and a `FlockHub` owns join codes, heartbeats,
repo bundles and mDNS discovery. The demo moment this exists for: open the MacBook Air's lid, type the
join command, and watch tasks migrate onto it.

The scope is the flock _core_. The perch daemon that serves the Perch API is Epic 31; engine
rescheduling is Epic 20; the web flock panel is Epic 32; a real two-laptop run is Wave 2 (Epic 42).

## How it works

### The two nodes

`createLocalNode` composes the `Workspace` and `AgentRunner` ports (L20). `startTask`:

1. checks capacity, reserving a slot synchronously so two concurrent dispatches cannot oversubscribe;
2. prepares a repo: for `repo.kind === 'local'` it is the given path; for `{kind:'bundle'}` it downloads
   the bundle with `x-flock-token`, writes it under `<worktreeRoot>/_bundles`, and clones it into a
   per-run cache repo under `<worktreeRoot>/_repos` (or `git fetch`es the newer integration branch into
   that cache);
3. asks the workspace for a worktree at `opts.branch` from `opts.fromRef`;
4. calls `runner.start` and records the session.

`collect` commits everything, asks the workspace for the diff and changed files against the base ref,
and — for bundle-sourced tasks — writes the result bundle (`base..branch`) that the hub will fetch.
`cleanup` removes the worktree. `info()` reports live `activeSessions`, so the scheduler sees capacity
without a separate bookkeeping channel. Runner events are re-emitted only for sessions this node
started: one `opencode serve` on the hub hosts sessions from every node, and without that filter each
node would claim all of them. `session.started` can arrive before `runner.start` resolves, so the node
also tracks a "pending" run/task key until the session id is known.

`createRemoteNode` is a pure HTTP client for the locked Perch API (§6): `GET /perch/info`,
`POST /perch/tasks`, `/prompt`, `/abort`, `/collect`, `DELETE`, and `GET /perch/events` for SSE.
`collect` posts the base ref, downloads the returned bundle, writes it to `bundleDir`, and (when
`bundleOps.fetchBundle` is supplied) imports it into the hub repo as `handle.branch`, so audit and merge
stay on the hub. The SSE client holds one connection, parses SSE frames itself and reconnects after
`reconnectMs` (250 ms default). A 401/403 (wrong join code) stops it instead of retrying forever.

### Registry and scheduler

`createRegistry` stores node object + `NodeInfo` keyed by node id and emits `joined` / `stats` /
`left`. `sweep()` compares `clock.now() - info.lastSeen` with `offlineAfterMs`, marks offenders
`offline`, zeroes their `activeSessions` and emits `left` with `reason: 'heartbeat-timeout'`; a later
heartbeat emits `joined` again (identity preserved). A background timer drives `sweep()` by default
(unref'd, so it never keeps a process alive); tests disable it and drive the clock.

`createScheduler` is pure and task-agnostic: schedulable nodes are everything not `offline` with
`maxSessions - activeSessions > 0`; order is most free slots, then lowest `latencyMs`, then hub
(`id === 'hub'` or `kind === 'local'`), then id. `undefined` means "no capacity", never an
oversubscribed node.

### FlockHub and discovery

`createFlockHub` generates (or accepts) an 8-character join code from a 32-symbol alphabet with no
`0/O` or `1/I`, prints it as `XXXX-XXXX` and builds the join command. `verifyToken` normalises
(case, spaces, dashes) and compares in constant time. `register` creates a `RemoteNode` and adds it to
the registry; `heartbeat` touches it (or re-registers when the id is unknown and the heartbeat carries
a URL). `bundle(ref)` resolves the ref to a sha, writes `<bundleDir>/<sha>.bundle` via `git bundle
create` once (temp file + rename, in-flight dedupe) and returns that path for every perch asking for
the same ref.

When a `MdnsBrowser` is supplied, the hub browses `_starling._tcp`, probes each advertised perch at
`/perch/info` with its join code, and registers only those that answer 200. `createBonjourBrowser` /
`createBonjourAdvertiser` wrap `bonjour-service`; tests inject a fake and never open a multicast
socket.

### What tests cover

- Join codes: format, alphabet, normalisation, constant-time comparison, malformed input.
- Scheduler table: capacity, offline exclusion, busy-with-free-slots, latency/hub/id tie-breaks, no
  capacity, no input mutation.
- Registry: join/stat/leave, lastSeen stamping, timeout with `FakeClock`, revival, timer + `close`.
- LocalNode with core `MockWorkspace`/`MockRunner` and fake bundle ops: OS info, full lifecycle,
  per-session event filtering, bundle download with token, cache clone vs fetch, result bundle,
  oversubscription (sequential and concurrent), abort/prompt, runner-failure cleanup.
- RemoteNode against an in-process fake perch on `Bun.serve({port:0})`: start → SSE → collect → bundle
  download → `fetchBundle`, token rejection, timeout, reconnect, death → `NODE_OFFLINE` + registry
  `left`, tolerant cleanup.
- FlockHub: join command, token verification, register/heartbeat, unknown-id re-register, discovery
  probes (right and wrong code), mDNS wiring, real temp-git-repo bundles (cache, error paths).
- `BundleOps` against real temporary git repos: create → clone → fetch round trip, default path, error.

## Key decisions & reasoning

- **Capacity lives on the node, not the hub.** `LocalNode.info()` derives `activeSessions` from live
  sessions, so a perch can lie about its own `maxSessions` but not about how much work it is doing.
  Central accounting would need a second source of truth and would drift when a perch dies.
- **Registry keeps timed-out nodes.** Marking `offline` + emitting `left` is what the engine needs to
  reschedule; deleting the entry would also throw away the `ExecutionNode` object and force a full
  re-register on every brief heartbeat miss. `touch` revives and re-announces `joined`.
- **Heartbeat is fire-and-forget on an unknown id.** §8 types `heartbeat` as `void`, so the hub cannot
  await a re-registration. It kicks off `register` and relies on the next 3-second heartbeat if that
  attempt loses a race. A failed attempt is not silently lost: the perch keeps heartbeating, and the
  server can always answer 404 so Epic 31 re-registers explicitly.
- **Bundle cache repos detach HEAD.** The perch reuses one cache clone per run and fetches the
  integration branch again for the next task; git refuses to fetch into a checked-out branch. A plain
  clone from a bundle also invents `master`, so the clone asks for the bundled branch by name and then
  detaches. This is documented below as an expectation for Epic 14's `cloneFromBundle`.
- **Bundles are cached by sha and written atomically.** Ref names change as the integration branch
  moves, shas do not; `<sha>.bundle` makes the cache correct by construction. A temp file + rename
  means a crashed bundle is never served as a valid cache entry.
- **401/403 is `INVALID_ARGUMENT`, everything else network-ish is `NODE_OFFLINE`.** A wrong join code
  cannot heal with retries; a dropped LAN packet can. The SSE client stops on the former.
- **mDNS is opportunistic, manual codes are the contract.** Discovery failures return `undefined`
  rather than throwing, because another hub's perch on the same wifi is normal. The
  `--hub/--code` path never depends on multicast.
- **The HTTP layer is hand-rolled on `fetch` + `ReadableStream`.** No SSE client dependency, one
  reconnect loop, one place that maps errors, and every request has a deadline (JSON 15 s, bundle 60 s,
  SSE none).

## Interfaces for future epics

Everything is exported from `@starling/flock` (`packages/flock/src/index.ts`).

```ts
// ── nodes ───────────────────────────────────────────────────────────────
export function createLocalNode(opts: LocalNodeOptions): LocalNode;
export function createRemoteNode(opts: RemoteNodeOptions): RemoteNode;

export interface LocalNodeOptions {
  id?: string;
  name: string;
  workspace: Workspace & Partial<BundleOps>;
  runner: AgentRunner;
  maxSessions: number;
  worktreeRoot: string;
  clock?: Clock;
  infoProvider?: () => Partial<NodeInfo>;
  fetch?: typeof fetch;
  bundleDir?: string; // default <worktreeRoot>/_bundles
  repoCacheDir?: string; // default <worktreeRoot>/_repos
  downloadTimeoutMs?: number; // default 60_000
  headSha?: (dir: string) => Promise<string | undefined>;
}
export interface LocalNode extends ExecutionNode {
  readonly worktreeRoot: string;
  activeSessions(): number;
  close(): Promise<void>;
}

export interface RemoteNodeOptions {
  url: string;
  token: string;
  info: NodeInfo;
  fetch?: typeof fetch;
  clock?: Clock;
  bundleOps?: Partial<BundleOps>;
  bundleDir?: string; // default <tmpdir>/starling-flock
  timeoutMs?: number; // JSON calls, default 15_000
  downloadTimeoutMs?: number; // bundles, default 60_000
  reconnectMs?: number; // SSE, default 250
  events?: boolean; // false = HTTP-only
}
export interface RemoteNode extends ExecutionNode {
  readonly url: string;
  close(): void;
  lastEventError(): StarlingError | undefined;
}

// ── registry / scheduler ─────────────────────────────────────────────────
export function createRegistry(opts: {
  clock: Clock;
  offlineAfterMs: number;
  tickMs?: number;
  autoSweep?: boolean;
}): FlockRegistry;
export interface FlockRegistry extends NodeRegistry {
  add(node: ExecutionNode, info: NodeInfo): NodeInfo;
  remove(id: string, reason?: string): void;
  touch(id: string, info: NodeInfo): NodeInfo | undefined;
  sweep(): string[];
  close(): void;
  onChange(fn: (event: FlockRegistryEvent) => void): () => void;
}
export interface FlockRegistryEvent {
  type: 'joined' | 'left' | 'stats';
  node: NodeInfo;
  reason?: string;
}

export function createScheduler(opts?: { hubId?: string }): Scheduler;
export function rankNodes(nodes: NodeInfo[], opts?: { hubId?: string }): NodeInfo[];
export function freeSlots(node: NodeInfo): number;

// ── hub / discovery / bundles ────────────────────────────────────────────
export function createFlockHub(opts: FlockHubOptions): FlockHub;
export interface FlockHub extends MirrorOfHandshakeFlockHub {
  readonly code: string;
  readonly registry: FlockRegistry;
  discover(perch: DiscoveredPerch): Promise<string | undefined>;
}
export interface FlockHubOptions {
  registry: FlockRegistry;
  hubUrl: string;
  code?: string;
  exec?: typeof exec;
  bundleDir: string;
  clock: Clock;
  mdns?: MdnsBrowser;
  fetch?: typeof fetch;
  timeoutMs?: number;
  reconnectMs?: number;
  bundleOps?: Partial<BundleOps>;
  bundleTimeoutMs?: number;
}

export interface MdnsBrowser {
  browse(onFound: (p: DiscoveredPerch) => void): () => void;
  close(): void;
}
export interface MdnsAdvertiser {
  advertise(s: { name: string; port: number; txt?: Record<string, string> }): void;
  stop(): void;
}
export function createBonjourBrowser(opts?: { type?: string }): MdnsBrowser;
export function createBonjourAdvertiser(opts?: { type?: string }): MdnsAdvertiser;

export interface BundleOps {
  createBundle(repo: string, ref: string, opts?: { base?: string; outPath?: string }): Promise<string>;
  cloneFromBundle(bundlePath: string, dir: string, ref: string): Promise<void>;
  fetchBundle(repo: string, bundlePath: string, ref: string, intoBranch: string): Promise<void>;
}
export function createBundleOps(opts?: { exec?: typeof exec; dir?: string; timeoutMs?: number }): BundleOps;

export function generateJoinCode(random?: (n: number) => Uint8Array): string;
export function formatJoinCode(code: string): string;
export function normalizeJoinCode(code: string | undefined): string;
export function verifyJoinCode(expected: string, candidate: string | undefined): boolean;
export function isValidJoinCode(code: string): boolean;
export function constantTimeEqual(a: string, b: string): boolean;
```

`JoinInfo` and `BundleUrlFor` are re-exported from the local §8 mirror (`src/handshake.ts`); the rest
of the mirror stays private so a future move into `@starling/core` cannot collide with this package's
own `FlockHub` extension.

### Usage

```ts
import { createEventBus } from '@starling/core';
import {
  createBundleOps,
  createFlockHub,
  createLocalNode,
  createRegistry,
  createScheduler,
} from '@starling/flock';

// Hub process: one local node + a roster + a hub.
const registry = createRegistry({ clock, offlineAfterMs: config.flock.offlineAfterMs });
const local = createLocalNode({
  id: 'hub',
  name: 'Moksh’s MacBook Pro',
  workspace,
  runner,
  maxSessions: config.flock.hubMaxSessions,
  worktreeRoot: config.worktreeRoot,
  clock,
});
registry.add(local, await local.info());

const flock = createFlockHub({
  registry,
  hubUrl: 'http://192.168.1.10:7777',
  clock,
  exec,
  bundleDir: join(config.worktreeRoot, '_hub-bundles'),
  bundleOps: createBundleOps(), // imports a perch's result into the hub repo
  mdns: createBonjourBrowser(),
});
flock.setActiveRepo(repoPath);
// GET /api/flock/join → flock.joinInfo() → "starling perch --hub … --code K7QM-3XPH"

// Engine dispatch (Epic 20):
const nodeId = scheduler.pick(registry.list(), task);
const node = registry.get(nodeId!)!;
const repo =
  nodeId === 'hub' || node.info().kind === 'local'
    ? { kind: 'local' as const, path: repoPath }
    : { kind: 'bundle' as const, ...bundleUrlFor(integrationBranch) };
const handle = await node.startTask({
  runId,
  taskKey: task.key,
  title: task.title,
  repo,
  fromRef: integrationBranch,
  branch,
  prompt,
  model,
});
// later: await node.collect(handle, repoPath, integrationBranch)

// Perch process (Epic 31): the same LocalNode, served over the Perch API and advertised.
```

## Deviations from plan

- **Extra options, not changed contracts.** `createRemoteNode` grew `bundleOps`, `bundleDir`,
  `downloadTimeoutMs`, `reconnectMs` and `events`; `createFlockHub` grew `fetch`, `bundleOps`,
  `bundleTimeoutMs` and `discover`. Without an injectable `fetch`/`fetchBundle` the network-facing
  behaviour could not be tested under L23. Both additions are optional and supersets of the requested
  shapes.
- **`createFlockHub` takes a writable `FlockRegistry`.** §8 types `registry: NodeRegistry`, which has
  no `add`/`touch`; registration cannot work through the read-only port. The returned hub still
  satisfies §8's `FlockHub` (its `registry` is a `NodeRegistry`).
- **`heartbeat` on an unknown id re-registers asynchronously.** §8 fixes the return type as `void`; the
  alternative (throwing) would break the perch's heartbeat loop. See _Open questions_.
- **`BundleOps` is a local mirror with the same names as Epic 14's export**, per the assignment. It also
  provides a working implementation (`createBundleOps`), so a perch or the hub can run before the
  workspace epic is wired in. The only behavioural expectation beyond the names is that
  `cloneFromBundle` must not leave HEAD on the bundled branch (otherwise the next `fetchBundle` into
  that ref is refused by git); the local implementation detaches HEAD.
- **LocalNode rejects a second `startTask` for a task that is still running** rather than replacing it.
  Silently swapping sessions would hide an engine bug and leak a worktree; the engine always cleans up
  before a retry.
- **`scheduler.pick` ignores its `task` argument.** Lanes are a plan constraint and any task may run
  anywhere; the parameter is kept for the port and for a future local-model affinity policy.
- **`info()` on `RemoteNode` throws rather than returning stale data** when the perch is unreachable.
  The registry owns last-known state; a caller that wants it can use `registry.list()`.

## Known limitations / deferred

- **SSE has no backlog.** `/perch/events` carries live events only (locked API). If a stream drops at
  the exact moment a `session.idle` is emitted, the hub can miss the trigger. The engine (Epic 20)
  should treat a heartbeat-timeout or a periodic poll as a safety net; Epic 31 could add `Last-Event-ID`
  replay without changing the client interface.
- **No real multi-laptop test.** mDNS uses `bonjour-service` untested against real multicast; only the
  browser interface is covered. Epic 42 owns the real Air-and-Pro run.
- **LAN-only, no TLS or per-node credentials** (L18). The join code is a shared secret in a header;
  anyone on the wifi who sees it can join. That is the documented demo tradeoff.
- **Bundle cache is per run id on the perch and per sha on the hub.** A perch that restarts mid-run
  reclones; the hub's bundle files are never garbage-collected.
- **`LocalNode.collect` needs git for the head sha** when the agent committed nothing. It is injectable
  (`headSha`) and falls back to the base ref, but a workspace-only deployment without `git` in PATH
  would need that injection.
- **Remote cleanup is best effort** and tolerates `NODE_OFFLINE` by design; a cleanup that fails for
  another reason still throws so a misbehaving perch does not hide.
- **No affinity/backpressure beyond slots.** A perch with a warm local model is not preferred for
  auditor-adjacent work; that is a scheduler policy decision for later.
- **Perch → hub migrations are engine work.** Registry and scheduler only report and rank; nothing here
  moves a running task.
