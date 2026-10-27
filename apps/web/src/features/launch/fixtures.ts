import type { Goal, Plan, Run, RunMetrics, TaskRun, TaskSpec } from '@starling/core';
import { emptyMetrics } from '@starling/core/browser';

/**
 * Fixtures for the launch playground.
 *
 * They mirror `examples/sky-todo/demo-goals/*.expected.md` (same task keys and lanes) so the preview,
 * the overlap badge and the history rows look exactly like the real sky-todo runs. Pure literals: no
 * `?raw` import, no `node:fs`, so the playground also renders in a production build.
 */
const NOW = Date.now();
const MIN = 60_000;
const MODEL = { provider: 'opencode', model: 'deepseek-v4.1-flash' };

function task(
  key: string,
  title: string,
  owns: string[],
  dependsOn: string[] = [],
  estimateMin = 8,
): TaskSpec {
  return {
    key,
    title,
    goal: title,
    deliverables: [owns[0] ?? 'src/features/README.md'],
    outOfScope: [],
    definitionOfDone: ['bun test passes', 'The feature works from a cold reload'],
    dependsOn,
    lane: { owns, reads: ['src/store/todos.ts', 'src/features/README.md'] },
    estimateMin,
  };
}

const LAUNCH_TASKS = [
  task('theme', 'Dark mode with a persisted toggle', ['src/features/theme/**'], [], 12),
  task('search', 'Live search filtering', ['src/features/search/**'], [], 10),
  task('csv-export', 'CSV export with correct quoting', ['src/features/export/**'], [], 12),
  task('shortcuts', 'Keyboard shortcuts n / ?', ['src/features/shortcuts/**'], [], 8),
  task('help-overlay', 'Help sheet listing the shortcuts', ['src/features/help/**'], ['shortcuts'], 10),
  task('dates-fix', 'Fix overdue + due-date sorting', ['src/lib/dates.ts', 'src/lib/dates.test.ts'], [], 8),
  task('due-badges', 'Due-date badges on todo rows', ['src/features/due-dates/**'], ['dates-fix'], 10),
];

const QUICK_TASKS = [
  task('title-count', 'Open-task count in the tab title', ['src/features/title-count/**'], [], 4),
  task('today', "Today's date in the header", ['src/features/today/**'], [], 4),
  task('tag-count', 'Distinct tag count in the footer', ['src/features/tag-count/**'], [], 4),
];

/** The deliberate collision: two tasks, one file. */
const CONFLICT_TASKS = [
  task('date-sort', 'Sort-by-due toggle in the footer', ['src/ui/render.ts', 'src/ui/styles.css'], [], 10),
  task('delete-all', 'Delete-all button in the footer', ['src/ui/render.ts', 'src/ui/styles.css'], [], 8),
];

const XL_EXTRA = [
  task('undo', 'Undo / redo the todo list', ['src/features/undo/**'], [], 12),
  task('stats', 'Completion stats in the footer', ['src/features/stats/**'], [], 8),
  task('tags', 'Tag chips + tag filtering', ['src/features/tags/**'], [], 14),
];

function plan(id: string, goalId: string, summary: string, tasks: TaskSpec[], createdAt: number): Plan {
  return {
    id,
    goalId,
    summary,
    tasks,
    lockedDecisions: ['Vanilla TypeScript, no framework', 'Feature folders self-register via a Vite glob'],
    model: MODEL,
    createdAt,
  };
}

export const LAUNCH_PLAN = plan(
  'plan_launchday',
  'goal_launchday',
  'Seven lane-disjoint changes; five fly immediately, two wait on a DAG edge.',
  LAUNCH_TASKS,
  NOW - 28 * MIN,
);

const QUICK_PLAN = plan(
  'plan_quickwins',
  'goal_quickwins',
  'Three tiny, independent changes — three agents, three folders, zero shared writes.',
  QUICK_TASKS,
  NOW - 2 * 60 * MIN,
);

const CONFLICT_PLAN = plan(
  'plan_conflictbait',
  'goal_conflictbait',
  'Two tasks that both edit src/ui/render.ts. On purpose.',
  CONFLICT_TASKS,
  NOW - 9 * MIN,
);

const XL_PLAN = plan(
  'plan_launchdayxl',
  'goal_launchdayxl',
  'Ten changes: the launch-day seven plus undo/redo, stats and tag chips.',
  [...LAUNCH_TASKS, ...XL_EXTRA],
  NOW - 28 * MIN,
);

export function fixturePlan(goal: string): Plan {
  const text = goal.toLowerCase();
  if (text.includes('sort by due date')) return CONFLICT_PLAN;
  if (text.includes('dark mode')) return text.includes('undo') ? XL_PLAN : LAUNCH_PLAN;
  return QUICK_PLAN;
}

function metrics(overrides: Partial<RunMetrics>): RunMetrics {
  return { ...emptyMetrics(), ...overrides };
}

function taskRun(
  runId: string,
  key: string,
  status: TaskRun['status'],
  costUsd: number,
  extra: Partial<TaskRun> = {},
): TaskRun {
  return {
    runId,
    taskKey: key,
    status,
    attempts: status === 'failed' ? 3 : 1,
    usage: { input: 38_000, output: 5_400, cached: 6_000 },
    costUsd,
    ...extra,
    ...(status === 'merged' || status === 'failed' || status === 'conflict'
      ? { finishedAt: NOW - 5 * MIN }
      : {}),
  };
}

function goal(id: string, text: string, createdAt: number): Goal {
  return {
    id,
    text,
    repoPath: 'examples/sky-todo',
    baseBranch: 'main',
    createdAt,
    constraints: ['No new runtime dependencies'],
  };
}

function run(
  id: string,
  goalId: string,
  text: string,
  planValue: Plan,
  status: Run['status'],
  startedAt: number,
  finishedAt: number | undefined,
  costs: Record<string, [TaskRun['status'], number]>,
  metricsValue: Partial<RunMetrics>,
): Run {
  const tasks: Record<string, TaskRun> = {};
  for (const [key, [taskStatus, costUsd]] of Object.entries(costs)) {
    tasks[key] = taskRun(id, key, taskStatus, costUsd, { nodeId: key === 'dates-fix' ? 'air' : 'hub' });
  }
  return {
    id,
    goal: goal(goalId, text, startedAt),
    plan: planValue,
    tasks,
    status,
    integrationBranch: `starling/${id}/integration`,
    startedAt,
    ...(finishedAt === undefined ? {} : { finishedAt }),
    metrics: metrics(metricsValue),
  };
}

/** Three runs: a finished demo, a failed smoke test and one in flight. */
export const PLAYGROUND_RUNS: Run[] = [
  run(
    'run_launchday',
    'goal_launchday',
    'Add dark mode with a toggle, live search filtering, CSV export, keyboard shortcuts and fix the date bugs.',
    LAUNCH_PLAN,
    'finished',
    NOW - 28 * MIN,
    NOW - 3 * MIN,
    {
      theme: ['merged', 0.06],
      search: ['merged', 0.05],
      'csv-export': ['merged', 0.07],
      shortcuts: ['merged', 0.04],
      'help-overlay': ['merged', 0.05],
      'dates-fix': ['merged', 0.03],
      'due-badges': ['merged', 0.06],
    },
    {
      agentsActive: 0,
      tasksMerged: 7,
      apiCostUsd: 0.36,
      apiUsage: { input: 268_000, output: 38_000, cached: 44_000 },
      estSavedUsd: 0.02,
      elapsedMs: 25 * MIN,
    },
  ),
  run(
    'run_conflictbait',
    'goal_conflictbait',
    'Add a "Sort by due date" toggle and a "Delete all" button to the footer.',
    CONFLICT_PLAN,
    'running',
    NOW - 9 * MIN,
    undefined,
    {
      'date-sort': ['merged', 0.04],
      'delete-all': ['conflict', 0.03],
    },
    { agentsActive: 0, tasksMerged: 1, tasksFailed: 1, apiCostUsd: 0.07, elapsedMs: 9 * MIN },
  ),
  run(
    'run_quickwins',
    'goal_quickwins',
    'Show the open-task count in the tab title, show today in the header, and count distinct tags.',
    QUICK_PLAN,
    'failed',
    NOW - 2 * 60 * MIN,
    NOW - 116 * MIN,
    {
      'title-count': ['merged', 0.03],
      today: ['merged', 0.03],
      'tag-count': ['failed', 0.06],
    },
    { agentsActive: 0, tasksMerged: 2, tasksFailed: 1, apiCostUsd: 0.12, elapsedMs: 4 * MIN },
  ),
];

export const PLAYGROUND_RECENT_REPOS = [
  'examples/sky-todo',
  '../starling-demo/sky-todo',
  '/Users/moksh/Code/Internship-Prep/sky-todo',
];
