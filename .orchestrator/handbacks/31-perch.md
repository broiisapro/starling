## Epic 31 Handback — Perch daemon

**Status:** Complete. Branch `epic/31-perch` @ `dbdc947`.

**Delivered:**

- `packages/perch/src/perch-app.ts` — `createPerchApp(deps): PerchApp` implementing every route of the ARCHITECTURE §6 Perch API exactly: `GET /perch/info`, `POST /perch/tasks`, `POST /perch/tasks/:runId/:key/prompt`, `POST /perch/tasks/:runId/:key/abort`, `POST /perch/tasks/:runId/:key/collect`, `GET /perch/tasks/:runId/:key/bundle?base=`, `DELETE /perch/tasks/:runId/:key`, `GET /perch/events`. One `app.use('*')` auth middleware; zod-validated bodies; JSON errors; `StarlingError` → status mapping; idempotent task start and cleanup; `PerchApp` adds `handles()` and `close()` for graceful shutdown.
- `packages/perch/src/perch-daemon.ts` — `startPerch(opts): Promise<PerchHandle>` binds `0.0.0.0` (default 7778, `idleTimeout: 120`), derives the LAN URL, advertises mDNS, registers with the hub, heartbeats every 3 s, backs off exponentially on network/5xx failures, re-registers on 404, and stops gracefully (abort sessions → offline heartbeat → unpublish mDNS → close listener). Idempotent `stop()`.
- `packages/perch/src/perch-info.ts` — `perchInfo(opts)` (OS facts, capacity from the node, `localModels` from `GET /api/tags` only when lending), `probeOs` (`scutil --get ComputerName` on macOS with hostname fallback), `listLocalModels`, `createLocalModelsProbe` (30 s success/failure cache).
- `packages/perch/src/auth.ts` — `tokensMatch` (SHA-256 + `timingSafeEqual`, fixed-length, no length leak) and `FLOCK_TOKEN_HEADER`.
- `packages/perch/src/lan.ts` — `findLanIPv4` (first non-internal IPv4, link-local skipped, loopback fallback) and `perchUrl`.
- `packages/perch/src/join-code.ts` — `randomJoinCode()` (`XXXX-XXXX`, unambiguous alphabet, unbiased).
- `packages/perch/src/mdns.ts` — `createBonjourAdvertiser` (lazy `bonjour-service`, correct `_starling._tcp` → `starling`/`tcp` translation), `splitServiceType`, `STARLING_SERVICE_TYPE`.
- `packages/perch/src/handshake.ts` — the required `// MIRROR of ARCHITECTURE §8…` header plus the locally-mirrored `MdnsAdvertiser`/`MdnsAdvertiseOptions` shape.
- `packages/perch/src/index.ts` — the public API.
- Tests (49): all routes happy-path/auth/validation/bundle/SSE ordering/keep-alive/idempotency/bus; `perchInfo` with injected OS/exec/fetch; register/heartbeat/backoff/404-re-register/stop with a scripted hub and `FakeClock`; and the required two-perch loopback test (two perches on ports 0, separate temp dirs, real in-process fake hub, register → task → SSE → collect → bundle → stop, and the stopped perch's heartbeats cease while the other keeps beating).
- `docs/epic-31-perch.md` with all six required sections and exact exported signatures + a CLI usage snippet.

**Key design decisions:**

- **Auth as one `*` middleware with hashed constant-time compare** — a per-route guard is easy to forget; hashing both sides makes `timingSafeEqual` length-safe and removes the length-timing signal.
- **Bundles only** — `POST /perch/tasks` rejects `repo.kind: 'local'`; a remote machine must never be able to ask a perch to read the hub's disk.
- **Idempotent start and cleanup** — retries after a dropped response return the existing handle / `{ ok: true }` instead of starting a second agent or failing.
- **Collect caches, bundle streams** — the result bundle already exists after `collect`; the bundle route serves `TaskResult.bundlePath` rather than re-running git. `base` is validated but informational.
- **SSE flushes `: connected` immediately** — Bun's `fetch` resolves on the first byte and Bun's default 10 s idle timeout killed quiet streams; the comment plus `idleTimeout: 120` fixes both.
- **Three recoveries for three failures** — network/5xx back off, 404 re-registers, 401 keeps backing off at the cap.
- **Offline heartbeat instead of a deregister route** — §6 has no deregister route; `stop()` sends a final `status: 'offline'` heartbeat and relies on `offlineAfterMs` otherwise.
- **Join code doubles as the API token and is advertised in mDNS TXT** — required for zero-config discovery under the L18 LAN-only/no-TLS threat model; an explicit hub code always wins.
- **`perchInfo` stays stateless, the daemon memoises Ollama** — pure and easy to test; the 30 s cache avoids 20 probes/minute and repeated 750 ms timeouts.
- **Explicit `AbortController` timeouts and `unref`'d timers** — no dangling timers or sockets after tests.

**Verification (exact commands + results):**

- `bun install` (worktree): `Checked 133 installs across 192 packages (no changes) [24.00ms]` — clean.
- `bun test packages/perch`: **49 pass / 0 fail**, `281 expect() calls`, `Ran 49 tests across 6 files. [353.00ms]`.
- `bun run test` (root): **234 pass / 0 fail**, `1065 expect() calls`, `Ran 234 tests across 42 files. [539.00ms]`.
- `bun run typecheck` (all workspaces): exit 0.
- `bunx biome check packages/perch`: `Checked 18 files in 6ms. No fixes applied.`
- `bun run check`: **fails on 9 pre-existing Biome format errors outside this lane** — `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`, `tools/local-models/{host,ollama,ollama.test,smoke}.ts` and two `tools/local-models/results/*.json`. `git diff --name-only origin/main -- docs tools` is empty; none of the 9 files is touched by this branch. The typecheck half of `bun run check` passes (above).
- No ports left open: `lsof -nP -iTCP -sTCP:LISTEN | grep -i bun` → `no bun listeners`; `lsof -iTCP:7778` → free. The loopback test additionally asserts a stopped perch refuses connections.

**Dependencies added:** `zod@4.6.7` in `packages/perch` (validation of the locked contracts). `hono@4.13.14` and `bonjour-service@1.4.4` were already in the package skeleton; `bonjour-service` was only reordered alphabetically.

**CONTRACT REQUESTS:**

1. Move `MdnsAdvertiseOptions` / `MdnsAdvertiser` into `@starling/core` (or add to ARCHITECTURE §8) at C1. Both `packages/flock/src/mdns.ts` (Epic 30) and `packages/perch/src/handshake.ts` (this epic) declare it; one shared definition avoids drift. Proposed shape: `{ advertise(opts: { name: string; type?: string; port: number; txt?: Record<string, string> }): void | Promise<void>; stop(): void | Promise<void> }`.
2. Consider a deregister route in the Perch table (e.g. `POST /perch/deregister` or `DELETE /perch`). Without one, graceful shutdown is a heuristic (`status: 'offline'` heartbeat). If Epic 30's `heartbeat` treats every heartbeat as "online", the offline signal is a no-op and the 15 s timeout does the cleanup — still correct, just less immediate.

**Deliberately deferred / out of scope:**

- `LocalNode` / `RemoteNode` / registry / scheduler / `FlockHub` (Epic 30).
- CLI flag parsing and process wiring (Epic 22).
- Real two-laptop testing and live mDNS discovery (Wave 2, Epic 42).
- TLS, auth rate limiting/lockout (locked out by L18 / not in scope).
- Worktree creation and cache-dir lifecycle (owned by `LocalNode`, Epic 30).
- Real `bonjour-service` integration tests (L23: no multicast sockets in build waves).

**Open questions / flagged tradeoffs:**

- The join code is published in the mDNS TXT record so a hub can discover and authenticate zero-config perches. This is the intended LAN-only model but means anyone on the LAN can read the code. If that is unacceptable, mDNS discovery must fall back to an out-of-band code exchange (and the join-code path already works).
- `POST /perch/tasks` returns **200** (not 201) and the collect body omits `bundlePath` (perch-local). Both match the assignment's wording; Epic 30's `RemoteNode` should not assert on 201 or on `bundlePath` being present.
- The heartbeat loop is driven by short real timers in tests plus `FakeClock` for timestamps, because the required signature has no injectable scheduler. If a future epic wants fully virtual time, add `sleep?: (ms: number) => Promise<void>` to `StartPerchOptions` rather than changing the loop.
