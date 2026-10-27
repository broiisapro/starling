import { describe, expect, test } from 'bun:test';
import { FALLBACK_STATS, formatCount, formatGeneratedAt, normalizeStats } from './stats';

describe('normalizeStats', () => {
  test('reads the canonical nested totals', () => {
    const stats = normalizeStats({
      generatedAt: '2026-10-27T14:30:00.000Z',
      source: 'tools/stats',
      totals: { epics: 28, prs: 28, tests: 1785, agents: 35, laptops: 2, commits: 37 },
    });
    expect(stats).toEqual({
      epics: 28,
      prs: 28,
      tests: 1785,
      agents: 35,
      laptops: 2,
      commits: 37,
      generatedAt: '2026-10-27T14:30:00.000Z',
      source: 'tools/stats',
    });
  });

  test('accepts Epic 68-style aliases and numeric strings', () => {
    const stats = normalizeStats({
      totals: {
        epicCount: 12,
        pullRequests: '34',
        testCount: 900,
        peakConcurrentAgents: 20,
        machines: 2,
        commitCount: 60,
      },
    });
    expect(stats.epics).toBe(12);
    expect(stats.prs).toBe(34);
    expect(stats.tests).toBe(900);
    expect(stats.agents).toBe(20);
    expect(stats.laptops).toBe(2);
    expect(stats.commits).toBe(60);
  });

  test('accepts a flat file and derives epics from the array', () => {
    const stats = normalizeStats({
      epics: [{ number: 1 }, { number: 2 }, { number: 3 }],
      prs: 3,
      tests: 42,
      agents: 8,
      laptops: 1,
      commits: 17,
    });
    expect(stats.epics).toBe(3);
    expect(stats.prs).toBe(3);
    expect(stats.tests).toBe(42);
  });

  test('falls back field by field instead of throwing on junk', () => {
    expect(normalizeStats(null)).toEqual(FALLBACK_STATS);
    expect(normalizeStats('nope')).toEqual(FALLBACK_STATS);
    expect(normalizeStats([])).toEqual(FALLBACK_STATS);
    expect(normalizeStats({ totals: { epics: -4, prs: 'lots', tests: Number.NaN } })).toEqual(FALLBACK_STATS);
  });

  test('fills missing keys from the fallback and keeps good ones', () => {
    const stats = normalizeStats({ totals: { epics: 40 } });
    expect(stats.epics).toBe(40);
    expect(stats.tests).toBe(FALLBACK_STATS.tests);
  });

  test('sums per-wave agents when no peak is given', () => {
    const stats = normalizeStats({ waves: [{ agents: 12 }, { agents: 9 }, { agents: 'x' }] });
    expect(stats.agents).toBe(21);
  });
});

describe('formatting', () => {
  test('groups thousands and rounds', () => {
    expect(formatCount(1785)).toBe('1,785');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(12.6)).toBe('13');
    expect(formatCount(Number.NaN)).toBe('0');
  });

  test('renders a generated date, and degrades to the raw string', () => {
    expect(formatGeneratedAt('2026-10-27T14:30:00.000Z')).toBe('27 October 2026');
    expect(formatGeneratedAt('sometime')).toBe('sometime');
    expect(formatGeneratedAt(null)).toBeNull();
  });
});
