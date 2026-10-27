import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASH = '/bin/bash';
const SCRIPTS = import.meta.dir;
const SCRIPT_NAMES = ['plan.sh', 'run.sh', 'status.sh', 'replay-demo.sh'];

const ROOT = mkdtempSync(join(tmpdir(), 'starling-scripts-'));
const BIN = join(ROOT, 'bin');
const EMPTY_BIN = join(ROOT, 'empty-bin');
const HOME = join(ROOT, 'home');

mkdirSync(BIN, { recursive: true });
mkdirSync(EMPTY_BIN, { recursive: true });
mkdirSync(HOME, { recursive: true });
// The missing-CLI test needs `dirname` (used by the init code) but nothing else.
try {
  symlinkSync('/usr/bin/dirname', join(EMPTY_BIN, 'dirname'));
} catch {
  // A previous partial run may have left the link; it is not a test failure.
}

// A fake `starling` that records argv and exits with a configurable status.
writeFileSync(
  join(BIN, 'starling'),
  ['#!/usr/bin/env bash', 'printf "%s\\n" "$*" >> "$FAKE_STARLING_LOG"', ''].join('\n'),
  { mode: 0o755 },
);

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(
  cmd: string[],
  opts: { cwd?: string; path?: string; env?: Record<string, string> } = {},
): RunResult {
  const proc = Bun.spawnSync({
    cmd,
    cwd: opts.cwd ?? ROOT,
    env: {
      ...process.env,
      STARLING_BIN: '',
      BUN_BIN: '',
      PATH: opts.path ?? `${BIN}:${process.env.PATH ?? ''}`,
      HOME,
      ...opts.env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function logPath(name: string): string {
  return join(ROOT, `argv-${name}.log`);
}

function readLog(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
}

function newCwd(name: string): string {
  const dir = join(ROOT, `cwd-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeBudget(cwd: string, value: string): void {
  writeFileSync(join(cwd, 'starling.config.yaml'), `budget:\n  maxUsd: ${value}\n`);
}

function script(name: string): string {
  return join(SCRIPTS, name);
}

describe('all shell scripts', () => {
  test('pass bash -n', () => {
    const files = ['lib.sh', ...SCRIPT_NAMES];
    for (const file of files) {
      const result = run([BASH, '-n', script(file)]);
      expect({ file, code: result.code, stderr: result.stderr }).toEqual({
        file,
        code: 0,
        stderr: '',
      });
    }
  });

  test('print usage on --help and exit 0', () => {
    for (const file of SCRIPT_NAMES) {
      const result = run([BASH, script(file), '--help']);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('usage:');
    }
  });
});

describe('plan.sh', () => {
  test('forces --json so agents can parse the plan', () => {
    const log = logPath('plan-json');
    const result = run([BASH, script('plan.sh'), 'Add dark mode'], { env: { FAKE_STARLING_LOG: log } });
    expect(result.code).toBe(0);
    expect(readLog(log)).toBe('plan --json Add dark mode');
  });

  test('--pretty leaves the CLI output alone and forwards flags', () => {
    const log = logPath('plan-pretty');
    const result = run([BASH, script('plan.sh'), '--pretty', '--repo', '../sky-todo', 'Fix dates'], {
      env: { FAKE_STARLING_LOG: log },
    });
    expect(result.code).toBe(0);
    expect(readLog(log)).toBe('plan --repo ../sky-todo Fix dates');
  });

  test('refuses to run without a goal', () => {
    const result = run([BASH, script('plan.sh')]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('needs a goal');
  });
});

describe('run.sh', () => {
  test('--dry-run skips the budget preflight and forwards to starling run', () => {
    const log = logPath('run-dry');
    const result = run([BASH, script('run.sh'), '--dry-run', '--repo', '.', 'Go'], {
      env: { FAKE_STARLING_LOG: log },
    });
    expect(result.code).toBe(0);
    expect(readLog(log)).toBe('run --dry-run --repo . Go');
  });

  test('refuses a real run when no budget is configured', () => {
    const log = logPath('run-nobudget');
    const result = run([BASH, script('run.sh'), 'Go'], {
      cwd: newCwd('nobudget'),
      env: { FAKE_STARLING_LOG: log },
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('refusing to launch without a budget');
    expect(result.stderr).toContain('budget.maxUsd');
    expect(readLog(log)).toBe('');
  });

  test('launches when starling.config.yaml has a numeric budget', () => {
    const log = logPath('run-budget');
    const cwd = newCwd('budget');
    writeBudget(cwd, '2');
    const result = run([BASH, script('run.sh'), 'Go'], { cwd, env: { FAKE_STARLING_LOG: log } });
    expect(result.code).toBe(0);
    expect(readLog(log)).toBe('run Go');
  });

  test('--budget below the configured budget is refused', () => {
    const cwd = newCwd('budget-low');
    writeBudget(cwd, '2');
    const result = run([BASH, script('run.sh'), '--budget', '1', 'Go'], { cwd });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('configured budget.maxUsd is 2');
  });

  test('--budget above the configured budget is accepted', () => {
    const log = logPath('run-budget-high');
    const cwd = newCwd('budget-high');
    writeBudget(cwd, '2');
    const result = run([BASH, script('run.sh'), '--budget=3', 'Go'], {
      cwd,
      env: { FAKE_STARLING_LOG: log },
    });
    expect(result.code).toBe(0);
    expect(readLog(log)).toBe('run Go');
  });

  test('rejects a non-numeric budget before calling starling', () => {
    const result = run([BASH, script('run.sh'), '--budget', 'lots', 'Go']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('must be a number');
  });

  test('--yes accepts a missing budget but warns', () => {
    const log = logPath('run-yes');
    const result = run([BASH, script('run.sh'), '--yes', 'Go'], {
      cwd: newCwd('yes'),
      env: { FAKE_STARLING_LOG: log },
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('warning: no budget.maxUsd');
    expect(readLog(log)).toBe('run Go');
  });

  test('refuses to run without a goal', () => {
    const result = run([BASH, script('run.sh'), '--dry-run']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('needs a goal');
  });

  test('reports usage before the budget check when there are no arguments at all', () => {
    const result = run([BASH, script('run.sh')], { cwd: newCwd('no-args') });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('needs a goal');
    expect(result.stderr).not.toContain('refusing to launch');
  });
});

describe('status.sh and replay-demo.sh', () => {
  test('status.sh forwards the run id', () => {
    const log = logPath('status');
    const result = run([BASH, script('status.sh'), '01ABC'], { env: { FAKE_STARLING_LOG: log } });
    expect(result.code).toBe(0);
    expect(readLog(log)).toBe('status 01ABC');
  });

  test('replay-demo.sh replays the bundled fixture at speed 4 by default', () => {
    const log = logPath('replay-default');
    const result = run([BASH, script('replay-demo.sh')], { env: { FAKE_STARLING_LOG: log } });
    expect(result.code).toBe(0);
    const argv = readLog(log);
    expect(argv).toContain('replay');
    expect(argv).toContain('fixtures/runs/sky-todo-launch-day.jsonl');
    expect(argv).toContain('--speed 4');
  });

  test('replay-demo.sh honours --speed', () => {
    const log = logPath('replay-speed');
    const result = run([BASH, script('replay-demo.sh'), '--speed', '2'], {
      env: { FAKE_STARLING_LOG: log },
    });
    expect(result.code).toBe(0);
    expect(readLog(log)).toContain('--speed 2');
  });

  test('replay-demo.sh rejects unknown flags and bad speeds', () => {
    const unknown = run([BASH, script('replay-demo.sh'), '--bogus']);
    expect(unknown.code).toBe(2);
    const bad = run([BASH, script('replay-demo.sh'), '--speed', 'fast']);
    expect(bad.code).toBe(2);
  });
});

describe('missing CLI', () => {
  test('exits 127 with a clear message when starling cannot be found', () => {
    const isolated = join(ROOT, 'isolated');
    const scripts = join(isolated, 'skills', 'starling', 'scripts');
    mkdirSync(scripts, { recursive: true });
    for (const file of ['lib.sh', 'plan.sh']) {
      copyFileSync(script(file), join(scripts, file));
    }
    chmodSync(join(scripts, 'plan.sh'), 0o755);

    const result = run([BASH, join(scripts, 'plan.sh'), 'anything'], {
      cwd: isolated,
      path: EMPTY_BIN,
      env: { HOME: join(isolated, 'home') },
    });
    expect(result.code).toBe(127);
    expect(result.stderr).toContain('starling not found');
    expect(result.stderr).toContain('troubleshooting.md');
  });
});
