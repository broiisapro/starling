import { describe, expect, test } from 'bun:test';
import { KeyedMutex, sleep } from './mutex.ts';

describe('KeyedMutex', () => {
  test('runs calls for one key one at a time, in submission order', async () => {
    const mutex = new KeyedMutex();
    let active = 0;
    let peak = 0;
    const order: number[] = [];

    await Promise.all(
      [0, 1, 2, 3].map((index) =>
        mutex.run('repo', async () => {
          active += 1;
          peak = Math.max(peak, active);
          await sleep(2);
          order.push(index);
          active -= 1;
        }),
      ),
    );

    expect(peak).toBe(1);
    expect(order).toEqual([0, 1, 2, 3]);
    expect(mutex.keys()).toEqual([]);
  });

  test('lets different keys proceed concurrently', async () => {
    const mutex = new KeyedMutex();
    let active = 0;
    let peak = 0;

    await Promise.all(
      ['a', 'b'].map((key) =>
        mutex.run(key, async () => {
          active += 1;
          peak = Math.max(peak, active);
          await sleep(10);
          active -= 1;
        }),
      ),
    );

    expect(peak).toBe(2);
    expect(mutex.keys().length).toBe(0);
  });

  test('releases the key when the body throws', async () => {
    const mutex = new KeyedMutex();
    await expect(
      mutex.run('repo', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const value = await mutex.run('repo', async () => 42);
    expect(value).toBe(42);
    expect(mutex.pending('repo')).toBe(0);
  });

  test('reports queued work while a key is held', async () => {
    const mutex = new KeyedMutex();
    const first = mutex.run('repo', () => sleep(10));
    const second = mutex.run('repo', () => sleep(1));

    expect(mutex.pending('repo')).toBe(2);
    await Promise.all([first, second]);
    expect(mutex.keys()).toEqual([]);
  });
});
