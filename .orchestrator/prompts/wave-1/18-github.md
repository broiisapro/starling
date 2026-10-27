# Epic 18: GitHub tracker

**Wave 1 · Branch `epic/18-github` · Issue: find it with `gh issue list --search "Epic 18 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`packages/github/**`
plus `docs/epic-18-github.md` and `.orchestrator/handbacks/18-github.md`. Read anything; write nothing else.

## Goal
Implement `Tracker` for GitHub via the `gh` CLI. In GitHub mode a Starling run mirrors itself onto the repo: one issue per task, a PR per task branch carrying the audit verdict, and a final PR from the integration branch. That makes a swarm's work reviewable by humans the normal way.

## Deliverables
- `createGitHubTracker(opts: { repo?: string /* owner/name; auto-detect via gh repo view */; cwd: string; exec?: typeof exec; dryRun?: boolean; labelPrefix?: string /* 'starling' */ }): Tracker & { dryRunLog(): string[] }`.
- `syncPlan(run)`: ensures labels `starling`, `starling:run-<short>` and `starling:task`; creates one issue per task (`[starling] <title>`) whose body has the goal, deliverables, DoD checklist and lane; idempotent via a hidden marker `<!-- starling:run=<id> task=<key> -->` (search existing issues before creating). Returns `taskKey → issue number`.
- `openTaskPR(run, task, body)`: `git push -u origin <branch>` (via exec in the worktree), then `gh pr create --base <integration branch> --head <branch> --title "[starling] <title>" --body-file <tmp>` with `Closes #<issue>`. Returns the URL.
- `onMerged(run, task)`: comments the verdict summary on the issue and closes it with a reason.
- `openFinalPR(run, body)`: pushes the integration branch and opens a PR to `run.goal.baseBranch`.
- Pure renderers in `src/render.ts`: `renderTaskIssue(task, run)`, `renderTaskPRBody(task, run)` (verdict table: check → ✅/❌ → detail; usage and cost; agent handback summary if present) and `renderFinalPRBody(run)` (task table, totals, cost split API vs local). Snapshot-test them.
- **Dry-run mode**: no commands executed. Every `gh` or `git` argv is appended to `dryRunLog()` so the CLI can show what *would* happen.
- Tests with an injected fake exec that records argv and returns canned `gh` JSON: idempotent sync (second call creates nothing), PR creation argv exact, failures (gh not authenticated → `StarlingError('GH_AUTH')`), dry-run log contents. **No real gh calls** (L23).

## Explicitly out of scope
Running gh against a real repo (Wave 2, Epic 43). CI. Webhooks. Merging PRs via GitHub (Starling merges locally).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test packages/github` passes, ≥ 15 tests. Renderer snapshots committed.
3. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
4. `bun run check` passes (Biome + typecheck for every workspace).
5. `docs/epic-18-github.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/18-github.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/18-github`. Conventional Commits scoped to your lane (`feat(github): …`, `test(github): …`, `docs(epic-18): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
