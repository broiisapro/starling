# Epic 51: Fully-open mode (all roles local)

**Wave 2a · Branch `epic/51-fully-open` · Issue: find it with `gh issue list --search "Epic 51 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
- **L31 (memory rails for local models; this epic only)**: before loading any Ollama model, wait (poll every 60 s, up to 90 min) until **≤ 3 `opencode` processes** are running (`pgrep -fc opencode`) and free memory is ≥ 22 GB (`vm_stat` / `memory_pressure`). Unload with `keep_alive: 0` when done. If the quiet window never comes, finish everything else, mark the live part **deferred** in the handback, and stop. Never `ollama pull` a model > 20 GB.

## FIRST TASK: carryover
None for this lane beyond what's in the deliverables. (Stated explicitly so it's clear carryover was considered.)

## Your lane (you may write ONLY here)
`packages/llm/src/profiles*`, `packages/llm/src/env*`, `tools/fully-open/**`.
plus `docs/epic-51-fully-open.md` and `.orchestrator/handbacks/51-fully-open.md`. Read anything.

## Goal
Prove Starling runs with **zero cloud**: every role, including the coding workers, on local open-weight models through Ollama and opencode's Ollama provider. It's slower, but it's the strongest open-source story, and the demo can show a one-flag switch.

## Deliverables
- `local` profile finalised: planner/auditor/summarizer/writer → the recommended local model (read `tools/local-models/results/recommendation.json` if present, else `qwen3.8:27b-mlx`); workers → opencode with its **Ollama provider**. **Investigate** how the installed opencode version configures an Ollama/OpenAI-compatible local provider, and generate that config via `tools/fully-open/opencode-ollama.json` plus instructions. Don't edit the user's global config; use the project-level config or env.
- A `mixed` profile (the demo default): workers and planner on DeepSeek via opencode, auditor and summarizer local *if available*, else falling back to opencode with a warning (the same rule Epic 44 implements on the auditor side; agree on names via your doc).
- `tools/fully-open/smoke.sh` (L31 rails): with the quiet window, run **one** tiny task fully locally (a 1-task goal on a fresh sky-todo, e.g. "add a footer stat showing done/total") via `starling run --profile local` *if Epic 40's real run is on main*. Otherwise drive the opencode Ollama provider directly with a one-shot prompt and report tok/s.
- Tests for profile resolution and fallbacks (Ollama down, model missing, recommendation file missing).

## Explicitly out of scope
Perch-lent inference (deferred to Wave 3 stretch). The auditor's own model choice logic (Epic 44). Pulling models > 20 GB.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. Profile tests pass. The fully-local smoke either succeeded (paste the timing) or was deferred per L31 with the reason.
3. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
4. `bun run check` → clean.
5. `docs/epic-51-fully-open.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/51-fully-open.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/51-fully-open`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
