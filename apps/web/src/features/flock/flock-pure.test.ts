import { describe, expect, test } from 'bun:test';
import type { StarlingEvent } from '@starling/core';
import { BASE_TS, makeNodeInfo } from '@starling/core/testing';
import { deriveNodes, deriveTasks } from './derive-nodes';
import {
  formatHardware,
  formatHardwareParts,
  formatLatency,
  freeSessions,
  relativeTime,
  sessionTotals,
  sortRoosts,
} from './format';
import { parseEventLog } from './Playground';
import { qrMatrix } from './QrCode';

const FIXTURE = new URL('../../../../../fixtures/runs/sky-todo-launch-day.jsonl', import.meta.url);

function nodeEvent(
  type: 'node.joined' | 'node.stats',
  ts: number,
  overrides: Parameters<typeof makeNodeInfo>[0] = {},
) {
  const node = makeNodeInfo({ lastSeen: ts, ...overrides });
  return { type, runId: '*', ts, payload: { node } } satisfies StarlingEvent;
}

describe('relativeTime', () => {
  test('reads like a person, from just now to days', () => {
    expect(relativeTime(BASE_TS, BASE_TS)).toBe('just now');
    expect(relativeTime(BASE_TS, BASE_TS + 999)).toBe('just now');
    expect(relativeTime(BASE_TS, BASE_TS + 12_000)).toBe('12s ago');
    expect(relativeTime(BASE_TS, BASE_TS + 125_000)).toBe('2m ago');
    expect(relativeTime(BASE_TS, BASE_TS + 3 * 3_600_000)).toBe('3h ago');
    expect(relativeTime(BASE_TS, BASE_TS + 2 * 86_400_000)).toBe('2d ago');
  });

  test('a clock that runs backwards never renders a negative age', () => {
    expect(relativeTime(BASE_TS, BASE_TS - 5_000)).toBe('just now');
  });
});

describe('hardware line', () => {
  const node = makeNodeInfo({ platform: 'darwin', arch: 'arm64', cpuCores: 8, memGb: 16 });

  test('splits into atoms a narrow card can wrap between', () => {
    expect(formatHardwareParts(node)).toEqual(['darwin · arm64', '8 cores · 16 GB']);
  });

  test('the atoms join back into the one-line form other callers use', () => {
    expect(formatHardware(node)).toBe('darwin · arm64 · 8 cores · 16 GB');
    expect(formatHardwareParts(node).join(' · ')).toBe(formatHardware(node));
  });

  test('a fractional memory size stays inside its atom', () => {
    // 32.5 GB once rendered as "32.5" / "GB" across a line break, which read as two facts.
    expect(formatHardwareParts({ ...node, memGb: 32.5 })[1]).toBe('8 cores · 32.5 GB');
  });
});

describe('roost ordering and totals', () => {
  test('hub first, then by name — and the input array is untouched', () => {
    const air = makeNodeInfo({ id: 'air', name: 'MacBook Air', kind: 'remote' });
    const hub = makeNodeInfo({ id: 'hub', name: 'MacBook Pro' });
    const mini = makeNodeInfo({ id: 'mini', name: 'Alder Lake', kind: 'remote' });
    const input = [air, mini, hub];
    expect(sortRoosts(input).map((node) => node.id)).toEqual(['hub', 'mini', 'air']);
    expect(input.map((node) => node.id)).toEqual(['air', 'mini', 'hub']);
  });

  test('session totals clamp over-reported activity and never go negative', () => {
    const hub = makeNodeInfo({ activeSessions: 3, maxSessions: 8 });
    const air = makeNodeInfo({ id: 'air', activeSessions: 9, maxSessions: 5, kind: 'remote' });
    expect(sessionTotals([hub, air])).toEqual({ active: 8, max: 13, free: 5 });
    expect(freeSessions(air)).toBe(0);
  });

  test('latency formatting', () => {
    expect(formatLatency(undefined)).toBe('no ping');
    expect(formatLatency(0.6)).toBe('<2 ms');
    expect(formatLatency(18)).toBe('18 ms');
  });
});

describe('deriveNodes', () => {
  test('join, heartbeat, leave and rejoin become an honest node list', () => {
    const events: StarlingEvent[] = [
      nodeEvent('node.joined', BASE_TS),
      nodeEvent('node.stats', BASE_TS + 5_000, { activeSessions: 4, status: 'busy' }),
      nodeEvent('node.joined', BASE_TS + 6_000, {
        id: 'air',
        name: 'MacBook Air',
        kind: 'remote',
        url: 'http://192.168.1.42:7778',
        maxSessions: 5,
        activeSessions: 2,
        status: 'busy',
        latencyMs: 18,
      }),
      nodeEvent('node.stats', BASE_TS + 9_000, {
        id: 'air',
        name: 'MacBook Air',
        kind: 'remote',
        status: 'busy',
      }),
      {
        type: 'node.left',
        runId: '*',
        ts: BASE_TS + 15_000,
        payload: { nodeId: 'air', reason: 'lid closed' },
      },
    ];

    const before = deriveNodes(events.slice(0, 4));
    expect(before.map((node) => node.id)).toEqual(['hub', 'air']);
    expect(before[1]?.status).toBe('busy');

    const after = deriveNodes(events);
    const air = after.find((node) => node.id === 'air');
    expect(air?.status).toBe('offline');
    expect(air?.activeSessions).toBe(0);
    expect(air?.lastSeen).toBe(BASE_TS + 15_000);
    expect(air?.url).toBe('http://192.168.1.42:7778');

    const rejoined = deriveNodes([
      ...events,
      nodeEvent('node.joined', BASE_TS + 22_000, {
        id: 'air',
        name: 'MacBook Air',
        kind: 'remote',
        status: 'online',
      }),
    ]);
    expect(rejoined.find((node) => node.id === 'air')?.status).toBe('online');
  });

  test('a leave for an unknown node is ignored rather than invented', () => {
    const events: StarlingEvent[] = [
      { type: 'node.left', runId: '*', ts: BASE_TS, payload: { nodeId: 'ghost', reason: 'never joined' } },
    ];
    expect(deriveNodes(events)).toEqual([]);
  });

  test('the fixture tells the story: the Air joins mid-run, drops, then comes back', async () => {
    const parsed = parseEventLog(await Bun.file(FIXTURE).text());
    expect(parsed.skipped).toBe(0);
    expect(parsed.events.length).toBe(252);

    const untilDrop = parsed.events.filter((event) => event.ts <= 1_731_000_190_200);
    const dropped = deriveNodes(untilDrop);
    expect(dropped.map((node) => node.id)).toEqual(['hub', 'air']);
    expect(dropped[1]?.status).toBe('offline');
    expect(dropped[1]?.lastSeen).toBe(1_731_000_190_000);
    expect(relativeTime(dropped[1]?.lastSeen ?? 0, 1_731_000_192_000)).toBe('2s ago');

    const final = deriveNodes(parsed.events);
    expect(final.map((node) => node.id)).toEqual(['hub', 'air']);
    expect(final[1]?.status).toBe('online');
    expect(final.find((node) => node.id === 'hub')?.maxSessions).toBe(8);
  });
});

describe('deriveTasks', () => {
  test('the fixture ends with the Air’s search task migrated back to the hub', () => {
    const events = parseEventLog(
      '{"type":"task.status","runId":"r","ts":1,"payload":{"taskKey":"search","from":"ready","to":"running","run":{"runId":"r","taskKey":"search","status":"running","attempts":1,"usage":{"input":0,"output":0,"cached":0},"costUsd":0,"nodeId":"air"}}}\n' +
        '{"type":"task.status","runId":"r","ts":2,"payload":{"taskKey":"search","from":"running","to":"running","run":{"runId":"r","taskKey":"search","status":"running","attempts":1,"usage":{"input":0,"output":0,"cached":0},"costUsd":0,"nodeId":"hub"}}}\n',
    ).events;
    expect(deriveTasks(events).search?.nodeId).toBe('hub');
  });
});

describe('qrMatrix', () => {
  test('encodes the join command into real modules', () => {
    const matrix = qrMatrix('starling perch --hub http://192.168.1.42:7777 --code STAR-LING');
    expect(matrix.ok).toBe(true);
    if (matrix.ok) {
      expect(matrix.size).toBeGreaterThanOrEqual(21);
      expect(matrix.path.length).toBeGreaterThan(100);
      expect(matrix.path.startsWith('M')).toBe(true);
    }
  });

  test('reports an empty payload instead of throwing', () => {
    const matrix = qrMatrix('');
    expect(matrix.ok).toBe(false);
  });
});
