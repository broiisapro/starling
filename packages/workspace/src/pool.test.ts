import { describe, expect, test } from 'bun:test';
import { isStarlingError } from '@starling/core';
import { type ExecLike, Git } from './git.ts';
import { KeyedMutex, sleep } from './mutex.ts';
import { boundedExec, defaultGitConcurrency, Semaphore } from './pool.ts';

/** A fake exec that counts in-flight calls, so tests can prove the cap holds. */
function countingExec(delayMs = 4) {
  let active = 0;
  let peak = 0;
  const calls: string[][] = [];
  const exec = (async (cmd: string[]) => {
    calls.push(cmd);
    active += 1;
    peak = Math.max(peak, active);
    await sleep(delayMs);
    active -= 1;
    return { code: 0, stdout: '', stderr: '', durationMs: delayMs };
  }) as ExecLike;
  return { exec, calls, peak: () => peak, active: () => active };
}

describe('defaultGitConcurrency', () => {
  test('stays inside the documented band', () => {
    const value = defaultGitConcurrency();
    expect(value).toBeGreaterThanOrEqual(4);
    expect(value).toBeLessThanOrEqual(12);
    expect(Number.isInteger(value)).toBe(true);
  });
});

describe('Semaphore', () => {
  test('rejects a nonsense limit', () => {
    for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      try {
        new Semaphore(limit);
        throw new Error('expected a throw');
      } catch (err) {
        expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
      }
    }
  });

  test('never exceeds the limit and drains the queue', async () => {
    const semaphore = new Semaphore(3);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        semaphore.run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await sleep(2);
          active -= 1;
        }),
      ),
    );

    expect(peak).toBe(3);
    expect(semaphore.active).toBe(0);
    expect(semaphore.queued).toBe(0);
    expect(semaphore.limit).toBe(3);
  });

  test('releases the slot when fn throws, and propagates the error', async () => {
    const semaphore = new Semaphore(1);
    await expect(
      semaphore.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(semaphore.active).toBe(0);
    expect(await semaphore.run(async () => 'next')).toBe('next');
  });

  test('runs waiters in FIFO order', async () => {
    const semaphore = new Semaphore(1);
    const order: number[] = [];
    const hold = semaphore.run(async () => {
      await sleep(5);
    });
    await sleep(1);
    const waiters = [1, 2, 3].map((id) =>
      semaphore.run(async () => {
        order.push(id);
      }),
    );
    await hold;
    await Promise.all(waiters);
    expect(order).toEqual([1, 2, 3]);
  });
});

describe('boundedExec', () => {
  test('caps concurrent calls and returns every result', async () => {
    const fake = countingExec();
    const pooled = boundedExec(fake.exec, 2);

    const results = await Promise.all(
      Array.from({ length: 9 }, (_, index) => pooled(['git', 'status', `${index}`], { cwd: '/repo' })),
    );

    expect(results).toHaveLength(9);
    expect(results.every((result) => result.code === 0)).toBe(true);
    expect(fake.peak()).toBe(2);
    expect(fake.calls).toHaveLength(9);
  });

  test('passes options through untouched', async () => {
    const seen: unknown[] = [];
    const exec = (async (_cmd: string[], opts: unknown) => {
      seen.push(opts);
      return { code: 0, stdout: '', stderr: '', durationMs: 0 };
    }) as ExecLike;
    const pooled = boundedExec(exec, 4);

    await pooled(['git', 'version'], { cwd: '/repo', env: { A: '1' }, timeoutMs: 5 });

    expect(seen[0]).toEqual({ cwd: '/repo', env: { A: '1' }, timeoutMs: 5 });
  });

  test('a limit of 0 or a non-finite limit means no pool at all', async () => {
    const fake = countingExec();
    expect(boundedExec(fake.exec, 0)).toBe(fake.exec);
    expect(boundedExec(fake.exec, Number.NaN)).toBe(fake.exec);
  });

  test('composes with the repo mutex without deadlocking', async () => {
    // The pool wraps exec; the mutex wraps call sequences. They must not nest the wrong way round.
    const fake = countingExec(2);
    const pooled = boundedExec(fake.exec, 2);
    const git = new Git(pooled, new KeyedMutex(), { retryDelayMs: 1, maxConcurrency: 0 });

    await Promise.all([
      git.run(['add', '-A'], { cwd: '/repo', lock: 'repo' }),
      git.text(['status'], { cwd: '/repo' }),
      git.text(['diff', '--numstat'], { cwd: '/repo' }),
    ]);

    expect(fake.calls).toHaveLength(3);
    expect(fake.active()).toBe(0);
  });
});
