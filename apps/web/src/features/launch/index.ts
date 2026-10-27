/**
 * `features/launch` — the launch screen: repo + goal form, plan preview, confirm gate and run
 * history. Props-only; the shell (Epic 41) wires `LaunchPanelProps` to `POST /api/runs`, the store's
 * run list and routing.
 *
 * Public surface:
 * - `LaunchPanel` and `LaunchPanelProps` (defined locally in `types.ts`; ARCHITECTURE §8 predates it)
 * - `Playground` — fixture-driven demo of the whole flow, including the two failure states
 * - the pure helpers (`validateForm`, `toLaunchInput`, `overlapReport`, `summarizeRun`, …) the shell
 *   and the tests use
 */
export const FEATURE = 'launch' as const;

export {
  budgetUsedPercent,
  estimateMinutes,
  estimatePlanCostUsd,
  estimateWidth,
  planDepths,
} from './estimate';
export {
  applyGoal,
  budgetError,
  DEFAULT_BUDGET_USD,
  DEFAULT_FORM,
  DEFAULT_MAX_PARALLEL,
  editedGoal,
  goalError,
  hasErrors,
  initialFormValues,
  MAX_BUDGET_USD,
  MAX_PARALLEL_LIMIT,
  MIN_GOAL_LENGTH,
  maxParallelError,
  requestKey,
  toLaunchInput,
  validateForm,
} from './form';
export { DEMO_GOALS, DEMO_REPO_PATH, GOAL_CHIPS_LABEL } from './goals';
export { type RunSummary, repoName, runHistory, runStatusLabel, runTone, summarizeRun } from './history';
export { LaunchPanel } from './LaunchPanel';
export { dependsOn, findLaneOverlaps, type LaneOverlap, type OverlapReport, overlapReport } from './overlap';
export { Playground, type PlaygroundProps } from './Playground';
export type {
  LaunchField,
  LaunchFormErrors,
  LaunchFormValues,
  LaunchGoal,
  LaunchInput,
  LaunchPanelProps,
  LaunchPhase,
  LaunchPreview,
  PreviewState,
} from './types';
