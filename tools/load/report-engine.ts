/** Shape and rendering of the engine load report (kept apart so tests can assert on it). */
import type { Run, StarlingEvent } from '../../packages/core/src/index.ts';
import type { MemoryReport } from './instrument.ts';
import type { LoadRig } from './rig.ts';
import { formatBytes, formatMs, renderTable, round, type Summary, summarise } from './stats.ts';

export interface EngineReport {
  generatedAt: string;
  mode: {
    tasks: number;
    maxParallel: number;
    eventsPerTask: number;
    replaySpeed: number;
    serialisedMerges: boolean;
    doubleRecord: boolean;
    retimeReplayEvents: boolean;
    sessionHeadroom: number;
    nodeMaxSessions: number;
    /** Highest number of replay sessions open at once (the node's own view). */
    peakSessions: number;
    testCommand?: string;
  };
  runId: string;
  status: string;
  wallMs: number;
  events: {
    total: number;
    agentEvents: number;
    perSecond: number;
    peakPerSecond: number;
    gap: Summary;
  };
  store: {
    append: Summary;
    flush: Summary;
    saveRun: Summary;
    read: Summary;
    appendCalls: number;
    savedRuns: number;
    readCalls: number;
    recordedEvents: number;
    dbBytes: number;
    /** Agent events whose `ts` predates the run: a `since` reconnect would drop them. */
    staleAgentEvents: number;
  };
  audit: { verdicts: number; passed: number; latency: Summary };
  merge: {
    merged: number;
    failed: number;
    conflict: number;
    other: number;
    /** merging → merge.result (queue wait + service). */
    latency: Summary;
    service: Summary;
    queueWait: Summary;
  };
  taskDurations: Summary;
  memory: MemoryReport;
  plan: { tasks: number; issues: number; errors: number; warnings: number };
  errors: string[];
}

export interface EngineReportInput {
  rig: LoadRig;
  run: Run;
  wallMs: number;
  dbBytes: number;
  memory: MemoryReport;
  options: {
    taskCount?: number;
    maxParallel?: number;
    replaySpeed?: number;
    eventsPerTask?: number;
    serialiseMerges?: boolean;
    doubleRecord?: boolean;
    retimeReplayEvents?: boolean;
  };
}

function peakPerSecond(receivedAt: readonly number[], bucketMs = 250): number {
  if (receivedAt.length === 0) return 0;
  const start = receivedAt[0] ?? 0;
  const buckets = new Map<number, number>();
  for (const at of receivedAt) {
    const bucket = Math.floor((at - start) / bucketMs);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  let peak = 0;
  for (const count of buckets.values()) peak = Math.max(peak, count);
  return (peak * 1_000) / bucketMs;
}

function gaps(receivedAt: readonly number[]): number[] {
  const out: number[] = [];
  for (let index = 1; index < receivedAt.length; index += 1) {
    const previous = receivedAt[index - 1];
    const current = receivedAt[index];
    if (previous !== undefined && current !== undefined) out.push(current - previous);
  }
  return out;
}

function taskDurations(rig: LoadRig, run: Run): number[] {
  const values: number[] = [];
  for (const [key, timing] of rig.timings) {
    const task = run.tasks[key];
    if (task === undefined) continue;
    const start = timing.readyAt ?? timing.runningAt;
    const end = timing.terminalAt;
    if (start !== undefined && end !== undefined) values.push(end - start);
  }
  return values;
}

export function createEngineReport(input: EngineReportInput): EngineReport {
  const { rig, run, wallMs } = input;
  const receivedAt = rig.events.receivedAt;
  const total = receivedAt.length;
  const statuses = Object.values(run.tasks).map((task) => task.status);
  const verdicts = Object.values(run.tasks).filter((task) => task.lastVerdict !== undefined);
  const storedEvents: StarlingEvent[] = rig.store.store.events(run.id);
  const staleAgentEvents = storedEvents.filter(
    (event) => event.type === 'agent.event' && event.ts < run.startedAt,
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    mode: {
      tasks: input.options.taskCount ?? 30,
      maxParallel: input.options.maxParallel ?? 20,
      eventsPerTask: input.options.eventsPerTask ?? 300,
      replaySpeed: input.options.replaySpeed ?? 4,
      serialisedMerges: input.options.serialiseMerges ?? true,
      doubleRecord: input.options.doubleRecord ?? false,
      retimeReplayEvents: rig.retimeReplayEvents,
      sessionHeadroom: rig.sessionHeadroom,
      nodeMaxSessions: rig.nodeMaxSessions,
      peakSessions: rig.peakSessions,
      ...(rig.testCommand === undefined ? {} : { testCommand: rig.testCommand }),
    },
    runId: run.id,
    status: run.status,
    wallMs: round(wallMs, 1),
    events: {
      total,
      agentEvents: rig.events.agentEvents,
      perSecond: round(total / (wallMs / 1_000), 1),
      peakPerSecond: round(peakPerSecond(receivedAt), 1),
      gap: summarise(gaps(receivedAt)),
    },
    store: {
      append: summarise(rig.store.samples.append),
      flush: summarise(rig.store.samples.flush),
      saveRun: summarise(rig.store.samples.save),
      read: summarise(rig.store.samples.readEvents),
      appendCalls: rig.store.samples.appendEvents,
      savedRuns: rig.store.samples.savedRuns,
      readCalls: rig.store.samples.readCalls,
      recordedEvents: storedEvents.length,
      dbBytes: input.dbBytes,
      staleAgentEvents,
    },
    audit: {
      verdicts: rig.auditMs.length,
      passed: verdicts.filter((task) => task.lastVerdict?.pass === true).length,
      latency: summarise(rig.auditMs),
    },
    merge: {
      merged: statuses.filter((status) => status === 'merged').length,
      failed: statuses.filter((status) => status === 'failed').length,
      conflict: statuses.filter((status) => status === 'conflict').length,
      other: statuses.filter((status) => status !== 'merged' && status !== 'failed' && status !== 'conflict')
        .length,
      latency: summarise(rig.mergeMs),
      service: summarise(rig.mergeServiceMs),
      queueWait: summarise(rig.mergeQueueWaitMs),
    },
    taskDurations: summarise(taskDurations(rig, run)),
    memory: input.memory,
    plan: {
      tasks: run.plan?.tasks.length ?? 0,
      issues: rig.issues.length,
      errors: rig.issues.filter((issue) => issue.severity === 'error').length,
      warnings: rig.issues.filter((issue) => issue.severity === 'warn').length,
    },
    errors: rig.events.errors.slice(0, 20),
  };
}

export function formatEngineTable(report: EngineReport): string {
  const merge = report.merge;
  const store = report.store;
  const events = report.events;
  const rows = [
    { label: 'wall time', values: [formatMs(report.wallMs)] },
    { label: 'tasks merged', values: [`${merge.merged}/${report.mode.tasks}`] },
    {
      label: 'tasks failed',
      values: [String(merge.failed + merge.conflict + merge.other)],
    },
    {
      label: 'sessions peak',
      values: [`${report.mode.peakSessions} (cap ${report.mode.nodeMaxSessions})`],
    },
    { label: 'events total', values: [String(events.total)] },
    { label: 'agent events', values: [String(events.agentEvents)] },
    { label: 'events/sec (mean)', values: [String(events.perSecond)] },
    { label: 'events/sec (peak 250ms)', values: [String(Math.round(events.peakPerSecond))] },
    {
      label: 'event gap',
      values: [
        formatMs(events.gap.p50Ms),
        formatMs(events.gap.p95Ms),
        formatMs(events.gap.p99Ms),
        formatMs(events.gap.maxMs),
      ],
    },
    {
      label: 'store append',
      values: [
        formatMs(store.append.p50Ms),
        formatMs(store.append.p95Ms),
        formatMs(store.append.p99Ms),
        formatMs(store.append.maxMs),
      ],
    },
    {
      label: 'sqlite flush (50ms)',
      values: [
        formatMs(store.flush.p50Ms),
        formatMs(store.flush.p95Ms),
        formatMs(store.flush.p99Ms),
        formatMs(store.flush.maxMs),
      ],
    },
    {
      label: 'saveRun',
      values: [
        formatMs(store.saveRun.p50Ms),
        formatMs(store.saveRun.p95Ms),
        formatMs(store.saveRun.p99Ms),
        formatMs(store.saveRun.maxMs),
      ],
    },
    {
      label: 'audit latency',
      values: [
        formatMs(report.audit.latency.p50Ms),
        formatMs(report.audit.latency.p95Ms),
        formatMs(report.audit.latency.p99Ms),
        formatMs(report.audit.latency.maxMs),
      ],
    },
    {
      label: 'merge latency',
      values: [
        formatMs(merge.latency.p50Ms),
        formatMs(merge.latency.p95Ms),
        formatMs(merge.latency.p99Ms),
        formatMs(merge.latency.maxMs),
      ],
    },
    {
      label: 'merge service',
      values: [
        formatMs(merge.service.p50Ms),
        formatMs(merge.service.p95Ms),
        formatMs(merge.service.p99Ms),
        formatMs(merge.service.maxMs),
      ],
    },
    {
      label: 'merge queue wait',
      values: [
        formatMs(merge.queueWait.p50Ms),
        formatMs(merge.queueWait.p95Ms),
        formatMs(merge.queueWait.p99Ms),
        formatMs(merge.queueWait.maxMs),
      ],
    },
    {
      label: 'task duration',
      values: [
        formatMs(report.taskDurations.p50Ms),
        formatMs(report.taskDurations.p95Ms),
        formatMs(report.taskDurations.p99Ms),
        formatMs(report.taskDurations.maxMs),
      ],
    },
    {
      label: 'recorded events',
      values: [`${store.recordedEvents} (${store.appendCalls} appends, ${store.staleAgentEvents} stale ts)`],
    },
    { label: 'sqlite file', values: [formatBytes(store.dbBytes)] },
    {
      label: 'memory peak',
      values: [`rss ${report.memory.peakRssMb}MB / heap ${report.memory.peakHeapUsedMb}MB`],
    },
    {
      label: 'plan',
      values: [`${report.plan.tasks} tasks, ${report.plan.errors} errors, ${report.plan.warnings} warnings`],
    },
  ];

  const header = renderTable(
    `Table 1 — engine + store + merge queue (${report.mode.tasks} tasks, maxParallel ${report.mode.maxParallel}, ` +
      `${report.mode.serialisedMerges ? 'queued' : 'raw'} merges)`,
    ['value', 'p50', 'p95', 'p99'],
    rows.map((row) => ({
      label: row.label,
      values: row.values.length === 4 ? row.values : [row.values[0] ?? '', '—', '—', '—'],
    })),
  );

  const errors =
    report.errors.length === 0
      ? ''
      : `\nEngine error logs (first ${report.errors.length}):\n${report.errors.map((msg) => `  · ${msg}`).join('\n')}`;
  return `${header}\n  test command: ${report.mode.testCommand ?? '(none detected)'} · run ${report.runId} · ${report.status}${errors}`;
}
