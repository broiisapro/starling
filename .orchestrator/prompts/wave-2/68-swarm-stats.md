# Epic 68: Built-by-the-flock stats page

**Wave 2a · Branch `epic/68-swarm-stats` · Issue: find it with `gh issue list --search "Epic 68 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`apps/web/src/features/about/**`, `tools/stats/**`.
plus `docs/epic-68-swarm-stats.md` and `.orchestrator/handbacks/68-swarm-stats.md`. Read anything.

## Goal
Turn this repo's own history into proof: a page (and JSON) showing how Starling was built by a flock of agents (epics, PRs, commits, lines, tests, waves, durations), pulled from git, GitHub and the orchestrator logs. It's the "one person and ~60 agents" slide, live.

## Deliverables
- `tools/stats/collect.ts` writes `tools/stats/out/stats.json`:
  - per epic: number, title, wave, PR number, merged-at, commits, +/− lines, files and tests added, duration (first commit → merge), and handback status;
  - per wave: agents, wall time, total tests after the wave;
  - totals: epics, PRs, commits, lines, tests, peak concurrent agents.
  Sources: `git log` (tags `epic-NN-complete`), `gh pr list --state merged --json …`, `.orchestrator/epics.tsv`, and the agent log timestamps in `../starling-wt/_logs` when present. Each one is optional and degrades gracefully.
- Document `site/data/stats.json` as the path Epic 59's landing page reads (`site/` is their lane, so file it as a FIX REQUEST).
- `export function AboutPage(props: { stats: SwarmStats })` in `features/about`: a timeline of waves as horizontal swim lanes (epics as bars from start to merge), big-number tiles (epics, agents, PRs, tests, hours), and the "lanes" story in 3 sentences. Hand-rolled SVG, theme tokens, accessible. Shell wiring (`?page=about` route) is a FIX REQUEST for Epic 41.
- Tests: the collector against a fixture git repo with tags and fake `gh` JSON; the page rendering with fixture stats.

## Explicitly out of scope
Shell routing (Epic 41). The landing site (Epic 59).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. Run `bun tools/stats/collect.ts` on this repo and paste the totals.
3. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
4. `bun run check` → clean.
5. `docs/epic-68-swarm-stats.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/68-swarm-stats.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/68-swarm-stats`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
