# Epic 101: Flock hardening: SEC-02/03/05, worktree handles, bundle GC, hub rehydration, registry eviction

**Wave 3 · Branch `epic/101-flock-hardening` · Issue: `gh issue list --search "Epic 101 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-101-flock-hardening.md` and `.orchestrator/handbacks/101-flock-hardening.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Probe coordination (L36):** flip only the probes listed in deliverable 8. If any other `tools/security` `test.failing` starts passing because of your change, flip that one too and name it in the handback.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **SEC-02** (69): hub-id impersonation in `register`/`heartbeat` (deliverable 1).
- **SEC-03** (69): bundle ref validation, and no repo path in errors (deliverable 2). The route half is Epic 110's.
- **SEC-05** (69), flock side: response size caps (deliverable 3). The server and perch halves are Epics 110 and 102.
- **49 #4:** `worktreePath` on `TaskHandle` (deliverable 4).
- **42 #3:** the registry sweep skips `kind: 'local'`. Already done, pin it with a test.
- **42 deferred:** bundle garbage collection (deliverable 5).

## Your lane (you may write ONLY here)
`packages/flock/**`
plus `docs/epic-101-flock-hardening.md` and `.orchestrator/handbacks/101-flock-hardening.md`. Read anything.

## Goal
Flock mode is the demo's "wow": a second laptop joins and birds fly across the room. Right now any token holder can impersonate the hub's own node, ask git for `--all` through a bundle ref, or stream an unbounded response into the hub. Close those holes, then make the hub survive real demo-day life: a hub restart that remembers its perches, bundle caches that don't fill the disk, and perches that left an hour ago disappearing from the roster. Great looks like: the security probes for this lane go green and are flipped, and the loopback e2e still passes.

## Deliverables
1. **SEC-02 hub identity** (`src/hub.ts` `register` at ~`:143`, `heartbeat` at ~`:184`). Export `RESERVED_NODE_IDS = ['hub'] as const`. `register` refuses a reserved id, and any id whose stored entry has `kind: 'local'`, with `new StarlingError('INVALID_ARGUMENT', 'node id "<id>" is reserved for the hub', { details: { reason: 'reserved-node-id' } })`. `heartbeat` throws `INVALID_ARGUMENT` for a stored `kind: 'local'` entry (the route turns it into a 400). **Also fix the hole the review missed:** an `info.status: 'offline'` heartbeat for `'hub'` currently `remove`s the hub from the registry. The hub's self-heartbeat (`apps/cli/src/real/hub-heartbeat.ts` on Epic 40's branch) calls `registry.touch` directly, so it is unaffected. Write 6+ tests.
2. **SEC-03 bundle refs.** Export `validateBundleRef(ref: string): string` (new `src/refs.ts`, re-exported). Accept `^[A-Za-z0-9._/-]{1,200}$` and 40-hex shas. Reject a leading `-`, any `..` segment, `@{`, `:`, whitespace, a trailing `/` or `.lock`, and `//`, by throwing `INVALID_ARGUMENT` with a message that never contains the repo path. Call it first in `bundle(ref)`, before any `git`. Make the `EXEC_FAILED` messages in `bundlePathFor` path-free (keep stderr and repo only in `details`). Table test of ≥ 12 hostile refs (`--all`, `-o/tmp/x`, `main..HEAD`, `a/../b`, `HEAD@{1}`, `main:secret`, ` main`, 201 chars, …) and the happy refs `main` and `starling/abc123/integration`.
3. **SEC-05, flock side** (`src/http.ts`). `requestJson` caps responses at `DEFAULT_MAX_JSON_BYTES = 4 MiB` (check `content-length`, then count streamed bytes). `requestBytes` streams with a `maxBytes` cap (new `RemoteNodeOptions.maxBundleBytes`, default 512 MiB). `subscribeSse` drops and warns on any single event over 1 MiB instead of buffering it. Throw `StarlingError('INVALID_ARGUMENT', 'perch response exceeded …')`. Tests use an in-process `Bun.serve` on port 0.
4. **Worktree on the handle** (49 #4). In `createLocalNode` (`src/local-node.ts` ~`:228`), put `worktreePath: worktree.path` on the returned handle as an additive property. Export `type LocalTaskHandle = TaskHandle & { worktreePath: string }`. `RemoteNode` never sets it, because the path lives on another machine. Tests.
5. **Bundle GC** (42 deferred). `pruneBundles(bundleDir: string, opts: { maxAgeMs?: number; maxBytes?: number; keep?: ReadonlySet<string>; clock?: Clock }): Promise<{ removed: string[]; freedBytes: number }>` removes `*.partial` older than 1 h, then the oldest `<sha>.bundle` files until under both limits, and never removes a bundle that is in flight. `createFlockHub` returns `FlockHub & { pruneBundles(opts?): Promise<…> }` (additive). Tests on a temp dir with injected mtimes.
6. **Hub restart rehydration.** `FlockRegistry.snapshot(): RegistrySnapshot` (`{ version: 1, nodes: [{ id, name, url, maxSessions, lastSeen }] }`, remote nodes only). `saveRegistrySnapshot(path, snap)` writes atomically (temp + rename) and `loadRegistrySnapshot(path)` returns `undefined` on missing or corrupt input. `createFlockHub({ …, rehydrate?: RegistrySnapshot })` recreates a `RemoteNode` per entry with `status: 'offline'`. The first heartbeat flips each one online (a `joined` event, already how `touch` treats a revived node) with no re-register round trip. Entries claiming `hub` or `kind: 'local'` are ignored. Tests.
7. **Registry eviction.** `RegistryOptions.evictAfterMs?: number` (default 10 min, `0` disables): `sweep()` removes remote nodes that have been `offline` longer than this, closes their `RemoteNode`, and emits **no second `left`** (they already left when they went offline). Local nodes are never swept or evicted. Pin the existing local-skip rule with a test. FakeClock tests.
8. **Probes.** In `tools/security/node-impersonation.test.ts`, flip `keeps the real hub node after such a registration` and `refuses a heartbeat that rewrites the hub stats`. In `tools/security/bundle-ref.test.ts`, flip both `test.failing` probes. Leave `refuses a registration that claims the reserved hub id` as `test.failing`: it expects **409**, which needs Epic 110's route mapping too. C3 flips it after both merge, so say so in the handback.
9. Keep `tools/flock/loopback.ts`'s e2e (`*.e2e.test.ts`) green. Write **at least 35 new tests**.

## Explicitly out of scope
- `apps/server/src/routes/flock.ts` (Epic 110 maps `reserved-node-id` → 409, an unknown heartbeat → 404, and bundle errors → generic messages).
- `packages/perch/**` (Epic 102, which also owns heartbeat jitter). The engine's dispatch reservations (Epic 100).
- TLS or per-node credentials (L18 stands). mDNS changes beyond what SEC-02/03 need.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test packages/flock` → 0 fail, ≥ 35 new tests.
3. `bunx tsc --noEmit -p packages/flock` clean.
4. `bun test tools/security/node-impersonation.test.ts tools/security/bundle-ref.test.ts` → 0 fail, with the four flipped probes now plain `test(`.
5. `bun test tools/flock` → 0 fail (the loopback e2e still works).
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-101-flock-hardening.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/101-flock-hardening.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/101-flock-hardening`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
