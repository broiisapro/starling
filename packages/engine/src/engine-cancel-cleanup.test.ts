import { describe, expect, test } from 'bun:test';
import { makeTaskSpec } from '@starling/core/testing';
import { buildHarness, smallPlan, waitFor } from './testing/harness';
import { PatientNode, WorktreeNode } from './testing/nodes';

const STARTED = [{ kind: 'session.started' as const, data: {} }];

describe('kill switch: cancel cleanup', () => {
  test('aborts every session, removes the worktree, keeps the branch and the store consistent', async () => {
    const node = new PatientNode({
      id: 'hub',
      info: { kind: 'local', maxSessions: 8 },
      events: STARTED,
    });
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [node],
      worktreePathFor: (branch) => `/mock/worktrees/${branch.replaceAll('/', '-')}`,
    });

    const runId = await h.start();
    await waitFor(() => node.startedTasks.length === 1);
    const branch = h.engine.getRun(runId)?.tasks.a?.branch;
    expect(branch).toBeDefined();

    await h.engine.cancel(runId);
    const run = await h.engine.waitForFinish(runId);

    expect(node.abortCalls).toHaveLength(1);
    expect(node.cleanupCalls).toBe(1);
    expect(h.workspace.removed).toEqual([`/mock/worktrees/${(branch ?? '').replaceAll('/', '-')}`]);
    // Removing a worktree must not remove the branch: the TaskRun still names it.
    expect(run.tasks.a?.branch).toBe(branch);
    expect(run.tasks.a?.status).toBe('cancelled');
    expect(run.status).toBe('cancelled');
    // The store agrees with the in-memory state.
    expect(h.store.getRun(runId)?.status).toBe('cancelled');
    expect(h.store.getRun(runId)?.tasks.a?.status).toBe('cancelled');
    expect(h.policyLogs('cancel.cleanup')).toHaveLength(1);
    expect(h.policyLogs('cancel.cleanup')[0]?.msg).toContain('removed 1 worktree');
    expect(h.ofType('run.finished')).toHaveLength(1);
  });

  test('a node-reported worktree path is preferred over the computed one', async () => {
    const node = new WorktreeNode({
      id: 'hub',
      info: { kind: 'local', maxSessions: 8 },
      events: STARTED,
      worktreePath: '/reported/by-the-node',
    });
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [node],
      worktreePathFor: () => '/computed/path',
    });

    const runId = await h.start();
    await waitFor(() => node.startedTasks.length === 1);
    await h.engine.cancel(runId);

    expect(h.workspace.removed).toEqual(['/reported/by-the-node']);
    expect(h.engine.getRun(runId)?.tasks.a?.worktreePath).toBeUndefined();
  });

  test('a second Ctrl-C takes the forced path and still settles the run', async () => {
    const node = new PatientNode({
      id: 'hub',
      info: { kind: 'local', maxSessions: 8 },
      events: STARTED,
    });
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' }), makeTaskSpec({ key: 'b', dependsOn: ['a'] })]),
      nodes: [node],
      worktreePathFor: () => '/computed/path',
    });
    const runId = await h.start();
    await waitFor(() => node.startedTasks.length === 1);

    const first = h.engine.cancel(runId);
    const second = h.engine.cancel(runId);
    await Promise.all([first, second]);
    const run = await h.engine.waitForFinish(runId);

    expect(h.policyLogs('cancel.forced')).toHaveLength(1);
    expect(run.status).toBe('cancelled');
    expect(Object.values(run.tasks).every((task) => task.status === 'cancelled')).toBe(true);
    expect(h.ofType('run.finished')).toHaveLength(1);
  });

  test('a worktree removal failure is logged and cancel still finishes', async () => {
    const node = new PatientNode({
      id: 'hub',
      info: { kind: 'local', maxSessions: 8 },
      events: STARTED,
    });
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [node],
      worktreePathFor: () => '/already/gone',
    });
    h.deps.workspace.remove = async () => {
      throw new Error('path is not a worktree');
    };

    const runId = await h.start();
    await waitFor(() => node.startedTasks.length === 1);
    await h.engine.cancel(runId);
    const run = await h.engine.waitForFinish(runId);

    expect(run.status).toBe('cancelled');
    expect(h.logs('warn').some((msg) => msg.includes('could not remove worktree'))).toBe(true);
  });
});
