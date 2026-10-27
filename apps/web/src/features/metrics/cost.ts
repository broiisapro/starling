/**
 * Cost-meter and throughput math for the bottom strip. Pure functions only, so every number the
 * panel shows is testable without a DOM or a clock.
 *
 * The display rule is "engine owns the money": `apiCostUsd` and `estSavedUsd` come from the run's
 * `RunMetrics` (computed by `@starling/core`'s pricing table inside the engine). This module never
 * re-prices tokens at render time; it only splits, shapes and extrapolates.
 */
import type { RunMetrics, TokenUsage } from '@starling/core';

/** One metrics sample from `history` (the shell streams one per `metrics` event). */
export interface MetricsSample {
  ts: number;
  metrics: RunMetrics;
}

/** Default cadence assumption when `history` is too short to measure one. */
export const DEFAULT_SAMPLE_INTERVAL_MS = 5_000;

/**
 * How long after the last sample the panel is still allowed to interpolate before it freezes.
 * 1.25 samples + 250 ms means a normal 5 s stream drifts at most ~1.5 s past the true end of a run,
 * which is why a finished run stops ticking almost immediately.
 */
export const STALE_SAMPLE_FACTOR = 1.25;
const STALE_SAMPLE_GRACE_MS = 250;

const ZERO_USAGE: TokenUsage = { input: 0, output: 0, cached: 0 };

export interface TokenSplit {
  api: number;
  local: number;
  total: number;
  /** Fraction of all tokens spent on the API; 0 when nothing has been spent yet. */
  apiShare: number;
  /** Fraction of all tokens spent on local models; 0 when nothing has been spent yet. */
  localShare: number;
}

export interface CostBreakdown {
  apiSpendUsd: number;
  /** Always 0: local models are free. Kept explicit so the UI can't "forget" the local lane. */
  localSpendUsd: number;
  savedUsd: number;
  apiTokens: TokenUsage;
  localTokens: TokenUsage;
  apiTokenCount: number;
  localTokenCount: number;
  totalTokenCount: number;
  split: TokenSplit;
  localCallCount: number;
}

/** `cached` is a subset of `input` (see ARCHITECTURE §6), so a token count is input + output. */
export function tokenTotal(usage: TokenUsage | undefined): number {
  if (usage === undefined) return 0;
  return Math.max(0, usage.input) + Math.max(0, usage.output);
}

/** API vs local share of all tokens, as fractions that always sum to 1 (or 0 when empty). */
export function tokenSplit(apiTokens: number, localTokens: number): TokenSplit {
  const api = Number.isFinite(apiTokens) ? Math.max(0, apiTokens) : 0;
  const local = Number.isFinite(localTokens) ? Math.max(0, localTokens) : 0;
  const total = api + local;
  return {
    api,
    local,
    total,
    apiShare: total === 0 ? 0 : api / total,
    localShare: total === 0 ? 0 : local / total,
  };
}

/** Defensive: an undefined or partial RunMetrics renders as an all-zero meter, never as NaN. */
export function costBreakdown(metrics: RunMetrics | undefined): CostBreakdown {
  const apiTokens = metrics?.apiUsage ?? ZERO_USAGE;
  const localTokens = metrics?.localUsage ?? ZERO_USAGE;
  const apiTokenCount = tokenTotal(apiTokens);
  const localTokenCount = tokenTotal(localTokens);
  return {
    apiSpendUsd: nonNegative(metrics?.apiCostUsd),
    localSpendUsd: 0,
    savedUsd: nonNegative(metrics?.estSavedUsd),
    apiTokens,
    localTokens,
    apiTokenCount,
    localTokenCount,
    totalTokenCount: apiTokenCount + localTokenCount,
    split: tokenSplit(apiTokenCount, localTokenCount),
    localCallCount: Math.max(0, Math.round(metrics?.localCallCount ?? 0)),
  };
}

function nonNegative(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

/**
 * Median gap between the last few samples — robust against one missed heartbeat. `undefined` until
 * there are two samples to measure.
 */
export function sampleIntervalMs(history: readonly MetricsSample[]): number | undefined {
  if (history.length < 2) return undefined;
  const gaps: number[] = [];
  for (let i = Math.max(1, history.length - 5); i < history.length; i += 1) {
    const previous = history[i - 1];
    const current = history[i];
    if (previous === undefined || current === undefined) continue;
    const gap = current.ts - previous.ts;
    if (gap > 0 && Number.isFinite(gap)) gaps.push(gap);
  }
  if (gaps.length === 0) return undefined;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * Elapsed time for the counter. `metrics.elapsedMs` is authoritative, but between `metrics` events
 * the dashboard interpolates forward from the newest sample so the clock ticks live.
 *
 * `MetricsPanelProps` (ARCHITECTURE §8) carries no `Run`, so liveness is inferred: we only
 * interpolate while the stream is fresh (within ~1.25 sample intervals). A finished run therefore
 * freezes within a couple of seconds of its last event. C1 can pass an explicit `live` flag to make
 * this exact instead of inferred.
 */
export function liveElapsedMs(
  metrics: RunMetrics | undefined,
  history: readonly MetricsSample[],
  now: number,
): number {
  const reported = nonNegative(metrics?.elapsedMs);
  if (metrics === undefined) return reported;

  const last = history[history.length - 1];
  if (last === undefined || !Number.isFinite(now)) return reported;

  const gap = now - last.ts;
  if (gap < 0) return reported;

  const interval = sampleIntervalMs(history) ?? DEFAULT_SAMPLE_INTERVAL_MS;
  const staleAfter = Math.round(interval * STALE_SAMPLE_FACTOR) + STALE_SAMPLE_GRACE_MS;
  if (gap > staleAfter) return reported;

  const base = Math.max(reported, nonNegative(last.metrics.elapsedMs));
  if (base <= 0) return 0;
  return base + gap;
}

/** Throughput in tasks merged per 10 minutes. Unknown or zero elapsed time → 0, not Infinity. */
export function throughputPer10Min(tasksMerged: number, elapsedMs: number): number {
  if (!Number.isFinite(tasksMerged) || tasksMerged <= 0) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return (tasksMerged * 600_000) / elapsedMs;
}

/** Throughput straight from a run's metrics. */
export function metricsThroughput(metrics: RunMetrics | undefined): number {
  if (metrics === undefined) return 0;
  return throughputPer10Min(metrics.tasksMerged, metrics.elapsedMs);
}

/** Newest sample, or undefined when the shell has not received any metrics yet. */
export function latestSample(history: readonly MetricsSample[]): MetricsSample | undefined {
  return history[history.length - 1];
}
