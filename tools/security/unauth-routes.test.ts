/**
 * Probes: which hub routes require the flock token?
 *
 * Answer today: only `/api/flock/*`. Every other route is open to anyone who can reach port 7777, and
 * `startServer` binds `0.0.0.0` on purpose (a perch must be able to connect). On a shared Wi-Fi that
 * means:
 *
 *   POST /api/runs { goal, repoPath }   → start a coding agent on any repo on this machine, with this
 *                                         user's credentials and opencode session. Remote code
 *                                         execution by proxy, no token needed.
 *   POST /api/replay { path }           → publish any readable recording (see replay probes).
 *   GET  /api/runs, /api/runs/:id       → read every goal, task and diff summary.
 *   GET  /api/nodes                     → enumerate perches and their LAN URLs.
 *   GET  /api/events                    → stream everything, unauthenticated and uncapped.
 *
 * The fix has two halves, both outside this lane: bind `127.0.0.1` unless `--lan` is passed (the
 * smallest change that closes the demo-day hole), and require `x-flock-token` on every `/api/*` route
 * except `/api/health` and `/api/flock/join`. The dashboard/CLI need to carry the token for that, so
 * it is a small cross-cutting change, not a one-liner.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { makeHubHarness, PROBE_CODE, startProbeServer } from './support.ts';

const harness = await makeHubHarness();
const server = startProbeServer({ flock: harness.hub });

afterAll(async () => {
  server.stop();
  await harness.close();
});

describe('hub route authentication', () => {
  test.failing('refuses to start a run without the flock token', async () => {
    const response = await fetch(`${server.url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'delete the tests', repoPath: '/tmp' }),
    });
    expect(response.status).toBe(401);
  });

  test.failing('refuses to list runs without the flock token', async () => {
    const response = await fetch(`${server.url}/api/runs`);
    expect(response.status).toBe(401);
  });

  test.failing('refuses to enumerate nodes without the flock token', async () => {
    const response = await fetch(`${server.url}/api/nodes`);
    expect(response.status).toBe(401);
  });

  test.failing('refuses the all-events stream without the flock token', async () => {
    const response = await fetch(`${server.url}/api/events`);
    await response.body?.cancel();
    expect(response.status).toBe(401);
  });

  test('the token is accepted on a flock route (so the plumbing exists)', async () => {
    const response = await fetch(`${server.url}/api/users-ish`, { headers: { 'x-flock-token': PROBE_CODE } });
    expect(response.status).toBe(404);
  });

  test('health stays open, because a doctor check must not need a secret', async () => {
    const response = await fetch(`${server.url}/api/health`);
    expect(response.status).toBe(200);
  });
});
