# Epic 56: Repo map + worker prompts on real-world repos

**Wave 2a · Branch `epic/56-repomap-prompts` · Issue: find it with `gh issue list --search "Epic 56 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
From Wave 1: adopt `@starling/repomap`'s `renderRepoMap` inside `packages/prompts` (replacing its own minimal renderer), keeping the snapshot tests meaningful (update snapshots deliberately and explain the diff).

## Your lane (you may write ONLY here)
`packages/repomap/**` and `packages/prompts/**` **except** `packages/prompts/src/resolver*` (Epic 45).
plus `docs/epic-56-repomap-prompts.md` and `.orchestrator/handbacks/56-repomap-prompts.md`. Read anything.

## Goal
Starling must work on **real repos**, not just sky-todo. Stress the repo mapper and the worker prompts against real open-source projects of different shapes and languages, and fix what breaks: speed, noise, symbol quality, test-command detection, and prompt focus.

## Deliverables
- `packages/repomap/bench/real-repos.ts`: shallow-clones (`git clone --depth 1`) **6 public repos** into a temp dir: one each of a TS monorepo (pnpm or bun), a Python package (pytest), a Go service, a Rust crate, a Vite/React app and a ~5k-file repo. Pick well-known small-to-mid projects and list them with their commit SHAs. It maps each one and reports files, languages, symbols/file, detected test/lint commands (correct? verify by hand), tokens and time.
- Fix what's wrong: missed or incorrect test commands (workspaces, `pyproject` scripts, `Makefile`/`justfile`, `cargo` workspaces), noisy symbols, slow paths, generated/vendored dirs that should be skipped (`vendor/`, `third_party/`, `*.generated.*`, `__generated__`, `.next`, `target/`). Add a regression test per fix using a minimal synthetic repo that reproduces it.
- **Prompt focus**: for each real repo, render a worker prompt for a plausible task (hand-written TaskSpec with a lane) and check that the repo-map excerpt is focused on the lane and its neighbours. Tune `renderRepoMap({ focus })` ranking (lane files → importers/importees → siblings) and the prompt budget. Snapshot one prompt per repo shape.
- Keep `bun test packages/repomap packages/prompts` offline: the clone bench is a script, not a test.

## Explicitly out of scope
The planner (Epic 48), resolver prompt (Epic 45), any LLM calls.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. Paste the real-repos bench table before and after the fixes (time, files, test command correct ✓/✗).
3. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
4. `bun run check` → clean.
5. `docs/epic-56-repomap-prompts.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/56-repomap-prompts.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/56-repomap-prompts`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
