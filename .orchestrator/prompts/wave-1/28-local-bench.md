# Epic 28: Local model benchmark harness (MBP + Air)

**Wave 1 · Branch `epic/28-local-bench` · Issue: find it with `gh issue list --search "Epic 28 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 45–90 min of autonomous work**

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
Epic 02 is merged (or about to be): `tools/local-models/` has `setup.sh`, `candidates.json`, `smoke.ts` (plus `ollama.ts`/`host.ts` if its fix kept the refactor) and real smoke results for `qwen3.8:27b-mlx`. **Critical lesson (L23):** loading a 27B model while ~20 agents run pushed this 32 GB Mac to 4% free RAM. So in this epic you build and test the benchmark **without loading any model**. The real benchmark run happens later as a deliberate step when nothing else is running.

## Your lane (you may write ONLY here)
`tools/local-models/**`
plus `docs/epic-28-local-bench.md` and `.orchestrator/handbacks/28-local-bench.md`. Read anything; write nothing else.

## Goal
Build the benchmark that decides **which local open-weight models Starling uses for auditing and summarising on each laptop** (MacBook Pro M5 Pro 32 GB; MacBook Air M2, RAM to be confirmed by `setup.sh` there). It measures accuracy on audit-style judgments as well as speed and memory, and writes a recommendation. Build it fully now, and validate it against a fake Ollama.

## Deliverables
- `tools/local-models/cases/`: **12 audit cases** as JSON. Each has a task spec (title, DoD), a unified diff, a test-output tail and the expected verdict (`pass`) plus required mentions (e.g. must mention "test"). Use realistic sky-todo-style changes: good csv export with tests; csv export **without** tests (must fail); a lane violation (must fail); partial DoD; tests failing; a trivially good docs change; a subtle bug (off-by-one in the date fix); good but large; etc. Balanced roughly half pass, half fail.
- `tools/local-models/bench.ts`: `bun tools/local-models/bench.ts --models a,b --profile mbp|air [--cases dir] [--repeat 2] [--max-ram-gb N] [--dry-run]`.
  - For each model, run all cases through the same JSON-schema audit request that `smoke.ts` uses (reuse its client code).
  - Record per-case correctness, TTFT, total latency, tok/s and JSON validity.
  - Record the model's resident memory (via `ollama ps` sizes) and system free memory before and after.
  - **Safety rails**: refuse to start if more than 4 `opencode` processes are running, or if free memory is < `--max-ram-gb` headroom, unless `--force`. Unload each model (`keep_alive: 0`) before loading the next. Abort a model on its first OOM-ish failure.
- Output: `results/bench-<host>-<date>.json` plus a markdown table printed to stdout, and `recommend.ts`, which picks per profile the best model by accuracy, then latency, within the RAM budget, and writes `results/recommendation.json` (`{ mbp: {auditor, summarizer}, air: {auditor, summarizer} }`).
- `--dry-run` and the test suite use a **fake Ollama server** on `Bun.serve({ port: 0 })` that answers deterministically (scripted per model: one "smart" fake that gets everything right, one "lazy" fake that passes everything) so the scoring, rails and recommendation logic are fully tested.
- `tools/local-models/RUNBOOK` section in your doc: the exact steps Moksh runs later, (a) on the MBP with all agents stopped and (b) on the Air, and how long each takes.

## Explicitly out of scope
Actually loading/pulling models in this session (L23). Auditor package code (Epic 16). Changing Ollama settings globally.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test tools/local-models` passes, ≥ 15 tests, all against the fake server.
3. `bun tools/local-models/bench.ts --dry-run --models fake-smart,fake-lazy --profile mbp` output pasted (the table plus the recommendation picking fake-smart).
4. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
5. `bun run check` passes (Biome + typecheck for every workspace).
6. `docs/epic-28-local-bench.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/28-local-bench.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/28-local-bench`. Conventional Commits scoped to your lane (`feat(local-models): …`, `test(local-models): …`, `docs(epic-28): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
