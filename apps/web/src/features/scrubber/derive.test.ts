import { describe, expect, test } from 'bun:test';
import type { StarlingEvent } from '@starling/core/browser';
import { demoEvents } from '../../data/demo';
import { createPreviewCache, describeEvent, previewAt } from './derive';
import { buildMarkers } from './markers';

/** Pure preview tests: the scrubber's "what would the dashboard look like here?" maths. */
const events = demoEvents();
const markers = buildMarkers(events);
const failureIndex = markers.find((marker) => marker.kind === 'fail')?.index ?? -1;
const end = events.length - 1;

function event(type: string, payload: Record<string, unknown>, ts = 1_000): StarlingEvent {
  return { type, runId: 'run', ts, payload } as unknown as StarlingEvent;
}

describe('previewAt', () => {
  test('the failure frame reports two landed, two flying and the audit verdict on the head', () => {
    const preview = previewAt(events, failureIndex);
    expect(preview).toBeDefined();
    expect(preview?.index).toBe(failureIndex);
    expect(preview?.applied).toBe(failureIndex + 1);
    expect(preview?.tasks).toBe(7);
    expect(preview?.landed).toBe(2);
    expect(preview?.flying).toBe(2);
    expect(preview?.failed).toBe(0);
    expect(preview?.waiting).toBe(3);
    expect(preview?.runStatus).toBe('running');
    expect(preview?.lastEvent).toEqual({ type: 'audit.verdict', summary: 'theme audit failed' });
  });

  test('the final frame is the finished run: seven landed, cost and tokens settled', () => {
    const preview = previewAt(events, end);
    expect(preview).toMatchObject({
      index: end,
      applied: events.length,
      tasks: 7,
      landed: 7,
      flying: 0,
      failed: 0,
      waiting: 0,
      runStatus: 'finished',
    });
    expect(preview?.costUsd).toBeCloseTo(0.0421956, 6);
    // input + output; `cached` is a subset of input, so adding it again would over-count.
    expect(preview?.tokens).toBe(119_550);
    expect(preview?.lastEvent?.summary).toBe('run finished');
  });

  test('the first frame is a run that has not started working yet', () => {
    const preview = previewAt(events, 0);
    expect(preview).toMatchObject({
      index: 0,
      applied: 1,
      landed: 0,
      flying: 0,
      failed: 0,
      costUsd: 0,
      tokens: 0,
    });
    expect(preview?.lastEvent?.summary).toBe('run started');
  });

  test('landed counts grow monotonically over the recording', () => {
    const samples = [0, 60, 120, 180, end].map((index) => previewAt(events, index)?.landed ?? -1);
    expect(samples).toEqual([...samples].sort((a, b) => a - b));
    expect(samples.at(-1)).toBe(7);
  });

  test('clamps an out-of-range index and answers undefined for an empty log', () => {
    expect(previewAt(events, -20)?.index).toBe(0);
    expect(previewAt(events, 10_000)?.index).toBe(end);
    expect(previewAt([], 0)).toBeUndefined();
  });

  test('is pure: the source array is not mutated', () => {
    const before = events.length;
    const firstTs = events[0]?.ts;
    previewAt(events, 100);
    expect(events.length).toBe(before);
    expect(events[0]?.ts).toBe(firstTs);
  });
});

describe('createPreviewCache', () => {
  test('returns the same object for the same index and recomputes for a new one', () => {
    const cached = createPreviewCache(events);
    const first = cached(50);
    expect(cached(50)).toBe(first);
    expect(cached(51)).not.toBe(first);
    expect(cached(51)?.index).toBe(51);
    expect(cached(Number.MAX_SAFE_INTEGER)?.index).toBe(end);
  });
});

describe('describeEvent', () => {
  test('summarises the events the preview card shows', () => {
    expect(describeEvent(event('run.created', { run: {} }))).toBe('run started');
    expect(describeEvent(event('repomap.ready', { files: 42, tokenEstimate: 1 }))).toBe(
      'repository mapped · 42 files',
    );
    expect(describeEvent(event('plan.created', { plan: { tasks: [{}, {}, {}] }, issues: [] }))).toBe(
      'plan created · 3 tasks',
    );
    expect(describeEvent(event('task.status', { taskKey: 'theme', from: 'running', to: 'auditing' }))).toBe(
      'theme running → auditing',
    );
    expect(describeEvent(event('agent.event', { taskKey: 'theme', kind: 'file.edited', data: {} }))).toBe(
      'theme file.edited',
    );
    expect(
      describeEvent(
        event('audit.verdict', { taskKey: 'theme', pass: false, attempt: 1, checks: [], laneViolations: [] }),
      ),
    ).toBe('theme audit failed');
    expect(describeEvent(event('merge.result', { taskKey: 'theme', status: 'merged' }))).toBe(
      'theme merge merged',
    );
    expect(describeEvent(event('log', { level: 'warn', msg: 'careful' }))).toBe('warn: careful');
    expect(
      describeEvent(event('node.left', { nodeId: 'air', reason: 'heartbeat lost for 15s (lid closed)' })),
    ).toBe('air left · heartbeat lost for 15s (lid closed)');
    expect(
      describeEvent(
        event('task.migrated', { taskKey: 'search', fromNode: 'air', toNode: 'hub', reason: 'x' }),
      ),
    ).toBe('search migrated air → hub');
    expect(describeEvent(event('run.finished', { run: {}, summary: 'done' }))).toBe('run finished');
  });

  test('falls back to the type for an additive event a newer hub publishes', () => {
    expect(describeEvent(event('run.status', { from: 'planning', to: 'running' }))).toBe(
      'run planning → running',
    );
    expect(describeEvent(event('future.event', { anything: true }))).toBe('future.event');
  });
});
