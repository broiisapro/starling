# Epic 47: Sky polish: roosts, migrations, sound

**Wave 2a · Branch `epic/47-sky-polish` · Issue: find it with `gh issue list --search "Epic 47 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1 and checkpoint C1 are merged** (tags `epic-00-complete` … `epic-34-complete`). Every package is now a **real, tested implementation** (≈ 1,785 tests, all green):
- `@starling/core`: contracts, ports and handshake types, plus `@starling/core/browser` and `@starling/core/testing`.
- `@starling/llm`, `repomap`, `planner`, `prompts`, `workspace`, `runner` (opencode V2 REST client + `createOpencodeRunner`), `auditor`, `merger`, `github`, `store`, `engine` (`createEngine`), `flock` (`createLocalNode`, `createRemoteNode`, `createFlockHub`, registry, scheduler, mDNS), `perch` (`createPerchApp`, `startPerch`).
- `apps/server` (`createApp`, `startServer`), `apps/cli` (all commands; `compose()` currently only supports `mode: 'mock'`), `apps/web` (fully wired dashboard with demo mode), `skills/starling`, `tools/local-models`, `evals`.

**Read before you start:** `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions, §8 handshake, now living in core), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), and the handbacks in `.orchestrator/handbacks/` that mention your area.

**Wave 2 is about making it real.** Unlike Wave 1, you **may import sibling packages** (they're done). You still **write only inside your lane**: about 12 agents are working in parallel right now, several of them in neighbouring files.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L25**, plus these Wave 2 rules:
- **L26 (C1)**: the root `bun run test` runs `apps/web` in its own process (happy-dom owns the global fetch there). Pass explicit `fetch` implementations into clients in tests.
- **L27 (C1)**: Biome's Markdown formatter is off and Tailwind directives parse. `bun run check` must stay clean.
- **L28 (C1)**: core gained `StarlingErrorCode`s `LLM_BAD_JSON`, `GIT_TOO_OLD`, `GH_*`, `NOT_WIRED` and `NODE_AUTH`; `AuditCheck.durationMs?`; `AuditVerdict.dod?`; `NodeRegistry` event `reason?`; LLM call `opts?: { signal, timeoutMs }`; `Merger.preflight?`; `BundleOps` and mDNS ports; and every §8 handshake type in `packages/core/src/handshake.ts`. The old `handshake.ts` mirrors are now one-line re-exports.
- **L29 (Wave 2 LLM policy)**: real model calls are now allowed **only through the `opencode` LLM profile** (`STARLING_LLM_PROFILE=opencode`, which routes every role through Moksh's opencode server and its `opencode-go/deepseek-v4.1-flash` model). That means **no DeepSeek API key is needed**, and **no local models** (Ollama) unless your prompt explicitly grants it with the memory rails. Keep real calls small: use the sky-todo `quick-wins` goal (3 tasks) for end-to-end runs unless told otherwise, and **never run more than one real Starling run at a time from your session**.
- **L30 (Wave 2 lanes)**: `packages/core` is owned **only by Epic 40** (additive changes only). `packages/engine` is owned **only by Epic 49**. Everyone else who needs a change there writes a **FIX REQUEST** in their handback (exact file, change and reason) instead of editing.


## FIRST TASK: carryover
From the C1 review of the dashboard screenshots: **roost labels are too small to read on a projector** ("MacBook Pro" at the bottom corners is a few px). The **bottom of the sky is empty for most of a run** once birds have left the roosts. And `SkyViewProps.paused` is coming (Epic 40): when `paused`, stop the rAF loop and resume seamlessly (optional prop, feature-detected).

## Your lane (you may write ONLY here)
`apps/web/src/features/sky/**`.
plus `docs/epic-47-sky-polish.md` and `.orchestrator/handbacks/47-sky-polish.md`. Read anything.

## Goal
Make the Sky the thing judges remember. Big readable roosts, a dramatic migration when a laptop joins, birds that visibly *work*, and an optional soundscape, all smooth on a projector at 1920×1080 and a 720p laptop.

## Deliverables
- **Roosts**: large, readable labels (≥ 18 px at 1080p) with the node name and a small `3/5` sessions gauge; a hub crown; a gentle glow when busy.
- **Join moment**: on `node.joined` the new roost *grows* from the horizon with a ripple and a toast-like caption "🪺 MacBook Air joined the flock". On `node.left` the roost dims and "has flown away" fades.
- **Migration**: a long arc with a trail, and the flock reforms at the new roost.
- **Work cues**: birds near a task's roost show tiny sparks on `file.edited` and a beat on `tool.call`. Audit circling is amber, and the fix loop is clearly agitated.
- **The wire**: merged flocks land in merge order with the task key under them; a brief celebratory shimmer on each landing; a final "all landed" murmuration sweep when the run finishes.
- **Sound** (off by default; toggle stored per viewer in localStorage with try/catch): WebAudio synthesised chirps on landing, a soft whoosh on migration, and a low hum scaled to active agents. No audio files.
- Keep 60 fps at 360 birds (measure in the Playground and paste the fps). Reduced motion stays calm and static.
- Tests: the sim/behaviour additions (join growth, landing order, sparks decay), the paused flag stopping the loop (fake rAF), and the sound toggle persistence (mock storage that throws).

## Explicitly out of scope
Data layer or layout (Epic 41). Other panels.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. Feature tests pass. Paste the Playground fps measurement and (if Playwright is available) commit 2 screenshots ≤ 300 KB: mid-run, and the join moment.
3. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
4. `bun run check` → clean.
5. `docs/epic-47-sky-polish.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/47-sky-polish.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/47-sky-polish`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
