## Epic 102 Handback — Perch hardening: body limits, hostile refs, mDNS code opt-in, health, drain, jitter

**Status:** Complete. Branch `epic/102-perch-hardening` @ <short-sha>.

**Delivered:**
- **SEC-05 body limit.** `PERCH_MAX_BODY_BYTES = 256 * 1024` exported from `packages/perch/src/perch-app.ts`; `readJson(c, schema, { maxBytes })` rejects a declared `content-length` over the limit first, then counts streamed bytes via `c.req.raw.body.getReader()`, answering **413** `{ error: { code: 'payload-too-large', message } }`. Wired into `/perch/tasks`, `…/prompt`, `…/collect`; prompt/collect parse before the handle lookup, so the limit is independent of session state.
- **SEC-10 hostile refs.** New `src/validate.ts`: `isSafeRef` (`^[A-Za-z0-9._/-]{1,200}$`, no leading `-`, no `..`, no empty segment, no `@{`), `isSafeId` (`^[A-Za-z0-9._-]{1,128}$`), `PerchStartTaskSchema` (`StartTaskOptionsSchema.superRefine`), `PerchPromptSchema`, `PerchCollectSchema`. `POST /perch/tasks` → 400 `invalid-body`; every `:runId/:key` route validates params → 400 `invalid-params`; `?base=` and `collect.baseRef` use the ref rule. `node.startTask` is never reached with a hostile value.
- **SEC-07 mDNS code opt-in.** `StartPerchOptions.advertiseCode` (default false) and `ComposePerchOptions.advertiseCode`; TXT is `{ node }` unless opted in, then `{ node, code }`. `docs/epic-31-perch.md` is not this lane → FIX REQUEST below.
- **`GET /perch/health`.** New `src/health.ts`: `buildPerchHealth(probes)`, `createPerchHealthProbes(...)`, `probeHub`, `formatBytes`, `PERCH_MIN_FREE_BYTES` (2 GiB), `PERCH_HEARTBEAT_STALE_FACTOR` (3). Checks `git | runner | worktreeRoot | disk | sessions | hub`, all injected (exec, `freeBytes`, node, clock, last-ack). 200 when ok, 503 when degraded/draining, 503 `health-unavailable` without probes.
- **Graceful drain.** New `src/drain.ts` (`DrainReport`, `DrainOptions`, `PERCH_DRAIN_TIMEOUT_MS = 30_000`, `PERCH_DRAIN_POLL_MS = 25`, `defaultDrainSleep`). `PerchApp.setDraining/isDraining/drainTasks`; `PerchHandle.drain(opts)` = refuse new tasks (503 `draining`), replay an existing handle, advertise `maxSessions = activeSessions`, send one immediate heartbeat, wait for the hub's `DELETE`s, abort the remainder at the timeout, then `stop()`. `RealPerch.drain()` closes the runner too. Idempotent.
- **Heartbeat jitter.** New `src/heartbeat.ts`: `PERCH_HEARTBEAT_JITTER = 0.1`, `normalizeJitter`, `nextHeartbeatDelay`. `StartPerchOptions.heartbeatJitter` / `random` (and the same on compose); applied to register→heartbeat and heartbeat→heartbeat, not to error backoff.
- **Probes flipped** (5): `rejects a 1 MiB prompt before starting a session`, `rejects a 1 MiB fixer prompt` (`tools/security/body-size.test.ts`), `rejects a hostile branch and fromRef with a 400`, `does not forward a hostile branch/fromRef to the node` (`tools/security/perch-tasks.test.ts`), `does not publish the join code in the mDNS TXT record by default` (`tools/security/secrets.test.ts`). The four hub body-size probes remain `test.failing` for Epic 110.
- **Tests:** +69 (59 → 128 in `packages/perch`), in `validate.test.ts`, `body-limit.test.ts`, `hostile-refs.test.ts`, `health.test.ts`, `drain.test.ts`, `heartbeat-jitter.test.ts`, plus the updated daemon mDNS test and `/perch/health` added to the auth-matrix test. `loopback.test.ts` remains green.
- Docs: `docs/epic-102-perch-hardening.md`.

**Key design decisions:**
- Two-phase body limit (header then streamed count). A header check alone is bypassable with chunked encoding; counting alone reads a gigabyte before rejecting. 256 KiB matches SEC-05's hub number so the two surfaces cannot disagree.
- Body parsed before handle lookup on prompt/collect. Visible change: a giant body on a dead session is 413 instead of 404. The probe requires the boundary to be session-independent.
- `isSafeRef` rejects any `..` anywhere (git forbids it in ref names), not only a `..` segment: strictly safer, same probes.
- `invalid-params` 400 for a bad `:runId`/`:key` rather than 404, so a hub bug does not look like a forgotten task (which triggers re-register).
- mDNS code off by default: discovery still works (name/type/port; the hub authenticates with the code it already has), at the cost of typing the code once. Documented as a product tradeoff in the epic doc.
- Health probes are injected and uncached; a throwing probe is a failed check, not a failed request. `runner` = "the `ExecutionNode` answers `info()`". `sessions` fails only on `active > max`, so a full perch is not "unwell".
- Drain waits on the handle map rather than agent events: a session goes idle long before its bundle is collected, and `DELETE` is the hub's only "safe to drop" signal. `maxSessions = activeSessions` needs no hub change (`maxSessions - activeSessions` = 0) and keeps the perch visible instead of triggering migration.
- `now`/`sleep` are injected end to end, so the drain paths are proven with a `FakeClock` and no wall-clock waits.
- Jitter is 10%: enough to de-correlate ten laptops, well inside the hub's 15 s (5-period) offline window. Backoff is intentionally not jittered.

**Verification (exact commands + results):**
- `bun install --frozen-lockfile`: `Checked 172 installs across 225 packages (no changes)`; `bun.lock` unchanged (git status clean apart from the new doc).
- `bun test packages/perch`: `128 pass, 0 fail, 565 expect() calls, Ran 128 tests across 14 files` (baseline was 59).
- `bunx tsc --noEmit -p packages/perch`: clean.
- `bun test tools/security/body-size.test.ts tools/security/perch-tasks.test.ts tools/security/secrets.test.ts`: `19 pass, 0 fail, 40 expect() calls` with the five perch probes flipped (hub probes still `test.failing` as required).
- Live health check from a real perch started by a script (`startPerch` + `MockNode`, port 7788, token `DEMO-CODE`):
  ```
  $ curl -s -H 'x-flock-token: DEMO-CODE' 127.0.0.1:7788/perch/health
  {"ok":true,"status":"ok","checks":[{"name":"git","ok":true,"detail":"git version 2.54.0"},{"name":"runner","ok":true,"detail":"demo-perch · online · 0/5 sessions"},{"name":"worktreeRoot","ok":true,"detail":"/tmp is writable"},{"name":"disk","ok":true,"detail":"132.5 GiB free (minimum 2.0 GiB)"},{"name":"sessions","ok":true,"detail":"0/5 sessions"},{"name":"hub","ok":true,"detail":"no hub configured (mDNS only)"}]}
  $ curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:7788/perch/health   # no token
  401
  ```
- `bash .orchestrator/bin/heavy.sh bun run test` (root): first half `2007 pass, 4 skip, 0 fail, 29 snapshots, 8862 expect() calls, Ran 2011 tests across 229 files`; second half (web) `581 pass, 0 fail, 4164 expect() calls, Ran 581 tests across 60 files`.
- `bash .orchestrator/bin/heavy.sh bun run check`: `Checked 986 files` (biome, no fixes) + `tsc --noEmit` loop over `packages/* apps/*` clean.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none. The new surface is additive inside `@starling/perch`; the locked Perch API gains only `GET /perch/health`, documented in the epic doc.

**Carryover done** (`.orchestrator/fix-requests-w2.md`, requests targeting `packages/perch/**`):
1. **SEC-05 (69), perch half** — implemented: `readJson` takes `{ maxBytes }`, default `PERCH_MAX_BODY_BYTES`, 413 `payload-too-large`, applies to every POST route. The hub half (`apps/server/src/http.ts`) is Epic 110's, untouched.
2. **SEC-07 (69), perch half** — implemented: TXT `{ node }` by default, `advertiseCode`/`--mdns-code` opt-in. No other perch request in the file; `docs/epic-31-perch.md` update is the FIX REQUEST below.
3. **SEC-10 (69)** — implemented: `PerchStartTaskSchema` + `isSafeRef`/`isSafeId`, 400 `invalid-body` / `invalid-params`, `node.startTask` never called with a hostile value.
- Declined / not mine: every other perch-adjacent request in the file targets `apps/cli`, `apps/server`, `packages/flock`, `packages/engine` or `packages/core` (e.g. SEC-02/03 to flock, SEC-01/06/09 to the server, `42/4–5` to the CLI). None required a perch change.

**C3 wiring** (what checkpoint C3 must add; `apps/cli` is Wave 3b / Epic 203):

1. `apps/cli/src/real/perch-compose.ts` — carry the new options through:
   ```ts
   export interface PerchFlagOptions { /* … */ mdnsCode?: boolean; drainTimeoutMs?: number }
   export interface PerchComposeInput { /* … */ advertiseCode: boolean; drainTimeoutMs?: number }
   // perchComposeInput(): return { ..., advertiseCode: flags.mdnsCode === true, ...(flags.drainTimeoutMs === undefined ? {} : { drainTimeoutMs: flags.drainTimeoutMs }) }
   // perchComposeOptions(): ...(input.advertiseCode ? { advertiseCode: true } : {})
   ```
2. `apps/cli/src/program.ts`, `register('perch', …)` registration (around `:186-197`) — two flags:
   ```ts
   .option('--mdns-code', 'publish the join code in the mDNS TXT record (default: off)')
   .option('--drain-timeout <ms>', 'how long SIGTERM waits for the hub before aborting', parsePositiveInt)
   ```
3. `apps/cli/src/commands/perch.ts` — pass the option into `perchComposeInput(...)` (`advertiseCode: options.mdnsCode === true, drainTimeoutMs`) and replace `await perch.stop()` in `shutdown()` with:
   ```ts
   const timeoutMs = readNumber(options, 'drainTimeout', undefined);
   const report = await perch.drain(timeoutMs === undefined ? {} : { timeoutMs });
   context.write(
     palette.dim(`drained: ${report.finished.length} finished, ${report.aborted.length} aborted in ${report.waitedMs} ms`),
   );
   ```
   (`shutdown` is already called for SIGINT/SIGTERM; `drain()` also stops the daemon and closes the runner, so no second `stop()` is needed.)
4. Optional: print `${perch.handle.url}/perch/health` in the roosting banner, and mention `--mdns-code` in `starling perch`'s no-hub help text.
5. Nothing to add to `apps/server` or any registry: heartbeats already carry `maxSessions = activeSessions` while draining and the scheduler's `maxSessions - activeSessions` picks that up unchanged.

**FIX REQUESTS:**
- `docs/epic-31-perch.md` (cross-epic docs, orchestrator-owned): the HTTP table should gain the row `GET /perch/health → PerchHealth (200 ok / 503 degraded or draining; token required)`; step 4 of "The daemon" says "Advertises `_starling._tcp` with the join code and node name", which is now wrong (TXT is `{ node }` unless `advertiseCode`/`--mdns-code`); the body-parsing paragraph should note the 256 KiB `payload-too-large` limit, the hostile-ref/id validation (`invalid-body`/`invalid-params`) and the `PerchApp` methods `setDraining`/`isDraining`/`drainTasks` plus `PerchHandle.drain` and heartbeat jitter. Point it at `docs/epic-102-perch-hardening.md` for details.

**Deliberately deferred / out of scope:**
- CLI flags and SIGTERM→drain (`apps/cli`, Wave 3b) — exact C3 lines above; until then `drain()` is callable programmatically only.
- Hub-side body limits (Epic 110), hub registry/scheduling (Epic 101) and hub discovery reading TXT (never did read `txt.code`; unchanged).
- TLS / per-node credentials (L18) and a hub auth header scheme.
- Drain timeout as a `starling.config.yaml` key (root config is not this lane; C3 adds the flag).
- Health probes for opencode/LLM/Ollama reachability, health caching, Prometheus format.
- Quota-aware disk probing, Windows verification, and fuzzing/property tests for refs and bodies.

**Open questions / flagged tradeoffs:**
- **mDNS code default-off costs one-time typing.** Zero-config discovery still finds the perch (name/type/port) but a hub that wants to authenticate from the record needs `advertiseCode` (trusted-network demo). If the product prefers out-of-the-box zero-config, flipping the default is one line plus the secrets probe.
- **`sessions` semantics.** A perch at 5/5 reports green; if "no free slots" should be yellow on the dashboard, the check needs a distinct status rather than `ok: false` (which would also make the endpoint 503 and hide a healthy perch from a naive uptime probe).
- **Drain trusts the hub's `DELETE`.** A hub that never deletes leaves the perch waiting for the full timeout (30 s) — the abort path is the safety net, and the report makes it visible. There is no "force" flag.
- **A retried POST during drain returns the handle even if the hub has just deleted the worktree** — the 200 is for the in-memory handle; the subsequent `collect`/`DELETE` is idempotent, so the hub sees a clear error rather than a duplicate agent.
- **`runner` check is shallow** (`node.info()`), by design: a deeper probe would spawn or block, which is worse on stage than a slightly optimistic green.
