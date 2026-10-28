/**
 * One refresh, with a fake fetch and a fake clock: what gets requested, what gets written, and how a
 * dead hub turns into a free prompt.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { locateCache, readSegment, readState, writeCache } from './cache.ts';
import { backoffMs, extractRuns, type FetchLike, refresh, runsUrl } from './refresh.ts';
import { makeRun, T0 } from './test-support.ts';

const ROOT = mkdtempSync(join(tmpdir(), 'starling-prompt-refresh-'));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

let counter = 0;
function freshDir(): string {
  counter += 1;
  const dir = join(ROOT, `case-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface Call {
  url: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function respond(
  payload: unknown,
  options: { ok?: boolean; status?: number } = {},
): { fn: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers, signal: init?.signal });
    return {
      ok: options.ok ?? true,
      status: options.status ?? (options.ok === false ? 500 : 200),
      json: async () => payload,
    };
  };
  return { fn, calls };
}

function failingFetch(message = 'boom'): { fn: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers, signal: init?.signal });
    throw new Error(message);
  };
  return { fn, calls };
}

function clock(start = T0): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms) => (current += ms) };
}

describe('backoffMs', () => {
  test('1 s, 2 s, 4 s, 8 s … and never more than a minute', () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(1_000);
    expect(backoffMs(2)).toBe(2_000);
    expect(backoffMs(3)).toBe(4_000);
    expect(backoffMs(6)).toBe(32_000);
    expect(backoffMs(7)).toBe(60_000);
    expect(backoffMs(60)).toBe(60_000);
  });
});

describe('runsUrl', () => {
  test('appends the documented route and normalises slashes', () => {
    expect(runsUrl('http://127.0.0.1:7777')).toBe('http://127.0.0.1:7777/api/runs');
    expect(runsUrl('http://127.0.0.1:7777/')).toBe('http://127.0.0.1:7777/api/runs');
    expect(runsUrl('  http://hub:9//  ')).toBe('http://hub:9/api/runs');
  });
});

describe('extractRuns', () => {
  test('accepts a bare array and a { runs } wrapper', () => {
    const run = makeRun();
    expect(extractRuns([run]).map((item) => item.id)).toEqual(['run-1']);
    expect(extractRuns({ runs: [run] }).map((item) => item.id)).toEqual(['run-1']);
    expect(extractRuns({ runs: [] })).toEqual([]);
  });

  test('drops anything that is not a run-shaped object', () => {
    expect(extractRuns(null)).toEqual([]);
    expect(extractRuns('nope')).toEqual([]);
    expect(extractRuns({ runs: 'nope' })).toEqual([]);
    expect(extractRuns([{ id: 'x' }, { id: 'y', status: 'running', startedAt: 1, tasks: {} }]).length).toBe(
      1,
    );
  });
});

describe('refresh', () => {
  test('a flying run becomes the segment and resets the failure count', () => {
    const cacheDir = freshDir();
    const location = locateCache('http://127.0.0.1:7777', { cacheDir });
    writeCache(location, { segment: 'stale', failures: 3, now: T0 - 120_000 });
    const time = clock(T0);
    const fake = respond([
      makeRun({ id: 'done', status: 'finished', startedAt: T0 - 500_000, finishedAt: T0 - 400_000 }),
      makeRun({
        id: 'live',
        status: 'running',
        startedAt: T0 - 1_000,
        taskStatuses: ['merged', 'running', 'merged', 'failed'],
      }),
    ]);

    return refresh({ serverUrl: 'http://127.0.0.1:7777', fetch: fake.fn, now: time.now, cacheDir }).then(
      (outcome) => {
        expect(outcome).toEqual({ segment: '\u{1F426} 1/4 \u27171', ok: true, skipped: false, failures: 0 });
        expect(readSegment(location)).toBe('\u{1F426} 1/4 \u27171');
        expect(readState(location)).toEqual({ updatedAt: T0, failures: 0 });
        expect(fake.calls).toHaveLength(1);
        expect(fake.calls[0]?.url).toBe('http://127.0.0.1:7777/api/runs');
      },
    );
  });

  test('sends the flock token only when one is configured', async () => {
    const withToken = respond([makeRun()]);
    await refresh({
      serverUrl: 'http://h:1',
      token: 'JOIN-CODE',
      fetch: withToken.fn,
      now: clock().now,
      cacheDir: freshDir(),
    });
    expect(withToken.calls[0]?.headers?.['x-flock-token']).toBe('JOIN-CODE');

    const withoutToken = respond([makeRun()]);
    await refresh({
      serverUrl: 'http://h:1',
      fetch: withoutToken.fn,
      now: clock().now,
      cacheDir: freshDir(),
    });
    expect(withoutToken.calls[0]?.headers?.['x-flock-token']).toBeUndefined();
    expect(withoutToken.calls[0]?.headers?.accept).toBe('application/json');
  });

  test('a landed run renders the tick (and still shows failures)', async () => {
    const fake = respond([
      makeRun({
        id: 'done',
        status: 'finished',
        finishedAt: T0 - 1_000,
        taskStatuses: ['merged', 'merged', 'failed'],
      }),
    ]);
    const outcome = await refresh({
      serverUrl: 'http://h:1',
      fetch: fake.fn,
      now: clock().now,
      cacheDir: freshDir(),
    });
    expect(outcome.segment).toBe('\u{1F426} \u27132 \u27171');
  });

  test('ascii and the prompt styles flow through to the cache', async () => {
    const ascii = respond([makeRun({ taskStatuses: ['merged', 'running', 'merged'] })]);
    const asciiOutcome = await refresh({
      serverUrl: 'http://h:1',
      fetch: ascii.fn,
      now: clock().now,
      cacheDir: freshDir(),
      ascii: true,
    });
    expect(asciiOutcome.segment).toBe('st 1/3');

    const zshCache = freshDir();
    const zsh = respond([makeRun({ taskStatuses: ['merged', 'running'] })]);
    const zshOutcome = await refresh({
      serverUrl: 'http://h:1',
      fetch: zsh.fn,
      now: clock().now,
      cacheDir: zshCache,
      style: 'zsh',
    });
    expect(zshOutcome.segment).toBe('%{\u001b[36m%}\u{1F426} 1/2%{\u001b[0m%}');
  });

  test('an HTTP error clears the segment and records one failure', async () => {
    const cacheDir = freshDir();
    const location = locateCache('http://h:1', { cacheDir });
    writeCache(location, { segment: '\u{1F426} 3/3', failures: 0, now: T0 - 60_000 });
    const fake = respond(null, { ok: false, status: 503 });
    const outcome = await refresh({ serverUrl: 'http://h:1', fetch: fake.fn, now: clock().now, cacheDir });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('hub answered 503');
    expect(readSegment(location)).toBe('');
    expect(readState(location)).toEqual({ updatedAt: T0, failures: 1 });
  });

  test('a network failure is the same story, and never throws', async () => {
    const cacheDir = freshDir();
    const fake = failingFetch('ECONNREFUSED 127.0.0.1:7777');
    const outcome = await refresh({ serverUrl: 'http://h:1', fetch: fake.fn, now: clock().now, cacheDir });
    expect(outcome).toEqual({
      segment: '',
      ok: false,
      skipped: false,
      failures: 1,
      error: 'ECONNREFUSED 127.0.0.1:7777',
    });
  });

  test('a dead hub is not dialled again until the backoff expires', async () => {
    const cacheDir = freshDir();
    const time = clock(T0);
    const dead = failingFetch();
    await refresh({ serverUrl: 'http://h:1', fetch: dead.fn, now: time.now, cacheDir });
    expect(dead.calls).toHaveLength(1);

    time.advance(500);
    const early = await refresh({ serverUrl: 'http://h:1', fetch: dead.fn, now: time.now, cacheDir });
    expect(early.skipped).toBe(true);
    expect(early.failures).toBe(1);
    expect(dead.calls).toHaveLength(1);

    time.advance(600); // 1.1 s after the failure: backoff for one failure is 1 s
    const retry = await refresh({ serverUrl: 'http://h:1', fetch: dead.fn, now: time.now, cacheDir });
    expect(retry.skipped).toBe(false);
    expect(retry.failures).toBe(2);
    expect(dead.calls).toHaveLength(2);
  });

  test('the backoff doubles after every failure and caps at a minute', async () => {
    const cacheDir = freshDir();
    const time = clock(T0);
    const dead = failingFetch();
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const before = time.now();
      await refresh({ serverUrl: 'http://h:1', fetch: dead.fn, now: time.now, cacheDir });
      const { failures } = readState(locateCache('http://h:1', { cacheDir }));
      expect(failures).toBe(attempt);
      waits.push(backoffMs(failures));
      // Skip ahead exactly to the end of the window this failure just created.
      expect(time.now()).toBe(before);
      time.advance(backoffMs(failures));
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  });

  test('the caller throttle skips without a request but leaves the cache alone', async () => {
    const cacheDir = freshDir();
    const location = locateCache('http://h:1', { cacheDir });
    const time = clock(T0);
    const fake = respond([makeRun({ taskStatuses: ['running'] })]);
    await refresh({ serverUrl: 'http://h:1', fetch: fake.fn, now: time.now, cacheDir });
    expect(readSegment(location)).toBe('\u{1F426} 1/1');

    time.advance(500);
    const throttled = await refresh({
      serverUrl: 'http://h:1',
      fetch: fake.fn,
      now: time.now,
      cacheDir,
      intervalMs: 2_000,
    });
    expect(throttled.skipped).toBe(true);
    expect(throttled.ok).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(readSegment(location)).toBe('\u{1F426} 1/1');

    time.advance(2_000);
    const allowed = await refresh({
      serverUrl: 'http://h:1',
      fetch: fake.fn,
      now: time.now,
      cacheDir,
      intervalMs: 2_000,
    });
    expect(allowed.skipped).toBe(false);
    expect(fake.calls).toHaveLength(2);
  });

  test('no runs at all means an empty segment and a healthy hub', async () => {
    const fake = respond([]);
    const outcome = await refresh({
      serverUrl: 'http://h:1',
      fetch: fake.fn,
      now: clock().now,
      cacheDir: freshDir(),
    });
    expect(outcome).toEqual({ segment: '', ok: true, skipped: false, failures: 0 });
  });

  test('runs outside the window and unknown statuses show nothing', async () => {
    const fake = respond([
      makeRun({ id: 'old', status: 'finished', startedAt: T0 - 2_000_000, finishedAt: T0 - 1_900_000 }),
    ]);
    const outcome = await refresh({
      serverUrl: 'http://h:1',
      fetch: fake.fn,
      now: clock().now,
      cacheDir: freshDir(),
    });
    expect(outcome.segment).toBe('');
  });

  test('the request carries a timeout signal', async () => {
    const fake = respond([makeRun()]);
    await refresh({ serverUrl: 'http://h:1', fetch: fake.fn, now: clock().now, cacheDir: freshDir() });
    expect(fake.calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  test('a cache directory that cannot be written does not break the refresh', async () => {
    const blocker = join(freshDir(), 'not-a-dir');
    writeFileSync(blocker, 'file');
    const fake = respond([makeRun({ taskStatuses: ['running'] })]);
    const outcome = await refresh({
      serverUrl: 'http://h:1',
      fetch: fake.fn,
      now: clock().now,
      cacheDir: join(blocker, 'nested'),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.segment).toBe('\u{1F426} 1/1');
  });
});
