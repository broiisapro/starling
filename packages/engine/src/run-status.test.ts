import { describe, expect, test } from 'bun:test';
import type { Run } from '@starling/core';
import { emptyMetrics } from '@starling/core';
import { makeGoal, makePlan, makeTaskSpec } from '@starling/core/testing';
import { fromRefFor, nodeNameOf, nodeNamePatch, runStatusCandidates, runStatusEvent } from './run-status';

function sampleRun(): Run {
  return {
    id: 'run_1',
    goal: makeGoal(),
    plan: makePlan({ goalId: 'g', tasks: [makeTaskSpec({ key: 'a' })] }),
    tasks: {},
    status: 'running',
    startedAt: 1,
    metrics: emptyMetrics(),
  };
}

describe('run.status feature detection', () => {
  test('publishes nothing while core has no run.status arm', () => {
    const run = sampleRun();
    expect(runStatusEvent(run.id, 10, 'planned', run)).toBeUndefined();
  });

  test('picks the candidate shape the contract accepts', () => {
    const run = sampleRun();
    // A future core that only knows `{ status, run }` (the third candidate).
    const accepted = (event: unknown): boolean => {
      const payload = (event as { payload?: Record<string, unknown> }).payload ?? {};
      return Object.keys(payload).length === 2 && payload.status === 'running';
    };
    const built = runStatusEvent(run.id, 10, 'planned', run, accepted);
    expect(built).toBeDefined();
    expect(String(built?.type)).toBe('run.status');
    expect((built as unknown as { payload: unknown }).payload).toEqual({ status: 'running', run });
  });

  test('candidate order starts with the most descriptive shape', () => {
    const run = sampleRun();
    const candidates = runStatusCandidates(run.id, 10, 'planned', run);
    expect(candidates).toHaveLength(5);
    expect(candidates[0]?.payload).toEqual({ status: 'running', previous: 'planned', run });
    expect(candidates.every((candidate) => candidate.type === 'run.status')).toBe(true);
  });
});

describe('nodeName and resume refs', () => {
  test('nodeName rides along without touching the locked TaskRun shape', () => {
    const patch = nodeNamePatch({
      id: 'air',
      name: 'M2 Air',
      kind: 'remote',
      platform: 'darwin',
      arch: 'arm64',
      cpuCores: 8,
      memGb: 16,
      maxSessions: 5,
      activeSessions: 0,
      localModels: [],
      status: 'online',
      lastSeen: 1,
    });
    expect(patch).toEqual({ nodeName: 'M2 Air' });
    expect(nodeNameOf({ nodeName: 'M2 Air' } as unknown as Run['tasks'][string])).toBe('M2 Air');
    expect(nodeNameOf(undefined)).toBeUndefined();
  });

  test('a task with a collected commit resumes from its own branch', () => {
    const integration = 'starling/abc/integration';
    expect(fromRefFor({ branch: 'starling/abc/a' }, integration)).toBe(integration);
    expect(fromRefFor({ branch: 'starling/abc/a', commit: 'sha' }, integration)).toBe('starling/abc/a');
  });
});
