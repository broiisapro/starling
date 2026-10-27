# Epic 16: Auditor: tests + lanes + local LLM verdict

**Wave 1 · Branch `epic/16-auditor` · Issue: find it with `gh issue list --search "Epic 16 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`packages/auditor/**`
plus `docs/epic-16-auditor.md` and `.orchestrator/handbacks/16-auditor.md`. Read anything; write nothing else.

## Goal
Implement `Auditor`: Starling's quality gate. When an agent says it's done, decide **pass or fail with exact fix instructions**, combining hard deterministic checks (lane respected, tests pass) with a judgment from a (usually local, open-weight) model reading the diff against the task's definition of done. The demo moment ("the local model caught a missing test") lives here.

## Deliverables
- `createAuditor(opts: { llm?: LLM; exec?: typeof exec; clock?: Clock; commandTimeoutMs?: number /* 600_000 */; lintBlocking?: boolean /* false */; maxDiffChars?: number /* 60_000 */ }): Auditor`.
- `audit(input: AuditInput)` runs checks in order, records each as an `AuditCheck`, and never throws for check failures:
  1. **lane**: every changed file must match `ctx.task.lane.owns` (core `matchesAny`), so violations land in `laneViolations`. Starling's own bookkeeping paths are allowed (document which).
  2. **non-empty**: the diff isn't empty.
  3. **tests**: run `ctx.testCommand` in the worktree (`sh -c` via exec with a timeout) and keep the last 4 KB of output.
  4. **lint** (optional, blocking only if `lintBlocking`).
  5. **llm-review** (role `auditor`): `completeJson` with a schema `{ pass, summary, dod: [{ item, met, evidence }], fixInstructions? }`. The input is the task spec, the DoD list, the truncated diff (prioritise lane files, keep file headers) and the test output tail. The prompt is strict: every DoD item needs evidence in the diff, and **new behaviour without new tests fails**.
- Final `pass` = lane ok && non-empty && tests ok && (llm.pass, or no LLM configured). If the LLM errors or times out, record `llm-review` as skipped with the reason and decide deterministically. `fixInstructions` merges the deterministic failures (e.g. "revert changes to src/ui/render.ts, which is outside your lane") with the LLM's instructions into one numbered list.
- Each check reports its duration. The verdict carries the `model` used and `ts`.
- Tests with **MockLLM** and an **injected fake exec**: lane violation fails even when tests pass; tests failing gives fix instructions with the output tail; LLM says DoD unmet; LLM unavailable → deterministic pass; diff truncation keeps lane files; the "no tests added" scenario (the seeded `will-fail-audit` style diff) fails with an instruction to add tests. Prompt text gets a snapshot test.

## Explicitly out of scope
Tuning against the real local model (Wave 2, Epic 44). Choosing the model (Epic 28). Running the fix loop (the engine does). Real `ollama` (L23).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test packages/auditor` passes, ≥ 20 tests.
3. Your doc includes the full auditor system prompt and a worked example verdict JSON for the sky-todo csv-export task.
4. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
5. `bun run check` passes (Biome + typecheck for every workspace).
6. `docs/epic-16-auditor.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/16-auditor.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/16-auditor`. Conventional Commits scoped to your lane (`feat(auditor): …`, `test(auditor): …`, `docs(epic-16): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
