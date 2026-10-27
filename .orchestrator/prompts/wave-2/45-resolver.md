# Epic 45: Conflict-resolver loop

**Wave 2a · Branch `epic/45-resolver` · Issue: find it with `gh issue list --search "Epic 45 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1 and checkpoint C1 are merged** (tags `epic-00-complete` … `epic-34-complete`). Every package is now a **real, tested implementation** (≈ 1,785 tests, all green):
- `@starling/core`: contracts, ports and handshake types, plus `@starling/core/browser` and `@starling/core/testing`.
- `@starling/llm`, `repomap`, `planner`, `prompts`, `workspace`, `runner` (opencode V2 REST client + `createOpencodeRunner`), `auditor`, `merger`, `github`, `store`, `engine` (`createEngine`), `flock` (`createLocalNode`, `createRemoteNode`, `createFlockHub`, registry, scheduler, mDNS), `perch` (`createPerchApp`, `startPerch`).
- `apps/server` (`createApp`, `startServer`), `apps/cli` (all commands; `compose()` currently only supports `mode: 'mock'`), `apps/web` (fully wired dashboard with demo mode), `skills/starling`, `tools/local-models`, `evals`.

**Read before you start:** `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions, §8 handshake, now living in core), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), and the handbacks in `.orchestrator/handbacks/` that mention your area.

**Wave 2 is about making it real.** Unlike Wave 1, you **may import sibling packages** (they're done). You still **write only inside your lane**: about 23 agents are working in parallel right now, all on this one machine, several of them in neighbouring files.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L25**, plus these Wave 2 rules:
- **L26 (C1)**: the root `bun run test` runs `apps/web` in its own process (happy-dom owns the global fetch there). Pass explicit `fetch` implementations into clients in tests.
- **L27 (C1)**: Biome's Markdown formatter is off and Tailwind directives parse. `bun run check` must stay clean.
- **L28 (C1)**: core gained `StarlingErrorCode`s `LLM_BAD_JSON`, `GIT_TOO_OLD`, `GH_*`, `NOT_WIRED` and `NODE_AUTH`; `AuditCheck.durationMs?`; `AuditVerdict.dod?`; `NodeRegistry` event `reason?`; LLM call `opts?: { signal, timeoutMs }`; `Merger.preflight?`; `BundleOps` and mDNS ports; and every §8 handshake type in `packages/core/src/handshake.ts`. The old `handshake.ts` mirrors are now one-line re-exports.
- **L29 (Wave 2 LLM policy)**: real model calls are now allowed **only through the `opencode` LLM profile** (`STARLING_LLM_PROFILE=opencode`, which routes every role through Moksh's opencode server and its `opencode-go/deepseek-v4.1-flash` model). That means **no DeepSeek API key is needed**, and **no local models** (Ollama) unless your prompt explicitly grants it with the memory rails. Keep real calls small: use the sky-todo `quick-wins` goal (3 tasks) for end-to-end runs unless told otherwise, and **never run more than one real Starling run at a time from your session**.
- **L30 (Wave 2 lanes)**: `packages/core` is owned **only by Epic 40** (additive changes only). `packages/engine` is owned **only by Epic 49**. Everyone else who needs a change there writes a **FIX REQUEST** in their handback (exact file, change and reason) instead of editing.


## FIRST TASK: carryover
None for this lane beyond what's in the deliverables. (Stated explicitly so it's clear carryover was considered.)

## Your lane (you may write ONLY here)
`packages/merger/**`, `packages/prompts/src/resolver*` (and its tests/snapshots).
plus `docs/epic-45-resolver.md` and `.orchestrator/handbacks/45-resolver.md`. Read anything.

## Goal
When two branches collide anyway (it happens when a plan's lanes were imperfect), Starling shouldn't just give up. It should spin up a **resolver agent** that merges both intents, prove the result with tests, and land it. Build that capability as a self-contained service the engine calls (Epic 49 wires the call).

## Deliverables
- `createConflictResolver({ node: ExecutionNode, prompts: PromptCompiler, workspace, merger, clock })` → `resolve(ctx: { run, integrationBranch, taskA: TaskRun, taskB?: TaskRun, conflict: MergeResult, testCommand }): Promise<MergeResult>`:
  - Creates a branch `starling/<run>/resolve-<key>` from the integration branch.
  - Merges the conflicting task branch with the conflict **left in place** (commit the markers on that branch), then starts a resolver session with `prompts.resolver(...)`.
  - When the session goes idle, verifies there are no conflict markers (`git grep -n '^<<<<<<< '`), runs the tests, then `merger.merge`.
  - Bounded: 2 attempts, then `failed`.
- Resolver prompt polish in `packages/prompts/src/resolver*`: include both tasks' DoD, the conflict hunks (trimmed), "keep both behaviours and both sets of tests", and the handback.
- Tests with **real temp git repos** and a **scripted fake node** (one whose "agent" resolves the conflict by writing a scripted file content): resolved → merged; still-conflicted → retry → failed; tests fail after resolution → failed with detail.
- **Demo proof (no LLM)**: run the sky-todo `conflict-bait` goal's two tasks as hand-made branches (scripted edits to `src/ui/render.ts`), show preflight predicting the conflict, the resolver (scripted) fixing it, and the merge landing. Make it `tools`-free and a test.
- An `engine-hook.md` section in your doc giving Epic 49 the exact call site and the state transitions (`conflict → resolving(fixing) → merging → merged|failed`). Also file it as a FIX REQUEST for the engine.

## Explicitly out of scope
Editing `packages/engine` (Epic 49 owns it). Real LLM resolver runs (they come with the C2 integration).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. Resolver tests pass, including the conflict-bait proof test (paste its output).
3. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
4. `bun run check` → clean.
5. `docs/epic-45-resolver.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/45-resolver.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/45-resolver`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
