import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const BASH = '/bin/bash';
const INTEGRATION_DIR = import.meta.dir;
const REPO_ROOT = resolve(INTEGRATION_DIR, '../..');
const INSTALL = join(INTEGRATION_DIR, 'install.sh');
const SKILL_SRC = join(REPO_ROOT, 'skills', 'starling');

const ROOT = mkdtempSync(join(tmpdir(), 'starling-install-test-'));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runInstall(args: string[], cwd: string, home: string): RunResult {
  const proc = Bun.spawnSync({
    cmd: [BASH, INSTALL, ...args],
    cwd,
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: '' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

/** Fresh project + HOME for one test. */
function sandbox(name: string): { cwd: string; home: string } {
  const base = join(ROOT, name);
  const cwd = join(base, 'project');
  const home = join(base, 'home');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { cwd, home };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out.sort();
}

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of walk(dir)) out[relative(dir, file)] = readFileSync(file, 'utf8');
  return out;
}

describe('install.sh interface', () => {
  test('prints usage on --help', () => {
    const { cwd, home } = sandbox('help');
    const result = runInstall(['--help'], cwd, home);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('usage: install.sh');
    expect(result.stdout).toContain('--project');
    expect(result.stdout).toContain('--global');
  });

  test('rejects an unknown flag', () => {
    const { cwd, home } = sandbox('unknown');
    const result = runInstall(['--nope'], cwd, home);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('unknown argument');
  });

  test('is valid bash and executable', () => {
    expect(run([BASH, '-n', INSTALL]).code).toBe(0);
    expect(statSync(INSTALL).mode & 0o111).toBeGreaterThan(0);
  });
});

describe('install.sh --project', () => {
  test('creates the skill and command under .opencode and copies them faithfully', () => {
    const { cwd, home } = sandbox('project');
    const result = runInstall(['--project'], cwd, home);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Starling → opencode install (project)');
    expect(result.stdout).toContain('skills/starling');
    expect(result.stdout).toContain('commands/swarm.md');

    const installedSkill = join(cwd, '.opencode', 'skills', 'starling');
    expect(existsSync(join(installedSkill, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(installedSkill, 'reference', 'goals.md'))).toBe(true);
    expect(existsSync(join(installedSkill, 'reference', 'lanes.md'))).toBe(true);
    expect(existsSync(join(installedSkill, 'reference', 'flock.md'))).toBe(true);
    expect(existsSync(join(installedSkill, 'reference', 'troubleshooting.md'))).toBe(true);
    expect(existsSync(join(installedSkill, 'scripts', 'plan.sh'))).toBe(true);
    expect(existsSync(join(installedSkill, 'examples', 'launch-day.md'))).toBe(true);
    expect(existsSync(join(cwd, '.opencode', 'commands', 'swarm.md'))).toBe(true);

    expect(readFileSync(join(installedSkill, 'SKILL.md'), 'utf8')).toBe(
      readFileSync(join(SKILL_SRC, 'SKILL.md'), 'utf8'),
    );
    expect(readFileSync(join(cwd, '.opencode', 'commands', 'swarm.md'), 'utf8')).toBe(
      readFileSync(join(INTEGRATION_DIR, 'commands', 'swarm.md'), 'utf8'),
    );

    // Scripts must stay runnable after the copy.
    for (const name of ['plan.sh', 'run.sh', 'status.sh', 'replay-demo.sh']) {
      const mode = statSync(join(installedSkill, 'scripts', name)).mode;
      expect(mode & 0o111).toBeGreaterThan(0);
    }

    // Dev-only tests and editor droppings are not part of an installed skill.
    const installedFiles = walk(installedSkill);
    expect(installedFiles.some((file) => file.endsWith('.test.ts'))).toBe(false);
    expect(installedFiles.some((file) => file.endsWith('.DS_Store'))).toBe(false);

    // A project install must not write into the global config.
    expect(existsSync(join(home, '.config', 'opencode'))).toBe(false);
  });

  test('is idempotent: a second run changes nothing and reports unchanged', () => {
    const { cwd, home } = sandbox('idempotent');
    expect(runInstall(['--project'], cwd, home).code).toBe(0);
    const before = snapshot(join(cwd, '.opencode'));

    const second = runInstall(['--project'], cwd, home);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('unchanged');
    expect(snapshot(join(cwd, '.opencode'))).toEqual(before);
  });

  test('does not delete unrelated commands in the target directory', () => {
    const { cwd, home } = sandbox('unrelated');
    const commands = join(cwd, '.opencode', 'commands');
    mkdirSync(commands, { recursive: true });
    writeFileSync(join(commands, 'other.md'), 'keep me\n');

    expect(runInstall(['--project'], cwd, home).code).toBe(0);
    expect(readFileSync(join(commands, 'other.md'), 'utf8')).toBe('keep me\n');
    expect(existsSync(join(commands, 'swarm.md'))).toBe(true);
  });

  test('the installed SKILL.md still parses as a portable skill', () => {
    const { cwd, home } = sandbox('frontmatter');
    expect(runInstall(['--project'], cwd, home).code).toBe(0);
    const text = readFileSync(join(cwd, '.opencode', 'skills', 'starling', 'SKILL.md'), 'utf8');
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
    expect(match).not.toBeNull();
    const meta = Bun.YAML.parse(match?.[1] ?? '') as Record<string, unknown>;
    expect(meta.name).toBe('starling');
    expect(String(meta.description).length).toBeLessThanOrEqual(1024);
  });
});

describe('install.sh --global and --dir', () => {
  test('--global writes to $XDG_CONFIG_HOME or ~/.config/opencode', () => {
    const { cwd, home } = sandbox('global');
    const result = runInstall(['--global'], cwd, home);
    expect(result.code).toBe(0);
    const base = join(home, '.config', 'opencode');
    expect(existsSync(join(base, 'skills', 'starling', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(base, 'commands', 'swarm.md'))).toBe(true);
    expect(existsSync(join(cwd, '.opencode'))).toBe(false);
  });

  test('--dir targets an explicit config directory', () => {
    const { cwd, home } = sandbox('dir');
    const target = join(cwd, 'claude-config');
    const result = runInstall(['--dir', target], cwd, home);
    expect(result.code).toBe(0);
    expect(existsSync(join(target, 'skills', 'starling', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(target, 'commands', 'swarm.md'))).toBe(true);
  });

  test('--dry-run reports actions but writes nothing', () => {
    const { cwd, home } = sandbox('dry-run');
    const result = runInstall(['--project', '--dry-run'], cwd, home);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('would install');
    expect(existsSync(join(cwd, '.opencode'))).toBe(false);
  });
});

describe('swarm command', () => {
  test('has frontmatter and uses $ARGUMENTS as the goal', () => {
    const text = readFileSync(join(INTEGRATION_DIR, 'commands', 'swarm.md'), 'utf8');
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
    expect(match).not.toBeNull();
    const meta = Bun.YAML.parse(match?.[1] ?? '') as Record<string, unknown>;
    expect(typeof meta.description).toBe('string');
    expect(String(meta.description).length).toBeGreaterThan(10);
    expect(text).toContain('$ARGUMENTS');
    expect(text).toContain('plan.sh');
    expect(text).toContain('run.sh');
    expect(text.toLowerCase()).toContain('confirm');
  });
});

/** Local helper so the top of the file reads cleanly. */
function run(cmd: string[]): RunResult {
  const proc = Bun.spawnSync({ cmd, stdout: 'pipe', stderr: 'pipe' });
  return {
    code: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}
