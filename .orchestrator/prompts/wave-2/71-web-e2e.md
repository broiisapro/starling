# Epic 71: Browser end-to-end tests (Playwright)

**Wave 2a · Branch `epic/71-web-e2e` · Issue: find it with `gh issue list --search "Epic 71 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`apps/web/e2e/**`, `apps/web/playwright.config.ts` (you may add `@playwright/test` to `apps/web/package.json` devDependencies, add-only).
plus `docs/epic-71-web-e2e.md` and `.orchestrator/handbacks/71-web-e2e.md`. Read anything.

## Goal
Lock in the demo's visual and behavioural guarantees with real-browser tests, because a broken dashboard on stage is the one failure we can't recover from.

## Deliverables
- Install Playwright's Chromium (`bunx playwright install chromium`; document it).
- Tests against `bun run dev` (or `vite preview` of a build) with `?demo=1` at **16×** speed:
  - the page loads with no console errors;
  - every region renders;
  - the replay reaches the end state (7 on the wire);
  - keyboard shortcuts (`1`/`2`/`b`/`f`/`?`) work;
  - clicking a bird opens the drawer for the right task, and Esc closes it;
  - the DAG view toggles;
  - the flock panel shows 2 roosts;
  - the metrics show cost;
  - reduced-motion emulation renders the calm Sky;
  - 1280×720 and 1920×1080 both have zero horizontal overflow.
- **Visual snapshots** (`toHaveScreenshot`) at both sizes at the end of the replay, with a sensible pixel tolerance (canvas animation is masked or paused via a test hook; if a hook is needed in the Sky, file a FIX REQUEST for Epic 47 and mask meanwhile).
- `bun run --cwd apps/web e2e` script. Excluded from the default `bun run test` (CI wiring is a FIX REQUEST for Epic 52).

## Explicitly out of scope
Fixing the UI bugs you find (FIX REQUESTS to 41/47/55), and CI wiring.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun run --cwd apps/web e2e` passes. Paste the summary. Snapshot images committed (≤ 300 KB each).
3. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
4. `bun run check` → clean.
5. `docs/epic-71-web-e2e.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/71-web-e2e.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/71-web-e2e`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
