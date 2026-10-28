HEADER = """# Epic {nn}: {title}

**Wave 1 · Branch `epic/{nn}-{slug}` · Issue: find it with `gh issue list --search "Epic {nn} in:title"` · Model: DeepSeek V4.1 Flash · Budget: {budget} of autonomous work**

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
- **L23**: **NO local models, no real LLM calls, no real opencode prompts, no GitHub calls from tests, no `ollama` commands at all.** Use the core mocks and in-process `Bun.serve({{ port: 0 }})` fakes. You may write `*.live.test.ts` files but do not run them. This laptop runs 20+ agents at once, so keep memory use low: no long-running servers left behind, no huge test fixtures.
- **L13/L14**: git and gh go through `exec` from core, injectable so tests can fake it.

## FIRST TASK: carryover
{carryover}

## Your lane (you may write ONLY here)
{lane}
plus `docs/epic-{nn}-{slug}.md` and `.orchestrator/handbacks/{nn}-{slug}.md`. Read anything; write nothing else.

## Goal
{goal}

## Deliverables
{deliverables}

## Explicitly out of scope
{oos}

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
{dod}
{n_test}. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
{n_check}. `bun run check` passes (Biome + typecheck for every workspace).
{n_doc}. `docs/epic-{nn}-{slug}.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/{nn}-{slug}.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/{nn}-{slug}`. Conventional Commits scoped to your lane (`feat({scope}): …`, `test({scope}): …`, `docs(epic-{nn}): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
"""

def render(e):
    dod_items = e["dod"]
    dod = "\n".join(f"{i+2}. {x}" for i, x in enumerate(dod_items))
    n = len(dod_items) + 2
    return HEADER.format(
        nn=e["nn"], slug=e["slug"], title=e["title"], budget=e.get("budget", "60–120 min"),
        carryover=e.get("carryover", "None. This is a Wave 1 epic built directly on Wave 0. (Stated explicitly so it's clear carryover was considered.)"),
        lane=e["lane"], goal=e["goal"].strip(), deliverables=e["deliverables"].strip(), oos=e["oos"].strip(),
        dod=dod, n_test=n, n_check=n+1, n_doc=n+2, scope=e["scope"],
    )
