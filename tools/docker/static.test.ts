/**
 * Static checks for the Dockerfile and the build context (Epic 153) — no Docker daemon required.
 *
 * The build laptops have no Docker, so `docker build` cannot be the thing that catches a typo in a
 * COPY path, an unpinned Bun tag or a `.dockerignore` pattern that hides a source. These tests parse
 * the Dockerfile, walk every build-context COPY source, and match it against `.dockerignore` with
 * core's `matchesGlob` (the same glob engine lanes and the auditor use). The devcontainer and the
 * smoke script are covered in `devcontainer.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUN_VERSION,
  contextFiles,
  copiesOf,
  IGNORE_PATTERNS,
  INSTRUCTIONS,
  instructionsOf,
  isCoveredBy,
  isIgnored,
  ROOT,
  STAGES,
  single,
  stage,
  workspaceManifests,
} from './static-support.ts';

describe('Dockerfile', () => {
  test('has a build and a runtime stage', () => {
    expect(STAGES.map((candidate) => candidate.name)).toEqual(['build', 'runtime']);
    expect(stage('build').base.startsWith('oven/bun:')).toBe(true);
    expect(stage('runtime').base.startsWith('oven/bun:')).toBe(true);
  });

  test('both stages pin the Bun version from .bun-version', () => {
    expect(stage('build').base).toBe(`oven/bun:${BUN_VERSION}`);
    expect(stage('runtime').base).toBe(`oven/bun:${BUN_VERSION}-slim`);
  });

  test('no stage floats on :latest', () => {
    for (const candidate of STAGES) expect(candidate.base.endsWith(':latest')).toBe(false);
  });

  test('uses COPY, never ADD', () => {
    expect(INSTRUCTIONS.some((instruction) => instruction.command === 'ADD')).toBe(false);
  });

  test('installs from the lockfile with a cacheable manifest layer', () => {
    const install = instructionsOf(stage('build'), 'RUN').find((instruction) =>
      instruction.args.includes('bun install'),
    );
    expect(install).toBeDefined();
    expect(install?.args).toContain('--frozen-lockfile');

    const manifests = copiesOf(stage('build')).filter(
      (copy) => copy.from === undefined && copy.line < (install?.line ?? 0),
    );
    const copied = manifests.flatMap((copy) => copy.sources);
    for (const manifest of workspaceManifests()) expect(copied).toContain(manifest);
    expect(copied).toContain('bun.lock');
    // Copying the whole source tree before installing would defeat the layer cache.
    expect(copied).not.toContain('packages');
    expect(copied).not.toContain('apps');
  });

  test('copies sources only after the install and builds the dashboard', () => {
    const install = instructionsOf(stage('build'), 'RUN').find((instruction) =>
      instruction.args.includes('bun install'),
    );
    const sources = copiesOf(stage('build')).filter(
      (copy) => copy.from === undefined && copy.line > (install?.line ?? 0),
    );
    const copied = sources.flatMap((copy) => copy.sources);
    expect(copied).toContain('packages');
    expect(copied).toContain('apps');
    for (const copy of sources) expect(copy.chown).toBeUndefined();

    const build = instructionsOf(stage('build'), 'RUN').map((instruction) => instruction.args);
    expect(build.some((args) => /bun run --cwd apps\/web build/.test(args))).toBe(true);
  });

  test('the runtime copies exactly the demo surface', () => {
    const copies = copiesOf(stage('runtime'));
    const fromBuild = copies
      .filter((copy) => copy.from === 'build')
      .flatMap((copy) => copy.sources)
      .sort();
    const fromContext = copies
      .filter((copy) => copy.from === undefined)
      .flatMap((copy) => copy.sources)
      .sort();

    expect(fromBuild).toEqual([
      '/app/apps/server',
      '/app/apps/web/dist',
      '/app/node_modules',
      '/app/packages/core',
    ]);
    expect(fromContext).toEqual(['fixtures/runs', 'tools/docker']);
    for (const copy of copies) expect(copy.chown).toBe('bun:bun');
  });

  test('runs as the unprivileged bun user and never installs at runtime', () => {
    const user = single(stage('runtime'), 'USER');
    expect(user.args).toBe('bun');
    expect(user.args).not.toBe('root');
    expect(user.args).not.toBe('0');
    expect(instructionsOf(stage('runtime'), 'RUN')).toEqual([]);
  });

  test('exposes 7777 and stops on SIGTERM', () => {
    expect(single(stage('runtime'), 'EXPOSE').args).toBe('7777');
    expect(single(stage('runtime'), 'STOPSIGNAL').args).toBe('SIGTERM');
  });

  test('healthcheck probes /api/health with Bun, honouring PORT', () => {
    const healthcheck = single(stage('runtime'), 'HEALTHCHECK').args;
    expect(healthcheck).toContain('/api/health');
    expect(healthcheck).toContain('127.0.0.1');
    expect(healthcheck).toContain('process.env.PORT');
    expect(healthcheck).toContain('process.exit');
  });

  test('entrypoint runs the Docker demo', () => {
    const entrypoint = JSON.parse(single(stage('runtime'), 'ENTRYPOINT').args) as string[];
    expect(entrypoint).toEqual(['bun', 'tools/docker/demo.ts']);
    expect(existsSync(join(ROOT, 'tools/docker/demo.ts'))).toBe(true);
  });

  test('sets the documented demo defaults', () => {
    const env = instructionsOf(stage('runtime'), 'ENV')
      .map((instruction) => instruction.args)
      .join(' ');
    expect(env).toContain('STARLING_PORT=7777');
    expect(env).toContain('STARLING_DEMO_SPEED=8');
    expect(env).toContain('STARLING_DEMO_FIXTURE=/app/fixtures/runs/sky-todo-launch-day.jsonl');
  });
});

describe('.dockerignore vs the build context', () => {
  const contextCopies = STAGES.flatMap((candidate) =>
    copiesOf(candidate).filter((copy) => copy.from === undefined),
  );
  const sources = [...new Set(contextCopies.flatMap((copy) => copy.sources))];

  test('every COPY source exists in the repo', () => {
    for (const source of sources) expect(existsSync(join(ROOT, source))).toBe(true);
  });

  test('no COPY source is hidden by .dockerignore', () => {
    for (const source of sources) expect(isIgnored(source)).toBe(false);
  });

  test('the sources still carry the files the build and the demo need', () => {
    const required = [
      'package.json',
      'bun.lock',
      'tsconfig.base.json',
      'apps/web/index.html',
      'apps/web/vite.config.ts',
      'apps/web/src/main.tsx',
      'apps/server/src/index.ts',
      'packages/core/src/index.ts',
      'fixtures/runs/sky-todo-launch-day.jsonl',
      'tools/docker/demo.ts',
    ];
    for (const path of required) {
      expect(existsSync(join(ROOT, path))).toBe(true);
      expect(isIgnored(path)).toBe(false);
      expect(isCoveredBy(path, sources)).toBe(true);
    }
  });

  test('ignores the heavy and private trees', () => {
    const ignored = [
      '.git/config',
      'node_modules/zod/index.js',
      'apps/web/node_modules/react/index.js',
      'apps/web/dist/index.html',
      '.starling/starling.db',
      'starling.db-wal',
      '.orchestrator/PRD.md',
      'Claude outputs/notes.md',
      'tools/load/results/engine.json',
      'tools/release/dist/starling.js',
      'site/dist/index.html',
      'apps/web/e2e/__screenshots__/sky.png',
      'npm-debug.log',
      '.env',
      'apps/server/.env.local',
    ];
    for (const path of ignored) expect(isIgnored(path)).toBe(true);
  });

  test('keeps the manifests, sources and fixture the image copies', () => {
    const kept = [
      'package.json',
      'bun.lock',
      'apps/web/package.json',
      'apps/web/src/index.css',
      'fixtures/runs/sky-todo-launch-day.jsonl',
      'tools/docker/demo.ts',
      'Dockerfile',
      '.devcontainer/devcontainer.json',
    ];
    for (const path of kept) expect(isIgnored(path)).toBe(false);
  });

  test('uses no re-include patterns (the matcher and the docs assume none)', () => {
    expect(IGNORE_PATTERNS.some((pattern) => pattern.startsWith('!'))).toBe(false);
  });

  test('a walk of the copied sources is non-empty and contains no ignored file', () => {
    for (const source of sources.filter((candidate) => statSync(join(ROOT, candidate)).isDirectory())) {
      const files = contextFiles(source);
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) expect(isIgnored(file)).toBe(false);
    }
  });
});
