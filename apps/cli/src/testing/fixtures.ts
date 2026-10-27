/**
 * Deterministic fixtures for CLI renderer and command tests.
 *
 * Not exported from `src/index.ts`: these are test support, not public API.
 */

import type { NodeInfo, Plan, Run, TaskRun } from '@starling/core';
import { emptyMetrics, emptyUsage } from '@starling/core';
import { BASE_TS, makeTaskSpec } from '@starling/core/testing';
import type { DoctorCheck, DoctorResult } from '../doctor';
import type { JoinInfo } from '../handshake';
import type { LiveState } from '../live-state';

export const PLAN: Plan = {
  id: '01jd2plan0000000000000000',
  goalId: '01jd2goal0000000000000000',
  summary: 'Three lane-disjoint tasks: theme, then search, then the help overlay.',
  tasks: [
    makeTaskSpec({
      key: 'theme',
      title: 'Dark mode with a toggle',
      goal: 'Add a dark theme and a toggle that persists the choice.',
      deliverables: ['src/features/theme/index.ts exports initTheme()'],
      outOfScope: ['Changing the default light theme'],
      definitionOfDone: ['bun test passes', 'The theme survives a reload'],
      dependsOn: [],
      lane: { owns: ['src/features/theme/**', 'src/ui/styles.css'], reads: ['src/main.ts'] },
      estimateMin: 15,
    }),
    makeTaskSpec({
      key: 'search',
      title: 'Live search filtering',
      goal: 'Filter the visible list as the user types.',
      deliverables: ['src/features/search/index.ts exports initSearch(store)'],
      outOfScope: ['Fuzzy matching'],
      definitionOfDone: ['bun test passes', 'Escape clears the query'],
      dependsOn: [],
      lane: { owns: ['src/features/search/**'], reads: ['src/store/todos.ts'] },
      estimateMin: 12,
    }),
    makeTaskSpec({
      key: 'help',
      title: 'Help overlay',
      goal: 'Show the shortcut help overlay.',
      deliverables: ['src/features/help/index.ts exports initHelpOverlay()'],
      outOfScope: ['A documentation site'],
      definitionOfDone: ['bun test passes', 'Backdrop click closes the overlay'],
      dependsOn: ['search'],
      lane: { owns: ['src/features/help/**'], reads: ['src/main.ts'] },
      estimateMin: 8,
    }),
  ],
  lockedDecisions: ['Vanilla TypeScript, no UI framework', 'Tests live beside their source'],
  model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
  createdAt: BASE_TS,
};

export const GOAL_TEXT = 'Add dark mode, live search and a help overlay';

export function taskRun(overrides: Partial<TaskRun> & { taskKey: string }): TaskRun {
  return {
    runId: '01jd2run00000000000000000',
    status: 'pending',
    attempts: 0,
    usage: emptyUsage(),
    costUsd: 0,
    ...overrides,
  };
}

export const RUN: Run = {
  id: '01jd2run00000000000000000',
  goal: {
    id: '01jd2goal0000000000000000',
    text: GOAL_TEXT,
    repoPath: 'examples/sky-todo',
    baseBranch: 'main',
    createdAt: BASE_TS,
    constraints: ['No new runtime dependencies'],
  },
  plan: PLAN,
  tasks: {
    theme: taskRun({
      taskKey: 'theme',
      status: 'merged',
      attempts: 1,
      nodeId: 'hub',
      branch: 'starling/000000/theme',
      startedAt: BASE_TS + 1000,
      finishedAt: BASE_TS + 31_000,
      usage: { input: 3000, output: 700, cached: 200 },
      costUsd: 0.0042,
      lastVerdict: {
        taskKey: 'theme',
        attempt: 1,
        pass: true,
        checks: [{ name: 'tests', ok: true, detail: 'bun test: 12 pass' }],
        laneViolations: [],
        summary: 'Definition of done met.',
        model: { provider: 'ollama', model: 'qwen3.6:35b-a3b' },
        ts: BASE_TS + 30_000,
      },
    }),
    search: taskRun({
      taskKey: 'search',
      status: 'running',
      attempts: 1,
      nodeId: 'm2-air',
      startedAt: BASE_TS + 32_000,
      usage: { input: 1200, output: 240, cached: 0 },
      costUsd: 0.0005,
    }),
    help: taskRun({ taskKey: 'help', status: 'pending' }),
  },
  status: 'running',
  integrationBranch: 'starling/000000/integration',
  startedAt: BASE_TS,
  metrics: {
    ...emptyMetrics(),
    agentsActive: 1,
    tasksMerged: 1,
    tasksFailed: 0,
    apiUsage: { input: 8000, output: 2000, cached: 1000 },
    localUsage: { input: 4000, output: 800, cached: 0 },
    apiCostUsd: 0.0123,
    localCallCount: 4,
    estSavedUsd: 0.0045,
    elapsedMs: 62_000,
  },
};

export const NODES: NodeInfo[] = [
  {
    id: 'hub',
    name: 'MacBook Pro',
    kind: 'local',
    platform: 'darwin',
    arch: 'arm64',
    cpuCores: 12,
    memGb: 32,
    maxSessions: 8,
    activeSessions: 1,
    localModels: ['qwen3.6:35b-a3b'],
    status: 'busy',
    lastSeen: BASE_TS + 62_000,
    latencyMs: 1,
  },
  {
    id: 'm2-air',
    name: 'MacBook Air',
    kind: 'remote',
    url: 'http://192.168.1.42:7778',
    platform: 'darwin',
    arch: 'arm64',
    cpuCores: 8,
    memGb: 16,
    maxSessions: 5,
    activeSessions: 1,
    localModels: [],
    status: 'busy',
    lastSeen: BASE_TS + 61_000,
    latencyMs: 18,
  },
];

export const JOIN: JoinInfo = {
  code: 'STAR-LING',
  hubUrl: 'http://localhost:7777',
  command: 'starling perch --hub http://localhost:7777 --code STAR-LING',
};

export function liveState(overrides: Partial<LiveState> = {}): LiveState {
  return {
    run: structuredClone(RUN),
    plan: PLAN,
    issues: [],
    nodes: structuredClone(NODES),
    lastActions: {
      theme: 'merged mock-theme-0000',
      search: 'read src/store/todos.ts',
      help: 'waiting for dependencies',
    },
    verdicts: [],
    merges: [
      {
        taskKey: 'theme',
        status: 'merged',
        conflictedFiles: [],
        commit: 'mock-theme-0000',
        detail: 'Merged theme',
        ts: BASE_TS + 31_000,
      },
    ],
    logs: ['plan ready: 3 tasks', 'MacBook Air joined the flock'],
    now: BASE_TS + 62_000,
    eventCount: 42,
    ...overrides,
  };
}

export const FINISHED_RUN: Run = {
  ...structuredClone(RUN),
  status: 'finished',
  finishedAt: BASE_TS + 372_000,
  metrics: {
    ...RUN.metrics,
    agentsActive: 0,
    tasksMerged: 3,
    elapsedMs: 372_000,
  },
  tasks: {
    theme: RUN.tasks.theme as TaskRun,
    search: { ...(RUN.tasks.search as TaskRun), status: 'merged', finishedAt: BASE_TS + 122_000 },
    help: {
      ...(RUN.tasks.help as TaskRun),
      status: 'merged',
      attempts: 1,
      nodeId: 'hub',
      startedAt: BASE_TS + 130_000,
      finishedAt: BASE_TS + 200_000,
    },
  },
};

export const DOCTOR_CHECKS: DoctorCheck[] = [
  { name: 'bun', status: 'ok', detail: '1.4.4 (needs ≥ 1.3)' },
  { name: 'git', status: 'ok', detail: '2.54.0 (needs ≥ 2.38)' },
  { name: 'opencode', status: 'ok', detail: 'opencode v2.1.2' },
  { name: 'deepseek', status: 'ok', detail: 'opencode-go/deepseek-v4.1-flash (any provider is fine)' },
  { name: 'gh', status: 'ok', detail: 'authenticated' },
  { name: 'config', status: 'ok', detail: 'defaults (no starling.config.yaml yet — run `starling init`)' },
  {
    name: 'ollama',
    status: 'warn',
    detail: 'not reachable at http://127.0.0.1:11434/api/tags (optional)',
    hint: 'ollama serve',
  },
  { name: 'ram', status: 'ok', detail: '12.0 GB free of 32 GB' },
];

export const DOCTOR_OK: DoctorResult = {
  checks: DOCTOR_CHECKS,
  ok: true,
  okCount: 7,
  failCount: 0,
  warnCount: 1,
};
