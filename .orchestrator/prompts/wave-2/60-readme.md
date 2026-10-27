# Epic 60: README, diagrams, CONTRIBUTING

**Wave 2a · Branch `epic/60-readme` · Issue: find it with `gh issue list --search "Epic 60 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`README.md`, `CONTRIBUTING.md`, `docs/assets/diagrams/**`.
plus `docs/epic-60-readme.md` and `.orchestrator/handbacks/60-readme.md`. Read anything.

## Goal
Write the README a judge (or a Hacktoberfest contributor) reads first: crisp pitch, demo GIF/screens, how it works, quickstart, the open-weight model story, flock mode, the Agent Skill, and the "built by a swarm" story. Plus a CONTRIBUTING that turns our lane methodology into an on-ramp.

## Deliverables
- `README.md`:
  - a logo line;
  - a one-sentence pitch;
  - badges (CI badge snippet from Epic 52's doc if present, MIT, Hacktoberfest);
  - a screenshot (use `docs/assets/c1-dashboard-1920.png`);
  - "Why" (the 4 problems from the PRD);
  - How it works (diagram);
  - Quickstart (`bun`, `opencode` login, `starling init`, `starling run`, `starling dash`);
  - Model routing table (roles → models, local vs API);
  - Flock mode (`starling perch`);
  - Agent Skill install;
  - Demo/replay (`starling replay`);
  - Architecture (packages table with one line each);
  - "Built by the flock" (how this repo was built: waves, lanes, ~60 epics, PR counts as placeholders Epic 68 fills);
  - Roadmap, License.
  Keep it scannable.
- `docs/assets/diagrams/`: **3 hand-authored SVGs** (readable in light and dark GitHub themes: transparent background, mid-contrast strokes):
  1. pipeline (goal → map → plan/lanes → flock → audit → merge queue → integration branch);
  2. flock topology (hub + perches, bundles, SSE);
  3. model routing (roles → DeepSeek via opencode vs local Ollama).
- `CONTRIBUTING.md`: setup, how lanes work, how to pick a good-first-issue, the handback format, Conventional Commits, running tests (`bun run test`, the web split), and the AGENTS.md rules for AI contributors.
- Verify every command in the README actually works against current `main` (where something is still being built in Wave 2, mark it "coming in v0.1" rather than inventing behaviour).

## Explicitly out of scope
The landing site (Epic 59). Release notes and CHANGELOG (later). Code changes.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. Every README command you could run is pasted with its output (or marked as pending with the epic that delivers it).
3. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
4. `bun run check` → clean.
5. `docs/epic-60-readme.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/60-readme.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/60-readme`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
