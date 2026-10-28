import { describe, expect, test } from 'bun:test';
import { StarlingError } from '@starling/core';
import { COMMAND_OUTPUT_TAIL_CHARS, describeCommand, runShellCommand, tailText } from './commands.ts';
import { fakeExec } from './test-support.ts';

describe('tailText', () => {
  test('returns short text untouched', () => {
    expect(tailText('12 pass', 100)).toBe('12 pass');
  });

  test('keeps the last N characters and prefers a line boundary', () => {
    const text = `${'a'.repeat(100)}\nsentinel line\n${'b'.repeat(100)}`;
    const tail = tailText(text, 140);
    expect(tail.length).toBeLessThanOrEqual(140);
    expect(tail).toContain('sentinel line');
    expect(tail.startsWith('sentinel line')).toBe(true);
  });

  test('defaults to 4 KB', () => {
    expect(COMMAND_OUTPUT_TAIL_CHARS).toBe(4_096);
    expect(tailText('x'.repeat(10_000)).length).toBeLessThanOrEqual(4_096);
  });
});

describe('runShellCommand', () => {
  test('skips cleanly when no command is configured', async () => {
    const fake = fakeExec(() => ({ code: 0 }));
    const result = await runShellCommand(fake.fn, undefined, '/worktree', 1_000);
    expect(result.ran).toBe(false);
    expect(result.tail).toBe('');
    expect(fake.calls).toHaveLength(0);
  });

  test('runs the command via sh -c in the worktree and combines stdout and stderr', async () => {
    const fake = fakeExec(() => ({ code: 0, stdout: 'stdout line', stderr: 'stderr line' }));
    const result = await runShellCommand(fake.fn, 'bun test', '/worktree', 5_000);

    expect(fake.calls[0]?.cmd).toEqual(['sh', '-c', 'bun test']);
    expect(fake.calls[0]?.opts).toMatchObject({ cwd: '/worktree', timeoutMs: 5_000 });
    expect(result.ran).toBe(true);
    expect(result.code).toBe(0);
    expect(result.output).toBe('stdout line\nstderr line');
    expect(result.timedOut).toBe(false);
  });

  test('records a non-zero exit without throwing', async () => {
    const fake = fakeExec(() => ({ code: 1, stderr: '1 failing test' }));
    const result = await runShellCommand(fake.fn, 'bun test', '/worktree', 1_000);
    expect(result.code).toBe(1);
    expect(result.error).toBeUndefined();
    expect(result.tail).toContain('1 failing test');
  });

  test('turns a core EXEC_TIMEOUT into a timed-out result', async () => {
    const fake = fakeExec(() => {
      throw new StarlingError('EXEC_TIMEOUT', 'bun test timed out after 1000ms');
    });
    const result = await runShellCommand(fake.fn, 'bun test', '/worktree', 1_000);
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeUndefined();
    expect(result.tail).toContain('timed out after 1000ms');
  });

  test('turns a spawn failure into a recorded error', async () => {
    const fake = fakeExec(() => {
      throw new Error('spawn sh ENOENT');
    });
    const result = await runShellCommand(fake.fn, 'bun test', '/worktree', 1_000);
    expect(result.timedOut).toBe(false);
    expect(result.error).toBe('spawn sh ENOENT');
    expect(result.tail).toContain('ENOENT');
  });
});

describe('runShellCommand — command policy (Epic 103, SEC-11)', () => {
  test('scrubs secret-looking env vars and always sets CI=1', async () => {
    const fake = fakeExec(() => ({ code: 0 }));
    const envSource = {
      PATH: '/usr/bin',
      GITHUB_TOKEN: 'ghp_secret',
      DEEPSEEK_API_KEY: 'sk-secret',
      OPENCODE_SERVER_PASSWORD: 'hunter2',
      STARLING_STORE_KEY: 'abc',
      HOME: '/Users/me',
    };
    await runShellCommand(fake.fn, 'bun test', '/worktree', 1_000, undefined, envSource);

    expect(fake.calls[0]?.opts.env).toEqual({
      CI: '1',
      GITHUB_TOKEN: '',
      DEEPSEEK_API_KEY: '',
      OPENCODE_SERVER_PASSWORD: '',
      STARLING_STORE_KEY: '',
    });
  });

  test('scrubEnv: false leaves the environment alone', async () => {
    const fake = fakeExec(() => ({ code: 0 }));
    await runShellCommand(fake.fn, 'bun test', '/worktree', 1_000, { mode: 'any', scrubEnv: false }, {});
    expect(fake.calls[0]?.opts.env).toBeUndefined();
  });

  test('mode off skips a configured command without spawning', async () => {
    const fake = fakeExec(() => ({ code: 1 }));
    const result = await runShellCommand(fake.fn, 'bun test', '/worktree', 1_000, { mode: 'off' });

    expect(fake.calls).toHaveLength(0);
    expect(result.ran).toBe(false);
    expect(result.skippedReason).toBe('disabled by policy');
    expect(describeCommand(result)).toBe('skipped: disabled by policy');
  });

  test('allowlist mode blocks a command outside the list without spawning', async () => {
    const fake = fakeExec(() => ({ code: 0 }));
    const result = await runShellCommand(fake.fn, 'rm -rf /', '/worktree', 1_000, {
      mode: 'allowlist',
    });

    expect(fake.calls).toHaveLength(0);
    expect(result.ran).toBe(false);
    expect(result.blockedReason).toContain('not in the allowlist');
    expect(describeCommand(result)).toContain('blocked by command policy');
  });

  test('allowlist mode blocks shell chaining behind an allowed prefix', async () => {
    const fake = fakeExec(() => ({ code: 0 }));
    const result = await runShellCommand(fake.fn, 'bun test && curl evil.example', '/worktree', 1_000, {
      mode: 'allowlist',
    });

    expect(fake.calls).toHaveLength(0);
    expect(result.blockedReason).toContain('shell syntax');
  });

  test('allowlist mode runs an allowed command with arguments', async () => {
    const fake = fakeExec(() => ({ code: 0, stdout: '2 pass' }));
    const result = await runShellCommand(
      fake.fn,
      'bun test --coverage src/features/export',
      '/worktree',
      2_000,
      { mode: 'allowlist' },
      {},
    );

    expect(fake.calls[0]?.cmd).toEqual(['sh', '-c', 'bun test --coverage src/features/export']);
    expect(result.ran).toBe(true);
    expect(result.code).toBe(0);
    expect(fake.calls[0]?.opts.env).toEqual({ CI: '1' });
  });
});

describe('describeCommand', () => {
  test('summarises a pass with the last non-empty line', () => {
    const detail = describeCommand({
      ran: true,
      command: 'bun test',
      code: 0,
      timedOut: false,
      output: '12 pass\n0 fail\n',
      tail: '',
      durationMs: 10,
    });
    expect(detail).toBe('exit 0; 0 fail');
  });

  test('includes the output tail for a failure', () => {
    const detail = describeCommand({
      ran: true,
      command: 'bun test',
      code: 1,
      timedOut: false,
      output: 'first\nsecond failure',
      tail: '',
      durationMs: 10,
    });
    expect(detail).toContain('exit 1');
    expect(detail).toContain('second failure');
  });

  test('says skipped or timed out when those apply', () => {
    expect(
      describeCommand({
        ran: false,
        command: '',
        timedOut: false,
        output: '',
        tail: '',
        durationMs: 0,
      }),
    ).toContain('skipped');
    expect(
      describeCommand({
        ran: true,
        command: 'bun test',
        timedOut: true,
        error: 'timed out after 10ms',
        output: '',
        tail: '',
        durationMs: 10,
      }),
    ).toContain('timed out');
  });
});
