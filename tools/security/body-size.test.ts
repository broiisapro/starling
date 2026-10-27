/**
 * Probes: request bodies with no size limit.
 *
 * Both HTTP surfaces parse JSON into memory before any validation runs (`c.req.json()`), and neither
 * declares a maximum. A 1 MiB body is already accepted; nothing stops a 1 GiB one, and the hub also
 * keeps the parsed value in the events it publishes. On a LAN with a shared join code that is a
 * one-request memory-exhaustion bug, not a theoretical one.
 *
 * The fix is a small `content-length` / streamed-bytes guard in `parseJsonBody` (hub) and `readJson`
 * (perch), answering `413 PAYLOAD_TOO_LARGE`.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { createPerchApp } from '../../packages/perch/src/index.ts';
import { makeHubHarness, nodeInfo, PROBE_CODE, startProbeServer, stubNode } from './support.ts';

const HUB_BODY = 1024 * 1024;
const LARGE = 'x'.repeat(HUB_BODY);

const harness = await makeHubHarness();
const hub = startProbeServer({ flock: harness.hub });

const perchNode = stubNode();
const perch = createPerchApp({ node: perchNode, token: PROBE_CODE, info: async () => nodeInfo() });
const perchServer = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: perch.fetch });
const perchUrl = `http://127.0.0.1:${perchServer.port ?? 0}`;

afterAll(async () => {
  perchServer.stop(true);
  hub.stop();
  await harness.close();
});

describe('hub body limits', () => {
  test.failing('rejects a 1 MiB goal instead of starting a run', async () => {
    const response = await fetch(`${hub.url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: LARGE, repoPath: '/tmp' }),
    });
    expect(response.status).toBe(413);
  });

  test.failing('rejects a 1 MiB registration url', async () => {
    const response = await fetch(`${hub.url}/api/flock/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-flock-token': PROBE_CODE },
      body: JSON.stringify({ url: LARGE, info: nodeInfo() }),
    });
    expect(response.status).toBe(413);
  });

  test.failing('rejects a 1 MiB replay path', async () => {
    const response = await fetch(`${hub.url}/api/replay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: LARGE }),
    });
    expect(response.status).toBe(413);
  });

  test.failing('rejects a large chunked body with no content-length', async () => {
    const chunk = new TextEncoder().encode(LARGE);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const response = await fetch(`${hub.url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      // Bun adds `transfer-encoding: chunked` for a stream body.
    });
    expect(response.status).toBe(413);
  });
});

describe('perch body limits', () => {
  function startTaskBody(prompt: string): string {
    return JSON.stringify({
      runId: 'probe-run',
      taskKey: 'probe-task',
      title: 'probe',
      repo: { kind: 'bundle', url: 'http://127.0.0.1:1/probe.bundle', token: PROBE_CODE },
      fromRef: 'main',
      branch: 'starling/probe/task',
      prompt,
      model: { provider: 'probe', model: 'probe' },
    });
  }

  test('rejects a 1 MiB prompt before starting a session', async () => {
    const response = await fetch(`${perchUrl}/perch/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-flock-token': PROBE_CODE },
      body: startTaskBody(LARGE),
    });
    expect(response.status).toBe(413);
  });

  test('rejects a 1 MiB fixer prompt', async () => {
    const response = await fetch(`${perchUrl}/perch/tasks/probe-run/probe-task/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-flock-token': PROBE_CODE },
      body: JSON.stringify({ prompt: LARGE }),
    });
    // 404 (no such session) is the honest answer today; a body limit should fire first.
    expect(response.status).toBe(413);
  });
});
