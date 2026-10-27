# Epic 31: Perch daemon

**Wave 1 · Branch `epic/31-perch` · Issue: find it with `gh issue list --search "Epic 31 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`packages/perch/**`
plus `docs/epic-31-perch.md` and `.orchestrator/handbacks/31-perch.md`. Read anything; write nothing else.

## Goal
Build the **perch**: what runs when someone types `starling perch` on another laptop. It exposes a local `ExecutionNode` over the Perch HTTP API, advertises itself on the LAN, registers with the hub using the join code, and keeps a heartbeat going, so the hub can schedule agents onto this machine.

## Deliverables
- `createPerchApp(deps: { node: ExecutionNode; token: string; info: () => Promise<NodeInfo>; bus?: EventBus }): Hono`, implementing **every route in the ARCHITECTURE §6 Perch API table exactly**:
  - `x-flock-token` checked in constant time (401 otherwise); zod-validated bodies; JSON errors.
  - `POST /perch/tasks` accepts `StartTaskOptions` with `repo.kind === 'bundle'` and returns the `TaskHandle`.
  - The bundle endpoint streams the result bundle produced by `node.collect` (find it via the `TaskResult.bundlePath` you cached at collect time).
  - `/perch/events` is SSE of the node's `AgentEvent`s with a keep-alive.
- `startPerch(opts: { node: ExecutionNode; hub?: string; code?: string; port?: number /* 7778 */; name?: string; maxSessions?: number; mdns?: MdnsAdvertiser; clock?: Clock; fetch?: typeof fetch }): Promise<{ url: string; nodeId?: string; stop(): Promise<void> }>`:
  - Binds `0.0.0.0` and determines its LAN URL (first non-internal IPv4; document the choice).
  - If `hub` is given: `POST {hub}/api/flock/register` with `x-flock-token: code` and `{ url, info }`, then heartbeat every `heartbeatMs` (3 s) to `/api/flock/heartbeat`. Back off and retry if the hub is unreachable, and re-register on a 404 unknown node.
  - Advertises `_starling._tcp` over mDNS when `mdns` is given (`MdnsAdvertiser` is a local interface whose shape matches Epic 30's names, mirrored in `src/handshake.ts`, with a `bonjour-service` implementation).
  - Graceful stop: deregister if possible, abort running sessions, stop the heartbeat.
- `perchInfo(opts)`: builds `NodeInfo` from the OS (hostname/`scutil --get ComputerName` on macOS, platform, arch, CPU cores, total memory GB, `maxSessions`, active sessions from the node, `localModels` from `ollama list` **only if** `lendModels` is on and Ollama answers on `/api/tags`, without loading anything).
- **Loopback proof**: a test that starts **two perches on one machine** (ports 0, separate cache dirs, each with a `MockNode` from core testing) plus a fake hub `Bun.serve`. Both register, heartbeat, accept a task, stream events, return collect results and bundles, and one is stopped → the hub stops receiving its heartbeats.
- Tests: every route's happy path plus auth and validation errors; SSE ordering; the register/heartbeat loop with FakeClock and a fake hub (including hub-down backoff and the re-register on 404); `perchInfo` with injected OS/exec fakes.

## Explicitly out of scope
`LocalNode`/`RemoteNode`/registry/scheduler (Epic 30). CLI flag parsing (Epic 22). Real two-laptop testing (Wave 2, Epic 42). TLS.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test packages/perch` passes, ≥ 20 tests, including the two-perch loopback test. No ports left open.
3. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
4. `bun run check` passes (Biome + typecheck for every workspace).
5. `docs/epic-31-perch.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/31-perch.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/31-perch`. Conventional Commits scoped to your lane (`feat(perch): …`, `test(perch): …`, `docs(epic-31): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
