import { describe, expect, test } from 'bun:test';
import {
  AgentEventSchema,
  AuditCheckSchema,
  AuditVerdictSchema,
  GoalSchema,
  LaneSchema,
  NodeInfoSchema,
  PlanSchema,
  RunSchema,
  StarlingEventSchema,
  StartTaskOptionsSchema,
  TaskRunSchema,
  TaskSpecSchema,
} from './contracts';
import {
  BASE_TS,
  makeAuditVerdict,
  makeGoal,
  makeNodeInfo,
  makePlan,
  makeRun,
  makeTaskSpec,
} from './testing/factories';

describe('contracts', () => {
  test('GoalSchema accepts a factory goal and rejects missing fields', () => {
    const goal = makeGoal();
    expect(GoalSchema.parse(goal)).toEqual(goal);
    expect(GoalSchema.safeParse({ ...goal, createdAt: undefined }).success).toBe(false);
  });

  test('LaneSchema / TaskSpecSchema / PlanSchema round-trip', () => {
    const lane = { owns: ['src/features/theme/**'], reads: ['src/main.ts'] };
    expect(LaneSchema.parse(lane)).toEqual(lane);
    const spec = makeTaskSpec();
    expect(TaskSpecSchema.parse(spec)).toEqual(spec);
    const plan = makePlan({ goalId: 'goal-1' });
    const parsed = PlanSchema.parse(plan);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0]?.lane.owns).toEqual(spec.lane.owns);
  });

  test('the seven-task sky-todo plan shape validates', () => {
    const plan = makePlan({
      goalId: 'goal-sky',
      tasks: Array.from({ length: 7 }, (_, i) =>
        makeTaskSpec({ key: `task-${i}`, lane: { owns: [`src/features/f${i}/**`], reads: [] } }),
      ),
    });
    expect(PlanSchema.parse(plan).tasks).toHaveLength(7);
  });

  test('RunSchema accepts a run with task runs and metrics', () => {
    const run = makeRun();
    const parsed = RunSchema.parse(run);
    expect(parsed.status).toBe('running');
    expect(Object.keys(parsed.tasks)).toEqual(['theme']);
  });

  test('TaskRunSchema allows optional runtime fields to be absent', () => {
    const run = makeRun();
    const task = run.tasks.theme;
    expect(task).toBeDefined();
    expect(task ? TaskRunSchema.parse(task).branch : undefined).toBeUndefined();
    expect(
      TaskRunSchema.safeParse({
        ...task,
        status: 'landed',
      }).success,
    ).toBe(false);
  });

  test('NodeInfoSchema validates the hub descriptor', () => {
    const info = makeNodeInfo();
    expect(NodeInfoSchema.parse(info).maxSessions).toBe(8);
    expect(NodeInfoSchema.safeParse({ ...info, status: 'sleepy' }).success).toBe(false);
  });

  test('AuditVerdictSchema accepts fail verdicts with fix instructions', () => {
    const verdict = makeAuditVerdict({ pass: false, fixInstructions: 'Add a test for toggle()' });
    expect(AuditVerdictSchema.parse(verdict).fixInstructions).toBe('Add a test for toggle()');
  });

  test('StarlingEventSchema parses each envelope shape', () => {
    const goal = makeGoal();
    const run = makeRun({ goal });
    const plan = makePlan({ goalId: goal.id });
    const events = [
      { type: 'run.created', runId: run.id, ts: BASE_TS, payload: { run } },
      { type: 'repomap.ready', runId: run.id, ts: BASE_TS, payload: { files: 4, tokenEstimate: 900 } },
      { type: 'plan.created', runId: run.id, ts: BASE_TS, payload: { plan, issues: [] } },
      {
        type: 'task.status',
        runId: run.id,
        ts: BASE_TS,
        payload: { taskKey: 'theme', from: 'pending', to: 'ready', run: run.tasks.theme },
      },
      {
        type: 'agent.event',
        runId: run.id,
        ts: BASE_TS,
        payload: {
          runId: run.id,
          taskKey: 'theme',
          sessionId: 'ses_1',
          ts: BASE_TS,
          kind: 'text',
          data: { text: 'hi' },
        },
      },
      { type: 'audit.verdict', runId: run.id, ts: BASE_TS, payload: makeAuditVerdict() },
      {
        type: 'merge.result',
        runId: run.id,
        ts: BASE_TS,
        payload: {
          taskKey: 'theme',
          status: 'merged',
          conflictedFiles: [],
          commit: 'abc',
          detail: 'ok',
          ts: BASE_TS,
        },
      },
      { type: 'metrics', runId: run.id, ts: BASE_TS, payload: run.metrics },
      { type: 'log', runId: run.id, ts: BASE_TS, payload: { level: 'info', msg: 'hello' } },
      { type: 'node.joined', runId: '*', ts: BASE_TS, payload: { node: makeNodeInfo() } },
      { type: 'node.left', runId: '*', ts: BASE_TS, payload: { nodeId: 'hub', reason: 'closed' } },
      { type: 'node.stats', runId: '*', ts: BASE_TS, payload: { node: makeNodeInfo() } },
      {
        type: 'task.migrated',
        runId: run.id,
        ts: BASE_TS,
        payload: { taskKey: 'theme', fromNode: 'air', toNode: 'hub', reason: 'offline' },
      },
      { type: 'run.finished', runId: run.id, ts: BASE_TS, payload: { run, summary: 'done' } },
    ];
    for (const event of events) {
      expect(StarlingEventSchema.safeParse(event).success).toBe(true);
    }
    expect(events).toHaveLength(14);
  });

  test('StarlingEventSchema rejects unknown event types and bad payloads', () => {
    expect(
      StarlingEventSchema.safeParse({ type: 'run.exploded', runId: 'r', ts: 1, payload: {} }).success,
    ).toBe(false);
    expect(
      StarlingEventSchema.safeParse({
        type: 'task.status',
        runId: 'r',
        ts: 1,
        payload: { taskKey: 'x', from: 'pending', to: 'teleporting', run: makeRun().tasks.theme },
      }).success,
    ).toBe(false);
  });

  test('StartTaskOptions accepts both local and bundle repos, rejects neither', () => {
    const base = {
      runId: 'r',
      taskKey: 'theme',
      title: 'Theme',
      fromRef: 'main',
      branch: 'starling/abc/theme',
      prompt: 'do it',
      model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
    };
    expect(
      StartTaskOptionsSchema.safeParse({ ...base, repo: { kind: 'local', path: '/tmp/x' } }).success,
    ).toBe(true);
    expect(
      StartTaskOptionsSchema.safeParse({
        ...base,
        repo: { kind: 'bundle', url: 'http://air:7778/bundle', token: 'ABCD' },
      }).success,
    ).toBe(true);
    expect(StartTaskOptionsSchema.safeParse({ ...base, repo: { kind: 'ftp' } }).success).toBe(false);
  });

  test('AgentEventSchema requires a known kind', () => {
    const event = {
      runId: 'r',
      taskKey: 'theme',
      sessionId: 's',
      ts: BASE_TS,
      kind: 'file.edited',
      data: { path: 'src/main.ts' },
    };
    expect(AgentEventSchema.parse(event).data.path).toBe('src/main.ts');
    expect(AgentEventSchema.safeParse({ ...event, kind: 'telepathy' }).success).toBe(false);
  });
});

describe('audit contracts (C1 additions)', () => {
  test('AuditCheckSchema carries an optional integer durationMs', () => {
    const base = { name: 'tests', ok: true, detail: 'exit 0' };
    expect(AuditCheckSchema.parse(base)).toEqual(base);
    expect(AuditCheckSchema.parse({ ...base, durationMs: 0 }).durationMs).toBe(0);
    expect(AuditCheckSchema.parse({ ...base, durationMs: 1234 }).durationMs).toBe(1234);
    expect(AuditCheckSchema.safeParse({ ...base, durationMs: -1 }).success).toBe(false);
    expect(AuditCheckSchema.safeParse({ ...base, durationMs: 1.5 }).success).toBe(false);
  });

  test('AuditVerdictSchema carries optional per-item DoD judgments', () => {
    const verdict = makeAuditVerdict();
    expect(AuditVerdictSchema.parse(verdict).dod).toBeUndefined();
    const withDod = AuditVerdictSchema.parse({
      ...verdict,
      dod: [
        { item: 'CSV export works', met: true, evidence: 'src/csv.ts:12' },
        { item: 'tests pass', met: false },
      ],
    });
    expect(withDod.dod).toEqual([
      { item: 'CSV export works', met: true, evidence: 'src/csv.ts:12' },
      { item: 'tests pass', met: false },
    ]);
    expect(AuditVerdictSchema.safeParse({ ...verdict, dod: [{ item: 'x' }] }).success).toBe(false);
  });

  test('a recorded audit.verdict event still validates with the new fields', () => {
    const verdict = makeAuditVerdict();
    const event = {
      type: 'audit.verdict',
      runId: 'run-1',
      ts: BASE_TS,
      payload: {
        ...verdict,
        checks: verdict.checks.map((check, index) => ({ ...check, durationMs: index })),
        dod: [{ item: 'done', met: true }],
      },
    };
    const parsed = StarlingEventSchema.parse(event);
    expect(parsed.type).toBe('audit.verdict');
  });
});

/**
 * Wave 2 (Epic 40) additive contracts: the C1 handbacks asked for `TaskRun.nodeName`, a run-level
 * status event, and two optional props. They are additive, so every old recorded run/event must
 * still parse.
 */
describe('wave 2 additions', () => {
  test('TaskRunSchema accepts an optional nodeName and keeps old runs valid', () => {
    const task = makeRun().tasks.t1 ?? Object.values(makeRun().tasks)[0];
    expect(task).toBeDefined();
    if (task === undefined) return;
    expect(TaskRunSchema.parse(task).nodeName).toBeUndefined();
    expect(TaskRunSchema.parse({ ...task, nodeName: "Moksh's MacBook Pro" }).nodeName).toBe(
      "Moksh's MacBook Pro",
    );
    expect(TaskRunSchema.safeParse({ ...task, nodeName: 7 }).success).toBe(false);
  });

  test('run.status is part of the event union and carries from/to plus a run snapshot', () => {
    const run = makeRun({ status: 'running' });
    const event = {
      type: 'run.status' as const,
      runId: run.id,
      ts: BASE_TS,
      payload: { from: 'planned' as const, to: 'running' as const, run },
    };
    const parsed = StarlingEventSchema.parse(event);
    expect(parsed.type).toBe('run.status');
    if (parsed.type !== 'run.status') return;
    expect(parsed.payload.from).toBe('planned');
    expect(parsed.payload.to).toBe('running');
    expect(parsed.payload.run.id).toBe(run.id);

    const bad = StarlingEventSchema.safeParse({
      ...event,
      payload: { ...event.payload, to: 'levitating' },
    });
    expect(bad.success).toBe(false);
  });
});
