import { describe, expect, test } from 'bun:test';
import type { ExecOptions, ExecResult } from '@starling/core';
import { StarlingError } from '@starling/core';
import { isGitHubError } from './errors';
import {
  backoffMs,
  clampBody,
  GhClient,
  GITHUB_MAX_BODY_CHARS,
  isRetryableGhFailure,
  parseGitHubRemote,
} from './gh';
import { FakeGh, REAL_BODY_LIMIT } from './testing/fake-gh';
import { CWD, REPO } from './testing/fixtures';

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '', durationMs: 1 });

function clientFor(fake: FakeGh, overrides: Partial<ConstructorParameters<typeof GhClient>[0]> = {}) {
  const sleeps: number[] = [];
  const warnings: string[] = [];
  const client = new GhClient({
    cwd: CWD,
    execFn: fake.exec,
    dryRun: false,
    log: [],
    repo: REPO,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    warn: (message) => warnings.push(message),
    ...overrides,
  });
  return { client, sleeps, warnings };
}

describe('clampBody', () => {
  test('leaves a body under the cap alone', () => {
    const body = '# hello\n';
    expect(clampBody(body)).toBe(body);
  });

  test('cuts an over-long body to GitHub’s real 65,536-character cap', () => {
    const body = `HEAD\n${'x'.repeat(REAL_BODY_LIMIT + 5_000)}\nTAIL`;
    const clamped = clampBody(body);
    expect(clamped.length).toBeLessThanOrEqual(GITHUB_MAX_BODY_CHARS);
    expect(clamped).toContain('Body truncated by Starling');
    expect(clamped.startsWith('HEAD')).toBe(true);
    expect(clamped.endsWith('TAIL')).toBe(true);
    expect(GITHUB_MAX_BODY_CHARS).toBe(65_536);
  });
});

describe('parseGitHubRemote', () => {
  test.each([
    ['git@github.com:acme/sky-todo.git', 'acme/sky-todo'],
    ['git@github.com:acme/sky-todo', 'acme/sky-todo'],
    ['https://github.com/acme/sky-todo.git', 'acme/sky-todo'],
    ['https://github.com/acme/sky-todo', 'acme/sky-todo'],
    ['https://someone@github.com/acme/sky-todo.git', 'acme/sky-todo'],
    ['ssh://git@github.com/acme/sky-todo.git', 'acme/sky-todo'],
    ['  https://github.com/acme/sky-todo/  ', 'acme/sky-todo'],
  ])('%s → %s', (remote, expected) => {
    expect(parseGitHubRemote(remote)).toBe(expected);
  });

  test('ignores non-GitHub remotes', () => {
    expect(parseGitHubRemote('https://gitlab.com/acme/sky-todo.git')).toBeUndefined();
    expect(parseGitHubRemote('')).toBeUndefined();
    expect(parseGitHubRemote('/tmp/local/repo')).toBeUndefined();
  });
});

describe('isRetryableGhFailure', () => {
  const res = (code: number, stderr: string): ExecResult => ({ code, stdout: '', stderr, durationMs: 1 });

  test('retries the secondary rate limit real gh prints', () => {
    expect(
      isRetryableGhFailure(
        res(1, 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.'),
      ),
    ).toBe(true);
    expect(isRetryableGhFailure(res(1, 'HTTP 403: You have exceeded a secondary rate limit'))).toBe(true);
  });

  test('retries transport wobble but not a primary rate limit or a validation error', () => {
    expect(isRetryableGhFailure(res(1, 'gh: 503 Service Unavailable (HTTP 503)'))).toBe(true);
    expect(isRetryableGhFailure(res(1, 'timed out after 120000ms'))).toBe(true);
    expect(isRetryableGhFailure(res(1, 'API rate limit exceeded for user ID 1. (HTTP 403)'))).toBe(false);
    expect(isRetryableGhFailure(res(1, "could not add label: 'starling' not found"))).toBe(false);
    expect(isRetryableGhFailure(res(0, 'secondary rate limit'))).toBe(false);
  });
});

describe('backoffMs', () => {
  test('doubles per attempt inside ±20% jitter and caps at maxDelayMs', () => {
    for (let i = 0; i < 20; i += 1) {
      const first = backoffMs(1, { baseDelayMs: 1000, maxDelayMs: 5000 });
      expect(first).toBeGreaterThanOrEqual(800);
      expect(first).toBeLessThanOrEqual(1200);
      expect(backoffMs(9, { baseDelayMs: 1000, maxDelayMs: 5000 })).toBeLessThanOrEqual(5000);
    }
  });
});

describe('GhClient resilience', () => {
  test('retries a secondary rate limit with backoff and then succeeds', async () => {
    const fake = new FakeGh();
    fake.failOnce = {
      prefix: ['gh', 'issue', 'list'],
      stderr: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
    };
    const { client, sleeps, warnings } = clientFor(fake, {
      retry: { attempts: 3, baseDelayMs: 5, maxDelayMs: 5 },
    });

    const res = await client.gh(['issue', 'list', '--json', 'number']);

    expect(res.code).toBe(0);
    expect(sleeps).toHaveLength(1);
    expect(warnings[0]).toContain('transient GitHub failure');
    expect(fake.callsStartingWith('gh', 'issue', 'list')).toHaveLength(2);
  });

  test('does not retry a primary rate limit', async () => {
    const fake = new FakeGh();
    fake.failOnce = {
      prefix: ['gh', 'issue', 'list'],
      stderr: 'API rate limit exceeded for user ID 42. (HTTP 403)',
    };
    const { client, sleeps } = clientFor(fake);

    const err = await client.issuesWithLabel('starling:task').catch((e: unknown) => e);

    expect(isGitHubError(err)).toBe(true);
    expect(sleeps).toHaveLength(0);
    expect(String(err)).toContain('rate limit');
  });

  test('retries a timed-out command, then reports it as GH_COMMAND', async () => {
    let calls = 0;
    const execFn = async (_cmd: string[], _opts: ExecOptions): Promise<ExecResult> => {
      calls += 1;
      if (calls === 1) throw new StarlingError('EXEC_TIMEOUT', 'gh timed out after 5ms');
      return ok('[]');
    };
    const sleeps: number[] = [];
    const client = new GhClient({
      cwd: CWD,
      execFn,
      dryRun: false,
      log: [],
      repo: REPO,
      timeoutMs: 5,
      retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const res = await client.gh(['label', 'list']);
    expect(res.code).toBe(0);
    expect(sleeps).toHaveLength(1);
  });

  test('detects the repo from the origin remote when gh repo view cannot (worktree)', async () => {
    const fake = new FakeGh();
    fake.repoViewFails = true;
    fake.originRemote = 'git@github.com:acme/sky-todo.git';
    const { client, warnings } = clientFor(fake, { repo: undefined });

    expect(await client.repo()).toBe(REPO);
    expect(fake.callsStartingWith('git', 'remote', 'get-url', 'origin')).toHaveLength(1);
    expect(warnings[0]).toContain('origin remote');
  });

  test('still fails with GH_REPO when neither gh nor origin can name the repo', async () => {
    const fake = new FakeGh();
    fake.repoViewFails = true;
    const { client } = clientFor(fake, { repo: undefined });

    const err = await client.repo().catch((e: unknown) => e);
    expect(isGitHubError(err, 'GH_REPO')).toBe(true);
  });
});
