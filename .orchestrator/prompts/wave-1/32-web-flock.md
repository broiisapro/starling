# Epic 32: Web: flock panel

**Wave 1 · Branch `epic/32-web-flock` · Issue: find it with `gh issue list --search "Epic 32 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`apps/web/src/features/flock/**` (may add a dependency line to `apps/web/package.json`, add-only; a small QR library like `qrcode` is allowed, pinned exact).
plus `docs/epic-32-web-flock.md` and `.orchestrator/handbacks/32-web-flock.md`. Read anything; write nothing else.

## Goal
Build the **flock panel**: the dashboard's view of every machine in the swarm and the on-ramp for new ones. It should make "anyone in the room can lend their laptop" feel one scan away. Props-only per ARCHITECTURE §8.

## Deliverables
- `export function FlockPanel(props: FlockPanelProps)` from `features/flock/index.ts` (mirror §8 in `handshake.ts`):
  - **Roost cards**, one per node, hub first. Each shows: name, a hub/perch badge, a status dot (online/busy/offline with a pulse when busy), platform/arch/CPU cores/RAM, a **session meter** (`activeSessions / maxSessions` as segmented pips), local models as chips ("lends qwen3.8:27b"), latency, and the tasks currently on it (keys from `tasks` where `nodeId` matches, clickable chips).
  - Offline nodes are dimmed with "last seen 12s ago".
  - Cards animate in and out (respecting reduced motion).
  - A **Join card**: the join code in big monospace with a copy button, the full `command` with copy, and a **QR code** encoding the command (or the hub URL). Explainer copy: "Run this on any laptop with opencode + Starling installed to add it to the flock."
  - An empty state when only the hub exists: "Your flock is just you. Add a laptop →".
  - A compact mode (`compact?: boolean` prop, an addition beyond §8 that you document) for narrow regions: a single row of mini roosts.
- A local fallback status palette until C1. `Playground.tsx` driven from the fixture JSONL: show the Air joining mid-run and dropping, by deriving nodes from `node.*` events with a tiny local helper.
- Tests: card per node in hub-first order; the session meter; tasks-per-node chips; the offline styling; copy buttons (mock clipboard); the QR renders an `<svg>`/`<canvas>` for the command; the empty state; compact mode.

## Explicitly out of scope
Global store/wiring (Epic 23/C1). Registering nodes (backend). The Sky's roost visuals (Epic 24).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test apps/web/src/features/flock` passes, ≥ 12 tests.
3. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
4. `bun run check` passes (Biome + typecheck for every workspace).
5. `docs/epic-32-web-flock.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/32-web-flock.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/32-web-flock`. Conventional Commits scoped to your lane (`feat(flock-ui): …`, `test(flock-ui): …`, `docs(epic-32): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
