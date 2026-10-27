#!/usr/bin/env bun
import { startServer } from '../../apps/server/src/index.ts';
/**
 * Load test #2 — the real Hono server under 20 simulated dashboards.
 *
 * Starts `startServer` over the load rig, kicks the run off through `POST /api/runs`, attaches 20
 * SSE clients to `/api/runs/:id/events`, and measures live delivery latency, dropped/duplicated
 * frames and backlog drain. It also reconnects one client mid-run with `?since=<ts>` and checks the
 * backlog it receives is exactly the stored tail of the stream.
 *
 * ```sh
 * bun tools/load/sse.ts
 * bun tools/load/sse.ts --tasks 30 --parallel 20 --clients 20
 * ```
 */
import type { StarlingEvent } from '../../packages/core/src/index.ts';
import { startMemorySampler } from './instrument.ts';
import { numberArg, parseArgs, writeResult } from './results.ts';
import { createLoadRig, withTimeout } from './rig.ts';
import { formatMs, renderTable, round, type Summary, summarise } from './stats.ts';

export interface ClientResult {
  index: number;
  received: number;
  backlogEvents: number;
  liveEvents: number;
  missing: number;
  duplicates: number;
  firstByteMs: number;
  backlogDrainMs: number;
  sawFinished: boolean;
  errors: string[];
}

export interface SseReport {
  generatedAt: string;
  runId: string;
  status: string;
  tasksMerged: number;
  wallMs: number;
  clients: number;
  events: { stored: number; framesDelivered: number; expectedPerClient: number; perSecond: number };
  timestamps: {
    /** Agent events older than the run: a `since` reconnect would silently lose them. */
    staleAgentEvents: number;
    oldestAgentTs: number;
    newestTs: number;
  };
  liveLatency: Summary;
  backlog: { eventsPerClient: number; drainMs: Summary };
  drops: { missing: number; duplicates: number; clientsWithDrops: number; maxMissingPerClient: number };
  connection: { delayMs: Summary; liveEventsPerClient: number };
  since: {
    midRun: {
      sinceTs: number;
      expected: number;
      received: number;
      missing: number;
      duplicates: number;
      ok: boolean;
    };
    tail: {
      sinceTs: number;
      expected: number;
      received: number;
      missing: number;
      duplicates: number;
      ok: boolean;
      drainMs: number;
    };
    latency: Summary;
  };
  peakSessions: number;
  memory: { peakRssMb: number; peakHeapUsedMb: number };
  errors: string[];
}

export interface SseClientState {
  index: number;
  connectedAt: number;
  keys: Map<string, number>;
  received: number;
  backlogEvents: number;
  liveLatency: number[];
  firstByteMs: number;
  backlogDrainMs: number;
  sawFinished: boolean;
  finished: Promise<void>;
  resolveFinished: () => void;
  errors: string[];
  lastBacklogAt: number;
}

export function eventKey(event: StarlingEvent): string {
  const payload = event.payload as { taskKey?: string; sessionId?: string };
  const taskKey = payload.taskKey ?? '';
  const sessionId = payload.sessionId ?? '';
  return `${event.type}|${event.ts}|${taskKey}|${sessionId}`;
}

export function keyCounts(events: readonly StarlingEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = eventKey(event);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Multiset difference: how many expected keys the client never saw, and how many it saw twice. */
export function compareCounts(
  expected: Map<string, number>,
  actual: Map<string, number>,
): { missing: number; duplicates: number } {
  let missing = 0;
  for (const [key, count] of expected) missing += Math.max(0, count - (actual.get(key) ?? 0));
  let duplicates = 0;
  for (const [key, count] of actual) duplicates += Math.max(0, count - (expected.get(key) ?? 0));
  return { missing, duplicates };
}

export function createClientState(index: number): SseClientState {
  let resolveFinished: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  return {
    index,
    connectedAt: 0,
    keys: new Map(),
    received: 0,
    backlogEvents: 0,
    liveLatency: [],
    firstByteMs: 0,
    backlogDrainMs: 0,
    sawFinished: false,
    finished,
    resolveFinished,
    errors: [],
    lastBacklogAt: 0,
  };
}

function handleEvent(state: SseClientState, event: StarlingEvent, receivedAt: number): void {
  state.received += 1;
  const key = eventKey(event);
  state.keys.set(key, (state.keys.get(key) ?? 0) + 1);

  if (event.ts < state.connectedAt) {
    state.backlogEvents += 1;
    state.lastBacklogAt = receivedAt;
    state.backlogDrainMs = Math.max(0, receivedAt - state.connectedAt);
  } else {
    state.liveLatency.push(Math.max(0, receivedAt - event.ts));
  }

  if (event.type === 'run.finished' && !state.sawFinished) {
    state.sawFinished = true;
    state.resolveFinished();
  }
}

/** Consume one SSE stream until aborted (or the server closes it). */
export async function consumeSse(
  url: string,
  state: SseClientState,
  signal: AbortSignal,
  connectedAtWall: number = Date.now(),
): Promise<void> {
  const started = Date.now();
  const response = await fetch(url, {
    signal,
    headers: { accept: 'text/event-stream' },
  });
  if (!response.ok) throw new Error(`SSE ${url} answered ${response.status}`);
  if (response.body === null) throw new Error(`SSE ${url} had no body`);

  state.connectedAt = Math.max(connectedAtWall, Date.now());
  state.firstByteMs = Date.now() - started;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLines = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart());
        if (dataLines.length > 0) {
          const receivedAt = Date.now();
          try {
            handleEvent(state, JSON.parse(dataLines.join('\n')) as StarlingEvent, receivedAt);
          } catch (err) {
            state.errors.push(err instanceof Error ? err.message : String(err));
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } catch (err) {
    if (!signal.aborted) state.errors.push(err instanceof Error ? err.message : String(err));
  }
}

/** Start one client; the promise settles when the stream ends (abort or server close). */
export function openClient(url: string, state: SseClientState, signal: AbortSignal): Promise<void> {
  const connectedAt = Date.now();
  return consumeSse(url, state, signal, connectedAt);
}

export interface RunSseLoadOptions {
  taskCount?: number;
  maxParallel?: number;
  clients?: number;
  replaySpeed?: number;
  eventsPerTask?: number;
  /** Keep the recording's absolute timestamps instead of retiming (reproduces the `since` blind spot). */
  retimeReplayEvents?: boolean;
  timeoutMs?: number;
}

async function startRunThroughApi(
  baseUrl: string,
  params: { goal: string; repoPath: string; maxParallel: number },
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (response.status !== 201) {
    throw new Error(`POST /api/runs answered ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { runId: string };
  return body.runId;
}

export async function runSseLoadTest(options: RunSseLoadOptions = {}): Promise<SseReport> {
  const clientCount = options.clients ?? 20;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const rig = await createLoadRig({
    taskCount: options.taskCount ?? 30,
    maxParallel: options.maxParallel ?? 20,
    replaySpeed: options.replaySpeed ?? 4,
    eventsPerTask: options.eventsPerTask ?? 300,
    retimeReplayEvents: options.retimeReplayEvents ?? true,
  });
  const server = startServer(
    { engine: rig.engine, store: rig.store.store, bus: rig.bus, version: 'load' },
    { port: 0, hostname: '127.0.0.1' },
  );

  const memory = startMemorySampler(50);
  const controllers: AbortController[] = [];
  const clients: SseClientState[] = [];
  const consumerPromises: Promise<void>[] = [];
  const startedAt = performance.now();
  const errors: string[] = [];
  let sinceState: SseClientState | undefined;
  let sinceTs = 0;
  const runRequestedAt = Date.now();

  const abortAll = (): void => {
    for (const controller of controllers) controller.abort();
  };

  try {
    const runId = await startRunThroughApi(server.url, {
      goal: 'Load test: twenty dashboards watch a thirty-task swarm.',
      repoPath: rig.repo.repo,
      maxParallel: options.maxParallel ?? 20,
    });

    for (let index = 0; index < clientCount; index += 1) {
      const state = createClientState(index);
      const controller = new AbortController();
      controllers.push(controller);
      clients.push(state);
      consumerPromises.push(openClient(`${server.url}/api/runs/${runId}/events`, state, controller.signal));
    }

    // A reconnecting dashboard: it missed the start, so it asks for the tail with `since`.
    // Opened mid-run so the backlog is read while the engine is still writing.
    await Bun.sleep(1_000);
    sinceTs = Date.now() - 250;
    sinceState = createClientState(99);
    const sinceController = new AbortController();
    controllers.push(sinceController);
    consumerPromises.push(
      openClient(
        `${server.url}/api/runs/${runId}/events?since=${sinceTs}`,
        sinceState,
        sinceController.signal,
      ),
    );

    const finishedRun = await withTimeout(rig.finish(runId, timeoutMs), timeoutMs + 5_000, 'SSE run hung');

    // Give every client time to drain its backlog and see `run.finished`.
    const waits = [...clients, sinceState].map((state) =>
      withTimeout(state.finished, 30_000, `client ${state.index} never saw run.finished`).catch(
        (err: unknown) => {
          errors.push(err instanceof Error ? err.message : String(err));
        },
      ),
    );
    await Promise.all(waits);

    const stored = rig.store.store.events(runId);
    const expected = keyCounts(stored);

    // A second reconnect, after the run: a large `since` tail (everything after the first 500 ms)
    // read from the store while the server is otherwise idle. This is the reconnect a dashboard
    // does after a laptop sleeps; it must be complete and duplicate-free.
    const tailSince = finishedRun.startedAt + 500;
    const tailState = createClientState(100);
    const tailController = new AbortController();
    const tailStarted = performance.now();
    const tailPromise = openClient(
      `${server.url}/api/runs/${runId}/events?since=${tailSince}`,
      tailState,
      tailController.signal,
    );
    await withTimeout(tailState.finished, 30_000, 'tail since client never saw run.finished').catch(
      (err: unknown) => {
        errors.push(err instanceof Error ? err.message : String(err));
      },
    );
    const tailDrainMs = performance.now() - tailStarted;
    tailController.abort();
    await tailPromise.catch(() => undefined);
    controllers.push(tailController);

    const memoryReport = memory.stop();
    const wallMs = performance.now() - startedAt;

    let missing = 0;
    let duplicates = 0;
    let clientsWithDrops = 0;
    let maxMissingPerClient = 0;
    const results: ClientResult[] = [];
    for (const state of clients) {
      const diff = compareCounts(expected, state.keys);
      missing += diff.missing;
      duplicates += diff.duplicates;
      if (diff.missing > 0) clientsWithDrops += 1;
      maxMissingPerClient = Math.max(maxMissingPerClient, diff.missing);
      results.push({
        index: state.index,
        received: state.received,
        backlogEvents: state.backlogEvents,
        liveEvents: state.liveLatency.length,
        missing: diff.missing,
        duplicates: diff.duplicates,
        firstByteMs: round(state.firstByteMs, 1),
        backlogDrainMs: round(state.backlogDrainMs, 1),
        sawFinished: state.sawFinished,
        errors: state.errors,
      });
    }

    const liveLatency = summarise(clients.flatMap((state) => state.liveLatency));
    const target = stored.filter((event) => event.ts >= sinceTs);
    const sinceExpected = keyCounts(target);
    const sinceDiff =
      sinceState === undefined
        ? { missing: 0, duplicates: 0 }
        : compareCounts(sinceExpected, sinceState.keys);
    const agentEvents = stored.filter((event) => event.type === 'agent.event');
    const staleAgentEvents = agentEvents.filter((event) => event.ts < finishedRun.startedAt).length;
    const oldestAgentTs = agentEvents.reduce(
      (oldest, event) => Math.min(oldest, event.ts),
      Number.POSITIVE_INFINITY,
    );
    const tailTarget = stored.filter((event) => event.ts >= tailSince);
    const tailDiff = compareCounts(keyCounts(tailTarget), tailState.keys);
    for (const state of clients) errors.push(...state.errors);
    if (sinceState !== undefined) errors.push(...sinceState.errors);
    errors.push(...tailState.errors);

    return {
      generatedAt: new Date().toISOString(),
      runId,
      status: finishedRun.status,
      tasksMerged: Object.values(finishedRun.tasks).filter((task) => task.status === 'merged').length,
      wallMs: round(wallMs, 1),
      clients: clientCount,
      events: {
        stored: stored.length,
        framesDelivered: clients.reduce((sum, state) => sum + state.received, 0),
        expectedPerClient: stored.length,
        perSecond: round(stored.length / (wallMs / 1_000), 1),
      },
      timestamps: {
        staleAgentEvents,
        oldestAgentTs: Number.isFinite(oldestAgentTs) ? oldestAgentTs : 0,
        newestTs: stored.reduce((newest, event) => Math.max(newest, event.ts), 0),
      },
      liveLatency,
      backlog: {
        eventsPerClient: round(
          clients.reduce((sum, state) => sum + state.backlogEvents, 0) / Math.max(1, clients.length),
          1,
        ),
        drainMs: summarise(clients.map((state) => state.backlogDrainMs)),
      },
      drops: { missing, duplicates, clientsWithDrops, maxMissingPerClient },
      connection: {
        delayMs: summarise(clients.map((state) => state.connectedAt - runRequestedAt)),
        liveEventsPerClient: round(
          clients.reduce((sum, state) => sum + state.liveLatency.length, 0) / Math.max(1, clients.length),
          1,
        ),
      },
      since: {
        midRun: {
          sinceTs,
          expected: target.length,
          received: sinceState?.received ?? 0,
          missing: sinceDiff.missing,
          duplicates: sinceDiff.duplicates,
          ok:
            sinceDiff.missing === 0 &&
            sinceDiff.duplicates === 0 &&
            sinceState?.sawFinished === true &&
            staleAgentEvents === 0,
        },
        tail: {
          sinceTs: tailSince,
          expected: tailTarget.length,
          received: tailState.received,
          missing: tailDiff.missing,
          duplicates: tailDiff.duplicates,
          ok: tailDiff.missing === 0 && tailDiff.duplicates === 0 && tailState.sawFinished === true,
          drainMs: round(tailDrainMs, 1),
        },
        latency: summarise(sinceState?.liveLatency ?? []),
      },
      peakSessions: rig.peakSessions,
      memory: { peakRssMb: memoryReport.peakRssMb, peakHeapUsedMb: memoryReport.peakHeapUsedMb },
      errors: errors.slice(0, 10),
    };
  } finally {
    abortAll();
    await Promise.allSettled(consumerPromises);
    memory.stop();
    server.stop();
    await rig.dispose();
  }
}

export function formatSseTable(report: SseReport): string {
  const drops = report.drops;
  const since = report.since;
  const rows = [
    { label: 'wall time', values: [formatMs(report.wallMs)] },
    { label: 'tasks merged', values: [`${report.tasksMerged}`] },
    { label: 'sse clients', values: [`${report.clients} + 1 since`] },
    { label: 'events stored', values: [String(report.events.stored)] },
    {
      label: 'frames delivered',
      values: [`${report.events.framesDelivered} (${report.events.perSecond}/s)`],
    },
    { label: 'backlog/client', values: [String(report.backlog.eventsPerClient)] },
    {
      label: 'stale agent ts',
      values: [
        `${report.timestamps.staleAgentEvents} (oldest ${new Date(report.timestamps.oldestAgentTs).toISOString().slice(0, 10)})`,
      ],
    },
    {
      label: 'backlog drain',
      values: [
        formatMs(report.backlog.drainMs.p50Ms),
        formatMs(report.backlog.drainMs.p95Ms),
        formatMs(report.backlog.drainMs.maxMs),
        '—',
      ],
    },
    {
      label: 'live latency',
      values: [
        formatMs(report.liveLatency.p50Ms),
        formatMs(report.liveLatency.p95Ms),
        formatMs(report.liveLatency.p99Ms),
        formatMs(report.liveLatency.maxMs),
      ],
    },
    {
      label: 'since latency',
      values: [
        formatMs(since.latency.p50Ms),
        formatMs(since.latency.p95Ms),
        formatMs(since.latency.p99Ms),
        formatMs(since.latency.maxMs),
      ],
    },
    {
      label: 'connect delay',
      values: [
        formatMs(report.connection.delayMs.p50Ms),
        formatMs(report.connection.delayMs.p95Ms),
        '—',
        formatMs(report.connection.delayMs.maxMs),
      ],
    },
    { label: 'live/client', values: [String(report.connection.liveEventsPerClient)] },
    { label: 'dropped frames', values: [String(drops.missing)] },
    { label: 'duplicate frames', values: [String(drops.duplicates)] },
    { label: 'clients with drops', values: [String(drops.clientsWithDrops)] },
    {
      label: 'since mid-run',
      values: [`${since.midRun.received}/${since.midRun.expected}${since.midRun.ok ? ' ✓' : ' ✗'}`],
    },
    {
      label: 'since tail',
      values: [
        `${since.tail.received}/${since.tail.expected}${since.tail.ok ? ' ✓' : ' ✗'} in ${formatMs(since.tail.drainMs)}`,
      ],
    },
    { label: 'sessions peak', values: [String(report.peakSessions)] },
    {
      label: 'memory peak',
      values: [`rss ${report.memory.peakRssMb}MB / heap ${report.memory.peakHeapUsedMb}MB`],
    },
  ];

  const table = renderTable(
    `Table 2 — server + SSE (${report.clients} dashboards, ${report.events.expectedPerClient} events/stream)`,
    ['value', 'p50', 'p95', 'max'],
    rows,
  );
  const errorText =
    report.errors.length === 0
      ? ''
      : `\nStream errors (first ${report.errors.length}):\n${report.errors.map((msg) => `  · ${msg}`).join('\n')}`;
  return `${table}\n  run ${report.runId} · ${report.status} · since mid=${since.midRun.sinceTs} tail=${since.tail.sinceTs}${errorText}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const options: RunSseLoadOptions = {
    taskCount: numberArg(args, 'tasks', 30),
    maxParallel: numberArg(args, 'parallel', 20),
    clients: numberArg(args, 'clients', 20),
    replaySpeed: numberArg(args, 'speed', 4),
    eventsPerTask: numberArg(args, 'events', 300),
    retimeReplayEvents: !args.has('no-retime'),
  };
  console.log(`Starling SSE load test: ${options.clients} dashboards over a ${options.taskCount}-task run\n`);
  const report = await runSseLoadTest(options);
  console.log(formatSseTable(report));
  const path = await writeResult(options.retimeReplayEvents === false ? 'sse-no-retime' : 'sse', report);
  console.log(`\nJSON → ${path}`);
}

if (import.meta.main) await main();
