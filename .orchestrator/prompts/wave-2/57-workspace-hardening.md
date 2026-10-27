# Epic 57: Workspace hardening at swarm scale

**Wave 2a · Branch `epic/57-workspace-hardening` · Issue: find it with `gh issue list --search "Epic 57 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`packages/workspace/**`, `tools/stress/**`.
plus `docs/epic-57-workspace-hardening.md` and `.orchestrator/handbacks/57-workspace-hardening.md`. Read anything.

## Goal
Starling's selling point is *lots* of agents. Make the git layer hold up at **50+ concurrent worktrees**, on big repos, across crashes, and leave nothing behind.

## Deliverables
- `tools/stress/worktrees.ts`: on a generated 5k-file repo, create **60 worktrees concurrently**, commit in each, compute diffs, predict conflicts pairwise for 20 pairs, create and fetch bundles for 10, then remove all. Report the p50/p95 per operation and the total; there must be zero failures. Run it and paste the results.
- Fix the bottlenecks you find (lock contention, `index.lock` retries, process spawn storms → a bounded exec pool, `git worktree prune` frequency).
- **Crash safety**: `recoverWorkspace(repo, worktreeRoot)` finds orphaned Starling worktrees and branches from dead runs (no live session, older than N hours), with `--dry-run`. Export it for a future `starling gc` command.
- **Edge cases**: repos with submodules (don't break; document limits), LFS pointers (diff must not explode), spaces/unicode in paths, a detached HEAD base, and a dirty main checkout (refuse to start the integration branch with a clear error). Each gets a test with a real temp repo.
- **Disk use**: report the per-worktree disk cost on the 5k repo, and document whether `git worktree add --no-checkout` + sparse checkout would help for lanes (prototype behind an option if it's a clear win).

## Explicitly out of scope
Merge logic (Epic 45 owns merger this wave), engine, and CLI command wiring (FIX REQUEST for `starling gc`).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. Paste the stress results (60 worktrees: all operations succeed, p95s).
3. `bun test packages/workspace` → 0 fail, including the new edge-case tests.
4. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
5. `bun run check` → clean.
6. `docs/epic-57-workspace-hardening.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/57-workspace-hardening.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/57-workspace-hardening`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
