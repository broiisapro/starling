import { resolve } from 'node:path';
import type { Run } from '@starling/core';
import type { CliContext } from '../context';
import { createEventRecorder } from '../jsonl';
import { applyEvent, emptyLiveState } from '../live-state';
import { LiveView } from '../live-view';
import { analyzePlan } from '../plan-health';
import { renderPlan } from '../render/plan';
import { renderSummary } from '../render/summary';
import { failWith, readBoolean, readNumber, readString, requirePositiveInteger } from './options';

/**
 * `starling run "<goal>"` — launch the flock and live-render until the run finishes.
 *
 * The bus subscription is attached *before* `start()` so no early event is lost. In Wave 1 the
 * composition is mock; the command itself is the real UX and will not change in Epic 40.
 */
export async function runCommand(
  goal: string,
  options: Record<string, unknown>,
  context: CliContext,
): Promise<number> {
  if (goal.trim().length === 0)
    failWith('INVALID_ARGUMENT', 'A goal is required — e.g. starling run "add dark mode"');

  const config = context.loadStarlingConfig();
  const composition = context.composition();
  const repoPath = resolve(context.cwd, readString(options, 'repo') ?? '.');
  const maxParallel = requirePositiveInteger(
    readNumber(options, 'maxParallel', config.maxParallel),
    '--max-parallel',
  );
  const dryRun = readBoolean(options, 'dryRun');
  const recordPath = readString(options, 'record');
  const showDashboard = readBoolean(options, 'dash', true);
  const recorder = recordPath === undefined ? undefined : createEventRecorder(recordPath, context.cwd);

  const state = emptyLiveState();
  const live = new LiveView({
    write: (text) => context.io.write(text),
    isTTY: context.io.isTTY,
    now: context.now,
    columns: context.columns,
    palette: context.palette,
  });

  const unsubscribe = composition.bus.subscribe((event) => {
    applyEvent(state, event);
    recorder?.record(event);
    if (!dryRun) live.render(state);
  });

  let runId: string;
  try {
    ({ runId } = await composition.engine.start({
      goal,
      repoPath,
      dryRun,
      maxParallel,
      baseBranch: config.baseBranch,
    }));
  } catch (err) {
    unsubscribe();
    live.close();
    throw err;
  }

  let run: Run;
  try {
    run = await composition.engine.waitForFinish(runId);
  } finally {
    unsubscribe();
  }

  if (dryRun) {
    live.close();
    const plan = run.plan;
    if (plan === undefined) failWith('PLAN_INVALID', 'The engine finished without producing a plan');
    const issues = analyzePlan(plan);
    context.write(
      renderPlan(plan, issues, {
        palette: context.palette,
        goal,
        badge: 'dry run',
        width: context.columns,
      }),
    );
    context.write();
    context.write(context.palette.dim('Dry run — no agents launched. Drop --dry-run to fly it. 🐦'));
    if (recorder !== undefined)
      context.write(context.palette.dim(`recorded ${recorder.count} events → ${recorder.path}`));
    return 0;
  }

  live.render(state, { force: true });
  live.close();
  context.write();

  const finalRun = state.run ?? run;
  const summary = state.finishedSummary ?? `Run ${run.status}.`;
  context.write(
    renderSummary(finalRun, summary, {
      palette: context.palette,
      width: Math.min(context.columns, 90),
    }),
  );
  context.write();

  if (recordPath !== undefined && recorder !== undefined) {
    context.write(context.palette.dim(`recorded ${recorder.count} events → ${recorder.path}`));
    context.write(`${context.palette.dim('replay it with ')}starling replay ${recordPath} --speed 4`);
  }

  if (showDashboard) {
    const url = `http://localhost:${config.server.port}`;
    context.write(
      `${context.palette.dim('dashboard')} ${context.palette.cyan(url)} ${context.palette.dim('(the web app lands in wave 2)')}`,
    );
  }

  if (readBoolean(options, 'github')) {
    context.write(context.palette.yellow('! --github recorded; issue and PR sync lands in wave 2.'));
  }
  if (readBoolean(options, 'fullyOpen')) {
    context.write(context.palette.yellow('! --fully-open recorded; local model routing lands in wave 2.'));
  }
  if (context.deps.mode !== 'real') {
    context.write(context.palette.dim('mock composition · the real engine lands in epic 40'));
  }

  return finalRun.status === 'finished' ? 0 : 1;
}
