import { afterEach, describe, expect, test } from 'bun:test';
import { PERCH_MAX_BODY_BYTES } from './perch-app';
import { authHeaders, makeStartTaskOptions, type PerchHarness, startPerchApp } from './test-helpers';

/**
 * SEC-05: a perch parses JSON into memory, so it must bound the body before parsing. 256 KiB is
 * several thousand lines of worker prompt; anything bigger is a bug or an attack.
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

/** A valid `StartTaskOptions` body of exactly `length` bytes (the prompt absorbs the padding). */
function taskBodyOfLength(length: number): string {
  const base = makeStartTaskOptions();
  const empty = JSON.stringify({ ...base, prompt: '' }).length;
  const body = JSON.stringify({ ...base, prompt: 'x'.repeat(length - empty) });
  if (body.length !== length) throw new Error(`expected ${length} bytes, built ${body.length}`);
  return body;
}

function post(url: string, path: string, body: string | ReadableStream<Uint8Array>): Promise<Response> {
  const isStream = typeof body !== 'string';
  return fetch(`${url}${path}`, {
    method: 'POST',
    headers: isStream
      ? { 'x-flock-token': authHeaders()['x-flock-token'] ?? '', 'content-type': 'application/json' }
      : authHeaders(),
    body,
  });
}

describe('perch body limit', () => {
  test('the exported limit is 256 KiB', () => {
    expect(PERCH_MAX_BODY_BYTES).toBe(256 * 1024);
  });

  test('a declared length over the limit is refused with 413 before a session starts', async () => {
    const { url, node } = harness();
    const res = await post(url, '/perch/tasks', 'x'.repeat(PERCH_MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: {
        code: 'payload-too-large',
        message: `request body must be at most ${PERCH_MAX_BODY_BYTES} bytes`,
      },
    });
    expect(node.startedTasks).toHaveLength(0);
  });

  test('a lying content-length over the limit is refused without reading the body', async () => {
    const { url, app } = harness();
    // Tiny body, huge declared length: the cheap header check must reject it before the stream.
    const request = new Request(`${url}/perch/tasks`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-length': String(PERCH_MAX_BODY_BYTES * 4) },
      body: JSON.stringify(makeStartTaskOptions()),
    });
    const res = await app.fetch(request);
    expect(res.status).toBe(413);
  });

  test('a chunked body with no content-length is counted and refused', async () => {
    const { url, node } = harness();
    const chunk = new TextEncoder().encode('x'.repeat(PERCH_MAX_BODY_BYTES + 1024));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
    // Bun sends a stream body as `transfer-encoding: chunked`, so there is no declared length and
    // the server must count the bytes it reads.
    const res = await fetch(`${url}/perch/tasks`, {
      method: 'POST',
      headers: { 'x-flock-token': authHeaders()['x-flock-token'] ?? '', 'content-type': 'application/json' },
      body: stream,
    });
    expect(res.status).toBe(413);
    expect(node.startedTasks).toHaveLength(0);
  });

  test('a body of exactly the limit is accepted', async () => {
    const { url, node } = harness();
    const body = taskBodyOfLength(PERCH_MAX_BODY_BYTES);
    const res = await post(url, '/perch/tasks', body);
    expect(res.status).toBe(200);
    expect(node.startedTasks).toHaveLength(1);
    expect((node.startedTasks[0]?.prompt ?? '').length).toBeGreaterThan(PERCH_MAX_BODY_BYTES - 1024);
  });

  test('one byte over the limit is refused', async () => {
    const { url, node } = harness();
    const res = await post(url, '/perch/tasks', taskBodyOfLength(PERCH_MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect(node.startedTasks).toHaveLength(0);
  });

  test('the limit applies to prompt bodies, even for an unknown session', async () => {
    const { url } = harness();
    const res = await post(
      url,
      '/perch/tasks/run-1/ghost/prompt',
      JSON.stringify({ prompt: 'x'.repeat(PERCH_MAX_BODY_BYTES) }),
    );
    // 413 wins over 404: the boundary is checked before the handle lookup.
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('payload-too-large');
  });

  test('the limit applies to collect bodies', async () => {
    const { url } = harness();
    const res = await post(
      url,
      '/perch/tasks/run-1/theme/collect',
      JSON.stringify({ baseRef: 'x'.repeat(PERCH_MAX_BODY_BYTES) }),
    );
    expect(res.status).toBe(413);
  });

  test('a small body that is not JSON is still a 400, not a 413', async () => {
    const { url } = harness();
    const res = await post(url, '/perch/tasks', '{ not json');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid-json');
  });

  test('a small body that is empty is a 400 invalid-json', async () => {
    const { url } = harness();
    const res = await post(url, '/perch/tasks', '');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid-json');
  });
});
