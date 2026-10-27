---
description: Plan a multi-part goal into lane-safe tasks, review the lanes, then launch the Starling flock
---

Load the `starling` skill if it is not already loaded. Use it end to end for this goal:

$ARGUMENTS

Do this now, in order:

0. **Locate the scripts.** They live beside the installed `SKILL.md`. Project installs put them in
   `.opencode/skills/starling/scripts`; global installs in `~/.config/opencode/skills/starling/scripts` or
   `~/.claude/skills/starling/scripts`. Resolve once and reuse the path:

   ```bash
   SKILL_SCRIPTS=".opencode/skills/starling/scripts"
   [ -x "$SKILL_SCRIPTS/plan.sh" ] || SKILL_SCRIPTS="$HOME/.config/opencode/skills/starling/scripts"
   [ -x "$SKILL_SCRIPTS/plan.sh" ] || SKILL_SCRIPTS="$HOME/.claude/skills/starling/scripts"
   [ -x "$SKILL_SCRIPTS/plan.sh" ] && echo "$SKILL_SCRIPTS"
   ```

1. **If the goal is empty**, ask for one sentence describing the outcome. If the goal is a single small
   change or one file, say so and do the work directly instead of launching a swarm.

2. **Plan.** From the repository root run (using the `SKILL_SCRIPTS` you resolved):

   ```bash
   "$SKILL_SCRIPTS/plan.sh" --json "$ARGUMENTS"
   ```

   Read stdout as JSON (`jq '.plan // .'`, `jq '.issues // []'`). Keep stderr separately if the command fails.

3. **Review the lanes.** Show a compact table with one row per task: `key`, `title`, `lane.owns`,
   `dependsOn`. Then state explicitly:
   - whether any `owns` globs overlap for tasks that can run concurrently;
   - whether every task has a non-empty definition of done and lane;
   - whether the DAG is wide enough to be worth parallelising;
   - any `issues` returned by the planner.

   If there is a `lane-overlap`, `cycle`, `missing-dep`, `empty-dod` or `empty-lane`, **stop**. Do not run.
   Explain the problem and ask whether to re-plan with a tighter boundary or split the goal into two runs.

4. **Confirm.** Ask the user to approve the plan, showing the task count and the narrowed goal text. Do not
   launch anything until they say yes.

5. **Dry-run, then run.** On approval:

   ```bash
   "$SKILL_SCRIPTS/run.sh" --dry-run "$ARGUMENTS"
   "$SKILL_SCRIPTS/run.sh" "$ARGUMENTS"
   ```

   `run.sh` refuses a real run without `budget.maxUsd` in `starling.config.yaml`. If it refuses, tell the
   user the exact line to add; do not pass `--yes` on their behalf. Use `--no-dash` when the session is
   headless, and `--record .starling/run.jsonl` when the user may want to replay it.

6. **Report by exception.** While it runs, use `"$SKILL_SCRIPTS/status.sh"` and report only status changes,
   failed audits and merge conflicts. When it finishes, report the integration branch, the merged, failed and
   cancelled tasks with verdicts, the API-vs-local cost, and the next step for the human.

Rules:

- Never decompose the goal into hand-written tasks and run them yourself. That defeats the point.
- Never edit a plan by hand and launch it; the engine re-validates and your edits are lost.
- Never launch a second swarm from inside a worker session, and never run two hubs against the same repo.
- The integration branch is a proposal: the human still reviews and merges it.
- If the `starling` CLI is missing or still a stub, report that plainly and stop. Do not simulate a run.
