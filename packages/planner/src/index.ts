/**
 * `@starling/planner` — turn one goal plus a `RepoMap` into a lane-safe task DAG.
 *
 * ```ts
 * import { createPlanner } from '@starling/planner';
 *
 * const planner = createPlanner({ llm });
 * const { plan, issues } = await planner.plan(goal, map);
 * // plan.tasks never contains an error-level issue: cycles, dangling deps and overlapping lanes
 * // were either fixed by the model or repaired deterministically before returning.
 * ```
 */
export const PACKAGE = '@starling/planner' as const;

export {
  createDefaultLlm,
  discoverOpencodeService,
  type OpencodeService,
  serviceFileCandidates,
} from './default-llm';
export {
  diffPlans,
  formatPlanDiff,
  normalizeTaskTitle,
  type PlanDiff,
  type PlanDiffChange,
  type PlanDiffField,
  type PlanDiffRename,
} from './diff';
export { type PlanDraft, PlanDraftSchema } from './draft';
export { explainIssues } from './explain';
export { buildDepGraph, canRunConcurrently, findCycles, formatCycle, isAncestor } from './graph';
export { assignTaskKeys, dependencyOrder, stripTaskNumber } from './keys';
export {
  type LaneOverlap,
  overlappingConcurrentPairs,
  ownedFileCount,
  ownedFiles,
} from './lanes';
export { type CreatePlannerOptions, createPlanner, planFromDraft } from './planner';
export {
  buildPlanPrompt,
  buildRepairMessages,
  buildRepairRequest,
  DEFAULT_MAP_RENDERER,
  type MapRenderer,
  PLANNER_SYSTEM_PROMPT,
  type PlanPrompt,
  type PlanPromptOptions,
  renderMapFor,
} from './prompt';
export { type RenderRepoMapOptions, renderRepoMap } from './render-map';
export { type RepairOutcome, repairPlan } from './repair';
export {
  applyLaneSuggestion,
  criticalPathMinutes,
  type LaneMergePatch,
  type LaneNarrowPatch,
  type LaneSerialisePatch,
  type LaneSuggestion,
  type LaneSuggestionKind,
  type LaneSuggestionPatch,
  suggestLanes,
} from './suggest';
export {
  DEFAULT_MAX_TASKS,
  DEFAULT_MIN_TASKS,
  DEFAULT_OWNED_FILES_WARN_AT,
  globCanNameNewFile,
  hasErrors,
  MAX_ESTIMATE_MIN,
  PLANNER_MAX_TASKS_LIMIT,
  type ValidatePlanOptions,
  validatePlan,
  warningsOf,
} from './validate';
