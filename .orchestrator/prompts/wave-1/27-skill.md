# Epic 27: Agent Skill + opencode integration

**Wave 1 · Branch `epic/27-skill` · Issue: find it with `gh issue list --search "Epic 27 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`skills/**` and `integrations/**`
plus `docs/epic-27-skill.md` and `.orchestrator/handbacks/27-skill.md`. Read anything; write nothing else.

## Goal
Ship Starling as an **Agent Skill** (the open `SKILL.md` format) and an **opencode command**, so any coding agent (opencode, Claude Code, others that read skills) can hand a big multi-part goal to the flock instead of grinding through it serially. This is the "create an agent skill" track of the hackathon, so make it polished.

## Deliverables
- **Research first**: read the current Agent Skills format spec (SKILL.md frontmatter fields `name` and `description`, progressive disclosure via linked reference files, bundled `scripts/`), and how the **installed opencode version** discovers skills and custom commands. Check `opencode --help`, its docs site, and where it looks for skills and commands (project `.opencode/` vs global `~/.config/opencode/`). Record what you found in your doc with links.
- `skills/starling/SKILL.md`:
  - Frontmatter with a sharp `description` that triggers on "parallelise this", "split into tasks", "run a swarm" and multi-feature goals.
  - Body: when to use Starling (multi-part goals with separable areas) and when not (one-file fixes); the 4-step workflow (`starling plan --json` → review lanes → `starling run` → watch/report); how to write a good goal; how to read the result (integration branch, verdicts); and safety (dry-run first, budget flag).
  - Keep it under ~300 lines and move detail into `skills/starling/reference/*.md` (`goals.md`, `lanes.md`, `flock.md`, `troubleshooting.md`).
- `skills/starling/scripts/`: `plan.sh`, `run.sh`, `status.sh` and `replay-demo.sh`, thin bash-3.2 wrappers over the CLI surface in ARCHITECTURE §6. They check `starling` is on PATH (or fall back to `bunx`/`bun run starling` from a repo checkout), print machine-readable output for agents (`--json`), and exit non-zero with a clear message on failure.
- `integrations/opencode/`: a `/swarm` custom command definition in the format the installed opencode expects (the agent passes `$ARGUMENTS` as the goal; it runs plan, shows lanes, asks the user to confirm, then runs), plus `install.sh [--global|--project]`, which copies the skill and command into the right opencode directories idempotently and prints what it did. Also `integrations/claude-code/README.md` with the one-liner to install the skill for Claude Code (skills folder), so the skill isn't opencode-only.
- `skills/starling/examples/`: two worked transcripts (illustrative, clearly labelled) of an agent using the skill on sky-todo.
- Tests (bun test in `skills/` or `integrations/`): SKILL.md frontmatter parses and the description is ≤ 1024 chars with the trigger words; every relative link in the skill resolves to a file; every script passes `bash -n` and prints usage on `--help`; `install.sh --project` into a temp dir creates the expected files and is idempotent on a second run.

## Explicitly out of scope
CLI implementation (Epic 22; your scripts target its locked surface). Running a real swarm. Publishing to a marketplace.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test skills integrations` passes, ≥ 12 tests.
3. Paste the output of `bash integrations/opencode/install.sh --project` run in a temp copy of sky-todo, plus a listing of the installed files.
4. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
5. `bun run check` passes (Biome + typecheck for every workspace).
6. `docs/epic-27-skill.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/27-skill.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/27-skill`. Conventional Commits scoped to your lane (`feat(skill): …`, `test(skill): …`, `docs(epic-27): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
