import { describe, expect, test } from 'bun:test';
import { toastsFromEvents } from './derive';
import {
  auditEvent,
  finishedEvent,
  logEvent,
  mergeEvent,
  metricsEvent,
  migratedEvent,
  node,
  nodeJoinedEvent,
  nodeLeftEvent,
  planEvent,
  run,
  TS,
} from './test-events';

const NO_NODES = {};

describe('toastsFromEvents: merge outcomes', () => {
  test('a merged task lands as a success toast', () => {
    const [toast] = toastsFromEvents([mergeEvent({ taskKey: 'dates-fix' })], { nodes: NO_NODES });
    expect(toast).toBeDefined();
    expect(toast?.kind).toBe('merged');
    expect(toast?.tone).toBe('success');
    expect(toast?.title).toBe('dates-fix landed');
    expect(toast?.taskKey).toBe('dates-fix');
    expect(toast?.id).toBe('merge.result:run-1:dates-fix:merged');
  });

  test('a conflict toast carries the detail and the conflicted files', () => {
    const [toast] = toastsFromEvents(
      [
        mergeEvent({
          taskKey: 'theme',
          status: 'conflict',
          conflictedFiles: ['src/app/App.tsx'],
          detail: 'Merge queue found overlapping changes',
        }),
      ],
      { nodes: NO_NODES },
    );
    expect(toast?.kind).toBe('conflict');
    expect(toast?.tone).toBe('danger');
    expect(toast?.title).toBe('theme hit a conflict');
    expect(toast?.body).toContain('overlapping changes');
    expect(toast?.body).toContain('src/app/App.tsx');
  });

  test('a tests-failed merge is a conflict toast with a suite-flavoured title', () => {
    const [toast] = toastsFromEvents(
      [mergeEvent({ taskKey: 'search', status: 'tests-failed', detail: 'bun test: 1 fail' })],
      { nodes: NO_NODES },
    );
    expect(toast?.kind).toBe('conflict');
    expect(toast?.title).toBe('search broke the suite');
    expect(toast?.body).toContain('1 fail');
  });

  test('a skipped merge is not worth a toast', () => {
    expect(
      toastsFromEvents([mergeEvent({ status: 'skipped', detail: 'nothing to merge' })], { nodes: NO_NODES }),
    ).toEqual([]);
  });
});

describe('toastsFromEvents: audits', () => {
  test('a failed audit names the first failing check', () => {
    const [toast] = toastsFromEvents(
      [
        auditEvent({
          taskKey: 'theme',
          attempt: 1,
          checks: [
            { name: 'lane', ok: true, detail: '' },
            { name: 'tests', ok: false, detail: '2 failing tests' },
            { name: 'definition-of-done', ok: false, detail: 'toggle not persisted' },
          ],
        }),
      ],
      { nodes: NO_NODES },
    );
    expect(toast?.kind).toBe('audit-failed');
    expect(toast?.tone).toBe('danger');
    expect(toast?.title).toBe('theme failed its audit');
    expect(toast?.body).toContain('tests');
    expect(toast?.id).toBe('audit.verdict:run-1:theme:1');
  });

  test('a passing audit is silent', () => {
    expect(toastsFromEvents([auditEvent({ pass: true, checks: [] })], { nodes: NO_NODES })).toEqual([]);
  });

  test('retries produce one toast per attempt, not one per replay', () => {
    const attempt1 = auditEvent({ attempt: 1 });
    const attempt2 = auditEvent({ attempt: 2, ts: TS + 1_000 });
    const toasts = toastsFromEvents([attempt1, attempt1, attempt2], { nodes: NO_NODES });
    expect(toasts.map((toast) => toast.id)).toEqual([
      'audit.verdict:run-1:theme:1',
      'audit.verdict:run-1:theme:2',
    ]);
  });
});

describe('toastsFromEvents: the flock', () => {
  test('a join uses the display name from state, not the payload copy', () => {
    const [toast] = toastsFromEvents([nodeJoinedEvent({ id: 'air', name: 'air' })], {
      nodes: { air: node({ name: 'MacBook Air' }) },
    });
    expect(toast?.kind).toBe('node-joined');
    expect(toast?.title).toBe('MacBook Air joined the flock');
    expect(toast?.body).toBe('Perch · 5 session slots');
  });

  test('a join falls back to the payload name when the roster has not caught up', () => {
    const [toast] = toastsFromEvents([nodeJoinedEvent({ id: 'm2', name: 'M2 Air' })], { nodes: NO_NODES });
    expect(toast?.title).toBe('M2 Air joined the flock');
  });

  test('a drop carries the reason and the node name', () => {
    const [toast] = toastsFromEvents([nodeLeftEvent('air', 'heartbeat lost for 15s (lid closed)')], {
      nodes: { air: node({ name: 'MacBook Air' }) },
    });
    expect(toast?.kind).toBe('node-left');
    expect(toast?.tone).toBe('warn');
    expect(toast?.title).toBe('MacBook Air left the flock');
    expect(toast?.body).toContain('lid closed');
  });

  test('a migration names the destination roost', () => {
    const [toast] = toastsFromEvents([migratedEvent({ taskKey: 'search', fromNode: 'air', toNode: 'hub' })], {
      nodes: { hub: node({ id: 'hub', name: 'MacBook Pro', kind: 'local' }), air: node() },
    });
    expect(toast?.kind).toBe('migrated');
    expect(toast?.title).toBe('search flew to MacBook Pro');
    expect(toast?.taskKey).toBe('search');
    expect(toast?.body).toBe('air went offline');
  });
});

describe('toastsFromEvents: logs and the run', () => {
  test('an error log is a toast; info and debug are not', () => {
    const error = logEvent('error', 'perch vanished');
    expect(toastsFromEvents([error], { nodes: NO_NODES })).toHaveLength(1);
    expect(
      toastsFromEvents([logEvent('info', 'all good'), logEvent('debug', 'tick')], { nodes: NO_NODES }),
    ).toEqual([]);
    const [toast] = toastsFromEvents([error], { nodes: NO_NODES });
    expect(toast?.kind).toBe('error');
    expect(toast?.title).toBe('perch vanished');
    expect(toast?.tone).toBe('danger');
  });

  test('two different errors keep both toasts', () => {
    const toasts = toastsFromEvents([logEvent('error', 'one', TS), logEvent('error', 'two', TS + 1)], {
      nodes: NO_NODES,
    });
    expect(toasts).toHaveLength(2);
    expect(toasts.map((toast) => toast.title)).toEqual(['one', 'two']);
  });

  test('a finished run uses the summary and turns dangerous when a task failed', () => {
    const [ok] = toastsFromEvents([finishedEvent({ status: 'finished' }, 'Seven tasks landed.')], {
      nodes: NO_NODES,
    });
    expect(ok?.kind).toBe('run-finished');
    expect(ok?.tone).toBe('success');
    expect(ok?.body).toBe('Seven tasks landed.');

    const [bad] = toastsFromEvents(
      [
        finishedEvent(
          { status: 'failed', metrics: { ...run().metrics, tasksFailed: 2 } },
          'Two tasks gave up.',
        ),
      ],
      { nodes: NO_NODES },
    );
    expect(bad?.tone).toBe('danger');
    expect(bad?.title).toBe('Run finished with failures');
  });
});

describe('toastsFromEvents: budget', () => {
  test('warns at 80 % of the cap', () => {
    const [toast] = toastsFromEvents([metricsEvent(0.85)], { nodes: NO_NODES, budgetUsd: 1 });
    expect(toast?.kind).toBe('budget');
    expect(toast?.tone).toBe('warn');
    expect(toast?.title).toBe('Budget running hot');
    expect(toast?.body).toContain('$0.85 of $1.00');
    expect(toast?.body).toContain('85%');
    expect(toast?.id).toBe('metrics:run-1:-:budget-80');
  });

  test('reports the cap as spent at 100 %, not both thresholds', () => {
    const toasts = toastsFromEvents([metricsEvent(1.2)], { nodes: NO_NODES, budgetUsd: 1 });
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.title).toBe('Budget spent');
    expect(toasts[0]?.tone).toBe('danger');
    expect(toasts[0]?.id).toBe('metrics:run-1:-:budget-100');
  });

  test('spend below the warn ratio, or no budget at all, is silent', () => {
    expect(toastsFromEvents([metricsEvent(0.2)], { nodes: NO_NODES, budgetUsd: 1 })).toEqual([]);
    expect(toastsFromEvents([metricsEvent(99)], { nodes: NO_NODES })).toEqual([]);
  });
});

describe('toastsFromEvents: noise control', () => {
  test('events that are not shoulder taps are ignored', () => {
    expect(toastsFromEvents([planEvent()], { nodes: NO_NODES })).toEqual([]);
    expect(toastsFromEvents([], { nodes: NO_NODES })).toEqual([]);
  });

  test('repeated joins of the same node dedupe within a batch', () => {
    const events = [nodeJoinedEvent({ id: 'air' }, TS), nodeJoinedEvent({ id: 'air' }, TS + 5_000)];
    expect(toastsFromEvents(events, { nodes: NO_NODES })).toHaveLength(1);
  });

  test('the result is chronological even when the batch is not', () => {
    const later = mergeEvent({ taskKey: 'b', ts: TS + 2_000 });
    const earlier = mergeEvent({ taskKey: 'a', ts: TS });
    const toasts = toastsFromEvents([later, earlier], { nodes: NO_NODES });
    expect(toasts.map((toast) => toast.taskKey)).toEqual(['a', 'b']);
  });
});
