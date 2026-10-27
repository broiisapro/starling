/**
 * Probes: the flock token is the only credential between the hub and a perch (ARCHITECTURE L18).
 *
 * What is asserted here:
 *  - every token-guarded route answers 401 `UNAUTHORIZED` with no token, an empty token and a wrong
 *    token, and the check runs before the body is parsed;
 *  - a correct code verifies case-insensitively (`PROBE-CODE` ≡ `probe-code`), which is the documented
 *    "forgiving typed form" from Epic 30;
 *  - the comparison does not depend on where the first differing character is, so a probe cannot
 *    learn a prefix by timing it.
 *
 * No finding is expected in this file: the token plumbing held up. It exists because a regression
 * here turns the whole LAN channel into an open door.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { constantTimeEqual, verifyJoinCode } from '../../packages/flock/src/index.ts';
import { tokensMatch } from '../../packages/perch/src/index.ts';
import { makeHubHarness, nodeInfo, PROBE_CODE, startProbeServer } from './support.ts';

const harness = await makeHubHarness();
const server = startProbeServer({ flock: harness.hub });

afterAll(async () => {
  server.stop();
  await harness.close();
});

function post(path: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers['x-flock-token'] = token;
  return fetch(`${server.url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('flock token gate', () => {
  const registerBody = { url: 'http://127.0.0.1:1', info: nodeInfo() };

  test('rejects a missing token on every guarded route', async () => {
    const register = await post('/api/flock/register', registerBody);
    const heartbeat = await post('/api/flock/heartbeat', { nodeId: 'perch-probe', info: nodeInfo() });
    const bundle = await fetch(`${server.url}/api/flock/bundle?ref=main`);

    for (const response of [register, heartbeat, bundle]) {
      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
    }
  });

  test('rejects an empty token as firmly as a wrong one', async () => {
    for (const token of ['', '   ', 'PROBE-COD3', `${PROBE_CODE}-extra`, 'A'.repeat(4096)]) {
      const response = await post('/api/flock/register', registerBody, token);
      expect(response.status).toBe(401);
    }
  });

  test('checks the token before it parses the body', async () => {
    const response = await fetch(`${server.url}/api/flock/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'this is not json',
    });
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });

  test('accepts the code in the forgiving typed form and issues a node id', async () => {
    const response = await post(
      '/api/flock/register',
      { url: 'http://127.0.0.1:1', info: nodeInfo({ id: 'perch-lower' }) },
      PROBE_CODE.toLowerCase(),
    );
    expect(response.status).toBe(201);
    expect(((await response.json()) as { nodeId: string }).nodeId).toBe('perch-lower');
  });

  test('the hub verifies the code, not the server itself', () => {
    expect(harness.hub.verifyToken(PROBE_CODE)).toBe(true);
    expect(harness.hub.verifyToken(PROBE_CODE.toLowerCase())).toBe(true);
    expect(harness.hub.verifyToken(undefined)).toBe(false);
    expect(harness.hub.verifyToken('')).toBe(false);
    expect(harness.hub.verifyToken('WRONG-CODE')).toBe(false);
  });
});

describe('token comparison timing', () => {
  // Wall-clock assertions are not reliable on a laptop running ~20 parallel agents: a min-of-five
  // measurement of the same function still varied by 5× between "differs first" and "differs last"
  // because the JIT compiled the two closures differently. Instead this probe asserts the *shape*
  // that makes the comparison constant-time (every character folded into one accumulator, single
  // exit) plus the functional property (a difference at any position is detected). A future
  // implementation that reintroduces an early `return` fails the source check.
  const sourcePath = join(import.meta.dir, '../../packages/flock/src/join-code.ts');

  test('constantTimeEqual folds every character and has a single exit', () => {
    const source = readFileSync(sourcePath, 'utf8');
    const start = source.indexOf('export function constantTimeEqual');
    const end = source.indexOf('/** `candidate` matches `expected`');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).toContain('charCodeAt');
    expect(body).toContain('Math.max(a.length, b.length)');
    // One `return` (the final comparison): a `return` inside the loop would exit on the first mismatch.
    expect(body.match(/\breturn\b/g) ?? []).toHaveLength(1);
  });

  test('a difference at any position is detected', () => {
    const expected = 'PROBECOD';
    for (let position = 0; position < expected.length; position += 1) {
      const candidate = `${expected.slice(0, position)}X${expected.slice(position + 1)}`;
      expect(constantTimeEqual(expected, candidate)).toBe(false);
    }
    expect(constantTimeEqual(expected, expected)).toBe(true);
  });

  test('the perch hashes before comparing, so length is not leaked either', () => {
    // `timingSafeEqual` throws on different lengths; the SHA-256 wrapper must not.
    expect(tokensMatch('short', PROBE_CODE)).toBe(false);
    expect(tokensMatch(`${PROBE_CODE}${'x'.repeat(10_000)}`, PROBE_CODE)).toBe(false);
    expect(tokensMatch(undefined, PROBE_CODE)).toBe(false);
    expect(tokensMatch(PROBE_CODE, PROBE_CODE)).toBe(true);
  });

  test('verifyJoinCode never accepts an empty candidate', () => {
    expect(verifyJoinCode(PROBE_CODE, '')).toBe(false);
    expect(verifyJoinCode(PROBE_CODE, '   ')).toBe(false);
    expect(verifyJoinCode(PROBE_CODE, 'prob ecod')).toBe(true);
  });
});
