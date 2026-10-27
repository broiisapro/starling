import { describe, expect, test } from 'bun:test';
import {
  AgentEventSchema,
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
