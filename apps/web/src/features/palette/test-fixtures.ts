/**
 * Shared fixtures for the palette tests. Not a test file itself (`*.test.ts` only), so bun does not
 * collect it and component/unit tests share one parsed recording.
 */
import type { Run } from '@starling/core/browser';
import { BASE_TS, makeGoal, makePlan, makeRun, makeTaskSpec } from '@starling/core/testing';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState, type SkyState } from '../../data/reducer';
import type { PaletteFeature } from './items';

let cachedState: SkyState | undefined;

/** The recorded launch-day run, fully applied: 7 tasks, one finished run, real statuses. */
export function fixtureState(): SkyState {
  cachedState ??= applyEvents(createInitialState(), demoEvents());
  return cachedState;
}

export function stateWithRuns(runs: readonly Run[]): SkyState {
  const state = createInitialState();
  const record: Record<string, Run> = {};
  for (const run of runs) record[run.id] = run;
  return { ...state, runs: record, activeRunId: runs[0]?.id };
}

/** A plan big enough to prove the palette caps its render (the brief's 500-task case). */
export function stateWithTasks(count: number): SkyState {
  const goal = makeGoal({ id: 'goal-scale', text: 'Scale test for the palette' });
  const tasks = Array.from({ length: count }, (_, index) =>
    makeTaskSpec({ key: `t${index}`, title: `Task number ${index}`, goal: `Do thing ${index}` }),
  );
  const plan = makePlan({ goalId: goal.id, tasks });
  const run = makeRun({ goal, plan, startedAt: BASE_TS });
  return stateWithRuns([run]);
}

export const FEATURES: readonly PaletteFeature[] = [
  {
    id: 'report',
    title: 'Run report',
    description: 'What happened, in prose',
    kind: 'view',
    icon: 'BarChart3',
    hotkey: 'r',
  },
  {
    id: 'timeline',
    title: 'Timeline',
    description: 'Every event, in order',
    kind: 'view',
    icon: 'Clock',
    hotkey: 't',
  },
  {
    id: 'costs',
    title: 'Costs',
    description: 'API vs local spend',
    kind: 'panel',
    icon: 'Coins',
  },
];

/** CSV export is the fixture's third task; its title is what the DoD types into the palette. */
export const CSV_TASK_KEY = 'csv-export';
export const CSV_TASK_TITLE = 'CSV export';
