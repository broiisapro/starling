import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { RunMetrics, StarlingEvent } from '@starling/core';
import { DEFAULT_SAVED_MODEL, estimateSavedUsd, StarlingEventSchema, usageCostUsd } from '@starling/core';
import type { MetricsSample } from './cost';
import {
  costBreakdown,
  latestSample,
  liveElapsedMs,
  metricsThroughput,
  sampleIntervalMs,
  throughputPer10Min,
  tokenSplit,
  tokenTotal,
} from './cost';

const FIXTURE_URL = new URL('../../../../../fixtures/runs/sky-todo-launch-day.jsonl', import.meta.url);

/** Real `metrics` events from the recorded launch-day run, in order. */
const fixtureSamples: MetricsSample[] = readFileSync(FIXTURE_URL, 'utf8')
  .trim()
  .split('\n')
  .map((line) => StarlingEventSchema.parse(JSON.parse(line)) as StarlingEvent)
  .flatMap((event) => (event.type === 'metrics' ? [{ ts: event.ts, metrics: event.payload }] : []));

const finalSample = fixtureSamples[fixtureSamples.length - 1];
const finalMetrics: RunMetrics = finalSample?.metrics ?? ({} as RunMetrics);

describe('the fixture run', () => {
  test('has metrics samples every five seconds', () => {
    expect(fixtureSamples.length).toBeGreaterThan(60);
    expect(sampleIntervalMs(fixtureSamples)).toBe(5_000);
  });
});

describe('costBreakdown', () => {
  test('reads API spend straight from RunMetrics (no re-pricing at render time)', () => {
    expect(finalMetrics.apiCostUsd).toBeCloseTo(0.0421956, 10);
    const breakdown = costBreakdown(finalMetrics);
    expect(breakdown.apiSpendUsd).toBe(finalMetrics.apiCostUsd);
  });

  test('local models are free, badge and all', () => {
    const breakdown = costBreakdown(finalMetrics);
    expect(breakdown.localSpendUsd).toBe(0);
    expect(breakdown.localCallCount).toBe(9);
  });

  test('savings match both RunMetrics and a fresh pricing estimate', () => {
    const breakdown = costBreakdown(finalMetrics);
    expect(breakdown.savedUsd).toBe(finalMetrics.estSavedUsd);
    expect(breakdown.savedUsd).toBeCloseTo(estimateSavedUsd(finalMetrics.localUsage), 10);
    expect(breakdown.savedUsd).toBeCloseTo(usageCostUsd(DEFAULT_SAVED_MODEL, finalMetrics.localUsage), 10);
  });

  test('token counts are input + output per lane', () => {
    const breakdown = costBreakdown(finalMetrics);
    expect(breakdown.apiTokenCount).toBe(103_500 + 16_050);
    expect(breakdown.localTokenCount).toBe(53_200 + 6_560);
    expect(breakdown.totalTokenCount).toBe(breakdown.apiTokenCount + breakdown.localTokenCount);
  });

  test('shares split the bar exactly once', () => {
    const { split } = costBreakdown(finalMetrics);
    expect(split.apiShare + split.localShare).toBeCloseTo(1, 12);
    expect(split.apiShare).toBeGreaterThan(split.localShare);
    expect(split.api).toBe(119_550);
    expect(split.local).toBe(59_760);
  });

  test('an undefined metrics object renders as zeros, never NaN', () => {
    const breakdown = costBreakdown(undefined);
    expect(breakdown.apiSpendUsd).toBe(0);
    expect(breakdown.savedUsd).toBe(0);
    expect(breakdown.totalTokenCount).toBe(0);
    expect(breakdown.split.apiShare).toBe(0);
    expect(breakdown.split.localShare).toBe(0);
    expect(Number.isNaN(breakdown.split.total)).toBe(false);
  });

  test('negative and non-finite values are clamped', () => {
    const broken = {
      ...finalMetrics,
      apiCostUsd: -1,
      estSavedUsd: Number.NaN,
      localCallCount: -3,
    } satisfies RunMetrics;
    const breakdown = costBreakdown(broken);
    expect(breakdown.apiSpendUsd).toBe(0);
    expect(breakdown.savedUsd).toBe(0);
    expect(breakdown.localCallCount).toBe(0);
  });
});

describe('token math', () => {
  test('cached tokens are a subset of input', () => {
    expect(tokenTotal({ input: 1_000, output: 200, cached: 600 })).toBe(1_200);
  });

  test('a zero split has zero shares instead of dividing by zero', () => {
    const split = tokenSplit(0, 0);
    expect(split.apiShare).toBe(0);
    expect(split.localShare).toBe(0);
  });

  test('a purely local run is 100% local', () => {
    const split = tokenSplit(0, 500);
    expect(split.localShare).toBe(1);
    expect(split.apiShare).toBe(0);
  });
});

describe('throughput', () => {
  test('seven merges in 5m 55s is about 11.8 per ten minutes', () => {
    const rate = throughputPer10Min(7, 355_000);
    expect(rate).toBeCloseTo(11.8309, 3);
    expect(metricsThroughput(finalMetrics)).toBeCloseTo(11.8309, 3);
  });

  test('unknown elapsed time is zero, not Infinity', () => {
    expect(throughputPer10Min(7, 0)).toBe(0);
    expect(throughputPer10Min(7, Number.NaN)).toBe(0);
    expect(metricsThroughput(undefined)).toBe(0);
  });

  test('nothing merged is zero', () => {
    expect(throughputPer10Min(0, 60_000)).toBe(0);
  });
});

describe('liveElapsedMs', () => {
  const metrics: RunMetrics = { ...finalMetrics, elapsedMs: 10_000 };
  const last = finalSample?.ts ?? 0;
  const history: MetricsSample[] = [
    { ts: last - 5_000, metrics: { ...metrics, elapsedMs: 5_000 } },
    { ts: last, metrics },
  ];

  test('interpolates between samples, so the clock ticks', () => {
    expect(liveElapsedMs(metrics, history, last + 1_200)).toBe(11_200);
  });

  test('freezes once the stream goes stale', () => {
    expect(liveElapsedMs(metrics, history, last + 60_000)).toBe(10_000);
  });

  test('never runs backwards on clock skew', () => {
    expect(liveElapsedMs(metrics, history, last - 5_000)).toBe(10_000);
  });

  test('falls back to the reported elapsed before the first sample', () => {
    expect(liveElapsedMs(metrics, [], last)).toBe(10_000);
    expect(liveElapsedMs(undefined, history, last + 1_000)).toBe(0);
  });

  test('does not invent time for a run that has not started', () => {
    const zero: RunMetrics = { ...metrics, elapsedMs: 0 };
    const samples: MetricsSample[] = [
      { ts: last - 5_000, metrics: zero },
      { ts: last, metrics: zero },
    ];
    expect(liveElapsedMs(zero, samples, last + 1_000)).toBe(0);
  });

  test('latestSample is the newest entry', () => {
    expect(latestSample(history)).toBe(history[1]);
    expect(latestSample([])).toBeUndefined();
  });
});
