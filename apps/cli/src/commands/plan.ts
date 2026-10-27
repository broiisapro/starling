import { resolve } from 'node:path';
import type { CliContext } from '../context';
import { analyzePlan } from '../plan-health';
import { renderPlan } from '../render/plan';
import { failWith, readBoolean, readString } from './options';

/**
 * `starling plan "<goal>"` — map a repo and print a validated DAG.
 *
 * In Wave 1 the mock composition plans from the goal and returns immediately; the command still
 * flows through `EngineApi.start({dryRun})`, so Epic 40 changes the composition, not this file.
 */
export async function planCommand(
  goal: string,
  options: Record<string, unknown>,
  context: CliContext,
): Promise<number> {
  if (goal.trim().length === 0)
    failWith('INVALID_ARGUMENT', 'A goal is required — e.g. starling plan "add dark mode"');

  const composition = context.composition();
  const repoPath = resolve(context.cwd, readString(options, 'repo') ?? '.');
  const { runId } = await composition.engine.start({ goal, repoPath, dryRun: true });
  const run = await composition.engine.waitForFinish(runId);
  const plan = run.plan;
  if (plan === undefined) failWith('PLAN_INVALID', 'The engine finished without producing a plan');

  // The engine's issues are not part of Run; the CLI re-checks the plan for presentation.
  const issues = analyzePlan(plan);

  if (readBoolean(options, 'json')) {
    context.write(JSON.stringify({ plan, issues }, null, 2));
    return issues.some((issue) => issue.severity === 'error') ? 1 : 0;
  }

  context.write(
    renderPlan(plan, issues, {
      palette: context.palette,
      goal,
      badge: context.deps.mode === 'real' ? 'real composition' : 'mock composition',
      width: context.columns,
    }),
  );
  context.write();
  context.write(context.palette.dim('Dry run — no agents launched. `starling run "<goal>"` executes it.'));
  return issues.some((issue) => issue.severity === 'error') ? 1 : 0;
}
