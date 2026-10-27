import { describe, expect, test } from 'bun:test';
import type { StarlingEvent, StarlingEventOf } from '@starling/core';
import { makeNodeInfo, makePlan, makeRun, makeTaskRun } from '@starling/core/testing';
import { createRunAccumulator, deriveRun, deriveRunState } from './derive';
import { importJsonl } from './jsonl';
import { FIXTURE_RECORDING, makeLogEvent } from './test-utils';

const fixture = importJsonl(FIXTURE_RECORDING);
const runId = '01jd2k7m3p4q5r6s7t8v9w0x1y';

describe('deriveRun', () => {
  test('folds the fixture into the same snapshot as its run.finished event', () => {
    const finished = fixture.find(
      (event): event is StarlingEventOf<'run.finished'> => event.type === 'run.finished',
    );
    expect(finished).toBeDefined();
    expect(deriveRun(fixture)).toEqual(finished?.payload.run);
  });

  test('the fixture story lands: 7 tasks, all merged, one fixed after a failed audit, one migrated', () => {
    const run = deriveRun(fixture);
    expect(run).toBeDefined();
    expect(run?.status).toBe('finished');
    expect(Object.keys(run?.tasks ?? {})).toHaveLength(7);
    expect(run?.tasks.theme?.status).toBe('merged');
    expect(Object.values(run?.tasks ?? {}).every((task) => task.status === 'merged')).toBe(true);

    // theme failed its first audit and was merged on attempt 1 (attempt 2 in verdict terms).
    const themeVerdicts = fixture
      .filter((event): event is StarlingEventOf<'audit.verdict'> => event.type === 'audit.verdict')
      .filter((event) => event.payload.taskKey === 'theme')
      .map((event) => event.payload);
    expect(themeVerdicts.map((verdict) => verdict.pass)).toEqual([false, true]);
    expect(run?.tasks.theme?.attempts).toBe(1);
    expect(run?.tasks.theme?.lastVerdict?.pass).toBe(true);

    // search was running on the Air when it went offline; it finished on the hub.
    expect(
      fixture.some((event) => event.type === 'task.migrated' && event.payload.taskKey === 'search'),
    ).toBe(true);
    expect(run?.tasks.search?.nodeId).toBe('hub');
    expect(run?.tasks.search?.status).toBe('merged');

    expect(run?.metrics.tasksMerged).toBe(7);
    expect(run?.metrics.tasksFailed).toBe(0);
    expect(run?.integrationBranch).toBe('starling/9w0x1y/integration');
    expect(run?.finishedAt).toBe(1731000356000);
  });

  test('deriveRunState reports the nodes seen and the Air coming back online', () => {
    const state = deriveRunState(fixture);
    expect(state.eventCount).toBe(252);
    expect(state.lastTs).toBe(1731000356000);
    expect(state.nodes.map((node) => node.id)).toEqual(['hub', 'air']);
    // The Air drops at 190 s and rejoins at 220 s, so the last-known state is online.
    expect(fixture.some((event) => event.type === 'node.left' && event.payload.nodeId === 'air')).toBe(true);
    expect(state.nodes.find((node) => node.id === 'air')?.status).toBe('online');
    expect(state.nodes.find((node) => node.id === 'air')?.lastSeen).toBe(1731000220000);
    expect(state.nodes.find((node) => node.id === 'hub')?.status).toBe('online');
  });

  test('node.left marks a node offline until a later node.stats says otherwise', () => {
    const node = makeNodeInfo({ id: 'air', status: 'busy', lastSeen: 100 });
    const events: StarlingEvent[] = [
      { type: 'node.joined', runId: '*', ts: 100, payload: { node } },
      { type: 'node.left', runId: '*', ts: 200, payload: { nodeId: 'air', reason: 'lid closed' } },
    ];
    const offline = deriveRunState(events);
    expect(offline.nodes[0]?.status).toBe('offline');
    expect(offline.nodes[0]?.lastSeen).toBe(200);

    const back = deriveRunState([
      ...events,
      {
        type: 'node.stats',
        runId: '*',
        ts: 300,
        payload: { node: { ...node, status: 'online', lastSeen: 300 } },
      },
    ]);
    expect(back.nodes[0]?.status).toBe('online');
  });

  test('returns undefined until a run snapshot appears', () => {
    expect(deriveRun([])).toBeUndefined();
    expect(deriveRun([makeLogEvent('r1', 1)])).toBeUndefined();
    expect(deriveRunState([]).nodes).toEqual([]);
  });

  test('infers the run lifecycle from plan and task events when there is no run.finished', () => {
    const run = makeRun({ id: 'live-run', status: 'mapping' });
    const plan = makePlan({ goalId: run.goal.id });
    const events: StarlingEvent[] = [
      { type: 'run.created', runId: run.id, ts: 1_000, payload: { run } },
      { type: 'plan.created', runId: run.id, ts: 1_100, payload: { plan, issues: [] } },
      {
        type: 'task.status',
        runId: run.id,
        ts: 1_200,
        payload: {
          taskKey: 'theme',
          from: 'pending',
          to: 'running',
          run: makeTaskRun({ runId: run.id, taskKey: 'theme', status: 'running' }),
        },
      },
      {
        type: 'metrics',
        runId: run.id,
        ts: 1_300,
        payload: { ...run.metrics, agentsActive: 1, elapsedMs: 300 },
      },
    ];

    const derived = deriveRun(events);
    expect(derived?.status).toBe('running');
    expect(derived?.plan?.id).toBe(plan.id);
    expect(derived?.tasks.theme?.status).toBe('running');
    expect(derived?.metrics.agentsActive).toBe(1);
  });

  test('applies audit verdicts, merge conflicts and migrations to the derived run', () => {
    const run = makeRun({ id: 'merge-run' });
    const events: StarlingEvent[] = [
      { type: 'run.created', runId: run.id, ts: 1, payload: { run } },
      {
        type: 'audit.verdict',
        runId: run.id,
        ts: 2,
        payload: {
          taskKey: 'theme',
          attempt: 1,
          pass: false,
          checks: [],
          laneViolations: [],
          summary: 'nope',
          model: { provider: 'ollama', model: 'qwen3.6:35b-a3b' },
          ts: 2,
        },
      },
      {
        type: 'merge.result',
        runId: run.id,
        ts: 3,
        payload: {
          taskKey: 'theme',
          status: 'conflict',
          conflictedFiles: ['src/ui/styles.css'],
          detail: '',
          ts: 3,
        },
      },
      {
        type: 'task.migrated',
        runId: run.id,
        ts: 4,
        payload: { taskKey: 'theme', fromNode: 'air', toNode: 'hub', reason: 'offline' },
      },
    ];

    const derived = deriveRun(events);
    expect(derived?.tasks.theme?.lastVerdict?.pass).toBe(false);
    expect(derived?.tasks.theme?.status).toBe('conflict');
    expect(derived?.tasks.theme?.nodeId).toBe('hub');
  });

  test('does not mutate the events it is given', () => {
    const before = JSON.stringify(fixture);
    const accumulator = createRunAccumulator(fixture);
    const state = accumulator.state();
    expect(JSON.stringify(fixture)).toBe(before);

    // Mutating a returned snapshot must not reach back into the accumulator.
    if (state.run === undefined) throw new Error('expected a derived run');
    state.run.status = 'cancelled';
    expect(accumulator.run()?.status).toBe('finished');
    expect(deriveRun(fixture)?.id).toBe(runId);
  });
});
