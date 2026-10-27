# Epic 40: Integration captain: the real end-to-end run

**Wave 2a · Branch `epic/40-integration-captain` · Issue: find it with `gh issue list --search "Epic 40 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1 and checkpoint C1 are merged** (tags `epic-00-complete` … `epic-34-complete`). Every package is now a **real, tested implementation** (≈ 1,785 tests, all green):
- `@starling/core`: contracts, ports and handshake types, plus `@starling/core/browser` and `@starling/core/testing`.
- `@starling/llm`, `repomap`, `planner`, `prompts`, `workspace`, `runner` (opencode V2 REST client + `createOpencodeRunner`), `auditor`, `merger`, `github`, `store`, `engine` (`createEngine`), `flock` (`createLocalNode`, `createRemoteNode`, `createFlockHub`, registry, scheduler, mDNS), `perch` (`createPerchApp`, `startPerch`).
- `apps/server` (`createApp`, `startServer`), `apps/cli` (all commands; `compose()` currently only supports `mode: 'mock'`), `apps/web` (fully wired dashboard with demo mode), `skills/starling`, `tools/local-models`, `evals`.

**Read before you start:** `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions, §8 handshake, now living in core), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), and the handbacks in `.orchestrator/handbacks/` that mention your area.

**Wave 2 is about making it real.** Unlike Wave 1, you **may import sibling packages** (they're done). You still **write only inside your lane**: about 12 agents are working in parallel right now, several of them in neighbouring files.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L25**, plus these Wave 2 rules:
- **L26 (C1)**: the root `bun run test` runs `apps/web` in its own process (happy-dom owns the global fetch there). Pass explicit `fetch` implementations into clients in tests.
- **L27 (C1)**: Biome's Markdown formatter is off and Tailwind directives parse. `bun run check` must stay clean.
- **L28 (C1)**: core gained `StarlingErrorCode`s `LLM_BAD_JSON`, `GIT_TOO_OLD`, `GH_*`, `NOT_WIRED` and `NODE_AUTH`; `AuditCheck.durationMs?`; `AuditVerdict.dod?`; `NodeRegistry` event `reason?`; LLM call `opts?: { signal, timeoutMs }`; `Merger.preflight?`; `BundleOps` and mDNS ports; and every §8 handshake type in `packages/core/src/handshake.ts`. The old `handshake.ts` mirrors are now one-line re-exports.
- **L29 (Wave 2 LLM policy)**: real model calls are now allowed **only through the `opencode` LLM profile** (`STARLING_LLM_PROFILE=opencode`, which routes every role through Moksh's opencode server and its `opencode-go/deepseek-v4.1-flash` model). That means **no DeepSeek API key is needed**, and **no local models** (Ollama) unless your prompt explicitly grants it with the memory rails. Keep real calls small: use the sky-todo `quick-wins` goal (3 tasks) for end-to-end runs unless told otherwise, and **never run more than one real Starling run at a time from your session**.
- **L30 (Wave 2 lanes)**: `packages/core` is owned **only by Epic 40** (additive changes only). `packages/engine` is owned **only by Epic 49**. Everyone else who needs a change there writes a **FIX REQUEST** in their handback (exact file, change and reason) instead of editing.


## FIRST TASK: carryover
From the Wave 1/C1 handbacks:
1. **Core additions** (you own core this wave; all additive, all with tests):
   - `TaskRun.nodeName?: string`.
   - `MergeQueueProps.selectedTask?: string`.
   - `SkyViewProps.paused?: boolean`.
   - A new `StarlingEvent` **`run.status`** `{ from: RunStatus; to: RunStatus; run: Run }`. The engine will publish it (Epic 49 wires that), and the web reducer consumes it (Epic 41).
2. **CLI from Epic 27's requests**:
   - `starling run --budget <usd>` overrides `budget.maxUsd` for the run.
   - `starling plan --json` prints **only** the JSON (`{ plan, issues }`) to stdout, and everything else goes to stderr.
3. `doctor` already detects the opencode model; make `init` default to the **`opencode` LLM profile** when an `opencode-go/deepseek-v4.1-flash`-style model is listed (that's this machine).

## Your lane (you may write ONLY here)
`apps/cli/src/compose.ts`, `apps/cli/src/real/**` (except `real/perch-compose.ts`, which is Epic 42's), `apps/cli/src/commands/{run,plan,status,dash,options}.ts`, `apps/cli/src/render/**`, **`packages/core/**` (additive only; you are its sole owner this wave)**, `fixtures/real/**`. For a *blocking* bug in another package (one that stops the real run), you may make the **minimal** fix there and must list it in the handback. Non-blocking issues go in FIX REQUESTS.
plus `docs/epic-40-integration-captain.md` and `.orchestrator/handbacks/40-integration-captain.md`. Read anything.

## Goal
Make `starling run` real. Implement `compose(config, { mode: 'real' })`, which builds the genuine stack from every package, and drive a **real run on the sky-todo demo repo** that ends with merged, audited, test-green work on an integration branch. You're the integration captain: when something doesn't fit, you find out why and make the smallest correct fix.

## Deliverables
- `apps/cli/src/real/compose-real.ts` (called by `compose` for `mode: 'real'`). It wires:
  - config (`loadConfig`, profile from `STARLING_LLM_PROFILE` or config, default `opencode` on this machine), and the bus;
  - `createSqliteStore('<repo>/.starling/starling.db')` plus `attachRecorder`;
  - `createLLM`, `createRepoMapper({ llm })`, `createPlanner({ llm })`, `createPromptCompiler()`, `createWorkspace({ worktreeRoot })`;
  - `createOpencodeRunner({ mode: config.opencode.mode, … })`;
  - a flock hub with the hub's own `createLocalNode({ id: 'hub', … })` in a registry, plus `createScheduler()`;
  - `createAuditor({ llm })`, `createMerger(...)`, the tracker (`NoopTracker` unless `--github`, then `createGitHubTracker`), and `createEngine({...})` with `bundleUrlFor` pointing at the server's `/api/flock/bundle`.
  - It returns `{ engine, flock, store, bus, close() }`, where `close()` shuts down the opencode server, the store and timers. Use a disposal stack and run it on SIGINT too.
- `starling run "<goal>" --repo <path>`: real by default (`--mock` keeps the old behaviour for demos and tests). It starts the server (`startServer` from `apps/server`, serving `apps/web/dist` if built) unless `--no-dash`, prints the dashboard URL, renders the live view, and exits 0 on success with a summary (integration branch name, merged/failed, cost API/local).
- `starling plan` real (map + plan, `--json` purity), `starling status` reading the SQLite store, and `starling dash` serving the store's runs plus the live bus.
- **The real run** (L29, opencode profile, `maxParallel: 3`):
  1. `bash examples/scripts/make-demo-repo.sh /tmp/sky-e2e-1`
  2. `bun run starling run "$(cat examples/sky-todo/demo-goals/quick-wins.md)" --repo /tmp/sky-e2e-1 --no-dash --record fixtures/real/quick-wins.jsonl`
  3. Iterate until it finishes with every task merged and `bun test` green on the integration branch **inside the demo repo**.
  Then, **once**, the 7-task `launch-day.md` goal, recorded to `fixtures/real/launch-day.jsonl`. Paste both final summaries. Keep JSONL recordings under 5 MB each (truncate agent text if needed and document it).
- Fix integration bugs you hit (minimal, documented). Expected suspects: the session `directory` per worktree, runner ↔ node event demux, auditor `testCommand` for sky-todo (`bun test`), merge-queue worktree root, and bundle URLs for the hub-local node (should use `{kind:'local'}`).
- Tests: `compose-real.test.ts` builds the real composition against **fakes injected at the edges** (fake opencode server via the runner's test helpers, MockLLM) and runs a 2-task plan to completion. `*.live.test.ts` holds the real quick-wins run (gated by `STARLING_LIVE=1`; you run it once manually).

## Explicitly out of scope
Flock across two machines (Epic 42), GitHub mode end to end (Epic 43), the dashboard data layer (Epic 41), engine policies (Epic 49, to whom engine bugs go as FIX REQUESTS unless blocking), and the conflict resolver (Epic 45).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `fixtures/real/quick-wins.jsonl` exists and the run summary shows **all tasks merged, integration branch tests green**. Paste the summary plus `git -C /tmp/sky-e2e-1 log --oneline <integration-branch> | head`.
3. The launch-day real run was attempted once. Paste its summary (partial success is acceptable: document what failed and why).
4. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
5. `bun run check` → clean.
6. `docs/epic-40-integration-captain.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/40-integration-captain.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/40-integration-captain`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
