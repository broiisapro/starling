/**
 * Probes: `POST /api/replay` — re-publish a recorded JSONL run (ARCHITECTURE §6).
 *
 * Replay is a *publisher*: whatever the file says becomes real events in the store and on the bus, so
 * an unconfined replay route is a file-read and event-injection primitive on the LAN, not a display
 * feature. That is what this file originally demonstrated:
 *
 *  - `path` could be absolute, contain `..`, or be a symlink pointing anywhere the hub process could
 *    read (a valid recording outside the repo was accepted);
 *  - a file that *is* valid JSONL was published to `/api/events`, so a LAN peer could paint a fake
 *    `node.joined` on the dashboard (see the impact test at the bottom);
 *  - the error message named the path and the line, an existence oracle for arbitrary files.
 *
 * **Epic 41 fixed the confinement half (SEC-04).** Every replay path is now resolved against the
 * active repo and must `realpath` inside `fixtures/` or `.starling/`, else 403. Those probes are plain
 * `test(...)` now: they are regression tests, not expectations. Authentication is still missing
 * (SEC-01, the same structural gap as `POST /api/runs`, E-04), so that one stays `test.failing`.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { loadReplayFile, startReplay } from '../../apps/server/src/index.ts';
import type { StarlingEvent } from '../../packages/core/src/index.ts';
import { makeNodeInfo, makeRun } from '../../packages/core/src/testing/index.ts';
import { FIXTURE_PATH, type ProbeHarness, probeTempDir, removeDir, startProbeServer } from './support.ts';

/** The repo root: the allow-list is resolved against it, not against whatever cwd the tests inherit. */
const ROOT = join(import.meta.dir, '../..');

const outside = await probeTempDir('replay-outside');
const recording = join(outside, 'valid-recording.jsonl');
await Bun.write(recording, await Bun.file(FIXTURE_PATH).text());

// A second root that *does* allow `fixtures/`, with a link inside it pointing out. Only a `realpath`
// (not a lexical prefix check) refuses this one, so it is the probe that keeps Epic 41's check honest.
const linkRoot = await probeTempDir('replay-link-root');
await mkdir(join(linkRoot, 'fixtures'), { recursive: true });
const insideLink = join(linkRoot, 'fixtures', 'looks-inside.jsonl');
await symlink(recording, insideLink);

// The same wiring `dev.ts` / the Wave 2 engine uses: load, validate, publish.
function replayServer(repoRoot: string): ProbeHarness {
  const handle = startProbeServer({
    repoRoot,
    replay: async (path, speed) => {
      const file = loadReplayFile(path);
      return {
        runId: startReplay({ file, store: handle.store, bus: handle.bus, speed, loop: false }).runId,
      };
    },
  });
  return handle;
}

const server = replayServer(ROOT);
const linkServer = replayServer(linkRoot);

afterAll(async () => {
  linkServer.stop();
  server.stop();
  await removeDir(linkRoot);
  await removeDir(outside);
});

function replay(path: string, base = server.url): Promise<Response> {
  return fetch(`${base}/api/replay`, {
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

  test('refuses a recording outside the run directory', async () => {
    // A *valid* JSONL file the hub has no business replaying. Pre-Epic 41 this was a 202 (SEC-04).
    const response = await replay(recording);
    expect(response.status).toBe(403);
  });

  test('refuses a symlink that points outside the run directory', async () => {
    // The link lives under an allowed `fixtures/` but resolves outside it: the allow-list must
    // `realpath` the target, not just compare prefixes (Epic 41's `resolveReplayPath` does).
    const response = await replay(insideLink, linkServer.url);
    expect(response.status).toBe(403);
  });

  test('refuses an absolute path to a non-recording', async () => {
    const response = await replay('/etc/passwd');
    expect(response.status).toBe(403);
  });

  test.failing('requires authentication for a mutating route', async () => {
    // Nothing about `/api/replay` is run-scoped, so a LAN peer can replay at will (E-04).
    const response = await replay(FIXTURE_PATH);
    expect(response.status).toBe(401);
  });
});

/**
 * Impact of what the allow-list prevents (not a separate defect).
 *
 * Before Epic 41 this probe wrote a hand-written recording (`run.created` + a fake `node.joined` for
 * "attacker-laptop") *outside* the repo and expected a 202, then found the forged node on the bus:
 * a LAN peer could put any perch it liked on the dashboard. Epic 41 refuses the same file at the
 * route, so the forged event never reaches the store or the bus.
 */
describe('replay is not an event-injection primitive from outside the run directory', () => {
  test('a forged recording outside the allowed directories is refused with 403', async () => {
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
    expect(response.status).toBe(403);

    // Nothing from the file was published: no `node.joined` for the attacker's id reached the store.
    const published = server.store.events('*').filter((event) => event.type === 'node.joined');
    expect(published.some((event) => event.payload.node.id === 'attacker-laptop')).toBe(false);
  });
});
