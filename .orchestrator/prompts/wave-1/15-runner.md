# Epic 15: opencode runner

**Wave 1 · Branch `epic/15-runner` · Issue: find it with `gh issue list --search "Epic 15 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
**Important environment fact (L25):** the opencode installed here is a **newer CLI** than most docs describe. It runs a background service; `serve` is the "v2 API and web server"; there are `--standalone` and `--server` flags; the TUI has no `--model` flag; and LLM access goes through the **OpenCode Go** provider (`opencode-go/deepseek-v4.1-flash`). Before designing anything:
1. Record `opencode --version`, `opencode serve --help` and `opencode --help`.
2. Start `opencode serve --port <free port>` (add `--standalone` if needed, so it doesn't touch the shared background service), fetch its OpenAPI document (try `/doc`, and look for the v2 equivalent if that 404s), save it to `packages/runner/test/fixtures/openapi.json`, and stop the server. **Never send a prompt** (L23).
3. Check whether the pre-installed `@opencode-ai/sdk` matches that API. If it doesn't (the SDK targets v1), write a thin typed client against the real endpoints yourself, and document the decision.

## Your lane (you may write ONLY here)
`packages/runner/**`
plus `docs/epic-15-runner.md` and `.orchestrator/handbacks/15-runner.md`. Read anything; write nothing else.

## Goal
Implement `AgentRunner` on top of opencode's server API: start one opencode server, open one session per task in that task's worktree, send prompts, and turn opencode's event stream into Starling's normalised `AgentEvent`s (text, tool calls, file edits, usage, idle, error). Also provide `ReplayRunner` so demos and tests can run without any model.

## Deliverables
- `createOpencodeRunner(opts: { mode: 'spawn' | 'attach'; url?: string; port?: number; password?: string; standalone?: boolean; bus?: EventBus; clock?: Clock; spawn?: typeof Bun.spawn; fetch?: typeof fetch }): AgentRunner & { url(): string; health(): Promise<boolean> }`.
  - `spawn`: start `opencode serve` on a free port, wait for health, and kill it on `close()` (also on process exit).
  - `attach`: use an existing server.
- `start({ runId, taskKey, dir, prompt, model, title })`: create a session scoped to `dir` (per-request directory header or the v2 equivalent), send the prompt asynchronously with `providerID/modelID` split from `model`, return `sessionId`. `send(sessionId, prompt)` continues the same session; `abort(sessionId)` aborts.
- **Event normalisation**: one SSE subscription per server, demultiplexed by session id → `AgentEvent` with the runId/taskKey you were given:
  - `session.started`
  - `text` (debounced: merge deltas, emit at most every 500 ms per session, with `{ text }`)
  - `tool.call` and `tool.result` (`{ tool, args/summary, ok }`)
  - `file.edited` (`{ path }`)
  - `usage` (`{ input, output, cached, costUsd? }`)
  - `session.idle` (the agent finished its turn)
  - `session.error`
  Reconnect the SSE stream with backoff and resync via a session status poll after reconnect.
- **Concurrency**: many sessions on one server; a semaphore option `maxConcurrentPrompts`.
- `createReplayRunner({ events: AgentEvent[] | path, clock?, speed? })`: implements `AgentRunner` by replaying events (with original relative timing scaled by `speed`) for whatever session `start` creates, remapping runId/taskKey. Used by demos and tests.
- Tests: a **fake opencode server** on `Bun.serve({ port: 0 })` that implements the endpoints you actually use, with shapes taken from your saved OpenAPI fixture (create session, prompt async, abort, SSE stream). Cover start → events → idle, two sessions interleaved and demuxed correctly, abort, SSE drop and reconnect, error event, debounce of text, plus ReplayRunner timing with FakeClock. Also a `runner.live.test.ts` that spawns the real server and runs one tiny prompt, gated by `STARLING_LIVE=1`; **don't run it**.

## Explicitly out of scope
Choosing which node runs a task (Flock, Epic 30). Prompt content (Epic 13). Auditing. Any real LLM prompt during this epic.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test packages/runner` passes, ≥ 20 tests. No opencode process left running afterwards (`pgrep -f 'opencode serve'` shows none started by you).
3. Your doc's "Interfaces" section includes the **exact endpoint table** of the installed opencode server you integrated against, plus a note on SDK-vs-handwritten client.
4. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
5. `bun run check` passes (Biome + typecheck for every workspace).
6. `docs/epic-15-runner.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/15-runner.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/15-runner`. Conventional Commits scoped to your lane (`feat(runner): …`, `test(runner): …`, `docs(epic-15): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
