# Epic 14: Workspace: worktrees, conflict prediction, bundles

**Wave 1 · Branch `epic/14-workspace` · Issue: find it with `gh issue list --search "Epic 14 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees (on this laptop and on other laptops, "perches"), audits each result with tests, a lane check and a local model, and merges everything through a queue, all shown live in a murmuration dashboard.

**Wave 0 is merged** (tags `epic-00-complete`, `epic-01-complete`):
- `@starling/core`: every contract (zod-first), every port, the event bus, config, `exec`, globs (`matchesAny`, `globsOverlap`, `lanesDisjoint`), pricing/metrics, and **`@starling/core/testing`**, which has a mock for every port plus factories (`makePlan`, `makeRun`, `makeTaskSpec`, `makeNodeInfo`, `makeAgentEvent`, …). **Read `docs/epic-00-foundation.md` first.** Its "Interfaces for future epics" section lists every exported symbol.
- `fixtures/`: `repomaps/sky-todo.json`, `plans/sky-todo-launch-day.json`, `runs/sky-todo-launch-day.jsonl` (252 realistic events including flock events).
- `examples/sky-todo/`: the demo app Starling will operate on. `examples/scripts/make-demo-repo.sh` makes a fresh git repo of it.

**You are one of 23 agents building Wave 1 at the same time**, each in its own lane. Your siblings' packages are still placeholders while you work. **Never import a sibling Wave 1 package.** Depend only on `@starling/core` and its mocks. Where you meet a sibling, use the **handshake interfaces in ARCHITECTURE §8**, mirrored locally in `src/handshake.ts`, copied verbatim with the header comment the section specifies.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L25**. Especially:
- **L21**: Bun 1.4.4, TS 5.9.3, zod 4.6.7, Biome 2.6.3; never touch root config.
- **L22**: add deps only to your own package.json, pinned exact.
- **L23**: **NO local models, no real LLM calls, no real opencode prompts, no GitHub calls from tests, no `ollama` commands at all.** Use the core mocks and in-process `Bun.serve({ port: 0 })` fakes. You may write `*.live.test.ts` files but do not run them. This laptop runs 20+ agents at once, so keep memory use low: no long-running servers left behind, no huge test fixtures.
- **L13/L14**: git and gh go through `exec` from core, injectable so tests can fake it.

## FIRST TASK: carryover
None. This is a Wave 1 epic built directly on Wave 0. (Stated explicitly so it's clear carryover was considered.)

## Your lane (you may write ONLY here)
`packages/workspace/**`
plus `docs/epic-14-workspace.md` and `.orchestrator/handbacks/14-workspace.md`. Read anything; write nothing else.

## Goal
Implement the `Workspace` port on the real `git` CLI. Up to ~20 agents work at once, each in its own worktree, so this has to be **correct under concurrency**. It also provides the git-bundle helpers Flock mode uses to ship repos between laptops.

## Deliverables
- `createWorkspace(opts: { worktreeRoot: string; exec?: typeof exec; clock?: Clock }): Workspace & BundleOps`, implementing every port method via core `exec` (argv arrays only, no shell strings):
  - `ensureIntegrationBranch(repo, base, name)`: idempotent.
  - `create(repo, branch, fromRef)`: `git worktree add -b`; reuse a matching existing worktree; path `<worktreeRoot>/<sanitised branch>`.
  - `diff(worktreePath, baseRef)`: `git diff --numstat` plus the patch of `base...HEAD` **and** uncommitted changes. Patch truncated at 200 KB with `truncated: true`.
  - `changedFiles(worktreePath, baseRef)`: committed, staged, unstaged and untracked (excluding ignored), deduped.
  - `predictConflicts(repo, ours, theirs)`: `git merge-tree --write-tree --name-only --no-messages`, parsing the conflicted paths (requires git ≥ 2.38; check the version once and throw `StarlingError('GIT_TOO_OLD')` otherwise).
  - `commitAll(worktreePath, message)`: returns the sha or undefined if clean. Uses a local identity fallback (`Starling Bot <starling@localhost>`) when none is configured, without touching global config.
  - `remove(worktreePath)`: `worktree remove --force` plus prune. Idempotent.
- **Concurrency safety**: a per-repo async mutex around operations that touch the shared `.git` (worktree add/remove/prune, branch create/delete, fetch, bundle import). Operations inside a single worktree run without the lock. Retry once on `index.lock` contention after a short backoff.
- `BundleOps` (extra exports, not in the port; Flock uses them): `createBundle(repo, ref, opts?: { base?: string; outPath?: string }): Promise<string>` (`git bundle create`; with `base`, only `base..ref`), `cloneFromBundle(bundlePath, dir, ref)`, `fetchBundle(repo, bundlePath, ref, intoBranch)` (`git fetch <bundle> ref:intoBranch`, forced update allowed).
- Tests against **real temporary git repos** (local only): create/reuse/remove, diff with committed and uncommitted changes, untracked detection, conflict prediction (clean vs conflicting), commitAll identity fallback, **20 concurrent `create` calls on one repo** all succeeding, and a bundle round trip: create bundle → clone elsewhere → commit there → bundle back with base → fetch into the original as a branch → diff matches.

## Explicitly out of scope
Merge-queue logic (Epic 17). Pushing to remotes or GitHub. Runner/opencode. Any shell-string exec.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test packages/workspace` passes, ≥ 20 tests, including the 20-way concurrency test and the bundle round trip. Total runtime < 30 s.
3. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
4. `bun run check` passes (Biome + typecheck for every workspace).
5. `docs/epic-14-workspace.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/14-workspace.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/14-workspace`. Conventional Commits scoped to your lane (`feat(workspace): …`, `test(workspace): …`, `docs(epic-14): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
