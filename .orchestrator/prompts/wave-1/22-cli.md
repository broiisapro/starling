# Epic 22: CLI

**Wave 1 · Branch `epic/22-cli` · Issue: find it with `gh issue list --search "Epic 22 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`apps/cli/**`
plus `docs/epic-22-cli.md` and `.orchestrator/handbacks/22-cli.md`. Read anything; write nothing else.

## Goal
Implement the `starling` CLI per the locked surface in ARCHITECTURE §6. It should feel delightful in a terminal (this is what judges see first). In Wave 1, build every command's UX, output rendering and a **composition root** against the §8 handshake interfaces and core mocks. Real wiring to the other packages happens in Wave 2 (Epic 40).

## Deliverables
- Commands per the §6 surface (commander + picocolors): `plan`, `run`, `replay`, `dash`, `perch`, `flock`, `status`, `doctor`, `init`. Help text with examples. `--json` where it makes sense (`plan`, `status`, `flock`).
- `src/compose.ts`: **the composition root**. `compose(config, { mode: 'mock' | 'real' })` returns `{ engine: EngineApi; flock?: FlockHub; store; bus }`. In Wave 1 only `mock` is implemented, built from core testing mocks so every command is runnable end to end with fake data. `real` throws `StarlingError('NOT_WIRED', 'wired in epic 40')`. Mirror §8 in `src/handshake.ts`.
- **Renderers** (pure, snapshot-tested) in `src/render/`:
  - `renderPlan(plan, issues)`: a table of tasks with deps and lanes, plus a lane-overlap matrix check mark.
  - `renderLive(state)`: a compact live view redrawn ≤ 4×/s. One line per task: status icon, key, node, attempts, elapsed, last agent action. Plus a footer with merged/failed counts and cost (API $ / local $0 / saved $).
  - `renderStatus(run)`.
  - `renderFlock(nodes, join)`.
  - Live redraw uses ANSI cursor movement and falls back to plain line output when `!process.stdout.isTTY`.
- `starling run` subscribes to the bus and drives `renderLive`, finishing with a summary box. `--no-dash` skips opening the browser, otherwise it prints the dashboard URL. `--record out.jsonl` appends every event to JSONL (use core schemas; no store dependency).
- `starling replay <file> [--speed]` reads JSONL (zod-validated) and renders it through `renderLive` with timing. **This is real in Wave 1**: it works today on `fixtures/runs/sky-todo-launch-day.jsonl`.
- `starling doctor` (**real**): checks bun, git ≥ 2.38, opencode on PATH and its version, an opencode model listing containing a DeepSeek V4.1 Flash id (any provider), gh auth, Ollama reachable (optional), config validity, and free RAM. Pretty ✔/✘/! output with fix hints; exit code 1 on ✘.
- `starling init` (**real**): writes `starling.config.yaml` from `defaultConfig`, with comments and the model profile auto-detected (opencode-go if present, else deepseek with `DEEPSEEK_API_KEY`, else local). Refuses to overwrite without `--force`.
- `starling perch` and `starling flock`: parse flags and render via the mock FlockHub in Wave 1.
- Tests: commander parsing for every command and flag; renderer snapshots (TTY and non-TTY); `replay` over the fixture at `--speed 1000` with output asserted; `doctor` with an injected exec fake (all ✔, and each ✘ case); `init` file content and the overwrite guard; `run` in mock mode reaching a summary.

## Explicitly out of scope
Real engine/flock/store wiring (Wave 2, Epic 40). The web dashboard. Packaging/publishing to npm (Wave 3).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test apps/cli` passes, ≥ 25 tests.
3. Paste the terminal output of `bun run starling replay fixtures/runs/sky-todo-launch-day.jsonl --speed 200` (final screen) and `bun run starling doctor` into your doc.
4. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
5. `bun run check` passes (Biome + typecheck for every workspace).
6. `docs/epic-22-cli.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/22-cli.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/22-cli`. Conventional Commits scoped to your lane (`feat(cli): …`, `test(cli): …`, `docs(epic-22): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
