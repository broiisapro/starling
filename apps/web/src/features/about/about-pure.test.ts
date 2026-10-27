import { expect, test } from 'bun:test';
import { FIXTURE_STATS } from './fixture';
import {
  EMPTY,
  formatClock,
  formatCount,
  formatDuration,
  formatHours,
  formatSigned,
  formatTimestamp,
  handbackLabel,
  shortTitle,
  swarmStory,
  timelineLayout,
  WAVE_COLORS,
  waveLabel,
} from './index';

test('formats counts, durations and timestamps', () => {
  expect(formatCount(12345)).toBe('12,345');
  expect(formatCount(Number.NaN)).toBe(EMPTY);
  expect(formatSigned(7244)).toBe('+7,244');
  expect(formatSigned(-445)).toBe('−445');
  expect(formatDuration(45 * 60_000)).toBe('45m');
  expect(formatDuration(141 * 60_000)).toBe('2h 21m');
  expect(formatDuration(2 * 3_600_000)).toBe('2h');
  expect(formatDuration(undefined)).toBe(EMPTY);
  expect(formatHours(4 * 3_600_000 + 54 * 60_000)).toBe('4.9h');
  expect(formatHours(0)).toBe(EMPTY);
  expect(formatTimestamp('2026-10-27T15:18:16Z')).toBe('27 Oct at 15:18 UTC');
  expect(formatTimestamp('nope')).toBe(EMPTY);
  expect(formatClock(Date.parse('2026-10-27T15:18:16Z'))).toBe('15:18');
});

test('maps handback statuses to short labels, with pending for in-flight epics', () => {
  expect(handbackLabel('complete', false)).toBe('complete');
  expect(handbackLabel('partial', false)).toBe('partial');
  expect(handbackLabel('unavailable', false)).toBe('no source');
  expect(handbackLabel('unknown', false)).toBe('unknown');
  expect(handbackLabel('missing', true)).toBe('pending');
  expect(handbackLabel('missing', false)).toBe('missing');
});

test('lays out one row per wave and one bar per dated epic', () => {
  const layout = timelineLayout(FIXTURE_STATS);

  expect(layout.rows.map((row) => row.wave)).toEqual(['0', '1', 'c1', '2']);
  expect(layout.bars).toHaveLength(5);
  expect(layout.ticks).toHaveLength(5);
  expect(layout.startMs).toBeLessThan(layout.endMs);
  expect(layout.height).toBeGreaterThan(0);

  for (const bar of layout.bars) {
    expect(bar.width).toBeGreaterThanOrEqual(4);
    expect(bar.x).toBeGreaterThanOrEqual(layout.plotLeft);
    expect(bar.x).toBeLessThanOrEqual(layout.plotRight);
    expect(WAVE_COLORS).toContain(bar.color);
  }

  // In-flight epics run to `generatedAt` and are marked hollow.
  const inFlight = layout.bars.find((bar) => bar.epic.number === '68');
  expect(inFlight?.inFlight).toBe(true);
  expect(inFlight?.endMs).toBe(Date.parse(FIXTURE_STATS.generatedAt));

  // Rows never overlap and bars stay inside their row.
  for (const [index, row] of layout.rows.entries()) {
    const next = layout.rows[index + 1];
    if (next !== undefined) expect(row.y + row.height).toBeLessThan(next.y);
    for (const bar of row.bars) {
      expect(bar.y).toBeGreaterThanOrEqual(row.y);
      expect(bar.y + bar.height).toBeLessThanOrEqual(row.y + row.height);
    }
  }
});

test('timeline survives stats with no epics at all', () => {
  const layout = timelineLayout({
    ...FIXTURE_STATS,
    epics: [],
    waves: [],
  });
  expect(layout.bars).toEqual([]);
  expect(layout.rows).toEqual([]);
  expect(layout.height).toBeGreaterThan(0);
  expect(layout.ticks).toHaveLength(5);
  expect(layout.endMs).toBeGreaterThan(layout.startMs);
});

test('labels waves and trims bar titles', () => {
  expect(waveLabel('0')).toBe('Wave 0');
  expect(waveLabel('c1')).toBe('Checkpoint 1');
  expect(waveLabel('unknown')).toBe('Wave ?');
  expect(shortTitle('short')).toBe('short');
  expect(shortTitle('a very long epic title that will not fit in a bar', 20)).toBe('a very long epic ti…');
});

test('the story is three sentences driven by the totals', () => {
  const story = swarmStory(FIXTURE_STATS);
  expect(story).toHaveLength(3);
  expect(story[0]).toContain('4 epics');
  expect(story[0]).toContain('4 waves');
  expect(story[0]).toContain('up to 4 running at once');
  expect(story[1]).toContain('4 pull requests');
  expect(story[1]).toContain('312 tests');
  expect(story[2]).toContain('3 of 4 handbacks');
  expect(story[2]).toContain('1 is still in flight');

  const empty = swarmStory({
    ...FIXTURE_STATS,
    epics: [],
    totals: { ...FIXTURE_STATS.totals, epics: 0, agentSessions: 0 },
  });
  expect(empty).toHaveLength(3);
  expect(empty[0]).toContain('No stats yet');
});
