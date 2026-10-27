## Epic 30 Handback — Flock core: nodes, registry, scheduler, discovery
**Status:** Complete. Branch `epic/30-flock` @ f8c4e5f (feature head; the docs/handback commit follows).

**Delivered:**
- `packages/flock/src/handshake.ts` — verbatim ARCHITECTURE §8 mirror with the required header comment.
- `createLocalNode(opts): LocalNode` — `ExecutionNode` over `Workspace` + `AgentRunner`. Local-repo and
  bundle-sourced tasks, token-authenticated bundle download, per-run cache clone (clone then fetch),
  worktree creation, commit + diff + result bundle on `collect`, worktree removal on `cleanup`, live
  `activeSessions`, OS-derived `NodeInfo`, `infoProvider` overrides, per-session runner event filtering
  (including `session.started` emitted before `start()` resolves), synchronous capacity reservation, and
  `close()`.
- `createRemoteNode(opts): RemoteNode` — Perch API client for every §6 route; one reconnecting SSE
  stream; `collect` downloads the result bundle and imports it via `fetchBundle`; deadlines on every
  request (15 s JSON, 60 s bundle); network/timeout/5xx → `NODE_OFFLINE`, 401/403 → `INVALID_ARGUMENT`.
- `createRegistry(opts): FlockRegistry` — `add` / `remove` / `touch` / `sweep` / `close`, `joined` /
  `stats` / `left` events with a reason, FakeClock-friendly `sweep()`, unref'd background timer, timeout
  emits `left` with `heartbeat-timeout`, revival emits `joined` with the same id.
- `createScheduler()` plus pure helpers `rankNodes` / `freeSlots` / `isSchedulable` — most free slots →
  lowest latency → hub → id, `undefined` at zero capacity.
- `createFlockHub(opts): FlockHub` — 8-char join code from a 32-symbol unambiguous alphabet, displayed
  `XXXX-XXXX`; constant-time token verification over normalised input; `joinInfo()` command;
  register/heartbeat (unknown ids re-register when the heartbeat carries a URL); `bundle(ref)` cached by
  sha and written atomically with in-flight dedupe; mDNS auto-registration only for perches that answer
  `/perch/info` with the hub's code; `close()` tears down browsing and remote streams.
- `src/mdns.ts` — `MdnsBrowser` / `MdnsAdvertiser` interfaces, `perchUrl`, and `bonjour-service`
  implementations for `_starling._tcp`.
- `src/bundle-ops.ts` — local `BundleOps` mirror (`createBundle`, `cloneFromBundle`, `fetchBundle`) plus
  a working `git`-CLI implementation (`createBundleOps`).
- `src/http.ts` — deadline-aware `request` / `requestJson` / `requestBytes`, schema validation helper,
  hand-rolled SSE reader + reconnect loop, uniform error mapping and `FLOCK_TOKEN_HEADER`.
- `src/index.ts` — public surface; `docs/epic-30-flock.md` with the required sections and a usage
  snippet.
- 53 tests across 8 files (scheduler table, registry timeouts with `FakeClock`, LocalNode with core
  mocks + fake bundle ops, RemoteNode against an in-process fake perch on `Bun.serve({port:0})`,
  FlockHub with fake fetch/mDNS and real temp git repos, BundleOps round trip).

**Key design decisions:**
- Capacity is derived on the node (`info().activeSessions`), with a synchronous reservation inside
  `startTask`, so concurrent dispatch cannot oversubscribe and there is no second ledger to drift.
- Timed-out registry nodes are marked `offline` and announced `left`, but kept — the engine gets its
  reschedule signal without losing the `ExecutionNode` object or the node's identity.
- Service bundle cache clones detach HEAD; a plain clone from a bundle invents `master`, so
  `cloneFromBundle` clones `--branch <ref>` then detaches. This is required for the second task in a run
  to `fetch` the moved integration branch.
- Bundles are cached by resolved sha (not ref), written to a temp file and renamed, with one in-flight
  promise per path.
- `heartbeat` is synchronous per §8; an unknown id triggers a fire-and-forget `register` rather than
  throwing into the perch's heartbeat loop.
- 401/403 maps to `INVALID_ARGUMENT` (a wrong join code never heals with retry) and the SSE client stops
  on it; every other transport failure maps to `NODE_OFFLINE` and retries.
- Discovery treats failures as "not our perch" (`undefined`), keeping the manual `--hub/--code` path the
  only contract that must never break.

**Verification (exact commands + results):**
- `bun install`: `Checked 133 installs across 192 packages (no changes)`.
- `bun test packages/flock`: **53 pass / 0 fail**, `Ran 53 tests across 8 files. [667.00ms]`. No servers
  left behind (fake perches stopped in `afterEach`; SSE loops closed; registry timers unref'd).
- `bun run test` (root): **238 pass / 0 fail** — `Ran 238 tests across 44 files. [844.00ms]`.
- `bun run typecheck`: passes for every workspace (exit 0).
- `bun run check`: **fails only on pre-existing files outside my lane.** `bunx biome check .` reports 10
  errors, all in files that arrived on `main` before this branch:
  `tools/local-models/smoke.ts` (plus its `organizeImports` fix), `tools/local-models/host.ts`,
  `ollama.ts`, `ollama.test.ts`, two `tools/local-models/results/*.json` files, and
  `docs/epic-01-demo-target.md` + `docs/epic-02-repo-ops.md`. Sample:
  `tools/local-models/smoke.ts:33:1 assist/source/organizeImports` and
  `docs/epic-01-demo-target.md format`. Not fixed because AGENTS §1 forbids editing outside
  `packages/flock/**` (and another epic's doc). My lane is clean:
  `bunx biome check packages/flock docs/epic-30-flock.md` reports no issues, and `bun run typecheck`
  exits 0 for all workspaces.
- Manual: bundle round trip through real `git` (create → clone → fetch), hub bundle cache hit by sha,
  unknown ref → `EXEC_FAILED`, no active repo → `INVALID_ARGUMENT`, all covered by tests.

**Dependencies added:** none. `bonjour-service@1.4.4` was already present in `packages/flock/package.json`
from Epic 00.

**CONTRACT REQUESTS:**
1. `NodeRegistry.onChange` has no place for a leave reason; this epic emits
   `{ type, node, reason? }` (`heartbeat-timeout` vs an explicit leave), typed locally as
   `FlockRegistryEvent`. Add `reason?: string` to the onChange event in core (the `node.left`
   `StarlingEvent` already has one).
2. Consider a `NODE_AUTH` `StarlingErrorCode` (or documented guidance) for 401/403. This epic uses
   `INVALID_ARGUMENT` because no auth code exists, which is semantically workable but easily confused
   with a malformed argument.
3. Add an optional teardown to `ExecutionNode` (`close?(): void | Promise<void>`) or a small
   `Disposable` port. The hub currently duck-types `close()` on RemoteNodes it created so the SSE loop
   can be stopped; a port member would make that explicit for Epic 31/42.
4. At C1, move `BundleOps` from Epic 14 and this package's mirror into core/ports, and document that
   `cloneFromBundle` must leave HEAD off the bundled branch (otherwise the next `fetchBundle` into that
   ref is refused by git).
5. `FlockHub.heartbeat(input): void` cannot report "unknown node, please re-register". Either widen it to
   `Promise<{ ok: boolean; reRegister?: boolean }>` or keep §8 and let the server return 404 (Epic 31
   already plans to re-register on 404). Current implementation re-registers itself when `info.url` is
   present.

**Deliberately deferred / out of scope:**
- Perch HTTP daemon (`packages/perch`, Epic 31), engine dispatch/reschedule logic (Epic 20), web flock
  panel (Epic 32), real two-laptop run (Wave 2, Epic 42).
- Conflict resolver / task migration execution — the registry reports loss, the engine moves tasks.
- TLS and per-node credentials (LAN-only by L18), bundle garbage collection, scheduler affinity beyond
  free slots.

**Open questions / flagged tradeoffs:**
- **SSE has no backlog.** If a stream drops exactly when `session.idle` fires, the hub can miss the
  trigger. Epic 31 could add `Last-Event-ID` replay, or Epic 20 can poll/health-check as a safety net.
  Flagged in the doc; no client-interface change needed either way.
- **Unknown-id heartbeat re-registration needs `info.url`.** Epic 31's heartbeat body should include the
  perch's URL (or the hub should 404 so the perch re-registers). Decide at C1.
- **`registry.list()` keeps offline nodes** so the dashboard can show a roosting bird and the engine can
  revive it. Epic 32 should render `status: 'offline'` rather than expect the node to disappear; if the
  Sky prefers removal, the hub can filter.
- **`NodeInfo.kind` is forced to `'remote'` for registered perches**, even if a perch reports `local`
  about itself, because "local" is relative to whoever is asking.

Closes #24
