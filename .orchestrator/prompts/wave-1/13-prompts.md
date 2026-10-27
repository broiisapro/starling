# Epic 13: Prompt compiler

**Wave 1 · Branch `epic/13-prompts` · Issue: find it with `gh issue list --search "Epic 13 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`packages/prompts/**`
plus `docs/epic-13-prompts.md` and `.orchestrator/handbacks/13-prompts.md`. Read anything; write nothing else.

## Goal
Implement `PromptCompiler`: the pure functions that write what each worker agent reads. Starling's own build process (the prompt you are reading right now) proved this format works. Your job is to productise it for Starling's sub-agents: self-contained, lane-strict, finish-line explicit, and short enough for a fast model.

## Deliverables
- `createPromptCompiler(opts?: { maxRepoMapChars?: number; style?: 'full' | 'compact' }): PromptCompiler` with `worker(ctx)`, `fixer(ctx, verdict)` and `resolver(ctx, conflict)`. All pure and deterministic (no clock, no randomness).
- **Worker prompt** sections, in order:
  - Role: "you are one of N agents working in parallel".
  - Project context: goal text, plan summary, `lockedDecisions`.
  - **Your task**: title, goal, deliverables, out of scope, definition of done.
  - **Your lane**: the `owns` globs ("you may create or modify only files matching these") and `reads`, plus how violations are detected (the auditor diffs your branch and fails you).
  - **What the others are doing**: one line per sibling task with its lane, so the agent doesn't duplicate work or wander into their files.
  - Repo orientation: the repo map rendered with focus on the lane, truncated to budget, using your own small renderer for now.
  - How to verify: the `testCommand` and the task's DoD.
  - Git rules: commit on your branch with Conventional Commits; don't push, merge or switch branches (Starling handles that).
  - **Finish line**: end your final message with the handback block from ARCHITECTURE §8.
- **Fixer prompt**: which checks failed (from `AuditVerdict.checks`), the lane violations, the `fixInstructions` verbatim, "fix only these; don't redo completed work; the same lane rules apply", and the same handback requirement.
- **Resolver prompt**: the conflicted files, both tasks' intents (from the plan), the rules (preserve both behaviours; don't drop either side's tests; run the tests), and the handback.
- `parseHandback(text: string): WorkerHandback | undefined`: finds the **last** `<<<STARLING_HANDBACK … STARLING_HANDBACK>>>` block, tolerates code fences and trailing prose, validates with zod (mirror of §8 in `src/handshake.ts`).
- `estimateTokens(prompt)` and a budget guard: if a worker prompt exceeds `maxChars` (default 24k), shrink the repo map first, then the sibling list, never the task spec.
- Tests: **snapshot tests** (`toMatchSnapshot`) of worker, fixer and resolver prompts for the sky-todo fixture plan; invariants (every DoD item appears, every owns glob appears, siblings listed, handback instructions present); budget shrink behaviour; `parseHandback` cases (fenced, multiple blocks, malformed JSON → undefined, extra fields ignored).

## Explicitly out of scope
Calling any LLM. Deciding the task breakdown (planner). Rendering repo maps beyond a minimal renderer (repomap's is adopted at C1).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test packages/prompts` passes, ≥ 20 tests. Snapshots committed.
3. Paste the full rendered **worker prompt** for task `t03-csv-export` (or the fixture's equivalent key) into your doc as an appendix, so the Orchestrator can review its tone and clarity.
4. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
5. `bun run check` passes (Biome + typecheck for every workspace).
6. `docs/epic-13-prompts.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/13-prompts.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/13-prompts`. Conventional Commits scoped to your lane (`feat(prompts): …`, `test(prompts): …`, `docs(epic-13): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
