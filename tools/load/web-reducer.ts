#!/usr/bin/env bun
import {
  AGENT_LOG_CAP,
  applyEvent,
  createInitialState,
  EVENT_CAP,
  MERGE_CAP,
  METRICS_CAP,
  type SkyState,
  VERDICT_CAP,
} from '../../apps/web/src/data/reducer.ts';
/**
 * Load test #3 — the dashboard reducer's hot path.
 *
 * Feeds 20 000 real `StarlingEvent`s through `applyEvent` from `apps/web/src/data/reducer.ts` and
 * measures ms/event plus the retention caps that keep a long live run from growing the tab heap.
 *
 * The reducer is pure, so this needs no DOM, no React and no server. It imports the web package's
 * source directly (read-only) because `tools/` is not a workspace package.
 *
 * ```sh
 * bun tools/load/web-reducer.ts
 * bun tools/load/web-reducer.ts --events 20000
 * ```
 */
import type {
  MergeResult,
  RunMetrics,
  StarlingEvent,
  TaskRun,
  TaskStatus,
} from '../../packages/core/src/index.ts';
import { emptyMetrics } from '../../packages/core/src/index.ts';
import {
  makeAgentEvent,
  makeAuditVerdict,
  makeGoal,
  makeNodeInfo,
  makePlan,
  makeRun,
  makeTaskRun,
} from '../../packages/core/src/testing/index.ts';
import { type MemorySnapshot, startMemorySampler } from './instrument.ts';
import { buildTaskSpecs } from './plan.ts';
import { numberArg, parseArgs, writeResult } from './results.ts';
import { formatBytes, formatMs, renderTable, round, type Summary, summarise } from './stats.ts';

export interface CapCheck {
  name: string;
  cap: number;
  actual: number;
  ok: boolean;
}

export interface ReducerReport {
  generatedAt: string;
  totalEvents: number;
  taskCount: number;
  wallMs: number;
  perEvent: Summary;
  msPerEvent: number;
  eventsPerSecond: number;
  mix: Record<string, number>;
  caps: {
    events: CapCheck;
    agentLog: CapCheck;
    verdicts: CapCheck;
    merges: CapCheck;
    metricsHistory: CapCheck;
    allOk: boolean;
  };
  state: {
    runs: number;
    tasks: number;
    agentLogEntries: number;
    agentLogMaxPerTask: number;
    verdictsMaxPerTask: number;
    merges: number;
    metricsHistory: number;
    jsonBytes: number;
  };
  memory: {
    before: MemorySnapshot;
    after: MemorySnapshot;
    peakRssMb: number;
    peakHeapUsedMb: number;
    heapDeltaMb: number;
  };
}

const AGENT_TASKS = 12;
const VERDICT_TASKS = 2;

/** Build a deterministic 20k-event stream that touches every reducer branch and every cap. */
export function buildReducerEvents(total = 20_000): StarlingEvent[] {
  const goal = makeGoal({ text: 'Load test the dashboard reducer with a thirty-task swarm.' });
  const plan = makePlan({ goalId: goal.id, tasks: buildTaskSpecs(30) });
  const run = makeRun({ id: 'load-run', goal, plan, status: 'running' });
  const events: StarlingEvent[] = [];
  const base = 1_700_000_000_000;

  events.push({ type: 'run.created', runId: run.id, ts: base, payload: { run } });
  events.push({
    type: 'plan.created',
    runId: run.id,
    ts: base + 1,
    payload: { plan, issues: [] },
  });

  const statuses: TaskStatus[] = ['ready', 'running', 'auditing', 'merging', 'merged'];
  const taskRuns = new Map<string, TaskRun>();
  for (const task of plan.tasks) {
    taskRuns.set(task.key, makeTaskRun({ runId: run.id, taskKey: task.key, status: 'pending', attempts: 0 }));
  }

  for (let sequence = 0; events.length < total - 1; sequence += 1) {
    const ts = base + 2 + sequence;
    const slot = sequence % 200;
    const task = plan.tasks[sequence % plan.tasks.length];
    if (task === undefined) break;

    if (slot < 145) {
      const agentTask = plan.tasks[sequence % AGENT_TASKS];
      if (agentTask === undefined) break;
      events.push({
        type: 'agent.event',
        runId: run.id,
        ts,
        payload: makeAgentEvent({
          runId: run.id,
          taskKey: agentTask.key,
          sessionId: `session-${agentTask.key}`,
          ts,
          kind: sequence % 7 === 0 ? 'tool.result' : 'text',
          data: { text: `event ${sequence}: a line of agent transcript with a realistic length.` },
        }),
      });
      continue;
    }

    if (slot < 151) {
      const verdictTask = plan.tasks[sequence % VERDICT_TASKS];
      if (verdictTask === undefined) break;
      events.push({
        type: 'audit.verdict',
        runId: run.id,
        ts,
        payload: makeAuditVerdict({
          taskKey: verdictTask.key,
          attempt: 1 + (sequence % 3),
          ts,
          pass: true,
        }),
      });
      continue;
    }

    if (slot < 158) {
      events.push({ type: 'merge.result', runId: run.id, ts, payload: mergeResult(task.key, ts) });
      continue;
    }

    if (slot < 188) {
      events.push({ type: 'metrics', runId: run.id, ts, payload: metrics(sequence, ts) });
      continue;
    }

    if (slot < 194) {
      const node = makeNodeInfo({ id: sequence % 2 === 0 ? 'hub' : 'perch-1', lastSeen: ts });
      events.push({
        type: sequence % 4 === 0 ? 'node.joined' : 'node.stats',
        runId: '*',
        ts,
        payload: { node },
      });
      continue;
    }

    if (slot < 197) {
      events.push({
        type: 'log',
        runId: run.id,
        ts,
        payload: { level: 'debug', msg: `log line ${sequence}`, taskKey: task.key },
      });
      continue;
    }

    const nextStatus = statuses[sequence % statuses.length] ?? 'running';
    const updated: TaskRun = {
      ...(taskRuns.get(task.key) ?? makeTaskRun({ runId: run.id, taskKey: task.key })),
      status: nextStatus,
      attempts: nextStatus === 'merged' ? 1 : 0,
    };
    taskRuns.set(task.key, updated);
    events.push({
      type: 'task.status',
      runId: run.id,
      ts,
      payload: { taskKey: task.key, from: 'running', to: nextStatus, run: updated },
    });
  }

  events.push({
    type: 'run.finished',
    runId: run.id,
    ts: base + total,
    payload: {
      run: { ...run, status: 'finished', finishedAt: base + total },
      summary: 'Load test finished: all 30 tasks merged.',
    },
  });
  return events.slice(0, total);
}

function mergeResult(taskKey: string, ts: number): MergeResult {
  return {
    taskKey,
    status: 'merged',
    conflictedFiles: [],
    commit: `sha-${ts}`,
    detail: 'Merged in the load test',
    ts,
  };
}

function metrics(sequence: number, ts: number): RunMetrics {
  return {
    ...emptyMetrics(),
    agentsActive: sequence % 20,
    tasksMerged: Math.min(30, Math.floor(sequence / 200)),
    apiUsage: { input: 1_000, output: 200, cached: 0 },
    apiCostUsd: 0.001,
    elapsedMs: ts - 1_700_000_000_000,
  };
}

export function maxPerTask<T>(record: Record<string, T[]>): number {
  return Object.values(record).reduce((max, list) => Math.max(max, list.length), 0);
}

/** Feed every event through the real reducer, timing each call. */
export function applyAll(events: readonly StarlingEvent[]): {
  state: SkyState;
  timings: number[];
  wallMs: number;
} {
  const started = performance.now();
  const timings: number[] = new Array(events.length);
  let state = createInitialState();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) continue;
    const eventStarted = performance.now();
    state = applyEvent(state, event);
    timings[index] = performance.now() - eventStarted;
  }
  return { state, timings, wallMs: performance.now() - started };
}

export function countMix(events: readonly StarlingEvent[]): Record<string, number> {
  const mix: Record<string, number> = {};
  for (const event of events) mix[event.type] = (mix[event.type] ?? 0) + 1;
  return mix;
}

export function runWebReducerTest(totalEvents = 20_000): ReducerReport {
  const events = buildReducerEvents(totalEvents);
  // Collect the previous script's state first, so "before" is a fair baseline when the load suite
  // runs all three scripts in one process.
  if (typeof Bun.gc === 'function') Bun.gc(true);
  const memory = startMemorySampler(10);
  const before = memory.snapshot();
  const { state, timings, wallMs } = applyAll(events);
  if (typeof Bun.gc === 'function') Bun.gc(true);
  const after = memory.snapshot();
  const memoryReport = memory.stop();

  const agentLogMaxPerTask = maxPerTask(state.agentLog);
  const verdictsMaxPerTask = maxPerTask(state.verdicts);
  const caps = {
    events: cap('events', EVENT_CAP, state.events.length),
    agentLog: cap('agentLog/task', AGENT_LOG_CAP, agentLogMaxPerTask),
    verdicts: cap('verdicts/task', VERDICT_CAP, verdictsMaxPerTask),
    merges: cap('merges', MERGE_CAP, state.merges.length),
    metricsHistory: cap('metricsHistory', METRICS_CAP, state.metricsHistory.length),
    allOk: false,
  };
  caps.allOk =
    caps.events.ok && caps.agentLog.ok && caps.verdicts.ok && caps.merges.ok && caps.metricsHistory.ok;

  return {
    generatedAt: new Date().toISOString(),
    totalEvents: events.length,
    taskCount: new Set(events.flatMap((event) => ('taskKey' in event.payload ? [event.payload.taskKey] : [])))
      .size,
    wallMs: round(wallMs, 1),
    perEvent: summarise(timings),
    msPerEvent: round(wallMs / Math.max(1, events.length), 4),
    eventsPerSecond: round(events.length / (wallMs / 1_000), 0),
    mix: countMix(events),
    caps,
    state: {
      runs: Object.keys(state.runs).length,
      tasks: Object.values(state.runs).reduce((sum, run) => sum + Object.keys(run.tasks).length, 0),
      agentLogEntries: Object.values(state.agentLog).reduce((sum, log) => sum + log.length, 0),
      agentLogMaxPerTask,
      verdictsMaxPerTask,
      merges: state.merges.length,
      metricsHistory: state.metricsHistory.length,
      jsonBytes: Buffer.byteLength(JSON.stringify(state), 'utf8'),
    },
    memory: {
      before,
      after,
      peakRssMb: memoryReport.peakRssMb,
      peakHeapUsedMb: memoryReport.peakHeapUsedMb,
      heapDeltaMb: round(after.heapUsedMb - before.heapUsedMb, 1),
    },
  };
}

function cap(name: string, limit: number, actual: number): CapCheck {
  return { name, cap: limit, actual, ok: actual <= limit };
}

export function formatReducerTable(report: ReducerReport): string {
  const caps = report.caps;
  const state = report.state;
  const rows = [
    { label: 'events applied', values: [String(report.totalEvents)] },
    { label: 'wall time', values: [formatMs(report.wallMs)] },
    {
      label: 'per event',
      values: [
        formatMs(report.perEvent.p50Ms),
        formatMs(report.perEvent.p95Ms),
        formatMs(report.perEvent.p99Ms),
        formatMs(report.perEvent.maxMs),
      ],
    },
    { label: 'events/sec', values: [String(report.eventsPerSecond)] },
    {
      label: 'state retained',
      values: [`${state.agentLogEntries} transcript lines in ${state.runs} run(s)`],
    },
    {
      label: 'cap events',
      values: [`${caps.events.actual}/${caps.events.cap} ${caps.events.ok ? '✓' : '✗'}`],
    },
    {
      label: 'cap agentLog/task',
      values: [`${caps.agentLog.actual}/${caps.agentLog.cap} ${caps.agentLog.ok ? '✓' : '✗'}`],
    },
    {
      label: 'cap verdicts/task',
      values: [`${caps.verdicts.actual}/${caps.verdicts.cap} ${caps.verdicts.ok ? '✓' : '✗'}`],
    },
    {
      label: 'cap merges',
      values: [`${caps.merges.actual}/${caps.merges.cap} ${caps.merges.ok ? '✓' : '✗'}`],
    },
    {
      label: 'cap metricsHistory',
      values: [
        `${caps.metricsHistory.actual}/${caps.metricsHistory.cap} ${caps.metricsHistory.ok ? '✓' : '✗'}`,
      ],
    },
    { label: 'state JSON', values: [formatBytes(state.jsonBytes)] },
    {
      label: 'heap delta',
      values: [`${report.memory.heapDeltaMb}MB (peak ${report.memory.peakHeapUsedMb}MB used)`],
    },
    { label: 'rss peak', values: [`${report.memory.peakRssMb}MB`] },
  ];

  const table = renderTable(
    `Table 3 — web reducer (${report.totalEvents} events, ${report.mix['agent.event'] ?? 0} agent)`,
    ['value', 'p50', 'p95', 'max'],
    rows.map((row) => ({
      label: row.label,
      values: row.values.length === 4 ? row.values : [row.values[0] ?? '', '—', '—', '—'],
    })),
  );
  return `${table}\n  caps all hold: ${caps.allOk ? 'yes' : 'NO'} · state ${formatBytes(state.jsonBytes)}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const total = numberArg(args, 'events', 20_000);
  console.log(`Starling web reducer load test: ${total} events\n`);
  const report = runWebReducerTest(total);
  console.log(formatReducerTable(report));
  const path = await writeResult('web-reducer', report);
  console.log(`\nJSON → ${path}`);
}

if (import.meta.main) await main();
