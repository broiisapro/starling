import type {
  AuditVerdict,
  Goal,
  MergeResult,
  NodeInfo,
  Run,
  RunMetrics,
  StarlingEvent,
} from '@starling/core/browser';

/**
 * Test-only event builders for the toast lane.
 *
 * The repo's `@starling/core/testing` factories cover plans, tasks and verdicts; event envelopes are
 * cheap literals and keeping them here means a test names exactly the field it is probing. This file
 * is never imported by production code.
 */
export const TS = 1_731_000_000_000;
export const RUN = 'run-1';
export const MODEL = { provider: 'ollama', model: 'qwen3.8:27b' } as const;

export function metrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    agentsActive: 0,
    tasksMerged: 0,
    tasksFailed: 0,
    apiUsage: { input: 0, output: 0, cached: 0 },
    localUsage: { input: 0, output: 0, cached: 0 },
    apiCostUsd: 0,
    localCallCount: 0,
    estSavedUsd: 0,
    elapsedMs: 0,
    ...overrides,
  };
}

export function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    text: 'Finish the demo',
    repoPath: '/tmp/sky-todo',
    baseBranch: 'main',
    createdAt: TS,
    constraints: [],
    ...overrides,
  };
}

export function run(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN,
    goal: goal(),
    tasks: {},
    status: 'running',
    startedAt: TS,
    metrics: metrics(),
    ...overrides,
  };
}

export function node(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return {
    id: 'air',
    name: 'MacBook Air',
    kind: 'remote',
    url: 'http://192.168.1.42:7778',
    platform: 'darwin',
    arch: 'arm64',
    cpuCores: 8,
    memGb: 16,
    maxSessions: 5,
    activeSessions: 0,
    localModels: [],
    status: 'online',
    lastSeen: TS,
    ...overrides,
  };
}

export function mergeEvent(overrides: Partial<MergeResult> = {}): StarlingEvent {
  const payload: MergeResult = {
    taskKey: 'dates-fix',
    status: 'merged',
    conflictedFiles: [],
    detail: 'Merged into integration; bun test 16 pass',
    commit: 'c0ffee001',
    ts: TS,
    ...overrides,
  };
  return { type: 'merge.result', runId: RUN, ts: payload.ts, payload };
}

export function auditEvent(overrides: Partial<AuditVerdict> = {}): StarlingEvent {
  const payload: AuditVerdict = {
    taskKey: 'theme',
    attempt: 1,
    pass: false,
    checks: [{ name: 'tests', ok: false, detail: '2 failing tests' }],
    laneViolations: [],
    summary: 'The theme toggle broke two tests',
    fixInstructions: 'Make the toggle persist',
    model: MODEL,
    ts: TS,
    ...overrides,
  };
  return { type: 'audit.verdict', runId: RUN, ts: payload.ts, payload };
}

export function nodeJoinedEvent(nodeOverrides: Partial<NodeInfo> = {}, ts = TS): StarlingEvent {
  return { type: 'node.joined', runId: '*', ts, payload: { node: node(nodeOverrides) } };
}

export function nodeLeftEvent(nodeId = 'air', reason = 'heartbeat lost for 15s', ts = TS): StarlingEvent {
  return { type: 'node.left', runId: '*', ts, payload: { nodeId, reason } };
}

export function migratedEvent(
  overrides: { taskKey?: string; fromNode?: string; toNode?: string; reason?: string; ts?: number } = {},
): StarlingEvent {
  const {
    taskKey = 'search',
    fromNode = 'air',
    toNode = 'hub',
    reason = 'air went offline',
    ts = TS,
  } = overrides;
  return { type: 'task.migrated', runId: RUN, ts, payload: { taskKey, fromNode, toNode, reason } };
}

export function logEvent(
  level: 'debug' | 'info' | 'warn' | 'error' = 'error',
  msg = 'provider hiccup',
  ts = TS,
  taskKey?: string,
): StarlingEvent {
  return {
    type: 'log',
    runId: RUN,
    ts,
    payload: { level, msg, ...(taskKey === undefined ? {} : { taskKey }) },
  };
}

export function metricsEvent(apiCostUsd: number, ts = TS): StarlingEvent {
  return { type: 'metrics', runId: RUN, ts, payload: metrics({ apiCostUsd }) };
}

export function finishedEvent(
  runOverrides: Partial<Run> = {},
  summary = 'Seven tasks landed.',
  ts = TS,
): StarlingEvent {
  return {
    type: 'run.finished',
    runId: RUN,
    ts,
    payload: { run: run({ status: 'finished', ...runOverrides }), summary },
  };
}

export function planEvent(ts = TS): StarlingEvent {
  return {
    type: 'repomap.ready',
    runId: RUN,
    ts,
    payload: { files: 42, tokenEstimate: 12_000 },
  };
}

/** A simple non-toast event, useful as a cursor baseline. */
export function tickEvent(ts = TS): StarlingEvent {
  return metricsEvent(0, ts);
}
