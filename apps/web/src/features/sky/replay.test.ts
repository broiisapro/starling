import { describe, expect, test } from 'bun:test';
import {
  buildFrame,
  describeSky,
  indexAtTs,
  nextBeat,
  parseEventJsonl,
  RECENT_WINDOW_MS,
  statusCounts,
} from './replay';

const fixtureUrl = new URL('../../../../../fixtures/runs/sky-todo-launch-day.jsonl', import.meta.url);
const fixtureText = await Bun.file(fixtureUrl).text();
const events = parseEventJsonl(fixtureText);
const firstTs = events[0]?.ts ?? 0;

function frameAt(seconds: number) {
  return buildFrame(events, indexAtTs(events, firstTs + seconds * 1000));
}

describe('parsing', () => {
  test('reads the launch-day fixture and skips malformed lines', () => {
    expect(events.length).toBe(252);
    expect(events[0]?.type).toBe('run.created');
    expect(events.at(-1)?.type).toBe('run.finished');

    const withJunk = parseEventJsonl(`${fixtureText}\n\nnot json\n{"type":"nope"}\n{"type":"metrics"}`);
    expect(withJunk.length).toBe(252);
  });
});

describe('buildFrame', () => {
  test('frame 0 is a run with a plan and seven pending tasks', () => {
    const frame = buildFrame(events, 0);
    expect(frame.run?.plan?.tasks.length).toBe(7);
    expect(Object.keys(frame.run?.tasks ?? {}).length).toBe(7);
    expect(Object.values(frame.run?.tasks ?? {}).every((task) => task.status === 'pending')).toBe(true);
    expect(frame.nodes).toEqual([]);
    expect(frame.recent.length).toBe(1);
  });

  test('a mid-run frame shows live statuses, two roosts and a 10 s activity window', () => {
    const frame = frameAt(120);
    expect(frame.nodes.map((node) => node.id).sort()).toEqual(['air', 'hub']);
    const counts = statusCounts(frame.run);
    expect(counts.merged).toBe(4);
    expect(counts.running).toBe(3);
    expect(frame.recent.length).toBeGreaterThan(0);
    for (const event of frame.recent) {
      expect(frame.ts - event.ts).toBeLessThanOrEqual(RECENT_WINDOW_MS);
    }
    expect(frame.recent.some((event) => event.type === 'agent.event')).toBe(true);
  });

  test("the Air's roost is marked offline between node.left and the rejoin", () => {
    const offline = frameAt(195);
    expect(offline.nodes.find((node) => node.id === 'air')?.status).toBe('offline');
    expect(offline.run?.tasks.search?.nodeId).toBe('hub');

    const rejoined = frameAt(260);
    expect(rejoined.nodes.find((node) => node.id === 'air')?.status).not.toBe('offline');
  });

  test('the final frame has every task merged and the recorded metrics', () => {
    const frame = buildFrame(events, events.length - 1);
    expect(Object.values(frame.run?.tasks ?? {}).every((task) => task.status === 'merged')).toBe(true);
    expect(frame.run?.status).toBe('finished');
    expect(frame.run?.metrics.tasksMerged).toBe(7);
    expect(frame.run?.metrics.apiCostUsd).toBeGreaterThan(0);
    expect(frame.run?.integrationBranch).toBeTruthy();
  });

  test('scrubbing backwards is pure: an earlier frame is identical afterwards', () => {
    const before = buildFrame(events, 10);
    buildFrame(events, 300);
    const after = buildFrame(events, 10);
    expect(after.run).toEqual(before.run);
    expect(after.recent).toEqual(before.recent);
    // The original JSONL event objects are never mutated.
    expect(events[0]?.type).toBe('run.created');
  });

  test('buildFrame clamps indexes instead of throwing', () => {
    expect(buildFrame(events, -50).index).toBe(0);
    expect(buildFrame(events, 99_999).index).toBe(events.length - 1);
    expect(buildFrame([], 3)).toEqual({ run: undefined, nodes: [], recent: [], index: -1, ts: 0 });
  });
});

describe('scrubbing helpers', () => {
  test('indexAtTs maps a wall time to the nearest event', () => {
    expect(indexAtTs(events, 0)).toBe(0);
    expect(indexAtTs(events, firstTs + 120_000)).toBeGreaterThan(0);
    expect(indexAtTs(events, Number.MAX_SAFE_INTEGER)).toBe(events.length - 1);
  });

  test('nextBeat walks status changes and node churn', () => {
    const beats = new Set(['task.status', 'merge.result', 'node.joined', 'node.left', 'run.finished']);
    const first = nextBeat(events, 0, 1);
    expect(beats.has(events[first]?.type ?? '')).toBe(true);

    const back = nextBeat(events, events.length - 1, -1);
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThan(events.length - 1);
    expect(beats.has(events[back]?.type ?? '')).toBe(true);
    expect(nextBeat(events, 0, -1)).toBe(0);
  });
});

describe('accessible summary', () => {
  test('describes counts and machines in one sentence', () => {
    const frame = frameAt(120);
    const text = describeSky(frame.run, frame.nodes);
    expect(text).toContain('7 tasks');
    expect(text).toContain('4 merged');
    expect(text).toContain('3 running');
    expect(text).toContain('2 machines');
    expect(describeSky(undefined, [])).toBe('No run. 0 machines.');
  });
});
