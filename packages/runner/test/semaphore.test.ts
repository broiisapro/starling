import { describe, expect, test } from 'bun:test';
import { Semaphore } from '../src/semaphore';

describe('Semaphore', () => {
  test('admits up to max immediately and queues the rest', async () => {
    const semaphore = new Semaphore(2);
    const releaseA = await semaphore.acquire();
    const releaseB = await semaphore.acquire();
    expect(semaphore.active).toBe(2);

    let admitted = false;
    const pending = semaphore.acquire().then((release) => {
      admitted = true;
      return release;
    });
    await Bun.sleep(5);
    expect(admitted).toBe(false);
    expect(semaphore.pending).toBe(1);

    releaseA();
    const releaseC = await pending;
    expect(admitted).toBe(true);
    expect(semaphore.active).toBe(2);

    releaseB();
    releaseC();
    expect(semaphore.active).toBe(0);
  });

  test('release is idempotent', async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire();
    release();
    release();
    expect(semaphore.active).toBe(0);
    const again = await semaphore.acquire();
    expect(semaphore.active).toBe(1);
    again();
  });

  test('rejects a non-positive max', () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
    expect(() => new Semaphore(1.5)).toThrow(RangeError);
  });
});
