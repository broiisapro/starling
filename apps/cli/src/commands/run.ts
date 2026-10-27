import { resolve } from 'node:path';
import type { Run, StarlingConfig } from '@starling/core';
import type { LLMProfileName } from '@starling/llm';
import type { Composition } from '../compose';
import type { CliContext } from '../context';
import { applyEvent, emptyLiveState } from '../live-state';
import { LiveView } from '../live-view';
import { analyzePlan } from '../plan-health';
import { type Dashboard, startDashboard } from '../real/dashboard';
import { type CompactRecorder, createCompactEventRecorder } from '../real/recording';
import { renderPlan } from '../render/plan';
import { renderSummary } from '../render/summary';
import { failWith, readBoolean, readNumber, readString, requirePositiveInteger } from './options';

/**
 * `starling run "<goal>"` — launch the flock and live-render until the run finishes.
 *
 * Real by default (`compose` builds `./real/compose-real`); `--mock` keeps the Wave 1 demo stack for
 * tests, recordings and a laptop with no opencode. The bus subscription is attached *before*
 * `start()` so no early event is lost, and the dashboard is started after the engine exists but
 * before the first task dispatches, so the browser sees the whole run.
 */
export async function runCommand(
  goal: string,
  options: Record<string, unknown>,
  context: CliContext,
): Promise<number> {
  if (goal.trim().length === 0)
    failWith('INVALID_ARGUMENT', 'A goal is required — e.g. starling run "add dark mode"');

  const config = context.loadStarlingConfig();
  const repoPath = resolve(context.cwd, readString(options, 'repo') ?? '.');
  const maxParallel = requirePositiveInteger(
    readNumber(options, 'maxParallel', config.maxParallel),
    '--max-parallel',
  );
  const dryRun = readBoolean(options, 'dryRun');
  const recordPath = readString(options, 'record');
  const showDashboard = readBoolean(options, 'dash', true);
  const github = readBoolean(options, 'github');
  const fullyOpen = readBoolean(options, 'fullyOpen');
  const mock = readBoolean(options, 'mock');
  const mode = mock ? 'mock' : (context.deps.mode ?? 'mock');
  const budgetUsd = readOptionalUsd(options);

  const effective: StarlingConfig = {
    ...config,
    ...(budgetUsd === undefined ? {} : { budget: { ...config.budget, maxUsd: budgetUsd } }),
    ...(github ? { github: { ...config.github, enabled: true } } : {}),
  };
  const profile: LLMProfileName | undefined = fullyOpen ? 'local' : undefined;

  const composition = context.composition({
    config: effective,
    repoPath,
    ...(budgetUsd === undefined ? {} : { budgetUsd }),
    github,
    ...(profile === undefined ? {} : { profile }),
  });
  const recorder = recordPath === undefined ? undefined : createCompactEventRecorder(recordPath, context.cwd);

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

  let dashboard: Dashboard | undefined;
  let onSigint: (() => void) | undefined;

  try {
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

    if (showDashboard && !dryRun && mode === 'real') {
      dashboard = openDashboard(context, composition, effective);
    }

    // Ctrl-C is a cancellation, not a crash: let the engine abort sessions and close the run out.
    onSigint = () => {
      context.writeErr(context.palette.dim('\ninterrupt — cancelling the run…'));
      void composition.engine.cancel(runId).catch(() => undefined);
    };
    process.once('SIGINT', onSigint);

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
      reportRecording(context, recorder);
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
    printLanding(context, finalRun, repoPath);
    reportRecording(context, recorder);
    if (dashboard !== undefined) {
      context.write(`${context.palette.dim('dashboard')} ${context.palette.cyan(dashboard.url)}`);
    } else if (showDashboard && mode !== 'real') {
      context.write(
        `${context.palette.dim('dashboard')} ${context.palette.cyan(`http://localhost:${config.server.port}`)} ${context.palette.dim('(mock run — `starling dash` serves the store)')}`,
      );
    }
    if (mode !== 'real') {
      context.write(context.palette.dim('mock composition · drop --mock for a real run'));
    }

    return finalRun.status === 'finished' ? 0 : 1;
  } finally {
    if (onSigint !== undefined) process.off('SIGINT', onSigint);
    dashboard?.stop();
    await composition.close?.();
  }
}

/** `--budget <usd>`: a non-negative number, validated before anything starts spending. */
function readOptionalUsd(options: Record<string, unknown>): number | undefined {
  const raw = options.budget;
  if (raw === undefined) return undefined;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    failWith('INVALID_ARGUMENT', `--budget must be a non-negative number of dollars (got ${String(raw)})`);
  }
  return value;
}

function openDashboard(
  context: CliContext,
  composition: Composition,
  config: StarlingConfig,
): Dashboard | undefined {
  try {
    const dashboard = startDashboard({
      engine: composition.engine,
      store: composition.store,
      bus: composition.bus,
      ...(composition.flock === undefined ? {} : { flock: composition.flock }),
      port: config.server.port,
    });
    // Perches fetch the integration branch from this URL, not from the configured guess.
    composition.setHubUrl?.(dashboard.url);
    return dashboard;
  } catch (err) {
    // A busy port must never kill a coding run that is otherwise fine.
    context.writeErr(
      context.palette.yellow(`! dashboard not started: ${err instanceof Error ? err.message : String(err)}`),
    );
    return undefined;
  }
}

function printLanding(context: CliContext, run: Run, repoPath: string): void {
  const branch = run.integrationBranch;
  if (branch === undefined) return;
  context.write(`${context.palette.dim('repo')}   ${repoPath}`);
  context.write(`${context.palette.dim('branch')} ${context.palette.cyan(branch)}`);
  context.write(context.palette.dim(`        git -C ${repoPath} log --oneline ${branch} | head`));
}

function reportRecording(context: CliContext, recorder: CompactRecorder | undefined): void {
  if (recorder === undefined) return;
  context.write(context.palette.dim(`recorded ${recorder.count} events → ${recorder.path}`));
  if (recorder.capped) {
    context.write(
      context.palette.yellow(
        `! recording hit its 5 MB cap — dropped ${recorder.dropped} agent/metrics events (lifecycle kept)`,
      ),
    );
  }
  context.write(`${context.palette.dim('replay it with ')}starling replay ${recorder.path} --speed 4`);
}
