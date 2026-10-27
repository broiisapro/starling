import { resolve } from 'node:path';
import type { CliContext } from '../context';
import { analyzePlan } from '../plan-health';
import { renderPlan } from '../render/plan';
import { failWith, readBoolean, readString } from './options';

/**
 * `starling plan "<goal>"` — map a repo and print a validated DAG.
 *
 * Real by default: the real composition maps the repo, asks the planner model for a task DAG and
 * validates/repairs it, all through `EngineApi.start({ dryRun: true })` (so `plan` and `run` share one
 * code path). `--json` keeps stdout **pure** — `{ plan, issues }` and nothing else; every progress
 * line and warning goes to stderr, because the agent skill pipes the output straight into `jq`.
 */
export async function planCommand(
  goal: string,
  options: Record<string, unknown>,
  context: CliContext,
): Promise<number> {
  if (goal.trim().length === 0)
    failWith('INVALID_ARGUMENT', 'A goal is required — e.g. starling plan "add dark mode"');

  const json = readBoolean(options, 'json');
  const config = context.loadStarlingConfig();
  const repoPath = resolve(context.cwd, readString(options, 'repo') ?? '.');
  const mode = context.deps.mode ?? 'mock';
  const composition = context.composition({ config, repoPath });

  try {
    if (mode === 'real') {
      context.writeErr(context.palette.dim(`mapping ${repoPath} and asking the planner…`));
    }
    const { runId } = await composition.engine.start({
      goal,
      repoPath,
      dryRun: true,
      baseBranch: config.baseBranch,
    });
    const run = await composition.engine.waitForFinish(runId);
    const plan = run.plan;
    if (plan === undefined) failWith('PLAN_INVALID', 'The engine finished without producing a plan');

    // The engine's issues are not part of Run; the CLI re-checks the plan for presentation.
    const issues = analyzePlan(plan);

    if (json) {
      context.write(JSON.stringify({ plan, issues }, null, 2));
      return issues.some((issue) => issue.severity === 'error') ? 1 : 0;
    }

    context.write(
      renderPlan(plan, issues, {
        palette: context.palette,
        goal,
        badge: mode === 'real' ? 'real composition' : 'mock composition',
        width: context.columns,
      }),
    );
    context.write();
    context.write(context.palette.dim('Dry run — no agents launched. `starling run "<goal>"` executes it.'));
    return issues.some((issue) => issue.severity === 'error') ? 1 : 0;
  } finally {
    await composition.close?.();
  }
}
