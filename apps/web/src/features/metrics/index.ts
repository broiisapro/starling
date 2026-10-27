/** Feature lane: the metrics panel and cost meter (Epic 26). */
export const FEATURE = 'metrics' as const;

export { CostMeter, type CostMeterProps } from './CostMeter';
export type { CostBreakdown, MetricsSample, TokenSplit } from './cost';
export {
  costBreakdown,
  DEFAULT_SAMPLE_INTERVAL_MS,
  latestSample,
  liveElapsedMs,
  metricsThroughput,
  STALE_SAMPLE_FACTOR,
  sampleIntervalMs,
  throughputPer10Min,
  tokenSplit,
  tokenTotal,
} from './cost';
export {
  COUNT_UP_MS,
  countUpValue,
  easeOutCubic,
  interpolate,
  useCountUp,
} from './count-up';
export {
  formatDuration,
  formatRate,
  formatTokens,
  formatTokensExact,
  formatUsd,
  shortSha,
} from './format';
export type { MetricsPanelProps } from './handshake';
export {
  prefersReducedMotion,
  REDUCED_MOTION_QUERY,
  useNow,
  usePrefersReducedMotion,
} from './hooks';
export { MetricsPanel } from './MetricsPanel';
export { MOTION_CSS } from './motion';
export {
  OFF_PEAK_RATIO,
  offPeakUsd,
  PEAK_MODEL,
  type PeakNote,
  peakNote,
  SAVED_MODEL,
  savedDetail,
} from './pricing';
export { replayMetrics } from './replay';
export { SparklineChart } from './SparklineChart';
export type { SparklineGeometry, SparklineOptions, SparklinePoint } from './sparkline';
export { seriesFromHistory, sparklineGeometry } from './sparkline';
export type { MetricsExtras, MetricsPanelAllProps } from './types';
