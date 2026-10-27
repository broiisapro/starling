import { describe, expect, test } from 'bun:test';
import type {
  AuditVerdict,
  NodeInfo,
  Run,
  RunMetrics,
  StarlingEvent,
  TaskRun,
  TaskStatus,
  TokenUsage,
} from '@starling/core';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState, type SkyState } from '../../data/reducer';
import { buildFlightReport, taskTimings } from './derive';
import { tokenTotal } from './format';
import { nodeContributions } from './nodes';
import { MAX_STORY_BEATS, storyBeats } from './story';
import type { FlightReport } from './types';
import { notableVerdicts, verdictHeadline } from './verdicts';

const FIXTURE = applyEvents(createInitialState(), demoEvents());
const RUN_ID = '01jd2k7m3p4q5r6s7t8v9w0x1y';

function fixtureReport(): FlightReport {
  const report = buildFlightReport(FIXTURE);
  if (report === undefined) throw new Error('fixture report missing');
  return report;
}

const usage = (input = 0, output = 0, cached = 0): TokenUsage => ({ input, output, cached });

const metrics = (overrides: Partial<RunMetrics> = {}): RunMetrics => ({
  agentsActive: 0,
  tasksMerged: 0,
  tasksFailed: 0,
  apiUsage: usage(),
  localUsage: usage(),
  apiCostUsd: 0,
  localCallCount: 0,
  estSavedUsd: 0,
  elapsedMs: 0,
  ...overrides,
});

function task(runId: string, key: string, status: TaskStatus, extra: Partial<TaskRun> = {}): TaskRun {
  return {
    runId,
    taskKey: key,
    status,
    attempts: 0,
    usage: usage(),
    costUsd: 0,
    ...extra,
  };
}

function makeRun(id: string, tasks: Record<string, TaskRun>, overrides: Partial<Run> = {}): Run {
  return {
    id,
    goal: {
      id: `${id}-goal`,
      text: 'A test goal',
      repoPath: '/tmp/repo',
      baseBranch: 'main',
      createdAt: 1_000,
      constraints: [],
    },
    tasks,
    status: 'finished',
    startedAt: 1_000,
    metrics: metrics(),
    ...overrides,
  };
}

function stateWith(run: Run, extra: Partial<SkyState> = {}): SkyState {
  return {
    ...createInitialState(),
    runs: { [run.id]: run },
    activeRunId: run.id,
    ...extra,
  };
}

function verdict(overrides: Partial<AuditVerdict> = {}): AuditVerdict {
  return {
    taskKey: 'theme',
    attempt: 1,
    pass: false,
    checks: [{ name: 'tests', ok: false, detail: 'one failing test' }],
    laneViolations: [],
    summary: 'not good enough',
    fixInstructions: 'add a test',
    model: { provider: 'ollama', model: 'qwen3.6:35b-a3b' },
    ts: 2_000,
    ...overrides,
  };
}

const nodeInfo = (id: string, name: string): NodeInfo => ({
  id,
  name,
  kind: id === 'hub' ? 'local' : 'remote',
  platform: 'darwin',
  arch: 'arm64',
  cpuCores: 12,
  memGb: 32,
  maxSessions: 8,
  activeSessions: 0,
  localModels: [],
  status: 'online',
  lastSeen: 1_000,
});

function logEvent(runId: string, ts: number, msg: string): StarlingEvent {
  return { type: 'log', runId, ts, payload: { level: 'warn', msg } };
}

describe('the recorded launch-day fixture', () => {
  test('lands all seven tasks and derives the landed outcome', () => {
    const report = fixtureReport();
    expect(report.runId).toBe(RUN_ID);
    expect(report.outcome).toBe('landed');
    expect(report.status).toBe('finished');
    expect(report.tasks).toEqual({
      total: 7,
      merged: 7,
      failed: 0,
      conflict: 0,
      cancelled: 0,
      inFlight: 0,
    });
  });

  test('wall time is start to finish (356,000 ms)', () => {
    expect(fixtureReport().wallMs).toBe(356_000);
  });

  test('measured task flight sums to 400,300 ms inside a 245,000 ms window', () => {
    const run = FIXTURE.runs[RUN_ID];
    if (run === undefined) throw new Error('fixture run missing');
    expect(taskTimings(run)).toEqual({ measured: 7, flightMs: 400_300, windowMs: 245_000 });
  });

  test('serial time is overhead plus one-at-a-time work: 511,300 ms', () => {
    const report = fixtureReport();
    expect(report.flightWindowMs).toBe(245_000);
    expect(report.serialMs).toBe(511_300);
    expect(report.savedMs).toBe(155_300);
    expect(report.speedup).toBeCloseTo(1.44, 2);
  });

  test('money, local calls and tokens come from the finished run metrics', () => {
    const report = fixtureReport();
    expect(report.costUsd).toBeCloseTo(0.0422, 3);
    expect(report.savedUsd).toBeCloseTo(0.0185, 3);
    expect(report.localCalls).toBe(9);
    expect(report.tokens.api).toEqual({ input: 103_500, output: 16_050, cached: 27_600 });
    expect(report.tokens.local).toEqual({ input: 53_200, output: 6_560, cached: 18_000 });
    expect(report.estimated).toContain('serialMs');
    expect(report.estimated).not.toContain('planner-estimate');
  });

  test('the writer summary is read from run.finished', () => {
    const summary = fixtureReport().summary;
    expect(summary).toBeDefined();
    expect(summary).toContain('Seven tasks merged');
    expect(summary).toContain('local audits saved an estimated $0.019');
  });

  test("theme's failed attempt is paired with the passing attempt", () => {
    const report = fixtureReport();
    expect(report.verdicts).toHaveLength(1);
    const theme = report.verdicts[0];
    if (theme === undefined) throw new Error('verdict missing');
    expect(theme.taskKey).toBe('theme');
    expect(theme.attempt).toBe(1);
    expect(theme.pass).toBe(false);
    expect(theme.resolvedBy).toBe(2);
    expect(theme.checks.map((check) => check.name)).toEqual(['tests', 'lane', 'definition-of-done']);
    expect(theme.model).toEqual({ provider: 'ollama', model: 'qwen3.6:35b-a3b' });
    expect(verdictHeadline(theme)).toContain('failed attempt 1 (tests, definition-of-done)');
    expect(verdictHeadline(theme)).toContain('passed on attempt 2');
  });

  test('the search task migrated from the Air back to the hub', () => {
    const report = fixtureReport();
    const hub = report.nodes.find((node) => node.nodeId === 'hub');
    const air = report.nodes.find((node) => node.nodeId === 'air');
    expect(hub?.name).toBe('MacBook Pro');
    expect(hub?.migratedIn).toBe(1);
    expect(air?.migratedOut).toBe(1);
    expect(report.nodes.find((node) => node.nodeId === 'air')?.tasks).toBe(2);
    expect(FIXTURE.runs[RUN_ID]?.tasks.search?.nodeId).toBe('hub');
  });

  test('per-node contribution counts tasks, flight and spend', () => {
    const report = fixtureReport();
    const hub = report.nodes.find((node) => node.nodeId === 'hub');
    const air = report.nodes.find((node) => node.nodeId === 'air');
    expect(hub?.tasks).toBe(5);
    expect(hub?.merged).toBe(5);
    expect(hub?.flightMs).toBe(275_300);
    expect(air?.tasks).toBe(2);
    expect(air?.flightMs).toBe(125_000);
    const spend = report.nodes.reduce((sum, node) => sum + node.costUsd, 0);
    expect(spend).toBeCloseTo(report.costUsd, 6);
  });

  test('the story is chronological, capped and tells the migration', () => {
    const report = fixtureReport();
    expect(report.story.length).toBeLessThanOrEqual(MAX_STORY_BEATS);
    const times = report.story.map((beat) => beat.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(report.story[0]?.at).toBe(1_000);
    expect(report.story.at(-1)?.at).toBe(356_000);
    expect(report.story.at(-1)?.kind).toBe('finished');
    expect(report.story.some((beat) => beat.kind === 'repomap')).toBe(true);
    expect(report.story.some((beat) => beat.kind === 'plan' && beat.text.includes('7 tasks'))).toBe(true);
    expect(report.story.some((beat) => beat.kind === 'migrated' && beat.text.includes('MacBook Air'))).toBe(
      true,
    );
    expect(report.story.some((beat) => beat.kind === 'node.left' && beat.text.includes('lid closed'))).toBe(
      true,
    );
    expect(report.story.some((beat) => beat.text.startsWith('First landing'))).toBe(true);
    expect(report.story.some((beat) => beat.text.startsWith('Last landing'))).toBe(true);
  });
});

describe('falls back honestly when there is less data', () => {
  test('missing task timings fall back to the planner estimate and say so', () => {
    const run = makeRun(
      'run-plan',
      { alpha: task('run-plan', 'alpha', 'pending') },
      {
        status: 'planned',
        plan: {
          id: 'plan-1',
          goalId: 'run-plan-goal',
          summary: 'one task',
          tasks: [
            {
              key: 'alpha',
              title: 'Alpha',
              goal: 'do alpha',
              deliverables: [],
              outOfScope: [],
              definitionOfDone: ['it works'],
              dependsOn: [],
              lane: { owns: ['src/a/**'], reads: [] },
              estimateMin: 10,
            },
          ],
          lockedDecisions: [],
          model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
          createdAt: 1_000,
        },
      },
    );
    const report = buildFlightReport(stateWith(run), undefined, 61_000);
    expect(report?.serialMs).toBe(600_000);
    expect(report?.flightWindowMs).toBe(0);
    expect(report?.estimated).toContain('planner-estimate');
    expect(report?.wallMs).toBe(60_000);
  });

  test('no timings and no plan gives a zero estimate, not NaN', () => {
    const run = makeRun(
      'run-empty',
      { alpha: task('run-empty', 'alpha', 'pending') },
      {
        status: 'running',
      },
    );
    const report = buildFlightReport(stateWith(run), undefined, 2_000);
    expect(report?.serialMs).toBe(0);
    expect(report?.savedMs).toBe(-1_000);
    expect(report?.speedup).toBe(1);
    expect(report?.estimated).toContain('planner-estimate');
  });

  test('a failed/conflict run is a failed outcome with the right counts', () => {
    const run = makeRun('run-bad', {
      a: task('run-bad', 'a', 'failed'),
      b: task('run-bad', 'b', 'conflict'),
    });
    const report = buildFlightReport(stateWith(run), undefined, 61_000);
    expect(report?.outcome).toBe('failed');
    expect(report?.tasks.failed).toBe(1);
    expect(report?.tasks.conflict).toBe(1);
    expect(report?.tasks.inFlight).toBe(0);
  });

  test('a partly merged run is partial', () => {
    const run = makeRun('run-part', {
      a: task('run-part', 'a', 'merged'),
      b: task('run-part', 'b', 'failed'),
    });
    expect(buildFlightReport(stateWith(run), undefined, 61_000)?.outcome).toBe('partial');
  });

  test('a cancelled run is cancelled even with merged tasks', () => {
    const run = makeRun(
      'run-stop',
      { a: task('run-stop', 'a', 'merged'), b: task('run-stop', 'b', 'cancelled') },
      { status: 'cancelled' },
    );
    expect(buildFlightReport(stateWith(run), undefined, 61_000)?.outcome).toBe('cancelled');
  });

  test('an in-flight run uses the supplied clock and says so', () => {
    const run = makeRun(
      'run-live',
      {
        a: task('run-live', 'a', 'running', { startedAt: 1_500, nodeId: 'hub' }),
        b: task('run-live', 'b', 'pending'),
      },
      { status: 'running' },
    );
    const report = buildFlightReport(stateWith(run), undefined, 61_000);
    expect(report?.outcome).toBe('in-flight');
    expect(report?.wallMs).toBe(60_000);
    expect(report?.tasks.inFlight).toBe(2);
  });

  test('plan keys without a TaskRun still count towards the total', () => {
    const run = makeRun(
      'run-keys',
      { a: task('run-keys', 'a', 'merged') },
      {
        plan: {
          id: 'p',
          goalId: 'g',
          summary: '',
          tasks: [
            {
              key: 'a',
              title: 'A',
              goal: '',
              deliverables: [],
              outOfScope: [],
              definitionOfDone: [],
              dependsOn: [],
              lane: { owns: [], reads: [] },
              estimateMin: 1,
            },
            {
              key: 'b',
              title: 'B',
              goal: '',
              deliverables: [],
              outOfScope: [],
              definitionOfDone: [],
              dependsOn: [],
              lane: { owns: [], reads: [] },
              estimateMin: 1,
            },
          ],
          lockedDecisions: [],
          model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
          createdAt: 1_000,
        },
      },
    );
    const report = buildFlightReport(stateWith(run), undefined, 61_000);
    expect(report?.tasks.total).toBe(2);
    expect(report?.tasks.inFlight).toBe(1);
    expect(report?.outcome).toBe('partial');
  });

  test('a run with no verdicts has an empty verdict list', () => {
    const run = makeRun('run-quiet', { a: task('run-quiet', 'a', 'merged') });
    expect(buildFlightReport(stateWith(run), undefined, 61_000)?.verdicts).toEqual([]);
  });

  test('a run with no finished event has no summary', () => {
    const run = makeRun('run-mute', { a: task('run-mute', 'a', 'merged') });
    expect(buildFlightReport(stateWith(run), undefined, 61_000)?.summary).toBeUndefined();
  });

  test('verdicts keyed to a foreign run are ignored', () => {
    const run = makeRun('run-foreign', { a: task('run-foreign', 'a', 'merged') });
    const state = stateWith(run, { verdicts: { ghost: [verdict({ taskKey: 'ghost' })] } });
    expect(buildFlightReport(state, undefined, 61_000)?.verdicts).toEqual([]);
  });

  test('node names fall back to the node id when the registry is empty', () => {
    const run = makeRun('run-unknown', {
      a: task('run-unknown', 'a', 'merged', { nodeId: 'stranger' }),
    });
    const report = buildFlightReport(stateWith(run), undefined, 61_000);
    expect(report?.nodes[0]?.name).toBe('stranger');
    expect(report?.nodes[0]?.nodeId).toBe('stranger');
  });
});

describe('money sources and clocking', () => {
  test('an active run reads the newest metrics sample', () => {
    const run = makeRun(
      'run-live-money',
      { a: task('run-live-money', 'a', 'running') },
      {
        status: 'running',
        metrics: metrics({ apiCostUsd: 0 }),
      },
    );
    const state = stateWith(run, {
      metricsHistory: [
        {
          ts: 2_000,
          metrics: metrics({
            apiCostUsd: 1.5,
            estSavedUsd: 0.75,
            localCallCount: 4,
            apiUsage: usage(10, 5, 1),
            localUsage: usage(7, 3, 0),
          }),
        },
      ],
    });
    const report = buildFlightReport(state, undefined, 3_000);
    expect(report?.costUsd).toBe(1.5);
    expect(report?.savedUsd).toBe(0.75);
    expect(report?.localCalls).toBe(4);
    expect(report?.tokens.api).toEqual(usage(10, 5, 1));
  });

  test('a finished run ignores a stale metrics sample from another run', () => {
    const run = makeRun(
      'run-done-money',
      { a: task('run-done-money', 'a', 'merged') },
      {
        metrics: metrics({ apiCostUsd: 0.042 }),
      },
    );
    const state = stateWith(run, {
      metricsHistory: [{ ts: 2_000, metrics: metrics({ apiCostUsd: 99 }) }],
    });
    expect(buildFlightReport(state, undefined, 3_000)?.costUsd).toBe(0.042);
  });

  test('a specific run can be reported while another is active', () => {
    const older = makeRun('run-old', { a: task('run-old', 'a', 'failed') }, { startedAt: 1_000 });
    const newer = makeRun('run-new', { b: task('run-new', 'b', 'merged') }, { startedAt: 5_000 });
    const state: SkyState = {
      ...createInitialState(),
      runs: { 'run-old': older, 'run-new': newer },
      activeRunId: 'run-new',
    };
    const report = buildFlightReport(state, 'run-old', 9_000);
    expect(report?.runId).toBe('run-old');
    expect(report?.outcome).toBe('failed');
    expect(buildFlightReport(state, 'nope', 9_000)).toBeUndefined();
  });

  test('a token total is input plus output, never including cached', () => {
    expect(tokenTotal({ input: 100, output: 20, cached: 60 })).toBe(120);
  });
});

describe('story and verdict helpers', () => {
  test('story deduplicates identical beats', () => {
    const run = makeRun('run-quiet', { a: task('run-quiet', 'a', 'merged') }, { startedAt: 1_000 });
    const events: StarlingEvent[] = [
      { type: 'node.joined', runId: '*', ts: 1_100, payload: { node: nodeInfo('hub', 'MacBook Pro') } },
      { type: 'node.joined', runId: '*', ts: 1_150, payload: { node: nodeInfo('hub', 'MacBook Pro') } },
      { type: 'repomap.ready', runId: run.id, ts: 1_200, payload: { files: 3, tokenEstimate: 300 } },
    ];
    const beats = storyBeats(events, run, {});
    expect(beats.map((beat) => beat.kind)).toEqual(['node.joined', 'repomap']);
  });

  test('story caps at twelve beats, keeping the outcome and the plan', () => {
    const run = makeRun('run-noisy', { a: task('run-noisy', 'a', 'merged') }, { startedAt: 1_000 });
    const events: StarlingEvent[] = [
      { type: 'repomap.ready', runId: run.id, ts: 1_200, payload: { files: 3, tokenEstimate: 300 } },
      ...Array.from({ length: 20 }, (_, index) => logEvent(run.id, 1_300 + index, `warning ${index}`)),
      { type: 'run.finished', runId: run.id, ts: 2_000, payload: { run, summary: 'done' } },
    ];
    const beats = storyBeats(events, run, {});
    expect(beats.length).toBe(MAX_STORY_BEATS);
    expect(beats.some((beat) => beat.kind === 'finished')).toBe(true);
    expect(beats.some((beat) => beat.kind === 'repomap')).toBe(true);
    expect(beats.map((beat) => beat.at)).toEqual([...beats.map((beat) => beat.at)].sort((a, b) => a - b));
  });

  test('global flock events outside the run window are ignored', () => {
    const run = makeRun(
      'run-window',
      { a: task('run-window', 'a', 'merged') },
      {
        startedAt: 10_000,
        finishedAt: 20_000,
      },
    );
    const events: StarlingEvent[] = [
      { type: 'node.joined', runId: '*', ts: 1_000, payload: { node: nodeInfo('air', 'M2 Air') } },
      { type: 'node.left', runId: '*', ts: 30_000, payload: { nodeId: 'air', reason: 'later' } },
    ];
    const beats = storyBeats(events, run, { air: nodeInfo('air', 'M2 Air') });
    expect(beats).toEqual([]);
  });

  test('argued verdicts are paired by attempt and lane violations are notable', () => {
    const history = [
      verdict({ attempt: 1, pass: false, ts: 2_000 }),
      verdict({
        attempt: 2,
        pass: true,
        fixInstructions: undefined,
        checks: [{ name: 'tests', ok: true, detail: 'green' }],
        ts: 3_000,
      }),
    ];
    const notable = notableVerdicts({ theme: history }, ['theme']);
    expect(notable).toHaveLength(1);
    const first = notable[0];
    if (first === undefined) throw new Error('verdict missing');
    expect(first.resolvedBy).toBe(2);
    expect(verdictHeadline(first)).toBe('theme failed attempt 1 (tests), then passed on attempt 2');
  });

  test('a passing verdict with a lane violation stays notable', () => {
    const flagged = verdict({
      attempt: 1,
      pass: true,
      checks: [{ name: 'tests', ok: true, detail: 'green' }],
      laneViolations: ['src/outside/**'],
      fixInstructions: undefined,
    });
    const notable = notableVerdicts({ theme: [flagged] }, ['theme']);
    expect(notable).toHaveLength(1);
    const first = notable[0];
    if (first === undefined) throw new Error('verdict missing');
    expect(verdictHeadline(first)).toBe('theme passed attempt 1 (1 lane violation)');
  });

  test('a migration to a node with no tasks still earns a contribution row', () => {
    const run = makeRun('run-move', { a: task('run-move', 'a', 'merged', { nodeId: 'hub' }) });
    const events: StarlingEvent[] = [
      {
        type: 'task.migrated',
        runId: run.id,
        ts: 2_000,
        payload: { taskKey: 'a', fromNode: 'air', toNode: 'hub', reason: 'air left' },
      },
    ];
    const nodes = nodeContributions(run, events, {
      hub: nodeInfo('hub', 'Hub'),
      air: nodeInfo('air', 'Air'),
    });
    expect(nodes.map((node) => node.nodeId)).toEqual(['hub', 'air']);
    expect(nodes[0]?.migratedIn).toBe(1);
    expect(nodes[1]?.tasks).toBe(0);
    expect(nodes[1]?.migratedOut).toBe(1);
  });
});
