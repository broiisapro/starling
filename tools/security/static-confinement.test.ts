/**
 * Probes: static hosting for the built dashboard (`deps.webDist`).
 *
 * `resolveStaticPath` rejects `..` and absolute paths by resolving the requested path against the web
 * root and checking the prefix — a lexical check. It never asks whether the resolved file is a
 * symlink, and `readFileIfPresent` follows links. A build output tree that contains a symlink (a
 * `node_modules` link in a copied dependency, a hand-made shortcut, a tarball extraction) therefore
 * serves any file the hub process can read.
 *
 * The fix is one `realpath` call (and the same prefix check against the real root) in
 * `resolveStaticPath`/`readFileIfPresent`.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { probeTempDir, removeDir, startProbeServer } from './support.ts';

const root = await probeTempDir('webdist');
const dist = join(root, 'dist');
await mkdir(join(dist, 'assets'), { recursive: true });
await Bun.write(join(dist, 'index.html'), '<html>dashboard</html>');
await Bun.write(join(dist, 'assets', 'app.js'), 'console.log("app")');
await Bun.write(join(root, 'outside-secret.txt'), 'TOP-SECRET-FROM-OUTSIDE');
await symlink(join(root, 'outside-secret.txt'), join(dist, 'leak.txt'));
await symlink(root, join(dist, 'linked-dir'));

const server = startProbeServer({ webDist: dist });

afterAll(async () => {
  server.stop();
  await removeDir(root);
});

describe('static hosting confinement', () => {
  test('serves a real build file', async () => {
    const response = await fetch(`${server.url}/assets/app.js`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('console.log');
    expect(response.headers.get('cache-control')).toContain('immutable');
  });

  test('falls back to index.html for a client-side route', async () => {
    const response = await fetch(`${server.url}/runs/01probe`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('dashboard');
  });

  test('never serves /api/* from disk', async () => {
    const response = await fetch(`${server.url}/api/nope`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  test('rejects encoded traversal', async () => {
    const response = await fetch(`${server.url}/..%2foutside-secret.txt`);
    expect(await response.text()).not.toContain('TOP-SECRET');
  });

  test.failing('does not follow a symlinked file out of the web root', async () => {
    const response = await fetch(`${server.url}/leak.txt`);
    expect(await response.text()).not.toContain('TOP-SECRET');
    expect(response.status).toBe(404);
  });

  test.failing('does not follow a symlinked directory out of the web root', async () => {
    const response = await fetch(`${server.url}/linked-dir/outside-secret.txt`);
    expect(await response.text()).not.toContain('TOP-SECRET');
  });
});
