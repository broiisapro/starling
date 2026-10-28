/**
 * Static checks for the contributor container and the live smoke script (Epic 153).
 *
 * `devcontainer.json` is JSONC and cannot be validated by opening it in Codespaces on this machine,
 * so its pin, ports, extensions, live-test posture and welcome text are asserted here. `smoke.sh` is
 * the Docker-daemon check; its bash syntax is still checked everywhere.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { BUN_VERSION, DEVCONTAINER_CONFIG, DEVCONTAINER_DOCKERFILE, ROOT, SMOKE } from './static-support.ts';

describe('.devcontainer', () => {
  test('parses as JSONC and names itself', () => {
    expect(typeof DEVCONTAINER_CONFIG.name).toBe('string');
    expect(DEVCONTAINER_CONFIG.name ?? '').toContain('Starling');
  });

  test('builds from the same pinned Bun image', () => {
    expect(DEVCONTAINER_CONFIG.build?.dockerfile).toBe('Dockerfile');
    const from = /^FROM\s+(\S+)/m.exec(DEVCONTAINER_DOCKERFILE)?.[1];
    expect(from).toBe(`oven/bun:${BUN_VERSION}`);
  });

  test('installs git, gh and bash', () => {
    for (const tool of ['git', 'gh', 'bash']) {
      expect(DEVCONTAINER_DOCKERFILE).toMatch(new RegExp(`(^|\\s)${tool}(\\s|$|\\\\)`, 'm'));
    }
    expect(DEVCONTAINER_DOCKERFILE).toContain('apt-get install');
  });

  test('installs dependencies from the lockfile on create', () => {
    expect(DEVCONTAINER_CONFIG.postCreateCommand).toBe('bun install --frozen-lockfile');
  });

  test('forwards the dashboard and the Vite dev server with labels', () => {
    expect(DEVCONTAINER_CONFIG.forwardPorts).toEqual([7777, 5173]);
    expect(DEVCONTAINER_CONFIG.portsAttributes?.['7777']?.label).toMatch(/dashboard/i);
    expect(DEVCONTAINER_CONFIG.portsAttributes?.['5173']?.label).toMatch(/vite/i);
  });

  test('recommends Biome and the Bun extension', () => {
    const extensions = DEVCONTAINER_CONFIG.customizations?.vscode?.extensions ?? [];
    expect(extensions).toContain('biomejs.biome');
    expect(extensions).toContain('oven.bun-vscode');
  });

  test('leaves live tests off inside the container', () => {
    const live = DEVCONTAINER_CONFIG.remoteEnv?.STARLING_LIVE;
    expect(live === undefined || live !== '1').toBe(true);
  });

  test('prints the three-line welcome on attach', () => {
    const welcome = DEVCONTAINER_CONFIG.postAttachCommand ?? '';
    expect(welcome).toContain('bun run test');
    expect(welcome).toContain('bun run dev:web');
    expect(welcome).toContain('starling try');
  });
});

describe('smoke.sh', () => {
  test('is valid bash', () => {
    const result = spawnSync('bash', ['-n', join(ROOT, 'tools/docker/smoke.sh')], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  test('skips cleanly without Docker or a daemon', () => {
    expect(SMOKE).toContain('command -v docker');
    expect(SMOKE).toContain('docker info');
    expect(SMOKE).toContain('docker not installed, skipping');
    expect(SMOKE).toContain('exit 0');
  });

  test('builds, probes health, the run list and the dashboard, then cleans up', () => {
    for (const fragment of [
      'docker build',
      'docker run',
      'docker port',
      '/api/health',
      '/api/runs',
      'id="root"',
      'docker stop',
      'docker rm',
      'docker rmi',
      'trap cleanup EXIT',
    ]) {
      expect(SMOKE).toContain(fragment);
    }
  });
});
