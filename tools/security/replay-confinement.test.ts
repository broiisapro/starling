/**
 * Probes: `POST /api/replay` — re-publish a recorded JSONL run (ARCHITECTURE §6).
 *
 * Replay is a *publisher*: whatever the file says becomes real events in the store and on the bus. The
 * route takes a filesystem path from the request and the demo server hands it straight to
 * `readFileSync`. That is an unauthenticated, unconfined file read and event-injection primitive on
 * the LAN, not a display feature:
 *
 *  - `path` may be absolute, contain `..`, or be a symlink pointing anywhere the hub process can
 *    read (proven below with a valid recording outside the repo);
 *  - a file that *is* valid JSONL is accepted and its events (a fake `node.joined`, a fake run) are
 *    published to `/api/events`, so a LAN peer can paint anything it likes on the dashboard;
 *  - the error message names the path and the line, which turns the route into an existence oracle
 *    for arbitrary files.
 *
 * The two `test.failing` probes expect a confinement check plus authentication. Authentication is the
 * same structural gap as `POST /api/runs` (see the findings table, E-04).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { loadReplayFile, startReplay } from '../../apps/server/src/index.ts';
import type { StarlingEvent } from '../../packages/core/src/index.ts';
import { makeNodeInfo, makeRun } from '../../packages/core/src/testing/index.ts';
import { FIXTURE_PATH, probeTempDir, removeDir, startProbeServer, wait } from './support.ts';

const outside = await probeTempDir('replay-outside');
const recording = join(outside, 'valid-recording.jsonl');
await Bun.write(recording, await Bun.file(FIXTURE_PATH).text());
const link = join(outside, 'link-to-recording.jsonl');
await symlink(recording, link);

// The same wiring `dev.ts` / the Wave 2 engine uses: load, validate, publish.
const server = startProbeServer({
  replay: async (path, speed) => {
    const file = loadReplayFile(path);
    return { runId: startReplay({ file, store: server.store, bus: server.bus, speed, loop: false }).runId };
  },
});

afterAll(async () => {
  server.stop();
  await removeDir(outside);
});

function replay(path: string): Promise<Response> {
  return fetch(`${server.url}/api/replay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, speed: 1000 }),
  });
}

describe('replay confinement', () => {
  test('replays the recorded launch-day run (the supported case)', async () => {
    const response = await replay(FIXTURE_PATH);
    expect(response.status).toBe(202);
    const body = (await response.json()) as { runId: string };
    expect(body.runId.length).toBeGreaterThan(0);
  });

  test.failing('refuses a recording outside the run directory', async () => {
    // A *valid* JSONL file the hub has no business replaying. Today this is a 202.
    const response = await replay(recording);
    expect(response.status).toBe(403);
  });

  test.failing('refuses a symlink that points outside the run directory', async () => {
    const response = await replay(link);
    expect(response.status).toBe(403);
  });

  test.failing('refuses an absolute path to a non-recording', async () => {
    const response = await replay('/etc/passwd');
    expect(response.status).toBe(403);
  });

  test.failing('requires authentication for a mutating route', async () => {
    // Nothing about `/api/replay` is run-scoped, so a LAN peer can replay at will (E-04).
    const response = await replay(FIXTURE_PATH);
    expect(response.status).toBe(401);
  });
});

describe('replay is an event-injection primitive (impact, not a separate defect)', () => {
  test('a hand-written recording publishes arbitrary node events', async () => {
    const forged: StarlingEvent[] = [
      {
        type: 'run.created',
        runId: 'probe-forged-run',
        ts: Date.now(),
        payload: { run: makeRun({ id: 'probe-forged-run' }) },
      },
      {
        type: 'node.joined',
        runId: '*',
        ts: Date.now() + 1,
        payload: {
          node: makeNodeInfo({ id: 'attacker-laptop', name: 'Totally Real Perch', status: 'online' }),
        },
      },
    ];
    const forgedPath = join(outside, 'forged.jsonl');
    await Bun.write(forgedPath, `${forged.map((event) => JSON.stringify(event)).join('\n')}\n`);

    const response = await replay(forgedPath);
    expect(response.status).toBe(202);
    // Replay publishes the first event synchronously and the rest on a timer.
    await wait(50);
    const published = server.store.events('*').filter((event) => event.type === 'node.joined');
    expect(published.some((event) => event.payload.node.id === 'attacker-laptop')).toBe(true);
  });
});
