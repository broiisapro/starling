# Epic 30: Flock core: nodes, registry, scheduler, discovery

**Wave 1 · Branch `epic/30-flock` · Issue: find it with `gh issue list --search "Epic 30 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees (on this laptop and on other laptops, "perches"), audits each result with tests, a lane check and a local model, and merges everything through a queue, all shown live in a murmuration dashboard.

**Wave 0 is merged** (tags `epic-00-complete`, `epic-01-complete`):
- `@starling/core`: every contract (zod-first), every port, the event bus, config, `exec`, globs (`matchesAny`, `globsOverlap`, `lanesDisjoint`), pricing/metrics, and **`@starling/core/testing`**, which has a mock for every port plus factories (`makePlan`, `makeRun`, `makeTaskSpec`, `makeNodeInfo`, `makeAgentEvent`, …). **Read `docs/epic-00-foundation.md` first.** Its "Interfaces for future epics" section lists every exported symbol.
- `fixtures/`: `repomaps/sky-todo.json`, `plans/sky-todo-launch-day.json`, `runs/sky-todo-launch-day.jsonl` (252 realistic events including flock events).
- `examples/sky-todo/`: the demo app Starling will operate on. `examples/scripts/make-demo-repo.sh` makes a fresh git repo of it.

**You are one of 23 agents building Wave 1 at the same time**, each in its own lane. Your siblings' packages are still placeholders while you work. **Never import a sibling Wave 1 package.** Depend only on `@starling/core` and its mocks. Where you meet a sibling, use the **handshake interfaces in ARCHITECTURE §8**, mirrored locally in `src/handshake.ts`, copied verbatim with the header comment the section specifies.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L25**. Especially:
- **L21**: Bun 1.4.4, TS 5.9.3, zod 4.6.7, Biome 2.6.3; never touch root config.
- **L22**: add deps only to your own package.json, pinned exact.
- **L23**: **NO local models, no real LLM calls, no real opencode prompts, no GitHub calls from tests, no `ollama` commands at all.** Use the core mocks and in-process `Bun.serve({ port: 0 })` fakes. You may write `*.live.test.ts` files but do not run them. This laptop runs 20+ agents at once, so keep memory use low: no long-running servers left behind, no huge test fixtures.
- **L13/L14**: git and gh go through `exec` from core, injectable so tests can fake it.

## FIRST TASK: carryover
None. This is a Wave 1 epic built directly on Wave 0. (Stated explicitly so it's clear carryover was considered.)

## Your lane (you may write ONLY here)
`packages/flock/**`
plus `docs/epic-30-flock.md` and `.orchestrator/handbacks/30-flock.md`. Read anything; write nothing else.

## Goal
Build the distributed heart of Starling: **ExecutionNodes**. `LocalNode` runs agents on this machine; `RemoteNode` runs them on another laptop through the Perch API. Around them sit the **NodeRegistry**, the capacity-aware **Scheduler**, the **FlockHub** (join codes, registration, heartbeats, offline detection, repo bundles) and **mDNS discovery**. This is what makes the demo moment ("open the Air's lid, and birds migrate to it") real.

## Deliverables
- `createLocalNode(opts: { id?: 'hub' | string; name: string; workspace: Workspace & Partial<BundleOps>; runner: AgentRunner; maxSessions: number; worktreeRoot: string; clock?: Clock; infoProvider?: () => Partial<NodeInfo> }): ExecutionNode`. `startTask` creates the worktree (local repo) or, for `{kind:'bundle'}`, downloads the bundle (`fetch` with `x-flock-token`), clones/fetches it into a cache repo under the worktree root and creates the worktree there; then `runner.start`. `collect` commits all and computes the diff; for bundle-sourced tasks it also writes a result bundle (`base..branch`). `cleanup` removes the worktree. Capacity tracking feeds `NodeInfo.activeSessions`, and events are re-emitted from the runner filtered to this node's sessions. `BundleOps` is a local type here (`createBundle`, `cloneFromBundle`, `fetchBundle`, matching Epic 14's names), injected, so tests use fakes.
- `createRemoteNode(opts: { url: string; token: string; info: NodeInfo; fetch?: typeof fetch; clock?: Clock }): ExecutionNode`: an HTTP client for the **Perch API** (ARCHITECTURE §6 table, exact paths). `onEvent` holds one SSE connection to `/perch/events` with reconnect. `collect(h, hubRepo, baseRef)` POSTs collect, then GETs the bundle and fetches it into `hubRepo` as `h.branch` (via injected `fetchBundle`), returning `TaskResult` with `bundlePath`. Every call has a timeout. Network errors map to `StarlingError('NODE_OFFLINE')`.
- `createRegistry(opts: { clock: Clock; offlineAfterMs: number }): NodeRegistry & { add(node: ExecutionNode, info: NodeInfo); remove(id, reason); touch(id, info) }`: emits `joined`/`left`/`stats`. A timer marks nodes `offline` after `offlineAfterMs` without a touch and emits `left` (reason `heartbeat-timeout`).
- `createScheduler(): Scheduler`: picks the online node with the most free slots (`maxSessions - activeSessions`), tie-breaking by lower `latencyMs`, then hub-first, then id. Returns undefined when there's no capacity. Pure.
- `createFlockHub(opts: { registry; hubUrl: string; code?: string; exec?; bundleDir: string; clock; mdns?: MdnsBrowser }): FlockHub` (mirror §8 in `src/handshake.ts`):
  - The join code is 8 chars, grouped `XXXX-XXXX`, from an unambiguous alphabet.
  - `verifyToken` uses constant-time compare.
  - `register` creates a RemoteNode and adds it.
  - `heartbeat` touches it (or re-registers on unknown id).
  - `bundle(ref)` runs `git bundle create` from the active repo into `bundleDir`, cached by ref sha.
  - mDNS: if given a browser, auto-registers discovered perches that answer `/perch/info` with the right code.
- `src/mdns.ts`: a `MdnsBrowser`/`MdnsAdvertiser` interface plus a `bonjour-service` implementation (`_starling._tcp`). Tests use a fake.
- Tests: the scheduler table (capacity, latency, tie-breaks, none available); the registry timeout with FakeClock; LocalNode with core `MockWorkspace`/`MockRunner` (+ fake bundle ops) through the full lifecycle; RemoteNode against a **fake perch** on `Bun.serve({ port: 0 })` implementing the §6 Perch API (start → SSE events → collect → bundle download → fetch called), a token-rejected case, perch death mid-task (server stops → `NODE_OFFLINE`, registry `left`); FlockHub register/heartbeat/verify/bundle with a real temp git repo for `bundle()`.

## Explicitly out of scope
The perch daemon/server side (Epic 31). Engine rescheduling logic (Epic 20). The web flock panel (Epic 32). Real multi-laptop testing (Wave 2, Epic 42).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test packages/flock` passes, ≥ 25 tests. No servers left running.
3. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
4. `bun run check` passes (Biome + typecheck for every workspace).
5. `docs/epic-30-flock.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/30-flock.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/30-flock`. Conventional Commits scoped to your lane (`feat(flock): …`, `test(flock): …`, `docs(epic-30): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
