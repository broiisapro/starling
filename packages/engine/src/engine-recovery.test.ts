import { describe, expect, test } from 'bun:test';
import type { Auditor, MergeResult } from '@starling/core';
import { immediateScheduler, MockAuditor, MockMerger, MockNode, makeTaskSpec } from '@starling/core/testing';
import { buildHarness, smallPlan } from './testing/harness';

const FIX_SEQUENCE = [
  'pending->ready',
  'ready->running',
  'running->auditing',
  'auditing->fixing',
  'fixing->auditing',
  'auditing->merging',
  'merging->merged',
];

describe('audit failure and the fix loop', () => {
  test('a failed audit sends an exact fix prompt and the retry passes', async () => {
    const audit = new MockAuditor({ script: { a: [false, true] } });
    const h = buildHarness({ plan: smallPlan([makeTaskSpec({ key: 'a' })]), audit });
    const run = await h.finish();

    expect(h.transitionsFor('a')).toEqual(FIX_SEQUENCE);
    expect(run.tasks.a?.attempts).toBe(2);
    expect(run.tasks.a?.lastVerdict?.pass).toBe(true);
    expect(run.tasks.a?.status).toBe('merged');

    const verdicts = h.ofType('audit.verdict').map((event) => event.payload);
    expect(verdicts.map((verdict) => verdict.pass)).toEqual([false, true]);
    expect(verdicts[0]?.fixInstructions).toContain('bun test');
    expect(h.ofType('merge.result')).toHaveLength(1);
  });

  test('the fixer prompt names the verdict instructions and the node gets it on the same session', async () => {
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      audit: new MockAuditor({ script: { a: [false, true] } }),
    });
    await h.finish();
    const node = h.nodes[0];
    expect(node?.prompts).toHaveLength(1);
    expect(node?.prompts[0]?.prompt).toStartWith('FIX a attempt 1');
    expect(h.prompts.calls.filter((call) => call.kind === 'fixer')).toHaveLength(1);
    // The retry reuses the same session: one start, one prompt.
    expect(node?.startedTasks).toHaveLength(1);
  });

  test('exhausting maxAttempts fails the task and cancels its dependents', async () => {
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' }), makeTaskSpec({ key: 'c', dependsOn: ['a'] })]),
      audit: new MockAuditor({ script: { a: false } }),
      config: { maxAttempts: 2 },
    });
    const run = await h.finish();

    expect(h.transitionsFor('a')).toEqual([
      'pending->ready',
      'ready->running',
      'running->auditing',
      'auditing->fixing',
      'fixing->auditing',
      'auditing->failed',
    ]);
    expect(h.transitionsFor('c')).toEqual(['pending->cancelled']);
    expect(run.tasks.a?.attempts).toBe(2);
    expect(run.tasks.c?.status).toBe('cancelled');
    expect(run.status).toBe('failed');
    expect(h.logs('error').some((msg) => msg.includes('failed the audit after 2 attempt(s)'))).toBe(true);
    expect(h.logs('warn').some((msg) => msg.includes('c cancelled because a will not merge'))).toBe(true);
  });

  test('untouched sibling tasks still merge when another branch fails', async () => {
    const h = buildHarness({
      plan: smallPlan([
        makeTaskSpec({ key: 'a' }),
        makeTaskSpec({ key: 'b' }),
        makeTaskSpec({ key: 'c', dependsOn: ['a'] }),
      ]),
      audit: new MockAuditor({ script: { a: false }, defaultPass: true }),
      config: { maxAttempts: 1 },
    });
    const run = await h.finish();
    expect(run.tasks.a?.status).toBe('failed');
    expect(run.tasks.b?.status).toBe('merged');
    expect(run.tasks.c?.status).toBe('cancelled');
    expect(run.status).toBe('finished');
    expect(run.metrics.tasksMerged).toBe(1);
    expect(run.metrics.tasksFailed).toBe(1);
  });

  test('an auditor that throws fails the task instead of wedging the run', async () => {
    const auditor: Auditor = {
      audit: async () => {
        throw new Error('judge unavailable');
      },
    };
    const h = buildHarness({ plan: smallPlan([makeTaskSpec({ key: 'a' })]), config: { maxAttempts: 3 } });
    h.deps.auditor = auditor;
    const engine = h.engine;
    const { runId } = await engine.start({ goal: 'g', repoPath: '/tmp/sky-todo' });
    const run = await engine.waitForFinish(runId);
    expect(run.tasks.a?.status).toBe('failed');
    expect(run.status).toBe('failed');
    expect(h.logs('error').some((msg) => msg.includes('auditor threw for a'))).toBe(true);
  });
});

describe('merge results', () => {
  function conflictMerge(taskKey: string): MergeResult {
    return {
      taskKey,
      status: 'conflict',
      conflictedFiles: ['src/shared.ts'],
      detail: 'CONFLICT in src/shared.ts',
      ts: 1_700_000_000_000,
    };
  }

  test('a merge conflict marks the task conflicted and cancels dependents', async () => {
    const merger = new MockMerger({ script: { a: [conflictMerge('a')] } });
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' }), makeTaskSpec({ key: 'c', dependsOn: ['a'] })]),
      merger,
    });
    const run = await h.finish();

    expect(h.transitionsFor('a')).toEqual([
      'pending->ready',
      'ready->running',
      'running->auditing',
      'auditing->merging',
      'merging->conflict',
    ]);
    expect(h.ofType('merge.result')[0]?.payload.conflictedFiles).toEqual(['src/shared.ts']);
    expect(run.tasks.c?.status).toBe('cancelled');
    expect(run.status).toBe('failed');
  });

  test('tests-failed feeds the merge evidence back into the fix loop', async () => {
    const merger = new MockMerger({
      script: {
        a: [
          {
            taskKey: 'a',
            status: 'tests-failed',
            conflictedFiles: [],
            detail: 'bun test: 2 failing in src/store/todos.test.ts',
            ts: 1,
          },
        ],
      },
    });
    const h = buildHarness({ plan: smallPlan([makeTaskSpec({ key: 'a' })]), merger });
    const run = await h.finish();

    expect(h.transitionsFor('a')).toEqual([
      'pending->ready',
      'ready->running',
      'running->auditing',
      'auditing->merging',
      'merging->fixing',
      'fixing->auditing',
      'auditing->merging',
      'merging->merged',
    ]);
    expect(run.tasks.a?.attempts).toBe(2);
    expect(h.ofType('merge.result')).toHaveLength(2);
    const fixPrompt = h.nodes[0]?.prompts[0]?.prompt ?? '';
    expect(fixPrompt).toContain('FIX a attempt 1');
    expect(fixPrompt).toContain('bun test: 2 failing');
    expect(h.prompts.calls.filter((call) => call.kind === 'fixer')).toHaveLength(1);
  });

  test('tests-failed with no attempts left fails without another fix prompt', async () => {
    const merger = new MockMerger({ defaultStatus: 'tests-failed' });
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      merger,
      config: { maxAttempts: 1 },
    });
    const run = await h.finish();
    expect(run.tasks.a?.status).toBe('failed');
    expect(h.nodes[0]?.prompts).toHaveLength(0);
    expect(h.logs('error').some((msg) => msg.includes('still fails the integration tests'))).toBe(true);
  });

  test('a merge error fails the task and keeps the run moving', async () => {
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' }), makeTaskSpec({ key: 'b' })]),
    });
    h.deps.merger = {
      merge: async () => {
        throw new Error('integration branch vanished');
      },
    };
    const { runId } = await h.engine.start({ goal: 'g', repoPath: '/tmp/sky-todo' });
    const run = await h.engine.waitForFinish(runId);
    expect(run.tasks.a?.status).toBe('failed');
    expect(run.tasks.b?.status).toBe('failed');
    expect(run.status).toBe('failed');
  });

  test('a skipped merge counts as landed with a warning', async () => {
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      merger: new MockMerger({ defaultStatus: 'skipped' }),
    });
    const run = await h.finish();
    expect(run.tasks.a?.status).toBe('merged');
    expect(run.status).toBe('finished');
    expect(h.logs('warn').some((msg) => msg.includes('nothing to merge'))).toBe(true);
  });
});

describe('agent errors', () => {
  test('session.error is logged as a warning and does not fail the task', async () => {
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [
        new MockNode({
          id: 'hub',
          info: { kind: 'local', maxSessions: 8 },
          schedule: immediateScheduler,
          events: (ctx) => [
            { kind: 'session.started', data: {} },
            { kind: 'session.error', data: { reason: `rate limited on ${ctx.taskKey}` } },
            { kind: 'usage', data: { input: 10, output: 5, cached: 0 } },
            { kind: 'session.idle', data: {} },
          ],
        }),
      ],
    });
    const run = await h.finish();
    expect(run.tasks.a?.status).toBe('merged');
    expect(h.logs('warn').some((msg) => msg.includes('rate limited on a'))).toBe(true);
    expect(run.tasks.a?.usage).toEqual({ input: 10, output: 5, cached: 0 });
  });
});
