# Epic 50: Skill end-to-end from inside opencode

> **Wave 3b update (read first).** This prompt was written for Wave 2b. It now runs in **Wave 3b**, after Epic 40's real composition merged, alongside about 100 Wave 3 agents. These overrides apply:
> - **Lanes:** **Your lane is narrowed to `skills/**`, `integrations/opencode/**` and `integrations/claude-code/**`**; Wave 3 epics are creating `integrations/{vscode,github-action,mcp,notify,shell}` in parallel. `packages/core` is owned by **Epic 202**, `packages/engine` by **Epic 100**, `packages/llm` by 200, `packages/runner` by 201, `apps/cli` by **Epic 203** (except the file(s) in your lane), and `apps/web/src/data` by 204. Everything else needed outside your lane is a FIX REQUEST.
> - **Heavy commands** go through the slot gate: `bash .orchestrator/bin/heavy.sh bun run test` / `bun run check`. Iterate with scoped `bun test <dir>`.
> - **Real Starling runs, one at a time machine-wide:** wrap every real run in the real-run gate, e.g. `ORCH_HEAVY_SLOTS=1 ORCH_LOCKS=$HOME/Code/starling-wt/_locks-realrun bash .orchestrator/bin/heavy.sh bun run starling run …`. Epics 46, 50, 54 and 207 share it. It may wait a while; rerun if your tool times out.
> - **No new dependencies**, no `bun.lock`/root config edits, public APIs additive only, and bugs outside your lane become `test.todo` + FIX REQUEST (never `test.failing`).
> - Your handback also needs **Carryover done**, **C3 wiring** and **FIX REQUESTS** sections. Check `.orchestrator/fix-requests-w2.md` for requests targeting your lane.
> - **The second laptop isn't available.** Use Epic 42's loopback perch on this Mac wherever the prompt says "both laptops", and say so in the handback.


**Wave 2b · Branch `epic/50-skill-e2e` · Issue: find it with `gh issue list --search "Epic 50 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`skills/**`, `integrations/**`.
plus `docs/epic-50-skill-e2e.md` and `.orchestrator/handbacks/50-skill-e2e.md`. Read anything.

## Goal
Prove the Agent Skill works the way a user would use it: inside an opencode session, the agent recognises a multi-part goal, uses the Starling skill to plan (dry run), shows lanes, and on confirmation runs the flock.

## Deliverables
- Install the skill and `/swarm` command into a fresh sky-todo demo repo (project scope).
- Run **one** opencode session (`opencode run --model "$STARLING_DEV_MODEL" --auto …` in that repo) with a natural user message such as "Add dark mode and CSV export and fix the date bugs, in parallel if you can". Capture the transcript to `skills/starling/examples/real-session.md` (trimmed) and check the agent picked the skill and called `plan.sh` with `--json`.
- Then `/swarm quick-wins goal` end to end (a real run via Epic 40's compose, opencode profile, quick-wins only). Record the outcome.
- Fix any skill/command friction found (paths, JSON parsing, exit codes, wording that didn't trigger the skill). Add tests for the fixes.

## Explicitly out of scope
CLI/engine changes (FIX REQUESTS). More than one real run.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. The real transcript is committed, and the `/swarm` quick-wins run summary pasted (or an honest failure analysis with FIX REQUESTS).
3. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
4. `bun run check` → clean.
5. `docs/epic-50-skill-e2e.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/50-skill-e2e.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/50-skill-e2e`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
