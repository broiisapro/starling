import { describe, expect, test } from 'bun:test';
import type { MergeResult } from '../contracts';
import type { AuditInput } from '../ports';
import { makePlan, makeRun, makeTaskRun, makeTaskSpec } from './factories';
import { MockAuditor, MockMerger } from './mock-auditor';
import { makeRepoMap } from './mock-repomap';

function auditInput(
  taskKey: string,
  attempt: number,
  changedFiles = ['src/features/theme/index.ts'],
): AuditInput {
  const task = makeTaskSpec({ key: taskKey });
  const ctx = {
    goal: makeRun().goal,
    plan: makePlan({ tasks: [task] }),
    map: makeRepoMap(),
    task,
    branch: `starling/abc/${taskKey}`,
    testCommand: 'bun test',
  };
  return {
    ctx,
    run: makeTaskRun({ taskKey }),
    diff: { files: [], patch: '', truncated: false },
    changedFiles,
    attempt,
  };
}

describe('MockAuditor', () => {
  test('passes by default and records input', async () => {
    const auditor = new MockAuditor();
    const verdict = await auditor.audit(auditInput('theme', 1));
    expect(verdict.pass).toBe(true);
    expect(verdict.taskKey).toBe('theme');
    expect(verdict.attempt).toBe(1);
    expect(auditor.inputs).toHaveLength(1);
  });

  test('a script array fails then passes by attempt', async () => {
    const auditor = new MockAuditor({ script: { theme: [false, true] } });
    const first = await auditor.audit(auditInput('theme', 1));
    const second = await auditor.audit(auditInput('theme', 2));
    expect(first.pass).toBe(false);
    expect(first.fixInstructions).toContain('theme');
    expect(first.checks.some((c) => !c.ok)).toBe(true);
    expect(second.pass).toBe(true);
    expect(auditor.attemptFor('theme')).toBe(2);
  });

  test('a fixed script value wins over the default', async () => {
    const auditor = new MockAuditor({ script: { search: false }, defaultPass: true });
    expect((await auditor.audit(auditInput('search', 1))).pass).toBe(false);
    expect((await auditor.audit(auditInput('theme', 1))).pass).toBe(true);
  });

  test('decorate can rewrite a verdict', async () => {
    const auditor = new MockAuditor({
      decorate: (verdict) => ({ ...verdict, laneViolations: ['src/not-in-lane.ts'] }),
    });
    const verdict = await auditor.audit(auditInput('theme', 1));
    expect(verdict.laneViolations).toEqual(['src/not-in-lane.ts']);
  });
});

describe('MockMerger', () => {
  test('merges by default with a fake commit', async () => {
    const merger = new MockMerger();
    const result = await merger.merge(
      '/repo',
      'starling/abc/integration',
      makeTaskRun({ taskKey: 'theme' }),
      {},
    );
    expect(result.status).toBe('merged');
    expect(result.commit).toBe('mock-merge-1');
    expect(merger.calls).toEqual([
      { repo: '/repo', integrationBranch: 'starling/abc/integration', taskKey: 'theme' },
    ]);
  });

  test('scripted conflicts are returned per task', async () => {
    const conflict: MergeResult = {
      taskKey: 'search',
      status: 'conflict',
      conflictedFiles: ['src/main.ts'],
      detail: 'overlap',
      ts: 1,
    };
    const merger = new MockMerger({ script: { search: [conflict] } });
    const result = await merger.merge('/repo', 'integration', makeTaskRun({ taskKey: 'search' }), {});
    expect(result.status).toBe('conflict');
    expect(result.conflictedFiles).toEqual(['src/main.ts']);
  });

  test('defaultStatus can be tests-failed', async () => {
    const merger = new MockMerger({ defaultStatus: 'tests-failed' });
    const result = await merger.merge('/repo', 'integration', makeTaskRun(), {});
    expect(result.status).toBe('tests-failed');
    expect(result.commit).toBeUndefined();
  });
});
