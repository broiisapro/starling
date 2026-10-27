# Epic 55: Web panels polish (DAG, drawer, queue, metrics, flock)

**Wave 2a · Branch `epic/55-web-panels-polish` · Issue: find it with `gh issue list --search "Epic 55 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
From the C1 web-wiring handback (Epic 34) and the screenshot review:
1. **Queue selection highlight**: `MergeQueueProps.selectedTask?` is being added to core (Epic 40). Highlight the selected card when present (optional, feature-detected).
2. **Flock panel**: on 720p the rail drops to compact mode and loses the task chips. Add a small **flock drawer/popover** opened from compact mode that shows the full roost cards. Also, the "Add a laptop · Flock mode is off for this run" card shows even when two nodes exist; it must show the join card whenever `join` is present, and a neutral "Join info unavailable" otherwise (never "off" while nodes > 1).
3. **Queue board**: column-level scrolling (no strip scroll-jump on click) and virtualisation for > 30 cards.
4. **Node names**: `TaskRun.nodeName?` is coming (Epic 40). Prefer it when present and fall back to the selector-mapped name.

## Your lane (you may write ONLY here)
`apps/web/src/features/{dag,agents,queue,metrics,flock}/**`.
plus `docs/epic-55-web-panels-polish.md` and `.orchestrator/handbacks/55-web-panels-polish.md`. Read anything.

## Goal
Bring every non-Sky panel up to **projector quality**. Judges will see these from the back of a room, so they need to be legible, calm, informative and never janky, with a cohesive visual language across DAG, drawer, queue, meter and flock.

## Deliverables
- A **legibility pass** at 1280×720 and 1920×1080: minimum 14 px body / 12 px meta text, contrast ≥ 4.5:1 on the dusk theme, tabular numerals for all counters, and truncation with tooltips instead of overflow.
- **DAG**: animated status transitions; the critical path highlighted (longest chain by estimate); a lane legend chip per node on hover; auto-fit when the plan changes; and a "follow the action" toggle that pans to running nodes.
- **Agent drawer**: a header with a live elapsed time and cost; an Activity tab with grouped tool calls ("ran tests ×3"), file-edit chips that link to the Diff tab, and a jump-to-latest; an Audit tab where DoD evidence (`AuditVerdict.dod`) renders as a checklist with evidence quotes; and a Diff tab with word-level highlights for small hunks.
- **Metrics**: a cost meter with an animated count-up, an off-peak vs peak note under the API number (from `PRICING` metadata if available), a "local calls" counter, and a "you saved" figure with a tooltip explaining the estimate.
- Items 1–4 from the carryover.
- Tests for every behaviour change (happy-dom), and updated Playgrounds.

## Explicitly out of scope
The Sky (Epic 47), data layer/layout (Epic 41), launch panel (Epic 53), stats page (Epic 68), and core types (FIX REQUEST to Epic 40).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `cd apps/web && bun test` → 0 fail. If Playwright is available, commit 3 screenshots ≤ 300 KB each to `apps/web/src/features/dag/__screens__/` (DAG, drawer Audit tab, queue+meter).
3. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
4. `bun run check` → clean.
5. `docs/epic-55-web-panels-polish.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/55-web-panels-polish.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/55-web-panels-polish`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
