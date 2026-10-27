# Epic 41: Live dashboard: server ↔ web on real data

**Wave 2a · Branch `epic/41-live-dashboard` · Issue: find it with `gh issue list --search "Epic 41 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
From the C1 handbacks (Epics 23, 34):
1. **Adopt `@starling/core/browser`** in `src/data/demo.ts`, `src/data/sse.ts` and `src/lib/events.ts`. Then delete the `node:fs`/`node:path` aliases in `vite.config.ts` and `src/lib/browser-stubs.ts`. Confirm the bundle shrinks and paste the before and after sizes.
2. **`run.status` events**: core is gaining a `run.status` StarlingEvent (Epic 40). Handle it in the reducer *when present*, feature-detecting it so this compiles before and after 40 lands, so the run picker stops saying `mapping` all run.
3. **Flock join info**: the flock panel shows "Flock mode is off for this run" even with 2 nodes, because the data layer never supplies `join`. Fetch `/api/flock/join` in live mode, and synthesise a plausible `JoinInfo` in demo mode.
4. **Sky pause**: pass `paused: centreView !== 'sky'` into `SkyView` (optional spread until Epic 40 adds the prop).
5. **Selection in the queue**: pass `selectedTask` into `MergeQueue` (optional spread).

## Your lane (you may write ONLY here)
`apps/server/**` and `apps/web/src/{data,app,lib,components}/**` (not the feature folders, except the one-line prop pass-throughs listed below).
plus `docs/epic-41-live-dashboard.md` and `.orchestrator/handbacks/41-live-dashboard.md`. Read anything.

## Goal
Turn the dashboard from a fixture player into a **live control room**. Starling's server runs alongside a real engine and store; the web app connects over SSE, lists real runs, and shows everything as it happens, while demo mode keeps working as the fallback.

## Deliverables
- Server:
  - `startDashboard({ engine, store, bus, flock, webDist, port })` helper (Epic 40 calls it from the CLI).
  - The `POST /api/replay` path allow-list (only files under the repo's `fixtures/` and `.starling/`), closing E21's open question.
  - `GET /api/runs/:id/diff/:taskKey` returning the task's latest `DiffSummary` from stored events, or 404.
  - `GET /api/config/public` returning `{ version, profile, models (role → model id), flockEnabled }` for the UI header.
  - Graceful shutdown closes SSE streams.
- Web data layer:
  - Live mode by default when `/api/health` answers.
  - The run picker lists real runs from `/api/runs` and follows a newly started run automatically.
  - SSE resume via `since`, plus a connection badge.
  - Drawer diffs fetched lazily from the diff endpoint.
  - The header shows the model per role (from `/api/config/public`), e.g. "auditor: deepseek-v4.1-flash (opencode)".
  - The demo fallback stays one click away.
- An **end-to-end dev script** `apps/server/src/dev-live.ts`: it starts the server with an *in-process mock engine* (from core testing) that emits a realistic run, so the dashboard can be exercised live without any LLM. Document `bun run dev:live`.
- Tests: server route tests for the new endpoints; web data tests for live-mode switching, run following, `run.status` handling (with a synthetic event), lazy diff loading with a mocked fetch, and the join-info fallback.

## Explicitly out of scope
Engine/CLI composition (Epic 40). Visual polish of feature panels (Epic 47 for the Sky). The launch form (Epic 53).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `cd apps/web && bun run build` OK. Paste the bundle sizes before and after dropping the node stubs.
3. `bun run dev:live`, then `curl -N localhost:7777/api/events | head -5` shows live frames, and `curl localhost:7777/api/config/public` returns JSON (paste both).
4. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
5. `bun run check` → clean.
6. `docs/epic-41-live-dashboard.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/41-live-dashboard.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/41-live-dashboard`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
