import type { Run, TaskRun, TaskSpec } from '@starling/core';
import {
  makeAuditVerdict,
  makeGoal,
  makePlan,
  makeRun,
  makeTaskRun,
  makeTaskSpec,
} from '@starling/core/testing';

export const RUN_ID = '01jd2k7m3p4q5r6s7t8v9w0x2z';
export const RUN_SHORT = '9w0x2z';
export const INTEGRATION = `starling/${RUN_SHORT}/integration`;
export const BASE = 'main';
export const REPO = 'acme/sky-todo';
export const CWD = '/tmp/sky-todo';

/** A fixed two-task run with one merged task (verdict) and one failed task (lane violation). */
export function scenarioRun(): Run {
  const theme = makeTaskSpec({
    key: 'theme',
    title: 'Dark mode with a toggle',
    goal: 'Add a dark theme and a toggle in the header that remembers the choice across reloads.',
    deliverables: [
      'src/features/theme/index.ts exports initTheme()',
      'The toggle persists the choice in localStorage',
    ],
    outOfScope: ["Do not change the light theme's default colours"],
    definitionOfDone: ['bun test passes', 'The theme survives a reload', 'The toggle has an aria-label'],
    dependsOn: [],
    lane: { owns: ['src/features/theme/**', 'src/ui/styles.css'], reads: ['src/main.ts', 'index.html'] },
    estimateMin: 15,
  });

  const search = makeTaskSpec({
    key: 'search',
    title: 'Live search filtering',
    goal: 'Filter the visible todo list as the user types, with a clear button and an empty state.',
    deliverables: [
      'src/features/search/index.ts exports initSearch(store)',
      "An empty state reads 'No matches'",
    ],
    outOfScope: ['Fuzzy matching or highlighting'],
    definitionOfDone: ['bun test passes', 'Typing filters on every keystroke', 'Escape clears the query'],
    dependsOn: ['theme'],
    lane: { owns: ['src/features/search/**'], reads: ['src/store/todos.ts', 'src/main.ts'] },
    estimateMin: 12,
  });

  const plan = makePlan({
    id: 'plan-1',
    goalId: 'goal-1',
    summary: 'Two lane-disjoint changes: a theme and a search filter.',
    tasks: [theme, search],
  });

  const run = makeRun({
    id: RUN_ID,
    goal: makeGoal({
      id: 'goal-1',
      text: 'Add dark mode and live search to sky-todo',
      repoPath: CWD,
      baseBranch: BASE,
    }),
    plan,
    integrationBranch: INTEGRATION,
    metrics: {
      agentsActive: 0,
      tasksMerged: 1,
      tasksFailed: 1,
      apiUsage: { input: 1700, output: 460, cached: 200 },
      localUsage: { input: 9000, output: 1200, cached: 0 },
      apiCostUsd: 0.00052,
      localCallCount: 6,
      estSavedUsd: 0.0034,
      elapsedMs: 754_000,
    },
  });

  run.tasks.theme = makeTaskRun({
    runId: RUN_ID,
    taskKey: 'theme',
    status: 'merged',
    branch: `starling/${RUN_SHORT}/theme`,
    worktreePath: '/tmp/starling-worktrees/theme',
    attempts: 2,
    usage: { input: 1200, output: 340, cached: 200 },
    costUsd: 0.00042,
    issueNumber: 100,
    prUrl: 'https://github.com/acme/sky-todo/pull/1',
    lastVerdict: makeAuditVerdict({
      taskKey: 'theme',
      attempt: 2,
      pass: true,
      checks: [
        { name: 'tests', ok: true, detail: 'bun test: 14 pass' },
        { name: 'lane', ok: true, detail: 'no violations' },
      ],
      laneViolations: [],
      summary: 'Definition of done met on the second attempt.',
    }),
  });

  run.tasks.search = makeTaskRun({
    runId: RUN_ID,
    taskKey: 'search',
    status: 'failed',
    branch: `starling/${RUN_SHORT}/search`,
    worktreePath: '/tmp/starling-worktrees/search',
    attempts: 3,
    usage: { input: 500, output: 120, cached: 0 },
    costUsd: 0.0001,
    issueNumber: 101,
    lastVerdict: makeAuditVerdict({
      taskKey: 'search',
      attempt: 3,
      pass: false,
      checks: [
        { name: 'tests', ok: false, detail: 'bun test: 2 fail' },
        { name: 'lane', ok: false, detail: 'wrote outside the lane' },
      ],
      laneViolations: ['src/store/todos.ts'],
      summary: 'Search mutates the store instead of reading visibleTodos.',
      fixInstructions: 'Use store.visibleTodos(query) rather than filtering todos in place.',
    }),
  });

  return run;
}

export function taskOf(run: Run, key: string): TaskSpec {
  const spec = run.plan?.tasks.find((task) => task.key === key);
  if (spec === undefined) throw new Error(`scenario has no task ${key}`);
  return spec;
}

export function taskRunOf(run: Run, key: string): TaskRun {
  const task = run.tasks[key];
  if (task === undefined) throw new Error(`scenario has no task run ${key}`);
  return task;
}

/** Exactly the block a worker prints last (ARCHITECTURE §8). */
export const HANDBACK_BLOCK = `<<<STARLING_HANDBACK
{"status":"complete","summary":"Theme toggles and persists across reloads.","filesChanged":["src/features/theme/index.ts"],"testsAdded":["src/features/theme/index.test.ts"],"notes":"Used a data-theme attribute."}
STARLING_HANDBACK>>>`;
