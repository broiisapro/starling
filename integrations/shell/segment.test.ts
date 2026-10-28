/**
 * The format and the picking rules — the two things a user sees.
 *
 * Every expected string is written out literally, including the escapes, because the whole point of the
 * segment is that it looks a particular way in a prompt.
 */
import { describe, expect, test } from 'bun:test';
import {
  countTasks,
  FINISHED_WINDOW_MS,
  formatSegment,
  isActiveRunStatus,
  isLandedRunStatus,
  pickRun,
  type TaskCounts,
} from './segment.ts';
import { makeRun, T0 } from './test-support.ts';

const EMPTY: TaskCounts = { inFlight: 0, done: 0, failed: 0, total: 0 };
const FLYING: TaskCounts = { inFlight: 12, done: 0, failed: 0, total: 30 };
const CROSS_1 = '\u2717';

describe('pickRun', () => {
  test('no runs means no segment', () => {
    expect(pickRun([], T0)).toBeUndefined();
  });

  test('the single active run wins', () => {
    const run = makeRun({ id: 'a', status: 'running', startedAt: T0 });
    expect(pickRun([run], T0 + 1_000)?.id).toBe('a');
  });

  test('mapping, planning and planned all count as active', () => {
    for (const status of ['mapping', 'planning', 'planned', 'running'] as const) {
      const run = makeRun({ status, startedAt: T0 });
      expect(pickRun([run], T0)?.status).toBe(status);
      expect(isActiveRunStatus(status)).toBe(true);
    }
  });

  test('the newest active run wins, not the first in the list', () => {
    const older = makeRun({ id: 'older', status: 'running', startedAt: T0 });
    const newer = makeRun({ id: 'newer', status: 'running', startedAt: T0 + 5_000 });
    expect(pickRun([older, newer], T0 + 6_000)?.id).toBe('newer');
    expect(pickRun([newer, older], T0 + 6_000)?.id).toBe('newer');
  });

  test('an active run beats a town run that just landed', () => {
    const landed = makeRun({
      id: 'landed',
      status: 'finished',
      startedAt: T0 + 9_000,
      finishedAt: T0 + 10_000,
    });
    const flying = makeRun({ id: 'flying', status: 'running', startedAt: T0 });
    expect(pickRun([landed, flying], T0 + 10_000)?.id).toBe('flying');
  });

  test('a run that landed 9 minutes ago still shows', () => {
    const landed = makeRun({ status: 'finished', startedAt: T0, finishedAt: T0 + 60_000 });
    const now = T0 + 60_000 + 9 * 60_000;
    expect(pickRun([landed], now)?.status).toBe('finished');
  });

  test('a run that landed 11 minutes ago is forgotten', () => {
    const landed = makeRun({ status: 'finished', startedAt: T0, finishedAt: T0 + 60_000 });
    const now = T0 + 60_000 + FINISHED_WINDOW_MS + 60_000;
    expect(pickRun([landed], now)).toBeUndefined();
  });

  test('failed and cancelled runs land too, and are shown for the same window', () => {
    const failed = makeRun({ id: 'failed', status: 'failed', startedAt: T0, finishedAt: T0 + 1_000 });
    expect(pickRun([failed], T0 + 2_000)?.id).toBe('failed');
    expect(isLandedRunStatus('failed')).toBe(true);
    const cancelled = makeRun({
      id: 'cancelled',
      status: 'cancelled',
      startedAt: T0,
      finishedAt: T0 + 1_000,
    });
    expect(pickRun([cancelled], T0 + 2_000)?.id).toBe('cancelled');
  });

  test('when nothing has finishedAt, startedAt decides the ordering', () => {
    const old = makeRun({ id: 'old', status: 'finished', startedAt: T0 });
    const newer = makeRun({ id: 'new', status: 'finished', startedAt: T0 + 120_000 });
    expect(pickRun([old, newer], T0 + 130_000)?.id).toBe('new');
  });

  test('ties keep the first entry, i.e. the server order (newest first)', () => {
    const first = makeRun({ id: 'first', status: 'finished', startedAt: T0, finishedAt: T0 + 1_000 });
    const second = makeRun({ id: 'second', status: 'finished', startedAt: T0, finishedAt: T0 + 1_000 });
    expect(pickRun([first, second], T0 + 2_000)?.id).toBe('first');
  });

  test('a future timestamp counts as fresh (clock skew should not hide a live run)', () => {
    const landed = makeRun({ status: 'finished', startedAt: T0, finishedAt: T0 + 30_000 });
    expect(pickRun([landed], T0)?.status).toBe('finished');
  });
});

describe('countTasks', () => {
  test('the four buckets, one status at a time', () => {
    expect(countTasks(makeRun({ taskStatuses: ['running'] }))).toEqual({
      inFlight: 1,
      done: 0,
      failed: 0,
      total: 1,
    });
    expect(countTasks(makeRun({ taskStatuses: ['auditing'] })).inFlight).toBe(1);
    expect(countTasks(makeRun({ taskStatuses: ['fixing'] })).inFlight).toBe(1);
    expect(countTasks(makeRun({ taskStatuses: ['merging'] })).inFlight).toBe(1);
    expect(countTasks(makeRun({ taskStatuses: ['merged'] })).done).toBe(1);
    expect(countTasks(makeRun({ taskStatuses: ['failed'] })).failed).toBe(1);
    expect(countTasks(makeRun({ taskStatuses: ['conflict'] })).failed).toBe(1);
  });

  test('pending, ready and cancelled are only counted in the total', () => {
    const counts = countTasks(makeRun({ taskStatuses: ['pending', 'ready', 'cancelled'] }));
    expect(counts).toEqual({ inFlight: 0, done: 0, failed: 0, total: 3 });
  });

  test('a mixed run adds up', () => {
    const counts = countTasks(
      makeRun({ taskStatuses: ['merged', 'merged', 'running', 'auditing', 'failed', 'conflict', 'pending'] }),
    );
    expect(counts).toEqual({ inFlight: 2, done: 2, failed: 2, total: 7 });
  });

  test('a run with no tasks counts as zero (hand-written and truncated runs)', () => {
    expect(countTasks(makeRun())).toEqual(EMPTY);
    // reason: `tasks` is a required field, but a run read back from an older recording may lack it;
    // the counter must not throw inside a prompt.
    expect(countTasks({ tasks: undefined } as unknown as { tasks: Record<string, never> })).toEqual(EMPTY);
  });
});

describe('formatSegment', () => {
  test('flying', () => {
    expect(formatSegment(FLYING)).toBe('\u{1F426} 12/30');
  });

  test('flying with failures', () => {
    expect(formatSegment({ ...FLYING, failed: 2 })).toBe(`\u{1F426} 12/30 ${CROSS_1}2`);
  });

  test('landed', () => {
    expect(formatSegment({ inFlight: 0, done: 30, failed: 0, total: 30 }, { finished: true })).toBe(
      '\u{1F426} \u271330',
    );
  });

  test('landed with failures still tells the truth', () => {
    expect(formatSegment({ inFlight: 0, done: 28, failed: 2, total: 30 }, { finished: true })).toBe(
      `\u{1F426} \u271328 ${CROSS_1}2`,
    );
  });

  test('ascii flying', () => {
    expect(formatSegment(FLYING, { ascii: true })).toBe('st 12/30');
  });

  test('ascii flying with failures', () => {
    expect(formatSegment({ ...FLYING, failed: 2 }, { ascii: true })).toBe('st 12/30 x2');
  });

  test('ascii landed', () => {
    expect(
      formatSegment({ inFlight: 0, done: 30, failed: 0, total: 30 }, { ascii: true, finished: true }),
    ).toBe('st ok 30');
  });

  test('nothing to show renders an empty string, not a lonely bird', () => {
    expect(formatSegment(EMPTY)).toBe('');
    expect(formatSegment(EMPTY, { finished: true })).toBe('');
    expect(formatSegment(EMPTY, { ascii: true })).toBe('');
  });

  test('zsh wraps the colour in %{…%} so the prompt width stays right', () => {
    const segment = formatSegment(FLYING, { style: 'zsh' });
    expect(segment.startsWith('%{\u001b[36m%}')).toBe(true);
    expect(segment.endsWith('%{\u001b[0m%}')).toBe(true);
    expect(segment).toContain('\u{1F426} 12/30');
  });

  test('bash wraps the colour in \\[…\\] for the same reason', () => {
    const segment = formatSegment(FLYING, { style: 'bash' });
    expect(segment.startsWith('\\[\u001b[36m\\]')).toBe(true);
    expect(segment.endsWith('\\[\u001b[0m\\]')).toBe(true);
  });

  test('landed prompts are green, flying ones cyan', () => {
    expect(formatSegment(FLYING, { style: 'zsh' })).toContain('\u001b[36m');
    expect(formatSegment({ ...FLYING, inFlight: 0 }, { finished: true, style: 'zsh' })).toContain(
      '\u001b[32m',
    );
  });

  test('plain never emits an escape sequence', () => {
    for (const opts of [{}, { ascii: true }, { finished: true }, { ascii: true, finished: true }] as const) {
      expect(formatSegment(FLYING, opts)).not.toContain('\u001b');
      expect(formatSegment(FLYING, { ...opts, style: 'plain' })).not.toContain('\u001b');
    }
  });
});
