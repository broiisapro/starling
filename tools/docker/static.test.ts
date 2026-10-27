/**
 * Static checks for the container lane (Epic 153) — no Docker daemon required.
 *
 * The build laptops have no Docker, so `docker build` cannot be the thing that catches a typo in a
 * COPY path, an unpinned Bun tag or a `.dockerignore` pattern that hides a source. These tests parse
 * the Dockerfile and `devcontainer.json`, walk every build-context COPY source, and match it against
 * `.dockerignore` with core's `matchesGlob` (the same glob engine lanes and the auditor use).
 *
 * `smoke.sh` is the live check: it runs where a daemon exists and skips everywhere else. Its bash
 * syntax is still checked here.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { matchesGlob } from '../../packages/core/src/index.ts';

const ROOT = resolve(import.meta.dir, '../..');
const BUN_VERSION = readFileSync(join(ROOT, '.bun-version'), 'utf8').trim();
const DOCKERFILE = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
const DOCKERIGNORE = readFileSync(join(ROOT, '.dockerignore'), 'utf8');
const DEVCONTAINER = readFileSync(join(ROOT, '.devcontainer/devcontainer.json'), 'utf8');
const SMOKE = readFileSync(join(ROOT, 'tools/docker/smoke.sh'), 'utf8');

// ── Dockerfile parsing ───────────────────────────────────────────────────────────────────────────────

interface Instruction {
  command: string;
  args: string;
  line: number;
}

interface Stage {
  name: string;
  base: string;
  instructions: Instruction[];
}

interface CopyInstruction {
  from?: string;
  chown?: string;
  sources: string[];
  destination: string;
  line: number;
}

/** Split a Dockerfile into instructions, joining `\\` continuations and dropping comments. */
function parseInstructions(text: string): Instruction[] {
  const instructions: Instruction[] = [];
  let buffer = '';
  let startLine = 0;
  const lines = text.split('\n');
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (buffer === '' && (line === '' || line.startsWith('#'))) continue;
    if (buffer === '') startLine = index + 1;
    if (line.endsWith('\\')) {
      buffer += `${line.slice(0, -1).trim()} `;
      continue;
    }
    buffer += line;
    const match = /^([A-Za-z]+)\s+([\s\S]*)$/.exec(buffer);
    if (match !== null) {
      const command = (match[1] ?? '').toUpperCase();
      instructions.push({ command, args: (match[2] ?? '').trim(), line: startLine });
    }
    buffer = '';
  }
  return instructions;
}

function parseStages(instructions: Instruction[]): Stage[] {
  const stages: Stage[] = [];
  for (const instruction of instructions) {
    if (instruction.command === 'FROM') {
      const match = /^(\S+)(?:\s+AS\s+(\S+))?$/i.exec(instruction.args);
      stages.push({
        name: match?.[2] ?? `stage-${stages.length}`,
        base: match?.[1] ?? instruction.args,
        instructions: [],
      });
      continue;
    }
    stages.at(-1)?.instructions.push(instruction);
  }
  return stages;
}

function parseCopy(instruction: Instruction): CopyInstruction {
  const args = instruction.args.trim();
  if (args.startsWith('[')) {
    const parsed = JSON.parse(args) as string[];
    return {
      sources: parsed.slice(0, -1),
      destination: parsed.at(-1) ?? '',
      line: instruction.line,
    };
  }
  let from: string | undefined;
  let chown: string | undefined;
  const positional: string[] = [];
  for (const token of args.split(/\s+/)) {
    if (token.startsWith('--from=')) from = token.slice('--from='.length);
    else if (token.startsWith('--chown=')) chown = token.slice('--chown='.length);
    else positional.push(token);
  }
  return {
    ...(from === undefined ? {} : { from }),
    ...(chown === undefined ? {} : { chown }),
    sources: positional.slice(0, -1),
    destination: positional.at(-1) ?? '',
    line: instruction.line,
  };
}

const INSTRUCTIONS = parseInstructions(DOCKERFILE);
const STAGES = parseStages(INSTRUCTIONS);

function stage(name: string): Stage {
  const found = STAGES.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`Dockerfile has no stage named ${name}`);
  return found;
}

function copiesOf(target: Stage): CopyInstruction[] {
  return target.instructions.filter((instruction) => instruction.command === 'COPY').map(parseCopy);
}

function instructionsOf(target: Stage, command: string): Instruction[] {
  return target.instructions.filter((instruction) => instruction.command === command);
}

function single(target: Stage, command: string): Instruction {
  const found = instructionsOf(target, command);
  if (found.length !== 1) throw new Error(`expected exactly one ${command} in ${target.name}`);
  return found[0] as Instruction;
}

// ── .dockerignore matching (Docker semantics, minus `!` re-includes) ────────────────────────────────

const IGNORE_PATTERNS = DOCKERIGNORE.split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

/** True when Docker would leave `path` out of the build context. Ancestors count, as in Docker. */
function isIgnored(path: string): boolean {
  const normalized = path.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (normalized === '') return false;
  const segments = normalized.split('/');
  for (const pattern of IGNORE_PATTERNS) {
    for (let i = 1; i <= segments.length; i += 1) {
      if (matchesGlob(segments.slice(0, i).join('/'), pattern)) return true;
    }
  }
  return false;
}

/** Files under `relative` that survive `.dockerignore`; ignored directories are pruned, not walked. */
function contextFiles(relative: string): string[] {
  const absolute = join(ROOT, relative);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return isIgnored(relative) ? [] : [relative];
  const files: string[] = [];
  const visit = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (isIgnored(child)) continue;
      if (entry.isDirectory()) visit(join(dir, entry.name), child);
      else files.push(child);
    }
  };
  visit(absolute, relative);
  return files;
}

// ── workspace inventory (the manifests the lockfile install needs) ──────────────────────────────────

function workspaceManifests(): string[] {
  const members = ['packages', 'apps'].flatMap((group) =>
    readdirSync(join(ROOT, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${group}/${entry.name}/package.json`),
  );
  return ['package.json', ...members];
}

function isCoveredBy(path: string, sources: string[]): boolean {
  return sources.some((source) => path === source || path.startsWith(`${source.replace(/\/$/, '')}/`));
}

// ── devcontainer JSONC ──────────────────────────────────────────────────────────────────────────────

/** Strip `//` and `/* *\/` comments without touching string contents (the file documents itself). */
function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += char;
  }
  return out;
}

interface DevcontainerConfig {
  name?: string;
  build?: { dockerfile?: string; context?: string };
  image?: string;
  postCreateCommand?: string;
  postAttachCommand?: string;
  forwardPorts?: (number | string)[];
  portsAttributes?: Record<string, { label?: string }>;
  customizations?: { vscode?: { extensions?: string[] } };
  remoteEnv?: Record<string, string>;
  remoteUser?: string;
}

const DEVCONTAINER_CONFIG = JSON.parse(stripJsonComments(DEVCONTAINER)) as DevcontainerConfig;
const DEVCONTAINER_DOCKERFILE = readFileSync(
  join(ROOT, '.devcontainer', DEVCONTAINER_CONFIG.build?.dockerfile ?? 'Dockerfile'),
  'utf8',
);

// ── tests ───────────────────────────────────────────────────────────────────────────────────────────

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
