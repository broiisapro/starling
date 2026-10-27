/**
 * Hand-made `Run`s for the shell-prompt tests.
 *
 * Not a `*.test.ts` file on purpose: the root suite runs every test file under `integrations/`, and a
 * helper must stay a helper. No network, no clock — every timestamp is explicit so the assertions can
 * be about the segment, not about how long the machine took.
 */
import type { Goal, Run, RunMetrics, RunStatus, TaskRun, TaskStatus } from '../../packages/core/src/index.ts';

export const T0 = 1_700_000_000_000;

export const EMPTY_USAGE = { input: 0, output: 0, cached: 0 };

export function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    text: 'ship the thing',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    createdAt: T0,
    constraints: [],
    ...overrides,
  };
}

export function makeMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    agentsActive: 0,
    tasksMerged: 0,
    tasksFailed: 0,
    apiUsage: EMPTY_USAGE,
    localUsage: EMPTY_USAGE,
    apiCostUsd: 0,
    localCallCount: 0,
    estSavedUsd: 0,
    elapsedMs: 0,
    ...overrides,
  };
}

export function makeTaskRun(status: TaskStatus, overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    runId: 'run-1',
    taskKey: 't01-thing',
    status,
    attempts: 0,
    usage: EMPTY_USAGE,
    costUsd: 0,
    ...overrides,
  };
}

export interface MakeRunInput {
  id?: string;
  status?: RunStatus;
  startedAt?: number;
  finishedAt?: number;
  /** Statuses in task-key order: `['merged', 'running']` → t01, t02. */
  taskStatuses?: TaskStatus[];
  tasks?: Record<string, TaskRun>;
}

export function makeRun(input: MakeRunInput = {}): Run {
  const id = input.id ?? 'run-1';
  const tasks: Record<string, TaskRun> = input.tasks ?? {};
  for (const [index, status] of (input.taskStatuses ?? []).entries()) {
    const key = `t${String(index + 1).padStart(2, '0')}`;
    tasks[key] = makeTaskRun(status, { runId: id, taskKey: key });
  }
  return {
    id,
    goal: makeGoal(),
    tasks,
    status: input.status ?? 'running',
    startedAt: input.startedAt ?? T0,
    finishedAt: input.finishedAt,
    metrics: makeMetrics(),
  };
}
