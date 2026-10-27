import { describe, expect, test } from 'bun:test';
import { immediateScheduler, MockAuditor, MockNode, makeTaskSpec } from '@starling/core/testing';
import { buildHarness, smallPlan } from './testing/harness';
import { PatientNode } from './testing/nodes';

const STARTED = { kind: 'session.started' as const, data: {} };

const BUNDLE = {
  bundleUrlFor: (ref: string) => ({ url: `http://hub:7777/api/flock/bundle?ref=${ref}`, token: 'CODE' }),
};

describe('perch loss keeps attempts and the latest commit', () => {
  test('a task that already collected a commit resumes from its own branch', async () => {
    const air = new PatientNode({
      id: 'air',
      info: { kind: 'remote', name: 'M2 Air', maxSessions: 5 },
      schedule: immediateScheduler,
      events: [STARTED, { kind: 'session.idle', data: {} }],
    });
    const hub = new MockNode({ id: 'hub', schedule: immediateScheduler });
    let audits = 0;
    const audit = new MockAuditor({
      decorate: (verdict) => {
        audits += 1;
        if (audits === 1) {
          // The perch collected a commit, then vanished while the auditor was thinking.
          air.simulateDeath('lid closed');
          h.registry.remove('air');
        }
        return verdict;
      },
    });
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [hub, air],
      audit,
      scheduler: { pick: (nodes) => (nodes.some((n) => n.id === 'air') ? 'air' : 'hub') },
      ...BUNDLE,
    });

    const run = await h.finish();

    expect(run.tasks.a?.status).toBe('merged');
    expect(run.tasks.a?.nodeId).toBe('hub');
    // The first audit was discarded with the dead session; the second counts.
    expect(run.tasks.a?.attempts).toBe(1);
    expect(air.collected).toHaveLength(1);

    // The dispatch onto the hub starts at the task branch (the collected commit), not at integration.
    const resumed = hub.startedTasks[0];
    expect(resumed?.branch).toBe(run.tasks.a?.branch);
    expect(resumed?.fromRef).toBe(run.tasks.a?.branch);
    expect(resumed?.fromRef).not.toBe(run.integrationBranch);

    const loss = h.policyLogs('perch.loss');
    expect(loss).toHaveLength(1);
    expect(loss[0]?.msg).toContain('mock-node-co');
    const resume = h.policyLogs('perch.resume');
    expect(resume).toHaveLength(1);
    expect(resume[0]?.msg).toContain('resumes from');
  });

  test('without a collected commit, the rescheduled task starts from integration', async () => {
    const air = new PatientNode({
      id: 'air',
      info: { kind: 'remote', name: 'M2 Air', maxSessions: 5 },
      schedule: immediateScheduler,
      events: [STARTED],
    });
    const hub = new MockNode({ id: 'hub', schedule: immediateScheduler });
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [hub, air],
      scheduler: { pick: (nodes) => (nodes.some((n) => n.id === 'air') ? 'air' : 'hub') },
      ...BUNDLE,
    });

    const runId = await h.start();
    await waitForStarted(air);
    air.simulateDeath('lid closed');
    h.registry.remove('air');

    const run = await h.engine.waitForFinish(runId);
    expect(run.tasks.a?.status).toBe('merged');
    const resumed = hub.startedTasks[0];
    expect(resumed?.fromRef).toBe(run.integrationBranch);
    expect(h.policyLogs('perch.resume')).toHaveLength(0);
    expect(h.policyLogs('perch.loss')[0]?.msg).toContain('no commit had been collected');
  });
});

async function waitForStarted(node: MockNode): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (node.startedTasks.length === 0) {
    if (Date.now() > deadline) throw new Error('node never started the task');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
