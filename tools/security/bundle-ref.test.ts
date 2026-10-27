/**
 * Probes: `GET /api/flock/bundle?ref=` — the hub's repo-transfer channel (ARCHITECTURE L18, §6).
 *
 * The ref arrives from the network and is handed to two git commands. Shell injection is impossible
 * (`core.exec` is argv-only, proven in `exec-argv.test.ts`), but that is not the whole threat:
 *  - a ref starting with `-` is a *git option*, not a revision;
 *  - a traversal-shaped ref makes git print the hub repo's absolute path, which the error envelope
 *    then returns to the caller;
 *  - an unvalidated ref lets any token holder ask for arbitrary revisions (`--all`) and pay the
 *    bundling cost on the hub.
 *
 * Two probes are `test.failing`: a caller-supplied ref should be rejected with a 400 before git sees
 * it, and a rejection must never quote the hub's filesystem back to the caller.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  isGitBundle,
  makeHubHarness,
  PROBE_CODE,
  probeTempDir,
  removeDir,
  startProbeServer,
} from './support.ts';

const harness = await makeHubHarness();
const server = startProbeServer({ flock: harness.hub });
const markerDir = await probeTempDir('marker');

afterAll(async () => {
  server.stop();
  await harness.close();
  await removeDir(markerDir);
});

function bundle(ref: string, token = PROBE_CODE): Promise<Response> {
  return fetch(`${server.url}/api/flock/bundle?ref=${encodeURIComponent(ref)}`, {
    headers: { 'x-flock-token': token },
  });
}

const HOSTILE_REFS = [
  '--all',
  '--not',
  '--output=/tmp/starling-probe-pwned',
  '--upload-pack=touch /tmp/starling-probe-pwned',
  'HEAD:../../etc/passwd',
  '../../main',
  'refs/heads/../../main',
  '@{-1}',
  'main\n--all',
];

describe('bundle ref handling', () => {
  test('returns a real git bundle for an ordinary branch', async () => {
    const response = await bundle('main');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(isGitBundle(new Uint8Array(await response.arrayBuffer()))).toBe(true);
  });

  test('requires a ref', async () => {
    const response = await fetch(`${server.url}/api/flock/bundle`, {
      headers: { 'x-flock-token': PROBE_CODE },
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('INVALID_QUERY');
  });

  test('never runs a shell, so the markers stay absent', async () => {
    const marker = join(markerDir, 'pwned');
    for (const ref of [
      `$(touch ${marker})`,
      `; touch ${marker}`,
      `\`touch ${marker}\``,
      `--upload-pack=touch ${marker}`,
      `| touch ${marker}`,
    ]) {
      await bundle(ref);
    }
    expect(existsSync(marker)).toBe(false);
  });

  test('writes bundles only inside the configured bundle directory', async () => {
    await bundle('main');
    const written = existsSync(harness.bundleDir) ? readdirSync(harness.bundleDir) : [];
    expect(written.every((name) => name.endsWith('.bundle'))).toBe(true);
    // The repo itself must be untouched by a bundle request.
    expect(existsSync(join(harness.repo, '.git'))).toBe(true);
  });

  test.failing('rejects option-like and traversal-shaped refs with a 400', async () => {
    for (const ref of HOSTILE_REFS) {
      const response = await bundle(ref);
      // `INVALID_QUERY` is the envelope the route already uses for a missing ref. Validation belongs
      // in the route (or in FlockHub.bundle) before `git rev-parse` is spawned.
      expect({ ref, status: response.status }).toEqual({ ref, status: 400 });
    }
  });

  test.failing('does not leak the hub repo path in a rejection', async () => {
    for (const ref of HOSTILE_REFS) {
      const body = await (await bundle(ref)).text();
      expect({ ref, leaked: body.includes(harness.repo) }).toEqual({ ref, leaked: false });
    }
  });
});
