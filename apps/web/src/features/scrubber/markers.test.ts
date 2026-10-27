import { describe, expect, test } from 'bun:test';
import type { StarlingEvent } from '@starling/core/browser';
import { demoEvents } from '../../data/demo';
import {
  buildMarkers,
  clampIndex,
  clusterMarkers,
  eventSpan,
  filterMarkers,
  formatScrubTime,
  indexAtOffset,
  indexAtTime,
  isMarkerVisible,
  lastIndex,
  MARKER_FILTERS,
  type Marker,
  markerCategories,
  markerCounts,
  markerPositions,
  nextFailure,
  nextMarker,
  positionOfTime,
  scrubClockLabel,
  scrubValueText,
  timeAtIndex,
  timeAtPosition,
} from './markers';

/**
 * Pure marker/geometry tests against the recorded launch-day run. No DOM, no clock, no network: the
 * fixture is a fixed log and every assertion is arithmetic on it.
 */
const events = demoEvents();
const markers = buildMarkers(events);

function fixtureEvent(type: string, payload: Record<string, unknown>, ts = 1_000): StarlingEvent {
  return { type, runId: 'run', ts, payload } as unknown as StarlingEvent;
}

function eventIndexOf(predicate: (event: StarlingEvent) => boolean): number {
  const index = events.findIndex(predicate);
  if (index < 0) throw new Error('event not found in the fixture');
  return index;
}

describe('buildMarkers on the launch-day fixture', () => {
  test('finds seven merges and every other interesting moment', () => {
    expect(markers.filter((marker) => marker.kind === 'merge')).toHaveLength(7);
    expect(markers).toHaveLength(15);
    expect(markers.map((marker) => marker.kind)).toEqual([
      'node-join',
      'plan',
      'merge',
      'merge',
      'fail',
      'merge',
      'node-join',
      'merge',
      'merge',
      'merge',
      'node-leave',
      'migrate',
      'node-join',
      'merge',
      'finish',
    ]);
  });

  test("theme's failed audit is a failure marker with a readable label", () => {
    const index = eventIndexOf(
      (event) =>
        event.type === 'audit.verdict' &&
        (event.payload as { taskKey?: string }).taskKey === 'theme' &&
        (event.payload as { pass?: boolean }).pass === false,
    );
    const marker = markers.find((candidate) => candidate.index === index);
    const event = events[index];
    if (event === undefined) throw new Error('fixture lost the failing verdict');
    expect(marker).toEqual({ index, ts: event.ts, kind: 'fail', label: 'theme failed audit' });
  });

  test('the Air joins twice and leaves once, with its display name', () => {
    const joins = markers.filter((marker) => marker.kind === 'node-join');
    expect(joins.map((marker) => marker.label)).toEqual([
      'MacBook Pro joined',
      'MacBook Air joined',
      'MacBook Air joined',
    ]);
    const leave = markers.find((marker) => marker.kind === 'node-leave');
    expect(leave?.label).toBe('MacBook Air left');
  });

  test('the migration names both ends and the task', () => {
    const migrate = markers.find((marker) => marker.kind === 'migrate');
    expect(migrate?.label).toBe('search migrated air → hub');
  });

  test('the plan marker carries the task count and the finish marker is last', () => {
    const plan = markers.find((marker) => marker.kind === 'plan');
    expect(plan?.label).toBe('plan: 7 tasks');
    expect(markers.at(-1)?.kind).toBe('finish');
    expect(markers.at(-1)?.index).toBe(events.length - 1);
  });

  test('markers are ordered by event index', () => {
    const indices = markers.map((marker) => marker.index);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });
});

describe('markerOf edge cases', () => {
  test('maps merge statuses to merge, conflict and failure kinds', () => {
    const merged = buildMarkers([fixtureEvent('merge.result', { taskKey: 'a', status: 'merged' })]);
    const conflict = buildMarkers([fixtureEvent('merge.result', { taskKey: 'b', status: 'conflict' })]);
    const failed = buildMarkers([fixtureEvent('merge.result', { taskKey: 'c', status: 'tests-failed' })]);
    expect(merged[0]?.kind).toBe('merge');
    expect(conflict[0]).toMatchObject({ kind: 'conflict', label: 'b conflict' });
    expect(failed[0]).toMatchObject({ kind: 'fail', label: 'c tests failed' });
  });

  test('ignores a skipped merge and a passing audit', () => {
    expect(buildMarkers([fixtureEvent('merge.result', { taskKey: 'a', status: 'skipped' })])).toEqual([]);
    expect(
      buildMarkers([
        fixtureEvent('audit.verdict', {
          taskKey: 'a',
          pass: true,
          checks: [],
          laneViolations: [],
          attempt: 1,
          model: { provider: 'ollama', model: 'x' },
          ts: 1,
          summary: 'ok',
        }),
      ]),
    ).toEqual([]);
  });

  test('a task.status transition to failed is a failure marker', () => {
    const [marker] = buildMarkers([
      fixtureEvent('task.status', { taskKey: 'csv-export', from: 'fixing', to: 'failed', run: {} }),
    ]);
    expect(marker).toMatchObject({ kind: 'fail', label: 'csv-export failed' });
  });
});

describe('nextMarker / nextFailure', () => {
  test('walks forward and backward between markers', () => {
    expect(nextMarker(markers, 0, 1)?.index).toBe(2);
    expect(nextMarker(markers, markers[0]?.index ?? 0, 1)?.index).toBe(5);
    expect(nextMarker(markers, 91, -1)?.index).toBe(90);
    expect(nextMarker(markers, 90, 1)?.index).toBe(91);
  });

  test('answers undefined past the ends', () => {
    expect(nextMarker(markers, -1, -1)).toBeUndefined();
    expect(nextMarker(markers, events.length + 10, 1)).toBeUndefined();
  });

  test('jump-to-failure skips healthy markers', () => {
    expect(nextFailure(markers, 0)?.index).toBe(90);
    expect(nextFailure(markers, 90)).toBeUndefined();
  });
});

describe('time ↔ index', () => {
  test('timeAtIndex clamps to the log', () => {
    const [first, second] = events;
    const lastEvent = events.at(-1);
    if (first === undefined || second === undefined || lastEvent === undefined) {
      throw new Error('fixture is too short');
    }
    expect(timeAtIndex(events, 0)).toBe(first.ts);
    expect(timeAtIndex(events, -5)).toBe(first.ts);
    expect(timeAtIndex(events, events.length + 5)).toBe(lastEvent.ts);
    expect(timeAtIndex(events, 1)).toBe(second.ts);
  });

  test('indexAtTime finds an exact event and the event before a quiet gap', () => {
    const target = eventIndexOf((event) => event.type === 'plan.created');
    expect(indexAtTime(events, events[target]?.ts ?? 0)).toBe(target);

    const leave = markers.find((marker) => marker.kind === 'node-leave');
    if (leave === undefined) throw new Error('fixture has no node.left marker');
    const joinAfter = markers.filter((marker) => marker.kind === 'node-join').at(-1);
    if (joinAfter === undefined) throw new Error('fixture has no second join');
    // 20 s into the Air's quiet minute: still the last event before the lid closed.
    const midGap = leave.ts + 20_000;
    expect(indexAtTime(events, midGap)).toBeGreaterThanOrEqual(leave.index);
    expect(indexAtTime(events, midGap)).toBeLessThan(joinAfter.index);
  });

  test('indexAtTime clamps before and after the recording', () => {
    expect(indexAtTime(events, 0)).toBe(0);
    expect(indexAtTime(events, Number.MAX_SAFE_INTEGER)).toBe(lastIndex(events));
    expect(indexAtTime([], 123)).toBe(0);
  });

  test('indexAtOffset maps a pointer position through time, not event count', () => {
    expect(indexAtOffset(events, 0, 1_000)).toBe(0);
    expect(indexAtOffset(events, 1_000, 1_000)).toBe(lastIndex(events));
    // Halfway in time is not halfway in events: the fixture has 252 events but a long quiet gap.
    expect(indexAtOffset(events, 500, 1_000)).toBe(indexAtTime(events, eventSpan(events).start + 178_000));
    expect(indexAtOffset(events, 100, 0)).toBe(0);
  });

  test('clampIndex rounds and clamps', () => {
    expect(clampIndex(3.6, 10)).toBe(4);
    expect(clampIndex(-1, 10)).toBe(0);
    expect(clampIndex(99, 10)).toBe(9);
    expect(clampIndex(Number.NaN, 10)).toBe(0);
  });
});

describe('positions are proportional to time', () => {
  const span = eventSpan(events);

  test('the span covers the fixture and positionOfTime is linear', () => {
    const first = events[0];
    const lastEvent = events.at(-1);
    if (first === undefined || lastEvent === undefined) throw new Error('fixture is empty');
    expect(span.start).toBe(first.ts);
    expect(span.end).toBe(lastEvent.ts);
    expect(span.duration).toBe(356_000);
    expect(positionOfTime(span.start, span)).toBe(0);
    expect(positionOfTime(span.start + 178_000, span)).toBeCloseTo(0.5, 6);
    expect(positionOfTime(span.end, span)).toBe(1);
    expect(timeAtPosition(0.5, span)).toBeCloseTo(span.start + 178_000, 6);
  });

  test("the Air's quiet minute is a real gap on the track", () => {
    const leave = markers.find((marker) => marker.kind === 'node-leave');
    const joinAfter = markers.find((marker) => marker.kind === 'node-join' && leave && marker.ts > leave.ts);
    if (leave === undefined || joinAfter === undefined) throw new Error('fixture lacks the Air gap');
    const gap = positionOfTime(joinAfter.ts, span) - positionOfTime(leave.ts, span);
    // 25 s of a 356 s run is ~7% of the width, even though only 11 events separate them.
    expect(gap).toBeGreaterThan(0.06);
    expect(gap).toBeLessThan(0.08);
  });

  test('markers closer than four pixels cluster', () => {
    const placed = markerPositions(markers, span);
    const clusters = clusterMarkers(placed, 960, 4);
    expect(clusters.length).toBeLessThan(markers.length);
    // theme's failed audit (63.5 s) and shortcuts' merge (64 s) are 1.35 px apart at 960 px.
    const failure = clusters.find((cluster) =>
      cluster.markers.some((marker) => marker.label === 'theme failed audit'),
    );
    expect(failure?.markers.map((marker) => marker.label)).toEqual([
      'theme failed audit',
      'shortcuts merged',
    ]);
  });

  test('a wide track de-clusters small gaps', () => {
    const placed = markerPositions(markers, span);
    const tiny = clusterMarkers(placed, 960, 4);
    const huge = clusterMarkers(placed, 960_000, 4);
    expect(huge.length).toBeGreaterThan(tiny.length);
    expect(clusterMarkers([], 960)).toEqual([]);
  });
});

describe('labels, value text and filters', () => {
  test('formats replay clocks', () => {
    expect(formatScrubTime(0)).toBe('0:00');
    expect(formatScrubTime(63_500)).toBe('1:03');
    expect(formatScrubTime(356_000)).toBe('5:56');
    expect(formatScrubTime(3_723_000)).toBe('1:02:03');
    expect(formatScrubTime(-5)).toBe('0:00');
  });

  test('the clock label reads T+elapsed / total', () => {
    expect(scrubClockLabel(events, 0)).toBe('T+0:00 / 5:56');
    expect(scrubClockLabel(events, events.length - 1)).toBe('T+5:56 / 5:56');
  });

  test('aria value text appends the marker label on the head', () => {
    expect(scrubValueText(events, 0, markers)).toBe('0:00');
    expect(scrubValueText(events, 90, markers)).toBe('1:03, theme failed audit');
  });

  test('filters hide node events but always keep plan and finish', () => {
    expect(markerCategories('conflict')).toEqual(['merges', 'failures']);
    expect(markerCategories('plan')).toEqual([]);
    expect(isMarkerVisible(markers[0] as Marker, ['merges', 'failures'])).toBe(false);
    const visible = filterMarkers(markers, ['merges', 'failures']);
    expect(visible.some((marker) => marker.kind === 'node-join')).toBe(false);
    expect(visible.some((marker) => marker.kind === 'plan')).toBe(true);
    expect(visible.some((marker) => marker.kind === 'finish')).toBe(true);
    expect(filterMarkers(markers, MARKER_FILTERS)).toHaveLength(markers.length);
  });

  test('counts fuel the filter chips', () => {
    expect(markerCounts(markers)).toEqual({ merges: 7, failures: 1, nodes: 5 });
  });
});
