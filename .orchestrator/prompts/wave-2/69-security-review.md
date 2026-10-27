# Epic 69: Security & safety review

**Wave 2a · Branch `epic/69-security-review` · Issue: find it with `gh issue list --search "Epic 69 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`tools/security/**` (scripts and tests that *probe* the system). Findings go in your epic doc and as FIX REQUESTS. **You do not edit other packages.**
plus `docs/epic-69-security-review.md` and `.orchestrator/handbacks/69-security-review.md`. Read anything.

## Goal
Starling runs arbitrary agent-written code, exposes HTTP servers on the LAN, ships repos between machines and reads files on request. Do a focused security review **before** demo day, prove each finding with a probe, and hand precise fixes to the owning epics.

## Deliverables
- A threat model in your doc. Assets: the hub repo, the user's machine, tokens, the opencode server. Actors: a LAN peer, a malicious repo, a misbehaving agent. Entry points: server, perch, SSE, bundles, replay, opencode.
- **Probes** in `tools/security/` (each a bun test that spins up the real component on port 0 and attacks it):
  - flock token checks (missing, wrong, timing);
  - path traversal in `/api/flock/bundle?ref=` and `/api/replay` (`../`, absolute paths, symlinks);
  - bundle ref injection (`--upload-pack`-style args, refs with `..`);
  - SSE flooding/backpressure;
  - oversized bodies;
  - perch `POST /perch/tasks` with a hostile `branch`/`fromRef`;
  - CORS on the server;
  - secrets in logs and recorded JSONL (API keys, tokens);
  - `exec` argv-only (grep for shell-string usage across packages).
  A probe that **finds** an issue should be written as an *expected-failure* test (`test.failing`) so it turns green when the owner fixes it.
- A worktree escape check: can a worker agent's lane-violating write outside its worktree (e.g. `../../`) be detected by the auditor? Probe via the auditor's lane check with crafted paths.
- **FIX REQUESTS**: one per finding, with owner epic, severity, exact fix, and the probe that proves it.

## Explicitly out of scope
Fixing other lanes' code (FIX REQUESTS only). Network attacks beyond the local machine.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. A findings table (severity, component, probe, owner, fix) pasted in the handback. All probes run (passing, or `failing` as expected).
3. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
4. `bun run check` → clean.
5. `docs/epic-69-security-review.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/69-security-review.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/69-security-review`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
