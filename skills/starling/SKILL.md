---
name: starling
description: "Hand a multi-part coding goal to Starling, a flock of parallel coding agents: it splits the work into lane-safe tasks, runs them in isolated git worktrees, audits each result, and merges the passing work onto one integration branch. Use when the user says \"parallelise this\", \"parallelize this\", \"split into tasks\", \"run a swarm\", or asks for several separable features, fixes, or refactors across a repo at once; also use when a goal touches many files or independent areas that could be built concurrently. Do not use for a one-file fix or a single small change."
license: MIT
compatibility: 'Requires git and the `starling` CLI, or a Starling checkout with Bun >= 1.4. Optional: opencode >= 2.1 for the /swarm command and a second laptop for flock mode.'
metadata:
  version: "0.1"
---

# Starling — one goal in, a murmuration out 🐦

Starling turns one goal sentence into a **task DAG with non-overlapping file lanes**, runs each task in its
own git worktree and coding-agent session, audits every result (tests + lane check + model verdict), and
merges the passing work onto a single integration branch.

You are the planner's client: you hand Starling a goal, review the plan it returns, get the human's
approval, then launch and report. Do not decompose the goal yourself — that is Starling's job.

## When to use this skill

Use it when the goal has **separable areas** that can be built at the same time, for example:

- "Add dark mode, search, CSV export and fix the date bugs."
- "Split this refactor into tasks and parallelise it across the repo."
- "Run a swarm on the docs: API reference, migration guide, troubleshooting page."
- A backlog of unrelated fixes in different folders, or a feature that spans several feature folders.

Typical signals: three or more deliverables, several directories, the words "parallelise", "split into
tasks", "swarm", "at once", "in parallel".

### When NOT to use it

- A one-file fix, a typo, a single function, or a change that fits in one commit. Just do it.
- The parts are strongly sequential and touch the same files — a plan would serialise everything anyway.
- The repo has uncommitted work. Ask the user to commit or stash first; Starling branches from a clean base.
- The user wants a review, an explanation or a design sketch, not code.

If in doubt, plan first (`--dry-run`); planning is cheap and read-only.

## The 4-step workflow

Work from the target repository. Every script lives next to this file (`scripts/`). Project installs put the
skill at `.opencode/skills/starling/`, global opencode installs at `~/.config/opencode/skills/starling/`, and
Claude Code installs at `~/.claude/skills/starling/`. The `/swarm` command resolves the right path for you.

### 1. Plan (machine-readable)

```bash
.opencode/skills/starling/scripts/plan.sh --json "<goal>"
```

This maps the repo and prints the plan JSON (tasks, lanes, DAG, validation issues). It writes nothing to the
repo. Read the full plan; do not summarise it away.

### 2. Review the lanes before anything runs

For every task check:

- `lane.owns` is **disjoint** from every other task that can run at the same time (`dependsOn` does not save
  you: only merged dependencies serialise tasks).
- `lane.reads` names shared contracts instead of two tasks both owning them.
- `definitionOfDone` contains literal, checkable steps (tests, commands, behaviours), not "works well".
- `dependsOn` captures real ordering (a shared helper must merge before its consumer).
- No task owns a root config, lockfile, shared registry or `src/main.ts`-style integration file unless it is
  the only task that does.

Any validation issue (`lane-overlap`, `cycle`, `missing-dep`, `empty-dod`, `empty-lane`) is a **stop sign**.
Re-plan with a narrower goal or explicit constraints, or hand the goal to the user. Do not edit lanes by hand
and do not start the run. See [reference/lanes.md](reference/lanes.md).

### 3. Confirm, dry-run, then run

Show the human a compact table (task key, title, owns, depends on) and the validation result. After they
approve:

```bash
.opencode/skills/starling/scripts/run.sh --dry-run "<goal>"   # same plan, no agents
.opencode/skills/starling/scripts/run.sh "<goal>"             # launch the flock
```

`run.sh` refuses a non-dry run when it cannot find a budget in `starling.config.yaml`. Set
`budget.maxUsd` first. `--budget <usd>` is a stricter entry cap: it is refused when it is lower than the
configured budget. This is a wrapper-level preflight; the CLI enforces the real spend cap.

Add `--max-parallel 8` to match the machine, `--record .starling/run.jsonl` to keep a replayable log, and
`--no-dash` for a headless session. Flock mode (more laptops) needs no extra flag: start
`starling perch` on the other machine first. See [reference/flock.md](reference/flock.md).

### 4. Watch and report

```bash
.opencode/skills/starling/scripts/status.sh [runId]
```

While the run is live, report by exception: tasks that changed status, audits that failed, merges that
conflicted. Do not narrate every event. When it finishes, report:

- the **integration branch** (`starling/<runShort>/integration`) — that is the deliverable;
- tasks **merged**, **failed** and **cancelled**, with the audit verdict for each failure;
- the **cost**: API spend vs local-model calls;
- what the human should do next (review the branch, open a PR, re-run a failed task with a narrower goal).

The run is not "done" because agents went idle. It is done when the integration branch exists, the full test
suite passes on it, and every task is terminal.

## Writing a good goal

One or two sentences: the outcome, the areas, and the constraints that are not obvious from the repo.

```text
Add dark mode with a persisted toggle, live search, CSV export, keyboard shortcuts
(n = new, / = search, ? = help), due-date badges, and fix the overdue-calculation
and date-sorting bugs in src/lib/dates.ts. No new dependencies outside src/features/.
```

Rules of thumb:

- Name **outcomes**, not file-by-file instructions; the planner owns decomposition.
- Mention genuine constraints ("keep the bundle under 200 kB", "no new deps", "keep the public API").
- Leave unrelated cleanup out; small goals make better lanes.
- If two deliverables must share a file, say which one owns it, or expect the planner to serialise them.

More patterns in [reference/goals.md](reference/goals.md).

## Reading the result

- **Integration branch**: all passing work, in DAG order. Audit and merge always happen on the hub repo.
- **Per-task verdict**: `checks` (tests, lane, model), `laneViolations`, `summary`, `fixInstructions`.
- **Failed task**: the branch still exists; read the verdict before re-running. A failure is information, not
  an accident.
- **Not merged**: `conflict` or `tests-failed` means the auditor passed but integration did not; inspect the
  integration branch, don't just retry.

## Safety

- **Plan before running.** The plan is dry and free; the run spends tokens.
- **Budget**: `budget.maxUsd` in `starling.config.yaml` is the cap. Pass `--fully-open` for local models only.
- **Clean tree**: run only from a committed working tree. Starling creates branches and worktrees; it never
  rewrites your base branch.
- **No secrets**: prompts and diffs are sent to the configured model providers. Do not point Starling at a
  repo full of `.env` files.
- **Never nest swarms**: if you are already inside a Starling worker session, do not launch another run. One
  hub per repo.
- **Review before shipping**: the integration branch is a proposal. You still own the merge to `main`.

## Reference

| File                                                         | Read it when                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [reference/goals.md](reference/goals.md)                     | the goal is vague, huge, or the user asks "how should I phrase this?"     |
| [reference/lanes.md](reference/lanes.md)                     | reading a plan, judging overlap, or fixing validation issues              |
| [reference/flock.md](reference/flock.md)                     | the run is slow, or a second laptop should join                           |
| [reference/troubleshooting.md](reference/troubleshooting.md) | `starling` is missing, a run stalls, an audit loops, or a merge conflicts |

Worked transcripts (illustrative, not recordings): [examples/launch-day.md](examples/launch-day.md) and
[examples/lane-repair.md](examples/lane-repair.md).

## Scripts

All scripts are bash 3.2 compatible, print usage on `--help`, and exit non-zero with a clear message on
failure. They resolve `starling` from `STARLING_BIN`, then `PATH`, then a Bun checkout of this repo, then
`bunx starling`.

| Script                                                         | What it does                                  |
| -------------------------------------------------------------- | --------------------------------------------- |
| `scripts/plan.sh [--repo <path>] [--pretty] "<goal>"`          | plan, JSON by default (`--pretty` for humans) |
| `scripts/run.sh [--dry-run] [--budget <usd>] [--yes] "<goal>"` | budget preflight + `starling run`             |
| `scripts/status.sh [runId]`                                    | `starling status` for one run                 |
| `scripts/replay-demo.sh [--speed <factor>]`                    | replay the bundled sky-todo demo run offline  |

If the tools fail, read [reference/troubleshooting.md](reference/troubleshooting.md) before retrying — and
never "fix" it by launching agents one by one. That is the problem Starling exists to solve.
