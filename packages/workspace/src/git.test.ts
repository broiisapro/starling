import { describe, expect, test } from 'bun:test';
import type { ExecResult } from '@starling/core';
import { isStarlingError } from '@starling/core';
import { type ExecLike, Git, isLockContention } from './git.ts';
import { KeyedMutex, sleep } from './mutex.ts';
import { GIT_TOO_OLD_CODE } from './version.ts';

type Handler = (cmd: string[], opts: { cwd: string }) => ExecResult | Promise<ExecResult>;

interface FakeExec extends ExecLike {
  calls: { cmd: string[]; opts: { cwd: string; env?: Record<string, string | undefined> } }[];
}

function result(partial: Partial<ExecResult> = {}): ExecResult {
  return { code: 0, stdout: '', stderr: '', durationMs: 1, ...partial };
}

/** A scripted `exec`. The handler receives each argv and the call's options. */
function fakeExec(handler: Handler): FakeExec {
  const calls: FakeExec['calls'] = [];
  const fn = (async (cmd: string[], opts: { cwd: string; env?: Record<string, string | undefined> }) => {
    calls.push({ cmd, opts });
    return handler(cmd, opts);
  }) as FakeExec;
  fn.calls = calls;
  return fn;
}

const LOCK_ERROR = "fatal: Unable to create '/repo/.git/index.lock': File exists.";

describe('isLockContention', () => {
  test('recognises the common contention messages', () => {
    expect(isLockContention(LOCK_ERROR)).toBe(true);
    expect(isLockContention("fatal: cannot lock ref 'refs/heads/x'")).toBe(true);
    expect(isLockContention('fatal: another git process seems to be running')).toBe(true);
  });

  test('ignores ordinary failures', () => {
    expect(isLockContention('fatal: not a git repository')).toBe(false);
    expect(isLockContention('')).toBe(false);
  });
});

describe('Git', () => {
  test('passes argv (never a shell string) and asks git not to prompt', async () => {
    const exec = fakeExec(() => result({ stdout: 'ok\n' }));
    const git = new Git(exec, new KeyedMutex(), { retryDelayMs: 1 });

    const out = await git.text(['status', '--short'], { cwd: '/repo' });

    expect(out).toBe('ok');
    expect(exec.calls[0]?.cmd).toEqual(['git', 'status', '--short']);
    expect(exec.calls[0]?.opts.env?.GIT_TERMINAL_PROMPT).toBe('0');
  });

  test('retries once after lock contention, then succeeds', async () => {
    let attempt = 0;
    const exec = fakeExec(() => {
      attempt += 1;
      return attempt === 1 ? result({ code: 128, stderr: LOCK_ERROR }) : result({ stdout: 'done' });
    });
    const git = new Git(exec, new KeyedMutex(), { retryDelayMs: 1 });

    const out = await git.text(['add', '-A'], { cwd: '/repo' });
    expect(out).toBe('done');
    expect(exec.calls.length).toBe(2);
  });

  test('does not retry a normal failure and throws WORKSPACE_ERROR with details', async () => {
    const exec = fakeExec(() => result({ code: 128, stderr: 'fatal: not a git repository' }));
    const git = new Git(exec, new KeyedMutex(), { retryDelayMs: 1 });

    try {
      await git.ok(['status'], { cwd: '/repo' });
      throw new Error('expected a throw');
    } catch (err) {
      expect(isStarlingError(err, 'WORKSPACE_ERROR')).toBe(true);
      expect((err as { message: string }).message).toContain('not a git repository');
      expect((err as { details?: { code?: number } }).details?.code).toBe(128);
    }
    expect(exec.calls.length).toBe(1);
  });

  test('gives up after a single retry', async () => {
    const exec = fakeExec(() => result({ code: 128, stderr: LOCK_ERROR }));
    const git = new Git(exec, new KeyedMutex(), { retryDelayMs: 1 });

    await expect(git.ok(['add', '-A'], { cwd: '/repo' })).rejects.toThrow();
    expect(exec.calls.length).toBe(2);
  });

  test('caches the parsed git version', async () => {
    const exec = fakeExec(() => result({ stdout: 'git version 2.54.0 (Apple Git-155)\n' }));
    const git = new Git(exec, new KeyedMutex(), { retryDelayMs: 1 });

    expect(await git.version('/repo')).toEqual({ major: 2, minor: 54, patch: 0 });
    expect(await git.version('/repo')).toEqual({ major: 2, minor: 54, patch: 0 });
    expect(exec.calls.length).toBe(1);
  });

  test('requireVersion throws GIT_TOO_OLD for an old git', async () => {
    const exec = fakeExec(() => result({ stdout: 'git version 2.30.1\n' }));
    const git = new Git(exec, new KeyedMutex(), { retryDelayMs: 1 });

    try {
      await git.requireVersion(undefined, '/repo');
      throw new Error('expected a throw');
    } catch (err) {
      expect(isStarlingError(err) && err.code === GIT_TOO_OLD_CODE).toBe(true);
    }
  });

  test('a lock serialises calls that share a key', async () => {
    let active = 0;
    let peak = 0;
    const exec = fakeExec(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(5);
      active -= 1;
      return result();
    });
    const git = new Git(exec, new KeyedMutex(), { retryDelayMs: 1 });

    await Promise.all([
      git.run(['one'], { cwd: '/repo', lock: 'repo' }),
      git.run(['two'], { cwd: '/repo', lock: 'repo' }),
      git.run(['three'], { cwd: '/other', lock: 'other-repo' }),
    ]);

    expect(peak).toBe(2); // one from each repo, never two from the same one
  });

  test('lock() holds the mutex across a sequence of calls', async () => {
    const events: string[] = [];
    const exec = fakeExec(async (cmd) => {
      events.push(cmd[1] ?? '');
      await sleep(5);
      events.push(`${cmd[1] ?? ''}-done`);
      return result();
    });
    const git = new Git(exec, new KeyedMutex(), { retryDelayMs: 1 });

    await Promise.all([
      git.lock('repo', async () => {
        await git.attempt(['first'], { cwd: '/repo' });
        await git.attempt(['second'], { cwd: '/repo' });
      }),
      git.lock('repo', async () => {
        await git.attempt(['third'], { cwd: '/repo' });
      }),
    ]);

    expect(events).toEqual(['first', 'first-done', 'second', 'second-done', 'third', 'third-done']);
  });
});
