# Epic 58: Demo targets: sky-todo polish + a Python target

**Wave 2a · Branch `epic/58-demo-targets` · Issue: find it with `gh issue list --search "Epic 58 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`examples/**`.
plus `docs/epic-58-demo-targets.md` and `.orchestrator/handbacks/58-demo-targets.md`. Read anything.

## Goal
Give Starling great things to operate on during the demo: make sky-todo's demo goals decompose crisply, and add a **second, non-JavaScript target** so we can show Starling is language-agnostic.

## Deliverables
- **Keep the contract stable**: the `examples/scripts/make-demo-repo.sh` CLI and the existing goal file names (`launch-day`, `launch-day-xl`, `quick-wins`, `conflict-bait`, `will-fail-audit`) must keep working. Other agents use them right now.
- sky-todo:
  - Review each goal against what a planner can infer from the code (make sure feature folders and slots clearly afford each task).
  - Add `demo-goals/stage.md`: a ~6-task goal tuned to finish in **≤ 8 minutes** with 6 agents and to produce one audit failure. Document the intended moments: which task should fail audit and why (e.g. it asks for tests explicitly in a way models often skip).
- `examples/py-ledger/`: a small, real Python 3.12 CLI app (a personal-finance ledger: add/list/report, CSV import, categories) with `pytest` tests, ruff config, `pyproject.toml`, ~600–900 lines, clear module boundaries for parallel features, and 2 seeded bugs (with an answer key in `.starling-answers/`, stripped by the demo script). Add `demo-goals/` with 3 goals plus `.expected.md` decompositions.
- Generalise `make-demo-repo.sh <example-name> [target-dir]` (default stays sky-todo), with a venv setup for py-ledger (`python3 -m venv .venv && pip install -e .[dev]`; skip gracefully if Python 3.12 is missing).
- Tests: both baselines green (`bun test`, `pytest`). The script works for both examples (run it, paste the output).

## Explicitly out of scope
Starling packages. Running real Starling runs (other epics do that).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bash examples/scripts/make-demo-repo.sh sky-todo /tmp/x1` and `… py-ledger /tmp/x2` both produce clean single-commit repos with green tests (paste the output).
3. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
4. `bun run check` → clean.
5. `docs/epic-58-demo-targets.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/58-demo-targets.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/58-demo-targets`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
