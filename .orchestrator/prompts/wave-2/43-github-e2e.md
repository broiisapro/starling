# Epic 43: GitHub mode end-to-end (sandbox repo)

**Wave 2a · Branch `epic/43-github-e2e` · Issue: find it with `gh issue list --search "Epic 43 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`packages/github/**`, `tools/github-sandbox/**`.
plus `docs/epic-43-github-e2e.md` and `.orchestrator/handbacks/43-github-e2e.md`. Read anything.

## Goal
Prove GitHub mode against a **real repo**: a run's plan becomes issues, each audited task branch gets a PR with its verdict table, merges close issues, and the integration branch gets a final PR, all idempotent and safe to re-run.

## Deliverables
- `tools/github-sandbox/setup.sh`: creates (or reuses) a **private** repo `<you>/starling-sandbox` via `gh repo create --private`, pushes a fresh sky-todo demo repo into it (`examples/scripts/make-demo-repo.sh`) and prints its URL. Idempotent. `teardown.sh` closes all `starling` issues and PRs and deletes `starling/*` branches, but **never deletes the repo**.
- A **tracker E2E script** `tools/github-sandbox/e2e.ts`, which drives the tracker directly, without an engine and without an LLM, using a hand-built `Run`/`Plan` (fixtures plan) and real branches:
  1. `syncPlan` creates 7 issues; re-running creates 0.
  2. For 2 tasks, create a branch with a tiny real commit, `openTaskPR` (PR into the integration branch with the verdict table), then `onMerged` (comment and close).
  3. `openFinalPR` opens the final PR to `main`.
  Print the URLs. Then run teardown.
- Fix whatever real `gh` behaviour breaks: JSON field names, the label-creation race, `--body-file` with long bodies, repo auto-detection from a worktree, rate limits (retry with backoff on secondary rate limits). Each fix gets a unit test with the fake exec that captures the real `gh` behaviour you saw.
- **Renderer polish** for judges reading PRs: the PR body shows a ✅/❌ verdict table, DoD checklist (from `AuditVerdict.dod` when present), cost (API vs local), the node that ran it, and a 🐦 footer linking the run.

## Explicitly out of scope
Engine integration of `--github` (Epic 40 wires the flag). CI (Epic 52). Deleting repos.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bash tools/github-sandbox/setup.sh` then `bun tools/github-sandbox/e2e.ts` succeed. Paste the issue/PR URLs. The second sync reports 0 created. Teardown runs clean.
3. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
4. `bun run check` → clean.
5. `docs/epic-43-github-e2e.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/43-github-e2e.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/43-github-e2e`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
