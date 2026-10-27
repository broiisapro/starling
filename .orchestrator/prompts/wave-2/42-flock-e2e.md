# Epic 42: Flock end-to-end: two perches, then two laptops

**Wave 2a · Branch `epic/42-flock-e2e` · Issue: find it with `gh issue list --search "Epic 42 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
From the Wave 1 handbacks (Epics 30, 31):
1. **Heartbeat carries the perch URL**, so the hub can re-register an unknown id; the hub answers 404 for unknown ids and the perch re-registers.
2. **Graceful leave** (no new server route; `apps/server` is Epic 41's lane): a graceful perch stop sends a final heartbeat with `status: 'offline'`, and the hub must treat that as an **immediate leave** (reason `perch-stopped`). Implement the hub side in `packages/flock`.
3. **SSE resilience**: `/perch/events` supports `Last-Event-ID` replay from a ring buffer of the last 500 events. `RemoteNode` resends it on reconnect, so a dropped stream can't lose `session.idle`.
4. Unify the `MdnsAdvertiser`/`MdnsBrowser` usage on the core port types (C1 moved them).

## Your lane (you may write ONLY here)
`packages/flock/**`, `packages/perch/**`, `apps/cli/src/commands/{perch,flock}.ts`, `apps/cli/src/real/perch-compose.ts`, `tools/flock/**`.
plus `docs/epic-42-flock-e2e.md` and `.orchestrator/handbacks/42-flock-e2e.md`. Read anything.

## Goal
Prove **Flock mode** for real. A second machine (or a second perch on this one) joins the hub, gets tasks scheduled onto it, runs them through its own opencode, and ships the results back as git bundles, and the hub audits and merges them. Then make it a 60-second experience for the two-laptop demo.

## Deliverables
- `apps/cli/src/real/perch-compose.ts`: builds a real perch (workspace in `~/.starling/perch/<name>`, an opencode runner in spawn mode, `createLocalNode`, `startPerch` with the hub URL and code). `starling perch --hub http://<ip>:7777 --code XXXX-XXXX [--max-sessions 5] [--name]` runs it until Ctrl-C, printing a friendly status line ("🪺 roosting on MacBook Pro · 2/5 sessions").
- `starling flock` lists nodes from the hub's `/api/nodes` and prints the join command (copy-pastable), printing the command only (a terminal QR code would need a CLI dependency, which is Epic 40's lane, so file it as a FIX REQUEST).
- **Loopback E2E** (`tools/flock/loopback.ts`): starts a hub composition **with the mock engine path replaced by real flock pieces**, meaning two real perches on ports 7781/7782 with separate cache dirs, real git bundles and the **ReplayRunner** (no LLM), and drives three tasks through `RemoteNode.startTask → events → collect → bundle → fetch into hub repo`. Then kill one perch mid-task and show the registry `left` and rescheduling. Make it a test (`*.e2e.test.ts`, runs in < 60 s, no LLM) and a script with readable output.
- **Real flock smoke (L29: opencode profile, quick-wins only, once)**: hub plus one perch on this same Mac (separate port and cache dir), with `maxSessions` 1 on the hub, so at least one task must run on the perch. Record it to `fixtures/real/flock-loopback.jsonl`. This needs Epic 40's real compose; **if it isn't on main when you get here, finish everything else and mark this step deferred** (don't build your own composition).
- Put the **two-laptop runbook** in your epic doc (not a separate file). Moksh runs it later, so make it plain steps per laptop: install, auth, `starling perch --hub … --code …`, what success looks like, and 6 troubleshooting checks (firewall prompt, same wifi, mDNS blocked → use `--hub`, hotspot fallback, clock skew, port in use).

## Explicitly out of scope
Web flock panel changes (Epic 41/47). Engine rescheduling logic itself (Epic 49; report engine bugs as FIX REQUESTS). LLM lending (Epic 51).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. The loopback E2E test passes. Paste its output, including the migration after the perch kill.
3. The real flock smoke either passes (paste a summary showing ≥ 1 task with `nodeId` ≠ `hub` merged) or is explicitly deferred with the reason.
4. `bun run test` at the repo root → 0 fail (paste both halves' summary lines).
5. `bun run check` → clean.
6. `docs/epic-42-flock-e2e.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/42-flock-e2e.md` written. Include a **FIX REQUESTS** section (or "none") listing changes you needed in lanes you don't own. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/42-flock-e2e`. Conventional Commits scoped to your lane, committed small and often (at least 6 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
