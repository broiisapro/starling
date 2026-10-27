/**
 * Probes: `POST /perch/tasks` — the one route that lets another machine run an agent here.
 *
 * The hub picks `branch` and `fromRef`, and the perch forwards both into `LocalNode.startTask` →
 * `Workspace.create` → `git worktree add`. Two things need to be true:
 *
 *  1. the perch only accepts `repo.kind: 'bundle'` (it must never read the hub's disk) — holds;
 *  2. hostile branch/ref values are rejected *at the boundary*, with a 400, before they reach git.
 *     Today they are forwarded verbatim and the failure surfaces as a 500 containing git's stderr.
 *
 * The second half of this file runs the real `LocalNode` + `Workspace` against a throwaway repo to
 * prove that, even when the boundary does not validate, the path sanitiser keeps the worktree inside
 * `worktreeRoot` and no shell ever runs. That is the containment property the boundary check is
 * defence in depth for, not a replacement for it.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isStarlingError } from '../../packages/core/src/index.ts';
import { MockRunner } from '../../packages/core/src/testing/index.ts';
import { createLocalNode } from '../../packages/flock/src/index.ts';
import { createPerchApp } from '../../packages/perch/src/index.ts';
import { createWorkspace } from '../../packages/workspace/src/index.ts';
import { makeRepo, nodeInfo, PROBE_CODE, probeTempDir, removeDir, stubNode, wait } from './support.ts';

const node = stubNode();
const perch = createPerchApp({ node, token: PROBE_CODE, info: async () => nodeInfo() });
const perchServer = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: perch.fetch });
const perchUrl = `http://127.0.0.1:${perchServer.port ?? 0}`;
const scratch = await probeTempDir('perch-tasks');

afterAll(async () => {
  perchServer.stop(true);
  await perch.close();
  await removeDir(scratch);
});

const HOSTILE = {
  branch: '../../../../tmp/starling-probe-escape',
  fromRef: '--upload-pack=touch /tmp/starling-probe-pwned',
};

function startTask(overrides: Record<string, unknown> = {}): Promise<Response> {
  return fetch(`${perchUrl}/perch/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-flock-token': PROBE_CODE },
    body: JSON.stringify({
      runId: 'probe-run',
      taskKey: 'probe-task',
      title: 'probe task',
      repo: { kind: 'bundle', url: 'http://127.0.0.1:1/probe.bundle', token: PROBE_CODE },
      fromRef: 'main',
      branch: 'starling/probe/task',
      prompt: 'do the thing',
      model: { provider: 'probe', model: 'probe' },
      ...overrides,
    }),
  });
}

describe('perch task boundary', () => {
  test('refuses a local repo, so the hub cannot read this machine', async () => {
    const response = await startTask({ repo: { kind: 'local', path: '/etc' } });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('invalid-repo');
  });

  test('returns the same handle when the hub retries a task', async () => {
    const first = await startTask({ runId: 'retry-run', taskKey: 'retry-task' });
    const second = await startTask({ runId: 'retry-run', taskKey: 'retry-task' });
    expect(await first.json()).toEqual(await second.json());
    expect(node.startedTasks.filter((task) => task.runId === 'retry-run')).toHaveLength(1);
  });

  test.failing('rejects a hostile branch and fromRef with a 400', async () => {
    const response = await startTask(HOSTILE);
    // 200 today: the values reach `LocalNode.startTask` verbatim, which is where git says no.
    expect(response.status).toBe(400);
  });

  test.failing('does not forward a hostile branch/fromRef to the node', async () => {
    const before = node.startedTasks.length;
    await startTask({ ...HOSTILE, taskKey: 'probe-forwarded' });
    const forwarded = node.startedTasks.slice(before);
    expect(forwarded).toEqual([]);
  });
});

const worktreeRoot = join(scratch, 'worktrees');
const repo = await makeRepo('perch-workspace');
const workspace = createWorkspace({ worktreeRoot });
const localNode = createLocalNode({
  workspace,
  runner: new MockRunner(),
  name: 'probe node',
  maxSessions: 4,
  worktreeRoot,
});

describe('workspace containment (the property behind the boundary check)', () => {
  afterAll(async () => {
    await localNode.close();
    await removeDir(worktreeRoot);
  });

  test('a normal task gets a worktree under worktreeRoot', async () => {
    const handle = await localNode.startTask({
      runId: 'probe-run',
      taskKey: 'normal',
      title: 'normal',
      repo: { kind: 'local', path: repo },
      fromRef: 'main',
      branch: 'starling/probe/normal',
      prompt: 'p',
      model: { provider: 'probe', model: 'probe' },
    });
    expect(handle.branch).toBe('starling/probe/normal');
    const created = readdirSync(worktreeRoot);
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((name) => !name.includes('..'))).toBe(true);
    await localNode.cleanup(handle);
  });

  test('a traversal branch name cannot escape worktreeRoot', async () => {
    const marker = join(scratch, 'escaped');
    for (const branch of ['../../escaped', '..\\..\\escaped', 'starling/../../../escaped']) {
      let failed = false;
      try {
        const handle = await localNode.startTask({
          runId: 'probe-run',
          taskKey: `escape-${branch.length}`,
          title: 'escape',
          repo: { kind: 'local', path: repo },
          fromRef: 'main',
          branch,
          prompt: 'p',
          model: { provider: 'probe', model: 'probe' },
        });
        await localNode.cleanup(handle);
      } catch (err) {
        failed = true;
        expect(isStarlingError(err)).toBe(true);
      }
      // Git rejects the invalid branch name, so the task fails; either way nothing exists outside.
      expect(failed).toBe(true);
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(join(scratch, '..', 'escaped'))).toBe(false);
    }
  });

  test('an option-shaped fromRef cannot run a command', async () => {
    const marker = join(scratch, 'pwned');
    await wait(0);
    try {
      const handle = await localNode.startTask({
        runId: 'probe-run',
        taskKey: 'option-ref',
        title: 'option ref',
        repo: { kind: 'local', path: repo },
        fromRef: `--upload-pack=touch ${marker}`,
        branch: 'starling/probe/option-ref',
        prompt: 'p',
        model: { provider: 'probe', model: 'probe' },
      });
      await localNode.cleanup(handle);
    } catch {
      // Expected: git refuses the unknown option.
    }
    expect(existsSync(marker)).toBe(false);
  });
});
