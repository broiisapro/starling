import type { StarlingEvent } from '@starling/core';

import type { MetricsSample } from './cost';

/**
 * Every `metrics` event up to `upTo`, in order — the pure half of `Playground`, kept free of the
 * `?raw` fixture import so it can be unit-tested in plain Bun.
 */
export function replayMetrics(events: readonly StarlingEvent[], upTo: number): MetricsSample[] {
  const samples: MetricsSample[] = [];
  for (let index = 0; index <= upTo && index < events.length; index += 1) {
    const event = events[index];
    if (event?.type === 'metrics') samples.push({ ts: event.ts, metrics: event.payload });
  }
  return samples;
}
