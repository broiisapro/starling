import { afterEach, describe, expect, test } from 'bun:test';
import { authHeaders, makeStartTaskOptions, type PerchHarness, startPerchApp } from './test-helpers';

/**
 * SEC-10: a hostile `branch` / `fromRef` / `runId` / `taskKey` must die at the HTTP boundary with a
 * 400, before `node.startTask` (and therefore git) sees it.
 */

const running: PerchHarness[] = [];

afterEach(async () => {
  for (const harness of running.splice(0)) await harness.close();
});

function harness(): PerchHarness {
  const started = startPerchApp();
  running.push(started);
  return started;
}

function postTask(url: string, overrides: Record<string, unknown>): Promise<Response> {
  return fetch(`${url}/perch/tasks`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ...makeStartTaskOptions(), ...overrides }),
  });
}

const HOSTILE_BRANCH = '../../../../tmp/starling-probe-escape';
const HOSTILE_REF = '--upload-pack=touch /tmp/starling-probe-pwned';

describe('hostile refs at the perch boundary', () => {
  test('a traversal branch is a 400 invalid-body and never reaches the node', async () => {
    const { url, node } = harness();
    const res = await postTask(url, { branch: HOSTILE_BRANCH });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invalid-body');
    expect(body.error.message).toContain('branch');
    expect(node.startedTasks).toHaveLength(0);
  });

  test('an option-shaped fromRef is a 400 and never reaches the node', async () => {
    const { url, node } = harness();
    const res = await postTask(url, { fromRef: HOSTILE_REF });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('fromRef');
    expect(node.startedTasks).toHaveLength(0);
  });

  test('a ref with a reflog selector or revision suffix is rejected', async () => {
    const { url, node } = harness();
    for (const fromRef of ['HEAD@{1}', 'main~1', 'main^{tree}', 'HEAD:path', 'main..main']) {
      const res = await postTask(url, { fromRef });
      expect(res.status).toBe(400);
    }
    expect(node.startedTasks).toHaveLength(0);
  });

  test('a runId or taskKey that is not a single id is rejected', async () => {
    const { url, node } = harness();
    const badRun = await postTask(url, { runId: 'run/../escape' });
    expect(badRun.status).toBe(400);
    const badKey = await postTask(url, { taskKey: 'a b' });
    expect(badKey.status).toBe(400);
    expect(node.startedTasks).toHaveLength(0);
  });

  test('every task route validates its path params before looking for a session', async () => {
    const { url, node } = harness();
    // `run:1` and `a%20b` are outside the id alphabet, so the routes must answer 400 (not 404).
    const routes: Array<[string, string, string]> = [
      ['POST', '/perch/tasks/run%3A1/theme/prompt', JSON.stringify({ prompt: 'hi' })],
      ['POST', '/perch/tasks/run-1/a%20b/abort', ''],
      ['POST', '/perch/tasks/run%3A1/theme/collect', JSON.stringify({ baseRef: 'main' })],
      ['GET', '/perch/tasks/run-1/a%20b/bundle', ''],
      ['DELETE', '/perch/tasks/run%3A1/theme', ''],
    ];
    for (const [method, path, body] of routes) {
      const res = await fetch(`${url}${path}`, {
        method,
        headers: authHeaders(),
        ...(body === '' ? {} : { body }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid-params');
    }
    expect(node.startedTasks).toHaveLength(0);
    expect(node.prompts).toHaveLength(0);
  });

  test('a legitimate task still starts after a batch of rejections', async () => {
    const { url, node } = harness();
    await postTask(url, { branch: HOSTILE_BRANCH });
    await postTask(url, { fromRef: HOSTILE_REF });

    const ok = await postTask(url, {});
    expect(ok.status).toBe(200);
    expect(node.startedTasks).toHaveLength(1);
    expect(node.startedTasks[0]?.branch).toBe('starling/run1/theme');
  });
});
