# Troubleshooting

Start with the exact command and its exit code. The scripts in `../scripts/` are thin wrappers; when one
fails, run the same arguments through `starling` directly to see whether the problem is the wrapper or the
CLI.

## Exit codes

| Code | Meaning                                                                           |
| ---- | --------------------------------------------------------------------------------- |
| 0    | success (for `run.sh`: the run finished; individual tasks may still have failed)  |
| 1    | runtime failure — git, the model provider, the engine                             |
| 2    | usage error, or `run.sh` refused to launch (missing budget / bad flag)            |
| 127  | `starling` could not be found                                                     |
| 130  | interrupted with Ctrl-C; the run may still be live on the hub — check `status.sh` |

## `starling: command not found` (or exit 127)

The wrapper looks in this order:

1. `$STARLING_BIN` (an explicit path to the binary)
2. `starling` on `PATH`
3. this repo's checkout (`apps/cli/src/index.ts`) with `bun`
4. `bunx starling`

If all fail, install Starling or set `STARLING_BIN`:

```bash
export STARLING_BIN=/path/to/starling
# or, from a Starling checkout:
export STARLING_BIN="$(pwd)/apps/cli/src/index.ts"   # not executable; use bun
```

`STARLING_BIN` must be an executable. For a source checkout, run the CLI as
`bun apps/cli/src/index.ts …` or install a `starling` shim on `PATH`.

If `bun` is missing, install Bun 1.4+ first (`bun --version`).

## The CLI prints "not yet implemented (epic NN)"

You are on a checkout where that command is still a stub. The wrapper is correct; the CLI epic has not
landed. Use a released build, or wait for the epic. Do not fake the output and do not try to drive the
packages directly from the skill.

## `plan.sh` output is not JSON / `jq` fails

- The CLI writes progress to **stderr** and the plan to **stdout**. Capture `2>/tmp/plan.err` and read both.
- Use `plan.sh --pretty` to read it yourself; use `--json` only for parsing.
- The result may be `{ "plan": …, "issues": … }` or a bare plan. Use `jq '.plan // .'` and `jq '.issues // []'`.
- If stdout is empty, the command failed: check the exit code and stderr.

## `run.sh` refuses to start: "no budget found"

That is the safety preflight. Add a budget to `starling.config.yaml`:

```yaml
budget:
  maxUsd: 5
```

Then re-run. `--dry-run` skips the check (it spends nothing). `--budget <usd>` additionally refuses when the
configured `maxUsd` is higher than the cap you asked for; lower the config or raise the flag. `--yes` accepts
the CLI default budget, and is the wrong choice for an unattended run.

## "working tree is dirty" / branches look wrong

Starling creates worktrees and branches from the integration branch. Commit or stash first:

```bash
git status --short
git stash push -u -m "before starling"   # or commit
```

Never run two hubs against the same repo at once. Use one worktree per run.

## An audit fails over and over

Read the verdict before retrying:

```bash
starling status <runId>        # then open the dashboard or the recorded JSONL
```

- `checks` names the failing check: tests, lane, or model.
- `laneViolations` is a real out-of-lane edit; fix the plan or tell the worker to stay in its folder.
- `fixInstructions` is the model's exact request. If it contradicts the DoD, the DoD is ambiguous — re-plan.

The run stops after `maxAttempts` (default 3). Re-running the whole goal is usually worse than narrowing it.

## A merge conflicts or integration tests fail

- `conflict`: the task's lane overlapped in practice even if the plan said otherwise. Inspect the
  integration branch, then re-plan with a stricter boundary. Do not force-merge.
- `tests-failed`: the task passed in isolation but broke a neighbour. Hand the failing output back as fix
  instructions, or split the goal so the shared behaviour is one task.
- `skipped`: nothing to merge (empty diff). Treat it as a planning error, not a success.

## The run stalls or a task never starts

- `maxParallel` may be full: reduce task count or raise the cap.
- Every node may be offline or out of slots (`starling flock`).
- A dependency may be failed or cancelled, so its children can never become ready. Check the DAG:
  `status.sh` shows task states, not the reason — use the dashboard/recorded events for `task.status`.
- A worker session may be idle without a handback. The runner should time out; if it does not, abort the task
  from the dashboard and let the scheduler retry it.

## A perch disappeared

Expected: heartbeats stop after 15s, `node.left` fires, the task goes back to `ready` and is rescheduled.
Work committed only on the perch and not yet collected is lost. Reconnect with the same `starling perch`
command; the node rejoins but does not reclaim its old task.

## The dashboard will not open

- `starling dash --port 7777` runs the server; `starling run` normally opens it unless `--no-dash`.
- The port may be taken: `lsof -i :7777`.
- Check `GET /api/health` → `{ "ok": true }`. If it is healthy but the page is blank, rebuild the web app or
  use the replay mode.
- On a headless machine, skip the dashboard and read `status.sh` / the recorded JSONL.

## Replay does not work

`replay-demo.sh` expects `fixtures/runs/sky-todo-launch-day.jsonl` in this repo. If you moved the skill out
of the repo, pass a full path to `starling replay` instead. Replay makes no network calls; if it fails, the
JSONL is missing or truncated, not the model provider.

## When to stop and ask the human

- The plan still has lane issues after one re-plan.
- The goal has no separable areas (it is one file, or every task needs the same file).
- Budget, credentials, or network access are missing.
- A failed audit's fix instructions conflict with the goal.

Do not paper over these by launching agents one at a time. Serial grinding is the failure mode this skill
exists to replace.
