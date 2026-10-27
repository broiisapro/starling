import { type Run, StarlingError } from '@starling/core/browser';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState, type SkyState } from '../../data/reducer';
import { sortedRuns } from '../../data/selectors';

/**
 * Fixtures for the compare page and its playground.
 *
 * `fixtureRun()` is the recorded launch-day run (7 tasks, 5m 56s wall, peak parallelism 4). The
 * "second run" is derived deterministically from it: a new id, `help-overlay` removed, `shortcuts`'
 * lane widened and every cost scaled by 1.6 — enough to make added/removed/changed and cheaper/more
 * expensive rows visible without a second recording.
 */

let cachedRun: Run | undefined;

export function fixtureRun(): Run {
  if (cachedRun === undefined) {
    const state = applyEvents(createInitialState(), demoEvents());
    const run = sortedRuns(state)[0];
    if (run === undefined) {
      throw new StarlingError('INVALID_ARGUMENT', 'The launch-day fixture contains no run.created event');
    }
    cachedRun = run;
  }
  return structuredClone(cachedRun);
}

const COST_SCALE = 1.6;

function scaled(value: number): number {
  return Math.round(value * COST_SCALE * 1_000_000) / 1_000_000;
}

export function secondRun(run: Run): Run {
  const next = structuredClone(run);
  next.id = `${run.id}-b`;
  next.goal = {
    ...next.goal,
    id: `${run.goal.id}-b`,
    text: `${run.goal.text} (re-run on two laptops)`,
  };

  const tasks: Run['tasks'] = {};
  for (const [key, task] of Object.entries(next.tasks)) {
    if (key === 'help-overlay') continue;
    tasks[key] = { ...task, costUsd: scaled(task.costUsd) };
  }
  next.tasks = tasks;
  next.metrics = {
    ...next.metrics,
    apiCostUsd: scaled(run.metrics.apiCostUsd),
    estSavedUsd: scaled(run.metrics.estSavedUsd),
  };

  if (next.plan !== undefined) {
    next.plan = {
      ...next.plan,
      id: `${next.plan.id}-b`,
      goalId: next.goal.id,
      tasks: next.plan.tasks
        .filter((task) => task.key !== 'help-overlay')
        .map((task) =>
          task.key === 'shortcuts'
            ? {
                ...task,
                lane: { ...task.lane, owns: [...task.lane.owns, 'src/features/shortcuts-panel/**'] },
              }
            : task,
        ),
    };
  }

  return next;
}

/** One recorded run — the demo mode edge case that must compare against its serial baseline. */
export function fixtureState(): SkyState {
  const a = fixtureRun();
  return {
    ...createInitialState(),
    runs: { [a.id]: a },
    activeRunId: a.id,
    connection: 'demo',
  };
}

/** The fixture plus its deterministic second run, with A active. */
export function twoRunState(): SkyState {
  const a = fixtureRun();
  const b = secondRun(a);
  return {
    ...createInitialState(),
    runs: { [a.id]: a, [b.id]: b },
    activeRunId: a.id,
    connection: 'demo',
  };
}

export function comparisonFixture(): { a: Run; b: Run } {
  const a = fixtureRun();
  return { a, b: secondRun(a) };
}
