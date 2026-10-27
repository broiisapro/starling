/**
 * Test-data factories. Every mock defaults to these so a test only states what it cares about.
 */
import type { AgentEvent, AuditVerdict, Goal, NodeInfo, Plan, Run, TaskRun, TaskSpec } from '../contracts';
import { newId } from '../ids';
import { emptyMetrics, emptyUsage } from '../metrics';

/** A fixed, readable epoch (2023-11-14T22:13:20Z) so fixture snapshots stay stable. */
export const BASE_TS = 1_700_000_000_000;

export function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: newId(),
    text: 'Add dark mode with a toggle and fix the overdue-date calculation',
    repoPath: '/tmp/sky-todo',
    baseBranch: 'main',
    createdAt: BASE_TS,
    constraints: ['No new runtime dependencies'],
    ...overrides,
  };
}

export function makeTaskSpec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    key: 'theme',
    title: 'Dark mode with a toggle',
    goal: 'Add a dark theme and a toggle that persists the choice.',
    deliverables: ['src/features/theme/index.ts', 'Toggle wired into the header'],
    outOfScope: ['Changing the default light theme'],
    definitionOfDone: ['bun test passes', 'Toggling twice returns to light mode'],
    dependsOn: [],
    lane: { owns: ['src/features/theme/**', 'src/ui/styles.css'], reads: ['src/main.ts'] },
    estimateMin: 15,
    ...overrides,
  };
}

export function makePlan(overrides: Partial<Plan> = {}): Plan {
  const goalId = overrides.goalId ?? newId();
  const tasks = overrides.tasks ?? [makeTaskSpec()];
  return {
    id: newId(),
    summary: 'Three small, lane-disjoint changes.',
    lockedDecisions: ['Vanilla TypeScript, no framework'],
    model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
    createdAt: BASE_TS,
    ...overrides,
    goalId,
    tasks,
  };
}

export function makeTaskRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    runId: overrides.runId ?? newId(),
    taskKey: 'theme',
    status: 'pending',
    attempts: 0,
    usage: emptyUsage(),
    costUsd: 0,
    ...overrides,
  };
}

export function makeRun(overrides: Partial<Run> = {}): Run {
  const goal = overrides.goal ?? makeGoal();
  const plan = overrides.plan ?? makePlan({ goalId: goal.id });
  const tasks: Record<string, TaskRun> = overrides.tasks ?? {};
  if (overrides.tasks === undefined) {
    for (const task of plan.tasks) {
      tasks[task.key] = makeTaskRun({ runId: overrides.id ?? newId(), taskKey: task.key });
    }
  }
  return {
    id: newId(),
    status: 'running',
    startedAt: BASE_TS,
    metrics: emptyMetrics(),
    ...overrides,
    goal,
    plan,
    tasks,
  };
}

export function makeNodeInfo(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return {
    id: 'hub',
    name: 'MacBook Pro',
    kind: 'local',
    platform: 'darwin',
    arch: 'arm64',
    cpuCores: 12,
    memGb: 32,
    maxSessions: 8,
    activeSessions: 0,
    localModels: ['qwen3.6:35b-a3b'],
    status: 'online',
    lastSeen: BASE_TS,
    latencyMs: 2,
    ...overrides,
  };
}

export function makeAuditVerdict(overrides: Partial<AuditVerdict> = {}): AuditVerdict {
  return {
    taskKey: 'theme',
    attempt: 1,
    pass: true,
    checks: [{ name: 'tests', ok: true, detail: 'bun test: 12 pass' }],
    laneViolations: [],
    summary: 'Definition of done met.',
    model: { provider: 'ollama', model: 'qwen3.6:35b-a3b' },
    ts: BASE_TS,
    ...overrides,
  };
}

export function makeAgentEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    runId: newId(),
    taskKey: 'theme',
    sessionId: 'ses_mock_1',
    ts: BASE_TS,
    kind: 'text',
    data: { text: 'Looking at src/main.ts' },
    ...overrides,
  };
}
