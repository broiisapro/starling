import type {
  AgentEvent,
  Goal,
  Plan,
  Run,
  RunMetrics,
  StarlingEvent,
  TaskRun,
  TaskSpec,
  TokenUsage,
} from '@starling/core/browser';
import { applyEvents, createInitialState, type SkyState } from '../../data/reducer';

/**
 * A small, hand-made run where the lanes are *not* clean: two tasks claim `src/ui/**`, one file is
 * edited by both, a merge conflicts on it, and an auditor flags a write outside its lane.
 *
 * The recorded launch-day run proves the happy path ("0 overlaps"); this fixture proves the warnings
 * the map exists to show. Used by the playground toggle and by the component tests.
 */

export const OVERLAP_RUN_ID = 'run-lanes-overlap';
const TS = 1_700_000_000_000;

const USAGE: TokenUsage = { input: 0, output: 0, cached: 0 };

const METRICS: RunMetrics = {
  agentsActive: 2,
  tasksMerged: 0,
  tasksFailed: 0,
  apiUsage: USAGE,
  localUsage: USAGE,
  apiCostUsd: 0,
  localCallCount: 0,
  estSavedUsd: 0,
  elapsedMs: 0,
};

const TASKS: TaskSpec[] = [
  {
    key: 'theme',
    title: 'Dark mode',
    goal: 'Add a dark theme.',
    deliverables: ['Theme module'],
    outOfScope: [],
    definitionOfDone: ['bun test passes'],
    dependsOn: [],
    lane: { owns: ['src/features/theme/**', 'src/ui/**'], reads: ['src/main.ts'] },
    estimateMin: 15,
  },
  {
    key: 'search',
    title: 'Live search',
    goal: 'Filter the list as you type.',
    deliverables: ['Search module'],
    outOfScope: [],
    definitionOfDone: ['bun test passes'],
    dependsOn: [],
    lane: { owns: ['src/features/search/**', 'src/ui/**'], reads: ['src/store/todos.ts'] },
    estimateMin: 15,
  },
  {
    key: 'csv',
    title: 'CSV export',
    goal: 'Export the list.',
    deliverables: ['Exporter'],
    outOfScope: [],
    definitionOfDone: ['bun test passes'],
    dependsOn: [],
    lane: { owns: ['src/lib/csv.ts'], reads: [] },
    estimateMin: 10,
  },
];

const GOAL: Goal = {
  id: 'goal-lanes-overlap',
  text: 'Dark mode, live search and CSV export',
  repoPath: 'examples/sky-todo',
  baseBranch: 'main',
  createdAt: TS,
  constraints: [],
};

const PLAN: Plan = {
  id: 'plan-lanes-overlap',
  goalId: GOAL.id,
  summary: 'Three tasks, two of which collide on src/ui.',
  tasks: TASKS,
  lockedDecisions: [],
  model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
  createdAt: TS,
};

function taskRun(taskKey: string): TaskRun {
  return {
    runId: OVERLAP_RUN_ID,
    taskKey,
    status: taskKey === 'csv' ? 'merged' : 'running',
    attempts: 1,
    usage: USAGE,
    costUsd: 0,
    startedAt: TS + 1_000,
  };
}

const RUN: Run = {
  id: OVERLAP_RUN_ID,
  goal: GOAL,
  plan: PLAN,
  tasks: {
    theme: taskRun('theme'),
    search: taskRun('search'),
    csv: taskRun('csv'),
  },
  status: 'running',
  integrationBranch: 'starling/lanes/integration',
  startedAt: TS,
  metrics: METRICS,
};

function edited(taskKey: string, path: string, added: number, removed: number, at: number): AgentEvent {
  return {
    runId: OVERLAP_RUN_ID,
    taskKey,
    sessionId: `ses_${taskKey}_${at}`,
    ts: TS + at,
    kind: 'file.edited',
    data: { path, added, removed },
  };
}

export function overlapScenarioEvents(): StarlingEvent[] {
  return [
    { type: 'run.created', runId: OVERLAP_RUN_ID, ts: TS, payload: { run: RUN } },
    {
      type: 'plan.created',
      runId: OVERLAP_RUN_ID,
      ts: TS + 10,
      payload: {
        plan: PLAN,
        issues: [
          {
            severity: 'warn',
            code: 'lane-overlap',
            message: 'theme and search both own src/ui/**',
            taskKeys: ['theme', 'search'],
          },
        ],
      },
    },
    {
      type: 'agent.event',
      runId: OVERLAP_RUN_ID,
      ts: TS + 20,
      payload: edited('theme', 'src/features/theme/index.ts', 50, 5, 20),
    },
    {
      type: 'agent.event',
      runId: OVERLAP_RUN_ID,
      ts: TS + 30,
      payload: edited('search', 'src/features/search/index.ts', 30, 2, 30),
    },
    {
      type: 'agent.event',
      runId: OVERLAP_RUN_ID,
      ts: TS + 40,
      payload: edited('theme', 'src/ui/styles.css', 20, 0, 40),
    },
    {
      type: 'agent.event',
      runId: OVERLAP_RUN_ID,
      ts: TS + 50,
      payload: edited('search', 'src/ui/styles.css', 4, 1, 50),
    },
    {
      type: 'agent.event',
      runId: OVERLAP_RUN_ID,
      ts: TS + 60,
      payload: edited('csv', 'src/lib/csv.ts', 24, 0, 60),
    },
    {
      type: 'agent.event',
      runId: OVERLAP_RUN_ID,
      ts: TS + 65,
      payload: edited('theme', 'src/lib/dates.ts', 7, 0, 65),
    },
    {
      type: 'audit.verdict',
      runId: OVERLAP_RUN_ID,
      ts: TS + 70,
      payload: {
        taskKey: 'theme',
        attempt: 1,
        pass: false,
        checks: [{ name: 'lane', ok: false, detail: 'wrote outside its lane' }],
        laneViolations: ['src/lib/dates.ts'],
        summary: 'Theme wrote into the search lane.',
        model: { provider: 'ollama', model: 'qwen3.6:35b-a3b' },
        ts: TS + 70,
      },
    },
    {
      type: 'merge.result',
      runId: OVERLAP_RUN_ID,
      ts: TS + 80,
      payload: {
        taskKey: 'theme',
        status: 'conflict',
        conflictedFiles: ['src/ui/styles.css'],
        detail: 'search also changed src/ui/styles.css',
        ts: TS + 80,
      },
    },
  ];
}

/** The fixture as the reducer would leave it, ready for `LanesView state={...}`. */
export function overlapScenarioState(): SkyState {
  return applyEvents(createInitialState(), overlapScenarioEvents());
}

export const OVERLAP_SUMMARY = '3 lanes · 1 overlap · 5 files touched · 1 conflict';
