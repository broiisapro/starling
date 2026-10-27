import { formatDuration, formatTokens, formatUsd } from '../../lib/format';
import type { RunStats } from './derive';

/**
 * The delta table for the compare page: one row per metric, with "better" decided by that metric's
 * own direction (lower wall/cost/failures, higher speedup/merged/parallelism). Re-exported from
 * `derive.ts` so callers have one entry point for both snapshots and tables.
 */

export type MetricFormat = 'duration' | 'usd' | 'count' | 'tokens' | 'multiplier';
export type MetricDirection = 'lower' | 'higher';
export type CompareMetric =
  | 'wall'
  | 'speedup'
  | 'peakParallel'
  | 'merged'
  | 'failed'
  | 'attempts'
  | 'apiCost'
  | 'tokens'
  | 'saved';

export interface CompareRow {
  metric: CompareMetric;
  label: string;
  format: MetricFormat;
  direction: MetricDirection;
  a: number;
  b: number;
  /** `a - b`; negative means A is numerically lower. */
  delta: number;
  better: 'a' | 'b' | 'same';
}

const EPSILON = 1e-9;

interface MetricDef {
  metric: CompareMetric;
  label: string;
  format: MetricFormat;
  direction: MetricDirection;
  value(stats: RunStats): number;
}

const METRICS: readonly MetricDef[] = [
  { metric: 'wall', label: 'Wall clock', format: 'duration', direction: 'lower', value: (s) => s.wallMs },
  {
    metric: 'speedup',
    label: 'Parallel speedup',
    format: 'multiplier',
    direction: 'higher',
    value: (s) => s.speedup,
  },
  {
    metric: 'peakParallel',
    label: 'Peak parallel agents',
    format: 'count',
    direction: 'higher',
    value: (s) => s.peakParallel,
  },
  { metric: 'merged', label: 'Tasks merged', format: 'count', direction: 'higher', value: (s) => s.merged },
  { metric: 'failed', label: 'Tasks failed', format: 'count', direction: 'lower', value: (s) => s.failed },
  {
    metric: 'attempts',
    label: 'Fix attempts',
    format: 'count',
    direction: 'lower',
    value: (s) => s.attempts,
  },
  { metric: 'apiCost', label: 'API cost', format: 'usd', direction: 'lower', value: (s) => s.apiCostUsd },
  { metric: 'tokens', label: 'API tokens', format: 'tokens', direction: 'lower', value: (s) => s.tokens },
  { metric: 'saved', label: 'Local savings', format: 'usd', direction: 'higher', value: (s) => s.savedUsd },
];

/** One row per metric, with "better" already decided by that metric's direction. */
export function compareStats(a: RunStats, b: RunStats): CompareRow[] {
  return METRICS.map((def) => {
    const aValue = def.value(a);
    const bValue = def.value(b);
    const delta = aValue - bValue;
    let better: CompareRow['better'] = 'same';
    if (Math.abs(delta) > EPSILON) {
      const aBetter = def.direction === 'lower' ? aValue < bValue : aValue > bValue;
      better = aBetter ? 'a' : 'b';
    }
    return {
      metric: def.metric,
      label: def.label,
      format: def.format,
      direction: def.direction,
      a: aValue,
      b: bValue,
      delta,
      better,
    };
  });
}

/** Value as the table renders it. Formatters come from `lib/format`; no locale, so tests are stable. */
export function formatMetricValue(format: MetricFormat, value: number): string {
  switch (format) {
    case 'duration':
      return formatDuration(value);
    case 'usd':
      return formatUsd(value);
    case 'tokens':
      return formatTokens(value);
    case 'multiplier':
      return `${value.toFixed(2)}×`;
    case 'count':
      return String(Math.round(value));
  }
}

export interface DeltaChip {
  /** ▲ when A is better, ▼ when B is, = when the numbers match. Never colour alone. */
  arrow: '▲' | '▼' | '=';
  /** The absolute difference, formatted for the metric. */
  text: string;
  /** Full label for a title/aria attribute, e.g. "▲ 1m 32s — A better". */
  label: string;
  winner: 'a' | 'b' | 'same';
  /** Stable class fragment; the component maps it to a tone. */
  tone: 'better-a' | 'better-b' | 'same';
}

export function deltaChip(row: CompareRow): DeltaChip {
  if (row.better === 'same') {
    return { arrow: '=', text: 'same', label: '= — the same', winner: 'same', tone: 'same' };
  }
  return {
    arrow: row.better === 'a' ? '▲' : '▼',
    text: formatMetricValue(row.format, Math.abs(row.delta)),
    label: `${row.better === 'a' ? '▲' : '▼'} ${formatMetricValue(row.format, Math.abs(row.delta))} — ${
      row.better === 'a' ? 'A' : 'B'
    } better`,
    winner: row.better,
    tone: row.better === 'a' ? 'better-a' : 'better-b',
  };
}
