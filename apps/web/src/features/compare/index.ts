import type { ComponentType } from 'react';
import { ComparePage } from './ComparePage';
import type { FeatureProps } from './types';

/**
 * Feature lane: compare two runs (Epic 122).
 *
 * The page is self-contained: it reads only `SkyState` (through `FeatureProps`), derives everything
 * in `derive.ts`, and optionally asks `/api/compare` when the hub is live. C3 mounts it as
 * `kind: 'page'` under `?page=compare` and binds the `x` hotkey through Epic 112's registry.
 */
export const FEATURE = 'compare' as const;

export type { CompareEnhancementOptions, RemoteCompare } from './api';
export { COMPARE_TIMEOUT_MS, parseComparePayload, useCompareEnhancement } from './api';
export { ComparePage } from './ComparePage';
export type {
  CompareMetric,
  CompareRow,
  DeltaChip,
  MetricDirection,
  MetricFormat,
  NodeCount,
  RunStats,
  SerialBaselineRun,
} from './derive';
export {
  compareStats,
  deltaChip,
  formatMetricValue,
  hasTaskTimings,
  isSerialBaseline,
  nodeTaskCounts,
  peakParallel,
  runStats,
  SERIAL_BASELINE_LABEL,
  SERIAL_STEP_OVERHEAD_MS,
  serialBaseline,
  serialMs,
} from './derive';
export { MetricTable } from './MetricTable';
export { NodeCounts } from './NodeCounts';
export type { BarDatum, PairedBarsProps } from './PairedBars';
export { PairedBars } from './PairedBars';
export { PlanDiffView } from './PlanDiffView';
export type { PlanDiff, PlanDiffChange, PlanDiffField } from './plan-diff';
export { describeChangedFields, diffPlanTasks } from './plan-diff';
export type { CompareParams, CompareSelection, SelectionSource } from './selection';
export {
  BASELINE_VALUE,
  baselineFor,
  defaultSelection,
  isLiveRun,
  runLabel,
  SAME_RUN_NOTICE,
} from './selection';
export type { ComparePageProps, FeatureProps } from './types';
export type { CompareHistory, CompareLocation } from './url';
export { compareHref, compareSearch, parseCompareParams, pickerValue, writeCompareUrl } from './url';

export const feature = {
  id: 'compare',
  title: 'Compare runs',
  description: 'Two runs side by side: time, cost, parallelism, fixes and the plan diff.',
  kind: 'page',
  icon: 'GitCompareArrows',
  hotkey: 'x',
  Component: ComparePage as ComponentType<FeatureProps>,
} as const;
