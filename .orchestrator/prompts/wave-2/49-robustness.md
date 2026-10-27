# Epic 49: Robustness + engine ownership

**Wave 2a · Branch `epic/49-robustness` · Issue: find it with `gh issue list --search "Epic 49 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
1. **One opencode V2 client.** `packages/llm` and `packages/runner` each wrote their own V2 REST client (Wave 1). Make `packages/runner`'s the single client: export it, and have `packages/llm`'s `opencode` provider use it (keep `createOpencodeCompletionClient`'s public signature).
2. **Engine `run.status`**: publish the new `run.status` StarlingEvent (Epic 40 adds it to core) on every run status change, feature-detected until it lands, and fill `TaskRun.nodeName` from the registry when dispatching.
3. **Wire the conflict resolver** from Epic 45 once its PR is on main (its doc has an `engine-hook.md` section): `conflict → fixing (resolver) → merging`. If it isn't merged by the time you finish everything else, leave a clearly marked hook and note it.

## Your lane (you may write ONLY here)
**`packages/engine/**` (sole owner this wave)**, `packages/runner/**`, `packages/llm/src/providers/opencode*` (and tests).
plus `docs/epic-49-robustness.md` and `.orchestrator/handbacks/49-robustness.md`. Read anything.

## Goal
Starling must survive the real world on stage: agents that stall, providers that rate-limit, perches that vanish, budgets that run out, and a presenter who hits Ctrl-C. Make the engine and runner bulletproof, observable and politely self-healing.

## Deliverables
- **Stall detection** (`packages/engine/src/policies/stall.ts`): no agent event for `stallAfterMs` (config, default 4 min) → abort the session and resend the prompt once (counts as an attempt) → else `failed` with a reason.
- **Rate limits**: the runner detects provider 429/overload errors in opencode session errors and backs off with jitter (shared across sessions: a token bucket per provider). The engine **reduces effective parallelism** temporarily (AIMD) and logs it.
- **Budget**: hard cap from `budget.maxUsd` and `--budget`; a warning at 80%; the stop at 100% lets running tasks finish; the summary says what was skipped.
- **Kill switch**: `cancel` aborts every session, removes worktrees (keeping branches) and leaves the store consistent. A second Ctrl-C force-exits. Test the cleanup.
- **Perch loss**: the reschedule path keeps the task's **attempt count** and its **latest commit**, if a bundle was collected before the loss.
- **Observability**: a `log` event for every policy action, with a stable `code` so the UI can show it.
- Tests for each policy with FakeClock and mocks, plus the client unification tests (both providers green).

## Explicitly out of scope
The CLI composition (Epic 40), flock transport (Epic 42) and resolver internals (Epic 45).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test packages/engine packages/runner packages/llm` passes. Paste a summary of each policy test group.
3. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
4. `bun run check` → clean.
5. `docs/epic-49-robustness.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/49-robustness.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/49-robustness`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
